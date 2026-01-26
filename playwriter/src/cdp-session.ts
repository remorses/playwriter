import WebSocket from 'ws'
import type { Page } from 'playwright-core'
import type { ProtocolMapping } from 'devtools-protocol/types/protocol-mapping.js'
import type { CDPResponseBase, CDPEventBase } from './cdp-types.js'
import { getCdpUrl } from './utils.js'

/**
 * Common interface for CDP sessions that works with both our CDPSession
 * and Playwright's CDPSession. Use this type when you want to accept either.
 *
 * Uses loose types so Playwright's CDPSession (which uses Protocol.Events)
 * is assignable to this interface.
 */
export interface ICDPSession {
  send(method: string, params?: object): Promise<unknown>
  on(event: string, callback: (params: any) => void): unknown
  off(event: string, callback: (params: any) => void): unknown
  detach(): Promise<void>
}

interface PendingRequest {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
}

export class CDPSession implements ICDPSession {
  private ws: WebSocket
  private pendingRequests = new Map<number, PendingRequest>()
  private eventListeners = new Map<string, Set<(params: unknown) => void>>()
  private messageId = 0
  private sessionId: string | null = null

  constructor(ws: WebSocket) {
    this.ws = ws
    this.ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as CDPResponseBase | CDPEventBase

        if ('id' in message) {
          const response = message as CDPResponseBase
          const pending = this.pendingRequests.get(response.id)
          if (pending) {
            this.pendingRequests.delete(response.id)
            if (response.error) {
              pending.reject(new Error(response.error.message))
            } else {
              pending.resolve(response.result)
            }
          }
        } else if ('method' in message) {
          const event = message as CDPEventBase
          if (event.sessionId === this.sessionId || !event.sessionId) {
            const listeners = this.eventListeners.get(event.method)
            if (listeners) {
              for (const listener of listeners) {
                listener(event.params)
              }
            }
          }
        }
      } catch (e) {
        console.error('[CDPSession] Message handling error:', e)
      }
    })
  }

  setSessionId(sessionId: string) {
    this.sessionId = sessionId
  }

  send<K extends keyof ProtocolMapping.Commands>(
    method: K,
    params?: ProtocolMapping.Commands[K]['paramsType'][0],
  ): Promise<ProtocolMapping.Commands[K]['returnType']> {
    const id = ++this.messageId
    const message: {
      id: number
      method: K
      params?: ProtocolMapping.Commands[K]['paramsType'][0]
      sessionId?: string
      source?: 'playwriter'
    } = { id, method, params, source: 'playwriter' }
    if (this.sessionId) {
      message.sessionId = this.sessionId
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`CDP command timeout: ${method}`))
      }, 30000)

      this.pendingRequests.set(id, {
        resolve: (result) => {
          clearTimeout(timeout)
          resolve(result as ProtocolMapping.Commands[K]['returnType'])
        },
        reject: (error) => {
          clearTimeout(timeout)
          reject(error)
        },
      })

      try {
        this.ws.send(JSON.stringify(message))
      } catch (error) {
        clearTimeout(timeout)
        this.pendingRequests.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  on<K extends keyof ProtocolMapping.Events>(event: K, callback: (params: ProtocolMapping.Events[K][0]) => void): this {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set())
    }
    this.eventListeners.get(event)!.add(callback as (params: unknown) => void)
    return this
  }

  /** Alias for `on` - matches Playwright's CDPSession interface */
  addListener<K extends keyof ProtocolMapping.Events>(
    event: K,
    callback: (params: ProtocolMapping.Events[K][0]) => void,
  ): this {
    return this.on(event, callback)
  }

  off<K extends keyof ProtocolMapping.Events>(event: K, callback: (params: ProtocolMapping.Events[K][0]) => void): this {
    this.eventListeners.get(event)?.delete(callback as (params: unknown) => void)
    return this
  }

  /** Alias for `off` - matches Playwright's CDPSession interface */
  removeListener<K extends keyof ProtocolMapping.Events>(
    event: K,
    callback: (params: ProtocolMapping.Events[K][0]) => void,
  ): this {
    return this.off(event, callback)
  }

  /** Listen for an event once, then automatically remove the listener */
  once<K extends keyof ProtocolMapping.Events>(event: K, callback: (params: ProtocolMapping.Events[K][0]) => void): this {
    const onceCallback = (params: ProtocolMapping.Events[K][0]) => {
      this.off(event, onceCallback)
      callback(params)
    }
    return this.on(event, onceCallback)
  }

  /** Alias for `close` - matches Playwright's CDPSession interface */
  detach(): Promise<void> {
    this.close()
    return Promise.resolve()
  }

  close() {
    try {
      for (const pending of this.pendingRequests.values()) {
        pending.reject(new Error('CDPSession detached'))
      }
      this.pendingRequests.clear()
      this.eventListeners.clear()
      this.ws.close()
    } catch (e) {
      console.error('[CDPSession] WebSocket close error:', e)
    }
  }
}

export async function getCDPSessionForPage({ page, wsUrl }: { page: Page; wsUrl?: string }): Promise<CDPSession> {
  const resolvedWsUrl = wsUrl || getCdpUrl()
  const ws = new WebSocket(resolvedWsUrl)

  await new Promise<void>((resolve, reject) => {
    ws.on('open', resolve)
    ws.on('error', reject)
  })

  const cdp = new CDPSession(ws)

  const pages = page.context().pages()
  const pageIndex = pages.indexOf(page)
  if (pageIndex === -1) {
    cdp.close()
    throw new Error('Page not found in context')
  }

  const { targetInfos } = await cdp.send('Target.getTargets')
  const pageTargets = targetInfos.filter((t) => t.type === 'page')

  if (pageIndex >= pageTargets.length) {
    cdp.close()
    throw new Error(`Page index ${pageIndex} out of bounds (${pageTargets.length} targets)`)
  }

  const target = pageTargets[pageIndex]
  if (target.url !== page.url()) {
    cdp.close()
    throw new Error(`URL mismatch: page has "${page.url()}" but target has "${target.url}"`)
  }

  const { sessionId } = await cdp.send('Target.attachToTarget', {
    targetId: target.targetId,
    flatten: true,
  })
  cdp.setSessionId(sessionId)

  return cdp
}
