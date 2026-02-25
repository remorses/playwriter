import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import { getConnInfo } from '@hono/node-server/conninfo'
import { createNodeWebSocket } from '@hono/node-ws'
import type { WSContext } from 'hono/ws'
import type { Protocol } from './cdp-types.js'
import type { CDPCommand, CDPResponseBase, CDPEventBase, CDPEventFor, RelayServerEvents } from './cdp-types.js'
import type {
  ExtensionMessage,
  ExtensionEventMessage,
  RecordingDataMessage,
  RecordingCancelledMessage,
  StartRecordingBody,
  StopRecordingParams,
  CancelRecordingParams,
  IsRecordingParams,
} from './protocol.js'
import pc from 'picocolors'
import util from 'node:util'

// Prevent Buffers from dumping hex bytes in util.inspect output.
Buffer.prototype[util.inspect.custom] = function () {
  return `<Buffer ${this.length} bytes>`
}

import { EventEmitter } from 'node:events'
import { VERSION, EXTENSION_IDS } from './utils.js'
import { createCdpLogger, type CdpLogEntry, type CdpLogger } from './cdp-log.js'
import { RecordingRelay } from './recording-relay.js'

type ConnectedTarget = {
  sessionId: string
  targetId: string
  targetInfo: Protocol.Target.TargetInfo
  frameIds: Set<string>
}

/**
 * Checks if a target should be filtered out (not exposed to Playwright).
 * Filters extension pages, service workers, and other restricted targets,
 * but allows our own extension pages for debugging purposes.
 */
function isRestrictedTarget(targetInfo: Protocol.Target.TargetInfo): boolean {
  const { url, type } = targetInfo

  // Filter by type - allow pages and iframe targets (OOPIFs)
  if (type !== 'page' && type !== 'iframe') {
    return true
  }

  // Filter by URL - block extension and chrome internal pages
  if (!url) {
    return false
  }

  // Allow our own extension pages
  if (url.startsWith('chrome-extension://')) {
    const extensionId = url.replace('chrome-extension://', '').split('/')[0]
    if (EXTENSION_IDS.includes(extensionId)) {
      return false
    }
    return true
  }

  // Block other restricted URLs
  const blockedPrefixes = ['chrome://', 'devtools://', 'edge://']
  return blockedPrefixes.some((prefix) => url.startsWith(prefix))
}

type PlaywrightClient = {
  id: string
  ws: WSContext
  extensionId: string | null
}

type ExtensionInfo = {
  browser?: string
  email?: string
  id?: string
  /** playwriter package version the extension was built with (sent as ?v= query param) */
  version?: string
}

type ExtensionConnection = {
  id: string
  ws: WSContext
  info: ExtensionInfo
  stableKey: string
  connectedTargets: Map<string, ConnectedTarget>
  pendingRequests: Map<number, { resolve: (result: any) => void; reject: (error: Error) => void }>
  messageId: number
  pingInterval: ReturnType<typeof setInterval> | null
}

export type RelayServer = {
  close(): void
  on<K extends keyof RelayServerEvents>(event: K, listener: RelayServerEvents[K]): void
  off<K extends keyof RelayServerEvents>(event: K, listener: RelayServerEvents[K]): void
}

