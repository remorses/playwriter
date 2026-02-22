import type { Page, CDPSession as PlaywrightCDPSession } from '@xmorse/playwright-core'
import type { ProtocolMapping } from 'devtools-protocol/types/protocol-mapping.js'

/**
 * Type-safe CDP session interface using devtools-protocol ProtocolMapping.
 * Provides autocomplete and type checking for CDP commands and events.
 * Return types are inferred from the command string (e.g. 'Page.getLayoutMetrics'
 * returns Protocol.Page.GetLayoutMetricsResponse).
 */
export interface ICDPSession {
  send<K extends keyof ProtocolMapping.Commands>(
    method: K,
    params?: ProtocolMapping.Commands[K]['paramsType'][0],
    sessionId?: string | null,
  ): Promise<ProtocolMapping.Commands[K]['returnType']>

  on<K extends keyof ProtocolMapping.Events>(
    event: K,
    callback: (params: ProtocolMapping.Events[K][0]) => void,
  ): unknown

  off<K extends keyof ProtocolMapping.Events>(
    event: K,
    callback: (params: ProtocolMapping.Events[K][0]) => void,
  ): unknown

  detach(): Promise<void>
  getSessionId?(): string | null
}

/**
 * Wraps Playwright's CDPSession (from context.getExistingCDPSession) into an ICDPSession.
 * This reuses Playwright's internal CDP WebSocket instead of creating a new one,
 * which is important for the relay server where Target.attachToTarget is intercepted.
 */
export class PlaywrightCDPSessionAdapter implements ICDPSession {
  private _playwrightSession: PlaywrightCDPSession

  constructor(playwrightSession: PlaywrightCDPSession) {
    this._playwrightSession = playwrightSession
  }

  async send<K extends keyof ProtocolMapping.Commands>(
    method: K,
    params?: ProtocolMapping.Commands[K]['paramsType'][0],
  ): Promise<ProtocolMapping.Commands[K]['returnType']> {
    return await this._playwrightSession.send(method as never, params as never)
  }

  on<K extends keyof ProtocolMapping.Events>(event: K, callback: (params: ProtocolMapping.Events[K][0]) => void): this {
    this._playwrightSession.on(event as never, callback as never)
    return this
  }

  off<K extends keyof ProtocolMapping.Events>(
    event: K,
    callback: (params: ProtocolMapping.Events[K][0]) => void,
  ): this {
    this._playwrightSession.off(event as never, callback as never)
    return this
  }

  async detach(): Promise<void> {
    await this._playwrightSession.detach()
  }
}

/**
 * Gets a CDP session for a page by reusing Playwright's internal existing CDP session.
 * This uses the same WebSocket Playwright already has, avoiding new connections.
 * Works through the relay because it doesn't call Target.attachToTarget.
 */
export async function getCDPSessionForPage({ page }: { page: Page }): Promise<PlaywrightCDPSessionAdapter> {
  const context = page.context()
  const playwrightSession = await context.getExistingCDPSession(page)
  return new PlaywrightCDPSessionAdapter(playwrightSession)
}
