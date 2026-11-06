import fs from 'node:fs'
import path from 'node:path'
import util from 'node:util'
import stripAnsi from 'strip-ansi'
import { LOG_FILE_PATH, redactRemoteControlSecrets } from './utils.js'

export type Logger = {
  log(...args: unknown[]): Promise<void>
  error(...args: unknown[]): Promise<void>
  /** Flush buffered log lines to disk (call before process.exit) */
  flush(): Promise<void>
  logFilePath: string
}

export function createFileLogger({ logFilePath }: { logFilePath?: string } = {}): Logger {
  const resolvedLogFilePath = logFilePath || LOG_FILE_PATH
  const logDir = path.dirname(resolvedLogFilePath)
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true })
  }
  fs.writeFileSync(resolvedLogFilePath, '')

  let queue: Promise<void> = Promise.resolve()

  // Batch buffer: accumulate log lines and flush periodically to reduce disk I/O
  // under high CDP event throughput. See: https://github.com/remorses/playwriter/issues/96
  const FLUSH_INTERVAL_MS = 500
  let buffer: string[] = []
  let flushTimer: ReturnType<typeof setInterval> | undefined

  const flushBuffer = async (): Promise<void> => {
    if (buffer.length === 0) {
      return
    }
    const lines = buffer
    buffer = []
    await fs.promises.appendFile(resolvedLogFilePath, lines.join('\n') + '\n')
  }

  const log = (...args: unknown[]): Promise<void> => {
    const message = args
      .map((arg) => {
        const value =
          typeof arg === 'string' ? arg : util.inspect(arg, { depth: null, colors: false, maxStringLength: 1000 })
        return redactRemoteControlSecrets(value)
      })
      .join(' ')
    // PLAYWRITER_LOG_TIMESTAMPS=1 prefixes each line with an ISO time, to correlate
    // extension debug lines with cdp.jsonl when diagnosing slow tab creation
    const timestamp = process.env.PLAYWRITER_LOG_TIMESTAMPS === '1' ? `${new Date().toISOString()} ` : ''
    buffer.push(timestamp + stripAnsi(message))
    if (!flushTimer) {
      flushTimer = setInterval(() => {
        queue = queue.then(flushBuffer)
      }, FLUSH_INTERVAL_MS)
      flushTimer.unref()
    }
    return queue
  }

  const flush = async (): Promise<void> => {
    if (flushTimer) {
      clearInterval(flushTimer)
      flushTimer = undefined
    }
    queue = queue.then(flushBuffer)
    await queue
  }

  return {
    log,
    error: log,
    flush,
    logFilePath: resolvedLogFilePath,
  }
}
