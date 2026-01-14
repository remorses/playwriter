import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import { chromium, Browser } from 'playwright-core'
import { VERSION, sleep, getCdpUrl } from './utils.js'
import { RelayServerStartError, ExtensionNotConnectedError } from './errors.js'
import { killPortProcess } from 'kill-port-process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const require = createRequire(import.meta.url)

const DEFAULT_PORT = 19988
const DEFAULT_TIMEOUT = 10000

async function getServerVersion(port: number): Promise<string | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/version`, {
      signal: AbortSignal.timeout(500),
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
 * Compare two semver versions. Returns:
 * - negative if v1 < v2
 * - 0 if v1 === v2
 * - positive if v1 > v2
 */
function compareVersions(v1: string, v2: string): number {
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

export interface EnsurePersistentRelayResult {
  /** Whether a new server was started (false if already running) */
  started: boolean
  /** Version of the running server */
  version: string
  /** Port the server is running on */
  port: number
}

/**
 * Ensures a playwriter relay server is running as a persistent background process.
 *
 * This function checks if a relay server is already running at the specified port.
 * If not, it spawns one as a detached process that survives script exit.
 *
 * @example
 * ```typescript
 * import { ensurePersistentRelay } from 'playwriter'
 *
 * const { started } = await ensurePersistentRelay()
 * console.log(started ? 'Server started' : 'Server was already running')
 * ```
 */
export async function ensurePersistentRelay(options?: {
  /**
   * Port for the relay server.
   * @default 19988
   */
  port?: number

  /**
   * Timeout in milliseconds to wait for server to start.
   * @default 10000
   */
  timeout?: number
}): Promise<EnsurePersistentRelayResult> {
  const port = options?.port ?? DEFAULT_PORT
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT

  const existingVersion = await getServerVersion(port)

  // Already running with same or newer version
  if (existingVersion !== null && compareVersions(existingVersion, VERSION) >= 0) {
    return { started: false, version: existingVersion, port }
  }

  // Kill old version if running
  if (existingVersion !== null) {
    try {
      await killPortProcess(port)
      await sleep(500)
    } catch {}
  }

  // Spawn detached server
  // Try to find the start-relay-server script in various locations
  let scriptPath: string
  let command: string

  // Production mode: try to find the compiled .js file first
  const possibleJsPaths = [
    path.resolve(__dirname, './start-relay-server.js'),
    path.resolve(__dirname, '../dist/start-relay-server.js'),
  ]

  const existingJsPath = possibleJsPaths.find((p) => fs.existsSync(p))

  if (existingJsPath) {
    // Use node to run compiled .js
    scriptPath = existingJsPath
    command = process.execPath
  } else {
    // Fallback: run .ts file directly with bun (bun can run .ts natively)
    const tsPath = path.resolve(__dirname, './start-relay-server.ts')
    const tsSrcPath = path.resolve(__dirname, './src/start-relay-server.ts')

    if (fs.existsSync(tsPath)) {
      scriptPath = tsPath
    } else if (fs.existsSync(tsSrcPath)) {
      scriptPath = tsSrcPath
    } else {
      throw new RelayServerStartError(port)
    }
    // Use bun which can run .ts files directly
    command = 'bun'
  }

  const serverProcess = spawn(command, [scriptPath], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  })
  serverProcess.unref()

  // Poll until ready
  const startTime = Date.now()
  while (Date.now() - startTime < timeout) {
    await sleep(500)
    const version = await getServerVersion(port)
    if (version === VERSION) {
      return { started: true, version, port }
    }
  }

  throw new RelayServerStartError(port)
}

export interface ExtensionStatus {
  connected: boolean
  pageCount: number
  pages: Array<{
    targetId: string
    url: string
    title: string
  }>
}

export interface WaitForExtensionResult {
  /** Whether extension is connected */
  connected: boolean
  /** Number of pages available */
  pageCount: number
}

/**
 * Waits for the Chrome extension to connect to the relay server.
 *
 * The extension must be installed and the user must click the extension icon
 * on at least one tab to enable it.
 *
 * @throws {ExtensionNotConnectedError} If extension doesn't connect within timeout
 *
 * @example
 * ```typescript
 * import { ensurePersistentRelay, waitForExtension } from 'playwriter'
 *
 * await ensurePersistentRelay()
 * console.log('Click the Playwriter extension icon...')
 * await waitForExtension({ timeout: 60000 })
 * console.log('Extension connected!')
 * ```
 */
export async function waitForExtension(options?: {
  /**
   * Port of the relay server.
   * @default 19988
   */
  port?: number

  /**
   * Timeout in milliseconds to wait for extension.
   * @default 30000
   */
  timeout?: number

  /**
   * Interval in milliseconds between status checks.
   * @default 500
   */
  pollInterval?: number
}): Promise<WaitForExtensionResult> {
  const port = options?.port ?? DEFAULT_PORT
  const timeout = options?.timeout ?? 30000
  const pollInterval = options?.pollInterval ?? 500

  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/extension-status`, {
        signal: AbortSignal.timeout(1000),
      })

      if (response.ok) {
        const status = (await response.json()) as ExtensionStatus
        if (status.connected && status.pageCount > 0) {
          return { connected: true, pageCount: status.pageCount }
        }
      }
    } catch {
      // Server might not be ready yet
    }

    await sleep(pollInterval)
  }

  throw new ExtensionNotConnectedError(port)
}

/**
 * Connects to a playwriter-controlled Chrome browser using Playwright.
 *
 * This is the recommended way to use Playwright with playwriter directly.
 * It handles server lifecycle and waits for the extension to connect.
 *
 * IMPORTANT: Call `browser.disconnect()` when done, NOT `browser.close()`.
 * Closing the browser would close the user's Chrome tabs.
 *
 * @throws {RelayServerStartError} If server fails to start
 * @throws {ExtensionNotConnectedError} If extension doesn't connect
 *
 * @example
 * ```typescript
 * import { connectToPlaywriter } from 'playwriter'
 *
 * const browser = await connectToPlaywriter()
 * const page = browser.contexts()[0].pages()[0]
 *
 * await page.goto('https://example.com')
 * console.log(await page.title())
 *
 * await browser.disconnect() // NOT browser.close()
 * ```
 */
export async function connectToPlaywriter(options?: {
  /**
   * Port for the relay server.
   * @default 19988
   */
  port?: number

  /**
   * Timeout in milliseconds for server start and extension connection.
   * @default 30000
   */
  timeout?: number
}): Promise<Browser> {
  const port = options?.port ?? DEFAULT_PORT
  const timeout = options?.timeout ?? 30000

  await ensurePersistentRelay({ port, timeout })
  await waitForExtension({ port, timeout })

  const cdpUrl = getCdpUrl({ port })
  const browser = await chromium.connectOverCDP(cdpUrl)

  return browser
}
