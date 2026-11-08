/**
 * Keeps one agent mistake from killing the relay or MCP process, and every session with it.
 *
 * - unhandledRejection: always logged (rate limited), counted, and ignored.
 * - uncaughtException: ignored only when the stack comes from sandbox code or playwright-core.
 *   Anything else is a real bug in our process: log, flush, exit(1).
 *
 * Agent code runs inside AsyncLocalStorage with its executor. Node runs unhandledRejection
 * handlers in the async context of the rejected promise (also vm sandbox promises, Node 18+),
 * so a rejection is reported to that executor as a warning in its next execute output.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import util from 'node:util'

/** vm filename of agent code. Stack frames with it come from the sandbox. */
export const SANDBOX_FILENAME = '.playwriter-eval.js'

/** Code that owns a fault: an executor running agent code. */
export type FaultOwner = {
  enqueueWarning(message: string): void
}

export type GuardLogger = {
  error(...args: unknown[]): unknown
  /** Write buffered lines to disk now. Called before process.exit. */
  flushSync?(): void
}

const ownerStore = new AsyncLocalStorage<FaultOwner>()

/** Run agent code so promises it creates, and its async continuations and timers, belong to owner. */
export function runAsFaultOwner<T>({ owner, run }: { owner: FaultOwner; run: () => T }): T {
  return ownerStore.run(owner, run)
}

/**
 * Stack of a thrown value, or its inspected form. Never throws: sandbox values can have throwing getters.
 * Errors from the vm realm fail `instanceof Error`, so read `stack` directly.
 */
export function describeThrown(value: unknown): string {
  try {
    const stack = (value as { stack?: unknown } | null)?.stack
    if (typeof stack === 'string') {
      return stack
    }
    return util.inspect(value, { depth: 2, maxStringLength: 500 })
  } catch {
    return 'unknown error (could not format thrown value)'
  }
}

function isContainedException(error: unknown): boolean {
  const stack = describeThrown(error)
  return stack.includes(SANDBOX_FILENAME) || /[/\\](playwright|patchright)-core[/\\]/.test(stack)
}

const LOG_WINDOW_MS = 60_000
const MAX_LOGS_PER_WINDOW = 5

/** Install unhandledRejection, uncaughtException and exit handlers for a long lived process. */
export function installProcessGuard({ logger }: { logger: GuardLogger }) {
  let faultCount = 0
  let windowStart = 0
  let windowLogs = 0
  let suppressed = 0

  const logContainedFault = ({ kind, error, owned }: { kind: string; error: unknown; owned: boolean }) => {
    faultCount += 1
    const now = Date.now()
    if (now - windowStart > LOG_WINDOW_MS) {
      if (suppressed > 0) {
        logger.error(`[process-guard] ${suppressed} more contained faults were not logged in the last minute`)
      }
      windowStart = now
      windowLogs = 0
      suppressed = 0
    }
    if (windowLogs >= MAX_LOGS_PER_WINDOW) {
      suppressed += 1
      return
    }
    windowLogs += 1
    const target = owned ? ', reported to its session' : ''
    logger.error(`[process-guard] contained ${kind} #${faultCount}${target}: ${describeThrown(error)}`)
  }

  process.on('unhandledRejection', (reason) => {
    const owner = ownerStore.getStore()
    owner?.enqueueWarning(
      `Unhandled promise rejection in your code (missing await?): ${describeThrown(reason)}`,
    )
    logContainedFault({ kind: 'unhandledRejection', error: reason, owned: Boolean(owner) })
  })

  process.on('uncaughtException', (error) => {
    if (!isContainedException(error)) {
      logger.error('Uncaught Exception:', error)
      logger.flushSync?.()
      process.exit(1)
    }
    // A throw from a sandbox callback keeps the async context of the code that registered it.
    const owner = ownerStore.getStore()
    owner?.enqueueWarning(`Uncaught exception in your code: ${describeThrown(error)}`)
    logContainedFault({ kind: 'uncaughtException', error, owned: Boolean(owner) })
  })

  // exit handlers must be sync: write the buffered lines, including the fatal one.
  process.on('exit', (code) => {
    if (!logger.flushSync) {
      return
    }
    logger.error(`Process exiting with code: ${code}`)
    logger.flushSync()
  })
}
