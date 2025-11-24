import { RelayConnection, logger } from './relayConnection'
import { createStore } from 'zustand/vanilla'

// Relay URL - fixed port for MCP bridge
const RELAY_URL = 'ws://localhost:19988/extension'

type ConnectionState = 'disconnected' | 'reconnecting' | 'connected' | 'error'
type TabState = 'connecting' | 'connected' | 'error'

interface TabInfo {
  targetId: string
  state: TabState
  errorText?: string
}

interface ExtensionState {
  connection: RelayConnection | undefined
  connectedTabs: Map<number, TabInfo>
  connectionState: ConnectionState
  currentTabId: number | undefined
  errorText: string | undefined
}

const useExtensionStore = createStore<ExtensionState>((set) => ({
  connection: undefined,
  connectedTabs: new Map(),
  connectionState: 'disconnected',
  currentTabId: undefined,
  errorText: undefined,
}))

// @ts-ignore
globalThis.toggleExtensionForActiveTab = toggleExtensionForActiveTab

async function toggleExtensionForActiveTab(): Promise<{ isConnected: boolean; state: ExtensionState }> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  const tab = tabs[0]
  if (!tab?.id) throw new Error('No active tab found')

  await onActionClicked(tab)

  // Wait for state to settle
  await new Promise<void>((resolve) => {
    const check = () => {
      const state = useExtensionStore.getState()
      const tabInfo = state.connectedTabs.get(tab.id!)

      // If we are connecting, wait
      if (tabInfo?.state === 'connecting') {
        setTimeout(check, 100)
        return
      }

      // Also wait if global connection is reconnecting
      if (state.connectionState === 'reconnecting') {
        setTimeout(check, 100)
        return
      }

      resolve()
    }
    check()
  })

  const state = useExtensionStore.getState()
  const isConnected = state.connectedTabs.has(tab.id) && state.connectedTabs.get(tab.id)?.state === 'connected'

  return { isConnected, state }
}

// @ts-ignore
globalThis.disconnectEverything = disconnectEverything

async function disconnectEverything() {
  const { connectedTabs, connection } = useExtensionStore.getState()

  // Disconnect all tabs
  for (const tabId of connectedTabs.keys()) {
    await disconnectTab(tabId)
  }

  // Force close connection if it still exists
  const state = useExtensionStore.getState()
  if (state.connection) {
    state.connection.close('Manual full disconnect')
    useExtensionStore.setState({
      connection: undefined,
      connectionState: 'disconnected',
      connectedTabs: new Map(),
      errorText: undefined,
    })
  }
}

// @ts-ignore
globalThis.getExtensionState = () => useExtensionStore.getState()

declare global {
  var state: typeof useExtensionStore
  var toggleExtensionForActiveTab: () => Promise<{ isConnected: boolean; state: ExtensionState }>
  var getExtensionState: () => ExtensionState
  var disconnectEverything: () => Promise<void>
}

async function resetDebugger() {
  let targets = await chrome.debugger.getTargets()
  targets = targets.filter((x) => x.tabId && x.attached)
  logger.log(`found ${targets.length} existing debugger targets. detaching them before background script starts`)
  logger.log(targets)
  for (const target of targets) {
    await chrome.debugger.detach({ tabId: target.tabId })
  }
}
resetDebugger()

chrome.runtime.onInstalled.addListener((details) => {
  if (import.meta.env.TESTING) {
    return
  }
  if (details.reason === 'install') {
    void chrome.tabs.create({ url: 'welcome.html' })
  }
})

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

