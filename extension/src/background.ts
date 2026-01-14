declare const process: { env: { PLAYWRITER_PORT: string } }

import { createStore } from 'zustand/vanilla'
import type { ExtensionState, ConnectionState, TabState, TabInfo } from './types'
import type { CDPEvent, Protocol } from 'playwriter/src/cdp-types'
import type { ExtensionCommandMessage, ExtensionResponseMessage } from 'playwriter/src/protocol'

const RELAY_PORT = process.env.PLAYWRITER_PORT
const RELAY_URL = `ws://localhost:${RELAY_PORT}/extension`

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

let childSessions: Map<string, number> = new Map()
let nextSessionId = 1
let tabGroupQueue: Promise<void> = Promise.resolve()

class ConnectionManager {
  ws: WebSocket | null = null
  private connectionPromise: Promise<void> | null = null

  async ensureConnection(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return
    }

    if (store.getState().connectionState === 'extension-replaced') {
      throw new Error('Connection replaced by another extension')
    }

    // Reuse in-progress connection attempt - prevents races between user clicks and maintain loop
    if (this.connectionPromise) {
      return this.connectionPromise
    }

    this.connectionPromise = this.connect()
    try {
      await this.connectionPromise
    } finally {
      this.connectionPromise = null
    }
  }

  private async connect(): Promise<void> {
    logger.debug(`Waiting for server at http://localhost:${RELAY_PORT}...`)

    // Retry for up to 30 seconds with 1s intervals, then give up (maintain loop will retry later)
    const maxAttempts = 30
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        await fetch(`http://localhost:${RELAY_PORT}`, { method: 'HEAD', signal: AbortSignal.timeout(2000) })
        logger.debug('Server is available')
        break
      } catch {
        if (attempt === maxAttempts - 1) {
          throw new Error('Server not available')
        }
        if (attempt % 5 === 0) {
          logger.debug(`Server not available, retrying... (attempt ${attempt + 1}/${maxAttempts})`)
        }
        await sleep(1000)
      }
    }

    logger.debug('Creating WebSocket connection to:', RELAY_URL)
    const socket = new WebSocket(RELAY_URL)

    await new Promise<void>((resolve, reject) => {
      let timeoutFired = false
      const timeout = setTimeout(() => {
        timeoutFired = true
        logger.debug('WebSocket connection TIMEOUT after 5 seconds')
        reject(new Error('Connection timeout'))
      }, 5000)

      socket.onopen = () => {
        if (timeoutFired) {
          return
        }
        logger.debug('WebSocket connected')
        clearTimeout(timeout)
        resolve()
      }

      socket.onerror = (error) => {
        logger.debug('WebSocket error during connection:', error)
        if (!timeoutFired) {
          clearTimeout(timeout)
          reject(new Error('WebSocket connection failed'))
        }
      }

      socket.onclose = (event) => {
        logger.debug('WebSocket closed during connection:', { code: event.code, reason: event.reason })
        if (!timeoutFired) {
          clearTimeout(timeout)
          reject(new Error(`WebSocket closed: ${event.reason || event.code}`))
        }
      }
    })

    this.ws = socket

    this.ws.onmessage = async (event: MessageEvent) => {
      let message: any
      try {
        message = JSON.parse(event.data)
      } catch (error: any) {
        logger.debug('Error parsing message:', error)
        sendMessage({ error: { code: -32700, message: `Error parsing message: ${error.message}` } })
        return
      }

      // Handle ping from server - respond with pong to keep service worker alive
      if (message.method === 'ping') {
        sendMessage({ method: 'pong' })
        return
      }

      // Handle setWindowMode - configure whether to use separate window for automation tabs
      if (message.method === 'setWindowMode') {
        const { separateWindow } = message.params || {}
        logger.debug('Setting window mode:', { separateWindow })
        store.setState({ separateWindow: !!separateWindow, workerWindowId: null })
        sendMessage({ id: message.id, result: { success: true } })
        return
      }

      // Handle createInitialTab - create a new tab when Playwright connects and no tabs exist
      // We use skipAttachedEvent: true because the relay's Target.setAutoAttach handler will send
      // Target.attachedToTarget for all targets in connectedTargets. If we also sent it here,
      // Playwright would receive a duplicate.
      //
      // This differs from the normal flow (user clicks extension icon) where:
      // 1. Extension attaches and sends Target.attachedToTarget to existing Playwright clients
      // 2. New Playwright clients that connect later get targets via Target.setAutoAttach
      //
      // But with createInitialTab, the SAME client that triggered the create is waiting for
      // Target.setAutoAttach - so we'd send the event twice to the same client.
      if (message.method === 'createInitialTab') {
        try {
          logger.debug('Creating initial tab for Playwright client')
          const { separateWindow } = store.getState()
          const tab = separateWindow
            ? await createTabInWorkerWindow('about:blank')
            : await chrome.tabs.create({ url: 'about:blank', active: false })
          if (tab.id) {
            const { targetInfo, sessionId } = await attachTab(tab.id, { skipAttachedEvent: true })
            logger.debug('Initial tab created and connected:', tab.id, 'sessionId:', sessionId)
            sendMessage({
              id: message.id,
              result: {
                success: true,
                tabId: tab.id,
                sessionId,
                targetInfo,
              },
            })
          } else {
            throw new Error('Failed to create tab - no tab ID returned')
          }
        } catch (error: any) {
          logger.debug('Failed to create initial tab:', error)
          sendMessage({ id: message.id, error: error.message })
        }
        return
      }

      const response: ExtensionResponseMessage = { id: message.id }
      try {
        response.result = await handleCommand(message as ExtensionCommandMessage)
      } catch (error: any) {
        logger.debug('Error handling command:', error)
        response.error = error.message
      }
      logger.debug('Sending response:', response)
      sendMessage(response)
    }

    this.ws.onclose = (event: CloseEvent) => {
      this.handleClose(event.reason, event.code)
    }

    this.ws.onerror = (event: Event) => {
      logger.debug('WebSocket error:', event)
    }

    chrome.debugger.onEvent.addListener(onDebuggerEvent)
    chrome.debugger.onDetach.addListener(onDebuggerDetach)

    logger.debug('Connection established')
  }

  private handleClose(reason: string, code: number): void {
    // Log memory at disconnect time to help diagnose memory-related terminations
    try {
      // @ts-ignore - performance.memory is Chrome-specific
      const mem = performance.memory
      if (mem) {
        const formatMB = (b: number) => (b / 1024 / 1024).toFixed(2) + 'MB'
        logger.warn(`DISCONNECT MEMORY: used=${formatMB(mem.usedJSHeapSize)} total=${formatMB(mem.totalJSHeapSize)} limit=${formatMB(mem.jsHeapSizeLimit)}`)
      }
    } catch {}
    logger.warn(`DISCONNECT: WS closed code=${code} reason=${reason || 'none'} stack=${getCallStack()}`)

    chrome.debugger.onEvent.removeListener(onDebuggerEvent)
    chrome.debugger.onDetach.removeListener(onDebuggerDetach)

    const { tabs } = store.getState()

    for (const [tabId] of tabs) {
      chrome.debugger.detach({ tabId }).catch((err) => {
        logger.debug('Error detaching from tab:', tabId, err.message)
      })
    }

    childSessions.clear()
    this.ws = null

    const { workerWindowId, separateWindow } = store.getState()
    if (workerWindowId) {
      // Debug logging: log window state before cleanup
      logger.debug('handleClose cleanup: workerWindowId =', workerWindowId, 'separateWindow =', separateWindow)
      chrome.windows.getAll().then(windows => {
        logger.debug('handleClose: windows before remove:', windows.map(w => ({ id: w.id, tabCount: w.tabs?.length })))
      }).catch(() => {})
      chrome.windows.remove(workerWindowId).catch((err) => {
        logger.debug('handleClose: failed to remove workerWindow:', err.message)
      })
    }
    store.setState({ workerWindowId: null, separateWindow: false })

    if (reason === 'Extension Replaced' || code === 4001) {
      logger.debug('Connection replaced by another extension instance')
      store.setState({
        tabs: new Map(),
        connectionState: 'extension-replaced',
        errorText: 'Disconnected: Replaced by another extension',
      })
      return
    }

    // For normal disconnects, set tabs to 'connecting' state and let maintain loop handle reconnect
    store.setState((state) => {
      const newTabs = new Map(state.tabs)
      for (const [tabId, tab] of newTabs) {
        newTabs.set(tabId, { ...tab, state: 'connecting' })
      }
      return { tabs: newTabs, connectionState: 'idle', errorText: undefined }
    })
  }

  async maintainLoop(): Promise<void> {
    while (true) {
      if (this.ws?.readyState === WebSocket.OPEN) {
        await sleep(1000)
        continue
      }

      // When replaced by another extension, poll until slot is free
      if (store.getState().connectionState === 'extension-replaced') {
        try {
          const response = await fetch(`http://localhost:${RELAY_PORT}/extension/status`, { method: 'GET', signal: AbortSignal.timeout(2000) })
          const data = await response.json()
          if (!data.connected) {
            store.setState({ connectionState: 'idle', errorText: undefined })
            logger.debug('Extension slot is free, cleared error state')
          } else {
            logger.debug('Extension slot still taken, will retry...')
          }
        } catch {
          logger.debug('Server not available, will retry...')
        }
        await sleep(3000)
        continue
      }

    // Ensure tabs are in 'connecting' state when WS is not connected
    // This handles edge cases where handleClose wasn't called or state got out of sync
    const currentTabs = store.getState().tabs
    const hasConnectedTabs = Array.from(currentTabs.values()).some((t) => t.state === 'connected')
    if (hasConnectedTabs) {
      store.setState((state) => {
        const newTabs = new Map(state.tabs)
        for (const [tabId, tab] of newTabs) {
          if (tab.state === 'connected') {
            newTabs.set(tabId, { ...tab, state: 'connecting' })
          }
        }
        return { tabs: newTabs }
      })
    }

    // Try to connect silently in background - don't show 'connecting' badge
    // Individual tab states will show 'connecting' when user explicitly clicks
    try {
      await this.ensureConnection()
        store.setState({ connectionState: 'connected' })

        // Re-attach any tabs that were in 'connecting' state (from a previous disconnect)
        const tabsToReattach = Array.from(store.getState().tabs.entries())
          .filter(([_, tab]) => tab.state === 'connecting')
          .map(([tabId]) => tabId)

        for (const tabId of tabsToReattach) {
          // Re-check state before attaching - might have been attached by user click
          const currentTab = store.getState().tabs.get(tabId)
          if (!currentTab || currentTab.state !== 'connecting') {
            logger.debug('Skipping reattach, tab state changed:', tabId, currentTab?.state)
            continue
          }

          try {
            await chrome.tabs.get(tabId)
            await attachTab(tabId)
            logger.debug('Successfully re-attached tab:', tabId)
          } catch (error: any) {
            logger.debug('Failed to re-attach tab:', tabId, error.message)
            store.setState((state) => {
              const newTabs = new Map(state.tabs)
              newTabs.delete(tabId)
              return { tabs: newTabs }
            })
          }
        }
      } catch (error: any) {
        logger.debug('Connection attempt failed:', error.message)
        store.setState({ connectionState: 'idle' })
      }

      await sleep(3000)
    }
  }
}

