declare const process: { env: { PLAYWRITER_PORT: string } }
// Injected by vite at build time from playwriter/package.json version.
// CLI/MCP compare this against their own version to warn when the extension is outdated.
declare const __PLAYWRITER_VERSION__: string

import { createStore } from 'zustand/vanilla'
import type { ExtensionState, ConnectionState, TabState, TabInfo } from './types'
import type { CDPEvent, Protocol } from 'playwriter/src/cdp-types'
import type { ExtensionCommandMessage, ExtensionResponseMessage } from 'playwriter/src/protocol'
import { handleGhostBrowserCommand, type GhostBrowserCommandParams } from 'playwriter/src/ghost-browser'
import {
  getActiveRecordings,
  handleStartRecording,
  handleStopRecording,
  handleIsRecording,
  handleCancelRecording,
  cleanupRecordingForTab,
} from './recording'

const RELAY_HOST = '127.0.0.1'
const RELAY_PORT = Number(process.env.PLAYWRITER_PORT) || 19988

type NavigatorWithUaData = Navigator & {
  userAgentData?: {
    brands: Array<{ brand: string; version: string }>
  }
}

type ExtensionIdentity = {
  browser: string
  email: string
  id: string
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function detectBrowserName(): Promise<string> {
  if ((chrome as unknown as { ghostPublicAPI?: unknown }).ghostPublicAPI) {
    return 'Ghost'
  }

  const navigatorWithUaData = navigator as NavigatorWithUaData
  const brands = navigatorWithUaData.userAgentData?.brands
  if (brands && brands.length > 0) {
    const brandNames = brands.map((brand) => {
      return brand.brand.trim().toLowerCase()
    })

    if (brandNames.some((brand) => brand === 'brave')) return 'Brave'
    if (brandNames.some((brand) => brand === 'microsoft edge')) return 'Edge'
    if (brandNames.some((brand) => brand === 'opera')) return 'Opera'
    if (brandNames.some((brand) => brand === 'vivaldi')) return 'Vivaldi'
    if (brandNames.some((brand) => brand === 'google chrome')) return 'Chrome'
    if (brandNames.some((brand) => brand === 'chromium')) return 'Chromium'
  }

  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('edg/')) return 'Edge'
  if (ua.includes('opr/')) return 'Opera'
  if (ua.includes('vivaldi')) return 'Vivaldi'
  if (ua.includes('brave')) return 'Brave'
  if (ua.includes('chrome')) return 'Chrome'
  return 'Chromium'
}

let identityPromise: Promise<ExtensionIdentity> | null = null
const tabSessionScope = (() => {
  const values = new Uint32Array(2)
  crypto.getRandomValues(values)
  return Array.from(values)
    .map((value) => {
      return value.toString(36)
    })
    .join('')
})()

async function getExtensionIdentity(): Promise<ExtensionIdentity> {
  if (identityPromise) {
    return identityPromise
  }

  identityPromise = (async () => {
    const browser = await detectBrowserName()
    try {
      const info = await chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' })
      return {
        browser,
        email: info.email || '',
        id: info.id || '',
      }
    } catch {
      return {
        browser,
        email: '',
        id: '',
      }
    }
  })()

  return identityPromise
}

let childSessions: Map<string, { tabId: number; targetId?: string }> = new Map()
let nextSessionId = 1
let tabGroupQueue: Promise<void> = Promise.resolve()
// Cache Target.setAutoAttach params so existing and future tabs enable OOPIF target events.
// This ensures Playwright can build the iframe frame tree when connecting over CDP.
let autoAttachParams: Protocol.Target.SetAutoAttachRequest | null = null

// Buffer for recording chunks when WebSocket isn't ready.
// Chunks are keyed by tabId and flushed when WebSocket opens.
interface BufferedChunk {
  tabId: number
  data?: number[]
  final?: boolean
}
const recordingChunkBuffer: BufferedChunk[] = []

/**
 * Flush buffered recording chunks to the WebSocket.
 * Called when WebSocket becomes ready.
 */