async function updateIcons() {
  const state = useExtensionStore.getState()
  const { connectionState, connectedTabs, errorText } = state

  const tabs = await chrome.tabs.query({})
  const allTabIds = [undefined, ...tabs.map((tab) => tab.id).filter((id): id is number => id !== undefined)]

  for (const tabId of allTabIds) {
    const tabInfo = tabId !== undefined ? connectedTabs.get(tabId) : undefined

    const iconConfig = (() => {
      if (connectionState === 'error') {
        return icons.error
      }
      if (connectionState === 'reconnecting') {
        return icons.connecting
      }
      if (tabInfo?.state === 'error') {
        return icons.error
      }
      if (tabInfo?.state === 'connecting') {
        return icons.connecting
      }
      if (tabInfo?.state === 'connected') {
        return icons.connected
      }
      return icons.disconnected
    })()

    const title = (() => {
      if (connectionState === 'error' && errorText) {
        return errorText
      }
      if (tabInfo?.errorText) {
        return tabInfo.errorText
      }
      return iconConfig.title
    })()

    void chrome.action.setIcon({ tabId, path: iconConfig.path })
    void chrome.action.setTitle({ tabId, title })
    if (iconConfig.badgeColor) void chrome.action.setBadgeBackgroundColor({ tabId, color: iconConfig.badgeColor })
    void chrome.action.setBadgeText({ tabId, text: iconConfig.badgeText })
  }
}

useExtensionStore.subscribe(async (state, prevState) => {
  logger.log(state)
  await updateIcons()
})

