import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TabGroupColor } from './protocol.js'

// Playwriter extension IDs - used for validation and Chrome flag commands.
//
// An extension ID is always sha256(SOME_STRING) -> first 16 bytes -> each hex
// nibble mapped 0-f to a-p. Only SOME_STRING differs by how it is loaded:
//   - signed CRX / Web Store: SOME_STRING = the developer public key bytes
//   - unpacked folder with no manifest "key": SOME_STRING = the absolute folder path
// Production ships no "key" in manifest.json (see extension/vite.config.mts), so an
// unpacked production build gets a path-derived ID instead of the store ID.
export const EXTENSION_IDS = [
  // hash of the developer public key baked into the Web Store listing
  'jfeammnjpkecdekppnclgkkffahnhfhe', // Production (Chrome Web Store)
  // hash of the public key injected into dev/test builds (stable across machines)
  'pebbngnfojnignonigcnkdilknapkgid', // Dev extension (stable ID from manifest key)
  // NOT a Ghost Browser identity: this is sha256 of the unpacked folder path
  // "/Users/morse/Downloads/jfeammnjpkecdekppnclgkkffahnhfhe" on one Mac. Because
  // the production manifest has no "key", loading it unpacked derived the ID from
  // that path, not from any key. It only matches that exact path on that machine.
  'laceiahnielojmkjcfpcjhjnnmjobckf', // Unpacked-from-Downloads path hash (machine-specific)
]

/**
 * Parse a relay host string into HTTP and WebSocket base URLs.
 * Supports both plain hostnames (appends port) and full URLs (uses as-is).
 *
 * Examples:
 *   "192.168.1.10"                        → http://192.168.1.10:19988, ws://192.168.1.10:19988
 *   "https://my-machine-tunnel.traforo.dev" → https://my-machine-tunnel.traforo.dev, wss://my-machine-tunnel.traforo.dev
 */
export function parseRelayHost(host: string, port: number = 19988): { httpBaseUrl: string; wsBaseUrl: string } {
  if (host.startsWith('https://') || host.startsWith('http://')) {
    const url = new URL(host)
    const httpBaseUrl = url.origin
    const wsProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsBaseUrl = `${wsProtocol}//${url.host}`
    return { httpBaseUrl, wsBaseUrl }
  }
  return {
    httpBaseUrl: `http://${host}:${port}`,
    wsBaseUrl: `ws://${host}:${port}`,
  }
}

export function getCdpUrl({
  port = 19988,
  host = '127.0.0.1',
  token,
  extensionId,
  sessionId,
  tabGroup,
  tabGroupColor,
  client,
  agentId,
  agentLabel,
  agentCwd,
}: {
  port?: number
  host?: string
  token?: string
  extensionId?: string | null
  /** Which client opens this connection, for anonymous usage stats. Old relays ignore it. */
  client?: 'mcp'
  /** CLI session id, sent as ?session= so the relay can map this client to its session */
  sessionId?: string
  /** Tab group title for tabs this client creates (default 'playwriter'). Old relays ignore it. */
  tabGroup?: string
  /** Explicit tab group color chosen with --tab-group-color. Old relays ignore it. */
  tabGroupColor?: TabGroupColor
  /** Per-process id for clients without a relay session (MCP), used by the tab index. Old relays ignore it. */
  agentId?: string
  /** Human label for the tab index (PLAYWRITER_AGENT). Old relays ignore it. */
  agentLabel?: string
  /** Working directory shown in the tab index for clients without a relay session. Old relays ignore it. */
  agentCwd?: string
} = {}) {
  const id = `${Math.random().toString(36).substring(2, 15)}_${Date.now()}`
  const params = new URLSearchParams()
  if (token) {
    params.set('token', token)
  }
  if (extensionId) {
    params.set('extensionId', extensionId)
  }
  if (sessionId) {
    params.set('session', sessionId)
  }
  if (tabGroup) {
    params.set('tabGroup', tabGroup)
  }
  if (tabGroupColor) {
    params.set('tabGroupColor', tabGroupColor)
  }
  if (client) {
    params.set('client', client)
  }
  if (agentId) {
    params.set('agent', agentId)
  }
  if (agentLabel) {
    params.set('agentLabel', agentLabel)
  }
  if (agentCwd) {
    params.set('agentCwd', agentCwd)
  }
  const queryString = params.toString()
  const suffix = queryString ? `?${queryString}` : ''
  const { wsBaseUrl } = parseRelayHost(host, port)
  return `${wsBaseUrl}/cdp/${id}${suffix}`
}

export function redactRemoteControlSecrets(value: string): string {
  return value
    .replace(/(playwriter\.dev\/remote-control#)[a-z0-9-]{1,63}/gi, '$1[redacted]')
    .replace(/[a-z0-9-]{1,63}(?=-tunnel\.)/gi, '[redacted]')
    .replace(/(_tunnelId=)[a-z0-9-]{1,63}/gi, '$1[redacted]')
    .replace(/(\/tunnel\/)[a-z0-9-]{1,63}/gi, '$1[redacted]')
}

// Use ~/.playwriter for logs so each OS user gets their own dir (avoids permission errors on shared machines, see #44)
const LOG_BASE_DIR = path.join(os.homedir(), '.playwriter')
export const LOG_FILE_PATH = process.env.PLAYWRITER_LOG_FILE_PATH || path.join(LOG_BASE_DIR, 'relay-server.log')
export const LOG_CDP_FILE_PATH =
  process.env.PLAYWRITER_CDP_LOG_FILE_PATH || path.join(path.dirname(LOG_FILE_PATH), 'cdp.jsonl')
export const ACTIVITY_LOG_FILE_PATH =
  process.env.PLAYWRITER_ACTIVITY_LOG_PATH || path.join(path.dirname(LOG_FILE_PATH), 'activity.jsonl')

const packageJsonPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json')
export const VERSION = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')).version as string

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
