/**
 * Shared utilities for connecting to the relay server.
 * Used by both MCP and CLI.
 */

import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pc from 'picocolors'
import { getListeningPidsForPort, killPortProcess } from './kill-port.js'
import { VERSION, sleep, LOG_FILE_PATH } from './utils.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const RELAY_PORT = Number(process.env.PLAYWRITER_PORT) || 19988

export type ExtensionStatus = {
  extensionId: string
  stableKey?: string
  browser: string | null
  profile: { email: string; id: string } | null
  activeTargets: number
  playwriterVersion: string | null
}

export async function getRelayServerVersion(port: number = RELAY_PORT): Promise<string | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/version`, {
      signal: AbortSignal.timeout(2000),
    })
    if (!response.ok) {
      return null
    }
    const data = (await response.json()) as { version: string }
    return data.version
  } catch {
    return null
  }
}

/**
 * Poll /version until a relay responds or timeout expires.
 * Used during startup races where a relay may have bound the port
 * but isn't serving HTTP yet (issue #75).
 */
export async function waitForRelayVersion({
  port = RELAY_PORT,
  timeoutMs = 2000,
  intervalMs = 200,
}: {
  port?: number
  timeoutMs?: number
  intervalMs?: number
} = {}): Promise<string | null> {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const version = await getRelayServerVersion(port)
    if (version) {
      return version
    }
    await sleep(intervalMs)
  }
  return null
}

export async function getExtensionStatus(
  port: number = RELAY_PORT,
): Promise<{ connected: boolean; activeTargets: number; playwriterVersion: string | null } | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/extension/status`, {
      signal: AbortSignal.timeout(500),
    })
    if (!response.ok) {
      return null
    }
    return (await response.json()) as { connected: boolean; activeTargets: number; playwriterVersion: string | null }
  } catch {
    return null
  }
}

export async function getExtensionsStatus(port: number = RELAY_PORT): Promise<ExtensionStatus[]> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/extensions/status`, {
      signal: AbortSignal.timeout(2000),
    })
    if (!response.ok) {
      const fallback = await fetch(`http://127.0.0.1:${port}/extension/status`, {
        signal: AbortSignal.timeout(2000),
      })
      if (!fallback.ok) {
        return []
      }

      const fallbackData = (await fallback.json()) as {
        connected: boolean
        activeTargets: number
        browser: string | null
        profile: { email: string; id: string } | null
        playwriterVersion?: string | null
      }

      if (!fallbackData?.connected) {
        return []
      }

      return [
        {
          extensionId: 'default',
          stableKey: undefined,
          browser: fallbackData.browser,
          profile: fallbackData.profile,
          activeTargets: fallbackData.activeTargets,
          playwriterVersion: fallbackData.playwriterVersion || null,
        },
      ]
    }

    const data = (await response.json()) as {
      extensions: ExtensionStatus[]
    }

    return data.extensions || []
  } catch {
    return []
  }
}

/**
 * Wait for at least one extension to appear in extensions status.
 * Returns connected extension entries, or [] on timeout.
 */
export async function waitForConnectedExtensions(
  options: {
    port?: number
    timeoutMs?: number
    pollIntervalMs?: number
    logger?: { log: (...args: any[]) => void }
  } = {},
): Promise<ExtensionStatus[]> {
  const { port = RELAY_PORT, timeoutMs = 5000, pollIntervalMs = 200, logger } = options
  const startTime = Date.now()

  logger?.log(pc.dim('Waiting for extension to connect...'))

  while (Date.now() - startTime < timeoutMs) {
    const extensions = await getExtensionsStatus(port)
    if (extensions.length > 0) {
      logger?.log(pc.green('Extension connected'))
      return extensions
    }
    await sleep(pollIntervalMs)
  }

  logger?.log(pc.yellow('Extension did not connect within timeout'))
  return []
}

/**
 * Structured error for `session new` / `browser list` when no extension connects.
 * Frog 20260830090829: session creation ended without a session ID and without
 * a nonzero structured signal. Callers must print this to stderr and exit 1.
 */