const connectionManager = new ConnectionManager()

const store = createStore<ExtensionState>(() => ({
  tabs: new Map(),
  connectionState: 'idle',
  currentTabId: undefined,
  errorText: undefined,
  separateWindow: false,
  workerWindowId: null,
}))

// @ts-ignore
globalThis.toggleExtensionForActiveTab = toggleExtensionForActiveTab
// @ts-ignore
globalThis.disconnectEverything = disconnectEverything
// @ts-ignore
globalThis.getExtensionState = () => store.getState()

declare global {
  var toggleExtensionForActiveTab: () => Promise<{ isConnected: boolean; state: ExtensionState }>
  var getExtensionState: () => ExtensionState
  var disconnectEverything: () => Promise<void>
}

function safeSerialize(arg: any): string {
  if (arg === undefined) return 'undefined'
  if (arg === null) return 'null'
  if (typeof arg === 'function') return `[Function: ${arg.name || 'anonymous'}]`
  if (typeof arg === 'symbol') return String(arg)
  if (arg instanceof Error) return arg.stack || arg.message || String(arg)
  if (typeof arg === 'object') {
    try {
      const seen = new WeakSet()
      return JSON.stringify(arg, (key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) return '[Circular]'
          seen.add(value)
          if (value instanceof Map) return { dataType: 'Map', value: Array.from(value.entries()) }
          if (value instanceof Set) return { dataType: 'Set', value: Array.from(value.values()) }
        }
        return value
      })
    } catch {
      return String(arg)
    }
  }
  return String(arg)
}

function sendLog(level: string, args: any[]) {
  sendMessage({
    method: 'log',
    params: { level, args: args.map(safeSerialize) },
  })
}

const logger = {
  log: (...args: any[]) => {
    console.log(...args)
    sendLog('log', args)
  },
  debug: (...args: any[]) => {
    console.debug(...args)
    sendLog('debug', args)
  },
  info: (...args: any[]) => {
    console.info(...args)
    sendLog('info', args)
  },
  warn: (...args: any[]) => {
    console.warn(...args)
    sendLog('warn', args)
  },
  error: (...args: any[]) => {
    console.error(...args)
    sendLog('error', args)
  },
}

