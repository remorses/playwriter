import { describe, expect, it } from 'vitest'
import {
  completeRecoveredCDPTimeout,
  RecoveredCDPTimeoutError,
  recoverTimedOutExtensionRequest,
} from './cdp-request-timeout-recovery.js'

describe('recoverTimedOutExtensionRequest', () => {
  it('recovers the target once without resending the timed-out CDP action', async () => {
    const sentMessages: Array<{ method: string; params?: unknown; timeout?: number }> = []

    const error = await recoverTimedOutExtensionRequest({
      method: 'forwardCDPCommand',
      params: {
        method: 'Input.dispatchMouseEvent',
        sessionId: 'pw-tab-old',
        params: { type: 'mousePressed', x: 10, y: 20 },
      },
      timeout: 30000,
      sendRecovery: async (message) => {
        sentMessages.push(message)
        return {
          status: 'recovered',
          recoveryId: 'recovery-1',
          publicationToken: 'publication-1',
          oldSessionId: 'pw-tab-old',
          newSessionId: 'pw-tab-new',
          targetId: 'target-1',
        }
      },
    })

    expect(sentMessages).toEqual([
      {
        method: 'recoverTimedOutCDPTarget',
        params: { sessionId: 'pw-tab-old', timedOutMethod: 'Input.dispatchMouseEvent' },
        timeout: 35000,
      },
    ])
    expect(sentMessages.some((message) => message.method === 'forwardCDPCommand')).toBe(false)
    expect(error.message).toContain('Extension request timeout after 30000ms: forwardCDPCommand')
    expect(error.message).toContain('reattached as pw-tab-new')
    expect(error.message).toContain('was not retried')
    expect(error).toBeInstanceOf(RecoveredCDPTimeoutError)
    expect((error as RecoveredCDPTimeoutError).recoveryId).toBe('recovery-1')
    expect((error as RecoveredCDPTimeoutError).publicationToken).toBe('publication-1')
  })

  it('does not attempt target recovery when the timed-out request has no CDP session', async () => {
    let recoveryCalls = 0

    const error = await recoverTimedOutExtensionRequest({
      method: 'forwardCDPCommand',
      params: { method: 'Target.createTarget', params: { url: 'about:blank' } },
      timeout: 30000,
      sendRecovery: async () => {
        recoveryCalls += 1
        throw new Error('should not run')
      },
    })

    expect(recoveryCalls).toBe(0)
    expect(error.message).toBe('Extension request timeout after 30000ms: forwardCDPCommand')
  })

  it('preserves the timeout failure when recovery itself fails', async () => {
    const error = await recoverTimedOutExtensionRequest({
      method: 'forwardCDPCommand',
      params: { method: 'Runtime.callFunctionOn', sessionId: 'pw-tab-old' },
      timeout: 30000,
      sendRecovery: async () => {
        throw new Error('debugger attach failed')
      },
    })

    expect(error.message).toContain('Extension request timeout after 30000ms: forwardCDPCommand')
    expect(error.message).toContain('Automatic target recovery failed: debugger attach failed')
    expect(error.message).toContain('was not retried')
  })

  it('recovers an extension-local fast-command timeout through the relay', async () => {
    const error = await recoverTimedOutExtensionRequest({
      method: 'forwardCDPCommand',
      params: { method: 'Page.enable', sessionId: 'pw-tab-old' },
      timeout: 30000,
      requestError: new Error('CDP command timed out after 10000ms: Page.enable (tab may be frozen/hibernated)'),
      sendRecovery: async () => ({
        status: 'recovered',
        recoveryId: 'recovery-1',
        publicationToken: 'publication-1',
        oldSessionId: 'pw-tab-old',
        newSessionId: 'pw-tab-new',
        targetId: 'target-1',
      }),
    })

    expect(error.message).toContain('CDP command timed out after 10000ms: Page.enable')
    expect(error).toBeInstanceOf(RecoveredCDPTimeoutError)
  })

  it('sends the original error before publishing the recovered target', async () => {
    const order: string[] = []
    const error = new RecoveredCDPTimeoutError('timed out; not retried', 'recovery-1', 'publication-1')

    await completeRecoveredCDPTimeout({
      error,
      sendErrorResponse: () => {
        order.push('error-response')
      },
      publishRecovery: async (recoveryId, publicationToken) => {
        order.push(`publish:${recoveryId}:${publicationToken}`)
      },
    })

    expect(order).toEqual(['error-response', 'publish:recovery-1:publication-1'])
  })
})
