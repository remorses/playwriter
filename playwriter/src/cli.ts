#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import util from 'node:util'
import { fileURLToPath } from 'node:url'
import { cac } from '@xmorse/cac'
import pc from 'picocolors'
import {
  getBrowserLaunchArgs,
  getDefaultBrowserUserDataDir,
  startBrowserProcess,
} from './browser-launch.js'
import { resolveBrowserExecutablePath, shouldUseHeadlessByDefault } from './browser-config.js'
import { getBundledExtensionPath } from './package-paths.js'

// Prevent Buffers from dumping hex bytes in util.inspect output.
Buffer.prototype[util.inspect.custom] = function () {
  return `<Buffer ${this.length} bytes>`
}
import { killPortProcess } from './kill-port.js'
import { VERSION, LOG_FILE_PATH, LOG_CDP_FILE_PATH, parseRelayHost } from './utils.js'
import {
  ensureRelayServer,
  RELAY_PORT,
  waitForConnectedExtensions,
  getExtensionOutdatedWarning,
  getExtensionStatus,
  type ExtensionStatus,
} from './relay-client.js'
import { discoverChromeInstances, type DiscoveredInstance } from './chrome-discovery.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const cliRelayEnv = { PLAYWRITER_AUTO_ENABLE: '1' }

const cli = cac('playwriter')

cli
  .command('browser start [binaryPath]', 'Start Chromium or Chrome for Testing with the bundled Playwriter extension')
  .option('--user-data-dir <dir>', 'Persistent browser profile directory used for the managed browser')
  .option('--headless', 'Run the browser in headless mode')
  .option('--headed', 'Force headed mode even on Linux without DISPLAY/WAYLAND_DISPLAY')
  .option('--disable-sandbox', 'Disable the browser sandbox, useful on some VPS setups')
  .action(
    async (
      binaryPath: string | undefined,
      options: {
        userDataDir?: string
        headless?: boolean
        headed?: boolean
        disableSandbox?: boolean
      },
    ) => {
      if (options.headless && options.headed) {
        console.error('Error: --headless and --headed cannot be used together.')
        process.exit(1)
      }

      try {
        await ensureRelayServer({ logger: console, env: cliRelayEnv })

        const browserPath = resolveBrowserExecutablePath({ browserPath: binaryPath })
        const extensionPath = getBundledExtensionPath()
        const userDataDir = path.resolve(options.userDataDir || getDefaultBrowserUserDataDir())
        const headless = options.headed ? false : options.headless ? true : shouldUseHeadlessByDefault()
        const args = getBrowserLaunchArgs({
          extensionPath,
          userDataDir,
          headless,
          noSandbox: options.disableSandbox,
        })

        const { pid } = startBrowserProcess({
          browserPath,
          args,
          userDataDir,
        })

        const connectedExtensions = await waitForConnectedExtensions({
          timeoutMs: 15000,
          pollIntervalMs: 250,
          logger: console,
        })

        console.log(`Browser started (pid ${pid}).`)
        console.log(`  Binary: ${browserPath}`)
        console.log(`  Extension: ${extensionPath}`)
        console.log(`  Profile: ${userDataDir}`)
        console.log(`  Mode: ${headless ? 'headless' : 'headed'}`)
        console.log('  Permissions: recording/tabCapture flags enabled')

        if (connectedExtensions.length > 0) {
          console.log('Playwriter extension connected to the relay server.')
          return
        }

        console.log('Browser started, but the extension has not connected yet.')
        console.log(`Check logs at: ${LOG_FILE_PATH}`)
      } catch (error: any) {
        console.error(`Error: ${error.message}`)
        process.exit(1)
      }
    },
  )