function getCallStack(): string {
  const stack = new Error().stack || ''
  return stack.split('\n').slice(2, 6).join(' <- ').replace(/\s+/g, ' ')
}

self.addEventListener('error', (event) => {
  const error = event.error
  const stack = error?.stack || `${event.message} at ${event.filename}:${event.lineno}:${event.colno}`
  logger.error('Uncaught error:', stack)
})

self.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  const stack = reason?.stack || String(reason)
  logger.error('Unhandled promise rejection:', stack)
})

let messageCount = 0
function sendMessage(message: any): void {
  if (connectionManager.ws?.readyState === WebSocket.OPEN) {
    try {
      connectionManager.ws.send(JSON.stringify(message))
      // Check memory periodically (every ~100 messages)
      if (++messageCount % 100 === 0) {
        checkMemory()
      }
    } catch (error: any) {
      console.debug('ERROR sending message:', error, 'message type:', message.method || 'response')
    }
  }
}

async function syncTabGroup(): Promise<void> {
  const { separateWindow } = store.getState()
  
  // Get connected tabs
  const connectedTabIds = Array.from(store.getState().tabs.entries())
    .filter(([_, info]) => info.state === 'connected')
    .map(([tabId]) => tabId)

  logger.debug('syncTabGroup: separateWindow =', separateWindow, 'connectedTabIds =', connectedTabIds)

  if (separateWindow) {
    // In separateWindow mode: move tabs to worker window AND use playwriter tab group
    if (connectedTabIds.length > 0) {
      logger.debug('syncTabGroup: moving tabs to worker window')
      for (const tabId of connectedTabIds) {
        await moveTabToWorkerWindow(tabId)
      }
      
      // Create/update playwriter tab group in worker window
      try {
        const existingGroups = await chrome.tabGroups.query({ title: 'playwriter' })
        let groupId: number | undefined = existingGroups[0]?.id
        
        if (groupId === undefined) {
          // Create new group
          const newGroupId = await chrome.tabs.group({ tabIds: connectedTabIds })
          await chrome.tabGroups.update(newGroupId, { title: 'playwriter', color: 'green' })
          logger.debug('syncTabGroup: created playwriter group in worker window:', newGroupId)
        } else {
          // Add tabs to existing group
          await chrome.tabs.group({ tabIds: connectedTabIds, groupId })
          logger.debug('syncTabGroup: added tabs to playwriter group:', connectedTabIds)
        }
      } catch (e: any) {
        logger.debug('syncTabGroup: failed to create tab group:', e.message)
      }
    } else {
      // No connected tabs - clean up any existing playwriter tab groups
      try {
        const existingGroups = await chrome.tabGroups.query({ title: 'playwriter' })
        for (const group of existingGroups) {
          const tabsInGroup = await chrome.tabs.query({ groupId: group.id })
          const tabIdsToUngroup = tabsInGroup.map((t) => t.id).filter((id): id is number => id !== undefined)
          if (tabIdsToUngroup.length > 0) {
            await chrome.tabs.ungroup(tabIdsToUngroup)
          }
        }
      } catch (e: any) {
        logger.debug('Failed to cleanup tab groups:', e.message)
      }
    }
    return
  }

  // Non-separateWindow mode: use tab groups
  try {
    // Always query by title - no cached ID that can go stale
    const existingGroups = await chrome.tabGroups.query({ title: 'playwriter' })

    // If no connected tabs, clear any existing playwriter groups
    if (connectedTabIds.length === 0) {
      for (const group of existingGroups) {
        const tabsInGroup = await chrome.tabs.query({ groupId: group.id })
        const tabIdsToUngroup = tabsInGroup.map((t) => t.id).filter((id): id is number => id !== undefined)
        if (tabIdsToUngroup.length > 0) {
          await chrome.tabs.ungroup(tabIdsToUngroup)
        }
        logger.debug('Cleared playwriter group:', group.id)
      }
      return
    }

    // Consolidate duplicate groups into one
    let groupId: number | undefined = existingGroups[0]?.id
    if (existingGroups.length > 1) {
      const [keep, ...duplicates] = existingGroups
      groupId = keep.id
      for (const group of duplicates) {
        const tabsInDupe = await chrome.tabs.query({ groupId: group.id })
        const tabIdsToUngroup = tabsInDupe.map((t) => t.id).filter((id): id is number => id !== undefined)
        if (tabIdsToUngroup.length > 0) {
          await chrome.tabs.ungroup(tabIdsToUngroup)
        }
        logger.debug('Removed duplicate playwriter group:', group.id)
      }
    }

    const allTabs = await chrome.tabs.query({})
    const tabsInGroup = allTabs.filter((t) => t.groupId === groupId && t.id !== undefined)
    const tabIdsInGroup = new Set(tabsInGroup.map((t) => t.id!))

    const tabsToAdd = connectedTabIds.filter((id) => !tabIdsInGroup.has(id))
    const tabsToRemove = Array.from(tabIdsInGroup).filter((id) => !connectedTabIds.includes(id))

    if (tabsToRemove.length > 0) {
      try {
        // Verify tabs still exist before ungrouping
        const existingTabsToRemove: number[] = []
        for (const tabId of tabsToRemove) {
          try {
            await chrome.tabs.get(tabId)
            existingTabsToRemove.push(tabId)
          } catch {
            // Tab no longer exists, skip
          }
        }
        if (existingTabsToRemove.length > 0) {
          await chrome.tabs.ungroup(existingTabsToRemove)
          logger.debug('Removed tabs from group:', existingTabsToRemove)
        }
      } catch (e: any) {
        logger.debug('Failed to ungroup tabs:', tabsToRemove, e.message)
      }
    }

    if (tabsToAdd.length > 0) {
      // Verify tabs still exist before grouping (they may have been closed/moved)
      const existingTabIds: number[] = []
      for (const tabId of tabsToAdd) {
        try {
          await chrome.tabs.get(tabId)
          existingTabIds.push(tabId)
        } catch {
          logger.debug('Tab no longer exists, skipping:', tabId)
        }
      }
      
      if (existingTabIds.length > 0) {
        if (groupId === undefined) {
          const newGroupId = await chrome.tabs.group({ tabIds: existingTabIds })
          await chrome.tabGroups.update(newGroupId, { title: 'playwriter', color: 'green' })
          logger.debug('Created tab group:', newGroupId, 'with tabs:', existingTabIds)
        } else {
          await chrome.tabs.group({ tabIds: existingTabIds, groupId })
          logger.debug('Added tabs to existing group:', existingTabIds)
        }
      }
    }
  } catch (error: any) {
    logger.debug('Failed to sync tab group:', error.message)
  }
}

function getTabBySessionId(sessionId: string): { tabId: number; tab: TabInfo } | undefined {
  for (const [tabId, tab] of store.getState().tabs) {
    if (tab.sessionId === sessionId) {
      return { tabId, tab }
    }
  }
  return undefined
}

