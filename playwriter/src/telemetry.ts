/**
 * Anonymous usage telemetry sent to Strada (https://strada.sh).
 *
 * Only the relay daemon emits events: every client (CLI, MCP, SDK) talks to
 * it, so it sees all usage in one place. `initStrada()` runs only inside
 * `startRelayTelemetry()`, called by the daemon entry. CLI, MCP, and SDK
 * processes never connect to Strada, and `trackEvent()` is a no-op in any
 * process that did not start telemetry (in-process relays, tests).
 *
 * Connections: events are batched and flushed every 10s, one POST per
 * flush. Node's fetch keeps the socket alive ~4s after each POST, and
 * `@strada.sh/sdk` reads every response so the socket can be reused.
 * Holding it open longer would need an undici Agent; an idle TLS socket
 * for a few events per minute is not worth it.
 *
 * Uses `@strada.sh/sdk`, which has no dependencies and sends no hostname or
 * OS username. `captureUncaughtErrors: false` keeps its process handlers out
 * of the relay: error reporting is off on purpose.
 *
 * Sent: event name, a random install id (~/.playwriter/telemetry-id),
 * playwriter version, OS, arch, Node version, session kind, client kind,
 * execute counts, extension version and browser name.
 * Never sent: code, URLs, page content, emails, hostnames, paths.
 *
 * Opt out with PLAYWRITER_TELEMETRY=0 or DO_NOT_TRACK=1. The relay reads
 * env when it starts, so restart it after changing: `playwriter serve restart`.
 *
 * Anonymous ingest (no token): the npm package is public, so any token here
 * would be public too. The collector rate limits per IP instead.
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { flush, initStrada, track } from '@strada.sh/sdk'
import dedent from 'string-dedent'
import { VERSION } from './utils.js'

const STRADA_PROJECT_ID = '01M3BT2HC9BZ9TB2Y2D8JTR7J6'
const TELEMETRY_ID_PATH = path.join(os.homedir(), '.playwriter', 'telemetry-id')
const USAGE_REPORT_INTERVAL_MS = 60 * 60 * 1000

export const TELEMETRY_ENABLED = (() => {
  const optOut = process.env.PLAYWRITER_TELEMETRY?.toLowerCase()
  const doNotTrack = process.env.DO_NOT_TRACK?.toLowerCase()
  return optOut !== '0' && optOut !== 'false' && doNotTrack !== '1' && doNotTrack !== 'true'
})()

const FLUSH_INTERVAL_MS = 10_000

export type SessionKind = 'extension' | 'headless' | 'cdp' | 'cloud' | 'remote'

type TelemetryEvents = {
  relay_started: { os: string; arch: string; node: string }
  session_created: { client: 'cli' | 'sdk' | 'mcp'; kind: SessionKind }
  mcp_connected: Record<string, never>
  extension_connected: { browser: string; extension_version: string }
  /** Hourly rollup, so long agent sessions still count as daily active. */
  usage: { executes: number }
}

let anonymousId: string | undefined
let relayTelemetryStarted = false

function readOrCreateTelemetryId(): string {
  const existing = fs.existsSync(TELEMETRY_ID_PATH) ? fs.readFileSync(TELEMETRY_ID_PATH, 'utf-8').trim() : ''
  if (existing) {
    return existing
  }
  const created = crypto.randomUUID()
  fs.mkdirSync(path.dirname(TELEMETRY_ID_PATH), { recursive: true })
  fs.writeFileSync(TELEMETRY_ID_PATH, created)
  return created
}

function getAnonymousId(): string {
  if (anonymousId) {
    return anonymousId
  }
  // An unwritable home dir must not break the relay: fall back to a per-process id.
  anonymousId = (() => {
    try {
      return readOrCreateTelemetryId()
    } catch {
      return crypto.randomUUID()
    }
  })()
  return anonymousId
}

export function trackEvent<Name extends keyof TelemetryEvents>(name: Name, properties: TelemetryEvents[Name]): void {
  // Also keeps opted-out users from getting a telemetry-id file on disk.
  if (!relayTelemetryStarted) {
    return
  }
  void track(name, { ...properties, anon_id: getAnonymousId() })
}

let pendingExecutes = 0

export function recordExecute(): void {
  pendingExecutes++
}

function reportUsage(): void {
  if (pendingExecutes === 0) {
    return
  }
  trackEvent('usage', { executes: pendingExecutes })
  pendingExecutes = 0
}

/** Called once by the relay daemon entry. The only place that initializes Strada. */
export function startRelayTelemetry(): void {
  if (relayTelemetryStarted || !TELEMETRY_ENABLED) {
    return
  }
  // Failures are returned as values and already warned once by the SDK.
  void initStrada({
    projectId: STRADA_PROJECT_ID,
    service: 'playwriter',
    version: VERSION,
    captureUncaughtErrors: false,
    telemetry: { logs: { scheduledDelayMillis: FLUSH_INTERVAL_MS } },
  })
  relayTelemetryStarted = true
  trackEvent('relay_started', { os: process.platform, arch: process.arch, node: process.versions.node })
  setInterval(reportUsage, USAGE_REPORT_INTERVAL_MS).unref()
}

/** Report pending usage and send buffered events. Call before the relay exits. */
export async function flushTelemetry(): Promise<void> {
  if (!relayTelemetryStarted) {
    return
  }
  reportUsage()
  await Promise.race([
    flush(),
    new Promise((resolve) => {
      setTimeout(resolve, 2000).unref()
    }),
  ])
}

/** One-time stderr notice, printed by the CLI before the relay creates the install id. */
export function printTelemetryNoticeOnce(): void {
  if (!TELEMETRY_ENABLED || fs.existsSync(TELEMETRY_ID_PATH)) {
    return
  }
  getAnonymousId()
  console.error(dedent`

    Playwriter collects anonymous usage stats (version, OS, command counts). No code, URLs, or page data.
    Opt out: PLAYWRITER_TELEMETRY=0 or DO_NOT_TRACK=1

  `)
}