cli
  .command('', 'Start the MCP server or controls the browser with -e')
  .option('--host <host>', 'Remote relay server host to connect to (or use PLAYWRITER_HOST env var)')
  .option('--token <token>', 'Authentication token (or use PLAYWRITER_TOKEN env var)')
  .option('--direct [endpoint]', 'Use direct CDP connection without the extension. Enable debugging first at chrome://inspect/#remote-debugging or launch Chrome with --remote-debugging-port=9222. Auto-discovers instances or accepts an explicit ws:// endpoint (or use PLAYWRITER_DIRECT env var)')
  .option('-s, --session <name>', 'Session ID (required for -e, get one with `playwriter session new`)')
  .option('-e, --eval <code>', 'Execute JavaScript code and exit, read https://playwriter.dev/SKILL.md for usage')
  .option('--timeout <ms>', 'Execution timeout in milliseconds', { default: 10000 })
  .action(async (options: { host?: string; token?: string; direct?: boolean | string; eval?: string; timeout?: number; session?: string }) => {
    // If -e flag is provided, execute code via relay server
    if (options.eval) {
      await executeCode({
        code: options.eval,
        timeout: options.timeout || 10000,
        sessionId: options.session,
        host: options.host,
        token: options.token,
      })
      return
    }

    // Resolve --direct flag to env var value
    const directValue = typeof options.direct === 'string' ? options.direct : options.direct === true ? 'auto' : undefined

    // Otherwise start the MCP server
    const { startMcp } = await import('./mcp.js')
    await startMcp({
      host: options.host,
      token: options.token,
      direct: directValue,
    })
  })

async function getServerUrl(host?: string): Promise<string> {
  const serverHost = host || process.env.PLAYWRITER_HOST || '127.0.0.1'
  const { httpBaseUrl } = parseRelayHost(serverHost, RELAY_PORT)
  return httpBaseUrl
}

async function fetchExtensionsStatus(host?: string): Promise<ExtensionStatus[]> {
  try {
    const serverUrl = await getServerUrl(host)
    const response = await fetch(`${serverUrl}/extensions/status`, {
      signal: AbortSignal.timeout(2000),
    })
    if (!response.ok) {
      const fallback = await fetch(`${serverUrl}/extension/status`, {
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
          browser: fallbackData?.browser,
          profile: fallbackData?.profile,
          activeTargets: fallbackData?.activeTargets,
          playwriterVersion: fallbackData?.playwriterVersion || null,
        },
      ]
    }
    const data = (await response.json()) as {
      extensions: ExtensionStatus[]
    }
    return data?.extensions || []
  } catch {
    return []
  }
}

