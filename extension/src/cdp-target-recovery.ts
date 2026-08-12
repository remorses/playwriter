import type { RecoverTimedOutCDPTargetParams, RecoverTimedOutCDPTargetResult } from 'playwriter/src/protocol'

type RecoverableTarget = {
  recoveryKey: string | number
  tabId: number
  sessionId: string
  targetId: string
}

type AttachedTarget = {
  recoveryId: string
  sessionId: string
  targetId: string
}

type CoordinatedRecoveryResult =
  | Omit<Extract<RecoverTimedOutCDPTargetResult, { status: 'recovered' }>, 'publicationToken'>
  | Extract<RecoverTimedOutCDPTargetResult, { status: 'stale' }>

export function createRecoveryPublicationBarrier() {
  let nextToken = 1
  const publications = new Map<string, { waiters: Set<string>; acknowledged: Set<string> }>()

  return {
    register(recoveryId: string): string {
      const publication = publications.get(recoveryId) || {
        waiters: new Set<string>(),
        acknowledged: new Set<string>(),
      }
      const token = `publication-${nextToken++}`
      publication.waiters.add(token)
      publications.set(recoveryId, publication)
      return token
    },
    acknowledge(recoveryId: string, token: string): 'waiting' | 'publish' | 'unknown' {
      const publication = publications.get(recoveryId)
      if (!publication?.waiters.has(token)) {
        return 'unknown'
      }
      publication.acknowledged.add(token)
      return publication.acknowledged.size === publication.waiters.size ? 'publish' : 'waiting'
    },
    complete(recoveryId: string): void {
      publications.delete(recoveryId)
    },
  }
}

export function createTimedOutTargetRecovery({
  findTargetBySessionId,
  detachTarget,
  attachTarget,
  markRecoveryFailed = () => {},
}: {
  findTargetBySessionId: (sessionId: string) => RecoverableTarget | undefined
  detachTarget: (tabId: number) => Promise<void>
  attachTarget: (tabId: number) => Promise<AttachedTarget>
  markRecoveryFailed?: (target: RecoverableTarget, error: Error) => void
}): {
  recover: (params: RecoverTimedOutCDPTargetParams) => Promise<CoordinatedRecoveryResult>
  complete: (recoveryId: string) => void
} {
  type RecoveryEntry = {
    promise: Promise<CoordinatedRecoveryResult>
    recoveryId?: string
  }
  const recoveriesByTarget = new Map<string | number, RecoveryEntry>()
  const recoveryKeysById = new Map<string, string | number>()

  const recover = (params: RecoverTimedOutCDPTargetParams): Promise<CoordinatedRecoveryResult> => {
    const target = findTargetBySessionId(params.sessionId)
    if (!target) {
      return Promise.resolve({ status: 'stale', oldSessionId: params.sessionId })
    }

    const existing = recoveriesByTarget.get(target.recoveryKey)
    if (existing) {
      return existing.promise
    }

    let entry!: RecoveryEntry
    const recovery = (async (): Promise<CoordinatedRecoveryResult> => {
      try {
        await detachTarget(target.tabId)
        const attached = await attachTarget(target.tabId)
        const result: CoordinatedRecoveryResult = {
          status: 'recovered',
          recoveryId: attached.recoveryId,
          oldSessionId: target.sessionId,
          newSessionId: attached.sessionId,
          targetId: attached.targetId,
        }
        entry.recoveryId = attached.recoveryId
        recoveryKeysById.set(attached.recoveryId, target.recoveryKey)
        return result
      } catch (error) {
        const recoveryError = error instanceof Error ? error : new Error(String(error))
        markRecoveryFailed(target, recoveryError)
        if (recoveriesByTarget.get(target.recoveryKey) === entry) {
          recoveriesByTarget.delete(target.recoveryKey)
        }
        throw recoveryError
      }
    })()

    entry = { promise: recovery }
    recoveriesByTarget.set(target.recoveryKey, entry)
    return recovery
  }

  const complete = (recoveryId: string): void => {
    const recoveryKey = recoveryKeysById.get(recoveryId)
    if (recoveryKey === undefined) {
      return
    }
    const entry = recoveriesByTarget.get(recoveryKey)
    if (entry?.recoveryId === recoveryId) {
      recoveriesByTarget.delete(recoveryKey)
    }
    recoveryKeysById.delete(recoveryId)
  }

  return { recover, complete }
}
