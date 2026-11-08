// Saved relay sessions, so `-s N` keeps working after the relay restarts (it restarts on every
// CLI version change). Only extension and remote sessions are saved: direct CDP, headless and
// cloud sessions own a browser connection that dies with the relay.
// Adapted from browse cli/src/session-manager/catalog.ts.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { normalizeHumanInputMode, type HumanInputMode } from './human-input.js'
import { normalizeTabGroupColor, type TabGroupColor } from './protocol.js'

export type SavedSession = {
  id: string
  kind: 'extension' | 'remote'
  /** Tab ownership key the extension stores as groupKey. Random UUID, stable across relay restarts */
  ownershipKey: string
  /** Extension stableKey, or the `remote:` stable key of a remote dial */
  extensionId: string
  /** Remote-control id or URL, dialed again when a remote session is restored */
  remoteControlUrl?: string
  browser: string | null
  profile: { email: string; id: string } | null
  cwd: string | null
  tabGroup: string | null
  tabGroupColor: TabGroupColor | null
  /** Missing in files saved before human input modes existed, loaded as 'auto' */
  humanInput: HumanInputMode
}

export type SessionCatalog = {
  /** Next id to hand out. Saved even when no session is left, so ids are never reused */
  nextSessionNumber: number
  sessions: SavedSession[]
}

type Logger = { log(...args: any[]): void; error(...args: any[]): void }

const DEFAULT_RELAY_PORT = 19988

/** One file per port, so test relays and relays on other ports never share sessions. */
export function defaultSessionCatalogPath(port: number): string {
  const name = port === DEFAULT_RELAY_PORT ? 'sessions.json' : `sessions-${port}.json`
  return path.join(os.homedir(), '.playwriter', name)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isSavedSession(value: any): value is SavedSession {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.id === 'string' &&
    /^\d+$/.test(value.id) &&
    (value.kind === 'extension' || value.kind === 'remote') &&
    typeof value.ownershipKey === 'string' &&
    typeof value.extensionId === 'string' &&
    (value.kind === 'extension' || typeof value.remoteControlUrl === 'string') &&
    isNullableString(value.browser) &&
    (value.profile === null ||
      (typeof value.profile === 'object' && typeof value.profile.email === 'string' && typeof value.profile.id === 'string')) &&
    isNullableString(value.cwd) &&
    isNullableString(value.tabGroup) &&
    (value.tabGroupColor === null || normalizeTabGroupColor(value.tabGroupColor) !== null) &&
    (value.humanInput === undefined || normalizeHumanInputMode(value.humanInput) !== null)
  )
}

/** A missing file is an empty catalog. A corrupt file is moved aside and the relay starts empty. */
export function loadSessionCatalog({ filePath, logger }: { filePath: string; logger?: Logger }): SessionCatalog {
  let text: string
  try {
    text = fs.readFileSync(filePath, 'utf-8')
  } catch {
    return { nextSessionNumber: 1, sessions: [] }
  }
  try {
    const parsed = JSON.parse(text)
    if (
      parsed?.version !== 1 ||
      !Number.isInteger(parsed.nextSessionNumber) ||
      parsed.nextSessionNumber < 1 ||
      !Array.isArray(parsed.sessions) ||
      !parsed.sessions.every(isSavedSession)
    ) {
      throw new Error('unexpected shape')
    }
    const sessions = (parsed.sessions as SavedSession[]).map((session) => {
      return { ...session, humanInput: normalizeHumanInputMode(session.humanInput) ?? 'auto' }
    })
    const highestId = Math.max(0, ...sessions.map((session) => Number(session.id)))
    return { nextSessionNumber: Math.max(parsed.nextSessionNumber, highestId + 1), sessions }
  } catch (error) {
    const corruptPath = `${filePath}.corrupt-${Date.now()}`
    const reason = error instanceof Error ? error.message : String(error)
    try {
      fs.renameSync(filePath, corruptPath)
      logger?.error(`Session file ${filePath} was unreadable (${reason}). Moved it to ${corruptPath}, starting with no saved sessions`)
    } catch {
      logger?.error(`Session file ${filePath} was unreadable (${reason}) and could not be moved, starting with no saved sessions`)
    }
    return { nextSessionNumber: 1, sessions: [] }
  }
}

/** Atomic write (temp file + rename) with 0600 permissions. Never throws: a failed write only logs. */
export function saveSessionCatalog({
  filePath,
  catalog,
  logger,
}: {
  filePath: string
  catalog: SessionCatalog
  logger?: Logger
}): void {
  const tmpFile = `${filePath}.${process.pid}.tmp`
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(tmpFile, JSON.stringify({ version: 1, ...catalog }, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 })
    fs.renameSync(tmpFile, filePath)
  } catch (error) {
    logger?.error(`Could not write session file ${filePath}:`, error)
    try {
      fs.unlinkSync(tmpFile)
    } catch {
      // temp file was never created
    }
  }
}