async function ensureConnection(): Promise<void> {
  const { connection } = useExtensionStore.getState()
  if (connection) {
    logger.debug('Connection already exists, reusing')
    return
  }

  logger.debug('No existing connection, creating new relay connection')
  logger.debug('Waiting for server at http://localhost:19988...')

  useExtensionStore.setState({ connectionState: 'reconnecting' })
  while (true) {
    try {
      await fetch('http://localhost:19988', { method: 'HEAD' })
      logger.debug('Server is available')
      break
    } catch (error: any) {
      logger.debug('Server not available, retrying in 1 second...')
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  logger.debug('Server is ready, creating WebSocket connection to:', RELAY_URL)
  const socket = new WebSocket(RELAY_URL)
  logger.debug(
    'WebSocket created, initial readyState:',
    socket.readyState,
    '(0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED)',
  )

  await new Promise<void>((resolve, reject) => {
    let timeoutFired = false
    const timeout = setTimeout(() => {
      timeoutFired = true
      logger.debug('=== WebSocket connection TIMEOUT after 5 seconds ===')
      logger.debug('Final WebSocket readyState:', socket.readyState)
      logger.debug('WebSocket URL:', socket.url)
      logger.debug('Socket protocol:', socket.protocol)
      reject(new Error('Connection timeout'))
    }, 5000)

    socket.onopen = () => {
      if (timeoutFired) {
        logger.debug('WebSocket opened but timeout already fired!')
        return
      }
      logger.debug('WebSocket onopen fired! readyState:', socket.readyState)
      clearTimeout(timeout)
      resolve()
    }

    socket.onerror = (error) => {
      logger.debug('WebSocket onerror during connection:', error)
      logger.debug('Error type:', error.type)
      logger.debug('Current readyState:', socket.readyState)
      if (!timeoutFired) {
        clearTimeout(timeout)
        reject(new Error('WebSocket connection failed'))
      }
    }

    socket.onclose = (event) => {
      logger.debug('WebSocket onclose during connection setup:', {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
        readyState: socket.readyState,
      })
      if (!timeoutFired) {
        clearTimeout(timeout)
        reject(new Error(`WebSocket closed: ${event.reason || event.code}`))
      }
    }

    logger.debug('Event handlers set, waiting for connection...')
  })

  logger.debug('WebSocket connected successfully, creating RelayConnection instance')
  const newConnection = new RelayConnection({
    ws: socket,
    onClose: (reason, code) => {
      logger.debug('=== Relay connection onClose callback triggered ===', { reason, code })
      const { connectedTabs } = useExtensionStore.getState()
      logger.debug('Connected tabs before potential reconnection:', Array.from(connectedTabs.keys()))

      if (reason === 'Extension Replaced' || code === 4001) {
        logger.debug('Connection replaced by another extension instance. Not reconnecting.')
        useExtensionStore.setState({
          connection: undefined,
          connectionState: 'error',
          errorText: 'Disconnected: Replaced by another extension',
        })
        return
      }

      useExtensionStore.setState({ connection: undefined, connectionState: 'disconnected' })

      if (connectedTabs.size > 0) {
        logger.debug('Tabs still connected, triggering reconnection')
        void reconnect()
      } else {
        logger.debug('No tabs to reconnect')
      }
    },
    onTabDetached: (tabId, reason) => {
      logger.debug('=== Manual tab detachment detected for tab:', tabId, '===')
      logger.debug('User closed debugger via Chrome automation bar')

      useExtensionStore.setState((state) => {
        const newTabs = new Map(state.connectedTabs)
        newTabs.delete(tabId)
        return { connectedTabs: newTabs }
      })
      if (reason === chrome.debugger.DetachReason.CANCELED_BY_USER) {
        // if user cancels debugger. disconnect everything
        useExtensionStore.setState({ connectionState: 'disconnected' })
      }
      logger.debug('Removed tab from _connectedTabs map')
    },
    onTabAttached: (tabId, targetId) => {
      // logger.debug('=== Tab attached callback for tab:', tabId, '===')
      useExtensionStore.setState((state) => {
        const newTabs = new Map(state.connectedTabs)
        newTabs.set(tabId, {
          targetId,
          state: 'connected',
        })
        return { connectedTabs: newTabs, connectionState: 'connected' }
      })
    },
  })

  useExtensionStore.setState({ connection: newConnection })
  logger.debug('Connection established, WebSocket open (caller should set connectionState)')
}

async function connectTab(tabId: number): Promise<void> {
  try {
    logger.debug(`=== Starting connection to tab ${tabId} ===`)

    useExtensionStore.setState((state) => {
      const newTabs = new Map(state.connectedTabs)
      newTabs.set(tabId, {
        targetId: '',
        state: 'connecting',
      })
      return { connectedTabs: newTabs }
    })

    await ensureConnection()

    logger.debug('Calling attachTab for tab:', tabId)
    const { connection } = useExtensionStore.getState()
    if (!connection) return
    const targetInfo = await connection.attachTab(tabId)
    logger.debug('attachTab completed, updating targetId in connectedTabs map')
    useExtensionStore.setState((state) => {
      const newTabs = new Map(state.connectedTabs)
      newTabs.set(tabId, {
        targetId: targetInfo?.targetId,
        state: 'connected',
      })
      return { connectedTabs: newTabs, connectionState: 'connected' }
    })

    logger.debug(`=== Successfully connected to tab ${tabId} ===`)
  } catch (error: any) {
    logger.debug(`=== Failed to connect to tab ${tabId} ===`)
    logger.debug('Error details:', error)
    logger.debug('Error stack:', error.stack)

    useExtensionStore.setState((state) => {
      const newTabs = new Map(state.connectedTabs)
      newTabs.set(tabId, {
        targetId: '',
        state: 'error',
        errorText: `Error: ${error.message}`,
      })

      // If we were trying to establish a connection and failed, reset the global state
      // so we don't get stuck in 'reconnecting' which triggers destructive click behavior
      let nextConnectionState = state.connectionState
      if (state.connectionState === 'reconnecting') {
        nextConnectionState = 'disconnected'
      }

      return { connectedTabs: newTabs, connectionState: nextConnectionState }
    })
  }
}

async function disconnectTab(tabId: number): Promise<void> {
  logger.debug(`=== Disconnecting tab ${tabId} ===`)

  const { connectedTabs, connection } = useExtensionStore.getState()
  if (!connectedTabs.has(tabId)) {
    logger.debug('Tab not in connectedTabs map, ignoring disconnect')
    return
  }

  logger.debug('Calling detachTab on connection')
  connection?.detachTab(tabId)
  useExtensionStore.setState((state) => {
    const newTabs = new Map(state.connectedTabs)
    newTabs.delete(tabId)
    return { connectedTabs: newTabs }
  })
  logger.debug('Tab removed from connectedTabs map')

  const { connectedTabs: updatedTabs, connection: updatedConnection } = useExtensionStore.getState()
  logger.debug('Connected tabs remaining:', updatedTabs.size)
  if (updatedTabs.size === 0 && updatedConnection) {
    logger.debug('No tabs remaining, closing relay connection')
    updatedConnection.close('All tabs disconnected')
    useExtensionStore.setState({ connection: undefined, connectionState: 'disconnected' })
  }
}

async function reconnect(): Promise<void> {
  logger.debug('=== Starting reconnection ===')
  const { connectedTabs } = useExtensionStore.getState()
  logger.debug('Tabs to reconnect:', Array.from(connectedTabs.keys()))

  try {
    await ensureConnection()

    const tabsToReconnect = Array.from(connectedTabs.keys())
    logger.debug('Re-attaching', tabsToReconnect.length, 'tabs')

    for (const tabId of tabsToReconnect) {
      const { connectedTabs: currentTabs } = useExtensionStore.getState()
      if (!currentTabs.has(tabId)) {
        logger.debug('Tab', tabId, 'was manually disconnected during reconnection, skipping')
        continue
      }

      try {
        logger.debug('Checking if tab', tabId, 'still exists')
        await chrome.tabs.get(tabId)

        logger.debug('Re-attaching tab:', tabId)
        const { connection } = useExtensionStore.getState()
        if (!connection) return
        const targetInfo = await connection.attachTab(tabId)
        useExtensionStore.setState((state) => {
          const newTabs = new Map(state.connectedTabs)
          newTabs.set(tabId, {
            targetId: targetInfo.targetId,
            state: 'connected',
          })
          return { connectedTabs: newTabs }
        })
        logger.debug('Successfully re-attached tab:', tabId)
      } catch (error: any) {
        logger.debug('Failed to re-attach tab:', tabId, error.message)
        useExtensionStore.setState((state) => {
          const newTabs = new Map(state.connectedTabs)
          newTabs.delete(tabId)
          return { connectedTabs: newTabs }
        })
      }
    }

    const { connectedTabs: finalTabs } = useExtensionStore.getState()
    logger.debug('=== Reconnection complete ===')
    logger.debug('Successfully reconnected tabs:', finalTabs.size)

    if (finalTabs.size > 0) {
      useExtensionStore.setState({ connectionState: 'connected' })
      logger.debug('Set connectionState to connected')
    } else {
      logger.debug('No tabs successfully reconnected, staying in reconnecting state')
      useExtensionStore.setState({ connectionState: 'disconnected' })
    }
  } catch (error: any) {
    logger.debug('=== Reconnection failed ===', error)

    useExtensionStore.setState({
      connectedTabs: new Map(),
      connectionState: 'error',
      errorText: 'Reconnection failed - Click to retry',
    })
  }
}

async function onTabRemoved(tabId: number): Promise<void> {
  const { connectedTabs } = useExtensionStore.getState()
  logger.debug('Tab removed event for tab:', tabId, 'is connected:', connectedTabs.has(tabId))
  if (!connectedTabs.has(tabId)) return

  logger.debug(`Connected tab ${tabId} was closed, disconnecting`)
  await disconnectTab(tabId)
}

async function onTabActivated(activeInfo: chrome.tabs.TabActiveInfo): Promise<void> {
  logger.debug('Tab activated:', activeInfo.tabId)
  useExtensionStore.setState({ currentTabId: activeInfo.tabId })
}

async function onActionClicked(tab: chrome.tabs.Tab): Promise<void> {
  if (!tab.id) {
    logger.debug('No tab ID available')
    return
  }

  const { connectedTabs, connectionState, connection } = useExtensionStore.getState()
  const tabInfo = connectedTabs.get(tab.id)

  if (connectionState === 'error') {
    logger.debug('Global error state - retrying reconnection')
    await reconnect()
    return
  }

  if (connectionState === 'reconnecting') {
    logger.debug('User clicked during reconnection, canceling and disconnecting all tabs')

    const tabsToDisconnect = Array.from(connectedTabs.keys())

    for (const tabId of tabsToDisconnect) {
      connection?.detachTab(tabId)
    }

    useExtensionStore.setState({ connectionState: 'disconnected', connectedTabs: new Map(), errorText: undefined })

    if (connection) {
      connection.close('User cancelled reconnection')
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

logger.debug(`Using relay URL: ${RELAY_URL}`)
chrome.tabs.onRemoved.addListener(onTabRemoved)
chrome.tabs.onActivated.addListener(onTabActivated)
chrome.action.onClicked.addListener(onActionClicked)
chrome.tabs.onUpdated.addListener(() => {
  void updateIcons()
})