function getTabByTargetId(targetId: string): { tabId: number; tab: TabInfo } | undefined {
  for (const [tabId, tab] of store.getState().tabs) {
    if (tab.targetId === targetId) {
      return { tabId, tab }
    }
  }
  return undefined
}

async function handleCommand(msg: ExtensionCommandMessage): Promise<any> {
  if (msg.method !== 'forwardCDPCommand') return

  let targetTabId: number | undefined
  let targetTab: TabInfo | undefined

  if (msg.params.sessionId) {
    const found = getTabBySessionId(msg.params.sessionId)
    if (found) {
      targetTabId = found.tabId
      targetTab = found.tab
    }
  }

  if (!targetTab && msg.params.sessionId) {
    const parentTabId = childSessions.get(msg.params.sessionId)
    if (parentTabId) {
      targetTabId = parentTabId
      targetTab = store.getState().tabs.get(parentTabId)
      logger.debug('Found parent tab for child session:', msg.params.sessionId, 'tabId:', parentTabId)
    }
  }

  if (!targetTab && msg.params.params && 'targetId' in msg.params.params && msg.params.params.targetId) {
    const found = getTabByTargetId(msg.params.params.targetId as string)
    if (found) {
      targetTabId = found.tabId
      targetTab = found.tab
      logger.debug('Found tab for targetId:', msg.params.params.targetId, 'tabId:', targetTabId)
    }
  }

  const debuggee = targetTabId ? { tabId: targetTabId } : undefined

  switch (msg.params.method) {
    case 'Runtime.enable': {
      if (!debuggee) {
        throw new Error(`No debuggee found for Runtime.enable (sessionId: ${msg.params.sessionId})`)
      }
      // When multiple Playwright clients connect to the same tab, each calls Runtime.enable.
      // If Runtime is already enabled, the enable call succeeds but Chrome doesn't re-send
      // Runtime.executionContextCreated events - those were already sent to the first client.
      // By disabling first, we force Chrome to re-send all execution context events when we
      // re-enable, ensuring the new client receives them. The relay server waits for the
      // executionContextCreated events before returning. See cdp-timing.md for details.
      try {
        await chrome.debugger.sendCommand(debuggee, 'Runtime.disable')
        await sleep(50)
      } catch (e) {
        logger.debug('Error disabling Runtime (ignoring):', e)
      }
      return await chrome.debugger.sendCommand(debuggee, 'Runtime.enable', msg.params.params)
    }

    case 'Target.createTarget': {
      const url = msg.params.params?.url || 'about:blank'
      logger.debug('Creating new tab with URL:', url)
      const { separateWindow } = store.getState()
      const tab = separateWindow ? await createTabInWorkerWindow(url) : await chrome.tabs.create({ url, active: false })
      if (!tab.id) throw new Error('Failed to create tab')
      logger.debug('Created tab:', tab.id, 'waiting for it to load...')
      await sleep(100)
      const { targetInfo } = await attachTab(tab.id)
      return { targetId: targetInfo.targetId } satisfies Protocol.Target.CreateTargetResponse
    }

    case 'Target.closeTarget': {
      if (!targetTabId) {
        logger.log(`Target not found: ${msg.params.params?.targetId}`)
        return { success: false } satisfies Protocol.Target.CloseTargetResponse
      }
      await chrome.tabs.remove(targetTabId)
      return { success: true } satisfies Protocol.Target.CloseTargetResponse
    }
  }

  if (!debuggee || !targetTab) {
    throw new Error(
      `No tab found for method ${msg.params.method} sessionId: ${msg.params.sessionId} params: ${JSON.stringify(msg.params.params || null)}`,
    )
  }

  logger.debug('CDP command:', msg.params.method, 'for tab:', targetTabId)

  const debuggerSession: chrome.debugger.DebuggerSession = {
    ...debuggee,
    sessionId: msg.params.sessionId !== targetTab.sessionId ? msg.params.sessionId : undefined,
  }

  return await chrome.debugger.sendCommand(debuggerSession, msg.params.method, msg.params.params)
}

function onDebuggerEvent(source: chrome.debugger.DebuggerSession, method: string, params: any): void {
  const tab = source.tabId ? store.getState().tabs.get(source.tabId) : undefined
  if (!tab) return

  logger.debug('Forwarding CDP event:', method, 'from tab:', source.tabId)

  if (method === 'Target.attachedToTarget' && params?.sessionId) {
    logger.debug('Child target attached:', params.sessionId, 'for tab:', source.tabId)
    childSessions.set(params.sessionId, source.tabId!)
  }

  if (method === 'Target.detachedFromTarget' && params?.sessionId) {
    const mainTab = getTabBySessionId(params.sessionId)
    if (mainTab) {
      logger.debug('Main tab detached via CDP event:', mainTab.tabId, 'sessionId:', params.sessionId)
      store.setState((state) => {
        const newTabs = new Map(state.tabs)
        newTabs.delete(mainTab.tabId)
        return { tabs: newTabs }
      })
    } else {
      logger.debug('Child target detached:', params.sessionId)
      childSessions.delete(params.sessionId)
    }
  }

  sendMessage({
    method: 'forwardCDPEvent',
    params: {
      sessionId: source.sessionId || tab.sessionId,
      method,
      params,
    },
  })
}

function onDebuggerDetach(source: chrome.debugger.Debuggee, reason: `${chrome.debugger.DetachReason}`): void {
  const tabId = source.tabId
  if (!tabId || !store.getState().tabs.has(tabId)) {
    logger.debug('Ignoring debugger detach event for untracked tab:', tabId)
    return
  }

  logger.warn(`DISCONNECT: onDebuggerDetach tabId=${tabId} reason=${reason}`)

  const tab = store.getState().tabs.get(tabId)
  if (tab) {
    sendMessage({
      method: 'forwardCDPEvent',
      params: {
        method: 'Target.detachedFromTarget',
        params: { sessionId: tab.sessionId, targetId: tab.targetId },
      },
    })
  }

  for (const [childSessionId, parentTabId] of childSessions.entries()) {
    if (parentTabId === tabId) {
      logger.debug('Cleaning up child session:', childSessionId, 'for tab:', tabId)
      childSessions.delete(childSessionId)
    }
  }

  store.setState((state) => {
    const newTabs = new Map(state.tabs)
    newTabs.delete(tabId)
    return { tabs: newTabs }
  })

  if (reason === chrome.debugger.DetachReason.CANCELED_BY_USER) {
    // Chrome's debugger info bar cancellation detaches ALL debugger sessions, not just one tab
    store.setState({ connectionState: 'idle', errorText: undefined })
  }
}

type AttachTabResult = {
  targetInfo: Protocol.Target.TargetInfo
  sessionId: string
}