export function formatNoExtensionError(options: { timeoutMs?: number } = {}): string {
  const { timeoutMs = 5000 } = options
  return [
    'ERROR code=extension_not_connected',
    `No extension connected within ${timeoutMs}ms.`,
    'Click the Playwriter extension icon on a tab, then retry.',
    'Tip: run `playwriter browser list` to check readiness; exit status is 1 when no browser is ready.',
  ].join('\n')
}

/**
 * Durable, observable description of an extension connection loss.
 * Frog 20260902073850: after successful captures the extension dropped and the
 * next session failed with `Error: fetch failed`. Map transport failures to an
 * actionable reconnect hint instead of a bare fetch error.
 */
export function describeExtensionDisconnect(options: { error?: string; when?: string } = {}): string {
  const { error = '', when = 'session creation' } = options
  const normalized = error.toLowerCase()
  if (normalized.includes('fetch failed') || normalized.includes('fetch failed')) {
    return [
      'ERROR code=extension_connection_lost',
      `Extension connection lost during ${when}: fetch failed.`,
      'The previously authorized extension dropped; no new browser gesture is required.',
      'Retry once: run `playwriter browser list`, confirm the extension row returns, then retry session creation.',
    ].join('\n')
  }
  return [
    'ERROR code=extension_connection_lost',
    `Extension connection lost during ${when}${error ? `: ${error}` : '.'}`,
    'Retry once: run `playwriter browser list`, confirm the extension row returns, then retry session creation.',
  ].join('\n')
}

/**
 * Poll until no process listens on `port`, or until `timeoutMs` expires.
 * Frog 20260902000436: occupied-port recovery killed the owner but timed out
 * before the replacement listener was verified. Returns true when free.
 */
export async function waitForPortFree(options: {
  port: number
  timeoutMs?: number
  pollIntervalMs?: number
  listPids?: (port: number) => Promise<number[]>
}): Promise<boolean> {
  const { port, timeoutMs = 10000, pollIntervalMs = 100, listPids } = options
  const list = listPids ?? ((p: number) => getListeningPidsForPort({ port: p }))
  const startTime = Date.now()
  for (;;) {
    const pids = await list(port).catch(() => [] as number[])
    if (pids.length === 0) {
      return true
    }
    if (Date.now() - startTime >= timeoutMs) {
      return false
    }
    await sleep(pollIntervalMs)
  }
}

async function killRelayServer(options: { port: number; waitForFreeMs?: number }): Promise<void> {
  const { port, waitForFreeMs = 10000 } = options

  try {
    await killPortProcess({ port })
  } catch {
    return
  }

  await waitForPortFree({ port, timeoutMs: waitForFreeMs, pollIntervalMs: 100 })
}

/**
 * Compare two semver versions. Returns:
 * - negative if v1 < v2
 * - 0 if v1 === v2
 * - positive if v1 > v2
 */
export function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number)
  const parts2 = v2.split('.').map(Number)
  const len = Math.max(parts1.length, parts2.length)

  for (let i = 0; i < len; i++) {
    const p1 = parts1[i] || 0
    const p2 = parts2[i] || 0
    if (p1 !== p2) {
      return p1 - p2
    }
  }
  return 0
}

/**
 * Check if the running playwriter package is older than the version the extension was built with.
 * The extension bundles the playwriter version at build time. If the extension reports a newer
 * version, it means the user's CLI/MCP needs updating.
 * Returns a warning message if outdated, null otherwise.
 */
export function getExtensionOutdatedWarning(extensionPlaywriterVersion: string | null | undefined): string | null {
  if (!extensionPlaywriterVersion) {
    return null
  }
  if (compareVersions(extensionPlaywriterVersion, VERSION) > 0) {
    return `Playwriter ${VERSION} is outdated (extension requires ${extensionPlaywriterVersion}). Run \`npm install -g playwriter@latest\` or update the playwriter package in your project.`
  }
  return null
}

export interface EnsureRelayServerOptions {
  logger?: { log: (...args: any[]) => void }
  /** If true, will kill and restart server on version mismatch. Default: true */
  restartOnVersionMismatch?: boolean
  /** Kill any running relay and start a new one, even if versions match. */
  forceRestart?: boolean
  /** Pass additional environment variables to the relay server process */
  env?: Record<string, string>
}

