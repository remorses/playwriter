/**
 * Shared utilities for connecting to the relay server.
 * Used by both MCP and CLI.
 */

import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pc from 'picocolors'
import dedent from 'string-dedent'
import { getListeningPidsForPort, getProcessCommandLine, killPid } from './kill-port.js'
import { VERSION, getCdpUrl, sleep, LOG_FILE_PATH } from './utils.js'
import { isRemoteExtensionKey } from './relay-state.js'
import { getChromium, type Browser } from './playwright-import.js'
import type { TabGroupColor } from './protocol.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const RELAY_PORT = Number(process.env.PLAYWRITER_PORT) || 19988

export const PLAYWRITER_EXTENSION_URL =
  'https://chromewebstore.google.com/detail/playwriter/jfeammnjpkecdekppnclgkkffahnhfhe'

// One message for CLI, executor and library users (skills calling
// connectViaExtension). Written for the agent to relay to the user.
export const EXTENSION_NOT_CONNECTED_ERROR = dedent`
  The Playwriter Chrome extension is not connected.
  Tell the user to:
  1. Install the Playwriter extension in Chrome: ${PLAYWRITER_EXTENSION_URL}
  2. Keep Chrome open. If the extension icon is gray, click it on any tab.
  3. Run the command again.
`

export type ExtensionStatus = {
  extensionId: string
  stableKey?: string
  browser: string | null
  profile: { email: string; id: string } | null
  activeTargets: number
  playwriterVersion: string | null
}

export function getLocalExtensionStatuses(extensions: ExtensionStatus[]): ExtensionStatus[] {
  return extensions.filter((extension) => {
    return !extension.stableKey || !isRemoteExtensionKey(extension.stableKey)
  })
}

/** `/version` response. Older relays only send `version`. */
export type RelayInfo = {
  version: string
  pid?: number
  /** Random per relay start. Tells a relay apart from one that replaced it on the same port */
  instanceId?: string
  activeExecutes?: number
}

export async function getRelayInfo(port: number = RELAY_PORT): Promise<RelayInfo | null> {
  try {
    // 10s: a busy relay (many agents attaching tabs) can miss a 2s /version probe.
    const response = await fetch(`http://127.0.0.1:${port}/version`, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) {
      return null
    }
    const data = (await response.json()) as RelayInfo
    return typeof data?.version === 'string' ? data : null
  } catch {
    return null
  }
}

export async function getRelayServerVersion(port: number = RELAY_PORT): Promise<string | null> {
  return (await getRelayInfo(port))?.version ?? null
}

/**
 * Poll /version until a relay responds or timeout expires.
 * Used during startup races where a relay may have bound the port
 * but isn't serving HTTP yet (issue #75).
 */
export async function waitForRelayInfo({
  port = RELAY_PORT,
  timeoutMs = 10_000,
  intervalMs = 200,
}: {
  port?: number
  timeoutMs?: number
  intervalMs?: number
} = {}): Promise<RelayInfo | null> {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const info = await getRelayInfo(port)
    if (info) {
      return info
    }
    await sleep(intervalMs)
  }
  return null
}

export async function waitForRelayVersion(options: { port?: number; timeoutMs?: number; intervalMs?: number } = {}) {
  return (await waitForRelayInfo(options))?.version ?? null
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
    const extensions = getLocalExtensionStatuses(await getExtensionsStatus(port))
    if (extensions.length > 0) {
      logger?.log(pc.green('Extension connected'))
      return extensions
    }
    await sleep(pollIntervalMs)
  }

  logger?.log(pc.yellow('Extension did not connect within timeout'))
  return []
}

// process.title of the relay daemon and `playwriter serve`. Windows keeps the original
// command line, so also match the script name and `playwriter ... serve`.
const RELAY_COMMAND_REGEX = /playwriter-ws-server|playwriter-serve|start-relay-server|playwriter\S*\s+serve\b/i

/** Resolves true once none of `pids` listens on `port` (exited or closed the server). */
async function waitForPidsToReleasePort({
  port,
  pids,
  timeoutMs,
}: {
  port: number
  pids: number[]
  timeoutMs: number
}): Promise<boolean> {
  const end = Date.now() + timeoutMs
  while (true) {
    const listening = await getListeningPidsForPort({ port }).catch((): number[] => [])
    if (!pids.some((pid) => listening.includes(pid))) {
      return true
    }
    if (Date.now() >= end) {
      return false
    }
    await sleep(250)
  }
}