async function attachTab(tabId: number, { skipAttachedEvent = false }: { skipAttachedEvent?: boolean } = {}): Promise<AttachTabResult> {
  const debuggee = { tabId }
  let debuggerAttached = false

  try {
    logger.debug('Attaching debugger to tab:', tabId)
    await chrome.debugger.attach(debuggee, '1.3')
    debuggerAttached = true
    logger.debug('Debugger attached successfully to tab:', tabId)

    await chrome.debugger.sendCommand(debuggee, 'Page.enable')

    const contextMenuScript = `
      document.addEventListener('contextmenu', (e) => {
        window.__playwriter_lastRightClicked = e.target;
      }, true);
    `
    await chrome.debugger.sendCommand(debuggee, 'Page.addScriptToEvaluateOnNewDocument', { source: contextMenuScript })
    await chrome.debugger.sendCommand(debuggee, 'Runtime.evaluate', { expression: contextMenuScript })

    const result = (await chrome.debugger.sendCommand(
      debuggee,
      'Target.getTargetInfo',
    )) as Protocol.Target.GetTargetInfoResponse

    const targetInfo = result.targetInfo

    // Log error if URL is empty - this causes Playwright to create broken pages
    if (!targetInfo.url || targetInfo.url === '' || targetInfo.url === ':') {
      logger.error('WARNING: Target.attachedToTarget will be sent with empty URL! tabId:', tabId, 'targetInfo:', JSON.stringify(targetInfo))
    }

    const attachOrder = nextSessionId
    const sessionId = `pw-tab-${nextSessionId++}`

    store.setState((state) => {
      const newTabs = new Map(state.tabs)
      newTabs.set(tabId, {
        sessionId,
        targetId: targetInfo.targetId,
        state: 'connected',
        attachOrder,
      })
      return { tabs: newTabs, connectionState: 'connected', errorText: undefined }
    })

    if (!skipAttachedEvent) {
      sendMessage({
        method: 'forwardCDPEvent',
        params: {
          method: 'Target.attachedToTarget',
          params: {
            sessionId,
            targetInfo: { ...targetInfo, attached: true },
            waitingForDebugger: false,
          },
        },
      })
    }

    logger.debug('Tab attached successfully:', tabId, 'sessionId:', sessionId, 'targetId:', targetInfo.targetId, 'url:', targetInfo.url, 'skipAttachedEvent:', skipAttachedEvent)
    return { targetInfo, sessionId }
  } catch (error) {
    // Clean up debugger if we attached but failed later
    if (debuggerAttached) {
      logger.debug('Cleaning up debugger after partial attach failure:', tabId)
      chrome.debugger.detach(debuggee).catch(() => {})
    }
    throw error
  }
}

function detachTab(tabId: number, shouldDetachDebugger: boolean): void {
  const tab = store.getState().tabs.get(tabId)
  if (!tab) {
    logger.debug('detachTab: tab not found in map:', tabId)
    return
  }

  logger.warn(`DISCONNECT: detachTab tabId=${tabId} shouldDetach=${shouldDetachDebugger} stack=${getCallStack()}`)

  // Only send detach event if tab was fully attached (has sessionId/targetId)
  // Tabs in 'connecting' state may not have these yet
  if (tab.sessionId && tab.targetId) {
    sendMessage({
      method: 'forwardCDPEvent',
      params: {
        method: 'Target.detachedFromTarget',
        params: { sessionId: tab.sessionId, targetId: tab.targetId },
      },
    })
  }

  store.setState((state) => {
    const newTabs = new Map(state.tabs)
    newTabs.delete(tabId)
    return { tabs: newTabs }
  })

  for (const [childSessionId, parentTabId] of childSessions.entries()) {
    if (parentTabId === tabId) {
      logger.debug('Cleaning up child session:', childSessionId, 'for tab:', tabId)
      childSessions.delete(childSessionId)
    }
  }

  if (shouldDetachDebugger) {
    chrome.debugger.detach({ tabId }).catch((err) => {
      logger.debug('Error detaching debugger from tab:', tabId, err.message)
    })
  }
}

let creatingWindowPromise: Promise<chrome.tabs.Tab> | null = null
let movingToWorkerWindowPromise: Promise<void> | null = null

// Move an existing tab to the worker window, creating the window if needed
async function moveTabToWorkerWindow(tabId: number): Promise<void> {
  const { workerWindowId, separateWindow } = store.getState()
  if (!separateWindow) return

  // Get tab info to check if it's already in worker window
  let tab: chrome.tabs.Tab
  try {
    tab = await chrome.tabs.get(tabId)
  } catch {
    logger.debug('moveTabToWorkerWindow: tab no longer exists:', tabId)
    return
  }

  // If worker window exists and tab is already there, nothing to do
  if (workerWindowId && tab.windowId === workerWindowId) {
    return
  }

  // Ensure only one window creation/move happens at a time
  if (movingToWorkerWindowPromise) {
    await movingToWorkerWindowPromise
    // Retry after the previous move completes
    return moveTabToWorkerWindow(tabId)
  }

  movingToWorkerWindowPromise = (async () => {
    try {
      let targetWindowId = store.getState().workerWindowId
      let defaultTabToClose: number | undefined

      // Create worker window if it doesn't exist
      if (!targetWindowId) {
        // Check again in case another move created it
        const freshState = store.getState()
        if (freshState.workerWindowId) {
          targetWindowId = freshState.workerWindowId
        } else {
          logger.debug('moveTabToWorkerWindow: creating new worker window')
          const win = await chrome.windows.create({
            focused: false,
            width: 1200,
            height: 800,
          })
          targetWindowId = win.id!
          // Remember the default tab to close after moving our tab
          defaultTabToClose = win.tabs?.[0]?.id
          store.setState({ workerWindowId: targetWindowId })
          logger.debug('moveTabToWorkerWindow: created worker window:', targetWindowId, 'defaultTab:', defaultTabToClose)
        }
      }

      // Verify worker window still exists
      try {
        await chrome.windows.get(targetWindowId)
      } catch {
        logger.debug('moveTabToWorkerWindow: worker window was closed, creating new one')
        const win = await chrome.windows.create({
          focused: false,
          width: 1200,
          height: 800,
        })
        targetWindowId = win.id!
        defaultTabToClose = win.tabs?.[0]?.id
        store.setState({ workerWindowId: targetWindowId })
      }

      // Get fresh tab info
      try {
        tab = await chrome.tabs.get(tabId)
      } catch {
        logger.debug('moveTabToWorkerWindow: tab no longer exists:', tabId)
        return
      }

      // If tab is already in worker window, nothing to do
      if (tab.windowId === targetWindowId) {
        return
      }

      // Move the tab to worker window
      logger.debug('moveTabToWorkerWindow: moving tab', tabId, 'from window', tab.windowId, 'to worker window', targetWindowId)
      await chrome.tabs.move(tabId, { windowId: targetWindowId, index: -1 })
      logger.debug('moveTabToWorkerWindow: successfully moved tab', tabId)

      // Close the default new tab that was created with the window
      if (defaultTabToClose) {
        try {
          await chrome.tabs.remove(defaultTabToClose)
          logger.debug('moveTabToWorkerWindow: closed default tab', defaultTabToClose)
        } catch {
          // Tab might already be closed or doesn't exist
        }
      }
    } finally {
      movingToWorkerWindowPromise = null
    }
  })()

  return movingToWorkerWindowPromise
}

