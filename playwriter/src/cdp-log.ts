import fs from 'node:fs'
import path from 'node:path'
import { LOG_CDP_FILE_PATH, redactRemoteControlSecrets } from './utils.js'

export type CdpLogEntry = {
  timestamp: string
  direction: 'from-playwright' | 'to-playwright' | 'from-extension' | 'to-extension'
  clientId?: string
  source?: 'extension' | 'server'
  message: unknown
}

export type CdpLogger = {
  log(entry: CdpLogEntry): void
  /** Wait for all pending writes (and any in-flight rotation) to complete */
  flush(): Promise<void>
  logFilePath: string
}

const DEFAULT_MAX_STRING_LENGTH = Number(process.env.PLAYWRITER_CDP_LOG_MAX_STRING_LENGTH || 2000)
const EXCLUDED_METHODS = new Set(['Page.screencastFrame'])

function truncateString(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }
  const truncatedCount = value.length - maxLength
  return `${value.slice(0, maxLength)}…[truncated ${truncatedCount} chars]`
}

function createTruncatingReplacer({ maxStringLength }: { maxStringLength: number }) {
  const seen = new WeakSet<object>()
  return (_key: string, value: unknown) => {
    if (typeof value === 'string') {
      return truncateString(redactRemoteControlSecrets(value), maxStringLength)
    }
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]'
      }
      seen.add(value)
    }
    return value
  }
}

const DEFAULT_MAX_ENTRIES = 10_000

function resolvePositiveInt(value: number | undefined, fallback: number): number {
  if (value == null || !Number.isFinite(value) || value < 2) {
    return fallback
  }
  return Math.floor(value)
}

export function createCdpLogger({
  logFilePath,
  maxStringLength,
  maxEntries,
}: { logFilePath?: string; maxStringLength?: number; maxEntries?: number } = {}): CdpLogger {
  const resolvedLogFilePath = logFilePath || LOG_CDP_FILE_PATH
  const logDir = path.dirname(resolvedLogFilePath)
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true })
  }
  fs.writeFileSync(resolvedLogFilePath, '')

  let queue: Promise<void> = Promise.resolve()
  let lineCount = 0
  const maxLength = maxStringLength ?? DEFAULT_MAX_STRING_LENGTH
  const envMaxEntries = Number(process.env.PLAYWRITER_CDP_LOG_MAX_ENTRIES)
  const resolvedMaxEntries = resolvePositiveInt(maxEntries, resolvePositiveInt(envMaxEntries, DEFAULT_MAX_ENTRIES))
  // Keep half the entries after rotation so we don't rotate on every write
  const keepAfterRotation = Math.floor(resolvedMaxEntries / 2)

  // Batch buffer: accumulate lines and flush periodically to reduce disk I/O.
  // Without batching, high-frequency CDP events cause thousands of appendFile
  // calls per second. See: https://github.com/remorses/playwriter/issues/96
  const FLUSH_INTERVAL_MS = 500
  let buffer: string[] = []
  let flushTimer: ReturnType<typeof setInterval> | undefined

  // Atomic rotation: write to temp file then rename to avoid corruption on crash
  const rotate = async (): Promise<void> => {
    try {
      const content = await fs.promises.readFile(resolvedLogFilePath, 'utf-8')
      const lines = content.split('\n').filter((l) => {
        return l.length > 0
      })
      const kept = lines.slice(-keepAfterRotation)
      const tmpPath = `${resolvedLogFilePath}.tmp`
      await fs.promises.writeFile(tmpPath, kept.join('\n') + '\n')
      await fs.promises.rename(tmpPath, resolvedLogFilePath)
      lineCount = kept.length
    } catch {
      // If rotation fails (disk error, permissions), keep logging without rotation.
      // lineCount stays high so rotation will be retried on next write.
    }
  }

  const flushBuffer = async (): Promise<void> => {
    if (buffer.length === 0) {
      return
    }
    const lines = buffer
    buffer = []
    // Best effort: a deleted log folder or a full disk must not reject the queue, or logging stops for good
    const written = await fs.promises.appendFile(resolvedLogFilePath, lines.join('\n') + '\n').then(
      () => true,
      () => false,
    )
    if (!written) {
      return
    }
    lineCount += lines.length
    if (lineCount > resolvedMaxEntries) {
      await rotate()
    }
  }

  const log = (entry: CdpLogEntry): void => {
    const method =
      entry.message && typeof entry.message === 'object' ? Reflect.get(entry.message, 'method') : undefined
    if (typeof method === 'string' && EXCLUDED_METHODS.has(method)) {
      return
    }
    const replacer = createTruncatingReplacer({ maxStringLength: maxLength })
    const line = JSON.stringify(entry, replacer)
    buffer.push(line)
    if (!flushTimer) {
      flushTimer = setInterval(() => {
        queue = queue.then(flushBuffer)
      }, FLUSH_INTERVAL_MS)
      flushTimer.unref()
    }
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
    flush,
    logFilePath: resolvedLogFilePath,
  }
}