/**
 * Kill `pids` if they are Playwriter relays. Throws without killing anything when one is another
 * program, so a user's server on the relay port is never killed.
 */
async function killRelayPids({ port, pids }: { port: number; pids: number[] }): Promise<void> {
  const targets = pids.filter((pid) => pid !== process.pid)
  const commands = await Promise.all(targets.map((pid) => getProcessCommandLine({ pid })))
  const foreign = targets.flatMap((pid, i) => {
    const command = commands[i]
    return command && !RELAY_COMMAND_REGEX.test(command) ? [`pid ${pid}: ${command}`] : []
  })
  if (foreign.length > 0) {
    throw new Error(dedent`
      Port ${port} is used by another program, not a Playwriter relay (${foreign.join(', ')}).
      Stop that program, then run the command again.
    `)
  }
  // A null command line means the process already exited.
  const alive = targets.filter((_, i) => commands[i] !== null)
  await Promise.all(alive.map((pid) => killPid({ pid })))
  const released = await waitForPidsToReleasePort({ port, pids: alive, timeoutMs: 3000 })
  if (!released) {
    throw new Error(`Playwriter relay on port ${port} (pid ${alive.join(', ')}) did not exit after kill`)
  }
}

/**
 * Ask a relay to stop: it refuses new executes, waits up to drainTimeoutMs for running ones, then exits.
 * Returns false when the relay does not support draining (404 on old relays) or did not exit in time.
 */
async function drainRelay({
  port,
  pid,
  instanceId,
  drainTimeoutMs,
  logger,
}: {
  port: number
  pid: number
  instanceId: string
  drainTimeoutMs: number
  logger?: { log: (...args: any[]) => void }
}): Promise<boolean> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (process.env.PLAYWRITER_TOKEN) {
    headers.Authorization = `Bearer ${process.env.PLAYWRITER_TOKEN}`
  }
  const response = await fetch(`http://127.0.0.1:${port}/cli/drain`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ instanceId, timeoutMs: drainTimeoutMs }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null)
  if (!response) {
    // Probed relay is gone (or hung): the caller checks the pid again.
    return false
  }
  if (response.status === 409) {
    // Another client already replaced the relay we probed.
    return true
  }
  if (!response.ok) {
    return false
  }
  const { activeExecutes = 0 } = (await response.json().catch(() => ({}))) as { activeExecutes?: number }
  if (activeExecutes > 0 && drainTimeoutMs > 0) {
    logger?.log(
      pc.yellow(
        `Waiting up to ${Math.round(drainTimeoutMs / 1000)}s for ${activeExecutes} running execute(s) to finish before restarting the relay...`,
      ),
    )
  }
  return waitForPidsToReleasePort({ port, pids: [pid], timeoutMs: drainTimeoutMs + 5000 })
}

const DEFAULT_DRAIN_TIMEOUT_MS = 30_000

/**
 * Stop the relay on `port`. A relay that supports it is drained first so running executes of
 * other agents can finish. Only Playwriter relay processes are ever killed.
 * `relay` is the /version probe; pass null when the port holder does not answer /version.
 */
async function stopRelay({
  port,
  relay,
  drainTimeoutMs = DEFAULT_DRAIN_TIMEOUT_MS,
  logger,
}: {
  port: number
  relay: RelayInfo | null
  drainTimeoutMs?: number
  logger?: { log: (...args: any[]) => void }
}): Promise<void> {
  const { pid, instanceId } = relay ?? {}
  if (pid && instanceId) {
    if (await drainRelay({ port, pid, instanceId, drainTimeoutMs, logger })) {
      return
    }
    await killRelayPids({ port, pids: [pid] })
    return
  }
  // Old relay without pid in /version, or a port holder that does not answer /version.
  const pids = await getListeningPidsForPort({ port }).catch(() => [])
  await killRelayPids({ port, pids })
}

/**
 * Stop the local relay daemon, draining it first. Used by `playwriter serve restart`.
 * drainTimeoutMs 0 stops it right away and aborts running executes.
 */