async function createTabInWorkerWindow(url: string): Promise<chrome.tabs.Tab> {
  const { workerWindowId } = store.getState()

  if (workerWindowId) {
    // Verify window still exists
    try {
      await chrome.windows.get(workerWindowId)
      // Add tab to existing window
      return await chrome.tabs.create({
        windowId: workerWindowId,
        url,
        active: false,
      })
    } catch {
      // Window was closed, reset and create new one
      store.setState({ workerWindowId: null })
    }
  }

  if (creatingWindowPromise) {
    await creatingWindowPromise
    return createTabInWorkerWindow(url)
  }

  creatingWindowPromise = (async () => {
    try {
      // Debug: log existing windows before creating new one
      const existingWindows = await chrome.windows.getAll()
      logger.debug('createTabInWorkerWindow: existing windows before create:', existingWindows.map(w => w.id))
      
      // Create new worker window with first tab
      const win = await chrome.windows.create({
        url,
        focused: false,
        width: 1200,
        height: 800,
      })

      logger.debug('createTabInWorkerWindow: created new window with id:', win.id, 'existing windows were:', existingWindows.map(w => w.id))
      store.setState({ workerWindowId: win.id! })
      return win.tabs![0]
    } finally {
      creatingWindowPromise = null
    }
  })()

  return creatingWindowPromise
}

async function connectTab(tabId: number): Promise<void> {
  try {
    logger.debug(`Starting connection to tab ${tabId}`)

    store.setState((state) => {
      const newTabs = new Map(state.tabs)
      newTabs.set(tabId, { state: 'connecting' })
      return { tabs: newTabs }
    })

    await connectionManager.ensureConnection()
    await attachTab(tabId)

    logger.debug(`Successfully connected to tab ${tabId}`)
  } catch (error: any) {
    logger.debug(`Failed to connect to tab ${tabId}:`, error)

    // Distinguish between WS connection errors and tab-specific errors
    // WS errors: keep in 'connecting' state, maintainLoop will retry when WS is available
    // Tab errors: show 'error' state (e.g., restricted page, debugger attach failed)
    const isWsError =
      error.message === 'Server not available' ||
      error.message === 'Connection timeout' ||
      error.message === 'Connection replaced by another extension' ||
      error.message.startsWith('WebSocket')

    if (isWsError) {
      logger.debug(`WS connection failed, keeping tab ${tabId} in connecting state for retry`)
      // Tab stays in 'connecting' state - maintainLoop will retry when WS becomes available
    } else {
      store.setState((state) => {
        const newTabs = new Map(state.tabs)
        newTabs.set(tabId, { state: 'error', errorText: `Error: ${error.message}` })
        return { tabs: newTabs }
      })
    }
  }
}

async function disconnectTab(tabId: number): Promise<void> {
  logger.debug(`Disconnecting tab ${tabId}`)

  const { tabs } = store.getState()
  if (!tabs.has(tabId)) {
    logger.debug('Tab not in tabs map, ignoring disconnect')
    return
  }

  detachTab(tabId, true)
  // WS connection is maintained even with no tabs - maintainConnection handles it
}

async function toggleExtensionForActiveTab(): Promise<{ isConnected: boolean; state: ExtensionState }> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  const tab = tabs[0]
  if (!tab?.id) throw new Error('No active tab found')

  await onActionClicked(tab)

  await new Promise<void>((resolve) => {
    const check = () => {
      const state = store.getState()
      const tabInfo = state.tabs.get(tab.id!)
      if (tabInfo?.state === 'connecting') {
        setTimeout(check, 100)
        return
      }
      resolve()
    }
    check()
  })

  const state = store.getState()
  const isConnected = state.tabs.has(tab.id) && state.tabs.get(tab.id)?.state === 'connected'
  return { isConnected, state }
}

async function disconnectEverything(): Promise<void> {
  // Queue disconnect operation to serialize with other tab group operations
  tabGroupQueue = tabGroupQueue.then(async () => {
    const { tabs } = store.getState()
    for (const tabId of tabs.keys()) {
      await disconnectTab(tabId)
    }
  })
  await tabGroupQueue
  // WS connection is maintained - maintainConnection handles it
}

async function resetDebugger(): Promise<void> {
  let targets = await chrome.debugger.getTargets()
  targets = targets.filter((x) => x.tabId && x.attached)
  logger.log(`found ${targets.length} existing debugger targets. detaching them before background script starts`)
  for (const target of targets) {
    await chrome.debugger.detach({ tabId: target.tabId })
  }
}

// undefined URL is for about:blank pages (not restricted) and chrome:// URLs (restricted).
// We can't distinguish them without the `tabs` permission, so we just let attachment fail.
function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) return false
  const restrictedPrefixes = ['chrome://', 'chrome-extension://', 'devtools://', 'edge://', 'https://chrome.google.com/', 'https://chromewebstore.google.com/']
  return restrictedPrefixes.some((prefix) => url.startsWith(prefix))
}

const icons = {
  connected: {
    path: {
      '16': '/icons/icon-green-16.png',
      '32': '/icons/icon-green-32.png',
      '48': '/icons/icon-green-48.png',
      '128': '/icons/icon-green-128.png',
    },
    title: 'Connected - Click to disconnect',
    badgeText: '',
    badgeColor: [64, 64, 64, 255] as [number, number, number, number],
  },
  connecting: {
    path: {
      '16': '/icons/icon-gray-16.png',
      '32': '/icons/icon-gray-32.png',
      '48': '/icons/icon-gray-48.png',
      '128': '/icons/icon-gray-128.png',
    },
    title: 'Waiting for MCP WS server...',
    badgeText: '...',
    badgeColor: [64, 64, 64, 255] as [number, number, number, number],
  },
  idle: {
    path: {
      '16': '/icons/icon-black-16.png',
      '32': '/icons/icon-black-32.png',
      '48': '/icons/icon-black-48.png',
      '128': '/icons/icon-black-128.png',
    },
    title: 'Click to attach debugger',
    badgeText: '',
    badgeColor: [64, 64, 64, 255] as [number, number, number, number],
  },
  restricted: {
    path: {
      '16': '/icons/icon-gray-16.png',
      '32': '/icons/icon-gray-32.png',
      '48': '/icons/icon-gray-48.png',
      '128': '/icons/icon-gray-128.png',
    },
    title: 'Cannot attach to this page',
    badgeText: '',
    badgeColor: [64, 64, 64, 255] as [number, number, number, number],
  },
  extensionReplaced: {
    path: {
      '16': '/icons/icon-gray-16.png',
      '32': '/icons/icon-gray-32.png',
      '48': '/icons/icon-gray-48.png',
      '128': '/icons/icon-gray-128.png',
    },
    title: 'Replaced by another extension - Click to retry',
    badgeText: '!',
    badgeColor: [220, 38, 38, 255] as [number, number, number, number],
  },
  tabError: {
    path: {
      '16': '/icons/icon-gray-16.png',
      '32': '/icons/icon-gray-32.png',
      '48': '/icons/icon-gray-48.png',
      '128': '/icons/icon-gray-128.png',
    },
    title: 'Error',
    badgeText: '!',
    badgeColor: [220, 38, 38, 255] as [number, number, number, number],
  },
} as const