async function executeCode(options: {
  code: string
  timeout: number
  sessionId?: string
  host?: string
  token?: string
}): Promise<void> {
  const { code, timeout, host, token } = options
  const cwd = process.cwd()
  const sessionId = options.sessionId ? String(options.sessionId) : process.env.PLAYWRITER_SESSION

  // Session is required
  if (!sessionId) {
    console.error('Error: -s/--session is required.')
    console.error('Always run `playwriter session new` first to get a session ID to use.')
    process.exit(1)
  }

  const serverUrl = await getServerUrl(host)

  // Ensure relay server is running (only for local)
  if (!host && !process.env.PLAYWRITER_HOST) {
    const restarted = await ensureRelayServer({ logger: console, env: cliRelayEnv })
    if (restarted) {
      const connectedExtensions = await waitForConnectedExtensions({
        logger: console,
        timeoutMs: 10000,
        pollIntervalMs: 250,
      })
      if (connectedExtensions.length === 0) {
        console.error('Warning: Extension not connected. Commands may fail.')
      }
    }
  }

  // Warn once if extension is outdated
  const extensionStatus = await getExtensionStatus()
  const outdatedWarning = getExtensionOutdatedWarning(extensionStatus?.playwriterVersion)
  if (outdatedWarning) {
    console.error(outdatedWarning)
  }

  // Build request URL with token if provided
  const executeUrl = `${serverUrl}/cli/execute`

  try {
    const response = await fetch(executeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token || process.env.PLAYWRITER_TOKEN
          ? { Authorization: `Bearer ${token || process.env.PLAYWRITER_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({ sessionId, code, timeout, cwd }),
    })

    if (!response.ok) {
      const text = await response.text()
      console.error(`Error: ${response.status} ${text}`)
      process.exit(1)
    }

    const result = (await response.json()) as {
      text: string
      images: Array<{ data: string; mimeType: string }>
      screenshots: Array<{ path: string; snapshot: string; labelCount: number }>
      isError: boolean
    }

    // Print output
    if (result.text) {
      if (result.isError) {
        console.error(result.text)
      } else {
        console.log(result.text)
      }
    }

    // CLI: show screenshot path + snapshot text (no inline image)
    if (result.screenshots && result.screenshots.length > 0) {
      for (const s of result.screenshots) {
        console.log(`\nScreenshot saved to: ${s.path}`)
        console.log(`Labels shown: ${s.labelCount}\n`)
        console.log(`Accessibility snapshot:\n${s.snapshot}`)
      }
    }

    if (result.isError) {
      process.exit(1)
    }
  } catch (error: any) {
    if (error.cause?.code === 'ECONNREFUSED') {
      console.error('Error: Cannot connect to relay server.')
      console.error('The Playwriter relay server should start automatically. Check logs at:')
      console.error(`  ${LOG_FILE_PATH}`)
    } else {
      console.error(`Error: ${error.message}`)
    }
    process.exit(1)
  }
}

// Session management commands
// Unified browser option type used in the multi-browser selection table
interface BrowserOption {
  key: string
  type: 'extension' | 'direct'
  browser: string
  profile: string
  /** For extension entries */
  extensionId?: string | null
  /** For direct CDP entries */
  wsUrl?: string
  /** Raw profile data from discovery (for passing to relay) */
  profiles?: Array<{ name: string; email: string }>
}

cli
  .command('session new', 'Create a new session and print the session ID')
  .option('--host <host>', 'Remote relay server host')
  .option('--browser <key>', 'Browser key when multiple browsers are available')
  .option('--direct [endpoint]', 'Use direct CDP connection without the extension. Enable debugging first at chrome://inspect/#remote-debugging or launch Chrome with --remote-debugging-port=9222. Auto-discovers instances or accepts an explicit ws:// endpoint')
  .action(async (options: { host?: string; browser?: string; direct?: boolean | string }) => {
    const isLocal = !options.host && !process.env.PLAYWRITER_HOST
    const directEndpoint = typeof options.direct === 'string' ? options.direct : null

    // If --direct with explicit endpoint, skip all discovery
    if (directEndpoint) {
      await ensureRelayForSessionCreation(isLocal)
      const serverUrl = await getServerUrl(options.host)
      const result = await createDirectSession({ serverUrl, cdpEndpoint: directEndpoint })
      console.log(`Session ${result.id} created (direct CDP). Use with: playwriter -s ${result.id} -e "..."`)
      console.log(pc.dim('NOTE: Recording unavailable in direct CDP mode.'))
      return
    }

    // If --direct with no endpoint, discover Chrome instances
    if (options.direct === true) {
      if (!isLocal) {
        console.error('Error: --direct auto-discovery only works locally.')
        console.error('For remote relay, pass an explicit endpoint reachable from the relay host:')
        console.error('  playwriter session new --host <host> --direct ws://relay-host:9222/devtools/browser/...')
        process.exit(1)
      }
      await ensureRelayForSessionCreation(isLocal)
      console.log(pc.dim('Discovering Chrome instances with debugging enabled...'))
      const instances = await discoverChromeInstances()

      if (instances.length === 0) {
        console.error('No Chrome instances with debugging enabled found.')
        console.error('')
        console.error('Enable debugging in one of these ways:')
        console.error('  1. Open chrome://inspect/#remote-debugging in Chrome')
        console.error('  2. Launch Chrome with: chrome --remote-debugging-port=9222')
        process.exit(1)
      }

      if (instances.length === 1 && !options.browser) {
        const instance = instances[0]
        const serverUrl = await getServerUrl(options.host)
        const result = await createDirectSession({ serverUrl, cdpEndpoint: instance.wsUrl, browser: instance.browser, profiles: instance.profiles })
        const profileLabel = formatInstanceProfiles(instance)
        console.log(
          `Session ${result.id} created (direct CDP, ${instance.browser}${profileLabel}). Use with: playwriter -s ${result.id} -e "..."`,
        )
        console.log(pc.dim('NOTE: Recording unavailable in direct CDP mode.'))
        return
      }

      // Multiple instances or --browser specified
      const directOptions = instances.map((instance) => {
        return instanceToBrowserOption(instance)
      })

      if (options.browser) {
        const selected = directOptions.find((opt) => {
          return opt.key === options.browser
        })
        if (!selected) {
          console.error(`Browser not found: ${options.browser}`)
          console.error('Available: ' + directOptions.map((opt) => opt.key).join(', '))
          process.exit(1)
        }
        const serverUrl = await getServerUrl(options.host)
        const result = await createDirectSession({ serverUrl, cdpEndpoint: selected.wsUrl!, browser: selected.browser, profiles: selected.profiles })
        console.log(`Session ${result.id} created (direct CDP). Use with: playwriter -s ${result.id} -e "..."`)
        console.log(pc.dim('NOTE: Recording unavailable in direct CDP mode.'))
        return
      }

      printBrowserTable(directOptions)
      console.log('\nRun again with --browser <key>.')
      process.exit(1)
    }

    // Default mode: extension-based (existing behavior)
    let extensions: ExtensionStatus[] = []

    if (isLocal) {
      await ensureRelayServer({ logger: console, env: cliRelayEnv })
      extensions = await waitForConnectedExtensions({
        timeoutMs: 12000,
        pollIntervalMs: 250,
        logger: console,
      })

      if (extensions.length === 0) {
        console.log(pc.dim('Waiting briefly for extension to reconnect...'))
        extensions = await waitForConnectedExtensions({
          timeoutMs: 10000,
          pollIntervalMs: 250,
          logger: console,
        })
      }
    } else {
      extensions = await fetchExtensionsStatus(options.host)
    }

    if (extensions.length === 0) {
      console.error('No connected browsers detected. Click the Playwriter extension icon.')
      console.error(pc.dim('Tip: Use --direct to connect via Chrome DevTools Protocol instead.'))
      process.exit(1)
    }

    // Warn if any connected extension was built with an older playwriter version
    for (const ext of extensions) {
      const warning = getExtensionOutdatedWarning(ext.playwriterVersion)
      if (warning) {
        console.error(warning)
        break
      }
    }

    // Single extension: auto-select (unchanged behavior)
    if (extensions.length === 1 && !options.browser) {
      const selectedExtension = extensions[0]
      try {
        const serverUrl = await getServerUrl(options.host)
        const extensionId =
          selectedExtension.extensionId === 'default'
            ? null
            : selectedExtension.stableKey || selectedExtension.extensionId
        const cwd = process.cwd()
        const response = await fetch(`${serverUrl}/cli/session/new`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ extensionId, cwd }),
        })
        if (!response.ok) {
          const text = await response.text()
          console.error(`Error: ${response.status} ${text}`)
          process.exit(1)
        }
        const result = (await response.json()) as { id: string; extensionId: string | null }
        console.log(`Session ${result.id} created. Use with: playwriter -s ${result.id} -e "..."`)
      } catch (error: any) {
        console.error(`Error: ${error.message}`)
        process.exit(1)
      }
      return
    }

    // Multiple extensions: also discover direct CDP instances and show unified table.
    // Only discover locally — remote relay can't reach local Chrome debug ports.
    const directInstances = isLocal ? await (async () => {
      console.log(pc.dim('Discovering additional Chrome instances...'))
      return await discoverChromeInstances()
    })() : []

    const allOptions: BrowserOption[] = [
      ...extensions.map((ext) => {
        return {
          key: ext.stableKey || ext.extensionId,
          type: 'extension' as const,
          browser: ext.browser || 'Chrome',
          profile: ext.profile?.email || '(not signed in)',
          extensionId: ext.extensionId === 'default' ? null : ext.stableKey || ext.extensionId,
        }
      }),
      ...directInstances.map((instance) => {
        return instanceToBrowserOption(instance)
      }),
    ]

    if (options.browser) {
      const selected = allOptions.find((opt) => {
        return opt.key === options.browser
      })
      if (!selected) {
        console.error(`Browser not found: ${options.browser}`)
        console.error('Available: ' + allOptions.map((opt) => opt.key).join(', '))
        process.exit(1)
      }

      try {
        const serverUrl = await getServerUrl(options.host)
        if (selected.type === 'direct') {
          const result = await createDirectSession({ serverUrl, cdpEndpoint: selected.wsUrl!, browser: selected.browser, profiles: selected.profiles })
          console.log(`Session ${result.id} created (direct CDP). Use with: playwriter -s ${result.id} -e "..."`)
          console.log(pc.dim('NOTE: Recording unavailable in direct CDP mode.'))
        } else {
          const cwd = process.cwd()
          const response = await fetch(`${serverUrl}/cli/session/new`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ extensionId: selected.extensionId, cwd }),
          })
          if (!response.ok) {
            const text = await response.text()
            console.error(`Error: ${response.status} ${text}`)
            process.exit(1)
          }
          const result = (await response.json()) as { id: string }
          console.log(`Session ${result.id} created. Use with: playwriter -s ${result.id} -e "..."`)
        }
      } catch (error: any) {
        console.error(`Error: ${error.message}`)
        process.exit(1)
      }
      return
    }

    // Show unified table
    console.log('\nMultiple browsers detected:\n')
    printBrowserTable(allOptions)
    console.log('\nRun again with --browser <key>.')
    process.exit(1)
  })

async function ensureRelayForSessionCreation(isLocal: boolean): Promise<void> {
  if (isLocal) {
    await ensureRelayServer({ logger: console, env: cliRelayEnv })
  }
}

async function createDirectSession({
  serverUrl,
  cdpEndpoint,
  browser,
  profiles,
}: {
  serverUrl: string
  cdpEndpoint: string
  browser?: string
  profiles?: Array<{ name: string; email: string }>
}): Promise<{ id: string }> {
  const cwd = process.cwd()
  const response = await fetch(`${serverUrl}/cli/session/new`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cdpEndpoint, cwd, browser, profiles }),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`${response.status} ${text}`)
  }
  return (await response.json()) as { id: string }
}

function instanceToBrowserOption(instance: DiscoveredInstance): BrowserOption {
  return {
    key: `direct:${instance.port}`,
    type: 'direct',
    browser: instance.browser,
    profile: formatInstanceProfiles(instance),
    wsUrl: instance.wsUrl,
    profiles: instance.profiles,
  }
}

function formatInstanceProfiles(instance: DiscoveredInstance): string {
  if (instance.profiles.length === 0) {
    return '(unknown)'
  }
  return instance.profiles
    .map((p) => {
      return p.email ? `${p.name} (${p.email})` : p.name
    })
    .join(', ')
}

function printBrowserTable(options: BrowserOption[]): void {
  const keyWidth = Math.max(3, ...options.map((opt) => opt.key.length))
  const typeWidth = Math.max(4, ...options.map((opt) => opt.type.length))
  const browserWidth = Math.max(7, ...options.map((opt) => opt.browser.length))

  console.log(
    'KEY'.padEnd(keyWidth) + '  ' + 'TYPE'.padEnd(typeWidth) + '  ' + 'BROWSER'.padEnd(browserWidth) + '  ' + 'PROFILE',
  )
  console.log('-'.repeat(keyWidth + typeWidth + browserWidth + 20))
  for (const opt of options) {
    console.log(
      opt.key.padEnd(keyWidth) +
        '  ' +
        opt.type.padEnd(typeWidth) +
        '  ' +
        opt.browser.padEnd(browserWidth) +
        '  ' +
        opt.profile,
    )
  }
}

cli
  .command('session list', 'List all active sessions')
  .option('--host <host>', 'Remote relay server host')
  .action(async (options: { host?: string }) => {
    if (!options.host && !process.env.PLAYWRITER_HOST) {
      await ensureRelayServer({ logger: console, env: cliRelayEnv })
    }

    const serverUrl = await getServerUrl(options.host)
    let sessions: Array<{
      id: string
      stateKeys: string[]
      browser: string | null
      profile: { email: string; id: string } | null
      extensionId: string | null
      cwd: string | null
    }> = []

    try {
      const response = await fetch(`${serverUrl}/cli/sessions`, {
        signal: AbortSignal.timeout(2000),
      })
      if (!response.ok) {
        console.error(`Error: ${response.status} ${await response.text()}`)
        process.exit(1)
      }
      const result = (await response.json()) as {
        sessions: Array<{
          id: string
          stateKeys: string[]
          browser: string | null
          profile: { email: string; id: string } | null
          extensionId: string | null
          cwd: string | null
        }>
      }
      sessions = result.sessions
    } catch (error: any) {
      console.error(`Error: ${error.message}`)
      process.exit(1)
    }

    if (sessions.length === 0) {
      console.log('No active sessions')
      return
    }

    const idWidth = Math.max(2, ...sessions.map((session) => String(session.id).length))
    const browserWidth = Math.max(7, ...sessions.map((session) => (session.browser || 'Chrome').length))
    const profileWidth = Math.max(7, ...sessions.map((session) => (session.profile?.email || '').length || 1))
    const extensionWidth = Math.max(2, ...sessions.map((session) => (session.extensionId || '').length || 1))
    const cwdWidth = Math.max(3, ...sessions.map((session) => (session.cwd || '').length || 1))
    const stateWidth = Math.max(10, ...sessions.map((session) => session.stateKeys.join(', ').length || 1))

    console.log(
      'ID'.padEnd(idWidth) +
        '  ' +
        'BROWSER'.padEnd(browserWidth) +
        '  ' +
        'PROFILE'.padEnd(profileWidth) +
        '  ' +
        'EXT'.padEnd(extensionWidth) +
        '  ' +
        'CWD'.padEnd(cwdWidth) +
        '  ' +
        'STATE KEYS',
    )
    console.log('-'.repeat(idWidth + browserWidth + profileWidth + extensionWidth + cwdWidth + stateWidth + 10))

    for (const session of sessions) {
      const stateStr = session.stateKeys.length > 0 ? session.stateKeys.join(', ') : '-'
      const profileLabel = session.profile?.email || '-'
      const cwdLabel = session.cwd || '-'
      console.log(
        String(session.id).padEnd(idWidth) +
          '  ' +
          (session.browser || 'Chrome').padEnd(browserWidth) +
          '  ' +
          profileLabel.padEnd(profileWidth) +
          '  ' +
          (session.extensionId || '-').padEnd(extensionWidth) +
          '  ' +
          cwdLabel.padEnd(cwdWidth) +
          '  ' +
          stateStr,
      )
    }
  })

cli
  .command('session delete <sessionId>', 'Delete a session and clear its state')
  .option('--host <host>', 'Remote relay server host')
  .action(async (sessionId: string, options: { host?: string }) => {
    const serverUrl = await getServerUrl(options.host)

    if (!options.host && !process.env.PLAYWRITER_HOST) {
      await ensureRelayServer({ logger: console, env: cliRelayEnv })
    }

    try {
      const response = await fetch(`${serverUrl}/cli/session/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })

      if (!response.ok) {
        const result = (await response.json()) as { error: string }
        console.error(`Error: ${result.error}`)
        process.exit(1)
      }

      console.log(`Session ${sessionId} deleted.`)
    } catch (error: any) {
      console.error(`Error: ${error.message}`)
      process.exit(1)
    }
  })