function flushRecordingChunkBuffer(ws: WebSocket): void {
  if (recordingChunkBuffer.length === 0) {
    return
  }

  logger.debug(`Flushing ${recordingChunkBuffer.length} buffered recording chunks`)

  while (recordingChunkBuffer.length > 0) {
    const chunk = recordingChunkBuffer.shift()!
    const { tabId, data, final } = chunk

    // Send metadata message first
    ws.send(
      JSON.stringify({
        method: 'recordingData',
        params: { tabId, final },
      }),
    )

    // Then send binary data if not final
    if (data && !final) {
      const buffer = new Uint8Array(data)
      ws.send(buffer)
    }
  }
}

class ConnectionManager {
  ws: WebSocket | null = null
  private connectionPromise: Promise<void> | null = null
  preserveTabsOnDetach = false

  async ensureConnection(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return
    }

    if (store.getState().connectionState === 'extension-replaced') {
      throw new Error('Another Playwriter extension is already connected')
    }

    // Reuse in-progress connection attempt - prevents races between user clicks and maintain loop
    if (this.connectionPromise) {
      return this.connectionPromise
    }

    // Wrap connect() with a global timeout to ensure it never hangs forever.
    // This protects against edge cases where individual timeouts don't fire
    // (e.g., DNS resolution hangs, AbortSignal doesn't work, etc.)
    const GLOBAL_TIMEOUT_MS = 15000
    this.connectionPromise = Promise.race([
      this.connect(),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('Connection timeout (global)'))
        }, GLOBAL_TIMEOUT_MS)
      }),
    ])

    try {
      await this.connectionPromise
    } finally {
      this.connectionPromise = null
    }
  }

  private async connect(): Promise<void> {
    logger.debug(`Waiting for server at http://${RELAY_HOST}:${RELAY_PORT}...`)

    // Retry for up to 5 seconds with 1s intervals, then give up (maintain loop will retry later)
    // Using fewer attempts since maintainLoop retries every 3 seconds anyway
    const maxAttempts = 5
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        await fetch(`http://${RELAY_HOST}:${RELAY_PORT}`, { method: 'HEAD', signal: AbortSignal.timeout(2000) })
        logger.debug('Server is available')
        break
      } catch {
        if (attempt === maxAttempts - 1) {
          throw new Error('Server not available')
        }
        logger.debug(`Server not available, retrying... (attempt ${attempt + 1}/${maxAttempts})`)
        await sleep(1000)
      }
    }

    const identity = await getExtensionIdentity()
    const relayUrl = new URL(`ws://${RELAY_HOST}:${RELAY_PORT}/extension`)
    if (identity.browser) {
      relayUrl.searchParams.set('browser', identity.browser)
    }
    if (identity.email) {
      relayUrl.searchParams.set('email', identity.email)
    }
    if (identity.id) {
      relayUrl.searchParams.set('id', identity.id)
    }
    if (typeof __PLAYWRITER_VERSION__ !== 'undefined') {
      relayUrl.searchParams.set('v', __PLAYWRITER_VERSION__)
    }
    logger.debug('Creating WebSocket connection to:', relayUrl)
    const socket = new WebSocket(relayUrl.toString())

    await new Promise<void>((resolve, reject) => {
      let settled = false
      const timeout = setTimeout(() => {
        if (settled) return
        settled = true
        logger.debug('WebSocket connection TIMEOUT after 5 seconds')
        try {
          socket.close()
        } catch {}
        reject(new Error('Connection timeout'))
      }, 5000)

      socket.onopen = () => {
        if (settled) return
        settled = true
        logger.debug('WebSocket connected')
        clearTimeout(timeout)

        // Flush any buffered recording chunks now that WebSocket is ready
        flushRecordingChunkBuffer(socket)

        resolve()
      }

      socket.onerror = (error) => {
        logger.debug('WebSocket error during connection:', error)
        if (settled) return
        settled = true
        clearTimeout(timeout)
        reject(new Error('WebSocket connection failed'))
      }

      socket.onclose = (event) => {
        logger.debug('WebSocket closed during connection:', { code: event.code, reason: event.reason })
        if (settled) return
        settled = true
        clearTimeout(timeout)
        // Normalize 4002 rejection to consistent error message for callers to detect
        if (event.code === 4002 || event.reason === 'Extension Already In Use') {
          reject(new Error('Extension Already In Use'))
        } else {
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
          const tab = await chrome.tabs.create({ url: 'about:blank', active: false })
          if (tab.id) {
            setTabConnecting(tab.id)
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

      // Handle recording commands
      if (message.method === 'startRecording') {
        try {
          const result = await handleStartRecording(message.params)
          sendMessage({ id: message.id, result })
        } catch (error: any) {
          logger.error('Failed to start recording:', error)
          sendMessage({ id: message.id, result: { success: false, error: error.message } })
        }
        return
      }

      if (message.method === 'stopRecording') {
        try {
          const result = await handleStopRecording(message.params)
          sendMessage({ id: message.id, result })
        } catch (error: any) {
          logger.error('Failed to stop recording:', error)
          sendMessage({ id: message.id, result: { success: false, error: error.message } })
        }
        return
      }

      if (message.method === 'isRecording') {
        try {
          const result = await handleIsRecording(message.params)
          sendMessage({ id: message.id, result })
        } catch (error: any) {
          logger.error('Failed to check recording status:', error)
          sendMessage({ id: message.id, result: { isRecording: false } })
        }
        return
      }

      if (message.method === 'cancelRecording') {
        try {
          const result = await handleCancelRecording(message.params)
          sendMessage({ id: message.id, result })
        } catch (error: any) {
          logger.error('Failed to cancel recording:', error)
          sendMessage({ id: message.id, result: { success: false, error: error.message } })
        }
        return
      }

      // Handle Ghost Browser API commands
      // This allows calling chrome.ghostPublicAPI, chrome.ghostProxies, chrome.projects
      // from the playwriter executor sandbox when running in Ghost Browser
      if (message.method === 'ghost-browser') {
        const params = message.params as GhostBrowserCommandParams
        const result = await handleGhostBrowserCommand(params, chrome)
        if (!result.success) {
          logger.error('Ghost Browser API error:', result.error)
        }
        // Auto-connect tabs created via ghostPublicAPI.openTab so they appear in context.pages()
        if (result.success && params.namespace === 'ghostPublicAPI' && params.method === 'openTab') {
          const tabId = result.result as number
          if (tabId) {
            logger.debug('Auto-connecting Ghost Browser tab:', tabId)
            setTabConnecting(tabId)
            await sleep(100)
            await attachTab(tabId)
          }
        }
        sendMessage({ id: message.id, result })
        return
      }

      const response: ExtensionResponseMessage = { id: message.id }
      try {
        response.result = await handleCommand(message as ExtensionCommandMessage)
      } catch (error: any) {
        logger.debug('Error handling command:', error)
        response.error = error.message
      }
      // logger.debug('Sending response:', response)
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
        logger.warn(
          `DISCONNECT MEMORY: used=${formatMB(mem.usedJSHeapSize)} total=${formatMB(mem.totalJSHeapSize)} limit=${formatMB(mem.jsHeapSizeLimit)}`,
        )
      }
    } catch {}
    logger.warn(`DISCONNECT: WS closed code=${code} reason=${reason || 'none'} stack=${getCallStack()}`)

    chrome.debugger.onEvent.removeListener(onDebuggerEvent)
    chrome.debugger.onDetach.removeListener(onDebuggerDetach)

    const isExtensionReplaced = reason === 'Extension Replaced' || code === 4001
    const isExtensionInUse = reason === 'Extension Already In Use' || code === 4002
    this.preserveTabsOnDetach = !(isExtensionReplaced || isExtensionInUse)

    const { tabs } = store.getState()

    for (const [tabId] of tabs) {
      chrome.debugger.detach({ tabId }).catch((err) => {
        logger.debug('Error detaching from tab:', tabId, err.message)
      })
    }

    childSessions.clear()
    this.ws = null

    // Only one extension can connect to the relay server at a time.
    // Code 4001: Another extension replaced this one (this extension was idle)
    // Code 4002: This extension tried to connect but another is actively in use
    if (isExtensionReplaced) {
      logger.debug('Disconnected: another Playwriter extension connected (this one was idle)')
      store.setState({
        tabs: new Map(),
        connectionState: 'extension-replaced',
        errorText: 'Another Playwriter extension took over the connection',
      })
      return
    }

    if (isExtensionInUse) {
      logger.debug('Rejected: another Playwriter extension is actively in use')
      store.setState({
        tabs: new Map(),
        connectionState: 'extension-replaced',
        errorText: 'Another Playwriter extension is actively in use',
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

      // When another Playwriter extension took over, poll until slot is free.
      // Slot is free when: no extension connected, OR connected but no active tabs.
      if (store.getState().connectionState === 'extension-replaced') {
        try {
          const response = await fetch(`http://${RELAY_HOST}:${RELAY_PORT}/extension/status`, {
            method: 'GET',
            signal: AbortSignal.timeout(2000),
          })
          const data = (await response.json()) as { connected: boolean; activeTargets: number }
          const slotAvailable = !data.connected || data.activeTargets === 0
          if (slotAvailable) {
            store.setState({ connectionState: 'idle', errorText: undefined })
            logger.debug(
              'Extension slot is free (connected:',
              data.connected,
              'activeTargets:',
              data.activeTargets,
              '), cleared error state',
            )
          } else {
            logger.debug('Extension slot still taken (activeTargets:', data.activeTargets, '), will retry...')
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
        this.preserveTabsOnDetach = false
      } catch (error: any) {
        logger.debug('Connection attempt failed:', error.message)
        // Check if rejected because another extension is actively in use
        if (error.message === 'Extension Already In Use') {
          store.setState({
            connectionState: 'extension-replaced',
            errorText: 'Another Playwriter extension is actively in use',
          })
        } else {
          store.setState({ connectionState: 'idle' })
        }
      }

      await sleep(3000)
    }
  }
}

export const connectionManager = new ConnectionManager()

export const store = createStore<ExtensionState>(() => ({
  tabs: new Map(),
  connectionState: 'idle',
  currentTabId: undefined,
  errorText: undefined,
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

const MAX_LOG_STRING_LENGTH = 2000

function truncateLogString(value: string): string {
  if (value.length <= MAX_LOG_STRING_LENGTH) {
    return value
  }
  return `${value.slice(0, MAX_LOG_STRING_LENGTH)}…[truncated ${value.length - MAX_LOG_STRING_LENGTH} chars]`
}

function safeSerialize(arg: any): string {
  if (arg === undefined) return 'undefined'
  if (arg === null) return 'null'
  if (typeof arg === 'function') return `[Function: ${arg.name || 'anonymous'}]`
  if (typeof arg === 'symbol') return String(arg)
  if (typeof arg === 'string') return truncateLogString(arg)
  if (arg instanceof Error) return truncateLogString(arg.stack || arg.message || String(arg))
  if (typeof arg === 'object') {
    try {
      const seen = new WeakSet()
      const serialized = JSON.stringify(arg, (key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) return '[Circular]'
          seen.add(value)
          if (value instanceof Map) return { dataType: 'Map', value: Array.from(value.entries()) }
          if (value instanceof Set) return { dataType: 'Set', value: Array.from(value.values()) }
        }
        return value
      })
      return truncateLogString(serialized)
    } catch {
      return truncateLogString(String(arg))
    }
  }
  return truncateLogString(String(arg))
}

function sendLog(level: string, args: any[]) {
  sendMessage({
    method: 'log',
    params: { level, args: args.map(safeSerialize) },
  })
}

export const logger = {
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
export function sendMessage(message: any): void {
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
  try {
    // Tabs in 'connected' or 'connecting' state belong in the group.
    // Including 'connecting' prevents a loop where syncTabGroup removes a tab the user
    // just dragged in (still connecting), which triggers onUpdated → disconnect → reconnect.
    const connectedTabIds = Array.from(store.getState().tabs.entries())
      .filter(([_, info]) => info.state === 'connected' || info.state === 'connecting')
      .map(([tabId]) => tabId)

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
        await chrome.tabs.ungroup(tabsToRemove)
        logger.debug('Removed tabs from group:', tabsToRemove)
      } catch (e: any) {
        logger.debug('Failed to ungroup tabs:', tabsToRemove, e.message)
      }
    }

    if (tabsToAdd.length > 0) {
      if (groupId === undefined) {
        const newGroupId = await chrome.tabs.group({ tabIds: tabsToAdd })
        await chrome.tabGroups.update(newGroupId, { title: 'playwriter', color: 'green' })
        logger.debug('Created tab group:', newGroupId, 'with tabs:', tabsToAdd)
      } else {
        await chrome.tabs.group({ tabIds: tabsToAdd, groupId })
        logger.debug('Added tabs to existing group:', tabsToAdd)
      }
    }
  } catch (error: any) {
    logger.debug('Failed to sync tab group:', error.message)
  }
}

export function getTabBySessionId(sessionId: string): { tabId: number; tab: TabInfo } | undefined {
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

function emitChildDetachesForTab(tabId: number): void {
  const childEntries = Array.from(childSessions.entries()).filter(([_, parentTab]) => parentTab.tabId === tabId)

  childEntries.forEach(([childSessionId, parentTab]) => {
    const childDetachParams: Protocol.Target.DetachedFromTargetEvent = parentTab.targetId
      ? { sessionId: childSessionId, targetId: parentTab.targetId }
      : { sessionId: childSessionId }
    sendMessage({
      method: 'forwardCDPEvent',
      params: {
        method: 'Target.detachedFromTarget',
        params: childDetachParams,
      },
    })
    logger.debug('Cleaning up child session:', childSessionId, 'for tab:', tabId)
    childSessions.delete(childSessionId)
  })
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
    const childSession = childSessions.get(msg.params.sessionId)
    if (childSession) {
      targetTabId = childSession.tabId
      targetTab = store.getState().tabs.get(childSession.tabId)
      logger.debug('Found parent tab for child session:', msg.params.sessionId, 'tabId:', childSession.tabId)
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

  // Root-level Target.setAutoAttach must apply to all connected tabs since
  // CDP auto-attach is per-debugger-session. Without this, OOPIF targets never attach.
  if (msg.params.method === 'Target.setAutoAttach' && !msg.params.sessionId) {
    const params = msg.params.params as Protocol.Target.SetAutoAttachRequest | undefined
    if (!params) {
      return {}
    }

    autoAttachParams = params
    const connectedTabIds = Array.from(store.getState().tabs.entries())
      .filter(([_, info]) => info.state === 'connected')
      .map(([tabId]) => tabId)

    await Promise.all(
      connectedTabIds.map(async (tabId) => {
        try {
          await chrome.debugger.sendCommand({ tabId }, 'Target.setAutoAttach', params)
        } catch (error) {
          logger.debug('Failed to set auto-attach for tab:', tabId, error)
        }
      }),
    )

    return {}
  }

  // TODO disable network things?
  // if (msg.params.method === 'Network.enable' && msg.params.source !== 'playwriter') {
  //   logger.debug('Skipping Network.enable from non-playwriter CDP client:', msg.params.sessionId)
  //   return {}
  // }

  switch (msg.params.method) {
    case 'Runtime.enable': {
      if (!debuggee) {
        throw new Error(`No debuggee found for Runtime.enable (sessionId: ${msg.params.sessionId})`)
      }
      // Keep Runtime.enable bound to the incoming child sessionId for OOPIF iframes.
      // If we send Runtime.enable on the tab root session, child iframe targets never
      // emit Runtime.executionContextCreated and frame locators can hang.
      const runtimeSession: chrome.debugger.DebuggerSession = {
        ...debuggee,
        sessionId: msg.params.sessionId !== targetTab?.sessionId ? msg.params.sessionId : undefined,
      }
      // When multiple Playwright clients connect to the same tab, each calls Runtime.enable.
      // If Runtime is already enabled, the enable call succeeds but Chrome doesn't re-send
      // Runtime.executionContextCreated events - those were already sent to the first client.
      // By disabling first, we force Chrome to re-send all execution context events when we
      // re-enable, ensuring the new client receives them. The relay server waits for the
      // executionContextCreated events before returning. See cdp-timing.md for details.
      try {
        await chrome.debugger.sendCommand(runtimeSession, 'Runtime.disable')
        await sleep(50)
      } catch (e) {
        logger.debug('Error disabling Runtime (ignoring):', e)
      }
      return await chrome.debugger.sendCommand(runtimeSession, 'Runtime.enable', msg.params.params)
    }

    case 'Target.createTarget': {
      const url = msg.params.params?.url || 'about:blank'
      logger.debug('Creating new tab with URL:', url)
      const tab = await chrome.tabs.create({ url, active: false })
      if (!tab.id) throw new Error('Failed to create tab')
      setTabConnecting(tab.id)
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
    const targetId = params.targetInfo?.targetId as string | undefined
    childSessions.set(params.sessionId, { tabId: source.tabId!, targetId })
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
      emitChildDetachesForTab(mainTab.tabId)
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

  if (connectionManager.preserveTabsOnDetach) {
    logger.debug('Ignoring debugger detach during relay reconnect:', tabId, reason)
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

  emitChildDetachesForTab(tabId)

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

async function attachTab(
  tabId: number,
  { skipAttachedEvent = false }: { skipAttachedEvent?: boolean } = {},
): Promise<AttachTabResult> {
  const debuggee = { tabId }
  let debuggerAttached = false

  try {
    logger.debug('Attaching debugger to tab:', tabId)
    await chrome.debugger.attach(debuggee, '1.3')
    debuggerAttached = true
    logger.debug('Debugger attached successfully to tab:', tabId)

    await chrome.debugger.sendCommand(debuggee, 'Page.enable')

    // Reapply cached auto-attach for new tabs so OOPIF targets are reported immediately.
    if (autoAttachParams) {
      try {
        await chrome.debugger.sendCommand(debuggee, 'Target.setAutoAttach', autoAttachParams)
      } catch (error) {
        logger.debug('Failed to apply auto-attach for tab:', tabId, error)
      }
    }

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
      logger.error(
        'WARNING: Target.attachedToTarget will be sent with empty URL! tabId:',
        tabId,
        'targetInfo:',
        JSON.stringify(targetInfo),
      )
    }

    const attachOrder = nextSessionId
    const sessionId = `pw-tab-${tabSessionScope}-${nextSessionId++}`

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

    logger.debug(
      'Tab attached successfully:',
      tabId,
      'sessionId:',
      sessionId,
      'targetId:',
      targetInfo.targetId,
      'url:',
      targetInfo.url,
      'skipAttachedEvent:',
      skipAttachedEvent,
    )
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

  // Clean up any active recording for this tab
  cleanupRecordingForTab(tabId)

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

  emitChildDetachesForTab(tabId)

  if (shouldDetachDebugger) {
    chrome.debugger.detach({ tabId }).catch((err) => {
      logger.debug('Error detaching debugger from tab:', tabId, err.message)
    })
  }
}

async function connectTab(tabId: number): Promise<void> {
  try {
    logger.debug(`Starting connection to tab ${tabId}`)

    setTabConnecting(tabId)

    await connectionManager.ensureConnection()
    await attachTab(tabId)

    logger.debug(`Successfully connected to tab ${tabId}`)
  } catch (error: any) {
    logger.debug(`Failed to connect to tab ${tabId}:`, error)

    // Distinguish between WS connection errors and tab-specific errors
    // WS errors: keep in 'connecting' state, maintainLoop will retry when WS is available
    // Tab errors: show 'error' state (e.g., restricted page, debugger attach failed)
    // Extension in use: set global 'extension-replaced' state to enter polling mode
    const isExtensionInUse =
      error.message === 'Extension Already In Use' ||
      error.message === 'Another Playwriter extension is already connected'

    const isWsError =
      error.message === 'Server not available' ||
      error.message === 'Connection timeout' ||
      error.message.startsWith('WebSocket')

    if (isExtensionInUse) {
      logger.debug(`Another extension is in use, entering polling mode`)
      store.setState((state) => {
        const newTabs = new Map(state.tabs)
        newTabs.delete(tabId)
        return {
          tabs: newTabs,
          connectionState: 'extension-replaced',
          errorText: 'Another Playwriter extension is actively in use',
        }
      })
    } else if (isWsError) {
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

function setTabConnecting(tabId: number): void {
  store.setState((state) => {
    const newTabs = new Map(state.tabs)
    const existing = newTabs.get(tabId)
    newTabs.set(tabId, { ...existing, state: 'connecting' })
    return { tabs: newTabs }
  })
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

// Our extension IDs - allow attaching to our own extension pages for debugging
const OUR_EXTENSION_IDS = [
  'jfeammnjpkecdekppnclgkkffahnhfhe', // Production extension (Chrome Web Store)
  'pebbngnfojnignonigcnkdilknapkgid', // Dev extension (stable ID from manifest key)
]

// undefined URL is for about:blank pages (not restricted) and chrome:// URLs (restricted).
// We can't distinguish them without the `tabs` permission, so we just let attachment fail.
function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) return false

  // Allow our own extension pages, block all other extensions
  if (url.startsWith('chrome-extension://')) {
    const extensionId = url.replace('chrome-extension://', '').split('/')[0]
    return !OUR_EXTENSION_IDS.includes(extensionId)
  }

  const restrictedPrefixes = [
    'chrome://',
    'devtools://',
    'edge://',
    'https://chrome.google.com/',
    'https://chromewebstore.google.com/',
  ]
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
    title: 'Another Playwriter extension connected - Click to retry',
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

  // If another Playwriter extension took over, clear error state and try to reconnect this tab
  if (connectionState === 'extension-replaced') {
    logger.debug('Clearing extension-replaced state, attempting to reconnect')
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
    await connectTab(tab.id)
  }
}

resetDebugger()
connectionManager.maintainLoop()

chrome.contextMenus
  .remove('playwriter-pin-element')
  .catch(() => {})
  .finally(() => {
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
    void chrome.tabs.create({ url: 'src/welcome.html' })
  }
})

function serializeTabs(tabs: Map<number, TabInfo>): string {
  return JSON.stringify(Array.from(tabs.entries()))
}

store.subscribe((state, prevState) => {
  logger.log(state)
  void updateIcons()
  updateContextMenuVisibility()
  const tabsChanged = serializeTabs(state.tabs) !== serializeTabs(prevState.tabs)
  if (tabsChanged) {
    tabGroupQueue = tabGroupQueue.then(syncTabGroup).catch((e) => {
      logger.debug('syncTabGroup error:', e)
    })
  }
})

logger.debug(`Using relay host: ${RELAY_HOST}, port: ${RELAY_PORT}`)

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
      logger.error(
        `MEMORY CRITICAL: used=${formatMB(used)} total=${formatMB(total)} limit=${formatMB(limit)} growth=${formatMB(memoryDelta)} rate=${formatMB(growthRate)}/s`,
      )
    } else if (used > MEMORY_WARNING_THRESHOLD) {
      logger.warn(
        `MEMORY WARNING: used=${formatMB(used)} total=${formatMB(total)} limit=${formatMB(limit)} growth=${formatMB(memoryDelta)} rate=${formatMB(growthRate)}/s`,
      )
    } else if (memoryDelta > MEMORY_GROWTH_THRESHOLD && timeDelta < 60000) {
      logger.warn(
        `MEMORY SPIKE: grew ${formatMB(memoryDelta)} in ${(timeDelta / 1000).toFixed(1)}s (used=${formatMB(used)})`,
      )
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
    tabGroupQueue = tabGroupQueue
      .then(async () => {
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
      })
      .catch((e) => {
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

// Handle messages from offscreen document (recording chunks)
chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
  if (message.action === 'recordingChunk') {
    const { tabId, data, final } = message

    if (connectionManager.ws?.readyState === WebSocket.OPEN) {
      // Send metadata message first
      sendMessage({
        method: 'recordingData',
        params: { tabId, final },
      })

      // Then send binary data if not final
      if (data && !final) {
        const buffer = new Uint8Array(data)
        connectionManager.ws.send(buffer)
      }
    } else {
      // Buffer chunks when WebSocket isn't ready - they'll be flushed when it opens.
      // This prevents data loss during brief disconnections or slow WebSocket startup.
      logger.debug(`Buffering recording chunk for tab ${tabId} (WebSocket not ready)`)
      recordingChunkBuffer.push({ tabId, data, final })
    }

    return false // Sync response, no need to keep channel open
  }

  if (message.action === 'recordingCancelled') {
    const { tabId } = message

    getActiveRecordings().delete(tabId)
    store.setState((state) => {
      const newTabs = new Map(state.tabs)
      const existing = newTabs.get(tabId)
      if (existing) {
        newTabs.set(tabId, { ...existing, isRecording: false })
      }
      return { tabs: newTabs }
    })

    if (connectionManager.ws?.readyState === WebSocket.OPEN) {
      sendMessage({
        method: 'recordingCancelled',
        params: { tabId },
      })
    }

    return false
  }

  return false
})
