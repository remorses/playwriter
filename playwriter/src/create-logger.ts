import fs from 'node:fs'
import util from 'node:util'
import { ensureDataDir, getLogFilePath } from './utils.js'

export type Logger = {
  log(...args: unknown[]): void
  error(...args: unknown[]): void
}

export function createFileLogger({ logFilePath }: { logFilePath?: string } = {}): Logger {
  const resolvedLogFilePath = logFilePath || getLogFilePath()
  ensureDataDir()
  fs.writeFileSync(resolvedLogFilePath, '')

  const log = (...args: unknown[]) => {
    const message = args.map(arg =>
      typeof arg === 'string' ? arg : util.inspect(arg, { depth: null, colors: false })
    ).join(' ')
    fs.appendFileSync(resolvedLogFilePath, message + '\n')
  }

  return {
    log,
    error: log
  }
}
