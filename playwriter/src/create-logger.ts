import fs from 'node:fs'
import path from 'node:path'
import util from 'node:util'
import stripAnsi from 'strip-ansi'
import { LOG_FILE_PATH, redactRemoteControlSecrets } from './utils.js'

export type Logger = {
  log(...args: unknown[]): Promise<void>
  error(...args: unknown[]): Promise<void>
  /** Flush buffered log lines to disk */
  flush(): Promise<void>
  /** Flush buffered log lines synchronously. Use in fatal and exit handlers. */
  flushSync(): void
  logFilePath: string
}

/** The log moves to `<path>.1` on start and when it grows past this size. */
const MAX_LOG_BYTES = 20 * 1024 * 1024

function rotateLogFile(filePath: string) {
  try {
    fs.renameSync(filePath, `${filePath}.1`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
}

export function createFileLogger({ logFilePath }: { logFilePath?: string } = {}): Logger {
  const resolvedLogFilePath = logFilePath || LOG_FILE_PATH
  fs.mkdirSync(path.dirname(resolvedLogFilePath), { recursive: true })
  // Keep the previous run's log: the CLI restarts a crashed relay, and the crash line must survive.
  rotateLogFile(resolvedLogFilePath)
  fs.writeFileSync(resolvedLogFilePath, '')
  let bytesWritten = 0

  let queue: Promise<void> = Promise.resolve()

  // Batch buffer: accumulate log lines and flush periodically to reduce disk I/O
  // under high CDP event throughput. See: https://github.com/remorses/playwriter/issues/96
  const FLUSH_INTERVAL_MS = 500
  let buffer: string[] = []
  let flushTimer: ReturnType<typeof setInterval> | undefined

  /** Take the buffered lines as one chunk, rotating the file first if the chunk would pass the cap. */
  const takeChunk = (): string | undefined => {
    if (buffer.length === 0) {
      return undefined
    }
    const chunk = buffer.join('\n') + '\n'
    buffer = []
    const chunkBytes = Buffer.byteLength(chunk)
    if (bytesWritten > 0 && bytesWritten + chunkBytes > MAX_LOG_BYTES) {
      rotateLogFile(resolvedLogFilePath)
      bytesWritten = 0
    }
    bytesWritten += chunkBytes
    return chunk
  }

  // Sync append: an async write in flight would be lost on process.exit, and could race with rotation.
  const flushBuffer = async (): Promise<void> => {
    flushSync()
  }

  const log = (...args: unknown[]): Promise<void> => {
    const message = args
      .map((arg) => {
        const value =
          typeof arg === 'string' ? arg : util.inspect(arg, { depth: null, colors: false, maxStringLength: 1000 })
        return redactRemoteControlSecrets(value)
      })
      .join(' ')
    buffer.push(stripAnsi(message))
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

  const flushSync = (): void => {
    const chunk = takeChunk()
    if (chunk) {
      fs.appendFileSync(resolvedLogFilePath, chunk)
    }
  }

  return {
    log,
    error: log,
    flush,
    flushSync,
    logFilePath: resolvedLogFilePath,
  }
}
