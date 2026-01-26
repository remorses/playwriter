import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import { getConnInfo } from '@hono/node-server/conninfo'
import { createNodeWebSocket } from '@hono/node-ws'
import type { WSContext } from 'hono/ws'
import type { Protocol } from './cdp-types.js'
import type { CDPCommand, CDPResponseBase, CDPEventBase, CDPEventFor, RelayServerEvents } from './cdp-types.js'
import type { ExtensionMessage, ExtensionEventMessage } from './protocol.js'
import pc from 'picocolors'
import { EventEmitter } from 'node:events'
import { VERSION } from './utils.js'

type ConnectedTarget = {
  sessionId: string
  targetId: string
  targetInfo: Protocol.Target.TargetInfo
}

// Our extension IDs - allow attaching to our own extension pages for debugging
const OUR_EXTENSION_IDS = [
  'jfeammnjpkecdekppnclgkkffahnhfhe', // Production extension (Chrome Web Store)
  'pebbngnfojnignonigcnkdilknapkgid', // Dev extension (stable ID from manifest key)
]

/**
 * Checks if a target should be filtered out (not exposed to Playwright).
 * Filters extension pages, service workers, and other restricted targets,
 * but allows our own extension pages for debugging purposes.
 */
function isRestrictedTarget(targetInfo: Protocol.Target.TargetInfo): boolean {
  const { url, type } = targetInfo

  // Filter by type - only allow 'page' type through
  // Service workers, web workers, iframes, etc. cause issues when Playwright tries to initialize them
  // Iframes are accessible via page.frameLocator() on the parent page
  if (type !== 'page') {
    return true
  }

  // Filter by URL - block extension and chrome internal pages
  if (!url) {
    return false
  }

  // Allow our own extension pages
  if (url.startsWith('chrome-extension://')) {
    const extensionId = url.replace('chrome-extension://', '').split('/')[0]
    if (OUR_EXTENSION_IDS.includes(extensionId)) {
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
}


export type RelayServer = {
  close(): void
  on<K extends keyof RelayServerEvents>(event: K, listener: RelayServerEvents[K]): void
  off<K extends keyof RelayServerEvents>(event: K, listener: RelayServerEvents[K]): void
}

export async function startPlayWriterCDPRelayServer({ port = 19988, host = '127.0.0.1', token, logger }: { port?: number; host?: string; token?: string; logger?: { log(...args: any[]): void; error(...args: any[]): void } } = {}): Promise<RelayServer> {
  const emitter = new EventEmitter()
  const connectedTargets = new Map<string, ConnectedTarget>()

  const playwrightClients = new Map<string, PlaywrightClient>()
  let extensionWs: WSContext | null = null

  const extensionPendingRequests = new Map<number, {
    resolve: (result: any) => void
    reject: (error: Error) => void
  }>()
  let extensionMessageId = 0
  let extensionPingInterval: ReturnType<typeof setInterval> | null = null

  function startExtensionPing() {
    if (extensionPingInterval) {
      clearInterval(extensionPingInterval)
    }
    extensionPingInterval = setInterval(() => {
      extensionWs?.send(JSON.stringify({ method: 'ping' }))
    }, 5000)
  }

  function stopExtensionPing() {
    if (extensionPingInterval) {
      clearInterval(extensionPingInterval)
      extensionPingInterval = null
    }
  }

  function logCdpMessage({
    direction,
    clientId,
    method,
    sessionId,
    params,
    id,
    source
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
      'Network.loadingFinished'
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
    source = 'extension'
  }: {
    message: CDPResponseBase | CDPEventBase
    clientId?: string
    source?: 'extension' | 'server'
  }) {
    const messageToSend = source === 'server' && 'method' in message
      ? { ...message, __serverGenerated: true }
      : message

    if ('method' in message) {
      logCdpMessage({
        direction: 'to-playwright',
        clientId,
        method: message.method,
        sessionId: 'sessionId' in message ? message.sessionId : undefined,
        params: 'params' in message ? message.params : undefined,
        source
      })
    }

    const messageStr = JSON.stringify(messageToSend)

    if (clientId) {
      const client = playwrightClients.get(clientId)
      if (client) {
        client.ws.send(messageStr)
      }
    } else {
      for (const client of playwrightClients.values()) {
        client.ws.send(messageStr)
      }
    }
  }

  async function sendToExtension({ method, params, timeout = 30000 }: { method: string; params?: any; timeout?: number }) {
    if (!extensionWs) {
      throw new Error('Extension not connected')
    }

    const id = ++extensionMessageId
    const message = { id, method, params }

    extensionWs.send(JSON.stringify(message))

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        extensionPendingRequests.delete(id)
        reject(new Error(`Extension request timeout after ${timeout}ms: ${method}`))
      }, timeout)

      extensionPendingRequests.set(id, {
        resolve: (result) => {
          clearTimeout(timeoutId)
          resolve(result)
        },
        reject: (error) => {
          clearTimeout(timeoutId)
          reject(error)
        }
      })
    })
  }

  // Auto-create initial tab when PLAYWRITER_AUTO_ENABLE is set and no targets exist.
  // This allows Playwright to connect and immediately have a page to work with.
  async function maybeAutoCreateInitialTab(): Promise<void> {
    if (!process.env.PLAYWRITER_AUTO_ENABLE) {
      return
    }
    if (!extensionWs) {
      return
    }
    if (connectedTargets.size > 0) {
      return
    }

    try {
      logger?.log(pc.blue('Auto-creating initial tab for Playwright client'))
      const result = await sendToExtension({ method: 'createInitialTab', timeout: 10000 }) as {
        success: boolean
        tabId: number
        sessionId: string
        targetInfo: Protocol.Target.TargetInfo
      }
      if (result.success && result.sessionId && result.targetInfo) {
        connectedTargets.set(result.sessionId, {
          sessionId: result.sessionId,
          targetId: result.targetInfo.targetId,
          targetInfo: result.targetInfo
        })
        logger?.log(pc.blue(`Auto-created tab, now have ${connectedTargets.size} targets, url: ${result.targetInfo.url}`))
      }
    } catch (e) {
      logger?.error('Failed to auto-create initial tab:', e)
    }
  }

  async function routeCdpCommand({ method, params, sessionId, source }: { method: string; params: any; sessionId?: string; source?: 'playwriter' }) {
    switch (method) {
      case 'Browser.getVersion': {
        return {
          protocolVersion: '1.3',
          product: 'Chrome/Extension-Bridge',
          revision: '1.0.0',
          userAgent: 'CDP-Bridge-Server/1.0.0',
          jsVersion: 'V8'
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
        await maybeAutoCreateInitialTab()
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
              attached: true
            }))
        }
      }

      case 'Target.createTarget': {
        return await sendToExtension({
          method: 'forwardCDPCommand',
          params: { method, params, source }
        })
      }

      case 'Target.closeTarget': {
        return await sendToExtension({
          method: 'forwardCDPCommand',
          params: { method, params, source }
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
            logger?.log(pc.yellow(`IMPORTANT: Runtime.enable timed out waiting for main frame executionContextCreated (sessionId: ${sessionId}). This may cause pages to not be visible immediately.`))
            resolve()
          }, 3000)
          emitter.on('cdp:event', handler)
        })

        const result = await sendToExtension({
          method: 'forwardCDPCommand',
          params: { sessionId, method, params, source }
        })

        await contextCreatedPromise

        return result
      }
    }

    return await sendToExtension({
      method: 'forwardCDPCommand',
      params: { sessionId, method, params, source }
    })
  }

  const app = new Hono()
  // CORS middleware for HTTP endpoints - only allows our specific extension IDs.
  // This prevents other extensions from reading responses via fetch/XHR.
  // WebSocket connections have their own separate origin validation.
  app.use('*', cors({
    origin: (origin) => {
      if (!origin.startsWith('chrome-extension://')) {
        return null
      }
      const extensionId = origin.replace('chrome-extension://', '')
      if (!OUR_EXTENSION_IDS.includes(extensionId)) {
        return null
      }
      return origin
    },
    allowMethods: ['GET', 'POST', 'HEAD', 'OPTIONS'],
  }))
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
    return c.json({
      connected: extensionWs !== null,
      activeTargets: connectedTargets.size
    })
  })

  // CDP Discovery Endpoints - Standard Chrome DevTools Protocol HTTP API
  // Allows tools like Playwright to discover the WebSocket URL via http://host:port
  // Spec: https://chromium.googlesource.com/chromium/src/+/main/content/browser/devtools/devtools_http_handler.cc

  app
    .on(['GET', 'PUT'], '/json/version', (c) => {
      return c.json({
        'Browser': `Playwriter/${VERSION}`,
        'Protocol-Version': '1.3',
        'webSocketDebuggerUrl': getCdpWsUrl(c)
      })
    })
    .on(['GET', 'PUT'], '/json/version/', (c) => {
      return c.json({
        'Browser': `Playwriter/${VERSION}`,
        'Protocol-Version': '1.3',
        'webSocketDebuggerUrl': getCdpWsUrl(c)
      })
    })
    .on(['GET', 'PUT'], '/json/list', (c) => {
      const wsUrl = getCdpWsUrl(c)
      return c.json(
        Array.from(connectedTargets.values()).map(t => ({
          id: t.targetId,
          type: t.targetInfo.type,
          title: t.targetInfo.title,
          description: t.targetInfo.title,
          url: t.targetInfo.url,
          webSocketDebuggerUrl: wsUrl,
          devtoolsFrontendUrl: `/devtools/inspector.html?ws=${wsUrl.replace('ws://', '')}`
        }))
      )
    })
    .on(['GET', 'PUT'], '/json/list/', (c) => {
      const wsUrl = getCdpWsUrl(c)
      return c.json(
        Array.from(connectedTargets.values()).map(t => ({
          id: t.targetId,
          type: t.targetInfo.type,
          title: t.targetInfo.title,
          description: t.targetInfo.title,
          url: t.targetInfo.url,
          webSocketDebuggerUrl: wsUrl,
          devtoolsFrontendUrl: `/devtools/inspector.html?ws=${wsUrl.replace('ws://', '')}`
        }))
      )
    })
    .on(['GET', 'PUT'], '/json', (c) => {
      const wsUrl = getCdpWsUrl(c)
      return c.json(
        Array.from(connectedTargets.values()).map(t => ({
          id: t.targetId,
          type: t.targetInfo.type,
          title: t.targetInfo.title,
          description: t.targetInfo.title,
          url: t.targetInfo.url,
          webSocketDebuggerUrl: wsUrl,
          devtoolsFrontendUrl: `/devtools/inspector.html?ws=${wsUrl.replace('ws://', '')}`
        }))
      )
    })
    .on(['GET', 'PUT'], '/json/', (c) => {
      const wsUrl = getCdpWsUrl(c)
      return c.json(
        Array.from(connectedTargets.values()).map(t => ({
          id: t.targetId,
          type: t.targetInfo.type,
          title: t.targetInfo.title,
          description: t.targetInfo.title,
          url: t.targetInfo.url,
          webSocketDebuggerUrl: wsUrl,
          devtoolsFrontendUrl: `/devtools/inspector.html?ws=${wsUrl.replace('ws://', '')}`
        }))
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
  app.get('/cdp/:clientId?', (c, next) => {
    const origin = c.req.header('origin')

    // Validate Origin header if present (Node.js clients don't send it)
    if (origin) {
      if (origin.startsWith('chrome-extension://')) {
        const extensionId = origin.replace('chrome-extension://', '')
        if (!OUR_EXTENSION_IDS.includes(extensionId)) {
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
  }, upgradeWebSocket((c) => {
    const clientId = c.req.param('clientId') || 'default'

    return {
      async onOpen(_event, ws) {
        if (playwrightClients.has(clientId)) {
          logger?.log(pc.red(`Rejecting duplicate client ID: ${clientId}`))
          ws.close(1000, 'Client ID already connected')
          return
        }

        // Add client first so it can receive Target.attachedToTarget events
        playwrightClients.set(clientId, { id: clientId, ws })
        logger?.log(pc.green(`Playwright client connected: ${clientId} (${playwrightClients.size} total) (extension? ${!!extensionWs}) (${connectedTargets.size} pages)`))
      },

      async onMessage(event, ws) {
        let message: CDPCommand

        try {
          message = JSON.parse(event.data.toString())
        } catch {
          return
        }

        const { id, sessionId, method, params, source } = message

        logCdpMessage({
          direction: 'from-playwright',
          clientId,
          method,
          sessionId,
          id
        })

        emitter.emit('cdp:command', { clientId, command: message })

        if (!extensionWs) {
          sendToPlaywright({
            message: {
              id,
              sessionId,
              error: { message: 'Extension not connected' }
            },
            clientId
          })
          return
        }

        try {
          const result: any = await routeCdpCommand({ method, params, sessionId, source })

          if (method === 'Target.setAutoAttach' && !sessionId) {
            for (const target of connectedTargets.values()) {
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
                    attached: true
                  },
                  waitingForDebugger: false
                }
              } satisfies CDPEventFor<'Target.attachedToTarget'>
              if (!target.targetInfo.url) {
                logger?.error(pc.red('[Server] WARNING: Target.attachedToTarget sent with empty URL!'), JSON.stringify(attachedPayload))
              }
              logger?.log(pc.magenta('[Server] Target.attachedToTarget full payload:'), JSON.stringify(attachedPayload))
              sendToPlaywright({
                message: attachedPayload,
                clientId,
                source: 'server'
              })
            }
          }

          if (method === 'Target.setDiscoverTargets' && (params as any)?.discover) {
            for (const target of connectedTargets.values()) {
              // Skip restricted targets (extensions, chrome:// URLs, non-page types)
              if (isRestrictedTarget(target.targetInfo)) {
                continue
              }
              const targetCreatedPayload = {
                method: 'Target.targetCreated',
                params: {
                  targetInfo: {
                    ...target.targetInfo,
                    attached: true
                  }
                }
              } satisfies CDPEventFor<'Target.targetCreated'>
              if (!target.targetInfo.url) {
                logger?.error(pc.red('[Server] WARNING: Target.targetCreated sent with empty URL!'), JSON.stringify(targetCreatedPayload))
              }
              logger?.log(pc.magenta('[Server] Target.targetCreated full payload:'), JSON.stringify(targetCreatedPayload))
              sendToPlaywright({
                message: targetCreatedPayload,
                clientId,
                source: 'server'
              })
            }
          }

          if (method === 'Target.attachToTarget' && result?.sessionId) {
            const targetId = params?.targetId
            const target = Array.from(connectedTargets.values()).find(t => t.targetId === targetId)
            if (target) {
              const attachedPayload = {
                method: 'Target.attachedToTarget',
                params: {
                  sessionId: result.sessionId,
                  targetInfo: {
                    ...target.targetInfo,
                    attached: true
                  },
                  waitingForDebugger: false
                }
              } satisfies CDPEventFor<'Target.attachedToTarget'>
              if (!target.targetInfo.url) {
                logger?.error(pc.red('[Server] WARNING: Target.attachedToTarget (from attachToTarget) sent with empty URL!'), JSON.stringify(attachedPayload))
              }
              logger?.log(pc.magenta('[Server] Target.attachedToTarget (from attachToTarget) payload:'), JSON.stringify(attachedPayload))
              sendToPlaywright({
                message: attachedPayload,
                clientId,
                source: 'server'
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
            error: { message: (e as Error).message }
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
      }
    }
  }))

  app.get('/extension', (c, next) => {
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
      logger?.log(pc.red(`Rejecting /extension WebSocket: origin must be chrome-extension://, got: ${origin || 'none'}`))
      return c.text('Forbidden', 403)
    }

    const extensionId = origin.replace('chrome-extension://', '')
    if (!OUR_EXTENSION_IDS.includes(extensionId)) {
      logger?.log(pc.red(`Rejecting /extension WebSocket from unknown extension: ${extensionId}`))
      return c.text('Forbidden', 403)
    }

    return next()
  }, upgradeWebSocket(() => {
    return {
      onOpen(_event, ws) {
        if (extensionWs) {
          // Only allow replacement if the existing extension has no active tabs.
          // This prevents a new extension from hijacking an actively-used session.
          // If the existing extension is idle (no tabs), allow the new one to take over.
          if (connectedTargets.size > 0) {
            logger?.log(pc.yellow(`Rejecting new extension - existing one has ${connectedTargets.size} active tab(s)`))
            ws.close(4002, 'Extension Already In Use')
            return
          }

          logger?.log(pc.yellow('Replacing idle extension connection (no active tabs)'))
          extensionWs.close(4001, 'Extension Replaced')

          // Clear state from the old connection to prevent leaks
          for (const pending of extensionPendingRequests.values()) {
            pending.reject(new Error('Extension connection replaced'))
          }
          extensionPendingRequests.clear()

          for (const client of playwrightClients.values()) {
            client.ws.close(1000, 'Extension Replaced')
          }
          playwrightClients.clear()
        }

        extensionWs = ws
        startExtensionPing()
        logger?.log('Extension connected with clean state')
      },

      async onMessage(event, ws) {
        let message: ExtensionMessage

        try {
          message = JSON.parse(event.data.toString())
        } catch {
          ws.close(1000, 'Invalid JSON')
          return
        }

        if (message.id !== undefined) {
          const pending = extensionPendingRequests.get(message.id)
          if (!pending) {
            logger?.log('Unexpected response with id:', message.id)
            return
          }

          extensionPendingRequests.delete(message.id)

          if (message.error) {
            pending.reject(new Error(message.error))
          } else {
            pending.resolve(message.result)
          }
        } else if (message.method === 'pong') {
          // Keep-alive response, nothing to do
        } else if (message.method === 'log') {
          const { level, args } = message.params
          const logFn = (logger as any)?.[level] || logger?.log
          const prefix = pc.yellow(`[Extension] [${level.toUpperCase()}]`)
          logFn?.(prefix, ...args)
        } else {
          const extensionEvent = message as ExtensionEventMessage

          if (extensionEvent.method !== 'forwardCDPEvent') {
            return
          }

          const { method, params, sessionId } = extensionEvent.params

          logCdpMessage({
            direction: 'from-extension',
            method,
            sessionId,
            params
          })

          const cdpEvent: CDPEventBase = { method, sessionId, params }
          emitter.emit('cdp:event', { event: cdpEvent, sessionId })

          if (method === 'Target.attachedToTarget') {
            const targetParams = params as Protocol.Target.AttachedToTargetEvent

            // Filter out restricted targets (non-page types, extension pages, chrome:// URLs, etc.)
            // These targets can't be properly controlled through chrome.debugger API
            // and cause issues when Playwright tries to initialize them (issue #14)
            if (isRestrictedTarget(targetParams.targetInfo)) {
              logger?.log(pc.gray(`[Server] Ignoring restricted target: ${targetParams.targetInfo.type} (${targetParams.targetInfo.url})`))
              return
            }

            if (!targetParams.targetInfo.url) {
              logger?.error(pc.red('[Extension] WARNING: Target.attachedToTarget received with empty URL!'), JSON.stringify({ method, params: targetParams, sessionId }))
            }
            logger?.log(pc.yellow('[Extension] Target.attachedToTarget full payload:'), JSON.stringify({ method, params: targetParams, sessionId }))

            // Check if we already sent this target to clients (e.g., from Target.setAutoAttach response)
            const alreadyConnected = connectedTargets.has(targetParams.sessionId)

            // Always update our local state with latest target info
            connectedTargets.set(targetParams.sessionId, {
              sessionId: targetParams.sessionId,
              targetId: targetParams.targetInfo.targetId,
              targetInfo: targetParams.targetInfo
            })

            // Only forward to Playwright if this is a new target to avoid duplicates
            if (!alreadyConnected) {
              sendToPlaywright({
                message: {
                  method: 'Target.attachedToTarget',
                  params: targetParams
                } as CDPEventBase,
                source: 'extension'
              })
            }
          } else if (method === 'Target.detachedFromTarget') {
            const detachParams = params as Protocol.Target.DetachedFromTargetEvent
            connectedTargets.delete(detachParams.sessionId)

            sendToPlaywright({
              message: {
                method: 'Target.detachedFromTarget',
                params: detachParams
              } as CDPEventBase,
              source: 'extension'
            })
          } else if (method === 'Target.targetCrashed') {
            const crashParams = params as Protocol.Target.TargetCrashedEvent
            for (const [sid, target] of connectedTargets.entries()) {
              if (target.targetId === crashParams.targetId) {
                connectedTargets.delete(sid)
                logger?.log(pc.red('[Server] Target crashed, removing:'), crashParams.targetId)
                break
              }
            }

            sendToPlaywright({
              message: {
                method: 'Target.targetCrashed',
                params: crashParams
              } as CDPEventBase,
              source: 'extension'
            })
          } else if (method === 'Target.targetInfoChanged') {
            const infoParams = params as Protocol.Target.TargetInfoChangedEvent
            for (const target of connectedTargets.values()) {
              if (target.targetId === infoParams.targetInfo.targetId) {
                target.targetInfo = infoParams.targetInfo
                break
              }
            }

            sendToPlaywright({
              message: {
                method: 'Target.targetInfoChanged',
                params: infoParams
              } as CDPEventBase,
              source: 'extension'
            })
          } else if (method === 'Page.frameNavigated') {
            const frameParams = params as Protocol.Page.FrameNavigatedEvent
            if (!frameParams.frame.parentId && sessionId) {
              const target = connectedTargets.get(sessionId)
              if (target) {
                target.targetInfo = {
                  ...target.targetInfo,
                  url: frameParams.frame.url,
                  title: frameParams.frame.name || target.targetInfo.title,
                }
                logger?.log(pc.magenta('[Server] Updated target URL from Page.frameNavigated:'), frameParams.frame.url)
              }
            }

            sendToPlaywright({
              message: {
                sessionId,
                method,
                params
              } as CDPEventBase,
              source: 'extension'
            })
          } else if (method === 'Page.navigatedWithinDocument') {
            const navParams = params as Protocol.Page.NavigatedWithinDocumentEvent
            if (sessionId) {
              const target = connectedTargets.get(sessionId)
              if (target) {
                target.targetInfo = {
                  ...target.targetInfo,
                  url: navParams.url,
                }
                logger?.log(pc.magenta('[Server] Updated target URL from Page.navigatedWithinDocument:'), navParams.url)
              }
            }

            sendToPlaywright({
              message: {
                sessionId,
                method,
                params
              } as CDPEventBase,
              source: 'extension'
            })
          } else {
            sendToPlaywright({
              message: {
                sessionId,
                method,
                params
              } as CDPEventBase,
              source: 'extension'
            })
          }
        }
      },

      onClose(event, ws) {
        logger?.log(`Extension disconnected: code=${event.code} reason=${event.reason || 'none'}`)
        stopExtensionPing()

        // If this is an old connection closing after we've already established a new one,
        // don't clear the global state
        if (extensionWs && extensionWs !== ws) {
          logger?.log('Old extension connection closed, keeping new one active')
          return
        }

        for (const pending of extensionPendingRequests.values()) {
          pending.reject(new Error('Extension connection closed'))
        }
        extensionPendingRequests.clear()

        extensionWs = null
        connectedTargets.clear()

        for (const client of playwrightClients.values()) {
          client.ws.close(1000, 'Extension disconnected')
        }
        playwrightClients.clear()
      },

      onError(event) {
        logger?.error('Extension WebSocket error:', event)
      }
    }
  }))

  // ============================================================================
  // CLI Execute Endpoints - For stateful code execution via CLI
  // ============================================================================
  
  // Security middleware for CLI endpoints - blocks browser-based attacks
  // CLI tools (curl, playwriter CLI) don't send Origin headers, but browsers always do
  app.use('/cli/*', async (c, next) => {
    // 1. Localhost check: CLI endpoints must only be accessed from localhost
    // This prevents remote exploitation even if server is exposed via 0.0.0.0
    const info = getConnInfo(c)
    const remoteAddress = info.remote.address
    const isLocalhost = remoteAddress === '127.0.0.1' || remoteAddress === '::1'
    
    if (!isLocalhost) {
      logger?.log(pc.red(`Rejecting /cli request from remote IP: ${remoteAddress}`))
      return c.text('Forbidden - CLI endpoints are localhost only', 403)
    }
    
    // 2. Origin check: Reject requests with browser Origin headers
    // Browsers always send Origin for cross-origin requests (including localhost:different-port)
    // CLI tools don't send Origin, so this blocks website-based attacks while allowing CLI usage
    const origin = c.req.header('origin')
    if (origin) {
      logger?.log(pc.red(`Rejecting /cli request with Origin header: ${origin}`))
      return c.text('Forbidden - CLI endpoints cannot be called from browsers', 403)
    }
    
    await next()
  })
  
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
        logger: logger || { log: console.log, error: console.error },
      })
    }
    return executorManager
  }
  
  app.post('/cli/execute', async (c) => {
    try {
      const body = await c.req.json() as { sessionId: string; code: string; timeout?: number; cwd?: string }
      const { sessionId, code, timeout = 10000, cwd } = body
      
      if (!sessionId || !code) {
        return c.json({ error: 'sessionId and code are required' }, 400)
      }
      
      const manager = await getExecutorManager()
      const executor = manager.getExecutor(sessionId, cwd)
      const result = await executor.execute(code, timeout)
      
      // Increment session counter after each execution to avoid conflicts
      nextSessionNumber++
      
      return c.json(result)
    } catch (error: any) {
      logger?.error('Execute endpoint error:', error)
      return c.json({ text: `Server error: ${error.message}`, images: [], isError: true }, 500)
    }
  })
  
  app.post('/cli/reset', async (c) => {
    try {
      const body = await c.req.json() as { sessionId: string; cwd?: string }
      const { sessionId, cwd } = body
      
      if (!sessionId) {
        return c.json({ error: 'sessionId is required' }, 400)
      }
      
      const manager = await getExecutorManager()
      const executor = manager.getExecutor(sessionId, cwd)
      const { page, context } = await executor.reset()
      
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
      extensionWs?.close(1000, 'Server stopped')
      server.close()
      emitter.removeAllListeners()
    },
    on<K extends keyof RelayServerEvents>(event: K, listener: RelayServerEvents[K]) {
      emitter.on(event, listener as (...args: unknown[]) => void)
    },
    off<K extends keyof RelayServerEvents>(event: K, listener: RelayServerEvents[K]) {
      emitter.off(event, listener as (...args: unknown[]) => void)
    }
  }
}
