/**
 * Keeps one agent mistake from killing the relay or MCP process, and every session with it.
 *
 * - unhandledRejection: always logged (rate limited), counted, and ignored.
 * - uncaughtException: ignored only when the stack comes from sandbox code or playwright-core.
 *   Anything else is a real bug in our process: log, flush, exit(1).
 *
 * While an execute call runs, a v8 promise hook tags every promise it creates (also promises
 * created inside the vm sandbox) with the running executor. A rejection of a tagged promise is
 * reported to that executor as a warning, so the agent sees it in the next execute output.
 * Inspired by anomalyco/browse execute-realm/membrane-policy.ts.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import util from 'node:util'
import v8 from 'node:v8'

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
const promiseOwners = new WeakMap<Promise<unknown>, FaultOwner>()
let stopPromiseHook: (() => void) | undefined
let promiseHookUsers = 0

/** Run agent code so promises it creates, and its async continuations and timers, belong to owner. */
export function runAsFaultOwner<T>({ owner, run }: { owner: FaultOwner; run: () => T }): T {
  return ownerStore.run(owner, run)
}

/** Install the promise hook while agent code runs. Promise hooks slow every await, so release it after. */
export function retainPromiseHook(): () => void {
  promiseHookUsers += 1
  if (promiseHookUsers === 1) {
    stopPromiseHook = v8.promiseHooks.onInit((promise, parent) => {
      const owner = ownerStore.getStore() ?? (parent ? promiseOwners.get(parent) : undefined)
      if (owner) {
        promiseOwners.set(promise, owner)
      }
    }) as () => void
  }
  let released = false
  return () => {
    if (released) {
      return
    }
    released = true
    promiseHookUsers -= 1
    if (promiseHookUsers === 0) {
      stopPromiseHook?.()
      stopPromiseHook = undefined
    }
  }
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

  process.on('unhandledRejection', (reason, promise) => {
    // Promises created after the hook was released still carry the owner in their async context.
    const owner = promiseOwners.get(promise) ?? ownerStore.getStore()
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
