/**
 * Append-only log of execute calls (~/.playwriter/activity.jsonl), so users can
 * see which agent used which session and tabs at which time. Written by
 * whichever process runs the executor: the relay for CLI sessions, the MCP
 * server process for MCP. Code is never logged, only timing, identity and the
 * URLs pages navigated to. Local only, never sent anywhere.
 */
import fs from 'node:fs'
import path from 'node:path'
import { ACTIVITY_LOG_FILE_PATH } from './utils.js'

export type ActivityEntry = {
  /** ISO time the execute call started */
  time: string
  /** Tab index agent key: session id, or mcp:<id> */
  agent: string | null
  session: string | null
  client: 'cli' | 'mcp'
  label: string | null
  cwd: string | null
  ms: number
  ok: boolean
  /** URLs pages navigated to during this call */
  navigated: string[]
}

// Rotate to activity.jsonl.1 past this size so the log can't grow unbounded
// (cdp.jsonl once filled disks, see #92).
export const MAX_ACTIVITY_LOG_BYTES = 10 * 1024 * 1024

export async function appendActivity({
  entry,
  filePath = ACTIVITY_LOG_FILE_PATH,
  maxBytes = MAX_ACTIVITY_LOG_BYTES,
}: {
  entry: ActivityEntry
  filePath?: string
  maxBytes?: number
}): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
  const size = await fs.promises.stat(filePath).then(
    (stat) => {
      return stat.size
    },
    () => {
      return 0
    },
  )
  if (size > maxBytes) {
    await fs.promises.rename(filePath, `${filePath}.1`)
  }
  await fs.promises.appendFile(filePath, `${JSON.stringify(entry)}\n`)
}