async function updateIcons(): Promise<void> {
  const state = store.getState()
  const { connectionState, tabs, errorText } = state

  const connectedCount = Array.from(tabs.values()).filter((t) => t.state === 'connected').length

  const allTabs = await chrome.tabs.query({})
  const tabUrlMap = new Map(allTabs.map((tab) => [tab.id, tab.url]))
  const allTabIds = [undefined, ...allTabs.map((tab) => tab.id).filter((id): id is number => id !== undefined)]

  for (const tabId of allTabIds) {
    const tabInfo = tabId !== undefined ? tabs.get(tabId) : undefined
    const tabUrl = tabId !== undefined ? tabUrlMap.get(tabId) : undefined

    const iconConfig = (() => {
      if (connectionState === 'extension-replaced') return icons.extensionReplaced
      if (tabId !== undefined && isRestrictedUrl(tabUrl)) return icons.restricted
      if (tabInfo?.state === 'error') return icons.tabError
      if (tabInfo?.state === 'connecting') return icons.connecting
      if (tabInfo?.state === 'connected') return icons.connected
      return icons.idle
    })()

    const title = (() => {
      if (connectionState === 'extension-replaced' && errorText) return errorText
      if (tabInfo?.errorText) return tabInfo.errorText
      return iconConfig.title
    })()

    const badgeText = (() => {
      if (iconConfig === icons.connected || iconConfig === icons.idle || iconConfig === icons.restricted) {
        return connectedCount > 0 ? String(connectedCount) : ''
      }
      return iconConfig.badgeText
    })()

    void chrome.action.setIcon({ tabId, path: iconConfig.path })
    void chrome.action.setTitle({ tabId, title })
    if (iconConfig.badgeColor) void chrome.action.setBadgeBackgroundColor({ tabId, color: iconConfig.badgeColor })
    void chrome.action.setBadgeText({ tabId, text: badgeText })
  }
}

async function onTabRemoved(tabId: number): Promise<void> {
  const { tabs } = store.getState()
  if (!tabs.has(tabId)) return
  logger.debug(`Connected tab ${tabId} was closed, disconnecting`)
  await disconnectTab(tabId)
}

async function onTabActivated(activeInfo: chrome.tabs.TabActiveInfo): Promise<void> {
  store.setState({ currentTabId: activeInfo.tabId })
}

async function onActionClicked(tab: chrome.tabs.Tab): Promise<void> {
  if (!tab.id) {
    logger.debug('No tab ID available')
    return
  }

  if (isRestrictedUrl(tab.url)) {
    logger.debug('Cannot attach to restricted URL:', tab.url)
    return
  }

  const { tabs, connectionState } = store.getState()
  const tabInfo = tabs.get(tab.id)

  // If in extension-replaced state, clear it and connect the clicked tab
  if (connectionState === 'extension-replaced') {
    logger.debug('Clearing extension-replaced state, connecting clicked tab')
    store.setState({ connectionState: 'idle', errorText: undefined })
    await connectTab(tab.id)
    return
  }

  if (tabInfo?.state === 'error') {
    logger.debug('Tab has error - disconnecting to clear state')
    await disconnectTab(tab.id)
    return
  }

  if (tabInfo?.state === 'connecting') {
    logger.debug('Tab is already connecting, ignoring click')
    return
  }

  if (tabInfo?.state === 'connected') {
    await disconnectTab(tab.id)
  } else {
    // In separateWindow mode, if this is the last tab in the user's window,
    // create a new tab first to prevent Chrome from closing the window
    // when the tab gets moved to the worker window via tab grouping.
    const { separateWindow, workerWindowId } = store.getState()
    // Check if separateWindow is enabled AND either:
    // 1. workerWindowId exists and this tab is not in the worker window, OR
    // 2. workerWindowId doesn't exist yet (first connection, worker window will be created)
    const isUserWindow = workerWindowId ? tab.windowId !== workerWindowId : true
    if (separateWindow && isUserWindow) {
      const windowTabs = await chrome.tabs.query({ windowId: tab.windowId })
      if (windowTabs.length === 1) {
        logger.debug('Last tab in user window, creating new tab to keep window open')
        await chrome.tabs.create({ windowId: tab.windowId, url: 'chrome://newtab', active: true })
      }
    }
    await connectTab(tab.id)
  }
}

resetDebugger()
connectionManager.maintainLoop()

chrome.contextMenus.remove('playwriter-pin-element').catch(() => {}).finally(() => {
  chrome.contextMenus.create({
    id: 'playwriter-pin-element',
    title: 'Copy Playwriter Element Reference',
    contexts: ['all'],
    visible: false,
  })
})

function updateContextMenuVisibility(): void {
  const { currentTabId, tabs } = store.getState()
  const isConnected = currentTabId !== undefined && tabs.get(currentTabId)?.state === 'connected'
  chrome.contextMenus.update('playwriter-pin-element', { visible: isConnected })
}

chrome.runtime.onInstalled.addListener((details) => {
  if (import.meta.env.TESTING) return
  if (details.reason === 'install') {
    void chrome.tabs.create({ url: 'welcome.html' })
  }
})

function serializeTabs(tabs: Map<number, TabInfo>): string {
  return JSON.stringify(Array.from(tabs.entries()))
}

