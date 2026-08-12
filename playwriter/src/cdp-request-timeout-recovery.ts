import {
  TIMED_OUT_CDP_TARGET_RECOVERY_REQUEST_TIMEOUT_MS,
  type RecoverTimedOutCDPTargetResult,
} from './protocol.js'

type ExtensionRequest = {
  method: string
  params?: unknown
  timeout?: number
}

type ForwardCDPCommandParams = {
  method: string
  sessionId?: string
}

export class RecoveredCDPTimeoutError extends Error {
  constructor(
    message: string,
    readonly recoveryId: string,
    readonly publicationToken: string,
  ) {
    super(message)
    this.name = 'RecoveredCDPTimeoutError'
  }
}

export async function completeRecoveredCDPTimeout({
  error,
  sendErrorResponse,
  publishRecovery,
}: {
  error: Error
  sendErrorResponse: () => void
  publishRecovery: (recoveryId: string, publicationToken: string) => Promise<void>
}): Promise<void> {
  sendErrorResponse()
  if (error instanceof RecoveredCDPTimeoutError) {
    await publishRecovery(error.recoveryId, error.publicationToken)
  }
}

function getForwardCDPCommandParams(value: unknown): ForwardCDPCommandParams | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const record = value as { method?: unknown; sessionId?: unknown }
  if (typeof record.method !== 'string') {
    return undefined
  }

  return {
    method: record.method,
    sessionId: typeof record.sessionId === 'string' ? record.sessionId : undefined,
  }
}

export async function recoverTimedOutExtensionRequest({
  method,
  params,
  timeout,
  requestError,
  sendRecovery,
}: {
  method: string
  params?: unknown
  timeout: number
  requestError?: Error
  sendRecovery: (message: ExtensionRequest) => Promise<unknown>
}): Promise<Error> {
  const timeoutMessage = requestError?.message || `Extension request timeout after ${timeout}ms: ${method}`
  const forwardCommand = method === 'forwardCDPCommand' ? getForwardCDPCommandParams(params) : undefined

  if (!forwardCommand?.sessionId) {
    return new Error(timeoutMessage)
  }

  try {
    const recovery = (await sendRecovery({
      method: 'recoverTimedOutCDPTarget',
      params: {
        sessionId: forwardCommand.sessionId,
        timedOutMethod: forwardCommand.method,
      },
      timeout: TIMED_OUT_CDP_TARGET_RECOVERY_REQUEST_TIMEOUT_MS,
    })) as RecoverTimedOutCDPTargetResult

    if (recovery.status === 'recovered') {
      return new RecoveredCDPTimeoutError(
        `${timeoutMessage}. The unresponsive target was reattached as ${recovery.newSessionId}; ` +
          `the timed-out ${forwardCommand.method} command was not retried. Verify page state before continuing.`,
        recovery.recoveryId,
        recovery.publicationToken,
      )
    }

    return new Error(
      `${timeoutMessage}. The target session had already changed; ` +
        `the timed-out ${forwardCommand.method} command was not retried. Verify page state before continuing.`,
    )
  } catch (error) {
    const recoveryMessage = error instanceof Error ? error.message : String(error)
    return new Error(
      `${timeoutMessage}. Automatic target recovery failed: ${recoveryMessage}. ` +
        `The timed-out ${forwardCommand.method} command was not retried.`,
    )
  }
}