export async function stopRelayServer({
  port = RELAY_PORT,
  drainTimeoutMs,
  logger,
}: {
  port?: number
  drainTimeoutMs?: number
  logger?: { log: (...args: any[]) => void }
} = {}): Promise<void> {
  const relay = await getRelayInfo(port)
  if (!relay && (await getListeningPidsForPort({ port }).catch(() => [])).length === 0) {
    return
  }
  await stopRelay({ port, relay, drainTimeoutMs, logger })
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
  /** If true, will drain and restart an older relay. Default: true */
  restartOnVersionMismatch?: boolean
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
  const { logger, restartOnVersionMismatch = true, env: additionalEnv } = options

  let relay = await getRelayInfo(RELAY_PORT)
  const listeningPids = relay ? [] : await getListeningPidsForPort({ port: RELAY_PORT }).catch(() => [])
  if (!relay && listeningPids.length > 0) {
    // A competing relay may have bound the port before /version became ready.
    relay = await waitForRelayInfo({ port: RELAY_PORT })
  }

  if (relay) {
    // Do not let an older client replace a newer Playwriter relay.
    if (compareVersions(relay.version, VERSION) >= 0 || !restartOnVersionMismatch) {
      return
    }
    logger?.log(
      pc.yellow(`CDP relay server version mismatch (server: ${relay.version}, client: ${VERSION}), restarting...`),
    )
    await stopRelay({ port: RELAY_PORT, relay, logger })
  } else if (listeningPids.length > 0) {
    logger?.log(
      pc.yellow(`Port ${RELAY_PORT} is in use (pid(s): ${listeningPids.join(', ')}) and does not answer /version...`),
    )
    await stopRelay({ port: RELAY_PORT, relay: null, logger })
  } else {
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

  const startTimeoutMs = 5000
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

export type CreatedRelaySession = {
  id: string
  /** Opaque tab ownership key. Missing on relays older than this SDK */
  ownershipKey?: string
  tabGroup?: string | null
  tabGroupColor?: TabGroupColor | null
}

export type PlaywriterBrowserConnection = {
  browser: Browser
  /** The browser profile this connection controls. */
  extensionBrowser: ExtensionBrowser
  sessionId: string
  close(): Promise<void>
  /** Enables `await using connection = await connectViaExtension()`. Same as close(). */
  [Symbol.asyncDispose](): Promise<void>
}

/** A browser profile with the Playwriter extension connected to the local relay. */
export type ExtensionBrowser = {
  /** Stable across extension reconnects and relay restarts. Safe to persist. */
  id: string
  /** Browser brand detected by the extension: Chrome, Brave, Edge, Ghost, ... */
  browser: string
  /** Email of the Chrome profile signed-in account, or null if not signed in. */
  email: string | null
  /** Tabs the extension has currently attached to Playwriter. */
  activeTabs: number
  playwriterVersion: string | null
}

export type SelectBrowser = (
  browsers: ExtensionBrowser[],
) => ExtensionBrowser | undefined | Promise<ExtensionBrowser | undefined>

function toExtensionBrowser(extension: ExtensionStatus): ExtensionBrowser {
  return {
    id: extension.stableKey || extension.extensionId,
    browser: extension.browser || 'Chrome',
    email: extension.profile?.email || null,
    activeTabs: extension.activeTargets,
    playwriterVersion: extension.playwriterVersion,
  }
}

function formatBrowserList(browsers: ExtensionBrowser[]): string {
  return browsers
    .map((browser) => {
      return `- ${browser.browser} ${browser.email || '(not signed in)'} id=${browser.id}`
    })
    .join('\n')
}

/**
 * List browsers with the Playwriter extension connected. Starts the relay if needed
 * and waits briefly for at least one extension. Returns [] if none connects.
 */
export async function listBrowsers({
  port = RELAY_PORT,
  logger,
}: {
  port?: number
  logger?: { log: (...args: any[]) => void }
} = {}): Promise<ExtensionBrowser[]> {
  await ensureRelayServer({ logger })
  const extensions = await waitForConnectedExtensions({ port, logger })
  return extensions.map(toExtensionBrowser)
}

export async function createRelaySession({
  port = RELAY_PORT,
  browserId,
  tabGroup,
  tabGroupColor,
}: {
  port?: number
  /** ExtensionBrowser.id. Required when more than one browser is connected. */
  browserId?: string
  tabGroup?: string
  tabGroupColor?: TabGroupColor
} = {}): Promise<CreatedRelaySession> {
  const response = await fetch(`http://127.0.0.1:${port}/cli/session/new`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ extensionId: browserId, tabGroup, tabGroupColor, client: 'sdk' }),
  })
  const result = (await response.json()) as CreatedRelaySession & { error?: string }
  if (!response.ok) {
    throw new Error(result.error || `Playwriter session create failed with HTTP ${response.status}`)
  }
  if (!result.id) {
    throw new Error('Playwriter session create returned no id')
  }
  return result
}

