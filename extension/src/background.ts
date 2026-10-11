declare const process: { env: { PLAYWRITER_PORT: string } }
// Injected by vite at build time from playwriter/package.json version.
// CLI/MCP compare this against their own version to warn when the extension is outdated.
declare const __PLAYWRITER_VERSION__: string
// Bundled automation builds should not burn a tab on the welcome page, especially
// in headless/VPS flows where the extension is installed only to attach to the relay.
declare const __PLAYWRITER_OPEN_WELCOME_PAGE__: boolean

import dedent from 'string-dedent'
const js = dedent
import { createStore } from 'zustand/vanilla'
import type { ExtensionState, ConnectionState, TabState, TabInfo } from './types'
import { initPlaywriterToolbar } from './toolbar/toolbar'
import type { CDPEvent, Protocol } from 'playwriter/src/cdp-types'
import type { CloseTabsForKeyResult, ExtensionCommandMessage, ExtensionResponseMessage } from 'playwriter/src/protocol'
import {
  DEFAULT_TAB_GROUP_TITLE,
  EXTENSION_INVENTORY_FAILED_CLOSE,
  EXTENSION_INVENTORY_TIMEOUT_CLOSE,
  INVENTORY_READY_CAPABILITY,
  colorForTabGroupTitle,
  normalizeTabGroupColor,
  computeTabGroupSyncPlan,
  normalizeTabGroupTitle,
  shouldDisconnectAfterTabGroupChange,
  shouldUpdateTabGroupForTab,
  type CreateInitialTabParams,
  type UpdateTabGroupResult,
} from 'playwriter/src/protocol'
import { handleGhostBrowserCommand, type GhostBrowserCommandParams } from 'playwriter/src/ghost-browser'
import { RemoteTunnel } from './remote-tunnel'
import {
  REMOTE_TUNNEL_BASE_DOMAIN,
  buildRemoteHelloMessage,
  buildRemoteControlPrompt,
  generateTunnelId,
  getRemoteCdpCommandRejection,
  getRemoteExtensionMethodRejection,
  namespaceRemoteTabGroupKey,
} from 'playwriter/src/remote-control'
// Inlined at build time via vite ?raw. Source: playwriter/src/ghost-cursor-client.ts
import ghostCursorBundleCode from '../../playwriter/dist/ghost-cursor-client.js?raw'
// Bippy: React fiber introspection library, used for "Copy React Source Path" context menu.
// Built by playwriter/scripts/build-client-bundles.ts, exposes globalThis.__bippy
import bippyBundleCode from '../../playwriter/dist/bippy.js?raw'
import {
  getActiveRecordings,
  handleStartRecording,
  handleStopRecording,
  handleIsRecording,
  handleCancelRecording,
  cleanupRecordingForTab,
  ensureOffscreenDocument,
} from './recording'
import type { OffscreenCopyTextResult } from './offscreen-types'

function isTruthy<T>(value: T): value is NonNullable<T> {
  return Boolean(value)
}

const RELAY_HOST = '127.0.0.1'
const RELAY_PORT = Number(process.env.PLAYWRITER_PORT) || 19988

// CDP commands that should return near-instantly on a healthy tab. If a tab is
// frozen/hibernated (e.g. Ghost Browser suspended tabs), chrome.debugger.sendCommand
// hangs forever. These commands get a 10s timeout so frozen tabs fail fast instead of
// blocking the entire Playwright connection setup for 30s per command.
// CDP commands that should return near-instantly on a healthy tab. If a tab is
// frozen/hibernated (e.g. Ghost Browser suspended tabs), chrome.debugger.sendCommand
// hangs forever. These commands get a 10s timeout so frozen tabs fail fast instead of
// blocking the entire Playwright connection setup for 30s per command.
// Note: Page.addScriptToEvaluateOnNewDocument is NOT included because user-provided
// scripts with runImmediately:true can legitimately take longer than 10s.
const FAST_CDP_COMMAND_TIMEOUT_MS = new Map<string, number>([
  ['Browser.getWindowForTarget', 10000],
  ['Page.enable', 10000],
  ['Page.getFrameTree', 10000],
  ['Page.setLifecycleEventsEnabled', 10000],
  ['Page.createIsolatedWorld', 10000],
  ['Page.setDownloadBehavior', 10000],
  ['Log.enable', 10000],
  ['Network.enable', 10000],
  ['Emulation.setFocusEmulationEnabled', 10000],
  ['Emulation.setEmulatedMedia', 10000],
  ['Runtime.runIfWaitingForDebugger', 10000],
  ['Target.setAutoAttach', 10000],
])

async function sendCommandWithTimeout(
  debuggee: chrome.debugger.DebuggerSession,
  method: string,
  params: object | undefined,
  timeout: number,
): Promise<unknown> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      chrome.debugger.sendCommand(debuggee, method, params),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`CDP command timed out after ${timeout}ms: ${method} (tab may be frozen/hibernated)`))
        }, timeout)
      }),
    ])
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

// Resolve to `fallback` if `promise` does not settle within `timeoutMs`, or rejects.
// Chrome 153 can leave chrome.storage / chrome.identity / navigator.userAgentData calls
// pending forever during profile startup; identity must never block the relay connect.
// The late result of the original promise is intentionally ignored. See issue #40.
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false
    const timeoutId = setTimeout(() => {
      if (settled) return
      settled = true
      resolve(fallback)
    }, timeoutMs)
    promise.then(
      (value) => {
        if (settled) return
        settled = true
        clearTimeout(timeoutId)
        resolve(value)
      },
      () => {
        if (settled) return
        settled = true
        clearTimeout(timeoutId)
        resolve(fallback)
      },
    )
  })
}

type NavigatorWithUaData = Navigator & {
  userAgentData?: {
    brands: Array<{ brand: string; version: string }>
    getHighEntropyValues?: (hints: string[]) => Promise<{
      fullVersionList?: Array<{ brand: string; version: string }>
    }>
  }
}

