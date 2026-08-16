import { describe, expect, it } from 'vitest'
import {
  createRecoveryPublicationBarrier,
  createTimedOutTargetRecovery,
} from 'mcp-extension/src/cdp-target-recovery.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

describe('createTimedOutTargetRecovery', () => {
  it('coalesces overlapping recovery requests for the same timed-out session', async () => {
    const detachStarted = deferred<void>()
    const allowDetach = deferred<void>()
    const calls: string[] = []
    const target = { recoveryKey: 42, tabId: 42, sessionId: 'pw-tab-old', targetId: 'target-1' }

    const recovery = createTimedOutTargetRecovery({
      findTargetBySessionId: (sessionId) => (sessionId === target.sessionId ? target : undefined),
      detachTarget: async (tabId) => {
        calls.push(`detach:${tabId}`)
        detachStarted.resolve()
        await allowDetach.promise
      },
      attachTarget: async (tabId) => {
        calls.push(`attach:${tabId}`)
        return { recoveryId: 'recovery-1', sessionId: 'pw-tab-new', targetId: 'target-1' }
      },
    })

    const first = recovery.recover({ sessionId: 'pw-tab-old', timedOutMethod: 'Runtime.callFunctionOn' })
    await detachStarted.promise
    const second = recovery.recover({ sessionId: 'pw-tab-old', timedOutMethod: 'DOM.enable' })
    allowDetach.resolve()

    await expect(Promise.all([first, second])).resolves.toEqual([
      {
        status: 'recovered',
        recoveryId: 'recovery-1',
        oldSessionId: 'pw-tab-old',
        newSessionId: 'pw-tab-new',
        targetId: 'target-1',
      },
      {
        status: 'recovered',
        recoveryId: 'recovery-1',
        oldSessionId: 'pw-tab-old',
        newSessionId: 'pw-tab-new',
        targetId: 'target-1',
      },
    ])
    expect(calls).toEqual(['detach:42', 'attach:42'])
  })

  it('coalesces root and child-session timeouts for the same tab', async () => {
    const allowDetach = deferred<void>()
    let detachCalls = 0
    const rootTarget = { recoveryKey: 42, tabId: 42, sessionId: 'pw-tab-root', targetId: 'target-1' }
    const childTarget = { recoveryKey: 42, tabId: 42, sessionId: 'pw-tab-root', targetId: 'target-1' }
    const recovery = createTimedOutTargetRecovery({
      findTargetBySessionId: (sessionId) => (sessionId === 'child-session' ? childTarget : rootTarget),
      detachTarget: async () => {
        detachCalls += 1
        await allowDetach.promise
      },
      attachTarget: async () => ({
        recoveryId: 'recovery-1',
        sessionId: 'pw-tab-new',
        targetId: 'target-1',
      }),
    })

    const rootRecovery = recovery.recover({ sessionId: 'pw-tab-root', timedOutMethod: 'Runtime.callFunctionOn' })
    const childRecovery = recovery.recover({ sessionId: 'child-session', timedOutMethod: 'DOM.enable' })
    allowDetach.resolve()

    const [rootResult, childResult] = await Promise.all([rootRecovery, childRecovery])
    expect(rootResult).toEqual(childResult)
    expect(detachCalls).toBe(1)
  })

  it('ignores a late timeout for a session that is no longer current', async () => {
    const calls: string[] = []
    const recovery = createTimedOutTargetRecovery({
      findTargetBySessionId: () => undefined,
      detachTarget: async (tabId) => {
        calls.push(`detach:${tabId}`)
      },
      attachTarget: async (tabId) => {
        calls.push(`attach:${tabId}`)
        return { recoveryId: 'recovery-1', sessionId: 'pw-tab-new', targetId: 'target-1' }
      },
    })

    await expect(
      recovery.recover({ sessionId: 'pw-tab-old', timedOutMethod: 'Runtime.callFunctionOn' }),
    ).resolves.toEqual({ status: 'stale', oldSessionId: 'pw-tab-old' })
    expect(calls).toEqual([])
  })

  it('releases the single-flight lock after a failed recovery', async () => {
    let attachAttempts = 0
    const failures: string[] = []
    const target = { recoveryKey: 42, tabId: 42, sessionId: 'pw-tab-old', targetId: 'target-1' }
    const recovery = createTimedOutTargetRecovery({
      findTargetBySessionId: () => target,
      detachTarget: async () => {},
      attachTarget: async () => {
        attachAttempts += 1
        if (attachAttempts === 1) {
          throw new Error('attach failed')
        }
        return { recoveryId: 'recovery-2', sessionId: 'pw-tab-new', targetId: 'target-1' }
      },
      markRecoveryFailed: (_target, error) => {
        failures.push(error.message)
      },
    })

    await expect(
      recovery.recover({ sessionId: 'pw-tab-old', timedOutMethod: 'Runtime.callFunctionOn' }),
    ).rejects.toThrow('attach failed')
    await expect(
      recovery.recover({ sessionId: 'pw-tab-old', timedOutMethod: 'Runtime.callFunctionOn' }),
    ).resolves.toMatchObject({ status: 'recovered', newSessionId: 'pw-tab-new' })
    expect(attachAttempts).toBe(2)
    expect(failures).toEqual(['attach failed'])
  })

  it('keeps returning the completed recovery until it is published', async () => {
    let detachCalls = 0
    let attachCalls = 0
    const target = { recoveryKey: 42, tabId: 42, sessionId: 'pw-tab-old', targetId: 'target-1' }
    const recovery = createTimedOutTargetRecovery({
      findTargetBySessionId: () => target,
      detachTarget: async () => {
        detachCalls += 1
      },
      attachTarget: async () => {
        attachCalls += 1
        return {
          recoveryId: `recovery-${attachCalls}`,
          sessionId: `pw-tab-new-${attachCalls}`,
          targetId: 'target-1',
        }
      },
    })

    const first = await recovery.recover({
      sessionId: 'pw-tab-old',
      timedOutMethod: 'Runtime.callFunctionOn',
    })
    const afterReattachBeforePublish = await recovery.recover({
      sessionId: 'pw-tab-old',
      timedOutMethod: 'DOM.enable',
    })

    expect(afterReattachBeforePublish).toEqual(first)
    expect(detachCalls).toBe(1)
    expect(attachCalls).toBe(1)

    recovery.complete('recovery-1')
    await recovery.recover({ sessionId: 'pw-tab-old', timedOutMethod: 'Network.enable' })
    expect(detachCalls).toBe(2)
    expect(attachCalls).toBe(2)
  })
})

describe('createRecoveryPublicationBarrier', () => {
  it('waits for every recovery caller to acknowledge its error before publication', () => {
    const barrier = createRecoveryPublicationBarrier()
    const first = barrier.register('recovery-1')
    const second = barrier.register('recovery-1')

    expect(barrier.acknowledge('recovery-1', first)).toBe('waiting')
    expect(barrier.acknowledge('recovery-1', second)).toBe('publish')
  })

  it('rejects unknown and completed publication tokens', () => {
    const barrier = createRecoveryPublicationBarrier()
    const token = barrier.register('recovery-1')

    expect(barrier.acknowledge('recovery-1', 'publication-unknown')).toBe('unknown')
    barrier.complete('recovery-1')
    expect(barrier.acknowledge('recovery-1', token)).toBe('unknown')
  })
})
