import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { createNodeWebSocket } from '@hono/node-ws'
import type { WSContext } from 'hono/ws'
import type { Protocol } from '../cdp-types.js'
import type { CDPCommand, CDPResponse, CDPEvent } from '../cdp-types.js'
import type { ExtensionMessage, ExtensionEventMessage } from './protocol.js'
import chalk from 'chalk'

type ConnectedTarget = {
  sessionId: string
  targetId: string
  targetInfo: Protocol.Target.TargetInfo
}



type PlaywrightClient = {
  id: string
  ws: WSContext
}

export async function startPlayWriterCDPRelayServer({ port = 19988, host = '127.0.0.1', logger = console }: { port?: number; host?: string; logger?: { log(...args: any[]): void; error(...args: any[]): void } } = {}) {
  const connectedTargets = new Map<string, ConnectedTarget>()

  const playwrightClients = new Map<string, PlaywrightClient>()
  let extensionWs: WSContext | null = null

  const extensionPendingRequests = new Map<number, {
    resolve: (result: any) => void
    reject: (error: Error) => void
  }>()
  let extensionMessageId = 0

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

    const detailsStr = details.length > 0 ? ` ${chalk.gray(details.join(', '))}` : ''

    if (direction === 'from-playwright') {
      const clientLabel = clientId ? chalk.blue(`[${clientId}]`) : ''
      logger.log(chalk.cyan('← Playwright'), clientLabel + ':', method + detailsStr)
    } else if (direction === 'from-extension') {
      logger.log(chalk.yellow('← Extension:'), method + detailsStr)
    } else if (direction === 'to-playwright') {
      const color = source === 'server' ? chalk.magenta : chalk.green
      const sourceLabel = source === 'server' ? chalk.gray(' (server-generated)') : ''
      const clientLabel = clientId ? chalk.blue(`[${clientId}]`) : chalk.blue('[ALL]')
      logger.log(color('→ Playwright'), clientLabel + ':', method + detailsStr + sourceLabel)
    }
  }

  function sendToPlaywright({
    message,
    clientId,
    source = 'extension'
  }: {
    message: CDPResponse | CDPEvent
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

  async function sendToExtension({ method, params }: { method: string; params?: any }) {
    if (!extensionWs) {
      throw new Error('Extension not connected')
    }

    const id = ++extensionMessageId
    const message = { id, method, params }

    extensionWs.send(JSON.stringify(message))

    return new Promise((resolve, reject) => {
      extensionPendingRequests.set(id, { resolve, reject })
    })
  }

  async function routeCdpCommand({ method, params, sessionId }: { method: string; params: any; sessionId?: string }) {
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

      case 'Target.setAutoAttach': {
        if (sessionId) {
          break
        }
        return {}
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
          targetInfos: Array.from(connectedTargets.values()).map((t) => ({
            ...t.targetInfo,
            attached: true
          }))
        }
      }

      case 'Target.createTarget': {
        return await sendToExtension({
          method: 'forwardCDPCommand',
          params: { method, params }
        })
      }

      case 'Target.closeTarget': {
        return await sendToExtension({
          method: 'forwardCDPCommand',
          params: { method, params }
        })
      }
    }

    return await sendToExtension({
      method: 'forwardCDPCommand',
      params: { sessionId, method, params }
    })
  }

  const app = new Hono()
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })

  app.get('/', (c) => {
    return c.text('OK')
  })

  app.get('/cdp/:clientId?', upgradeWebSocket((c) => {
    const clientId = c.req.param('clientId') || 'default'

    return {
      onOpen(_event, ws) {
        if (playwrightClients.has(clientId)) {
          logger.log(chalk.red(`Rejecting duplicate client ID: ${clientId}`))
          ws.close(1000, 'Client ID already connected')
          return
        }

        playwrightClients.set(clientId, { id: clientId, ws })
        logger.log(chalk.green(`Playwright client connected: ${clientId} (${playwrightClients.size} total)`))
      },

      async onMessage(event, ws) {
        let message: CDPCommand

        try {
          message = JSON.parse(event.data.toString())
        } catch {
          return
        }

        const { id, sessionId, method, params } = message

        logCdpMessage({
          direction: 'from-playwright',
          clientId,
          method,
          sessionId,
          id
        })

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
          const result: any = await routeCdpCommand({ method, params, sessionId })

          if (method === 'Target.setAutoAttach' && !sessionId) {
            for (const target of connectedTargets.values()) {
              sendToPlaywright({
                message: {
                  method: 'Target.attachedToTarget',
                  params: {
                    sessionId: target.sessionId,
                    targetInfo: {
                      ...target.targetInfo,
                      attached: true
                    },
                    waitingForDebugger: false
                  }
                } satisfies CDPEvent,
                clientId,
                source: 'server'
              })
            }
          }

          sendToPlaywright({
            message: { id, sessionId, result },
            clientId
          })
        } catch (e) {
          logger.error('Error handling CDP command:', method, params, e)
          sendToPlaywright({
            message: {
              id,
              sessionId,
              error: { message: (e as Error).message }
            },
            clientId
          })
        }
      },

      onClose() {
        playwrightClients.delete(clientId)
        logger.log(chalk.yellow(`Playwright client disconnected: ${clientId} (${playwrightClients.size} remaining)`))
      },

      onError(event) {
        logger.error(`Playwright WebSocket error [${clientId}]:`, event)
      }
    }
  }))

  app.get('/extension', upgradeWebSocket(() => {
    return {
      onOpen(_event, ws) {
        if (extensionWs) {
          logger.log('Rejecting second extension connection')
          ws.close(1000, 'Another extension connection already established')
          return
        }

        // logger.log('Extension connecting, resetting server state')

        // // Clear stale targets from previous connections
        // const staleTargetCount = connectedTargets.size
        // if (staleTargetCount > 0) {
        //   logger.log(`Clearing ${staleTargetCount} stale targets from previous connection`)
        //   connectedTargets.clear()
        // }

        // // Reject any pending requests from previous connection
        // const pendingRequestCount = extensionPendingRequests.size
        // if (pendingRequestCount > 0) {
        //   logger.log(`Rejecting ${pendingRequestCount} pending requests from previous connection`)
        //   for (const pending of extensionPendingRequests.values()) {
        //     pending.reject(new Error('Extension reconnected, request cancelled'))
        //   }
        //   extensionPendingRequests.clear()
        // }

        // // Reset message ID counter
        // extensionMessageId = 0

        extensionWs = ws
        logger.log('Extension connected with clean state')
      },

      async onMessage(event, ws) {
        let message: ExtensionMessage

        try {
          message = JSON.parse(event.data.toString())
        } catch {
          ws.close(1000, 'Invalid JSON')
          return
        }

        if ('id' in message) {
          const pending = extensionPendingRequests.get(message.id)
          if (!pending) {
            logger.log('Unexpected response with id:', message.id)
            return
          }

          extensionPendingRequests.delete(message.id)

          if (message.error) {
            pending.reject(new Error(message.error))
          } else {
            pending.resolve(message.result)
          }
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

          if (method === 'Target.attachedToTarget') {
            const targetParams = params as Protocol.Target.AttachedToTargetEvent

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
                } as CDPEvent,
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
              } as CDPEvent,
              source: 'extension'
            })
          } else if (method === 'Target.targetInfoChanged') {
            const infoParams = params as Protocol.Target.TargetInfoChangedEvent
            const target = connectedTargets.get(sessionId ||'')
            if (target) {
              target.targetInfo = infoParams.targetInfo
              // Update targetId mapping if needed, though usually targetId doesn't change
              if (target.targetId !== infoParams.targetInfo.targetId) {
                 target.targetId = infoParams.targetInfo.targetId
              }
            }

            sendToPlaywright({
              message: {
                method: 'Target.targetInfoChanged',
                params: infoParams
              } as CDPEvent,
              source: 'extension'
            })
          } else {
            sendToPlaywright({
              message: {
                sessionId,
                method,
                params
              } as CDPEvent,
              source: 'extension'
            })
          }
        }
      },

      onClose() {
        logger.log('Extension disconnected')

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
        logger.error('Extension WebSocket error:', event)
      }
    }
  }))

  const server = serve({ fetch: app.fetch, port, hostname: host })
  injectWebSocket(server)

  const wsHost = `ws://${host}:${port}`
  const cdpEndpoint = `${wsHost}/cdp`
  const extensionEndpoint = `${wsHost}/extension`

  logger.log('CDP relay server started')
  logger.log('Host:', host)
  logger.log('Port:', port)
  logger.log('Extension endpoint:', extensionEndpoint)
  logger.log('CDP endpoint:', cdpEndpoint)

  return {
    close() {
      for (const client of playwrightClients.values()) {
        client.ws.close(1000, 'Server stopped')
      }
      playwrightClients.clear()
      extensionWs?.close(1000, 'Server stopped')
      server.close()
    }
  }
}