type ExtensionIdentity = {
  browser: string
  email: string
  id: string
  installId: string
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createInstallId(): string {
  const values = new Uint32Array(2)
  crypto.getRandomValues(values)
  return Array.from(values)
    .map((value) => {
      return value.toString(36)
    })
    .join('')
}

function browserNameFromBrands(brands: Array<{ brand: string; version: string }>): string | null {
  const brandNames = brands.map((brand) => {
    return brand.brand.trim().toLowerCase()
  })

  if (brandNames.some((brand) => brand === 'brave')) return 'Brave'
  if (brandNames.some((brand) => brand === 'microsoft edge')) return 'Edge'
  if (brandNames.some((brand) => brand === 'opera')) return 'Opera'
  if (brandNames.some((brand) => brand === 'vivaldi')) return 'Vivaldi'
  if (brandNames.some((brand) => brand === 'google chrome canary')) return 'Chrome Canary'
  if (brandNames.some((brand) => brand === 'google chrome')) return 'Chrome'
  if (brandNames.some((brand) => brand === 'chromium')) return 'Chromium'
  return null
}

async function detectBrowserName(): Promise<string> {
  if ((chrome as { ghostPublicAPI?: unknown }).ghostPublicAPI) {
    return 'Ghost'
  }

  const navigatorWithUaData = navigator as NavigatorWithUaData
  const brands = navigatorWithUaData.userAgentData?.brands
  const highEntropyPromise = navigatorWithUaData.userAgentData?.getHighEntropyValues?.(['fullVersionList'])
  // Keep the high-entropy lookup (it distinguishes Brave/Edge for the stable identity key),
  // but bound it so a hung call cannot stall the relay connection.
  const highEntropyValues = highEntropyPromise
    ? await withTimeout(highEntropyPromise, 2000, null)
    : null
  const fullVersionList = highEntropyValues?.fullVersionList || []

  const highEntropyName = browserNameFromBrands(fullVersionList)
  if (highEntropyName) {
    return highEntropyName
  }

  if (brands && brands.length > 0) {
    const lowEntropyName = browserNameFromBrands(brands)
    if (lowEntropyName) {
      return lowEntropyName
    }
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
let installIdPromise: Promise<string> | null = null
const tabSessionScope = (() => {
  const values = new Uint32Array(2)
  crypto.getRandomValues(values)
  return Array.from(values)
    .map((value) => {
      return value.toString(36)
    })
    .join('')
})()

async function getInstallId(): Promise<string> {
  if (installIdPromise) {
    return installIdPromise
  }

  installIdPromise = (async () => {
    const existing = await chrome.storage.local.get('playwriterInstallId')
    const storedInstallId = typeof existing.playwriterInstallId === 'string' ? existing.playwriterInstallId : ''
    if (storedInstallId) {
      return storedInstallId
    }

    const installId = createInstallId()
    await chrome.storage.local.set({ playwriterInstallId: installId })
    return installId
  })().catch((error) => {
    installIdPromise = null
    throw error
  })

  return installIdPromise
}

async function getExtensionIdentity(): Promise<ExtensionIdentity> {
  if (identityPromise) {
    return identityPromise
  }

  identityPromise = (async () => {
    const browser = await detectBrowserName()
    // Storage can be unavailable or hang during startup. Fall back to the per-worker
    // runtime scope so we still avoid the coarse browser-only key that causes
    // cross-browser relay takeovers, and never block the connection on storage.
    const installId = await withTimeout(getInstallId(), 2000, tabSessionScope)
    const info = await withTimeout(
      chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' }),
      2000,
      { email: '', id: '' } as chrome.identity.ProfileUserInfo,
    )
    return {
      browser,
      email: info.email || '',
      id: info.id || '',
      installId,
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

const MAX_RECORDING_SOCKET_BUFFERED_BYTES = 16 * 1024 * 1024

// ============================================================================
// Remote control: share the browser with a remote agent through a playwriter.dev
// tunnel. One tunnel per browser. A tunneled relay gets the same access as the
// local relay: every attached tab, plus new tabs it opens (in the background, in
// its session tab group). Only whole-profile cookie/cache commands are denied.
//
// Lifecycle:
// - Share starts from the toolbar of a connected tab: the anchor tab.
// - Stop sharing (any tab's toolbar), closing or disconnecting the anchor tab, or
//   cancelling Chrome's debugger infobar closes the tunnel and every tunneled
//   connection immediately.
// - On stop, tabs attached because of the remote (created by it, or opened as
//   target=_blank children while sharing) are detached and left open.
//
// Runtime objects (WebSockets) live here; only the evidence needed to rebuild the
// tunnel after a service-worker restart is persisted in chrome.storage.session
// as {anchorTabId, tunnelId, remoteTabIds}. The link survives SW restarts but dies
// with the browser session (storage.session is cleared on browser exit).
// ============================================================================

type RemoteTunnelRuntime = {
  tunnel: RemoteTunnel
  tunnelId: string
  anchorTabId: number
  /** Tabs attached because of the remote. Detached (left open) on stop. */
  remoteTabIds: Set<number>
  status: string
}
let remoteTunnel: RemoteTunnelRuntime | null = null

/**
 * A message sink for relay-bound responses: the local relay, or a tunneled relay
 * bound to the runtime that accepted it (so work can check it was not revoked).
 */
type RelayMessageSink = { send(message: any): void; remoteRuntime?: RemoteTunnelRuntime }
/** Active relay connections arriving through the tunnel, keyed by tunnelId:connId. */
const remoteRelayConnections = new Map<string, { send(message: any): void }>()

// No relay consumes the tabs anymore: drop debuggers so a later reconnect re-attaches fresh.
function detachAllTabDebuggers(): void {
  for (const tabId of store.getState().tabs.keys()) {
    chrome.debugger.detach({ tabId }).catch((err) => {
      logger.debug('Error detaching from tab:', tabId, err.message)
    })
  }
  childSessions.clear()
}

function markAllTabsConnecting(tabs: Map<number, TabInfo>): Map<number, TabInfo> {
  return new Map(
    Array.from(tabs.entries()).map(([tabId, tab]) => {
      return [tabId, { ...tab, state: 'connecting' as const }]
    }),
  )
}

export function sendRecordingCancellation(tabId: number): void {
  const ws = connectionManager.ws
  if (ws?.readyState !== WebSocket.OPEN) {
    return
  }
  ws.send(
    JSON.stringify({
      method: 'recordingCancelled',
      params: { tabId },
    }),
  )
}

function cancelRecordingTransport({ tabId, error }: { tabId: number; error: string }): void {
  logger.error(`Cancelling recording transport for tab ${tabId}: ${error}`)
  sendRecordingCancellation(tabId)
  void chrome.runtime.sendMessage({ action: 'cancelRecording', tabId }).catch(() => {})
}

function sendRecordingChunk({
  tabId,
  data,
  final,
}: {
  tabId: number
  data?: Uint8Array
  final?: boolean
}): { success: boolean; error?: string } {
  const ws = connectionManager.ws
  if (ws?.readyState !== WebSocket.OPEN) {
    const error = 'Relay is not connected'
    cancelRecordingTransport({ tabId, error })
    return { success: false, error }
  }
  const wireBytes = (data?.byteLength || 0) + 256
  if (ws.bufferedAmount + wireBytes > MAX_RECORDING_SOCKET_BUFFERED_BYTES) {
    const error = 'Recording socket buffer exceeded its memory limit'
    cancelRecordingTransport({ tabId, error })
    return { success: false, error }
  }
  ws.send(
    JSON.stringify({
      method: 'recordingData',
      params: { tabId, final },
    }),
  )
  if (data && !final) {
    ws.send(data)
  }
  return { success: true }
}

function decodeRecordingChunk(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

class ConnectionManager {
  ws: WebSocket | null = null
  private connectionPromise: Promise<void> | null = null
  // Monotonic id bumped on every connect(). The global timeout in ensureConnection()
  // does NOT cancel a losing connect(), so a stale socket's late onopen could otherwise
  // clobber `this.ws` of a newer attempt. Every socket callback checks this id and goes
  // inert if it belongs to a superseded attempt. Fixes the connect/disconnect loop (#40).
  private currentAttemptId = 0
  preserveTabsOnDetach = false

  async ensureConnection(): Promise<void> {
    // Reuse in-progress connection attempt - prevents races between user clicks and maintain loop
    if (this.connectionPromise) {
      return this.connectionPromise
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      return
    }

    if (store.getState().connectionState === 'extension-replaced') {
      throw new Error('Another Playwriter extension is already connected')
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
    const attemptId = ++this.currentAttemptId
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
    if (identity.installId) {
      relayUrl.searchParams.set('installId', identity.installId)
    }
    if (typeof __PLAYWRITER_VERSION__ !== 'undefined') {
      relayUrl.searchParams.set('v', __PLAYWRITER_VERSION__)
    }
    relayUrl.searchParams.set('capabilities', INVENTORY_READY_CAPABILITY)
    logger.debug('Creating WebSocket connection to:', relayUrl)
    const socket = new WebSocket(relayUrl.toString())

    await new Promise<void>((resolve, reject) => {
      let settled = false
      let handshakeTimeout: ReturnType<typeof setTimeout> | null = null
      const openTimeout = setTimeout(() => {
        if (settled) return
        settled = true
        logger.debug('WebSocket connection TIMEOUT after 5 seconds')
        try {
          socket.close()
        } catch {}
        reject(new Error('Connection timeout'))
      }, 5000)

      const rejectConnection = (error: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(openTimeout)
        if (handshakeTimeout) {
          clearTimeout(handshakeTimeout)
        }
        reject(error)
      }

      socket.onmessage = async (event: MessageEvent) => {
        let message: any
        try {
          message = JSON.parse(event.data)
        } catch (error: any) {
          logger.debug('Error parsing message:', error)
          sendToLocalRelay({ error: { code: -32700, message: `Error parsing message: ${error.message}` } })
          return
        }
        await dispatchRelayMessage(message, localRelaySink)
      }

      socket.onerror = (event: Event) => {
        logger.debug('WebSocket error:', event)
        rejectConnection(new Error('WebSocket connection failed'))
      }

      socket.onclose = (event: CloseEvent) => {
        logger.debug('WebSocket closed:', { code: event.code, reason: event.reason })
        const error =
          event.code === 4002 || event.reason === 'Extension Already In Use'
            ? new Error('Extension Already In Use')
            : new Error(`WebSocket closed: ${event.reason || event.code}`)
        rejectConnection(error)
        if (this.ws === socket && attemptId === this.currentAttemptId) {
          this.handleClose(event.reason, event.code)
        }
      }

      socket.onopen = () => {
        if (settled) return
        // A superseded attempt (its global timeout already fired and a newer connect()
        // started) must not install its socket as the live connection. Close and go inert.
        if (attemptId !== this.currentAttemptId) {
          try {
            socket.close()
          } catch {}
          return
        }
        clearTimeout(openTimeout)
        this.ws = socket
        handshakeTimeout = setTimeout(() => {
          socket.close(EXTENSION_INVENTORY_TIMEOUT_CLOSE, 'Target inventory timeout')
          rejectConnection(new Error('Target inventory timeout'))
        }, 15_000)
        void completeLocalRelayHandshake(socket).then(
          () => {
            if (settled) return
            if (attemptId !== this.currentAttemptId) {
              try {
                socket.close()
              } catch {}
              return
            }
            settled = true
            logger.debug('WebSocket connected')
            if (handshakeTimeout) {
              clearTimeout(handshakeTimeout)
            }
            resolve()
          },
          (error) => {
            socket.close(EXTENSION_INVENTORY_FAILED_CLOSE, 'Target inventory failed')
            rejectConnection(new Error('Could not announce extension target inventory', { cause: error }))
          },
        )
      }
    })

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

    const isExtensionReplaced = reason === 'Extension Replaced' || code === 4001
    const isExtensionInUse = reason === 'Extension Already In Use' || code === 4002
    this.preserveTabsOnDetach = !(isExtensionReplaced || isExtensionInUse)

    // With Remote control on, the tunnel still consumes every attached tab:
    // remote agents keep driving them without any local playwriter.
    const keepTabsForRemote = remoteTunnel !== null
    if (!keepTabsForRemote) {
      detachAllTabDebuggers()
    }
    this.ws = null

    // Only one extension can connect to the relay server at a time.
    // Code 4001: Another extension replaced this one (this extension was idle)
    // Code 4002: This extension tried to connect but another is actively in use
    if (isExtensionReplaced || isExtensionInUse) {
      const errorText = isExtensionReplaced
        ? 'Another Playwriter extension took over the connection'
        : 'Another Playwriter extension is actively in use'
      logger.debug(
        isExtensionReplaced
          ? 'Disconnected: another Playwriter extension connected (this one was idle)'
          : 'Rejected: another Playwriter extension is actively in use',
      )
      store.setState((state) => {
        return {
          tabs: keepTabsForRemote ? state.tabs : new Map(),
          connectionState: 'extension-replaced' as ConnectionState,
          errorText,
        }
      })
      return
    }

    // For normal disconnects, set tabs to 'connecting' state and let maintain loop handle reconnect
    startReconnectGrace()
    store.setState((state) => {
      return {
        tabs: keepTabsForRemote ? state.tabs : markAllTabsConnecting(state.tabs),
        connectionState: 'idle',
        errorText: undefined,
      }
    })
  }

  async maintainLoop(): Promise<void> {
    while (true) {
      if (this.ws?.readyState === WebSocket.OPEN) {
        await sleep(1000)
        continue
      }

      // When another Playwriter extension took over, poll until no same-key replacement is
      // connected anymore. Reclaiming while another worker is merely idle is racy: a fresh
      // replacement reports activeTargets=0 before it re-attaches tabs, so the old worker can
      // steal the slot back and disconnect the live browser instance.
      if (store.getState().connectionState === 'extension-replaced') {
        try {
          const response = await fetch(`http://${RELAY_HOST}:${RELAY_PORT}/extension/status`, {
            method: 'GET',
            signal: AbortSignal.timeout(2000),
          })
          const data = (await response.json()) as { connected: boolean; activeTargets: number }
          const slotAvailable = !data.connected
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
      // This handles edge cases where handleClose wasn't called or state got out of sync.
      // With Remote control on, tabs stay 'connected': the tunnel consumes them.
      const hasConnectedTabs = Array.from(store.getState().tabs.values()).some((t) => t.state === 'connected')
      if (hasConnectedTabs && remoteTunnel === null) {
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
  preferredWindowId: undefined,
  errorText: undefined,
}))

// @ts-ignore
globalThis.toggleExtensionForActiveTab = toggleExtensionForActiveTab
// @ts-ignore
globalThis.disconnectEverything = disconnectEverything
// @ts-ignore
globalThis.getExtensionState = () => store.getState()
// @ts-ignore
globalThis.startRemoteControlForActiveTab = startRemoteControlForActiveTab
// @ts-ignore
globalThis.stopRemoteControl = stopRemoteControl
// @ts-ignore
globalThis.getRemoteControlState = getRemoteControlState

declare global {
  var toggleExtensionForActiveTab: () => Promise<{ isConnected: boolean; state: ExtensionState }>
  var getExtensionState: () => ExtensionState
  var disconnectEverything: () => Promise<void>
  var startRemoteControlForActiveTab: () => Promise<{ url: string }>
  var stopRemoteControl: () => boolean
  var getRemoteControlState: () => {
    anchorTabId: number
    url: string
    status: string
    remoteTabIds: number[]
  } | null
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
function sendToLocalRelay(message: any): void {
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

const localRelaySink: RelayMessageSink = { send: sendToLocalRelay }

function resolveTabGroupKey({ key, remote }: { key: string | undefined; remote: boolean }): string | undefined {
  if (!key) {
    return undefined
  }
  return remote ? namespaceRemoteTabGroupKey(key) : key
}

// Fan CDP events out to tunneled relay connections. Responses never travel here:
// they go through the sink of the connection that issued the command. Logs and
// recording data stay local only.
function broadcastEventToRemoteRelays(message: any): void {
  if (message?.method !== 'forwardCDPEvent') {
    return
  }
  for (const conn of remoteRelayConnections.values()) {
    conn.send(message)
  }
}

export function sendMessage(message: any): void {
  sendToLocalRelay(message)
  broadcastEventToRemoteRelays(message)
}

// Handles one relay-bound protocol message from either the local relay WS or a
// tunneled remote relay connection. Responses go back through the originating
// sink so message ids from different relays never collide.
async function dispatchRelayMessage(message: any, sink: RelayMessageSink): Promise<void> {
  // Handle ping from server - respond with pong to keep service worker alive
  if (message.method === 'ping') {
    sink.send({ method: 'pong' })
    return
  }

  if (message.method === 'forwardCDPCommand' && message.params?.method === 'Page.screencastFrameAck') {
    // Frames are ACKed once in onDebuggerEvent; duplicate ACKs make Chromium's in-flight counter negative.
    if (message.id !== undefined) {
      sink.send({ id: message.id, result: {} })
    }
    return
  }

  // Relay notifies us when action recording starts/stops — update toolbar in all connected tabs
  if (message.method === 'setRecorderState') {
    const recording = !!(message.params as { recording?: boolean })?.recording
    setRecorderStateInAllTabs(recording)
    return
  }

  // Tunneled relays cannot use recording or Ghost Browser APIs.
  if (sink.remoteRuntime) {
    const rejection = getRemoteExtensionMethodRejection(message.method)
    if (rejection) {
      if (message.id !== undefined) {
        sink.send({ id: message.id, error: rejection })
      }
      return
    }
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
      const initialTabParams = message.params as CreateInitialTabParams | undefined
      const groupTitle = normalizeTabGroupTitle(initialTabParams?.tabGroup) || undefined
      const groupKey = resolveTabGroupKey({ key: initialTabParams?.tabGroupKey, remote: Boolean(sink.remoteRuntime) })
      const groupColor = normalizeTabGroupColor(initialTabParams?.tabGroupColor) || undefined
      logger.debug('Creating initial tab for Playwright client, group:', groupTitle || DEFAULT_TAB_GROUP_TITLE)
      const tab = await createTabInPreferredWindow({ url: 'about:blank', active: false })
      if (tab.id) {
        const tabId = tab.id
        setTabConnecting(tabId, { groupTitle, groupKey, groupColor })
        const attach = () => {
          return attachTab(tabId, { skipAttachedEvent: true })
        }
        const { targetInfo, sessionId } = sink.remoteRuntime
          ? await attachForRemote({ runtime: sink.remoteRuntime, tabId, attach })
          : await attach()
        logger.debug('Initial tab created and connected:', tab.id, 'sessionId:', sessionId)
        sink.send({
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
      sink.send({ id: message.id, error: error.message })
    }
    return
  }

  // Close the tabs a session owns (groupKey === key): tabs it created and their popups.
  // Toggled tabs and other sessions' tabs have another key or none, so they stay open.
  if (message.method === 'closeTabsForKey') {
    const params = message.params as { key?: string } | undefined
    const key = resolveTabGroupKey({ key: params?.key, remote: Boolean(sink.remoteRuntime) })
    if (!key) {
      sink.send({ id: message.id, error: 'closeTabsForKey requires a key' })
      return
    }
    const tabIds = [...store.getState().tabs]
      .filter(([, info]) => info.groupKey === key)
      .map(([tabId]) => tabId)
    // One call per tab: chrome.tabs.remove([...]) stops at the first id that fails, e.g. a tab
    // the user closed meanwhile, and would leave the remaining tabs open.
    void Promise.allSettled(tabIds.map((tabId) => chrome.tabs.remove(tabId))).then((results) => {
      const errors = results
        .flatMap((r) => (r.status === 'rejected' ? [String(r.reason?.message ?? r.reason)] : []))
        .filter((error) => !error.startsWith('No tab with id'))
      if (errors.length > 0) {
        sink.send({ id: message.id, error: errors.join('; ') })
        return
      }
      const closedTabs = results.filter((r) => r.status === 'fulfilled').length
      sink.send({ id: message.id, result: { success: true, closedTabs } satisfies CloseTabsForKeyResult })
    })
    return
  }

  // Update a session's tab group (rename and/or recolor): rewrite the stored
  // groupTitle/groupColor on the tabs that should follow, update the physical
  // group when safe, and let syncTabGroup converge. Runs on the tabGroupQueue
  // to serialize with sync.
  //
  // Ownership rules (group titles are NOT identities):
  // - Keys from tunneled relays are namespaced (resolveTabGroupKey), so a remote
  //   session "1" never owns the tabs of local session "1".
  // - Renaming FROM the shared default group only moves tabs created by the
  //   requesting session (`key`), never manually toggled or other sessions' tabs.
  // - Renaming a custom group moves everything currently titled `from` (that is
  //   what "rename this group" means), including tabs the user dragged in.
  // - A color-only update (to === from) recolors the group in place, including
  //   the shared default group: an explicit color on any tab wins for the whole
  //   group at sync time.
  // - The physical update only happens for custom groups (never the shared
  //   default group — sync recolors it) and matches titles EXACTLY:
  //   chrome.tabGroups.query({title}) is a glob match, so a title like `*`
  //   would otherwise hit user groups.
  if (message.method === 'updateTabGroup') {
    tabGroupQueue = tabGroupQueue
      .then(async () => {
        try {
          const params = message.params as { from?: string; to?: string; key?: string; color?: string } | undefined
          const from = normalizeTabGroupTitle(params?.from)
          const to = normalizeTabGroupTitle(params?.to)
          const remote = Boolean(sink.remoteRuntime)
          const key = resolveTabGroupKey({ key: params?.key, remote })
          const color = normalizeTabGroupColor(params?.color) || undefined
          if (!from || !to) {
            sink.send({ id: message.id, error: 'updateTabGroup requires non-empty from/to titles' })
            return
          }

          const fromIsDefault = from === DEFAULT_TAB_GROUP_TITLE
          const isRename = to !== from
          let movedTabs = 0
          store.setState((state) => {
            const newTabs = new Map(state.tabs)
            for (const [tabId, info] of newTabs) {
              if (!shouldUpdateTabGroupForTab({
                currentTitle: info.groupTitle || DEFAULT_TAB_GROUP_TITLE,
                currentKey: info.groupKey,
                from,
                key,
                ownedOnly: remote,
              })) {
                continue
              }
              const changedTitle = isRename && info.groupTitle !== to
              const changedColor = color !== undefined && info.groupColor !== color
              if (!changedTitle && !changedColor) {
                continue
              }
              newTabs.set(tabId, {
                ...info,
                groupTitle: isRename ? to : info.groupTitle,
                groupColor: color ?? info.groupColor,
              })
              movedTabs++
            }
            return { tabs: newTabs }
          })

          // Update live custom groups directly so tabs move/recolor without an
          // ungroup/regroup flicker. syncTabGroup (triggered by the state
          // change above) then consolidates duplicates if a group named `to`
          // already existed. Default-group updates skip this: sync moves the
          // session's tabs out (rename) or recolors the group (color-only).
          // Remote updates skip it too: a physical group may hold local tabs.
          if (!fromIsDefault && !remote) {
            const managedTitles = await getManagedTabGroupTitles()
            if (managedTitles.has(from)) {
              const persisted = await loadManagedTabGroups()
              const ownedTabIds = new Set([...persisted.ownedTabIds, ...store.getState().tabs.keys()])
              // Preserve a previously chosen explicit color across a plain rename
              const explicitColor: chrome.tabGroups.ColorEnum | undefined =
                color ||
                Array.from(store.getState().tabs.values()).find((info) => {
                  return (info.groupTitle || DEFAULT_TAB_GROUP_TITLE) === to && info.groupColor
                })?.groupColor
              const allGroups = await chrome.tabGroups.query({})
              for (const group of allGroups) {
                if (group.title !== from) {
                  continue
                }
                // Never touch a group holding tabs playwriter doesn't own
                // (a user group the session joined via title collision). The
                // state rewrite above makes sync move our tabs into a fresh
                // group with the new name instead.
                const tabsInGroup = await chrome.tabs.query({ groupId: group.id })
                const hasForeignTabs = tabsInGroup.some((t) => t.id !== undefined && !ownedTabIds.has(t.id))
                if (hasForeignTabs) {
                  continue
                }
                await chrome.tabGroups.update(group.id, {
                  title: to,
                  color: explicitColor || colorForTabGroupTitle(to),
                })
              }
              // Track the renamed title so leftover cleanup still finds the group
              // even when no state change triggers a sync (e.g. relay was down).
              if (isRename) {
                persisted.titles.delete(from)
                persisted.titles.add(to)
                saveManagedTabGroups(persisted)
              }
            }
          }

          sink.send({ id: message.id, result: { success: true, movedTabs } satisfies UpdateTabGroupResult })
        } catch (error: any) {
          logger.error('Failed to update tab group:', error)
          sink.send({ id: message.id, error: error.message })
        }
      })
      .catch((e) => {
        logger.debug('updateTabGroup queue error:', e)
      })
    return
  }

  // Handle recording commands
  if (message.method === 'startRecording') {
    try {
      const result = await handleStartRecording(message.params)
      sink.send({ id: message.id, result })
    } catch (error: any) {
      logger.error('Failed to start recording:', error)
      sink.send({ id: message.id, result: { success: false, error: error.message } })
    }
    return
  }

  if (message.method === 'stopRecording') {
    try {
      const result = await handleStopRecording(message.params)
      sink.send({ id: message.id, result })
    } catch (error: any) {
      logger.error('Failed to stop recording:', error)
      sink.send({ id: message.id, result: { success: false, error: error.message } })
    }
    return
  }

  if (message.method === 'isRecording') {
    try {
      const result = await handleIsRecording(message.params)
      sink.send({ id: message.id, result })
    } catch (error: any) {
      logger.error('Failed to check recording status:', error)
      sink.send({ id: message.id, result: { isRecording: false } })
    }
    return
  }

  if (message.method === 'cancelRecording') {
    try {
      const result = await handleCancelRecording(message.params)
      sink.send({ id: message.id, result })
    } catch (error: any) {
      logger.error('Failed to cancel recording:', error)
      sink.send({ id: message.id, result: { success: false, error: error.message } })
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
    sink.send({ id: message.id, result })
    return
  }

  const response: ExtensionResponseMessage = { id: message.id }
  try {
    response.result = await handleCommand(message as ExtensionCommandMessage, { remoteRuntime: sink.remoteRuntime })
  } catch (error: any) {
    logger.debug('Error handling command:', error)
    response.error = error.message
  }
  sink.send(response)
}

async function getPreferredWindowId(): Promise<number | undefined> {
  const { preferredWindowId, currentTabId } = store.getState()
  if (preferredWindowId !== undefined) {
    try {
      await chrome.windows.get(preferredWindowId)
      return preferredWindowId
    } catch {
      store.setState({ preferredWindowId: undefined })
    }
  }

  if (currentTabId !== undefined) {
    try {
      const tab = await chrome.tabs.get(currentTabId)
      if (tab.windowId !== undefined) {
        return tab.windowId
      }
    } catch {}
  }

  try {
    const focusedWindow = await chrome.windows.getLastFocused({ populate: false })
    return focusedWindow.id
  } catch {
    return undefined
  }
}

async function createTabInPreferredWindow(options: { url: string; active: boolean }): Promise<chrome.tabs.Tab> {
  const windowId = await getPreferredWindowId()
  const createProperties: chrome.tabs.CreateProperties = {
    url: options.url,
    active: options.active,
    ...(windowId !== undefined ? { windowId } : {}),
  }

  try {
    return await chrome.tabs.create(createProperties)
  } catch (error) {
    logger.debug('Could not create tab in preferred window, falling back:', (error as Error).message)
    return await chrome.tabs.create({ url: options.url, active: options.active })
  }
}

// Managed tab groups persisted in storage.local (survives SW restarts). Needed
// for cleanup: when the last tab of a custom group disconnects (or the relay
// dies / the SW restarts), the tabs map no longer knows that title, but the
// group may still hold leftover tabs to ungroup. Also stores the tab ids
// playwriter grouped: ONLY those may ever be ungrouped, so a user group whose
// title collides with a session's group name never loses the user's own tabs.
// (Trade-off: after a full browser restart tab ids change, so restored leftover
// groups are not force-cleaned — safety over tidiness.)
// Overwritten on every sync with the currently active titles/tabs.
const MANAGED_TAB_GROUPS_STORAGE_KEY = 'playwriterManagedTabGroups'

type ManagedTabGroups = { titles: Set<string>; ownedTabIds: Set<number> }

async function loadManagedTabGroups(): Promise<ManagedTabGroups> {
  try {
    const stored = await chrome.storage.local.get(MANAGED_TAB_GROUPS_STORAGE_KEY)
    // storage returns any; runtime filters below guard against corrupt data
    const value: { titles?: string[]; tabIds?: number[] } | undefined = stored[MANAGED_TAB_GROUPS_STORAGE_KEY]
    const titles: string[] = Array.isArray(value?.titles) ? value.titles.filter((t) => typeof t === 'string') : []
    const tabIds: number[] = Array.isArray(value?.tabIds) ? value.tabIds.filter((t) => typeof t === 'number') : []
    return {
      titles: new Set<string>([DEFAULT_TAB_GROUP_TITLE, ...titles]),
      ownedTabIds: new Set<number>(tabIds),
    }
  } catch {
    return { titles: new Set([DEFAULT_TAB_GROUP_TITLE]), ownedTabIds: new Set() }
  }
}

let lastSavedManagedTabGroups = ''

function saveManagedTabGroups(value: ManagedTabGroups): void {
  const serialized = JSON.stringify({
    titles: Array.from(value.titles).sort(),
    tabIds: Array.from(value.ownedTabIds).sort((a, b) => a - b),
  })
  if (serialized === lastSavedManagedTabGroups) {
    return
  }
  lastSavedManagedTabGroups = serialized
  void chrome.storage.local.set({ [MANAGED_TAB_GROUPS_STORAGE_KEY]: JSON.parse(serialized) }).catch(() => {})
}

/** All titles playwriter currently manages: persisted set + titles on tracked tabs. */
async function getManagedTabGroupTitles(): Promise<Set<string>> {
  const { titles } = await loadManagedTabGroups()
  for (const info of store.getState().tabs.values()) {
    if (info.groupTitle) {
      titles.add(info.groupTitle)
    }
  }
  return titles
}

async function syncTabGroup(): Promise<void> {
  try {
    // Include 'connecting' tabs in groups only when the relay is alive, so that
    // tabs the user drags into a group stay visible while attaching. When the relay
    // is dead all tabs are 'connecting' (waiting for reconnect) and the groups should
    // be cleaned up. onUpdated re-reads the live tab groups so a stale ungroup event
    // after reconnect cannot detach tabs that are already back in a playwriter group.
    // During a short outage (relay drop, worker restart) keep 'connecting' tabs grouped
    // too: they are about to be re-attached (see startReconnectGrace).
    const { connectionState } = store.getState()
    const keepConnectingTabs = connectionState === 'connected' || inReconnectGrace()
    const desiredTabs = Array.from(store.getState().tabs.entries())
      .filter(([_, info]) => info.state === 'connected' || (info.state === 'connecting' && keepConnectingTabs))
      .map(([tabId, info]) => ({ tabId, title: info.groupTitle || DEFAULT_TAB_GROUP_TITLE }))

    const persisted = await loadManagedTabGroups()
    const managedTitles = new Set(persisted.titles)
    const ownedTabIds = new Set(persisted.ownedTabIds)
    // Explicit --tab-group-color wins over the title-hash color. Any tracked
    // tab carrying an explicit color sets it for its whole group.
    const colorByTitle = new Map<string, chrome.tabGroups.ColorEnum>()
    for (const [tabId, info] of store.getState().tabs) {
      ownedTabIds.add(tabId)
      if (info.groupTitle) {
        managedTitles.add(info.groupTitle)
      }
      if (info.groupColor) {
        colorByTitle.set(info.groupTitle || DEFAULT_TAB_GROUP_TITLE, info.groupColor)
      }
    }
    const resolveGroupColor = (title: string): chrome.tabGroups.ColorEnum => {
      return colorByTitle.get(title) || colorForTabGroupTitle(title)
    }

    // Always query by title - no cached IDs that can go stale. Only groups whose
    // title is managed are ever touched; user-created groups are left alone.
    const allGroups = await chrome.tabGroups.query({})
    const groups: Array<{ groupId: number; title: string; tabIds: number[] }> = []
    for (const group of allGroups) {
      if (!group.title || !managedTitles.has(group.title)) {
        continue
      }
      const tabsInGroup = await chrome.tabs.query({ groupId: group.id })
      groups.push({ groupId: group.id, title: group.title, tabIds: tabsInGroup.map((t) => t.id).filter(isTruthy) })
    }

    const plan = computeTabGroupSyncPlan({ desiredTabs, groups, ownedTabIds: Array.from(ownedTabIds) })

    // Groups holding tabs playwriter doesn't own are user groups the session
    // joined via title collision — never re-assert their title/color.
    const foreignGroupIds = new Set(
      groups
        .filter((group) => group.tabIds.some((tabId) => !ownedTabIds.has(tabId)))
        .map((group) => group.groupId),
    )

    // Group ops run BEFORE ungroups: ungrouping first can empty the keeper
    // group, Chrome deletes it, and the group op then fails on a dead id.
    for (const op of plan.groupOps) {
      const color = resolveGroupColor(op.title)
      try {
        if (op.groupId === undefined) {
          const newGroupId = await chrome.tabs.group({ tabIds: op.tabIds })
          await chrome.tabGroups.update(newGroupId, { title: op.title, color })
          logger.debug('Created tab group:', op.title, newGroupId, 'with tabs:', op.tabIds)
        } else {
          // chrome.tabs.group moves tabs out of their old group (and across
          // windows) automatically, so a group parked in a minimized or other
          // window receives new session tabs there.
          await chrome.tabs.group({ tabIds: op.tabIds, groupId: op.groupId })
          if (!foreignGroupIds.has(op.groupId)) {
            await chrome.tabGroups.update(op.groupId, { title: op.title, color })
          }
          logger.debug('Added tabs to group:', op.title, op.tabIds)
        }
      } catch (e: any) {
        logger.debug('Failed to group tabs:', op.title, op.tabIds, e.message)
      }
    }

    // Chrome can reset title/color on group collapse/expand or tab moves.
    for (const op of plan.updateOps) {
      if (foreignGroupIds.has(op.groupId)) {
        continue
      }
      try {
        await chrome.tabGroups.update(op.groupId, { title: op.title, color: resolveGroupColor(op.title) })
      } catch (e: any) {
        logger.debug('Failed to update tab group:', op.title, e.message)
      }
    }

    // Keep ownership of tabs whose ungroup failed so a later sync can retry.
    let failedUngroupIds: number[] = []
    if (plan.ungroupTabIds.length > 0) {
      try {
        await chrome.tabs.ungroup(plan.ungroupTabIds)
        logger.debug('Removed tabs from managed groups:', plan.ungroupTabIds)
      } catch (e: any) {
        failedUngroupIds = plan.ungroupTabIds
        logger.debug('Failed to ungroup tabs:', plan.ungroupTabIds, e.message)
      }
    }

    // Persist only titles/tabs that are still active; stale leftovers were
    // drained above (empty Chrome groups disappear on their own).
    saveManagedTabGroups({
      titles: new Set([DEFAULT_TAB_GROUP_TITLE, ...desiredTabs.map((t) => t.title)]),
      ownedTabIds: new Set([...desiredTabs.map((t) => t.tabId), ...failedUngroupIds]),
    })
  } catch (error: any) {
    logger.debug('Failed to sync tab group:', error.message)
  }
}

// --- Tab recovery -----------------------------------------------------------
// Chrome can drop the debugger from a tab that stays open (target_closed on some
// navigations, a tab replaced on prerender activation) and terminates the MV3
// service worker, which loses the in-memory tabs map. Agents were then told their
// page closed, abandoned tabs that were still open and opened duplicates. The
// relay/executor re-bind a returning tab by targetId; these helpers make sure the
// tab actually comes back.

/** storage.session survives service worker restarts but not browser restarts,
 *  which matches tab id lifetime: Chrome reuses tab ids after a browser restart. */
const ATTACHED_TABS_SESSION_KEY = 'playwriterAttachedTabs'

type PersistedTab = {
  tabId: number
  groupTitle?: string
  groupKey?: string
  groupColor?: chrome.tabGroups.ColorEnum
}

let lastPersistedTabs = ''

function persistAttachedTabs(tabs: Map<number, TabInfo>): void {
  const persisted: PersistedTab[] = Array.from(tabs.entries())
    .filter(([tabId, info]) => {
      const isLive = info.state === 'connected' || info.state === 'connecting'
      // Remote-control tabs are restored by restoreRemoteTunnelAfterRestart
      return isLive && !remoteTunnel?.remoteTabIds.has(tabId) && remoteTunnel?.anchorTabId !== tabId
    })
    .map(([tabId, info]) => {
      return { tabId, groupTitle: info.groupTitle, groupKey: info.groupKey, groupColor: info.groupColor }
    })
  const serialized = JSON.stringify(persisted)
  if (serialized === lastPersistedTabs) {
    return
  }
  lastPersistedTabs = serialized
  void chrome.storage.session.set({ [ATTACHED_TABS_SESSION_KEY]: persisted }).catch((error: Error) => {
    logger.debug('Failed to persist attached tabs:', error.message)
  })
}

async function loadPersistedAttachedTabs(): Promise<PersistedTab[]> {
  const stored = await chrome.storage.session.get(ATTACHED_TABS_SESSION_KEY).catch(() => {
    return {} as Record<string, unknown>
  })
  const value = stored[ATTACHED_TABS_SESSION_KEY]
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item): item is PersistedTab => {
    return typeof item?.tabId === 'number'
  })
}

/** Keep 'connecting' tabs in their groups this long after the relay drops or the
 *  worker restarts. Ungrouping them during a short outage churned the groups, and
 *  an ungrouped tab counts as one the user dragged out. */
const RECONNECT_GROUP_GRACE_MS = 60_000
let reconnectGraceStartedAt = 0

function startReconnectGrace(): void {
  reconnectGraceStartedAt = Date.now()
  // Clean up groups of tabs that never came back once the grace period ends
  setTimeout(() => {
    tabGroupQueue = tabGroupQueue.then(syncTabGroup).catch((e) => {
      logger.debug('post-grace syncTabGroup error:', e)
    })
  }, RECONNECT_GROUP_GRACE_MS + 1000)
}

function inReconnectGrace(): boolean {
  return Date.now() - reconnectGraceStartedAt < RECONNECT_GROUP_GRACE_MS
}

/** Tabs that lost the debugger while still open, re-attached once they reach a
 *  debuggable page (e.g. after navigating away from a chrome:// page). */
const PENDING_REATTACH_TTL_MS = 10 * 60_000
const pendingReattach = new Map<number, PersistedTab & { until: number }>()
/** Recently detached tab info, for chrome.tabs.onReplaced which can fire after the detach. */
const recentlyDetachedTabs = new Map<number, { info: TabInfo; at: number }>()
/** Cap automatic re-attaches so a page that keeps dropping the debugger can't loop. */
const MAX_REATTACHES_PER_MINUTE = 3
const reattachHistory = new Map<number, number[]>()

function takeReattachBudget(tabId: number): boolean {
  const now = Date.now()
  const recent = (reattachHistory.get(tabId) || []).filter((at) => {
    return now - at < 60_000
  })
  if (recent.length >= MAX_REATTACHES_PER_MINUTE) {
    reattachHistory.set(tabId, recent)
    return false
  }
  reattachHistory.set(tabId, [...recent, now])
  return true
}

function groupOptionsOf(info: Pick<TabInfo, 'groupTitle' | 'groupKey' | 'groupColor'>) {
  return { groupTitle: info.groupTitle, groupKey: info.groupKey, groupColor: info.groupColor }
}

async function recoverDetachedTab(tabId: number, info: TabInfo): Promise<void> {
  // target_closed also fires just before a tab closes: let onRemoved run first
  await sleep(300)
  const chromeTab = await chrome.tabs.get(tabId).catch(() => {
    return undefined
  })
  if (!chromeTab || store.getState().tabs.has(tabId)) {
    return
  }
  const waitForNextPage = () => {
    logger.debug('Will re-attach tab once it reaches a debuggable page:', tabId)
    pendingReattach.set(tabId, { tabId, ...groupOptionsOf(info), until: Date.now() + PENDING_REATTACH_TTL_MS })
  }
  // pendingUrl: the tab may be mid-navigation to a page extensions can't debug
  const url = chromeTab.pendingUrl || chromeTab.url
  if (isRestrictedUrl(url) || !takeReattachBudget(tabId)) {
    waitForNextPage()
    return
  }
  logger.warn(`RECOVER: re-attaching tab ${tabId} after an unexpected debugger detach`)
  await connectTab(tabId, groupOptionsOf(info))
  // Attaching can still fail mid-navigation: retry on the next page load instead of
  // leaving the tab in the error state
  if (store.getState().tabs.get(tabId)?.state === 'error') {
    store.setState((state) => {
      const newTabs = new Map(state.tabs)
      newTabs.delete(tabId)
      return { tabs: newTabs }
    })
    waitForNextPage()
  }
}

function reattachPendingTabIfReady(tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab): void {
  const pending = pendingReattach.get(tabId)
  if (!pending || changeInfo.status !== 'complete') {
    return
  }
  if (Date.now() > pending.until || store.getState().tabs.has(tabId)) {
    pendingReattach.delete(tabId)
    return
  }
  if (isRestrictedUrl(tab.pendingUrl || tab.url) || !takeReattachBudget(tabId)) {
    return
  }
  pendingReattach.delete(tabId)
  logger.warn(`RECOVER: re-attaching tab ${tabId} now that it reached a debuggable page`)
  void connectTab(tabId, groupOptionsOf(pending))
}

/** Prerender/instant activation swaps the tab's contents for a new tab id. */
function onTabReplaced(addedTabId: number, removedTabId: number): void {
  pendingReattach.delete(removedTabId)
  const tracked = store.getState().tabs.get(removedTabId)
  const recent = recentlyDetachedTabs.get(removedTabId)
  recentlyDetachedTabs.delete(removedTabId)
  const info = tracked || (recent && Date.now() - recent.at < 10_000 ? recent.info : undefined)
  if (!info) {
    return
  }
  logger.warn(`RECOVER: tab ${removedTabId} was replaced by ${addedTabId}, attaching the replacement`)
  if (tracked) {
    detachTab(removedTabId, false)
  }
  void connectTab(addedTabId, groupOptionsOf(info))
}

/** Re-attach tabs that were attached before the service worker restarted. */
async function restoreAttachedTabsAfterRestart(): Promise<void> {
  const persisted = await loadPersistedAttachedTabs()
  if (persisted.length === 0) {
    return
  }
  startReconnectGrace()
  const restored = (
    await Promise.all(
      persisted.map(async (item) => {
        if (store.getState().tabs.has(item.tabId)) {
          return undefined
        }
        const chromeTab = await chrome.tabs.get(item.tabId).catch(() => {
          return undefined
        })
        if (!chromeTab || isRestrictedUrl(chromeTab.url)) {
          return undefined
        }
        setTabConnecting(item.tabId, groupOptionsOf(item))
        return item.tabId
      }),
    )
  ).filter(isTruthy)
  logger.warn(`RECOVER: restoring ${restored.length} tab(s) attached before the service worker restarted`)
  // The relay handshake re-attaches 'connecting' tabs; if it already ran, do it here
  if (restored.length > 0 && connectionManager.ws?.readyState === WebSocket.OPEN) {
    await reattachConnectingTabsToLocalRelay()
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

// Resolve which tab a CDP command targets by checking sessionId sources in priority order:
// 1. Top-level sessionId (the CDP session the command was sent on)
// 2. params.sessionId (e.g. Target.detachFromTarget on the root session, see #40)
// 3. params.targetId (e.g. Target.closeTarget)
function getTabForCommand(msg: ExtensionCommandMessage): { tabId: number; tab: TabInfo } | undefined {
  const sessionId = msg.params.sessionId
  if (sessionId) {
    const found = getTabBySessionId(sessionId)
    if (found) {
      return found
    }
    const child = childSessions.get(sessionId)
    if (child) {
      const tab = store.getState().tabs.get(child.tabId)
      if (tab) {
        return { tabId: child.tabId, tab }
      }
    }
  }

  const paramsSessionId =
    msg.params.params && 'sessionId' in msg.params.params && typeof msg.params.params.sessionId === 'string'
      ? msg.params.params.sessionId
      : undefined
  if (paramsSessionId) {
    const found = getTabBySessionId(paramsSessionId)
    if (found) {
      return found
    }
    const child = childSessions.get(paramsSessionId)
    if (child) {
      const tab = store.getState().tabs.get(child.tabId)
      if (tab) {
        return { tabId: child.tabId, tab }
      }
    }
  }

  const targetId =
    msg.params.params && 'targetId' in msg.params.params && typeof msg.params.params.targetId === 'string'
      ? msg.params.params.targetId
      : undefined
  if (targetId) {
    return getTabByTargetId(targetId)
  }

  return undefined
}

async function handleCommand(
  msg: ExtensionCommandMessage,
  { remoteRuntime }: { remoteRuntime?: RemoteTunnelRuntime },
): Promise<any> {
  if (msg.method !== 'forwardCDPCommand') return

  // Tunneled relays: reject whole-profile destructive commands before routing.
  if (remoteRuntime) {
    const rejection = getRemoteCdpCommandRejection(msg.params.method)
    if (rejection) {
      throw new Error(rejection)
    }
  }

  const resolved = getTabForCommand(msg)
  let targetTabId = resolved?.tabId
  let targetTab = resolved?.tab

  const debuggee = targetTabId ? { tabId: targetTabId } : undefined

  // Root-level Target.setAutoAttach must apply to all connected tabs since
  // CDP auto-attach is per-debugger-session. Without this, OOPIF targets never attach.
  if (msg.params.method === 'Target.setAutoAttach' && !msg.params.sessionId) {
    const params = msg.params.params
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
          await sendCommandWithTimeout({ tabId }, 'Target.setAutoAttach', params, 10000)
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
        await sendCommandWithTimeout(runtimeSession, 'Runtime.disable', undefined, 10000)
        await sleep(50)
      } catch (e) {
        logger.debug('Error disabling Runtime (ignoring):', e)
      }
      return await sendCommandWithTimeout(runtimeSession, 'Runtime.enable', msg.params.params, 10000)
    }

    case 'Target.createTarget': {
      const url = msg.params.params?.url || 'about:blank'
      // The session's tab group title + owning session key travel on the
      // forwarded command (relay fills them from the client connection).
      const groupTitle = normalizeTabGroupTitle(msg.params.tabGroup) || undefined
      const groupKey = resolveTabGroupKey({ key: msg.params.tabGroupKey, remote: Boolean(remoteRuntime) })
      const groupColor = normalizeTabGroupColor(msg.params.tabGroupColor) || undefined
      logger.debug('Creating new tab with URL:', url, 'group:', groupTitle || DEFAULT_TAB_GROUP_TITLE)
      const tab = await createTabInPreferredWindow({ url, active: false })
      if (!tab.id) throw new Error('Failed to create tab')
      const tabId = tab.id
      setTabConnecting(tabId, { groupTitle, groupKey, groupColor })
      logger.debug('Created tab:', tabId, 'waiting for it to load...')
      await sleep(100)
      const attach = () => {
        return attachTab(tabId)
      }
      const { targetInfo } = remoteRuntime
        ? await attachForRemote({ runtime: remoteRuntime, tabId, attach })
        : await attach()
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
    // Target.detachFromTarget is best-effort — no-op if the session is already gone (#40).
    if (msg.params.method === 'Target.detachFromTarget') {
      return {}
    }

    throw new Error(
      `No tab found for method ${msg.params.method} sessionId: ${msg.params.sessionId} params: ${JSON.stringify(msg.params.params || null)}`,
    )
  }

  logger.debug('CDP command:', msg.params.method, 'for tab:', targetTabId)

  const debuggerSession: chrome.debugger.DebuggerSession = {
    ...debuggee,
    sessionId: msg.params.sessionId !== targetTab.sessionId ? msg.params.sessionId : undefined,
  }

  const timeout = FAST_CDP_COMMAND_TIMEOUT_MS.get(msg.params.method)
  if (timeout) {
    return await sendCommandWithTimeout(debuggerSession, msg.params.method, msg.params.params, timeout)
  }
  return await chrome.debugger.sendCommand(debuggerSession, msg.params.method, msg.params.params)
}

// CDP events dropped before sending over WebSocket to the relay.
// Only events no Playwright API depends on. The relay also filters these server-side
// for backwards compatibility with old extensions.
// NOTE: *ExtraInfo events feed Playwright's ResponseExtraInfoTracker (request/response.allHeaders()).
// webSocketFrame* events feed page.on('websocket'). Both must be forwarded.
// See: https://github.com/remorses/playwriter/issues/96
const DROPPED_CDP_EVENTS = new Set([
  'Network.dataReceived',
  'Network.resourceChangedPriority',
])

function onDebuggerEvent(source: chrome.debugger.DebuggerSession, method: string, params: any): void {
  if (DROPPED_CDP_EVENTS.has(method)) {
    return
  }

  const tab = source.tabId ? store.getState().tabs.get(source.tabId) : undefined
  if (!tab) return

  if (method === 'Page.screencastFrame' && typeof params?.sessionId === 'number') {
    // Central ACK ownership lets slow tunnel viewers drop frames without stalling Chrome.
    void chrome.debugger.sendCommand(source, 'Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => {})
  }

  // Skip debug logs for high-frequency events. Vite HMR and heavy pages emit
  // thousands of Network/lifecycle events; logging each one over the relay
  // WS starves screenshot and Target.createTarget (extension CPU spike).
  if (method !== 'Page.screencastFrame' && method !== 'Page.lifecycleEvent' && !method.startsWith('Network.')) {
    logger.debug('Forwarding CDP event:', method, 'from tab:', source.tabId)
  }

  if (method === 'Target.attachedToTarget' && params?.sessionId) {
    const targetUrl = params.targetInfo?.url as string | undefined
    // Filter out restricted child targets (other extensions' chrome-extension:// iframes,
    // chrome:// pages, devtools://, etc). Without this, Chrome's debugger API throws
    // "Cannot access a chrome-extension:// URL of a different extension" when the relay
    // tries to send commands (e.g. Runtime.runIfWaitingForDebugger) to these targets,
    // crashing the entire debugger session. See: https://github.com/remorses/playwriter/issues/18
    if (isRestrictedUrl(targetUrl)) {
      logger.debug(
        'Ignoring restricted child target:',
        targetUrl,
        'sessionId:',
        params.sessionId,
        'for tab:',
        source.tabId,
      )
      // Detach from the restricted child target to clean up. This command is sent on
      // the parent tab's debugger session (not the child), so it won't trigger the
      // restricted URL error.
      if (source.tabId) {
        chrome.debugger
          .sendCommand({ tabId: source.tabId }, 'Target.detachFromTarget', { sessionId: params.sessionId })
          .catch((e) => {
            logger.debug('Failed to detach restricted child target (expected):', e)
          })
      }
      return
    }

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
  if (!tabId) {
    logger.debug('Ignoring debugger detach event without a tab id')
    return
  }
  if (!store.getState().tabs.has(tabId)) {
    logger.debug('Ignoring debugger detach event for untracked tab:', tabId)
    return
  }

  logger.warn(`DISCONNECT: onDebuggerDetach tabId=${tabId} reason=${reason}`)

  const detachTabFromPlaywright = (detachedTabId: number, tab: TabInfo) => {
    sendMessage({
      method: 'forwardCDPEvent',
      params: {
        method: 'Target.detachedFromTarget',
        params: { sessionId: tab.sessionId, targetId: tab.targetId },
      },
    })
    emitChildDetachesForTab(detachedTabId)
  }

  if (reason === chrome.debugger.DetachReason.CANCELED_BY_USER) {
    // Chrome's debugger info bar cancellation detaches every debugger session
    // in this extension process. Clear every tracked tab so Playwright does not
    // keep sending commands to tabs Chrome already detached from.
    stopRemoteControl()
    for (const [detachedTabId, tab] of store.getState().tabs.entries()) {
      detachTabFromPlaywright(detachedTabId, tab)
    }

    store.setState({ tabs: new Map(), connectionState: 'idle', errorText: undefined })
    return
  }

  if (connectionManager.preserveTabsOnDetach && remoteTunnel === null) {
    logger.debug('Ignoring debugger detach during relay reconnect:', tabId, reason)
    return
  }

  const tab = store.getState().tabs.get(tabId)
  if (tab) {
    detachTabFromPlaywright(tabId, tab)
    recentlyDetachedTabs.set(tabId, { info: tab, at: Date.now() })
  }

  store.setState((state) => {
    const newTabs = new Map(state.tabs)
    newTabs.delete(tabId)
    return { tabs: newTabs }
  })
  forgetRemoteTab(tabId)

  // The tab may still be open (Chrome dropped the debugger, not the tab): attach it again
  if (tab && remoteTunnel === null) {
    void recoverDetachedTab(tabId, tab)
  }
}

type AttachTabResult = {
  targetInfo: Protocol.Target.TargetInfo
  sessionId: string
}

// Remove chrome-extension:// iframes from the page DOM before attaching the debugger.
// Chrome's chrome.debugger.attach API refuses to attach to tabs that contain frames from
// other extensions ("Cannot access a chrome-extension:// URL of different extension").
// Extensions like LastPass, SurfingKeys, etc. inject chrome-extension:// iframes into every
// page, breaking debugger attachment. This function temporarily removes them so the debugger
// can attach. The iframes stay removed while the debugger is active — they're typically
// re-injected by the owning extension on next page load.
// See: https://github.com/remorses/playwriter/issues/18
async function removeRestrictedIframes(tabId: number): Promise<number> {
  try {
    const results = await chrome.scripting.executeScript({
      // allFrames: true ensures we also scan same-origin subframes, not just the top document.
      target: { tabId, allFrames: true },
      func: (ownExtIds: string[]) => {
        // Traverse both the document and any open shadow roots, since some extensions
        // inject their chrome-extension:// iframes inside shadow DOM.
        const roots: ParentNode[] = [document]
        const elements = document.querySelectorAll('*')
        elements.forEach((el) => {
          const shadow = (el as HTMLElement).shadowRoot
          if (shadow) {
            roots.push(shadow)
          }
        })

        let removed = 0
        for (const root of roots) {
          root.querySelectorAll('iframe').forEach((iframe) => {
            const src = iframe.src || iframe.getAttribute('src') || ''
            if (!src.startsWith('chrome-extension://')) {
              return
            }
            const extId = src.replace('chrome-extension://', '').split('/')[0]
            if (ownExtIds.includes(extId)) {
              return
            }
            iframe.remove()
            removed++
          })
        }
        return removed
      },
      args: [OUR_EXTENSION_IDS],
    })
    const totalRemoved = results.reduce((sum, r) => sum + (r.result ?? 0), 0)
    if (totalRemoved > 0) {
      logger.debug(`Removed ${totalRemoved} restricted chrome-extension:// iframe(s) from tab:`, tabId)
    }
    return totalRemoved
  } catch (e) {
    // Scripting may fail on restricted pages (chrome://, about:, etc.) — that's fine,
    // those pages won't have extension iframes anyway.
    logger.debug('Could not remove restricted iframes (expected on some pages):', (e as Error).message)
    return 0
  }
}

// Concurrent attaches of one tab share one promise. The relay handshake
// re-attaches 'connecting' tabs while connectTab can attach the same tab; a
// second chrome.debugger.attach fails with "Another debugger is already attached".
const inFlightTabAttaches = new Map<number, Promise<AttachTabResult>>()

function attachTab(tabId: number, options: { skipAttachedEvent?: boolean } = {}): Promise<AttachTabResult> {
  const inFlight = inFlightTabAttaches.get(tabId)
  if (inFlight) {
    return inFlight
  }
  const attach = attachTabDebugger(tabId, options).finally(() => {
    inFlightTabAttaches.delete(tabId)
  })
  inFlightTabAttaches.set(tabId, attach)
  return attach
}

async function attachTabDebugger(
  tabId: number,
  { skipAttachedEvent = false }: { skipAttachedEvent?: boolean } = {},
): Promise<AttachTabResult> {
  const debuggee = { tabId }
  let debuggerAttached = false

  try {
    logger.debug('Attaching debugger to tab:', tabId)

    // Bounded retry loop: chrome.debugger.attach fails if the tab contains chrome-extension://
    // iframes from other extensions. We remove them and retry, but aggressive extensions can
    // re-inject between cleanup and retry, so we allow up to 3 attempts.
    const maxAttachAttempts = 3
    for (let attempt = 1; attempt <= maxAttachAttempts; attempt++) {
      try {
        await chrome.debugger.attach(debuggee, '1.3')
        break
      } catch (attachError: any) {
        const msg = attachError.message ?? ''
        const isRestrictedIframeError = msg.includes('chrome-extension://') || msg.includes('different extension')
        if (!isRestrictedIframeError || attempt === maxAttachAttempts) {
          throw attachError
        }
        logger.debug(
          `Debugger attach blocked by chrome-extension:// iframe (attempt ${attempt}/${maxAttachAttempts}), removing and retrying:`,
          tabId,
        )
        await removeRestrictedIframes(tabId)
        await sleep(50)
      }
    }

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

    const contextMenuScript = js`
      document.addEventListener('contextmenu', (e) => {
        window.__playwriter_lastRightClicked = e.target;
      }, true);
    `
    await chrome.debugger.sendCommand(debuggee, 'Page.addScriptToEvaluateOnNewDocument', { source: contextMenuScript })
    await chrome.debugger.sendCommand(debuggee, 'Runtime.evaluate', { expression: contextMenuScript })

    // Ghost cursor — survives navigations via addScriptToEvaluateOnNewDocument.
    try {
      await chrome.debugger.sendCommand(debuggee, 'Page.addScriptToEvaluateOnNewDocument', {
        source: ghostCursorBundleCode,
      })
      await chrome.debugger.sendCommand(debuggee, 'Runtime.evaluate', { expression: ghostCursorBundleCode })
    } catch (err) {
      logger.debug('Could not inject ghost cursor (restricted page):', (err as Error).message)
    }

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
        // Preserve the tab group assigned by setTabConnecting/createTarget
        groupTitle: state.tabs.get(tabId)?.groupTitle,
        groupKey: state.tabs.get(tabId)?.groupKey,
        groupColor: state.tabs.get(tabId)?.groupColor,
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

    // Inject the in-page toolbar into the ISOLATED world (best-effort: silently
    // fails on restricted pages like chrome:// or about:blank)
    chrome.scripting
      .executeScript({
        target: { tabId, allFrames: false },
        world: 'ISOLATED',
        func: initPlaywriterToolbar,
      })
      .then(() => {
        syncToolbarState(tabId)
      })
      .catch((err: Error) => {
        logger.debug('Could not inject toolbar (restricted page):', err.message)
      })

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
  void cleanupRecordingForTab(tabId)

  // Destroy the in-page toolbar (best-effort: tab may already be closing or navigating)
  void chrome.scripting
    .executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: () => {
        window.__playwriterToolbarDestroy?.()
      },
    })
    .catch(() => {})

  void chrome.scripting
    .executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        ;(globalThis as any).__playwriterGhostCursor?.disable?.()
      },
    })
    .catch(() => {})

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

// Recording started from the toolbar. Passed back on stop so the Stop button
// is never ambiguous when another recording is also active.
let toolbarRecordingId: string | null = null
let toolbarStartInFlight = false

// Sync service-worker state into the isolated toolbar after injection.
function syncToolbarState(tabId: number): void {
  chrome.scripting
    .executeScript({
      target: { tabId, allFrames: false },
      world: 'ISOLATED',
      func: (recording: boolean, remoteActive: boolean) => {
        window.__playwriterToolbarSetRecording?.(recording)
        window.__playwriterToolbarSetRemote?.(remoteActive)
      },
      args: [toolbarRecordingId !== null, remoteTunnel !== null],
    })
    .catch(() => {})
}

function setRecorderStateInTab(tabId: number, recording: boolean): void {
  chrome.scripting
    .executeScript({
      target: { tabId, allFrames: false },
      world: 'ISOLATED',
      func: (rec: boolean) => {
        window.__playwriterToolbarSetRecording?.(rec)
      },
      args: [recording],
    })
    .catch(() => {})
}

function setRemoteStateInTab(tabId: number, active: boolean): Promise<void> {
  return chrome.scripting
    .executeScript({
      target: { tabId, allFrames: false },
      world: 'ISOLATED',
      func: (on: boolean) => {
        window.__playwriterToolbarSetRemote?.(on)
      },
      args: [active],
    })
    .then(() => {})
    .catch(() => {})
}

// Every connected tab shows Remote ON while sharing, so Stop works from any tab.
function setRemoteStateInAllTabs(active: boolean): void {
  void Promise.all(
    Array.from(store.getState().tabs.entries())
      .filter(([_, tab]) => tab.state === 'connected')
      .map(([tabId]) => {
        return setRemoteStateInTab(tabId, active)
      }),
  )
}

// Notify all connected tabs when recording starts/stops.
function setRecorderStateInAllTabs(recording: boolean): void {
  const { tabs } = store.getState()
  for (const [tabId, tab] of tabs) {
    if (tab.state !== 'connected') {
      continue
    }
    setRecorderStateInTab(tabId, recording)
  }
}

async function connectTab(
  tabId: number,
  options?: { groupTitle?: string; groupKey?: string; groupColor?: chrome.tabGroups.ColorEnum },
): Promise<void> {
  try {
    logger.debug(`Starting connection to tab ${tabId}`)

    setTabConnecting(tabId, options)

    if (remoteTunnel === null) {
      await connectionManager.ensureConnection()
    } else {
      // With an active remote-control tunnel, tabs must attach even when no
      // local playwriter relay is running (remote-only setups). Local relay
      // connection stays best-effort in the background.
      void connectionManager.ensureConnection().catch(() => {})
    }
    // The relay handshake inside ensureConnection re-attaches 'connecting' tabs,
    // including this one. Attaching again would fail on the live debugger.
    if (store.getState().tabs.get(tabId)?.state === 'connected') {
      logger.debug(`Tab ${tabId} was attached by the relay handshake`)
      return
    }
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
      // If the tab was closed mid-attach, don't write an error entry —
      // onTabRemoved already deleted it and we'd leak a dead tabId.
      let tabStillExists = true
      try {
        await chrome.tabs.get(tabId)
      } catch {
        tabStillExists = false
      }
      if (!tabStillExists) {
        logger.debug(`Tab ${tabId} was closed during connect, dropping error state`)
        store.setState((state) => {
          const newTabs = new Map(state.tabs)
          newTabs.delete(tabId)
          return { tabs: newTabs }
        })
        return
      }
      if (!store.getState().tabs.has(tabId)) {
        logger.debug(`Tab ${tabId} was detached during connect, dropping error state`)
        return
      }
      store.setState((state) => {
        const newTabs = new Map(state.tabs)
        const prior = state.tabs.get(tabId)
        // Keep the tab group so a later successful connect lands in the right group
        newTabs.set(tabId, {
          state: 'error',
          errorText: `Error: ${error.message}`,
          groupTitle: prior?.groupTitle,
          groupKey: prior?.groupKey,
          groupColor: prior?.groupColor,
        })
        return { tabs: newTabs }
      })
    }
  }
}

function setTabConnecting(
  tabId: number,
  options?: { groupTitle?: string; groupKey?: string; groupColor?: chrome.tabGroups.ColorEnum },
): void {
  store.setState((state) => {
    const newTabs = new Map(state.tabs)
    const existing = newTabs.get(tabId)
    newTabs.set(tabId, {
      ...existing,
      state: 'connecting',
      groupTitle: options?.groupTitle || existing?.groupTitle,
      groupKey: options?.groupKey || existing?.groupKey,
      groupColor: options?.groupColor || existing?.groupColor,
    })
    return { tabs: newTabs }
  })
}

async function disconnectTab(tabId: number): Promise<void> {
  logger.debug(`Disconnecting tab ${tabId}`)

  // Disconnecting the anchor tab also revokes the remote-control link.
  forgetRemoteTab(tabId)

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

// ============================================================================
// Remote control manager
// ============================================================================

const REMOTE_TUNNEL_STORAGE_KEY = 'playwriterRemoteTunnel'

type PersistedRemoteTunnel = { anchorTabId: number; tunnelId: string; remoteTabIds: number[] }

function persistRemoteTunnel(): void {
  const entry: PersistedRemoteTunnel | null = remoteTunnel
    ? {
        anchorTabId: remoteTunnel.anchorTabId,
        tunnelId: remoteTunnel.tunnelId,
        remoteTabIds: Array.from(remoteTunnel.remoteTabIds),
      }
    : null
  void chrome.storage.session.set({ [REMOTE_TUNNEL_STORAGE_KEY]: entry }).catch(() => {})
}

const REMOTE_CONTROL_STOPPED_ERROR = 'Remote control was stopped by the user.'

/** Tabs whose popups and children belong to the remote: the anchor and tabs it opened. */
function isRemoteOwnedTab({ runtime, tabId }: { runtime: RemoteTunnelRuntime; tabId: number }): boolean {
  return tabId === runtime.anchorTabId || runtime.remoteTabIds.has(tabId)
}

// Attach a tab on behalf of a remote runtime and track it so Stop sharing
// detaches it. Remote work can outlive Stop sharing (the attach awaits), so a tab
// whose attach finishes after revocation is detached again and left open.
async function attachForRemote<T>({
  runtime,
  tabId,
  attach,
}: {
  runtime: RemoteTunnelRuntime
  tabId: number
  attach: () => Promise<T>
}): Promise<T> {
  if (remoteTunnel !== runtime) {
    detachTab(tabId, true)
    throw new Error(REMOTE_CONTROL_STOPPED_ERROR)
  }
  if (!runtime.remoteTabIds.has(tabId)) {
    runtime.remoteTabIds.add(tabId)
    persistRemoteTunnel()
  }
  const result = await attach()
  if (remoteTunnel !== runtime) {
    detachTab(tabId, true)
    throw new Error(REMOTE_CONTROL_STOPPED_ERROR)
  }
  return result
}

// Anchor tab gone → revoke the link. Any other tab just leaves the cleanup set.
function forgetRemoteTab(tabId: number): void {
  if (remoteTunnel === null) {
    return
  }
  if (remoteTunnel.anchorTabId === tabId) {
    stopRemoteControl()
    return
  }
  if (remoteTunnel.remoteTabIds.delete(tabId)) {
    persistRemoteTunnel()
  }
}

// Tell a freshly connected relay about every attached tab: relays only learn
// targets from Target.attachedToTarget events. `firstTabId` goes first so it
// becomes context.pages()[0] and the tab the playwriter.dev viewer shows.
async function announceConnectedTabs({
  send,
  firstTabId,
}: {
  send(message: any): void
  firstTabId?: number
}): Promise<void> {
  const tabs = Array.from(store.getState().tabs.entries()).sort(([a], [b]) => {
    return Number(b === firstTabId) - Number(a === firstTabId)
  })
  for (const [tabId, tab] of tabs) {
    if (tab.state !== 'connected' || !tab.sessionId) {
      continue
    }
    try {
      const result = (await chrome.debugger.sendCommand(
        { tabId },
        'Target.getTargetInfo',
      )) as Protocol.Target.GetTargetInfoResponse
      send({
        method: 'forwardCDPEvent',
        params: {
          method: 'Target.attachedToTarget',
          params: {
            sessionId: tab.sessionId,
            targetInfo: { ...result.targetInfo, attached: true },
            waitingForDebugger: false,
          },
        },
      })
    } catch (error) {
      logger.debug('Failed to announce tab target:', tabId, error)
    }
  }
}

// Re-announce currently attached tabs to the local relay after it reconnects.
// Needed for tabs that stayed attached for Remote control while the relay was down.
async function announceConnectedTabsToLocalRelay(socket = connectionManager.ws): Promise<void> {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    throw new Error('Local relay connection changed during target inventory')
  }
  await announceConnectedTabs({
    send: (message) => {
      socket.send(JSON.stringify(message))
    },
  })
}

async function completeLocalRelayHandshake(socket: WebSocket): Promise<void> {
  await announceConnectedTabsToLocalRelay(socket)
  await reattachConnectingTabsToLocalRelay()
  if (connectionManager.ws !== socket || socket.readyState !== WebSocket.OPEN) {
    throw new Error('Local relay connection changed during target inventory')
  }
  socket.send(JSON.stringify({ method: 'ready' }))
}

async function reattachConnectingTabsToLocalRelay(): Promise<void> {
  const tabsToReattach = Array.from(store.getState().tabs.entries())
    .filter(([_, tab]) => tab.state === 'connecting')
    .map(([tabId]) => tabId)

  await Promise.all(
    tabsToReattach.map(async (tabId) => {
      const currentTab = store.getState().tabs.get(tabId)
      if (!currentTab || currentTab.state !== 'connecting') {
        return
      }
      try {
        await chrome.tabs.get(tabId)
        await attachTab(tabId)
        logger.debug('Successfully re-attached tab:', tabId)
      } catch (error) {
        logger.debug('Failed to re-attach tab:', tabId, error instanceof Error ? error.message : String(error))
        store.setState((state) => {
          const newTabs = new Map(state.tabs)
          newTabs.delete(tabId)
          return { tabs: newTabs }
        })
      }
    }),
  )
}

// Introduce the extension without exposing local profile identity, then announce
// every attached tab (anchor first) to the freshly connected tunneled relay.
async function sendRemoteHelloAndTargets(conn: { send(message: any): void }): Promise<void> {
  const browser = await detectBrowserName().catch(() => {
    return undefined
  })
  conn.send(
    buildRemoteHelloMessage({
      browser,
      version: typeof __PLAYWRITER_VERSION__ !== 'undefined' ? __PLAYWRITER_VERSION__ : undefined,
    }),
  )
  await announceConnectedTabs({ send: conn.send, firstTabId: remoteTunnel?.anchorTabId })
}

async function startRemoteControl(
  anchorTabId: number,
  options: { tunnelId?: string; remoteTabIds?: number[] } = {},
): Promise<{ url: string; started: boolean; id: string }> {
  if (remoteTunnel) {
    setRemoteStateInAllTabs(true)
    return { url: remoteTunnel.tunnel.url, started: false, id: remoteTunnel.tunnelId }
  }

  const tunnelId = options.tunnelId || generateTunnelId()
  const tunnel = new RemoteTunnel({
    tunnelId,
    baseDomain: REMOTE_TUNNEL_BASE_DOMAIN,
    logger,
    onStatusChange: (status, detail) => {
      if (remoteTunnel?.tunnel === tunnel) {
        remoteTunnel.status = status
      }
      logger.debug('Remote tunnel status:', status, detail || '')
    },
    onConnectionOpen: (virtualConn) => {
      const connKey = `${tunnelId}:${virtualConn.id}`
      const conn = {
        send: (message: any) => {
          const isScreencastFrame =
            message?.method === 'forwardCDPEvent' && message.params?.method === 'Page.screencastFrame'
          if (isScreencastFrame && !virtualConn.canSendScreencastFrame()) {
            return
          }
          virtualConn.send(JSON.stringify(message))
        },
      }
      remoteRelayConnections.set(connKey, conn)
      void sendRemoteHelloAndTargets(conn)
      return {
        onMessage: (data) => {
          let parsed: any
          try {
            parsed = JSON.parse(data)
          } catch {
            return
          }
          void dispatchRelayMessage(parsed, { send: conn.send, remoteRuntime: runtime })
        },
        onClose: () => {
          remoteRelayConnections.delete(connKey)
        },
      }
    },
  })

  const runtime: RemoteTunnelRuntime = { tunnel, tunnelId, anchorTabId, remoteTabIds: new Set(), status: 'connecting' }
  // Set before attaching so the maintain loop and relay-close handling keep
  // these tabs 'connected' without a local relay: the tunnel is the consumer.
  remoteTunnel = runtime
  // Only the SW-restart restore path attaches here; a toolbar start needs a connected anchor.
  if (store.getState().tabs.get(anchorTabId)?.state !== 'connected') {
    try {
      setTabConnecting(anchorTabId)
      await attachTab(anchorTabId)
    } catch (error) {
      stopRemoteControl()
      detachTab(anchorTabId, true)
      throw error
    }
    // Stopped while attaching (anchor closed, debugger banner cancelled): undo our attach.
    if (remoteTunnel !== runtime) {
      detachTab(anchorTabId, true)
      throw new Error(REMOTE_CONTROL_STOPPED_ERROR)
    }
  }
  for (const tabId of options.remoteTabIds || []) {
    if (tabId === anchorTabId) {
      continue
    }
    const alreadyConnected = store.getState().tabs.get(tabId)?.state === 'connected'
    if (!alreadyConnected) {
      setTabConnecting(tabId)
    }
    try {
      await attachForRemote({
        runtime,
        tabId,
        attach: async () => {
          if (!alreadyConnected) {
            await attachTab(tabId)
          }
        },
      })
    } catch (error) {
      if (remoteTunnel !== runtime) {
        throw error
      }
      logger.debug('Failed to restore remote tab:', tabId, error)
      forgetRemoteTab(tabId)
      detachTab(tabId, true)
    }
  }

  tunnel.start()
  persistRemoteTunnel()
  setRemoteStateInAllTabs(true)
  logger.log('Remote control started, anchor tab', anchorTabId)
  return { url: tunnel.url, started: true, id: tunnelId }
}

// Closes the tunnel (and every tunneled relay connection) immediately. Tabs the
// remote caused to attach are detached and left open; other tabs stay attached
// for the local relay.
function stopRemoteControl(): boolean {
  const runtime = remoteTunnel
  if (runtime === null) {
    return false
  }
  setRemoteStateInAllTabs(false)
  remoteTunnel = null
  runtime.tunnel.close()
  persistRemoteTunnel()
  for (const tabId of runtime.remoteTabIds) {
    detachTab(tabId, true)
  }
  // Tabs kept 'connected' only for the tunnel go back to waiting for the local relay.
  if (connectionManager.ws?.readyState !== WebSocket.OPEN) {
    const replaced = store.getState().connectionState === 'extension-replaced'
    detachAllTabDebuggers()
    store.setState((state) => {
      return { tabs: replaced ? new Map() : markAllTabsConnecting(state.tabs) }
    })
  }
  logger.log('Remote control stopped, anchor tab', runtime.anchorTabId)
  return true
}

// Rebuild the tunnel after a service-worker restart from the persisted evidence.
// Reuses the same tunnelId so the shared id keeps working across SW restarts.
async function restoreRemoteTunnelAfterRestart(): Promise<void> {
  try {
    const stored = await chrome.storage.session.get(REMOTE_TUNNEL_STORAGE_KEY)
    const entry = stored[REMOTE_TUNNEL_STORAGE_KEY] as PersistedRemoteTunnel | null | undefined
    if (!entry) {
      return
    }
    const tabExists = (tabId: number): Promise<boolean> => {
      return chrome.tabs.get(tabId).then(
        () => true,
        () => false,
      )
    }
    if (!(await tabExists(entry.anchorTabId))) {
      persistRemoteTunnel()
      return
    }
    const existing = await Promise.all(
      (entry.remoteTabIds || []).map(async (tabId) => {
        return (await tabExists(tabId)) ? tabId : undefined
      }),
    )
    await startRemoteControl(entry.anchorTabId, {
      tunnelId: entry.tunnelId,
      remoteTabIds: existing.filter(isTruthy),
    })
  } catch (error) {
    logger.error('Failed to restore remote control:', error)
    persistRemoteTunnel()
  }
}

async function startRemoteControlForActiveTab(): Promise<{ url: string }> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  const tab = tabs[0]
  if (!tab?.id) throw new Error('No active tab found')
  return await startRemoteControl(tab.id)
}

function getRemoteControlState(): { anchorTabId: number; url: string; status: string; remoteTabIds: number[] } | null {
  if (remoteTunnel === null) {
    return null
  }
  return {
    anchorTabId: remoteTunnel.anchorTabId,
    url: remoteTunnel.tunnel.url,
    status: remoteTunnel.status,
    remoteTabIds: Array.from(remoteTunnel.remoteTabIds),
  }
}

async function resetDebugger(): Promise<void> {
  let targets = await chrome.debugger.getTargets()
  targets = targets.filter((x) => x.tabId && x.attached)
  logger.log(`found ${targets.length} existing debugger targets. detaching them before background script starts`)
  // Bound and isolate each detach: Chrome 153 can leave a detach stuck in
  // DETACH_STALLED_IN_STOPPING, and a single stalled target must not block the
  // whole startup chain (remote-tab restore + tab-group sync). See issue #40.
  await Promise.all(
    targets.map(async (target) => {
      try {
        await withTimeout(chrome.debugger.detach({ tabId: target.tabId }), 3000, undefined)
      } catch (error) {
        logger.debug('resetDebugger detach failed/stalled for tab:', target.tabId, (error as Error).message)
      }
    }),
  )
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
  const allTabIds = [undefined, ...allTabs.map((tab) => tab.id).filter(isTruthy)]

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
  popupSourceTabMap.delete(tabId)
  pendingReattach.delete(tabId)
  recentlyDetachedTabs.delete(tabId)
  forgetRemoteTab(tabId)
  const { tabs } = store.getState()
  if (!tabs.has(tabId)) return
  logger.debug(`Connected tab ${tabId} was closed, disconnecting`)
  await disconnectTab(tabId)
}

async function onTabActivated(activeInfo: chrome.tabs.TabActiveInfo): Promise<void> {
  store.setState({ currentTabId: activeInfo.tabId, preferredWindowId: activeInfo.windowId })
}

const TUTORIAL_PAGE_PATH = 'src/tutorial.html'

// Icon only attaches a tab. Daemon starts on the first playwriter command.
function shouldOpenTutorialPage(): boolean {
  if (import.meta.env.TESTING) return false
  if (!__PLAYWRITER_OPEN_WELCOME_PAGE__) return false
  return store.getState().connectionState === 'idle'
}

async function openTutorialPage(): Promise<void> {
  try {
    const baseUrl = chrome.runtime.getURL(TUTORIAL_PAGE_PATH)
    const tabs = await chrome.tabs.query({})
    const existing = tabs.find((t) => t.url?.startsWith(baseUrl))
    if (existing?.id) {
      await chrome.tabs.update(existing.id, { active: true })
      if (existing.windowId !== undefined) {
        await chrome.windows.update(existing.windowId, { focused: true })
      }
      return
    }
    await chrome.tabs.create({ url: `${TUTORIAL_PAGE_PATH}?port=${RELAY_PORT}` })
  } catch (e) {
    logger.debug('Failed to open tutorial page:', e)
  }
}

async function onActionClicked(tab: chrome.tabs.Tab): Promise<void> {
  if (shouldOpenTutorialPage()) {
    void openTutorialPage()
  }

  if (!tab.id) {
    logger.debug('No tab ID available')
    return
  }

  if (tab.windowId !== undefined) {
    store.setState({ currentTabId: tab.id, preferredWindowId: tab.windowId })
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

// Registered permanently (not per relay connection): with remote-control tunnels
// active, debugger events must keep flowing even when the local relay is down.
chrome.debugger.onEvent.addListener(onDebuggerEvent)
chrome.debugger.onDetach.addListener(onDebuggerDetach)

// resetDebugger detaches everything, so remote tabs must be restored after it.
void resetDebugger().then(() => {
  return restoreRemoteTunnelAfterRestart()
}).then(() => {
  return restoreAttachedTabsAfterRestart()
}).finally(() => {
  // Startup sync: clean leftover managed groups from a previous SW/browser
  // session (Chrome session restore can bring groups back while nothing is
  // connected). Runs after remote tabs restore so restored tabs stay grouped.
  tabGroupQueue = tabGroupQueue.then(syncTabGroup).catch((e) => {
    logger.debug('startup syncTabGroup error:', e)
  })
})
void connectionManager.maintainLoop()

chrome.contextMenus
  .remove('playwriter-pin-element')
  .catch(() => {})
  .finally(() => {
    chrome.contextMenus?.create({
      id: 'playwriter-pin-element',
      title: 'Copy Playwriter Element Reference',
      contexts: ['all'],
      visible: false,
    })
  })

chrome.contextMenus
  .remove('playwriter-copy-react-source')
  .catch(() => {})
  .finally(() => {
    chrome.contextMenus?.create({
      id: 'playwriter-copy-react-source',
      title: 'Copy React Component Source Path',
      contexts: ['all'],
      visible: false,
    })
  })

function updateContextMenuVisibility(): void {
  const { currentTabId, tabs } = store.getState()
  const isConnected = currentTabId !== undefined && tabs.get(currentTabId)?.state === 'connected'
  void chrome.contextMenus?.update('playwriter-pin-element', { visible: isConnected })
  void chrome.contextMenus?.update('playwriter-copy-react-source', { visible: isConnected })
}

function buildPinnedElementInspectionCode(options: { pinName: string; url: string }): string {
  const URL_LIT = JSON.stringify(options.url).replace(/'/g, '\\u0027')
  return `inspectPinnedElement(${URL_LIT},"globalThis.${options.pinName}")`
}

chrome.runtime.onInstalled.addListener((details) => {
  if (import.meta.env.TESTING) return
  if (!__PLAYWRITER_OPEN_WELCOME_PAGE__) return
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
    persistAttachedTabs(state.tabs)
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
chrome.tabs.onReplaced.addListener(onTabReplaced)
chrome.tabs.onActivated.addListener(onTabActivated)
chrome.action.onClicked.addListener(onActionClicked)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  void updateIcons()
  reattachPendingTabIfReady(tabId, changeInfo, tab)
  if (changeInfo.groupId !== undefined) {
    // Queue tab group operations to serialize with syncTabGroup and disconnectEverything
    tabGroupQueue = tabGroupQueue
      .then(async () => {
        // Query managed groups by title - no stale cached IDs. changeInfo.groupId
        // is only the trigger: this task runs later on the queue, so the live
        // group membership is re-read for every decision (a stale event id could
        // otherwise adopt a group the user already dragged the tab out of).
        const managedTitles = await getManagedTabGroupTitles()
        const readManagedGroups = async (): Promise<chrome.tabGroups.TabGroup[]> => {
          const allGroups = await chrome.tabGroups.query({})
          return allGroups.filter((g) => g.title && managedTitles.has(g.title))
        }
        const readCurrentGroupId = async (): Promise<number> => {
          const currentTab = await chrome.tabs.get(tabId).catch(() => {
            return undefined
          })
          return currentTab?.groupId ?? chrome.tabGroups.TAB_GROUP_ID_NONE
        }

        const managedGroups = await readManagedGroups()
        if (managedGroups.length === 0) {
          return
        }
        const { tabs } = store.getState()
        const currentGroupId = await readCurrentGroupId()
        const currentGroup = managedGroups.find((g) => g.id === currentGroupId)
        if (currentGroup) {
          const tabInfo = tabs.get(tabId)
          if (!tabInfo && !isRestrictedUrl(tab.url)) {
            // Chrome puts window.open / target=_blank tabs into the opener's group. Those
            // popups belong to the opener's session, so they inherit its ownership key.
            const sourceTabId = popupSourceTabMap.get(tabId)
            const sourceTabInfo = sourceTabId === undefined ? undefined : tabs.get(sourceTabId)
            logger.debug('Tab added to managed group:', tabId, currentGroup.title, 'source:', sourceTabId)
            await connectTab(tabId, {
              groupTitle: currentGroup.title,
              groupKey: sourceTabInfo?.groupKey,
              groupColor: sourceTabInfo?.groupColor,
            })
            return
          }
          // Tab dragged between managed groups: adopt the new title so sync
          // never fights the user by moving the tab back. Dragging tabs across
          // session groups is allowed — grouping is cosmetic.
          const currentTitle = currentGroup.title
          if (tabInfo && currentTitle && (tabInfo.groupTitle || DEFAULT_TAB_GROUP_TITLE) !== currentTitle) {
            logger.debug('Tab moved between managed groups, adopting title:', tabId, currentTitle)
            store.setState((state) => {
              const newTabs = new Map(state.tabs)
              const existing = newTabs.get(tabId)
              if (!existing) {
                return state
              }
              newTabs.set(tabId, { ...existing, groupTitle: currentTitle })
              return { tabs: newTabs }
            })
          }
          return
        }

        const tabInfo = tabs.get(tabId)
        if (
          !shouldDisconnectAfterTabGroupChange({
            currentGroupId,
            managedGroupIds: managedGroups.map((g) => g.id),
            tabState: tabInfo?.state,
          })
        ) {
          logger.debug(
            'Ignoring stale tab group change:',
            tabId,
            'eventGroupId:',
            changeInfo.groupId,
            'currentGroupId:',
            currentGroupId,
            'state:',
            tabInfo?.state,
          )
          return
        }
        // "Move group to new window" fires transient groupId=NONE events while
        // Chrome detaches/reattaches the tabs. Re-check after a short delay with
        // FRESH group ids (a group can be recreated with a new id meanwhile) and
        // only disconnect when the tab is still outside every managed group.
        await sleep(500)
        const recheckedGroups = await readManagedGroups()
        const recheckedGroupId = await readCurrentGroupId()
        const freshInfo = store.getState().tabs.get(tabId)
        if (
          !shouldDisconnectAfterTabGroupChange({
            currentGroupId: recheckedGroupId,
            managedGroupIds: recheckedGroups.map((g) => g.id),
            tabState: freshInfo?.state,
          })
        ) {
          logger.debug('Tab regrouped during recheck, keeping connection:', tabId)
          return
        }
        logger.debug('Tab manually removed from managed groups:', tabId)
        await disconnectTab(tabId)
      })
      .catch((e) => {
        logger.debug('onTabUpdated handler error:', e)
      })
  }
})

// Track every new tab's source (opener) tab via webNavigation.
// chrome.tabs.Tab.openerTabId is unreliable for window.open popups — on
// Chromium 145 it is left null. onCreatedNavigationTarget gives a reliable
// source_tab_id → new_tab_id mapping for every window.open / target=_blank
// / cmd+click. Entries expire after 10s to cap memory for plain-new-tab
// cases that never trigger windows.onCreated.
const popupSourceTabMap = new Map<number, number>()

chrome.webNavigation.onCreatedNavigationTarget.addListener((details) => {
  popupSourceTabMap.set(details.tabId, details.sourceTabId)
  setTimeout(() => {
    popupSourceTabMap.delete(details.tabId)
  }, 10000)
  void maybeAttachRemoteChildTab(details)
})

// While sharing, window.open / target=_blank tabs opened FROM a remote-owned tab
// (anchor or a tab the remote opened) attach so remote agent flows (OAuth
// redirects, payment popups, etc) keep working. Popup windows are handled by the relocation listener below instead:
// the debugger cannot attach to tabs still living in a separate popup window.
async function maybeAttachRemoteChildTab(details: { tabId: number; sourceTabId: number }): Promise<void> {
  const runtime = remoteTunnel
  if (runtime === null || !isRemoteOwnedTab({ runtime, tabId: details.sourceTabId })) {
    return
  }
  let tab: chrome.tabs.Tab
  try {
    tab = await chrome.tabs.get(details.tabId)
  } catch {
    return
  }
  if (isRestrictedUrl(tab.url)) {
    return
  }
  const win = await chrome.windows.get(tab.windowId).catch(() => {
    return null
  })
  if (!win || win.type !== 'normal') {
    return
  }
  if (store.getState().tabs.has(details.tabId)) {
    return
  }
  try {
    // Child tabs join the source tab's group so session tabs stay together
    const sourceTabInfo = store.getState().tabs.get(details.sourceTabId)
    await attachForRemote({
      runtime,
      tabId: details.tabId,
      attach: () => {
        return connectTab(details.tabId, {
          groupTitle: sourceTabInfo?.groupTitle,
          groupKey: sourceTabInfo?.groupKey,
          groupColor: sourceTabInfo?.groupColor,
        })
      },
    })
  } catch (error) {
    logger.debug('Failed to attach remote child tab:', details.tabId, error)
  }
}

// Relocate popup windows opened by a Playwriter-connected tab into the
// source tab's window as a regular tab, since Playwriter cannot attach
// its debugger to separate popup windows. When the source tab is NOT
// connected, leave the popup alone so unrelated sites keep normal Chrome
// popup behavior. After relocation, auto-attach Playwriter to the new
// tab so it appears in context.pages().
chrome.windows.onCreated.addListener(async (popupWindow) => {
  if (popupWindow.type !== 'popup' || popupWindow.id === undefined) {
    return
  }
  try {
    // Retry tab discovery — windows.onCreated can fire before
    // chrome.tabs.query({ windowId }) sees the new popup tab.
    let popupTabs: chrome.tabs.Tab[] = []
    for (let attempt = 0; attempt < 5; attempt++) {
      popupTabs = await chrome.tabs.query({ windowId: popupWindow.id })
      if (popupTabs.length > 0) break
      await sleep(20)
    }
    const tabIds = popupTabs.map((t) => t.id).filter(isTruthy)
    if (tabIds.length === 0) {
      logger.debug(`Popup window ${popupWindow.id} has no tabs after retry, skipping`)
      return
    }

    const { tabs: connectedTabs } = store.getState()
    let sourceTabId: number | undefined
    for (const tabId of tabIds) {
      const candidate = popupSourceTabMap.get(tabId)
      if (candidate !== undefined && connectedTabs.has(candidate)) {
        sourceTabId = candidate
        break
      }
    }
    for (const tabId of tabIds) {
      popupSourceTabMap.delete(tabId)
    }
    if (sourceTabId === undefined) {
      logger.debug(
        `Popup window ${popupWindow.id} not opened by a Playwriter-connected tab, leaving alone (tabs=${JSON.stringify(tabIds)})`,
      )
      return
    }

    let destinationWindowId: number
    try {
      const sourceTab = await chrome.tabs.get(sourceTabId)
      if (sourceTab.windowId === undefined) {
        const focused = await chrome.windows.getLastFocused({ populate: false })
        if (focused.id === undefined || focused.id === popupWindow.id) {
          return
        }
        destinationWindowId = focused.id
      } else {
        destinationWindowId = sourceTab.windowId
      }
    } catch (e) {
      logger.debug(`Source tab ${sourceTabId} no longer exists, skipping relocation:`, e)
      return
    }

    logger.debug(
      `Relocating ${tabIds.length} popup tab(s) from window ${popupWindow.id} into source window ${destinationWindowId} (sourceTabId=${sourceTabId})`,
    )
    await chrome.tabs.move(tabIds, { windowId: destinationWindowId, index: -1 })
    try {
      await chrome.windows.remove(popupWindow.id)
    } catch {
      // Chrome may have already closed the empty popup window.
    }
    // Popups join the opener tab's group so session tabs stay together
    const sourceTabInfo = connectedTabs.get(sourceTabId)
    // Popups of remote-owned tabs are remote work: Stop sharing detaches them.
    const runtime = remoteTunnel && isRemoteOwnedTab({ runtime: remoteTunnel, tabId: sourceTabId }) ? remoteTunnel : null
    for (const tabId of tabIds) {
      if (connectedTabs.has(tabId)) continue
      const attach = () => {
        return connectTab(tabId, {
          groupTitle: sourceTabInfo?.groupTitle,
          groupKey: sourceTabInfo?.groupKey,
          groupColor: sourceTabInfo?.groupColor,
        })
      }
      try {
        await (runtime ? attachForRemote({ runtime, tabId, attach }) : attach())
      } catch (e) {
        logger.warn(`Failed to auto-connect relocated popup tab ${tabId}:`, e)
      }
    }
  } catch (e) {
    logger.warn('Failed to relocate popup window:', e)
  }
})

chrome.contextMenus?.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return

  const tabInfo = store.getState().tabs.get(tab.id)
  if (!tabInfo || tabInfo.state !== 'connected') {
    logger.debug('Tab not connected, ignoring')
    return
  }

  const debuggee = { tabId: tab.id }

  if (info.menuItemId === 'playwriter-pin-element') {
    try {
      // Allocate the next pin name by reading and incrementing the shared MAIN-world
      // counter (window.__playwriterPinCount). This ensures right-click and toolbar
      // pins never produce conflicting globalThis.playwriterPinnedElemN names.
      const jsAllocatePin = js`
        (function() {
          window.__playwriterPinCount = (window.__playwriterPinCount || 0) + 1;
          return window.__playwriterPinCount;
        })()
      `
      const counterResult = (await chrome.debugger.sendCommand(debuggee, 'Runtime.evaluate', {
        expression: jsAllocatePin,
        returnByValue: true,
      })) as { result?: { value?: number }; exceptionDetails?: { text: string } }

      const count = counterResult.result?.value ?? 1
      const name = `playwriterPinnedElem${count}`

      const jsAssignPin = js`
        if (window.__playwriter_lastRightClicked) {
          window.${name} = window.__playwriter_lastRightClicked;
          '${name}';
        } else {
          throw new Error('No element was right-clicked');
        }
      `
      const result = (await chrome.debugger.sendCommand(debuggee, 'Runtime.evaluate', {
        expression: jsAssignPin,
        returnByValue: true,
      })) as { result?: { value?: string }; exceptionDetails?: { text: string } }

      if (result.exceptionDetails) {
        logger.error('Failed to pin element:', result.exceptionDetails.text)
        return
      }

      const code = buildPinnedElementInspectionCode({ pinName: name, url: tab.url || '' })
      const clipboardText = "playwriter -e '" + code + "'"

      const jsPinFlashAndCopy = js`
        (() => {
          const el = window.${name};
          if (!el) return;
          const orig = el.getAttribute('style') || '';
          el.setAttribute('style', orig + '; outline: 3px solid #22c55e !important; outline-offset: 2px !important; box-shadow: 0 0 0 3px #22c55e !important;');
          setTimeout(() => el.setAttribute('style', orig), 300);
          return navigator.clipboard.writeText(${JSON.stringify(clipboardText)});
        })()
      `
      await chrome.debugger.sendCommand(debuggee, 'Runtime.evaluate', {
        expression: jsPinFlashAndCopy,
        awaitPromise: true,
        userGesture: true,
      })

      logger.debug('Pinned element as:', name)
    } catch (error: any) {
      logger.error('Failed to pin element:', error.message)
    }
  }

  if (info.menuItemId === 'playwriter-copy-react-source') {
    try {
      // Inject bippy (React fiber introspection) if not already present.
      // bippy exposes globalThis.__bippy with methods to walk the React fiber tree
      // and resolve source file locations from React DevTools metadata.
      const hasBippy = (await chrome.debugger.sendCommand(debuggee, 'Runtime.evaluate', {
        expression: '!!globalThis.__bippy',
        returnByValue: true,
      })) as { result?: { value?: boolean } }

      if (!hasBippy.result?.value) {
        await chrome.debugger.sendCommand(debuggee, 'Runtime.evaluate', {
          expression: bippyBundleCode,
        })
      }

      // Walk from the right-clicked DOM element up through React fiber tree to find
      // the nearest composite component with source location info. Uses bippy's
      // getSource() first (direct __source prop from JSX transform), then falls back
      // to getOwnerStack() for production builds with source maps.
      const jsResolveSource = js`
        (async () => {
          const el = window.__playwriter_lastRightClicked;
          if (!el) return JSON.stringify({ error: 'No element was right-clicked' });

          const bippy = globalThis.__bippy;
          if (!bippy) return JSON.stringify({ error: 'bippy not loaded' });

          // bippy.normalizeFileName strips "/app-pages-browser/" but not the parenthesized
          // form "/(app-pages-browser)/" that Next.js webpack actually uses. This regex
          // strips all Next.js webpack layer prefixes: (app-pages-browser), (ssr), (rsc),
          // (action-browser), (pages-dir-browser), (pages-dir-edge), (pages-dir-node).
          // Also strips leading "./" that often follows the layer prefix.
          const cleanFileName = (name) => {
            let f = bippy.normalizeFileName(name);
            f = f.replace(/^\/?\\([-\\w]+\\)\\//, '');
            f = f.replace(/^\\.[\\/]/, '');
            return f;
          };

          let fiber;
          try { fiber = bippy.getFiberFromHostInstance(el); } catch {}
          if (!fiber) return JSON.stringify({ error: 'No React fiber found. Is this a React app?' });

          // Walk up to find nearest composite fiber with source info
          let current = fiber;
          for (let i = 0; i < 50 && current; i++) {
            try {
              if (bippy.isCompositeFiber(current)) {
                const source = await bippy.getSource(current);
                if (source && source.fileName && bippy.isSourceFile(source.fileName)) {
                  return JSON.stringify({
                    fileName: cleanFileName(source.fileName),
                    lineNumber: source.lineNumber || null,
                    columnNumber: source.columnNumber || null,
                    componentName: source.functionName || bippy.getDisplayName(current.type) || null,
                  });
                }
                // Try owner stack as fallback for this fiber
                const ownerStack = await bippy.getOwnerStack(current);
                for (const frame of ownerStack) {
                  if (frame.fileName && bippy.isSourceFile(frame.fileName)) {
                    return JSON.stringify({
                      fileName: cleanFileName(frame.fileName),
                      lineNumber: frame.lineNumber || null,
                      columnNumber: frame.columnNumber || null,
                      componentName: frame.functionName || bippy.getDisplayName(current.type) || null,
                    });
                  }
                }
              }
            } catch {}
            current = current.return;
          }
          return JSON.stringify({ error: 'No React source location found. Is this a dev build with source maps?' });
        })()
      `
      const sourceResult = (await chrome.debugger.sendCommand(debuggee, 'Runtime.evaluate', {
        expression: jsResolveSource,
        returnByValue: true,
        awaitPromise: true,
      })) as { result?: { value?: string }; exceptionDetails?: { text: string } }

      if (sourceResult.exceptionDetails) {
        logger.error('Failed to get React source:', sourceResult.exceptionDetails.text)
        return
      }

      const parsed = JSON.parse(sourceResult.result?.value || '{}')

      if (!parsed.fileName && !parsed.error) {
        parsed.error = 'React source result missing fileName'
      }

      if (parsed.error) {
        // Flash red outline on the element to indicate no React source found
        const jsFlashRed = js`
          (() => {
            const el = window.__playwriter_lastRightClicked;
            if (!el) return;
            const orig = el.getAttribute('style') || '';
            el.setAttribute('style', orig + '; outline: 3px solid #ef4444 !important; outline-offset: 2px !important;');
            setTimeout(() => el.setAttribute('style', orig), 600);
          })()
        `
        await chrome.debugger.sendCommand(debuggee, 'Runtime.evaluate', {
          expression: jsFlashRed,
        })
        logger.debug('React source not found:', parsed.error)
        return
      }

      // Build clipboard text: "path/to/file.tsx:42" or "path/to/file.tsx" if no line
      const clipboardText: string = (() => {
        if (parsed.lineNumber) {
          return `${parsed.fileName}:${parsed.lineNumber}`
        }
        return parsed.fileName
      })()

      // Flash green outline and copy to clipboard
      const jsFlashGreenAndCopy = js`
        (() => {
          const el = window.__playwriter_lastRightClicked;
          if (!el) return;
          const orig = el.getAttribute('style') || '';
          el.setAttribute('style', orig + '; outline: 3px solid #22c55e !important; outline-offset: 2px !important; box-shadow: 0 0 0 3px #22c55e !important;');
          setTimeout(() => el.setAttribute('style', orig), 300);
          return navigator.clipboard.writeText(${JSON.stringify(clipboardText)});
        })()
      `
      await chrome.debugger.sendCommand(debuggee, 'Runtime.evaluate', {
        expression: jsFlashGreenAndCopy,
        awaitPromise: true,
        userGesture: true,
      })

      logger.debug('Copied React source path:', clipboardText, 'component:', parsed.componentName)
    } catch (error: any) {
      logger.error('Failed to copy React source:', error.message)
    }
  }
})

// Sync icons on first load
void updateIcons()

function toastToolbar(tabId: number, msg: string): void {
  chrome.scripting
    .executeScript({
      target: { tabId, allFrames: false },
      world: 'ISOLATED',
      func: (text: string) => {
        window.__playwriterToolbarShowToast?.(text)
      },
      args: [msg],
    })
    .catch(() => {})
}

function playToolbarSound(tabId: number, name: string): void {
  chrome.scripting
    .executeScript({
      target: { tabId, allFrames: false },
      world: 'ISOLATED',
      func: (soundName: string) => {
        window.__playwriterToolbarPlaySound?.(soundName)
      },
      args: [name],
    })
    .catch(() => {})
}

async function copyTextInOffscreenDocument(text: string): Promise<void> {
  await ensureOffscreenDocument()
  const result: OffscreenCopyTextResult = await chrome.runtime.sendMessage({ action: 'copyText', text })
  if (!result.success) {
    throw new Error('Could not copy toolbar prompt', { cause: new Error(result.error) })
  }
}

// Handle messages from content scripts (recorder commands) and offscreen document (recording chunks)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'copyToolbarText') {
    const senderTabId = sender.tab?.id
    if (
      !senderTabId ||
      sender.frameId !== 0 ||
      store.getState().tabs.get(senderTabId)?.state !== 'connected' ||
      typeof message.text !== 'string'
    ) {
      return false
    }
    void copyTextInOffscreenDocument(message.text).then(
      () => {
        sendResponse({ success: true })
      },
      (error: Error) => {
        logger.error('Could not copy toolbar text:', error)
        sendResponse({ success: false })
      },
    )
    return true
  }

  if (message.action === 'pinToolbarElement') {
    const senderTabId = sender.tab?.id
    if (
      !senderTabId ||
      sender.frameId !== 0 ||
      store.getState().tabs.get(senderTabId)?.state !== 'connected' ||
      typeof message.marker !== 'string'
    ) {
      return false
    }
    void chrome.scripting
      .executeScript({
        target: { tabId: senderTabId, frameIds: [0] },
        world: 'MAIN',
        func: (marker: string) => {
          const target = Array.from(document.querySelectorAll('[data-playwriter-pin-target]')).find((element) => {
            return element.getAttribute('data-playwriter-pin-target') === marker
          })
          if (!target) {
            return null
          }
          const pinNumber = (window.__playwriterPinCount || 0) + 1
          window.__playwriterPinCount = pinNumber
          window[`playwriterPinnedElem${pinNumber}`] = target
          target.removeAttribute('data-playwriter-pin-target')
          return pinNumber
        },
        args: [message.marker],
      })
      .then((results) => {
        sendResponse({ pinNumber: results[0]?.result || undefined })
      })
      .catch((error: Error) => {
        logger.error('Could not pin toolbar element:', error)
        sendResponse({})
      })
    return true
  }

  if (message.action === 'remoteControlStart') {
    const senderTabId = sender.tab?.id
    if (!senderTabId || sender.frameId !== 0 || store.getState().tabs.get(senderTabId)?.state !== 'connected') {
      return false
    }
    void (async () => {
      try {
        const { started, id } = await startRemoteControl(senderTabId)
        const prompt = buildRemoteControlPrompt({ id })
        try {
          await copyTextInOffscreenDocument(prompt)
        } catch (error) {
          if (started) {
            stopRemoteControl()
          }
          throw error
        }
        toastToolbar(senderTabId, 'Copied prompt')
        playToolbarSound(senderTabId, 'success')
      } catch (error: any) {
        logger.error('Remote control start failed:', error)
        toastToolbar(senderTabId, `Remote control failed: ${error.message}`)
      }
    })()
    return false
  }

  if (message.action === 'remoteControlStop') {
    const senderTabId = sender.tab?.id
    if (!senderTabId || sender.frameId !== 0 || store.getState().tabs.get(senderTabId)?.state !== 'connected') {
      return false
    }
    stopRemoteControl()
    toastToolbar(senderTabId, 'Sharing stopped')
    playToolbarSound(senderTabId, 'click')
    return false
  }

  if (
    message.action === 'remoteControlCopyUrl' ||
    message.action === 'remoteControlCopyPrompt' ||
    message.action === 'remoteControlCopyId'
  ) {
    const senderTabId = sender.tab?.id
    if (!senderTabId || sender.frameId !== 0 || store.getState().tabs.get(senderTabId)?.state !== 'connected') {
      return false
    }
    const runtime = remoteTunnel
    if (!runtime) {
      toastToolbar(senderTabId, 'Remote control is not active')
      return false
    }
    const { text, toast } = ((): { text: string; toast: string } => {
      if (message.action === 'remoteControlCopyPrompt') {
        return { text: buildRemoteControlPrompt({ id: runtime.tunnelId }), toast: 'Copied prompt' }
      }
      if (message.action === 'remoteControlCopyId') {
        return { text: runtime.tunnelId, toast: 'Copied id' }
      }
      return { text: runtime.tunnel.url, toast: 'Copied URL' }
    })()
    void copyTextInOffscreenDocument(text)
      .then(() => {
        toastToolbar(senderTabId, toast)
        playToolbarSound(senderTabId, 'success')
      })
      .catch((error: Error) => {
        logger.error('Remote control copy failed:', error)
        toastToolbar(senderTabId, `Copy failed: ${error.message}`)
      })
    return false
  }

  // Action recorder start/stop: isolated toolbar → service worker → relay HTTP endpoint.
  if (message.action === 'actionRecorderStart') {
    const senderTabId = sender.tab?.id
    if (!senderTabId || sender.frameId !== 0 || store.getState().tabs.get(senderTabId)?.state !== 'connected') {
      return false
    }
    if (toolbarRecordingId || toolbarStartInFlight) {
      return false
    }
    toolbarStartInFlight = true
    fetch(`http://${RELAY_HOST}:${RELAY_PORT}/recorder/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
      .then(async (response) => {
        const result = (await response.json().catch(() => {
          return {}
        })) as { error?: string; recordingId?: string }
        if (response.ok && result.recordingId) {
          toolbarRecordingId = result.recordingId
          if (senderTabId) {
            setRecorderStateInTab(senderTabId, true)
          }
          return
        }
        logger.error('Action recorder start failed:', result.error || response.status)
        if (!senderTabId) {
          return
        }
        setRecorderStateInTab(senderTabId, false)
        toastToolbar(senderTabId, result.error || 'Failed to start recording')
      })
      .catch((err) => {
        logger.error('Action recorder start failed:', err)
        if (!senderTabId) {
          return
        }
        setRecorderStateInTab(senderTabId, false)
        toastToolbar(senderTabId, 'Failed to start recording')
      })
      .finally(() => {
        toolbarStartInFlight = false
      })
    return false
  }

  if (message.action === 'actionRecorderStop') {
    const senderTabId = sender.tab?.id
    if (!senderTabId || sender.frameId !== 0 || store.getState().tabs.get(senderTabId)?.state !== 'connected') {
      return false
    }
    fetch(`http://${RELAY_HOST}:${RELAY_PORT}/recorder/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toolbarRecordingId ? { recordingId: toolbarRecordingId } : {}),
    })
      .then((r) => r.json())
      .then(async (result: { recordingId?: string; error?: string }) => {
        if (!result.recordingId) {
          logger.error('Action recorder stop failed:', result.error || 'unknown')
          if (senderTabId) {
            toastToolbar(senderTabId, result.error || 'Failed to stop recording')
          }
          return
        }
        toolbarRecordingId = null
        if (!senderTabId) return
        const prompt = [
          'I just recorded a browser workflow (recording ' + result.recordingId + ').',
          'Analyze it and create a reusable skill from it.',
          '',
          'First read how Playwriter works (do not skip):',
          'https://playwriter.dev/SKILL.md',
          '',
          'Then run:',
          'playwriter recorder events -r ' + result.recordingId,
        ].join('\n')
        setRecorderStateInTab(senderTabId, false)
        try {
          await copyTextInOffscreenDocument(prompt)
          toastToolbar(senderTabId, 'Copied prompt')
          playToolbarSound(senderTabId, 'success')
        } catch (error) {
          logger.error('Could not copy recorder prompt:', error)
          toastToolbar(senderTabId, `Copy failed. Run: playwriter recorder events -r ${result.recordingId}`)
        }
      })
      .catch((err) => {
        logger.error('Action recorder stop failed:', err)
      })
    return false
  }

  if (message.action === 'recordingChunk') {
    try {
      const result = sendRecordingChunk({
        tabId: message.tabId,
        data: typeof message.dataBase64 === 'string' ? decodeRecordingChunk(message.dataBase64) : undefined,
        final: message.final,
      })
      sendResponse(result)
    } catch (error) {
      sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) })
    }
    return true
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

    sendRecordingCancellation(tabId)

    sendResponse({ success: true })
    return true
  }

  return false
})

// Re-inject the toolbar after hard navigations in connected tabs.
// The isolated script is destroyed on every full page load, so we re-run
// initPlaywriterToolbar once the new document's DOM is ready.
// onDOMContentLoaded is used instead of onCommitted because executeScript
// after the new document exists.
// Note: SPA route changes (pushState/replaceState) don't trigger this because
// the document is not reset — the toolbar DOM persists across SPA navigations.
chrome.webNavigation.onDOMContentLoaded.addListener((details) => {
  if (details.frameId !== 0) return // top frame only
  const { tabs } = store.getState()
  const tabInfo = tabs.get(details.tabId)
  if (!tabInfo || tabInfo.state !== 'connected') return

  chrome.scripting
    .executeScript({
      target: { tabId: details.tabId, allFrames: false },
      world: 'ISOLATED',
      func: initPlaywriterToolbar,
    })
    .then(() => {
      syncToolbarState(details.tabId)
    })
    .catch((err: Error) => {
      logger.debug('Could not re-inject toolbar after navigation:', err.message)
    })
})
