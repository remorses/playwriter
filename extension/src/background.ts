import { createStore } from 'zustand/vanilla'
import type { ExtensionState, ConnectionState, TabState, TabInfo } from './types'
import type { CDPEvent, Protocol } from 'playwriter/src/cdp-types'
import type { ExtensionCommandMessage, ExtensionResponseMessage } from 'playwriter/src/extension/protocol'

const RELAY_URL = 'ws://localhost:19988/extension'

let ws: WebSocket | null = null
let childSessions: Map<string, number> = new Map()
let nextSessionId = 1

const store = createStore<ExtensionState>(() => ({
  tabs: new Map(),
  connectionState: 'disconnected',
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

function sendMessage(message: any): void {
  if (ws?.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(message))
    } catch (error: any) {
      console.debug('ERROR sending message:', error, 'message type:', message.method || 'response')
    }
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
      try {
        await chrome.debugger.sendCommand(debuggee, 'Runtime.disable')
        await new Promise((resolve) => setTimeout(resolve, 200))
      } catch (e) {
        logger.debug('Error disabling Runtime (ignoring):', e)
      }
      return await chrome.debugger.sendCommand(debuggee, 'Runtime.enable', msg.params.params)
    }

    case 'Target.createTarget': {
      const url = msg.params.params?.url || 'about:blank'
      logger.debug('Creating new tab with URL:', url)
      const tab = await chrome.tabs.create({ url, active: false })
      if (!tab.id) throw new Error('Failed to create tab')
      logger.debug('Created tab:', tab.id, 'waiting for it to load...')
      await new Promise((resolve) => setTimeout(resolve, 100))
      const targetInfo = await attachTab(tab.id)
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
    logger.debug('Child target detached:', params.sessionId)
    childSessions.delete(params.sessionId)
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

  logger.debug(`Manual debugger detachment detected for tab ${tabId}: ${reason}`)

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
    store.setState({ connectionState: 'disconnected' })
  }
}

async function attachTab(tabId: number): Promise<Protocol.Target.TargetInfo> {
  const debuggee = { tabId }

  logger.debug('Attaching debugger to tab:', tabId)
  await chrome.debugger.attach(debuggee, '1.3')
  logger.debug('Debugger attached successfully to tab:', tabId)

  const result = (await chrome.debugger.sendCommand(
    debuggee,
    'Target.getTargetInfo',
  )) as Protocol.Target.GetTargetInfoResponse

  const targetInfo = result.targetInfo
  const sessionId = `pw-tab-${nextSessionId++}`

  store.setState((state) => {
    const newTabs = new Map(state.tabs)
    newTabs.set(tabId, {
      sessionId,
      targetId: targetInfo.targetId,
      state: 'connected',
    })
    return { tabs: newTabs, connectionState: 'connected' }
  })

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

  logger.debug('Tab attached successfully:', tabId, 'sessionId:', sessionId, 'targetId:', targetInfo.targetId)
  return targetInfo
}

function detachTab(tabId: number, shouldDetachDebugger: boolean): void {
  const tab = store.getState().tabs.get(tabId)
  if (!tab) {
    logger.debug('detachTab: tab not found in map:', tabId)
    return
  }

  logger.debug('Detaching tab:', tabId, 'sessionId:', tab.sessionId, 'shouldDetach:', shouldDetachDebugger)

  sendMessage({
    method: 'forwardCDPEvent',
    params: {
      method: 'Target.detachedFromTarget',
      params: { sessionId: tab.sessionId, targetId: tab.targetId },
    },
  })

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

function closeConnection(reason: string): void {
  logger.debug('Closing connection, reason:', reason)

  chrome.debugger.onEvent.removeListener(onDebuggerEvent)
  chrome.debugger.onDetach.removeListener(onDebuggerDetach)

  for (const [tabId] of store.getState().tabs) {
    chrome.debugger.detach({ tabId }).catch((err) => {
      logger.debug('Error detaching from tab:', tabId, err.message)
    })
  }

  store.setState({ tabs: new Map() })
  childSessions.clear()

  if (ws) {
    ws.close(1000, reason)
    ws = null
  }
}

function handleConnectionClose(reason: string, code: number): void {
  logger.debug('Connection closed:', { reason, code })

  chrome.debugger.onEvent.removeListener(onDebuggerEvent)
  chrome.debugger.onDetach.removeListener(onDebuggerDetach)

  const { tabs } = store.getState()

  for (const [tabId] of tabs) {
    chrome.debugger.detach({ tabId }).catch((err) => {
      logger.debug('Error detaching from tab:', tabId, err.message)
    })
  }

  childSessions.clear()
  ws = null

  if (reason === 'Extension Replaced' || code === 4001) {
    logger.debug('Connection replaced by another extension instance')
    store.setState({
      connectionState: 'error',
      errorText: 'Disconnected: Replaced by another extension',
    })
    return
  }

  store.setState({ connectionState: 'disconnected' })

  if (tabs.size > 0) {
    logger.debug('Tabs still connected, triggering reconnection')
    void reconnect()
  }
}

async function ensureConnection(): Promise<void> {
  if (ws?.readyState === WebSocket.OPEN) {
    logger.debug('Connection already exists, reusing')
    return
  }

  logger.debug('Waiting for server at http://localhost:19988...')
  store.setState({ connectionState: 'reconnecting' })

  while (true) {
    try {
      await fetch('http://localhost:19988', { method: 'HEAD' })
      logger.debug('Server is available')
      break
    } catch {
      logger.debug('Server not available, retrying in 1 second...')
      await new Promise((resolve) => setTimeout(resolve, 1000))
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
      if (timeoutFired) return
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

  ws = socket

  ws.onmessage = async (event: MessageEvent) => {
    let message: ExtensionCommandMessage
    try {
      message = JSON.parse(event.data)
    } catch (error: any) {
      logger.debug('Error parsing message:', error)
      sendMessage({ error: { code: -32700, message: `Error parsing message: ${error.message}` } })
      return
    }

    const response: ExtensionResponseMessage = { id: message.id }
    try {
      response.result = await handleCommand(message)
    } catch (error: any) {
      logger.debug('Error handling command:', error)
      response.error = error.message
    }
    logger.debug('Sending response:', response)
    sendMessage(response)
  }

  ws.onclose = (event: CloseEvent) => {
    handleConnectionClose(event.reason, event.code)
  }

  ws.onerror = (event: Event) => {
    logger.debug('WebSocket error:', event)
  }

  chrome.debugger.onEvent.addListener(onDebuggerEvent)
  chrome.debugger.onDetach.addListener(onDebuggerDetach)

  logger.debug('Connection established')
}

async function connectTab(tabId: number): Promise<void> {
  try {
    logger.debug(`Starting connection to tab ${tabId}`)

    store.setState((state) => {
      const newTabs = new Map(state.tabs)
      newTabs.set(tabId, { state: 'connecting' })
      return { tabs: newTabs }
    })

    await ensureConnection()
    await attachTab(tabId)

    logger.debug(`Successfully connected to tab ${tabId}`)
  } catch (error: any) {
    logger.debug(`Failed to connect to tab ${tabId}:`, error)

    store.setState((state) => {
      const newTabs = new Map(state.tabs)
      newTabs.set(tabId, { state: 'error', errorText: `Error: ${error.message}` })
      const nextConnectionState = state.connectionState === 'reconnecting' ? 'disconnected' : state.connectionState
      return { tabs: newTabs, connectionState: nextConnectionState }
    })
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

  const { tabs: updatedTabs } = store.getState()
  if (updatedTabs.size === 0 && ws) {
    logger.debug('No tabs remaining, closing connection')
    closeConnection('All tabs disconnected')
    store.setState({ connectionState: 'disconnected' })
  }
}

async function reconnect(): Promise<void> {
  logger.debug('Starting reconnection')
  const { tabs } = store.getState()
  const tabsToReconnect = Array.from(tabs.keys())
  logger.debug('Tabs to reconnect:', tabsToReconnect)

  try {
    await ensureConnection()

    for (const tabId of tabsToReconnect) {
      if (!store.getState().tabs.has(tabId)) {
        logger.debug('Tab', tabId, 'was manually disconnected during reconnection, skipping')
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

    const { tabs: finalTabs } = store.getState()
    if (finalTabs.size > 0) {
      store.setState({ connectionState: 'connected' })
    } else {
      store.setState({ connectionState: 'disconnected' })
    }
  } catch (error: any) {
    logger.debug('Reconnection failed:', error)
    store.setState({
      tabs: new Map(),
      connectionState: 'error',
      errorText: 'Reconnection failed - Click to retry',
    })
  }
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
      if (tabInfo?.state === 'connecting' || state.connectionState === 'reconnecting') {
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
  const { tabs } = store.getState()

  for (const tabId of tabs.keys()) {
    await disconnectTab(tabId)
  }

  if (ws) {
    closeConnection('Manual full disconnect')
    store.setState({
      connectionState: 'disconnected',
      tabs: new Map(),
      errorText: undefined,
    })
  }
}

async function resetDebugger(): Promise<void> {
  let targets = await chrome.debugger.getTargets()
  targets = targets.filter((x) => x.tabId && x.attached)
  logger.log(`found ${targets.length} existing debugger targets. detaching them before background script starts`)
  for (const target of targets) {
    await chrome.debugger.detach({ tabId: target.tabId })
  }
}

const icons = {
  connected: {
    path: {
      '16': '/icons/icon-16.png',
      '32': '/icons/icon-32.png',
      '48': '/icons/icon-48.png',
      '128': '/icons/icon-128.png',
    },
    title: 'Connected - Click to disconnect',
    badgeText: '',
    badgeColor: undefined,
  },
  connecting: {
    path: {
      '16': '/icons/icon-gray-16.png',
      '32': '/icons/icon-gray-32.png',
      '48': '/icons/icon-gray-48.png',
      '128': '/icons/icon-gray-128.png',
    },
    title: 'Connecting...',
    badgeText: '...',
    badgeColor: '#FF9800',
  },
  disconnected: {
    path: {
      '16': '/icons/icon-gray-16.png',
      '32': '/icons/icon-gray-32.png',
      '48': '/icons/icon-gray-48.png',
      '128': '/icons/icon-gray-48.png',
    },
    title: 'Click to attach debugger',
    badgeText: '',
    badgeColor: undefined,
  },
  error: {
    path: {
      '16': '/icons/icon-gray-16.png',
      '32': '/icons/icon-gray-32.png',
      '48': '/icons/icon-gray-48.png',
      '128': '/icons/icon-gray-48.png',
    },
    title: 'Error',
    badgeText: '!',
    badgeColor: '#f44336',
  },
} as const

async function updateIcons(): Promise<void> {
  const state = store.getState()
  const { connectionState, tabs, errorText } = state

  const allTabs = await chrome.tabs.query({})
  const allTabIds = [undefined, ...allTabs.map((tab) => tab.id).filter((id): id is number => id !== undefined)]

  for (const tabId of allTabIds) {
    const tabInfo = tabId !== undefined ? tabs.get(tabId) : undefined

    const iconConfig = (() => {
      if (connectionState === 'error') return icons.error
      if (connectionState === 'reconnecting') return icons.connecting
      if (tabInfo?.state === 'error') return icons.error
      if (tabInfo?.state === 'connecting') return icons.connecting
      if (tabInfo?.state === 'connected') return icons.connected
      return icons.disconnected
    })()

    const title = (() => {
      if (connectionState === 'error' && errorText) return errorText
      if (tabInfo?.errorText) return tabInfo.errorText
      return iconConfig.title
    })()

    void chrome.action.setIcon({ tabId, path: iconConfig.path })
    void chrome.action.setTitle({ tabId, title })
    if (iconConfig.badgeColor) void chrome.action.setBadgeBackgroundColor({ tabId, color: iconConfig.badgeColor })
    void chrome.action.setBadgeText({ tabId, text: iconConfig.badgeText })
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

  const { tabs, connectionState } = store.getState()
  const tabInfo = tabs.get(tab.id)

  if (connectionState === 'error') {
    logger.debug('Global error state - retrying reconnection')
    await reconnect()
    return
  }

  if (connectionState === 'reconnecting') {
    logger.debug('User clicked during reconnection, canceling and disconnecting all tabs')
    for (const tabId of tabs.keys()) {
      detachTab(tabId, true)
    }
    store.setState({ connectionState: 'disconnected', tabs: new Map(), errorText: undefined })
    if (ws) {
      ws.close(1000, 'User cancelled reconnection')
      ws = null
    }
    return
  }

  if (tabInfo?.state === 'error') {
    logger.debug('Tab has error - disconnecting to clear state')
    await disconnectTab(tab.id)
    return
  }

  if (tabInfo?.state === 'connected') {
    await disconnectTab(tab.id)
  } else {
    await connectTab(tab.id)
  }
}

resetDebugger()

chrome.runtime.onInstalled.addListener((details) => {
  if (import.meta.env.TESTING) return
  if (details.reason === 'install') {
    void chrome.tabs.create({ url: 'welcome.html' })
  }
})

store.subscribe(async () => {
  logger.log(store.getState())
  await updateIcons()
})

logger.debug(`Using relay URL: ${RELAY_URL}`)
chrome.tabs.onRemoved.addListener(onTabRemoved)
chrome.tabs.onActivated.addListener(onTabActivated)
chrome.action.onClicked.addListener(onActionClicked)
chrome.tabs.onUpdated.addListener(() => {
  void updateIcons()
})