cli
  .command('session reset <sessionId>', 'Reset the browser connection for a session')
  .option('--host <host>', 'Remote relay server host')
  .action(async (sessionId: string, options: { host?: string }) => {
    const cwd = process.cwd()
    const serverUrl = await getServerUrl(options.host)

    if (!options.host && !process.env.PLAYWRITER_HOST) {
      await ensureRelayServer({ logger: console, env: cliRelayEnv })
    }

    try {
      const response = await fetch(`${serverUrl}/cli/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, cwd }),
      })

      if (!response.ok) {
        const text = await response.text()
        console.error(`Error: ${response.status} ${text}`)
        process.exit(1)
      }

      const result = (await response.json()) as { success: boolean; pageUrl: string; pagesCount: number }
      console.log(
        `Connection reset successfully. ${result.pagesCount} page(s) available. Current page URL: ${result.pageUrl}`,
      )
    } catch (error: any) {
      console.error(`Error: ${error.message}`)
      process.exit(1)
    }
  })

cli
  .command(
    'serve',
    `Start the relay server on this machine (must be the same host where Chrome is running). Remote clients (Docker, other machines) connect via PLAYWRITER_HOST. Use --host localhost for Docker (no token needed) — containers reach it via host.docker.internal. Use --host 0.0.0.0 for LAN/internet access (requires --token).`,
  )
  .option('--host <host>', 'Host to bind to (use "localhost" for Docker, "0.0.0.0" for remote access)', { default: '0.0.0.0' })
  .option('--token <token>', 'Authentication token, required when --host is 0.0.0.0 (or use PLAYWRITER_TOKEN env var)')
  .option('--replace', 'Kill existing server if running')
  .action(async (options: { host: string; token?: string; replace?: boolean }) => {
    const token = options.token || process.env.PLAYWRITER_TOKEN
    const isPublicHost = options.host === '0.0.0.0' || options.host === '::'
    if (isPublicHost && !token) {
      console.error('Error: Authentication token is required when binding to a public host.')
      console.error('Provide --token <token> or set PLAYWRITER_TOKEN environment variable.')
      process.exit(1)
    }

    // Check if server is already running on the port
    const net = await import('node:net')
    const isPortInUse = await new Promise<boolean>((resolve) => {
      const socket = new net.Socket()
      socket.setTimeout(500)
      socket.on('connect', () => {
        socket.destroy()
        resolve(true)
      })
      socket.on('timeout', () => {
        socket.destroy()
        resolve(false)
      })
      socket.on('error', () => {
        resolve(false)
      })
      socket.connect(RELAY_PORT, '127.0.0.1')
    })

    if (isPortInUse) {
      if (!options.replace) {
        console.log(`Playwriter server is already running on port ${RELAY_PORT}`)
        console.log('Tip: Use --replace to kill the existing server and start a new one.')
        process.exit(0)
      }

      // Kill existing process on the port
      console.log(`Killing existing server on port ${RELAY_PORT}...`)
      await killPortProcess({ port: RELAY_PORT })
    }

    // Lazy-load heavy dependencies only when serve command is used
    const { createFileLogger } = await import('./create-logger.js')
    const { startPlayWriterCDPRelayServer } = await import('./cdp-relay.js')

    const logger = createFileLogger()

    process.title = 'playwriter-serve'

    process.on('uncaughtException', async (err) => {
      await logger.error('Uncaught Exception:', err)
      process.exit(1)
    })

    process.on('unhandledRejection', async (reason) => {
      await logger.error('Unhandled Rejection:', reason)
      process.exit(1)
    })

    const server = await startPlayWriterCDPRelayServer({
      port: RELAY_PORT,
      host: options.host,
      token,
      logger,
    })

    console.log('Playwriter CDP relay server started')
    console.log(`  Host: ${options.host}`)
    console.log(`  Port: ${RELAY_PORT}`)
    console.log(`  Token: ${token ? '(configured)' : '(none)'}`)
    console.log(`  Logs: ${logger.logFilePath}`)
    console.log(`  CDP Logs: ${LOG_CDP_FILE_PATH}`)
    console.log('')
    console.log(`CDP endpoint: http://${options.host}:${RELAY_PORT}${token ? '?token=<token>' : ''}`)
    console.log('')
    console.log('Press Ctrl+C to stop.')

    process.on('SIGINT', () => {
      console.log('\nShutting down...')
      server.close()
      process.exit(0)
    })

    process.on('SIGTERM', () => {
      console.log('\nShutting down...')
      server.close()
      process.exit(0)
    })
  })

cli
  .command('browser list', 'Discover Chrome/Chromium instances with debugging enabled')
  .action(async () => {
    console.log(pc.dim('Scanning for Chrome instances with debugging enabled...\n'))
    const instances = await discoverChromeInstances()

    if (instances.length === 0) {
      console.log('No Chrome instances with debugging enabled found.\n')
      console.log('Enable debugging in one of these ways:')
      console.log('  1. Open chrome://inspect/#remote-debugging in Chrome')
      console.log('  2. Launch Chrome with: chrome --remote-debugging-port=9222')
      return
    }

    const portWidth = Math.max(4, ...instances.map((i) => String(i.port).length))
    const browserWidth = Math.max(7, ...instances.map((i) => i.browser.length))

    console.log('PORT'.padEnd(portWidth) + '  ' + 'BROWSER'.padEnd(browserWidth) + '  ' + 'PROFILES')
    console.log('-'.repeat(portWidth + browserWidth + 30))

    for (const instance of instances) {
      const profileLabel = formatInstanceProfiles(instance)
      console.log(
        String(instance.port).padEnd(portWidth) + '  ' + instance.browser.padEnd(browserWidth) + '  ' + profileLabel,
      )
    }

    console.log('')
    console.log(pc.dim('Use with: playwriter session new --direct'))
  })

cli.command('logfile', 'Print the path to the relay server log file').action(() => {
  console.log(`relay: ${LOG_FILE_PATH}`)
  console.log(`cdp: ${LOG_CDP_FILE_PATH}`)
})

cli.command('skill', 'Print the full playwriter usage instructions').action(() => {
  const skillPath = path.join(__dirname, '..', 'src', 'skill.md')
  const content = fs.readFileSync(skillPath, 'utf-8')
  console.log(content)
})

cli.help()
cli.version(VERSION)

cli.parse()