export async function deleteRelaySession({
  port = RELAY_PORT,
  sessionId,
  closeCreatedTabs = false,
  ownershipKey,
}: {
  port?: number
  sessionId: string
  /** From createRelaySession. The relay refuses the delete when it does not match (relay restarted, id reused) */
  ownershipKey?: string
  /** Also close the tabs this session created (and popups they opened). Other sessions' tabs stay open. */
  closeCreatedTabs?: boolean
}): Promise<{ warning?: string }> {
  const response = await fetch(`http://127.0.0.1:${port}/cli/session/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, closeCreatedTabs, ownershipKey }),
  })
  if (response.status === 404) {
    return {}
  }
  const result = (await response.json().catch(() => ({}))) as { error?: string; warning?: string }
  if (!response.ok) {
    throw new Error(result.error || `Playwriter session delete failed with HTTP ${response.status}`)
  }
  return { warning: result.warning }
}

export async function connectViaExtension({
  port = RELAY_PORT,
  selectBrowser,
  tabGroup,
  tabGroupColor,
  closeTabsOnEnd = false,
  logger,
}: {
  port?: number
  /**
   * Also close the tabs this connection opened (and popups they opened) on close().
   * Off by default: close your own pages with `await using page = await context.newPage()`
   * or `page.close()`, so tabs shared with other processes are never closed behind their back.
   */
  closeTabsOnEnd?: boolean
  /**
   * Pick which browser to use when the extension runs in more than one browser
   * or profile. Return one item of the array. Called even with a single browser.
   * Without it, connecting fails if more than one browser is connected.
   */
  selectBrowser?: SelectBrowser
  tabGroup?: string
  tabGroupColor?: TabGroupColor
  logger?: { log: (...args: any[]) => void }
} = {}): Promise<PlaywriterBrowserConnection> {
  const browsers = await listBrowsers({ port, logger })
  if (browsers.length === 0) {
    throw new Error(EXTENSION_NOT_CONNECTED_ERROR)
  }

  const selected = await (async (): Promise<ExtensionBrowser> => {
    if (selectBrowser) {
      const choice = await selectBrowser(browsers)
      const match = choice && browsers.find((browser) => browser.id === choice.id)
      if (!match) {
        throw new Error(`selectBrowser returned no connected browser. Connected:\n${formatBrowserList(browsers)}`)
      }
      return match
    }
    if (browsers.length > 1) {
      throw new Error(
        `Playwriter is connected in ${browsers.length} browsers. Pass selectBrowser to connectViaExtension() to pick one:\n${formatBrowserList(browsers)}`,
      )
    }
    return browsers[0]
  })()

  const session = await createRelaySession({ port, browserId: selected.id, tabGroup, tabGroupColor })
  const chromium = await getChromium()
  const browser = await chromium
    .connectOverCDP(
      getCdpUrl({
        port,
        extensionId: selected.id,
        sessionId: session.id,
        tabGroup,
        tabGroupColor,
      }),
    )
    .catch(async (cause) => {
      await deleteRelaySession({ port, sessionId: session.id }).catch(() => undefined)
      throw cause
    })

  // Memoized so close() followed by dispose (or double close) runs cleanup once.
  // browser.contexts() lists every Playwriter tab, including other sessions' tabs, so the
  // extension closes only the tabs this session created instead of every page we can see.
  let closing: Promise<void> | undefined
  const close = () => {
    closing ??= (async () => {
      await browser.close().catch(() => undefined)
      const { warning } = await deleteRelaySession({
        port,
        sessionId: session.id,
        closeCreatedTabs: closeTabsOnEnd,
        ownershipKey: session.ownershipKey,
      })
      if (warning && logger) {
        logger.log(warning)
      } else if (warning) {
        console.warn(warning)
      }
    })()
    return closing
  }

  return {
    browser,
    extensionBrowser: selected,
    sessionId: session.id,
    close,
    [Symbol.asyncDispose]: close,
  }
}
