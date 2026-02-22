import fs from 'node:fs'
import path from 'node:path'
import { LOG_CDP_FILE_PATH } from './utils.js'

export type CdpLogEntry = {
  timestamp: string
  direction: 'from-playwright' | 'to-playwright' | 'from-extension' | 'to-extension'
  clientId?: string
  source?: 'extension' | 'server'
  message: unknown
}

export type CdpLogger = {
  log(entry: CdpLogEntry): void
  logFilePath: string
}

const DEFAULT_MAX_STRING_LENGTH = Number(process.env.PLAYWRITER_CDP_LOG_MAX_STRING_LENGTH || 2000)

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
      return truncateString(value, maxStringLength)
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

export function createCdpLogger({
  logFilePath,
  maxStringLength,
}: { logFilePath?: string; maxStringLength?: number } = {}): CdpLogger {
  const resolvedLogFilePath = logFilePath || LOG_CDP_FILE_PATH
  const logDir = path.dirname(resolvedLogFilePath)
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true })
  }
  fs.writeFileSync(resolvedLogFilePath, '')

  let queue: Promise<void> = Promise.resolve()
  const maxLength = maxStringLength ?? DEFAULT_MAX_STRING_LENGTH

  const log = (entry: CdpLogEntry): void => {
    const replacer = createTruncatingReplacer({ maxStringLength: maxLength })
    const line = JSON.stringify(entry, replacer)
    queue = queue.then(() => fs.promises.appendFile(resolvedLogFilePath, `${line}\n`))
  }

  return {
    log,
    logFilePath: resolvedLogFilePath,
  }
}