store.subscribe((state, prevState) => {
  logger.log(state)
  void updateIcons()
  updateContextMenuVisibility()

  if (state.separateWindow && state.tabs.size === 0 && state.workerWindowId) {
    // Debug logging: log window state before cleanup
    logger.debug('store.subscribe cleanup: workerWindowId =', state.workerWindowId, 'tabs.size =', state.tabs.size)
    chrome.windows.getAll().then(windows => {
      logger.debug('store.subscribe: windows before remove:', windows.map(w => ({ id: w.id, tabCount: w.tabs?.length })))
    }).catch(() => {})
    chrome.windows.remove(state.workerWindowId).catch((err) => {
      logger.debug('store.subscribe: failed to remove workerWindow:', err.message)
    })
    store.setState({ workerWindowId: null })
  }

  const tabsChanged = serializeTabs(state.tabs) !== serializeTabs(prevState.tabs)
  if (tabsChanged) {
    tabGroupQueue = tabGroupQueue.then(syncTabGroup).catch((e) => {
      logger.debug('syncTabGroup error:', e)
    })
  }
})

logger.debug(`Using relay URL: ${RELAY_URL}`)

// Memory monitoring - helps debug service worker termination issues
let lastMemoryUsage = 0
let lastMemoryCheck = Date.now()
const MEMORY_WARNING_THRESHOLD = 50 * 1024 * 1024 // 50MB
const MEMORY_CRITICAL_THRESHOLD = 100 * 1024 * 1024 // 100MB
const MEMORY_GROWTH_THRESHOLD = 10 * 1024 * 1024 // 10MB growth per interval is suspicious

function checkMemory(): void {
  try {
    // @ts-ignore - performance.memory is Chrome-specific and not in TS types
    const memory = performance.memory
    if (!memory) {
      return
    }

    const used = memory.usedJSHeapSize
    const total = memory.totalJSHeapSize
    const limit = memory.jsHeapSizeLimit
    const now = Date.now()
    const timeDelta = now - lastMemoryCheck
    const memoryDelta = used - lastMemoryUsage

    const formatMB = (bytes: number) => (bytes / 1024 / 1024).toFixed(2) + 'MB'
    const growthRate = timeDelta > 0 ? (memoryDelta / timeDelta) * 1000 : 0 // bytes per second

    // Log if memory is high or growing rapidly
    if (used > MEMORY_CRITICAL_THRESHOLD) {
      logger.error(`MEMORY CRITICAL: used=${formatMB(used)} total=${formatMB(total)} limit=${formatMB(limit)} growth=${formatMB(memoryDelta)} rate=${formatMB(growthRate)}/s`)
    } else if (used > MEMORY_WARNING_THRESHOLD) {
      logger.warn(`MEMORY WARNING: used=${formatMB(used)} total=${formatMB(total)} limit=${formatMB(limit)} growth=${formatMB(memoryDelta)} rate=${formatMB(growthRate)}/s`)
    } else if (memoryDelta > MEMORY_GROWTH_THRESHOLD && timeDelta < 60000) {
      logger.warn(`MEMORY SPIKE: grew ${formatMB(memoryDelta)} in ${(timeDelta / 1000).toFixed(1)}s (used=${formatMB(used)})`)
    }

    lastMemoryUsage = used
    lastMemoryCheck = now
  } catch (e) {
    // Silently ignore - performance.memory may not be available
  }
}

// Check memory every 5 seconds
setInterval(checkMemory, 5000)

// Initial memory check
checkMemory()

chrome.tabs.onRemoved.addListener(onTabRemoved)
chrome.tabs.onActivated.addListener(onTabActivated)
chrome.action.onClicked.addListener(onActionClicked)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  void updateIcons()
  if (changeInfo.groupId !== undefined) {
    // Queue tab group operations to serialize with syncTabGroup and disconnectEverything
    tabGroupQueue = tabGroupQueue.then(async () => {
      // Query for playwriter group by title - no stale cached ID
      const existingGroups = await chrome.tabGroups.query({ title: 'playwriter' })
      const groupId = existingGroups[0]?.id
      if (groupId === undefined) {
        return
      }
      const { tabs } = store.getState()
      if (changeInfo.groupId === groupId) {
        if (!tabs.has(tabId) && !isRestrictedUrl(tab.url)) {
          logger.debug('Tab manually added to playwriter group:', tabId)
          await connectTab(tabId)
        }
      } else if (tabs.has(tabId)) {
        const tabInfo = tabs.get(tabId)
        if (tabInfo?.state === 'connecting') {
          logger.debug('Tab removed from group while connecting, ignoring:', tabId)
          return
        }
        logger.debug('Tab manually removed from playwriter group:', tabId)
        await disconnectTab(tabId)
      }
    }).catch((e) => {
      logger.debug('onTabUpdated handler error:', e)
    })
  }
})

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'playwriter-pin-element' || !tab?.id) return

  const tabInfo = store.getState().tabs.get(tab.id)
  if (!tabInfo || tabInfo.state !== 'connected') {
    logger.debug('Tab not connected, ignoring')
    return
  }

  const debuggee = { tabId: tab.id }
  const count = (tabInfo.pinnedCount || 0) + 1

  store.setState((state) => {
    const newTabs = new Map(state.tabs)
    const existing = newTabs.get(tab.id!)
    if (existing) {
      newTabs.set(tab.id!, { ...existing, pinnedCount: count })
    }
    return { tabs: newTabs }
  })

  const name = `playwriterPinnedElem${count}`

  const connectedTabs = Array.from(store.getState().tabs.entries())
    .filter(([_, t]) => t.state === 'connected')
    .sort((a, b) => (a[1].attachOrder ?? 0) - (b[1].attachOrder ?? 0))
  const pageIndex = connectedTabs.findIndex(([id]) => id === tab.id)
  const hasMultiplePages = connectedTabs.length > 1

  try {
    const result = (await chrome.debugger.sendCommand(debuggee, 'Runtime.evaluate', {
      expression: `
        if (window.__playwriter_lastRightClicked) {
          window.${name} = window.__playwriter_lastRightClicked;
          '${name}';
        } else {
          throw new Error('No element was right-clicked');
        }
      `,
      returnByValue: true,
    })) as { result?: { value?: string }; exceptionDetails?: { text: string } }

    if (result.exceptionDetails) {
      logger.error('Failed to pin element:', result.exceptionDetails.text)
      return
    }

    const clipboardText = hasMultiplePages
      ? `globalThis.${name} (page ${pageIndex}, ${tab.url || 'unknown url'})`
      : `globalThis.${name}`

    await chrome.debugger.sendCommand(debuggee, 'Runtime.evaluate', {
      expression: `
        (() => {
          const el = window.${name};
          if (!el) return;
          const orig = el.getAttribute('style') || '';
          el.setAttribute('style', orig + '; outline: 3px solid #22c55e !important; outline-offset: 2px !important; box-shadow: 0 0 0 3px #22c55e !important;');
          setTimeout(() => el.setAttribute('style', orig), 300);
          return navigator.clipboard.writeText(${JSON.stringify(clipboardText)});
        })()
      `,
      awaitPromise: true,
    })

    logger.debug('Pinned element as:', name)
  } catch (error: any) {
    logger.error('Failed to pin element:', error.message)
  }
})

// Sync icons on first load
void updateIcons()