// Module-level dedup: if ensureRelayServer is called concurrently within the
// same process (e.g. two MCP tool handlers at once), only one spawn runs.
let pendingEnsure: Promise<true | undefined> | null = null

/**
 * Ensures the relay server is running. Starts it if not running.
 * Optionally restarts on version mismatch.
 * Concurrent calls within the same process are deduplicated.
 */
export async function ensureRelayServer(options: EnsureRelayServerOptions = {}): Promise<true | undefined> {
  if (pendingEnsure) {
    return pendingEnsure
  }
  pendingEnsure = ensureRelayServerImpl(options).finally(() => {
    pendingEnsure = null
  })
  return pendingEnsure
}

async function ensureRelayServerImpl(options: EnsureRelayServerOptions = {}): Promise<true | undefined> {
  const { logger, restartOnVersionMismatch = true, env: additionalEnv, forceRestart = false } = options

  if (forceRestart) {
    logger?.log(pc.yellow('Restarting CDP relay server...'))
    await killRelayServer({ port: RELAY_PORT })
  }

  const serverVersion = await getRelayServerVersion(RELAY_PORT)

  if (!forceRestart && serverVersion === VERSION) {
    return
  }

  // Don't restart if server version is higher than our version.
  // This prevents older clients from killing a newer server.
  if (serverVersion !== null && compareVersions(serverVersion, VERSION) > 0) {
    return
  }

  if (serverVersion !== null) {
    if (restartOnVersionMismatch) {
      logger?.log(
        pc.yellow(`CDP relay server version mismatch (server: ${serverVersion}, client: ${VERSION}), restarting...`),
      )
      await killRelayServer({ port: RELAY_PORT })
    } else {
      // Server is running but different version, just use it
      return
    }
  } else {
    const listeningPids = await getListeningPidsForPort({ port: RELAY_PORT }).catch(() => [])
    if (listeningPids.length > 0) {
      // Something is on the port but /version didn't respond. It might be a
      // relay that's still starting (race with another CLI/MCP instance).
      // Poll /version briefly before deciding to kill it (issue #75).
      const foundVersion = await waitForRelayVersion({ port: RELAY_PORT })
      if (foundVersion) {
        // A relay came up while we waited; use it
        if (foundVersion === VERSION || compareVersions(foundVersion, VERSION) > 0) {
          return
        }
        if (!restartOnVersionMismatch) {
          return
        }
        logger?.log(
          pc.yellow(`CDP relay server version mismatch (server: ${foundVersion}, client: ${VERSION}), restarting...`),
        )
      } else {
        logger?.log(
          pc.yellow(
            `Port ${RELAY_PORT} is already in use (pid(s): ${listeningPids.join(', ')}). Attempting to stop the existing process...`,
          ),
        )
      }
      await killRelayServer({ port: RELAY_PORT })
    }

    logger?.log(pc.dim('CDP relay server not running, starting it...'))
  }

  // Detect if we're running from source (.ts) or compiled (.js)
  // This handles: tsx, vite-node, ts-node, or direct node on compiled output
  const isRunningFromSource = __filename.endsWith('.ts')
  const scriptPath = isRunningFromSource
    ? path.resolve(__dirname, './start-relay-server.ts')
    : path.resolve(__dirname, './start-relay-server.js')

  const serverProcess = spawn(isRunningFromSource ? 'tsx' : process.execPath, [scriptPath], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, ...additionalEnv },
  })

  serverProcess.unref()

  // Frog 20260902000436: 5s was too short to verify the replacement listener
  // after killing the occupied-port owner (observed 5082ms failure). Poll longer.
  const startTimeoutMs = 15000
  const startTime = Date.now()

  while (Date.now() - startTime < startTimeoutMs) {
    await sleep(200)
    const newVersion = await getRelayServerVersion(RELAY_PORT)
    if (newVersion) {
      logger?.log(pc.green('CDP relay server started successfully'))
      await sleep(1000)
      return true
    }
  }

  const waitedMs = Date.now() - startTime
  throw new Error(`Failed to start CDP relay server within ${waitedMs}ms. Check logs at: ${LOG_FILE_PATH}`)
}