export async function startPlayWriterCDPRelayServer({
  port = 19988,
  host = '127.0.0.1',
  token,
  logger,
  cdpLogger,
}: {
  port?: number
  host?: string
  token?: string
  logger?: { log(...args: any[]): void; error(...args: any[]): void }
  cdpLogger?: CdpLogger
} = {}): Promise<RelayServer> {
  const emitter = new EventEmitter()
  const extensionConnections = new Map<string, ExtensionConnection>()
  const extensionKeyIndex = new Map<string, string>()

  const resolvedCdpLogger = cdpLogger || createCdpLogger()
  const logCdpJson = (entry: CdpLogEntry) => {
    resolvedCdpLogger.log(entry)
  }
  const playwrightClients = new Map<string, PlaywrightClient>()

  const getDefaultExtensionId = (): string | null => {
    return extensionConnections.keys().next().value || null
  }

  const getExtensionConnection = (
    extensionId?: string | null,
    options: { allowFallback?: boolean } = {},
  ): ExtensionConnection | null => {
    if (extensionId) {
      const direct = extensionConnections.get(extensionId)
      if (direct) {
        return direct
      }
      const mappedId = extensionKeyIndex.get(extensionId)
      if (mappedId) {
        return extensionConnections.get(mappedId) || null
      }
      return null
    }

    if (!options.allowFallback) {
      return null
    }

    // Single extension — use it directly
    if (extensionConnections.size === 1) {
      const fallbackId = getDefaultExtensionId()
      if (fallbackId) {
        return extensionConnections.get(fallbackId) || null
      }
    }

    // Multiple extensions — auto-select if exactly one has active targets.
    // This handles the common case of multiple Chrome profiles with the extension
    // installed, where only one profile has playwriter-enabled tabs. (#52)
    if (extensionConnections.size > 1) {
      const activeExtensions = Array.from(extensionConnections.values()).filter((ext) => {
        return ext.connectedTargets.size > 0
      })
      if (activeExtensions.length === 1) {
        return activeExtensions[0]
      }
    }

    return null
  }

  const buildStableExtensionKey = (info: ExtensionInfo, connectionId: string): string => {
    if (info.id) {
      return `profile:${info.id}`
    }
    if (info.email) {
      return `email:${info.email}`
    }
    if (info.browser) {
      return `browser:${info.browser}`
    }
    return `connection:${connectionId}`
  }

  const normalizeSessionId = (value: string | number | null | undefined): string | null => {
    if (value === undefined || value === null) {
      return null
    }
    const normalized = String(value)
    return normalized ? normalized : null
  }

  const getPageTargetForFrameId = ({
    connection,
    frameId,
  }: {
    connection: ExtensionConnection
    frameId: string
  }): ConnectedTarget | undefined => {
    return Array.from(connection.connectedTargets.values()).find((target) => {
      return target.targetInfo.type === 'page' && target.frameIds.has(frameId)
    })
  }

  const startExtensionPing = (extensionId: string): void => {
    const connection = extensionConnections.get(extensionId)
    if (!connection) {
      return
    }
    if (connection.pingInterval) {
      clearInterval(connection.pingInterval)
    }
    connection.pingInterval = setInterval(() => {
      connection.ws.send(JSON.stringify({ method: 'ping' }))
    }, 5000)
  }

  const stopExtensionPing = (extensionId: string): void => {
    const connection = extensionConnections.get(extensionId)
    if (!connection || !connection.pingInterval) {
      return
    }
    clearInterval(connection.pingInterval)
    connection.pingInterval = null
  }

  function logCdpMessage({
    direction,
    clientId,
    method,
    sessionId,
    params,
    id,
    source,
  }: {
    direction: 'to-playwright' | 'from-playwright' | 'from-extension'
    clientId?: string
    method: string
    sessionId?: string
    params?: any
    id?: number
    source?: 'extension' | 'server'
  }) {
    const noisyEvents = [
      'Network.requestWillBeSentExtraInfo',
      'Network.responseReceived',
      'Network.responseReceivedExtraInfo',
      'Network.dataReceived',
      'Network.requestWillBeSent',
      'Network.loadingFinished',
    ]

    if (noisyEvents.includes(method)) {
      return
    }

    const details: string[] = []

    if (id !== undefined) {
      details.push(`id=${id}`)
    }

    if (sessionId) {
      details.push(`sessionId=${sessionId}`)
    }

    if (params) {
      if (params.targetId) {
        details.push(`targetId=${params.targetId}`)
      }
      if (params.targetInfo?.targetId) {
        details.push(`targetId=${params.targetInfo.targetId}`)
      }
      if (params.sessionId && params.sessionId !== sessionId) {
        details.push(`sessionId=${params.sessionId}`)
      }
    }

    const detailsStr = details.length > 0 ? ` ${pc.gray(details.join(', '))}` : ''

    if (direction === 'from-playwright') {
      const clientLabel = clientId ? pc.blue(`[${clientId}]`) : ''
      logger?.log(pc.cyan('← Playwright'), clientLabel + ':', method + detailsStr)
    } else if (direction === 'from-extension') {
      logger?.log(pc.yellow('← Extension:'), method + detailsStr)
    } else if (direction === 'to-playwright') {
      const color = source === 'server' ? pc.magenta : pc.green
      const sourceLabel = source === 'server' ? pc.gray(' (server-generated)') : ''
      const clientLabel = clientId ? pc.blue(`[${clientId}]`) : pc.blue('[ALL]')
      logger?.log(color('→ Playwright'), clientLabel + ':', method + detailsStr + sourceLabel)
    }
  }

  function sendToPlaywright({
    message,
    clientId,
    source = 'extension',
    extensionId,
  }: {
    message: CDPResponseBase | CDPEventBase
    clientId?: string
    source?: 'extension' | 'server'
    extensionId?: string | null
  }) {
    const messageToSend = source === 'server' && 'method' in message ? { ...message, __serverGenerated: true } : message

    logCdpJson({
      timestamp: new Date().toISOString(),
      direction: 'to-playwright',
      clientId,
      source,
      message: messageToSend,
    })

    if ('method' in message) {
      logCdpMessage({
        direction: 'to-playwright',
        clientId,
        method: message.method,
        sessionId: 'sessionId' in message ? message.sessionId : undefined,
        params: 'params' in message ? message.params : undefined,
        source,
      })
    }

    const messageStr = JSON.stringify(messageToSend)

    // Helper to safely send to a WebSocket, catching errors from closing connections.
    // When a Playwright client closes its WebSocket, there's a race window where:
    // 1. Playwright's _onClose runs (clears callbacks map)
    // 2. We might still have messages in flight or try to send
    // This can cause "Assertion error" in Playwright's crConnection.js if a response
    // arrives after callbacks were cleared. We wrap in try-catch to handle this gracefully.
    const safeSend = (client: PlaywrightClient) => {
      try {
        client.ws.send(messageStr)
      } catch (e) {
        // WebSocket might be closing/closed - this is expected during disconnect
        logger?.log(pc.gray(`[Relay] Skipped sending to closing client ${client.id}: ${(e as Error).message}`))
      }
    }

    if (clientId) {
      const client = playwrightClients.get(clientId)
      if (client) {
        safeSend(client)
      }
    } else {
      const clients = Array.from(playwrightClients.values())
      for (const client of clients) {
        if (extensionId && client.extensionId !== extensionId) {
          continue
        }
        safeSend(client)
      }
    }
  }

  type ForwardCdpParams = {
    method: string
    sessionId?: string
    params?: unknown
  }

  function getForwardCdpParams(value: unknown): ForwardCdpParams | undefined {
    if (!value || typeof value !== 'object') {
      return undefined
    }
    const record = value as { method?: unknown; sessionId?: unknown; params?: unknown }
    if (typeof record.method !== 'string') {
      return undefined
    }
    const sessionId = typeof record.sessionId === 'string' ? record.sessionId : undefined
    return { method: record.method, sessionId, params: record.params }
  }

  async function sendToExtension({
    extensionId,
    method,
    params,
    timeout = 30000,
  }: {
    extensionId?: string | null
    method: string
    params?: unknown
    timeout?: number
  }): Promise<unknown> {
    const connection = getExtensionConnection(extensionId)
    if (!connection) {
      throw new Error('Extension not connected')
    }

    const id = ++connection.messageId
    const message = { id, method, params }

    const forwardCdpParams = method === 'forwardCDPCommand' ? getForwardCdpParams(params) : undefined
    if (forwardCdpParams) {
      logCdpJson({
        timestamp: new Date().toISOString(),
        direction: 'to-extension',
        message: {
          method: forwardCdpParams.method,
          sessionId: forwardCdpParams.sessionId,
          params: forwardCdpParams.params,
        },
      })
    }

    connection.ws.send(JSON.stringify(message))

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        connection.pendingRequests.delete(id)
        reject(new Error(`Extension request timeout after ${timeout}ms: ${method}`))
      }, timeout)

      connection.pendingRequests.set(id, {
        resolve: (result) => {
          clearTimeout(timeoutId)
          resolve(result)
        },
        reject: (error) => {
          clearTimeout(timeoutId)
          reject(error)
        },
      })
    })
  }

  const recordingRelays = new Map<string, RecordingRelay>()

  // Find which extension connection owns a CDP tab session ID (pw-tab-*).
  // Used by recording routes where sessionId identifies the target tab.
  // Searches all connected extensions' targets.
  const findExtensionIdByCdpSession = (cdpSessionId: string): string | null => {
    for (const [connectionId, connection] of extensionConnections.entries()) {
      if (connection.connectedTargets.has(cdpSessionId)) {
        return connectionId
      }
    }
    return null
  }

  // Resolve recording route session ID (CDP tab session) to extension connection.
  const resolveRecordingRoute = async ({
    sessionId,
  }: {
    sessionId: string | null
  }): Promise<{
    extensionId: string | null
    sessionId: string | null
  }> => {
    if (!sessionId) {
      return { extensionId: null, sessionId: null }
    }

    const extensionId = findExtensionIdByCdpSession(sessionId)
    return { extensionId, sessionId }
  }

  const getRecordingRelay = (extensionId?: string | null): RecordingRelay | null => {
    const allowDefault = !extensionId && extensionConnections.size === 1
    const connection = getExtensionConnection(extensionId, { allowFallback: allowDefault })
    if (!connection) {
      return null
    }
    if (!recordingRelays.has(connection.id)) {
      recordingRelays.set(
        connection.id,
        new RecordingRelay(
          (params) => sendToExtension({ extensionId: connection.id, ...params }),
          () => extensionConnections.has(connection.id),
          logger,
        ),
      )
    }
    return recordingRelays.get(connection.id) || null
  }

  // Auto-create initial tab when PLAYWRITER_AUTO_ENABLE is set and no targets exist.
  // This allows Playwright to connect and immediately have a page to work with.
  async function maybeAutoCreateInitialTab(extensionId: string): Promise<void> {
    if (!process.env.PLAYWRITER_AUTO_ENABLE) {
      return
    }
    const connection = getExtensionConnection(extensionId)
    if (!connection) {
      return
    }
    if (connection.connectedTargets.size > 0) {
      return
    }

    try {
      logger?.log(pc.blue('Auto-creating initial tab for Playwright client'))
      const result = (await sendToExtension({ extensionId, method: 'createInitialTab', timeout: 10000 })) as {
        success: boolean
        tabId: number
        sessionId: string
        targetInfo: Protocol.Target.TargetInfo
      }
      if (result.success && result.sessionId && result.targetInfo) {
        connection.connectedTargets.set(result.sessionId, {
          sessionId: result.sessionId,
          targetId: result.targetInfo.targetId,
          targetInfo: result.targetInfo,
          frameIds: new Set(),
        })
        logger?.log(
          pc.blue(
            `Auto-created tab, now have ${connection.connectedTargets.size} targets, url: ${result.targetInfo.url}`,
          ),
        )
      }
    } catch (e) {
      logger?.error('Failed to auto-create initial tab:', e)
    }
  }

  async function routeCdpCommand({
    extensionId,
    method,
    params,
    sessionId,
    source,
  }: {
    extensionId: string | null
    method: string
    params: any
    sessionId?: string
    source?: 'playwriter'
  }) {
    const extension = getExtensionConnection(extensionId)
    const connectedTargets = extension?.connectedTargets || new Map<string, ConnectedTarget>()
    switch (method) {
      case 'Browser.getVersion': {
        return {
          protocolVersion: '1.3',
          product: 'Chrome/Extension-Bridge',
          revision: '1.0.0',
          userAgent: 'CDP-Bridge-Server/1.0.0',
          jsVersion: 'V8',
        } satisfies Protocol.Browser.GetVersionResponse
      }

      case 'Browser.setDownloadBehavior': {
        return {}
      }

      // Target.setAutoAttach is a CDP command Playwright sends on first connection.
      // We use it as the hook to auto-create an initial tab. If Playwright changes
      // its initialization sequence in the future, this could be moved to a different command.
      case 'Target.setAutoAttach': {
        if (sessionId) {
          break
        }
        if (extension) {
          await maybeAutoCreateInitialTab(extension.id)
        }
        // Forward auto-attach so Chrome emits iframe Target.attachedToTarget events.
        // Playwright relies on these (with parentFrameId) when reconnecting over CDP.
        await sendToExtension({
          extensionId: extension?.id || extensionId,
          method: 'forwardCDPCommand',
          params: { method, params, source },
        })
        return {}
      }

      case 'Target.setDiscoverTargets': {
        return {}
      }

      case 'Target.attachToTarget': {
        const targetId = params?.targetId
        if (!targetId) {
          throw new Error('targetId is required for Target.attachToTarget')
        }

        for (const target of connectedTargets.values()) {
          if (target.targetId === targetId) {
            return { sessionId: target.sessionId } satisfies Protocol.Target.AttachToTargetResponse
          }
        }

        throw new Error(`Target ${targetId} not found in connected targets`)
      }

      case 'Target.getTargetInfo': {
        const targetId = params?.targetId

        if (targetId) {
          for (const target of connectedTargets.values()) {
            if (target.targetId === targetId) {
              return { targetInfo: target.targetInfo }
            }
          }
        }

        if (sessionId) {
          const target = connectedTargets.get(sessionId)
          if (target) {
            return { targetInfo: target.targetInfo }
          }
        }

        const firstTarget = Array.from(connectedTargets.values())[0]
        return { targetInfo: firstTarget?.targetInfo }
      }

      case 'Target.getTargets': {
        return {
          targetInfos: Array.from(connectedTargets.values())
            .filter((t) => !isRestrictedTarget(t.targetInfo))
            .map((t) => ({
              ...t.targetInfo,
              attached: true,
            })),
        }
      }

      case 'Target.createTarget': {
        return await sendToExtension({
          extensionId: extension?.id || extensionId,
          method: 'forwardCDPCommand',
          params: { method, params, source },
        })
      }

      case 'Target.closeTarget': {
        return await sendToExtension({
          extensionId: extension?.id || extensionId,
          method: 'forwardCDPCommand',
          params: { method, params, source },
        })
      }

      // Ghost Browser API - forward to extension for chrome.ghostPublicAPI/ghostProxies/projects
      case 'ghost-browser': {
        return await sendToExtension({
          extensionId: extension?.id || extensionId,
          method: 'ghost-browser',
          params,
        })
      }

      case 'Runtime.enable': {
        if (!sessionId) {
          break
        }

        const contextCreatedPromise = new Promise<void>((resolve) => {
          const handler = ({ event }: { event: CDPEventBase }) => {
            if (event.method === 'Runtime.executionContextCreated' && event.sessionId === sessionId) {
              const params = event.params as Protocol.Runtime.ExecutionContextCreatedEvent | undefined
              if (params?.context?.auxData?.isDefault === true) {
                clearTimeout(timeout)
                emitter.off('cdp:event', handler)
                resolve()
              }
            }
          }
          const timeout = setTimeout(() => {
            emitter.off('cdp:event', handler)
            logger?.log(
              pc.yellow(
                `IMPORTANT: Runtime.enable timed out waiting for main frame executionContextCreated (sessionId: ${sessionId}). This may cause pages to not be visible immediately.`,
              ),
            )
            resolve()
          }, 3000)
          emitter.on('cdp:event', handler)
        })

        const result = await sendToExtension({
          extensionId: extension?.id || extensionId,
          method: 'forwardCDPCommand',
          params: { sessionId, method, params, source },
        })

        await contextCreatedPromise

        return result
      }
    }

    return await sendToExtension({
      extensionId: extension?.id || extensionId,
      method: 'forwardCDPCommand',
      params: { sessionId, method, params, source },
    })
  }

  const app = new Hono()
  // CORS middleware for HTTP endpoints - only allows our specific extension IDs.
  // This prevents other extensions from reading responses via fetch/XHR.
  // WebSocket connections have their own separate origin validation.
  app.use(
    '*',
    cors({
      origin: (origin) => {
        if (!origin.startsWith('chrome-extension://')) {
          return null
        }
        const extensionId = origin.replace('chrome-extension://', '')
        if (!EXTENSION_IDS.includes(extensionId)) {
          return null
        }
        return origin
      },
      allowMethods: ['GET', 'POST', 'HEAD', 'OPTIONS'],
    }),
  )
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })

  const getCdpWsUrl = (c: { req: { header: (name: string) => string | undefined } }) => {
    const hostHeader = c.req.header('host') || `${host}:${port}`
    return `ws://${hostHeader}/cdp`
  }

  app.get('/', (c) => {
    return c.text('OK')
  })

  app.get('/version', (c) => {
    return c.json({ version: VERSION })
  })

  app.get('/extension/status', (c) => {
    const defaultExtension = getExtensionConnection(null, { allowFallback: true })
    const connected = extensionConnections.size > 0
    const activeTargets = defaultExtension?.connectedTargets.size || 0
    const info = defaultExtension?.info

    return c.json({
      connected,
      activeTargets,
      browser: info?.browser || null,
      profile: info ? { email: info.email || '', id: info.id || '' } : null,
      playwriterVersion: info?.version || null,
    })
  })

  app.get('/extensions/status', (c) => {
    const extensions = Array.from(extensionConnections.values()).map((extension) => {
      return {
        extensionId: extension.id,
        stableKey: extension.stableKey,
        browser: extension.info.browser || null,
        profile: extension.info ? { email: extension.info.email || '', id: extension.info.id || '' } : null,
        activeTargets: extension.connectedTargets.size,
        playwriterVersion: extension.info?.version || null,
      }
    })
    return c.json({ extensions })
  })

  // CDP Discovery Endpoints - Standard Chrome DevTools Protocol HTTP API
  // Allows tools like Playwright to discover the WebSocket URL via http://host:port
  // Spec: https://chromium.googlesource.com/chromium/src/+/main/content/browser/devtools/devtools_http_handler.cc

  app
    .on(['GET', 'PUT'], '/json/version', (c) => {
      return c.json({
        Browser: `Playwriter/${VERSION}`,
        'Protocol-Version': '1.3',
        webSocketDebuggerUrl: getCdpWsUrl(c),
      })
    })
    .on(['GET', 'PUT'], '/json/version/', (c) => {
      return c.json({
        Browser: `Playwriter/${VERSION}`,
        'Protocol-Version': '1.3',
        webSocketDebuggerUrl: getCdpWsUrl(c),
      })
    })
    .on(['GET', 'PUT'], '/json/list', (c) => {
      const wsUrl = getCdpWsUrl(c)
      const defaultTargets = getExtensionConnection(null, { allowFallback: true })?.connectedTargets || new Map()
      return c.json(
        Array.from(defaultTargets.values()).map((t) => ({
          id: t.targetId,
          type: t.targetInfo.type,
          title: t.targetInfo.title,
          description: t.targetInfo.title,
          url: t.targetInfo.url,
          webSocketDebuggerUrl: wsUrl,
          devtoolsFrontendUrl: `/devtools/inspector.html?ws=${wsUrl.replace('ws://', '')}`,
        })),
      )
    })
    .on(['GET', 'PUT'], '/json/list/', (c) => {
      const wsUrl = getCdpWsUrl(c)
      const defaultTargets = getExtensionConnection(null, { allowFallback: true })?.connectedTargets || new Map()
      return c.json(
        Array.from(defaultTargets.values()).map((t) => ({
          id: t.targetId,
          type: t.targetInfo.type,
          title: t.targetInfo.title,
          description: t.targetInfo.title,
          url: t.targetInfo.url,
          webSocketDebuggerUrl: wsUrl,
          devtoolsFrontendUrl: `/devtools/inspector.html?ws=${wsUrl.replace('ws://', '')}`,
        })),
      )
    })
    .on(['GET', 'PUT'], '/json', (c) => {
      const wsUrl = getCdpWsUrl(c)
      const defaultTargets = getExtensionConnection(null, { allowFallback: true })?.connectedTargets || new Map()
      return c.json(
        Array.from(defaultTargets.values()).map((t) => ({
          id: t.targetId,
          type: t.targetInfo.type,
          title: t.targetInfo.title,
          description: t.targetInfo.title,
          url: t.targetInfo.url,
          webSocketDebuggerUrl: wsUrl,
          devtoolsFrontendUrl: `/devtools/inspector.html?ws=${wsUrl.replace('ws://', '')}`,
        })),
      )
    })
    .on(['GET', 'PUT'], '/json/', (c) => {
      const wsUrl = getCdpWsUrl(c)
      const defaultTargets = getExtensionConnection(null, { allowFallback: true })?.connectedTargets || new Map()
      return c.json(
        Array.from(defaultTargets.values()).map((t) => ({
          id: t.targetId,
          type: t.targetInfo.type,
          title: t.targetInfo.title,
          description: t.targetInfo.title,
          url: t.targetInfo.url,
          webSocketDebuggerUrl: wsUrl,
          devtoolsFrontendUrl: `/devtools/inspector.html?ws=${wsUrl.replace('ws://', '')}`,
        })),
      )
    })

  app.post('/mcp-log', async (c) => {
    try {
      const { level, args } = await c.req.json()
      const logFn = (logger as any)?.[level] || logger?.log
      const prefix = pc.red(`[MCP] [${level.toUpperCase()}]`)
      logFn?.(prefix, ...args)
      return c.json({ ok: true })
    } catch {
      return c.json({ ok: false }, 400)
    }
  })

  // Validate Origin header for WebSocket connections to prevent cross-origin attacks.
  // Browsers always send Origin header for WebSocket connections, but Node.js clients don't.
  // We only allow our specific extension IDs to prevent malicious websites or extensions
  // from connecting to the local WebSocket server.
  app.get(
    '/cdp/:clientId?',
    (c, next) => {
      const origin = c.req.header('origin')

      // Validate Origin header if present (Node.js clients don't send it)
      if (origin) {
        if (origin.startsWith('chrome-extension://')) {
          const extensionId = origin.replace('chrome-extension://', '')
          if (!EXTENSION_IDS.includes(extensionId)) {
            logger?.log(pc.red(`Rejecting /cdp WebSocket from unknown extension: ${extensionId}`))
            return c.text('Forbidden', 403)
          }
        } else {
          logger?.log(pc.red(`Rejecting /cdp WebSocket from origin: ${origin}`))
          return c.text('Forbidden', 403)
        }
      }

      if (token) {
        const url = new URL(c.req.url, 'http://localhost')
        const providedToken = url.searchParams.get('token')
        if (providedToken !== token) {
          return c.text('Unauthorized', 401)
        }
      }
      return next()
    },
    upgradeWebSocket((c) => {
      const clientId = c.req.param('clientId') || 'default'
      const url = new URL(c.req.url, 'http://localhost')
      const requestedExtensionId = url.searchParams.get('extensionId')
      // When extensionId is explicit, resolve directly. Otherwise use fallback which
      // handles single-extension and uniquely-active-extension cases (#52).
      const resolvedExtension = requestedExtensionId
        ? getExtensionConnection(requestedExtensionId)
        : getExtensionConnection(null, { allowFallback: true })
      const clientExtensionId = resolvedExtension?.id || null

      return {
        async onOpen(_event, ws) {
          if (playwrightClients.has(clientId)) {
            logger?.log(pc.yellow(`Rejecting duplicate Playwright clientId: ${clientId}`))
            ws.close(4004, 'Duplicate Playwright clientId')
            return
          }

          if (!clientExtensionId) {
            const reason = requestedExtensionId
              ? `Unknown extensionId: ${requestedExtensionId}`
              : 'Multiple extensions connected. Specify extensionId.'
            logger?.log(pc.yellow(`Rejecting Playwright client ${clientId}: ${reason}`))
            ws.close(4003, reason)
            return
          }

          // Add client first so it can receive Target.attachedToTarget events
          playwrightClients.set(clientId, { id: clientId, ws, extensionId: clientExtensionId })
          const extensionConnection = getExtensionConnection(clientExtensionId)
          const targetCount = extensionConnection?.connectedTargets.size || 0
          logger?.log(
            pc.green(
              `Playwright client connected: ${clientId} (${playwrightClients.size} total) (extension? ${!!extensionConnection}) (${targetCount} pages)`,
            ),
          )
        },

        async onMessage(event, ws) {
          let message: CDPCommand

          try {
            message = JSON.parse(event.data.toString())
          } catch {
            return
          }

          const { id, sessionId, method, params, source } = message

          logCdpJson({
            timestamp: new Date().toISOString(),
            direction: 'from-playwright',
            clientId,
            message,
          })

          logCdpMessage({
            direction: 'from-playwright',
            clientId,
            method,
            sessionId,
            id,
          })

          emitter.emit('cdp:command', { clientId, command: message })

          const extensionConnection = getExtensionConnection(clientExtensionId)
          if (!extensionConnection) {
            sendToPlaywright({
              message: {
                id,
                sessionId,
                error: { message: 'Extension not connected' },
              },
              clientId,
            })
            return
          }

          try {
            const result: any = await routeCdpCommand({
              extensionId: extensionConnection.id,
              method,
              params,
              sessionId,
              source,
            })

            if (method === 'Target.setAutoAttach' && !sessionId) {
              for (const target of extensionConnection.connectedTargets.values()) {
                // Skip restricted targets (extensions, chrome:// URLs, non-page types)
                if (isRestrictedTarget(target.targetInfo)) {
                  continue
                }
                const attachedPayload = {
                  method: 'Target.attachedToTarget',
                  params: {
                    sessionId: target.sessionId,
                    targetInfo: {
                      ...target.targetInfo,
                      attached: true,
                    },
                    waitingForDebugger: false,
                  },
                } satisfies CDPEventFor<'Target.attachedToTarget'>
                if (!target.targetInfo.url) {
                  logger?.error(
                    pc.red('[Server] WARNING: Target.attachedToTarget sent with empty URL!'),
                    JSON.stringify(attachedPayload),
                  )
                }
                logger?.log(
                  pc.magenta('[Server] Target.attachedToTarget full payload:'),
                  JSON.stringify(attachedPayload),
                )
                sendToPlaywright({
                  message: attachedPayload,
                  clientId,
                  source: 'server',
                })
              }
            }

            if (method === 'Target.setDiscoverTargets' && (params as any)?.discover) {
              for (const target of extensionConnection.connectedTargets.values()) {
                // Skip restricted targets (extensions, chrome:// URLs, non-page types)
                if (isRestrictedTarget(target.targetInfo)) {
                  continue
                }
                const targetCreatedPayload = {
                  method: 'Target.targetCreated',
                  params: {
                    targetInfo: {
                      ...target.targetInfo,
                      attached: true,
                    },
                  },
                } satisfies CDPEventFor<'Target.targetCreated'>
                if (!target.targetInfo.url) {
                  logger?.error(
                    pc.red('[Server] WARNING: Target.targetCreated sent with empty URL!'),
                    JSON.stringify(targetCreatedPayload),
                  )
                }
                logger?.log(
                  pc.magenta('[Server] Target.targetCreated full payload:'),
                  JSON.stringify(targetCreatedPayload),
                )
                sendToPlaywright({
                  message: targetCreatedPayload,
                  clientId,
                  source: 'server',
                })
              }
            }

            if (method === 'Target.attachToTarget' && result?.sessionId) {
              const targetId = params?.targetId
              const target = Array.from(extensionConnection.connectedTargets.values()).find(
                (t) => t.targetId === targetId,
              )
              if (target) {
                const attachedPayload = {
                  method: 'Target.attachedToTarget',
                  params: {
                    sessionId: result.sessionId,
                    targetInfo: {
                      ...target.targetInfo,
                      attached: true,
                    },
                    waitingForDebugger: false,
                  },
                } satisfies CDPEventFor<'Target.attachedToTarget'>
                if (!target.targetInfo.url) {
                  logger?.error(
                    pc.red('[Server] WARNING: Target.attachedToTarget (from attachToTarget) sent with empty URL!'),
                    JSON.stringify(attachedPayload),
                  )
                }
                logger?.log(
                  pc.magenta('[Server] Target.attachedToTarget (from attachToTarget) payload:'),
                  JSON.stringify(attachedPayload),
                )
                sendToPlaywright({
                  message: attachedPayload,
                  clientId,
                  source: 'server',
                })
              }
            }

            const response: CDPResponseBase = { id, sessionId, result }
            sendToPlaywright({ message: response, clientId })
            emitter.emit('cdp:response', { clientId, response, command: message })
          } catch (e) {
            logger?.error('Error handling CDP command:', method, params, e)
            const errorResponse: CDPResponseBase = {
              id,
              sessionId,
              error: { message: (e as Error).message },
            }
            sendToPlaywright({ message: errorResponse, clientId })
            emitter.emit('cdp:response', { clientId, response: errorResponse, command: message })
          }
        },

        onClose() {
          playwrightClients.delete(clientId)
          logger?.log(pc.yellow(`Playwright client disconnected: ${clientId} (${playwrightClients.size} remaining)`))
        },

        onError(event) {
          logger?.error(`Playwright WebSocket error [${clientId}]:`, event)
        },
      }
    }),
  )

  const getExtensionInfoFromRequest = (c: { req: { query: (name: string) => string | undefined } }): ExtensionInfo => {
    const browser = c.req.query('browser')
    const email = c.req.query('email')
    const id = c.req.query('id')
    const version = c.req.query('v')
    return {
      browser: browser || undefined,
      email: email || undefined,
      id: id || undefined,
      version: version || undefined,
    }
  }

  app.get(
    '/extension',
    (c, next) => {
      // 1. Host Validation: The extension endpoint must ONLY be accessed from localhost.
      // This prevents attackers on the network from hijacking the browser session
      // even if the server is exposed via 0.0.0.0.
      const info = getConnInfo(c)
      const remoteAddress = info.remote.address
      const isLocalhost = remoteAddress === '127.0.0.1' || remoteAddress === '::1'

      if (!isLocalhost) {
        logger?.log(pc.red(`Rejecting /extension WebSocket from remote IP: ${remoteAddress}`))
        return c.text('Forbidden - Extension must be local', 403)
      }

      // 2. Origin Validation: Prevent browser-based attacks (CSRF).
      // Browsers cannot spoof the Origin header, so this ensures the connection
      // is coming from our specific Chrome Extension, not a malicious website.
      const origin = c.req.header('origin')
      if (!origin || !origin.startsWith('chrome-extension://')) {
        logger?.log(
          pc.red(`Rejecting /extension WebSocket: origin must be chrome-extension://, got: ${origin || 'none'}`),
        )
        return c.text('Forbidden', 403)
      }

      const extensionId = origin.replace('chrome-extension://', '')
      if (!EXTENSION_IDS.includes(extensionId)) {
        logger?.log(pc.red(`Rejecting /extension WebSocket from unknown extension: ${extensionId}`))
        return c.text('Forbidden', 403)
      }

      return next()
    },
    upgradeWebSocket((c) => {
      const incomingExtensionInfo = getExtensionInfoFromRequest(c)
      const connectionId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      return {
        onOpen(_event, ws) {
          const stableKey = buildStableExtensionKey(incomingExtensionInfo, connectionId)
          const existingId = extensionKeyIndex.get(stableKey)
          if (existingId && existingId !== connectionId) {
            logger?.log(pc.yellow(`Replacing extension connection for ${stableKey} (${existingId} -> ${connectionId})`))
            const existingConnection = extensionConnections.get(existingId)
            if (existingConnection) {
              existingConnection.ws.close(4001, 'Extension Replaced')
            }
          }

          const connection: ExtensionConnection = {
            id: connectionId,
            ws,
            info: incomingExtensionInfo,
            stableKey,
            connectedTargets: new Map(),
            pendingRequests: new Map(),
            messageId: 0,
            pingInterval: null,
          }
          extensionConnections.set(connectionId, connection)
          extensionKeyIndex.set(stableKey, connectionId)
          startExtensionPing(connectionId)
          logger?.log(`Extension connected (${connectionId})`)
        },

        async onMessage(event, ws) {
          const connection = extensionConnections.get(connectionId)
          if (!connection) {
            ws.close(1000, 'Extension not registered')
            return
          }
          // Handle binary data (recording chunks)
          if (event.data instanceof ArrayBuffer || Buffer.isBuffer(event.data)) {
            const buffer = Buffer.isBuffer(event.data) ? event.data : Buffer.from(event.data)
            const relay = getRecordingRelay(connectionId)
            if (relay) {
              relay.handleBinaryData(buffer)
            }
            return
          }

          let message: ExtensionMessage

          try {
            message = JSON.parse(event.data.toString())
          } catch {
            ws.close(1000, 'Invalid JSON')
            return
          }

          if (message.id !== undefined) {
            const pending = connection.pendingRequests.get(message.id)
            if (!pending) {
              logger?.log('Unexpected response with id:', message.id)
              return
            }

            connection.pendingRequests.delete(message.id)

            if (message.error) {
              pending.reject(new Error(message.error))
            } else {
              pending.resolve(message.result)
            }
          } else if (message.method === 'pong') {
            // Keep-alive response, nothing to do
          } else if (message.method === 'log') {
            const { level, args } = message.params
            const logFn = (logger as Record<string, unknown>)?.[level] as ((...args: unknown[]) => void) | undefined
            const logFunc = logFn || logger?.log
            const prefix = pc.yellow(`[Extension] [${level.toUpperCase()}]`)
            logFunc?.(prefix, ...args)
          } else if (message.method === 'recordingData') {
            const relay = getRecordingRelay(connectionId)
            if (relay) {
              relay.handleRecordingData(message as RecordingDataMessage)
            }
          } else if (message.method === 'recordingCancelled') {
            const relay = getRecordingRelay(connectionId)
            if (relay) {
              relay.handleRecordingCancelled(message as RecordingCancelledMessage)
            }
          } else {
            const extensionEvent = message as ExtensionEventMessage

            if (extensionEvent.method !== 'forwardCDPEvent') {
              return
            }

            const { method, params, sessionId } = extensionEvent.params

            logCdpJson({
              timestamp: new Date().toISOString(),
              direction: 'from-extension',
              message: { method, params, sessionId },
            })

            logCdpMessage({
              direction: 'from-extension',
              method,
              sessionId,
              params,
            })

            const cdpEvent: CDPEventBase = { method, sessionId, params }
            emitter.emit('cdp:event', { event: cdpEvent, sessionId })

            if (method === 'Target.attachedToTarget') {
              const targetParams = params as Protocol.Target.AttachedToTargetEvent
              const incomingSessionId = sessionId
              const iframeParentFrameId = targetParams.targetInfo.parentFrameId
              const iframeOwnerSessionId =
                targetParams.targetInfo.type === 'iframe' && iframeParentFrameId
                  ? getPageTargetForFrameId({ connection, frameId: iframeParentFrameId })?.sessionId
                  : undefined

              // Filter out restricted targets (unsupported types, extension pages, chrome:// URLs, etc.)
              if (isRestrictedTarget(targetParams.targetInfo)) {
                if (targetParams.waitingForDebugger && targetParams.sessionId) {
                  void sendToExtension({
                    extensionId: connectionId,
                    method: 'forwardCDPCommand',
                    params: {
                      sessionId: targetParams.sessionId,
                      method: 'Runtime.runIfWaitingForDebugger',
                      params: {},
                      source: 'server',
                    },
                  }).catch((error) => {
                    const message = error instanceof Error ? error.message : String(error)
                    logger?.log(pc.yellow('[Server] Failed to resume restricted target:'), message)
                  })
                }
                logger?.log(
                  pc.gray(
                    `[Server] Ignoring restricted target: ${targetParams.targetInfo.type} (${targetParams.targetInfo.url})`,
                  ),
                )
                return
              }

              if (!targetParams.targetInfo.url) {
                logger?.error(
                  pc.red('[Extension] WARNING: Target.attachedToTarget received with empty URL!'),
                  JSON.stringify({ method, params: targetParams, sessionId }),
                )
              }
              logger?.log(
                pc.yellow('[Extension] Target.attachedToTarget full payload:'),
                JSON.stringify({ method, params: targetParams, sessionId }),
              )

              // Check if we already sent this target to clients (e.g., from Target.setAutoAttach response)
              const alreadyConnected = connection.connectedTargets.has(targetParams.sessionId)
              const existingTarget = connection.connectedTargets.get(targetParams.sessionId)

              // Always update our local state with latest target info
              connection.connectedTargets.set(targetParams.sessionId, {
                sessionId: targetParams.sessionId,
                targetId: targetParams.targetInfo.targetId,
                targetInfo: targetParams.targetInfo,
                frameIds: existingTarget?.frameIds ?? new Set(),
              })

              // Only forward to Playwright if this is a new target to avoid duplicates
              if (!alreadyConnected) {
                sendToPlaywright({
                  message: {
                    // Iframe targets must be routed to the parent page sessionId so Playwright attaches them under the right page.
                    // - iframeOwnerSessionId: derived parent session via parentFrameId -> page sessionId (frameId tracking).
                    // - incomingSessionId: extension event sessionId for the parent tab.
                    // The frameId mapping is racy: Target.attachedToTarget can arrive before Page.frameAttached/Page.frameNavigated populate frameIds.
                    // When iframeOwnerSessionId is missing we must fall back to incomingSessionId, otherwise Playwright receives the attach on the root
                    // session, detaches it, and the iframe stays paused (waitingForDebugger) which can hang navigations.
                    sessionId: iframeOwnerSessionId ?? incomingSessionId,
                    method: 'Target.attachedToTarget',
                    params: targetParams,
                  } as CDPEventBase,
                  source: 'extension',
                  extensionId: connectionId,
                })
              }
            } else if (method === 'Target.detachedFromTarget') {
              const detachParams = params as Protocol.Target.DetachedFromTargetEvent
              connection.connectedTargets.delete(detachParams.sessionId)

              sendToPlaywright({
                message: {
                  method: 'Target.detachedFromTarget',
                  params: detachParams,
                } as CDPEventBase,
                source: 'extension',
                extensionId: connectionId,
              })
            } else if (method === 'Target.targetCrashed') {
              const crashParams = params as Protocol.Target.TargetCrashedEvent
              for (const [sid, target] of connection.connectedTargets.entries()) {
                if (target.targetId === crashParams.targetId) {
                  connection.connectedTargets.delete(sid)
                  logger?.log(pc.red('[Server] Target crashed, removing:'), crashParams.targetId)
                  break
                }
              }

              sendToPlaywright({
                message: {
                  method: 'Target.targetCrashed',
                  params: crashParams,
                } as CDPEventBase,
                source: 'extension',
                extensionId: connectionId,
              })
            } else if (method === 'Target.targetInfoChanged') {
              const infoParams = params as Protocol.Target.TargetInfoChangedEvent
              for (const target of connection.connectedTargets.values()) {
                if (target.targetId === infoParams.targetInfo.targetId) {
                  target.targetInfo = infoParams.targetInfo
                  break
                }
              }

              sendToPlaywright({
                message: {
                  method: 'Target.targetInfoChanged',
                  params: infoParams,
                } as CDPEventBase,
                source: 'extension',
                extensionId: connectionId,
              })
            } else if (method === 'Page.frameAttached') {
              const frameParams = params as Protocol.Page.FrameAttachedEvent
              if (sessionId) {
                const target = connection.connectedTargets.get(sessionId)
                if (target) {
                  target.frameIds.add(frameParams.frameId)
                }
              }

              sendToPlaywright({
                message: {
                  sessionId,
                  method,
                  params,
                } as CDPEventBase,
                source: 'extension',
                extensionId: connectionId,
              })
            } else if (method === 'Page.frameDetached') {
              const frameParams = params as Protocol.Page.FrameDetachedEvent
              const ownerTarget = getPageTargetForFrameId({ connection, frameId: frameParams.frameId })
              if (ownerTarget) {
                ownerTarget.frameIds.delete(frameParams.frameId)
              }

              sendToPlaywright({
                message: {
                  sessionId,
                  method,
                  params,
                } as CDPEventBase,
                source: 'extension',
                extensionId: connectionId,
              })
            } else if (method === 'Page.frameNavigated') {
              const frameParams = params as Protocol.Page.FrameNavigatedEvent
              if (sessionId) {
                const target = connection.connectedTargets.get(sessionId)
                if (target) {
                  target.frameIds.add(frameParams.frame.id)
                }
              }
              if (!frameParams.frame.parentId && sessionId) {
                const target = connection.connectedTargets.get(sessionId)
                if (target) {
                  target.targetInfo = {
                    ...target.targetInfo,
                    url: frameParams.frame.url,
                    title: frameParams.frame.name || target.targetInfo.title,
                  }
                  logger?.log(
                    pc.magenta('[Server] Updated target URL from Page.frameNavigated:'),
                    frameParams.frame.url,
                  )
                }
              }

              sendToPlaywright({
                message: {
                  sessionId,
                  method,
                  params,
                } as CDPEventBase,
                source: 'extension',
                extensionId: connectionId,
              })
            } else if (method === 'Page.navigatedWithinDocument') {
              const navParams = params as Protocol.Page.NavigatedWithinDocumentEvent
              if (sessionId) {
                const target = connection.connectedTargets.get(sessionId)
                if (target) {
                  target.targetInfo = {
                    ...target.targetInfo,
                    url: navParams.url,
                  }
                  logger?.log(
                    pc.magenta('[Server] Updated target URL from Page.navigatedWithinDocument:'),
                    navParams.url,
                  )
                }
              }

              sendToPlaywright({
                message: {
                  sessionId,
                  method,
                  params,
                } as CDPEventBase,
                source: 'extension',
                extensionId: connectionId,
              })
            } else {
              sendToPlaywright({
                message: {
                  sessionId,
                  method,
                  params,
                } as CDPEventBase,
                source: 'extension',
                extensionId: connectionId,
              })
            }
          }
        },

        onClose(event, ws) {
          logger?.log(`Extension disconnected: code=${event.code} reason=${event.reason || 'none'} (${connectionId})`)
          stopExtensionPing(connectionId)

          // Cancel any active recordings BEFORE removing connection (cancelRecording checks isExtensionConnected)
          const recordingRelay = recordingRelays.get(connectionId)
          if (recordingRelay) {
            recordingRelay.cancelRecording({}).catch(() => {
              // Ignore errors during cleanup
            })
          }
          recordingRelays.delete(connectionId)

          const connection = extensionConnections.get(connectionId)
          if (connection) {
            for (const pending of connection.pendingRequests.values()) {
              pending.reject(new Error('Extension connection closed'))
            }
            connection.pendingRequests.clear()
            connection.connectedTargets.clear()
          }

          if (connection) {
            const mappedId = extensionKeyIndex.get(connection.stableKey)
            if (mappedId === connectionId) {
              extensionKeyIndex.delete(connection.stableKey)
            }
          }
          extensionConnections.delete(connectionId)

          for (const [clientId, client] of playwrightClients.entries()) {
            if (client.extensionId !== connectionId) {
              continue
            }
            client.ws.close(1000, 'Extension disconnected')
            playwrightClients.delete(clientId)
          }
        },

        onError(event) {
          logger?.error('Extension WebSocket error:', event)
        },
      }
    }),
  )

  // ============================================================================
  // CLI Execute Endpoints - For stateful code execution via CLI
  // ============================================================================

  // Session counter for suggesting next session number
  let nextSessionNumber = 1

  // Lazy-load ExecutorManager to avoid circular imports and only when needed
  let executorManager: import('./executor.js').ExecutorManager | null = null

  const getExecutorManager = async () => {
    if (!executorManager) {
      const { ExecutorManager } = await import('./executor.js')
      // Pass config instead of URL so executor can generate unique client IDs for each connection
      executorManager = new ExecutorManager({
        cdpConfig: { host: '127.0.0.1', port },
        logger: logger || { log: console.error, error: console.error },
      })
    }
    return executorManager
  }

  // ============================================================================
  // Security middleware for privileged HTTP routes (/cli/*, /recording/*)
  //
  // CORS alone does NOT prevent cross-origin POST attacks. Browsers skip the
  // preflight for "simple" requests (POST + Content-Type: text/plain), so a
  // malicious website can fire-and-forget a POST to localhost:19988/cli/execute
  // and the code executes before CORS even enters the picture.
  //
  // Two layers of defense:
  // 1. Sec-Fetch-Site: browsers set this forbidden header on every request.
  //    If present and not "same-origin"/"none", it's a cross-origin browser
  //    request → reject. Node.js clients don't send it → unaffected.
  // 2. Content-Type must be application/json on POST. This forces a CORS
  //    preflight as a fallback, which our CORS policy already blocks.
  // 3. When token mode is enabled (remote access), require the token.
  // ============================================================================
  const privilegedRouteMiddleware = async (
    c: Parameters<Parameters<typeof app.use>[1]>[0],
    next: () => Promise<void>,
  ) => {
    // Block cross-origin browser requests via Sec-Fetch-Site header.
    // Browsers always set this forbidden header; it cannot be spoofed.
    // Non-browser clients (Node.js, curl, MCP) don't send it.
    const secFetchSite = c.req.header('sec-fetch-site')
    if (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'none') {
      logger?.log(pc.red(`Rejecting ${c.req.path}: cross-origin browser request (Sec-Fetch-Site: ${secFetchSite})`))
      return c.text('Forbidden - Cross-origin requests not allowed', 403)
    }

    // Require application/json on POST to force CORS preflight as backup defense.
    // A text/plain POST is a "simple request" that skips preflight entirely.
    if (c.req.method === 'POST') {
      const contentType = c.req.header('content-type') || ''
      if (!contentType.includes('application/json')) {
        logger?.log(pc.red(`Rejecting ${c.req.path}: Content-Type must be application/json, got: ${contentType}`))
        return c.text('Content-Type must be application/json', 415)
      }
    }

    // When token mode is enabled (remote/serve mode), require authentication.
    if (token) {
      const authHeader = c.req.header('authorization') || ''
      const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
      const url = new URL(c.req.url, 'http://localhost')
      const queryToken = url.searchParams.get('token')
      if (bearerToken !== token && queryToken !== token) {
        logger?.log(pc.red(`Rejecting ${c.req.path}: invalid or missing token`))
        return c.text('Unauthorized', 401)
      }
    }

    return next()
  }

  app.use('/cli/*', privilegedRouteMiddleware)
  app.use('/recording/*', privilegedRouteMiddleware)

  app.post('/cli/execute', async (c) => {
    try {
      const body = (await c.req.json()) as { sessionId: string | number; code: string; timeout?: number }
      const sessionId = normalizeSessionId(body.sessionId)
      const { code, timeout = 10000 } = body

      if (!sessionId || !code) {
        return c.json({ error: 'sessionId and code are required' }, 400)
      }

      const manager = await getExecutorManager()
      const existingExecutor = manager.getSession(sessionId)
      if (!existingExecutor) {
        return c.json(
          { text: `Session ${sessionId} not found. Run 'playwriter session new' first.`, images: [], isError: true },
          404,
        )
      }
      const result = await existingExecutor.execute(code, timeout)

      return c.json(result)
    } catch (error: any) {
      logger?.error('Execute endpoint error:', error)
      return c.json({ text: `Server error: ${error.message}`, images: [], isError: true }, 500)
    }
  })

  app.post('/cli/reset', async (c) => {
    try {
      const body = (await c.req.json()) as { sessionId: string | number }
      const sessionId = normalizeSessionId(body.sessionId)

      if (!sessionId) {
        return c.json({ error: 'sessionId is required' }, 400)
      }

      const manager = await getExecutorManager()
      const existingExecutor = manager.getSession(sessionId)
      if (!existingExecutor) {
        return c.json({ error: `Session ${sessionId} not found. Run 'playwriter session new' first.` }, 404)
      }
      const { page, context } = await existingExecutor.reset()

      return c.json({
        success: true,
        pageUrl: page.url(),
        pagesCount: context.pages().length,
      })
    } catch (error: any) {
      logger?.error('Reset endpoint error:', error)
      return c.json({ error: error.message }, 500)
    }
  })

  app.get('/cli/sessions', async (c) => {
    const manager = await getExecutorManager()
    return c.json({ sessions: manager.listSessions() })
  })

  app.get('/cli/session/suggest', (c) => {
    return c.json({ next: nextSessionNumber })
  })

  app.post('/cli/session/new', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { extensionId?: string | null; cwd?: string }
    const sessionId = String(nextSessionNumber++)
    const extensionId = body.extensionId || null
    const cwd = body.cwd
    const allowDefault = !extensionId && extensionConnections.size === 1
    const extension = getExtensionConnection(extensionId, { allowFallback: allowDefault })
    if (!extension) {
      const error = extensionId
        ? `Extension not connected: ${extensionId}`
        : 'Multiple extensions connected. Specify extensionId.'
      return c.json({ error }, 404)
    }
    const manager = await getExecutorManager()
    const executor = manager.getExecutor({
      sessionId,
      cwd,
      sessionMetadata: {
        extensionId: extension.stableKey,
        browser: extension.info.browser || null,
        profile: extension.info ? { email: extension.info.email || '', id: extension.info.id || '' } : null,
      },
    })
    const metadata = executor.getSessionMetadata()
    return c.json({
      id: sessionId,
      extensionId: metadata.extensionId,
      browser: metadata.browser,
      profile: metadata.profile,
    })
  })

  app.get('/cli/session/:id', async (c) => {
    const sessionId = c.req.param('id')
    const manager = await getExecutorManager()
    const executor = manager.getSession(sessionId)
    if (!executor) {
      return c.json({ error: 'not found' }, 404)
    }
    const metadata = executor.getSessionMetadata()
    return c.json({
      id: sessionId,
      extensionId: metadata.extensionId,
      browser: metadata.browser,
      profile: metadata.profile,
    })
  })

  app.post('/cli/session/delete', async (c) => {
    try {
      const body = (await c.req.json()) as { sessionId: string | number }
      const sessionId = normalizeSessionId(body.sessionId)

      if (!sessionId) {
        return c.json({ error: 'sessionId is required' }, 400)
      }

      const manager = await getExecutorManager()
      const deleted = manager.deleteExecutor(sessionId)

      if (!deleted) {
        return c.json({ error: `Session ${sessionId} not found` }, 404)
      }
      return c.json({ success: true })
    } catch (error: any) {
      logger?.error('Delete session endpoint error:', error)
      return c.json({ error: error.message }, 500)
    }
  })

  // ============================================================================
  // Recording Endpoints - For screen recording via chrome.tabCapture
  // ============================================================================

  app.post('/recording/start', async (c) => {
    const body = (await c.req.json()) as {
      outputPath?: string
      sessionId?: string | number
      frameRate?: number
      audio?: boolean
      videoBitsPerSecond?: number
      audioBitsPerSecond?: number
    }
    const sessionId = normalizeSessionId(body.sessionId)
    const { sessionId: _sessionId, ...recordingOptions } = body
    const { extensionId, sessionId: resolvedSessionId } = await resolveRecordingRoute({ sessionId })
    const relay = getRecordingRelay(extensionId)
    if (!relay) {
      return c.json({ success: false, error: 'Extension not connected' }, 500)
    }
    const recordingParams = (resolvedSessionId
      ? { ...recordingOptions, sessionId: resolvedSessionId }
      : recordingOptions) as StartRecordingBody
    const result = await relay.startRecording(recordingParams)
    const status = result.success ? 200 : result.error?.includes('required') ? 400 : 500
    return c.json(result, status)
  })

  app.post('/recording/stop', async (c) => {
    const body = (await c.req.json()) as { sessionId?: string | number }
    const sessionId = normalizeSessionId(body.sessionId)
    const { extensionId, sessionId: resolvedSessionId } = await resolveRecordingRoute({ sessionId })
    const relay = getRecordingRelay(extensionId)
    if (!relay) {
      return c.json({ success: false, error: 'Extension not connected' }, 500)
    }
    const stopParams: StopRecordingParams = resolvedSessionId ? { sessionId: resolvedSessionId } : {}
    const result = await relay.stopRecording(stopParams)
    const status = result.success ? 200 : result.error?.includes('not found') ? 404 : 500
    return c.json(result, status)
  })

  app.get('/recording/status', async (c) => {
    const sessionId = normalizeSessionId(c.req.query('sessionId'))
    const { extensionId, sessionId: resolvedSessionId } = await resolveRecordingRoute({ sessionId })
    const relay = getRecordingRelay(extensionId)
    if (!relay) {
      return c.json({ isRecording: false })
    }
    const isRecordingParams: IsRecordingParams = resolvedSessionId ? { sessionId: resolvedSessionId } : {}
    const result = await relay.isRecording(isRecordingParams)
    return c.json(result)
  })

  app.post('/recording/cancel', async (c) => {
    const body = (await c.req.json()) as { sessionId?: string | number }
    const sessionId = normalizeSessionId(body.sessionId)
    const { extensionId, sessionId: resolvedSessionId } = await resolveRecordingRoute({ sessionId })
    const relay = getRecordingRelay(extensionId)
    if (!relay) {
      return c.json({ success: false, error: 'Extension not connected' }, 500)
    }
    const cancelParams: CancelRecordingParams = resolvedSessionId ? { sessionId: resolvedSessionId } : {}
    const result = await relay.cancelRecording(cancelParams)
    return c.json(result)
  })

  const server = serve({ fetch: app.fetch, port, hostname: host })
  injectWebSocket(server)

  const wsHost = `ws://${host}:${port}`
  const cdpEndpoint = `${wsHost}/cdp`
  const extensionEndpoint = `${wsHost}/extension`

  logger?.log('CDP relay server started')
  logger?.log('Host:', host)
  logger?.log('Port:', port)
  logger?.log('Extension endpoint:', extensionEndpoint)
  logger?.log('CDP endpoint:', cdpEndpoint)

  return {
    close() {
      for (const client of playwrightClients.values()) {
        client.ws.close(1000, 'Server stopped')
      }
      playwrightClients.clear()
      for (const extension of extensionConnections.values()) {
        extension.ws.close(1000, 'Server stopped')
      }
      extensionConnections.clear()
      server.close()
      emitter.removeAllListeners()
    },
    on<K extends keyof RelayServerEvents>(event: K, listener: RelayServerEvents[K]) {
      emitter.on(event, listener as (...args: unknown[]) => void)
    },
    off<K extends keyof RelayServerEvents>(event: K, listener: RelayServerEvents[K]) {
      emitter.off(event, listener as (...args: unknown[]) => void)
    },
  }
}
