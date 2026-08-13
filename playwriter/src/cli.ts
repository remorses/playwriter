#!/usr/bin/env node

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import util from 'node:util'
import { fileURLToPath } from 'node:url'
import { goke, openInBrowser, isAgent } from 'goke'
import { z } from 'zod'
import pc from 'picocolors'

// Prevent Buffers from dumping hex bytes in util.inspect output.
Buffer.prototype[util.inspect.custom] = function () {
  return `<Buffer ${this.length} bytes>`
}
import { killPortProcess } from './kill-port.js'
import { canEmitKittyGraphics, emitKittyImage } from './kitty-graphics.js'
import { VERSION, LOG_FILE_PATH, LOG_CDP_FILE_PATH, parseRelayHost } from './utils.js'
import {
  ensureRelayServer,
  RELAY_PORT,
  waitForConnectedExtensions,
  getExtensionOutdatedWarning,
  getExtensionStatus,
  type ExtensionStatus,
} from './relay-client.js'
import { discoverChromeInstances, resolveDirectInput, type DiscoveredInstance } from './chrome-discovery.js'
import { getCloudClient, loadCloudAuth, saveCloudAuth, CloudClient, buildLiveUrl } from './cloud-client.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const cli = goke('playwriter')

cli
  .command('browser start [binaryPath]', 'Start Chromium or Chrome for Testing with the bundled Playwriter extension')
  .hidden()
  .option('--user-data-dir <dir>', 'Persistent browser profile directory used for the managed browser')
  .option('--headless', 'Run the browser in headless mode')
  .option('--headed', 'Force headed mode even on Linux without DISPLAY/WAYLAND_DISPLAY')
  .option('--disable-sandbox', 'Disable the browser sandbox, useful on some VPS setups')
  .action(async (binaryPath, options) => {
      if (options.headless && options.headed) {
        console.error('Error: --headless and --headed cannot be used together.')
        process.exit(1)
      }

      try {
        // Avoid loading playwright-core during generic CLI startup/help. This command
        // is the only path that needs browser discovery and bundled extension launch.
        const [{ getBrowserLaunchArgs, getDefaultBrowserUserDataDir, startBrowserProcess }, { resolveBrowserExecutablePath, shouldUseHeadlessByDefault }, { getBundledExtensionPath }] = await Promise.all([
          import('./browser-launch.js'),
          import('./browser-config.js'),
          import('./package-paths.js'),
        ])

        await ensureRelayServer({ logger: console })

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
  .command('browser install', 'Download Chrome for Testing for headless browser automation')
  .action(async () => {
    try {
      const { installChrome } = await import('./browser-install.js')
      await installChrome()
    } catch (error: any) {
      console.error(`Error: ${error.message}`)
      process.exit(1)
    }
  })

const DEFAULT_EXEC_TIMEOUT = Number(process.env.PLAYWRITER_EXEC_TIMEOUT) || 10000

cli
  .command('', 'Start the MCP server or controls the browser with -e')
  .option('--host <host>', 'Remote relay server host to connect to (or use PLAYWRITER_HOST env var)')
  .option('--token <token>', 'Authentication token (or use PLAYWRITER_TOKEN env var)')
  .option('-s, --session <name>', 'Session ID (required for -e, get one with `playwriter session new`)')
  .option('-e, --eval <code>', 'Execute JavaScript code and exit, read https://playwriter.dev/SKILL.md for usage')
  .option('-f, --file <path>', 'Execute JavaScript from a file and exit')
  .option('--patchright', 'Use @playwriter/patchright-core for stealth mode (bypasses bot detection)')
  .option('--timeout [ms]', z.number().default(DEFAULT_EXEC_TIMEOUT).describe('Execution timeout in milliseconds'))
  .action(async (options) => {
    if (options.patchright) {
      process.env.PLAYWRITER_PATCHRIGHT = '1'
    }

    if (options.eval && options.file) {
      console.error('Error: -e and -f cannot be used together.')
      process.exit(1)
    }

    // If -e or -f flag is provided, execute code via relay server
    const code = (() => {
      if (options.eval) {
        return options.eval
      }
      if (options.file) {
        const filePath = path.resolve(options.file)
        if (!fs.existsSync(filePath)) {
          console.error(`Error: File not found: ${filePath}`)
          process.exit(1)
        }
        return fs.readFileSync(filePath, 'utf-8')
      }
      return null
    })()

    if (code) {
      await executeCode({
        code,
        timeout: options.timeout || DEFAULT_EXEC_TIMEOUT,
        sessionId: options.session,
        host: options.host,
        token: options.token,
      })
      return
    }

    // Otherwise start the MCP server
    // For direct CDP in MCP mode, use PLAYWRITER_DIRECT env var
    const { startMcp } = await import('./mcp.js')
    await startMcp({
      host: options.host,
      token: options.token,
    })
  })

async function getServerUrl(host?: string): Promise<string> {
  const serverHost = host || process.env.PLAYWRITER_HOST || '127.0.0.1'
  const { httpBaseUrl } = parseRelayHost(serverHost, RELAY_PORT)
  return httpBaseUrl
}

// Centralized header builder so every CLI subcommand sends the token consistently.
// Falls back to PLAYWRITER_TOKEN env var when --token is not provided.
function buildAuthHeaders({ token, json }: { token?: string; json?: boolean }): Record<string, string> {
  const headers: Record<string, string> = {}
  if (json) {
    headers['Content-Type'] = 'application/json'
  }
  const effectiveToken = token || process.env.PLAYWRITER_TOKEN
  if (effectiveToken) {
    headers['Authorization'] = `Bearer ${effectiveToken}`
  }
  return headers
}

async function fetchExtensionsStatus({ host, token }: { host?: string; token?: string } = {}): Promise<ExtensionStatus[]> {
  try {
    const serverUrl = await getServerUrl(host)
    const headers = buildAuthHeaders({ token })
    const response = await fetch(`${serverUrl}/extensions/status`, {
      signal: AbortSignal.timeout(2000),
      headers,
    })
    if (!response.ok) {
      const fallback = await fetch(`${serverUrl}/extension/status`, {
        signal: AbortSignal.timeout(2000),
        headers,
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
    const restarted = await ensureRelayServer({ logger: console })
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
      headers: buildAuthHeaders({ token, json: true }),
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
      screenshots: Array<{ path: string; base64: string; snapshot: string; labelCount: number }>
      isError: boolean
      isCloud?: boolean
    }

    // Print output
    if (result.text) {
      if (result.isError) {
        console.error(result.text)
      } else {
        console.log(result.text)
      }
    }

    // Emit images via Kitty Graphics Protocol when AGENT_GRAPHICS=kitty.
    // Agents with kitty-graphics-agent intercept these escape sequences and pass
    // the PNG images to the LLM as media parts — no extra tool call needed.
    const kittyEnabled = canEmitKittyGraphics()

    // Track emitted base64 to avoid duplicates (screenshots appear in both
    // result.screenshots and result.images from the same screenshotCollector)
    const emittedImages = new Set<string>()

    if (result.screenshots && result.screenshots.length > 0) {
      for (const s of result.screenshots) {
        if (kittyEnabled && s.base64) {
          emitKittyImage({ base64: s.base64 })
          emittedImages.add(s.base64)
        }
        console.log(`\nScreenshot saved to: ${s.path}`)
        console.log(`Labels shown: ${s.labelCount}\n`)
        console.log(`Accessibility snapshot:\n${s.snapshot}`)
      }
    }

    // Emit resized images from resizeImageForAgent() calls that aren't
    // already emitted as part of labeled screenshots
    if (kittyEnabled && result.images && result.images.length > 0) {
      for (const img of result.images) {
        if (img.data && !emittedImages.has(img.data)) {
          emitKittyImage({ base64: img.data })
          emittedImages.add(img.data)
        }
      }
    }

    if (result.isCloud) {
      console.error(pc.dim(`\nCloud session. Run \`playwriter session delete ${sessionId}\` when done.`))
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
  type: 'extension' | 'direct' | 'cloud' | 'headless'
  browser: string
  profile: string
  /** For extension entries */
  extensionId?: string | null
  /** For direct CDP entries */
  wsUrl?: string
  /** Raw profile data from discovery (for passing to relay) */
  profiles?: Array<{ name: string; email: string }>
  /** For cloud entries — active BU session's cloud session ID (if VM is running) */
  activeCloudSessionId?: string
}

const sessionCreationLogger = {
  log: (...args: unknown[]) => {
    console.error(...args)
  },
}

function printSessionId(sessionId: string): void {
  console.log(sessionId)
}

cli
  .command('session new', 'Create a new session and print the session ID')
  .option('--host <host>', 'Remote relay server host')
  .option('--token <token>', 'Authentication token (or use PLAYWRITER_TOKEN env var)')
  .option('--browser <key>', 'Browser key when multiple browsers are available. Special values: "headless" (launch headless Chrome, no extension), "cloud" (cloud browser with stealth/proxies)')
  .option('--patchright', 'Use @playwriter/patchright-core for stealth mode (bypasses bot detection)')
  .option('--direct [endpoint]', 'Use direct CDP connection without the extension. Enable debugging first at chrome://inspect/#remote-debugging or launch Chrome with --remote-debugging-port=9222. Auto-discovers instances or accepts an explicit ws:// endpoint')
  .option('--proxy <region>', 'Enable residential proxy for cloud browser (e.g. us, de, jp). Disabled by default. Use for anti-detection or geo-targeting.')
  .option('--custom-proxy <url>', 'Custom proxy for cloud browser (host:port or user:pass@host:port)')
  .option('--timeout <minutes>', 'Cloud browser timeout in minutes (1-240, default 60)')
  .option('--disable-proxy-bandwidth-acceleration', 'Allow loading images, video, and fonts when proxy is enabled (they are blocked by default to save proxy bandwidth)')
  .action(async (options) => {
    if (options.patchright) {
      process.env.PLAYWRITER_PATCHRIGHT = '1'
    }

    const isLocal = !options.host && !process.env.PLAYWRITER_HOST

    // --browser headless: launch headless Chrome via chromium.launch(), no extension
    if (options.browser === 'headless') {
      try {
        await ensureRelayForSessionCreation(isLocal)
        const serverUrl = await getServerUrl(options.host)
        const response = await fetch(`${serverUrl}/cli/session/new`, {
          method: 'POST',
          headers: buildAuthHeaders({ token: options.token, json: true }),
          body: JSON.stringify({ headless: true, cwd: process.cwd() }),
        })
        if (!response.ok) {
          const text = await response.text()
          if (text.includes('Could not find a supported browser binary')) {
            console.error('No Chrome browser found. Install one first:')
            console.error('')
            console.error('  playwriter browser install')
            console.error('')
            console.error('This downloads Chrome for Testing from Google.')
            process.exit(1)
          }
          console.error(`Error: ${response.status} ${text}`)
          process.exit(1)
        }
        const result = (await response.json()) as { id: string }
        printSessionId(result.id)
        console.error(pc.dim('NOTE: Recording unavailable in headless mode.'))
      } catch (error: any) {
        if (error.message?.includes('Could not find a supported browser binary')) {
          console.error('No Chrome browser found. Install one first:')
          console.error('')
          console.error('  playwriter browser install')
          console.error('')
          console.error('This downloads Chrome for Testing from Google.')
          process.exit(1)
        }
        console.error(`Error: ${error.message}`)
        process.exit(1)
      }
      return
    }
    // goke 6.6: optional-value flags are string | undefined
    //   `--direct ws://...` → 'ws://...' (explicit endpoint)
    //   `--direct`          → ''          (bare flag, auto-discover)
    //   (omitted)           → undefined   (don't use direct CDP)
    const directEndpoint = options.direct || null

    // If --direct with explicit endpoint, resolve it (handles host:port → ws://) then skip discovery
    if (directEndpoint) {
      let cdpEndpoint: string
      try {
        cdpEndpoint = await resolveDirectInput(directEndpoint)
      } catch (error: any) {
        console.error(`Error: ${error.message}`)
        process.exit(1)
      }
      await ensureRelayForSessionCreation(isLocal)
      const serverUrl = await getServerUrl(options.host)
      const result = await createDirectSession({ serverUrl, cdpEndpoint, token: options.token })
      printSessionId(result.id)
      console.error(pc.dim('NOTE: Recording unavailable in direct CDP mode.'))
      return
    }

    // If --direct with no endpoint, discover Chrome instances
    if (options.direct === '') {
      if (!isLocal) {
        console.error('Error: --direct auto-discovery only works locally.')
        console.error('For remote relay, pass an explicit endpoint reachable from the relay host:')
        console.error('  playwriter session new --host <host> --direct ws://relay-host:9222/devtools/browser/...')
        process.exit(1)
      }
      await ensureRelayForSessionCreation(isLocal)
      console.error(pc.dim('Discovering Chrome instances with debugging enabled...'))
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
        const result = await createDirectSession({ serverUrl, cdpEndpoint: instance.wsUrl, browser: instance.browser, profiles: instance.profiles, token: options.token })
        printSessionId(result.id)
        console.error(pc.dim('NOTE: Recording unavailable in direct CDP mode.'))
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
          await handleCloudBrowserNotFound(options.browser, { hasCloudOptions: false })
          console.error(`Browser not found: ${options.browser}`)
          console.error('Available: ' + directOptions.map((opt) => opt.key).join(', '))
          process.exit(1)
        }
        const serverUrl = await getServerUrl(options.host)
        const result = await createDirectSession({ serverUrl, cdpEndpoint: selected.wsUrl!, browser: selected.browser, profiles: selected.profiles, token: options.token })
        printSessionId(result.id)
        console.error(pc.dim('NOTE: Recording unavailable in direct CDP mode.'))
        return
      }

      printBrowserTable(directOptions)
      console.log('\nRun again with --browser <key>.')
      process.exit(1)
    }

    // Default mode: extension-based (existing behavior)
    let extensions: ExtensionStatus[] = []

    if (isLocal) {
      await ensureRelayServer({ logger: sessionCreationLogger })
      extensions = await waitForConnectedExtensions({
        timeoutMs: 12000,
        pollIntervalMs: 250,
        logger: sessionCreationLogger,
      })

      if (extensions.length === 0) {
        console.error(pc.dim('Waiting briefly for extension to reconnect...'))
        extensions = await waitForConnectedExtensions({
          timeoutMs: 10000,
          pollIntervalMs: 250,
          logger: sessionCreationLogger,
        })
      }
    } else {
      extensions = await fetchExtensionsStatus({ host: options.host, token: options.token })
    }

    if (extensions.length === 0) {
      // Before giving up, check if cloud browsers are available
      const cloudOptions = await discoverCloudBrowsers()
      if (cloudOptions.length > 0) {
        // Cloud-only user: skip extension requirement, show cloud options
        await ensureRelayForSessionCreation(isLocal)
        const allOptions: BrowserOption[] = [...cloudOptions]

        if (options.browser) {
          const selected = allOptions.find((opt) => { return opt.key === options.browser })
          if (!selected) {
            await handleCloudBrowserNotFound(options.browser, { hasCloudOptions: true })
            console.error(`Browser not found: ${options.browser}`)
            console.error('Available: ' + allOptions.map((opt) => opt.key).join(', '))
            process.exit(1)
          }
          const serverUrl = await getServerUrl(options.host)
          // Reuse existing running VM if selected, otherwise create new
          const result = selected.activeCloudSessionId
            ? await attachExistingCloudSession({
              serverUrl,
              cloudSessionId: selected.activeCloudSessionId,
              blockProxyResources: computeBlockProxyResources(options),
              token: options.token,
            })
            : await createCloudSession({
              serverUrl,
              proxyRegion: options.proxy,
              customProxy: options.customProxy,
              timeout: parseCloudTimeout(options.timeout),
              blockProxyResources: computeBlockProxyResources(options),
              token: options.token,
            })
          printSessionId(result.id)
          if (result.liveUrl) {
            console.error(pc.dim(`Live view: ${result.liveUrl}`))
          }
          return
        }

        console.log('\nNo local browsers detected, but cloud browsers are available:\n')
        printBrowserTable(allOptions)
        console.log('\nRun again with --browser <key>.')
        process.exit(1)
      }

      if (options.browser) {
        await handleCloudBrowserNotFound(options.browser, { hasCloudOptions: false })
      }
      console.error('No connected browsers detected. Click the Playwriter extension icon.')
      console.error(pc.dim('Tip: Use --direct to connect via Chrome DevTools Protocol instead.'))
      console.error(pc.dim('Tip: Run `playwriter cloud login` to use cloud browsers.'))
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
          headers: buildAuthHeaders({ token: options.token, json: true }),
          body: JSON.stringify({ extensionId, cwd }),
        })
        if (!response.ok) {
          const text = await response.text()
          console.error(`Error: ${response.status} ${text}`)
          process.exit(1)
        }
        const result = (await response.json()) as { id: string; extensionId: string | null }
        printSessionId(result.id)
        printCloudTip({ log: console.error })
      } catch (error: any) {
        console.error(`Error: ${error.message}`)
        process.exit(1)
      }
      return
    }

    // Multiple extensions: also discover direct CDP instances and cloud browsers.
    // Direct discovery only works locally — remote relay can't reach local Chrome debug ports.
    const directInstances = isLocal ? await (async () => {
      console.error(pc.dim('Discovering additional Chrome instances...'))
      return await discoverChromeInstances()
    })() : []

    // Fetch cloud browser slots if user is logged in
    const cloudOptions = await discoverCloudBrowsers()

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
      ...cloudOptions,
    ]

    if (options.browser) {
      const selected = allOptions.find((opt) => {
        return opt.key === options.browser
      })
      if (!selected) {
        await handleCloudBrowserNotFound(options.browser, { hasCloudOptions: cloudOptions.length > 0 })
        console.error(`Browser not found: ${options.browser}`)
        console.error('Available: ' + allOptions.map((opt) => opt.key).join(', '))
        process.exit(1)
      }

      try {
        const serverUrl = await getServerUrl(options.host)
        if (selected.type === 'cloud') {
          // Reuse existing running VM if selected, otherwise create new
          const result = selected.activeCloudSessionId
            ? await attachExistingCloudSession({
              serverUrl,
              cloudSessionId: selected.activeCloudSessionId,
              blockProxyResources: computeBlockProxyResources(options),
              token: options.token,
            })
            : await createCloudSession({
              serverUrl,
              proxyRegion: options.proxy,
              customProxy: options.customProxy,
              timeout: parseCloudTimeout(options.timeout),
              blockProxyResources: computeBlockProxyResources(options),
              token: options.token,
            })
          printSessionId(result.id)
          if (result.liveUrl) {
            console.error(pc.dim(`Live view: ${result.liveUrl}`))
          }
        } else if (selected.type === 'direct') {
          const result = await createDirectSession({ serverUrl, cdpEndpoint: selected.wsUrl!, browser: selected.browser, profiles: selected.profiles, token: options.token })
          printSessionId(result.id)
          console.error(pc.dim('NOTE: Recording unavailable in direct CDP mode.'))
        } else {
          const cwd = process.cwd()
          const response = await fetch(`${serverUrl}/cli/session/new`, {
            method: 'POST',
            headers: buildAuthHeaders({ token: options.token, json: true }),
            body: JSON.stringify({ extensionId: selected.extensionId, cwd }),
          })
          if (!response.ok) {
            const text = await response.text()
            console.error(`Error: ${response.status} ${text}`)
            process.exit(1)
          }
          const result = (await response.json()) as { id: string }
          printSessionId(result.id)
          printCloudTip({ log: console.error })
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
    await ensureRelayServer({ logger: sessionCreationLogger })
  }
}

async function createDirectSession({
  serverUrl,
  cdpEndpoint,
  browser,
  profiles,
  token,
}: {
  serverUrl: string
  cdpEndpoint: string
  browser?: string
  profiles?: Array<{ name: string; email: string }>
  token?: string
}): Promise<{ id: string }> {
  const cwd = process.cwd()
  const response = await fetch(`${serverUrl}/cli/session/new`, {
    method: 'POST',
    headers: buildAuthHeaders({ token, json: true }),
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

/** Discover cloud sessions from the website API, if logged in.
 *  Also adds a "cloud-new" option to create a new cloud browser. */
async function discoverCloudBrowsers(): Promise<BrowserOption[]> {
  const client = getCloudClient()
  if (!client) return []

  try {
    const { sessions } = await client.getStatus()
    const options: BrowserOption[] = sessions.map((s) => {
      return {
        key: `cloud-${s.index}`,
        type: 'cloud' as const,
        browser: 'Chromium',
        profile: `(running, expires ${new Date(s.timeoutAt).toLocaleTimeString()})`,
        activeCloudSessionId: s.cloudSessionId,
      }
    })
    // Always offer a "cloud-new" option to spin up a fresh VM
    options.push({
      key: 'cloud',
      type: 'cloud' as const,
      browser: 'Chromium',
      profile: '(new cloud browser)',
    })
    return options
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(pc.dim(`Cloud browser discovery failed: ${msg}`))
    return []
  }
}

/** Compute whether to block images/video/fonts for proxy bandwidth savings.
 *  Enabled by default when proxy or custom-proxy is set, disabled via
 *  --disable-proxy-bandwidth-acceleration. */
function computeBlockProxyResources(options: { proxy?: string; customProxy?: string; disableProxyBandwidthAcceleration?: boolean }): boolean | undefined {
  const proxyEnabled = !!(options.proxy || options.customProxy)
  if (!proxyEnabled) return undefined // no proxy, no blocking needed
  if (options.disableProxyBandwidthAcceleration) return false
  return true
}

/** Check if user requested a cloud browser that isn't available.
 *  Shows helpful login/subscribe instructions instead of a generic "not found" error.
 *  @param hasCloudOptions whether any cloud options were discovered (to distinguish
 *         "not logged in" from "typo in cloud key") */
async function handleCloudBrowserNotFound(browserKey: string, { hasCloudOptions }: { hasCloudOptions: boolean }): Promise<boolean> {
  if (!browserKey.startsWith('cloud')) return false
  // If cloud options exist, this is a typo (e.g. cloud-99) — let the
  // generic "Browser not found" message show the available list instead.
  if (hasCloudOptions) return false
  const auth = loadCloudAuth()
  if (!auth) {
    console.error('Cloud browsers require authentication.')
    console.error('')
    console.error('  Option 1: Run `playwriter cloud login` (interactive browser flow)')
    console.error('  Option 2: Set PLAYWRITER_API_KEY env var (create one at playwriter.dev/dashboard)')
    console.error('')
    console.error('  Then subscribe at playwriter.dev/dashboard and run `playwriter session new --browser cloud`')
  } else {
    // Verify token is still valid with a quick API check
    const client = getCloudClient()
    const tokenValid = await (async () => {
      if (!client) return false
      try {
        await client.getStatus()
        return true
      } catch {
        return false
      }
    })()

    if (!tokenValid) {
      console.error('Cloud authentication expired. Please re-authenticate.')
      console.error('')
      console.error('  Run `playwriter cloud login` or set PLAYWRITER_API_KEY env var.')
    } else {
      console.error('No cloud browser sessions available.')
      console.error('')
      console.error('  You are logged in, but you may need an active subscription.')
      console.error('  Run `playwriter cloud subscribe` to manage your plan.')
      console.error('  Then run `playwriter session new --browser cloud` to start a cloud browser.')
    }
  }
  process.exit(1)
}

function printCloudTip({ log = console.log }: { log?: (...args: unknown[]) => void } = {}): void {
  log('')
  log(
    pc.dim('Tip: Need stealth browsing, VPS control, or auto CAPTCHA solving? Run `playwriter cloud login` or set PLAYWRITER_API_KEY'),
  )
  log(
    pc.dim('     to control a browser in the cloud instead of local Chrome.'),
  )
}

/** Parse a custom proxy string (host:port or user:pass@host:port) into an object. */
function parseCustomProxy(proxyStr: string): { host: string; port: number; username?: string; password?: string } {
  // Format: [user:pass@]host:port
  const atIdx = proxyStr.lastIndexOf('@')
  let hostPort: string
  let username: string | undefined
  let password: string | undefined

  if (atIdx !== -1) {
    const userPass = proxyStr.slice(0, atIdx)
    hostPort = proxyStr.slice(atIdx + 1)
    const colonIdx = userPass.indexOf(':')
    if (colonIdx !== -1) {
      username = userPass.slice(0, colonIdx)
      password = userPass.slice(colonIdx + 1)
    } else {
      username = userPass
    }
  } else {
    hostPort = proxyStr
  }

  const lastColon = hostPort.lastIndexOf(':')
  if (lastColon === -1) {
    throw new Error(`Invalid proxy format: missing port in "${proxyStr}". Expected host:port or user:pass@host:port`)
  }
  const host = hostPort.slice(0, lastColon)
  const port = parseInt(hostPort.slice(lastColon + 1), 10)
  if (isNaN(port)) {
    throw new Error(`Invalid proxy port in "${proxyStr}"`)
  }

  return { host, port, username, password }
}

/** Parse and validate the --timeout CLI option (integer 1-240). */
function parseCloudTimeout(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  if (!/^\d+$/.test(value)) {
    throw new Error('--timeout must be an integer from 1 to 240')
  }
  const timeout = Number(value)
  if (timeout < 1 || timeout > 240) {
    throw new Error('--timeout must be between 1 and 240 minutes')
  }
  return timeout
}

/** Connect to a cloud browser and create a playwriter session via the relay. */
async function createCloudSession({
  serverUrl,
  proxyRegion,
  customProxy,
  timeout,
  blockProxyResources,
  token,
}: {
  serverUrl: string
  proxyRegion?: string
  customProxy?: string
  /** Cloud browser timeout in minutes (1-240, default 60) */
  timeout?: number
  /** Block images/video/fonts to save proxy bandwidth (default: true when proxy is enabled) */
  blockProxyResources?: boolean
  token?: string
}): Promise<{ id: string; liveUrl: string | null }> {
  const client = getCloudClient()
  if (!client) {
    throw new Error('Not logged in to cloud. Run `playwriter cloud login` first.')
  }

  const connectResult = await client.connect({
    proxyRegion,
    customProxy: customProxy ? parseCustomProxy(customProxy) : undefined,
    timeout,
  })

  if (!connectResult.cdpUrl) {
    throw new Error('Cloud browser returned no CDP URL. The VM may have failed to start.')
  }

  // Normalize https:// CDP URL to wss:// for the relay
  const cdpEndpoint = await resolveDirectInput(connectResult.cdpUrl)

  // Create a playwriter session via the relay using the CDP URL (same as --direct).
  // Also pass cloud metadata so the relay can track idle timeout and auto-disconnect.
  const auth = loadCloudAuth()!
  const cwd = process.cwd()
  let response: Response
  try {
    response = await fetch(`${serverUrl}/cli/session/new`, {
      method: 'POST',
      headers: buildAuthHeaders({ token, json: true }),
      body: JSON.stringify({
        cdpEndpoint,
        cwd,
        browser: 'Chromium (cloud)',
        cloud: {
          cloudSessionId: connectResult.cloudSessionId,
          cloudBaseUrl: auth.baseUrl,
          cloudToken: auth.token,
          timeoutAt: connectResult.timeoutAt,
          blockProxyResources,
        },
      }),
    })
  } catch (cause) {
    // Relay session creation failed — stop the cloud VM so we don't leak a paid resource
    await client.disconnect(connectResult.cloudSessionId).catch(() => {})
    throw new Error('Failed to create relay session', { cause })
  }

  if (!response.ok) {
    await client.disconnect(connectResult.cloudSessionId).catch(() => {})
    const text = await response.text()
    throw new Error(`${response.status} ${text}`)
  }
  const result = (await response.json()) as { id: string }

  return { id: result.id, liveUrl: connectResult.cdpUrl ? buildLiveUrl(connectResult.cdpUrl, auth.baseUrl) : null }
}

/** Reattach to an existing running cloud browser VM instead of creating a new one.
 *  Fetches the session's cdpUrl from the cloud API and creates a relay session. */
async function attachExistingCloudSession({
  serverUrl,
  cloudSessionId,
  blockProxyResources,
  token,
}: {
  serverUrl: string
  cloudSessionId: string
  blockProxyResources?: boolean
  token?: string
}): Promise<{ id: string; liveUrl: string | null }> {
  const client = getCloudClient()
  if (!client) {
    throw new Error('Not logged in to cloud. Run `playwriter cloud login` first.')
  }

  const session = await client.getSessionStatus(cloudSessionId)
  if (!session || session.status !== 'active') {
    throw new Error('Cloud session is no longer active. It may have timed out.')
  }
  if (!session.cdpUrl) {
    throw new Error('Cloud session has no CDP URL available.')
  }

  const cdpEndpoint = await resolveDirectInput(session.cdpUrl)
  const auth = loadCloudAuth()!
  const cwd = process.cwd()

  const response = await fetch(`${serverUrl}/cli/session/new`, {
    method: 'POST',
    headers: buildAuthHeaders({ token, json: true }),
    body: JSON.stringify({
      cdpEndpoint,
      cwd,
      browser: 'Chromium (cloud)',
      cloud: {
        cloudSessionId,
        cloudBaseUrl: auth.baseUrl,
        cloudToken: auth.token,
        timeoutAt: session.timeoutAt,
        blockProxyResources,
      },
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`${response.status} ${text}`)
  }
  const result = (await response.json()) as { id: string }

  return { id: result.id, liveUrl: session.cdpUrl ? buildLiveUrl(session.cdpUrl, auth.baseUrl) : null }
}

function printBrowserTable(options: BrowserOption[]): void {
  const typeLabels = options.map((opt) => {
    if (opt.type === 'direct') return '--direct'
    if (opt.type === 'cloud') return 'cloud'
    return opt.type
  })
  const keyWidth = Math.max(3, ...options.map((opt) => opt.key.length))
  const typeWidth = Math.max(4, ...typeLabels.map((t) => t.length))
  const browserWidth = Math.max(7, ...options.map((opt) => opt.browser.length))

  console.log(
    'KEY'.padEnd(keyWidth) + '  ' + 'TYPE'.padEnd(typeWidth) + '  ' + 'BROWSER'.padEnd(browserWidth) + '  ' + 'PROFILE',
  )
  console.log('-'.repeat(keyWidth + typeWidth + browserWidth + 20))
  for (let i = 0; i < options.length; i++) {
    const opt = options[i]
    console.log(
      opt.key.padEnd(keyWidth) +
        '  ' +
        typeLabels[i].padEnd(typeWidth) +
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
  .option('--token <token>', 'Authentication token (or use PLAYWRITER_TOKEN env var)')
  .action(async (options) => {
    if (!options.host && !process.env.PLAYWRITER_HOST) {
      await ensureRelayServer({ logger: console })
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
        headers: buildAuthHeaders({ token: options.token }),
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
  .option('--token <token>', 'Authentication token (or use PLAYWRITER_TOKEN env var)')
  .action(async (sessionId, options) => {
    const serverUrl = await getServerUrl(options.host)

    if (!options.host && !process.env.PLAYWRITER_HOST) {
      await ensureRelayServer({ logger: console })
    }

    try {
      const response = await fetch(`${serverUrl}/cli/session/delete`, {
        method: 'POST',
        headers: buildAuthHeaders({ token: options.token, json: true }),
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
  .option('--token <token>', 'Authentication token (or use PLAYWRITER_TOKEN env var)')
  .action(async (sessionId, options) => {
    const cwd = process.cwd()
    const serverUrl = await getServerUrl(options.host)

    if (!options.host && !process.env.PLAYWRITER_HOST) {
      await ensureRelayServer({ logger: console })
    }

    try {
      const response = await fetch(`${serverUrl}/cli/reset`, {
        method: 'POST',
        headers: buildAuthHeaders({ token: options.token, json: true }),
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

// ============================================================================
// Live RTMP streaming commands. These are sugar over the executor `stream`
// global (same execute path as -e), which resolves the session's current tab
// and calls the relay's /stream/* endpoints. ffmpeg runs inside the relay
// process, so the stream keeps running after the CLI exits.
// ============================================================================

cli
  .command('stream start', 'Stream the session tab live to RTMP destinations (X Live, Twitch, ...) via ffmpeg. Streams the current page - navigate first with -e "await page.goto(...)"')
  .option('--host <host>', 'Remote relay server host')
  .option('--token <token>', 'Authentication token (or use PLAYWRITER_TOKEN env var)')
  .option('-s, --session <id>', 'Session ID (get one with `playwriter session new`)')
  .option('--rtmp <url>', z.union([z.string(), z.array(z.string())]).describe('RTMP destination URL with stream key (repeatable for simultaneous multi-streaming)'))
  .option('--resolution <WxH>', z.string().default('1920x1080').describe('Output resolution (default is X Live recommended)'))
  .option('--fps <n>', z.number().default(30).describe('Output frame rate'))
  .option('--video-bitrate <kbps>', z.number().default(9000).describe('Video bitrate in kbps (default is X Live recommended; Twitch max 6000)'))
  .option('--audio-bitrate <kbps>', z.number().default(128).describe('Audio bitrate in kbps'))
  .option('--keyframe-interval <seconds>', z.number().default(3).describe('Keyframe interval in seconds (3 = X Live recommended, 2 = Twitch)'))
  .option('--no-audio', 'Do not capture tab audio (a silent track is injected, required by X Live)')
  .option('--preset <name>', z.string().default('veryfast').describe('x264 preset (only applies to libx264)'))
  .option('--codec <name>', 'Video codec for ffmpeg (default: auto-detect hardware encoder, falls back to libx264)')
  .action(async (options) => {
    const rtmpUrls: string[] = (() => {
      if (!options.rtmp) {
        return []
      }
      return Array.isArray(options.rtmp) ? options.rtmp : [options.rtmp]
    })()
    if (rtmpUrls.length === 0) {
      console.error('Error: at least one --rtmp destination is required.')
      console.error('Example: playwriter stream start -s 1 --rtmp rtmp://va.pscp.tv:80/x/<stream-key>')
      process.exit(1)
    }
    if (!/^\d+x\d+$/.test(options.resolution)) {
      console.error(`Error: invalid --resolution "${options.resolution}", expected WxH like 1920x1080`)
      process.exit(1)
    }

    const streamParams = {
      rtmpUrls,
      resolution: options.resolution,
      fps: options.fps,
      videoBitrateKbps: options.videoBitrate,
      audioBitrateKbps: options.audioBitrate,
      keyframeSeconds: options.keyframeInterval,
      audio: !options.noAudio,
      preset: options.preset,
      codec: options.codec,
    }

    // Run through the executor so the session's current tab is resolved and
    // ffmpeg is spawned inside the relay process (survives CLI exit).
    const code = [
      `const result = await stream.start(${JSON.stringify(streamParams)})`,
      `console.log('Streaming tab ' + result.tabId + ' to: ' + result.destinations.join(', '))`,
      `console.log('The stream runs until you call: playwriter stream stop -s <session>')`,
    ].join('\n')

    await executeCode({
      code,
      timeout: 60000,
      sessionId: options.session,
      host: options.host,
      token: options.token,
    })
  })

cli
  .command('stream stop', 'Stop the active stream for a session')
  .option('--host <host>', 'Remote relay server host')
  .option('--token <token>', 'Authentication token (or use PLAYWRITER_TOKEN env var)')
  .option('-s, --session <id>', 'Session ID')
  .action(async (options) => {
    const code = [
      `const result = await stream.stop()`,
      `console.log('Stream stopped after ' + Math.round(result.duration / 1000) + 's (' + result.bytesReceived + ' bytes captured)')`,
    ].join('\n')

    await executeCode({
      code,
      timeout: 60000,
      sessionId: options.session,
      host: options.host,
      token: options.token,
    })
  })

cli
  .command('stream status', 'Show stream health: uptime, encoder fps, bitrate, dropped frames')
  .option('--host <host>', 'Remote relay server host')
  .option('--token <token>', 'Authentication token (or use PLAYWRITER_TOKEN env var)')
  .option('-s, --session <id>', 'Session ID')
  .action(async (options) => {
    const code = [
      `const status = await stream.status()`,
      `if (!status.streaming) {`,
      `  console.log('Not streaming' + (status.error ? '. Last stream error: ' + status.error : ''))`,
      `} else {`,
      `  const uptime = Math.round((Date.now() - status.startedAt) / 1000)`,
      `  console.log('Streaming tab ' + status.tabId + ' to: ' + status.destinations.join(', '))`,
      `  console.log('Uptime: ' + uptime + 's, received: ' + status.stats.bytesReceived + ' bytes (' + status.stats.chunksReceived + ' chunks)')`,
      `  if (status.stats.ffmpegFps !== undefined) {`,
      `    console.log('Encoder: ' + status.stats.ffmpegFps + ' fps, ' + (status.stats.ffmpegBitrateKbps || '?') + ' kbps, dropped: ' + (status.stats.droppedFrames ?? 0))`,
      `  }`,
      `}`,
    ].join('\n')

    await executeCode({
      code,
      timeout: 15000,
      sessionId: options.session,
      host: options.host,
      token: options.token,
    })
  })

cli
  .command(
    'serve',
    `Start the relay server on this machine (must be the same host where Chrome is running). Remote clients (Docker, other machines) connect via PLAYWRITER_HOST. Use --host localhost for Docker (no token needed) — containers reach it via host.docker.internal. Use --host 0.0.0.0 for LAN/internet access (requires --token).`,
  )
  .option('--host [host]', z.string().default('0.0.0.0').describe('Host to bind to (use "localhost" for Docker, "0.0.0.0" for remote access)'))
  .option('--token <token>', 'Authentication token, required when --host is 0.0.0.0 (or use PLAYWRITER_TOKEN env var)')
  .option('--replace', 'Kill existing server if running')
  .action(async (options) => {
    const token = options.token || process.env.PLAYWRITER_TOKEN
    const isPublicHost = options.host === '0.0.0.0' || options.host === '::'
    if (isPublicHost && !token) {
      console.error('Error: Authentication token is required when binding to a public host.')
      console.error('Provide --token <token> or set PLAYWRITER_TOKEN environment variable.')
      process.exit(1)
    }

    // Expose the token to in-process callers (screen-recording.ts, etc.) so
    // they can attach Authorization: Bearer ... when calling the relay's own
    // privileged endpoints. Required because we no longer bypass auth for
    // loopback — see commit history for the tunnel-agent threat model.
    if (token) {
      process.env.PLAYWRITER_TOKEN = token
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
  .command('browser list', 'List all available browsers: extension-connected and direct CDP on port 9222')
  .option('--host <host>', z.string().describe('Remote relay server host'))
  .option('--token <token>', 'Authentication token (or use PLAYWRITER_TOKEN env var)')
  .action(async (options) => {
    const isLocal = !options.host && !process.env.PLAYWRITER_HOST

    // Start relay if local so the extension can connect, then fetch in parallel
    if (isLocal) {
      await ensureRelayServer({ logger: console })
    }

    const [extensions, directInstances] = await Promise.all([
      isLocal
        ? waitForConnectedExtensions({ timeoutMs: 2000, pollIntervalMs: 200, logger: console })
        : fetchExtensionsStatus({ host: options.host, token: options.token }),
      isLocal ? discoverChromeInstances() : Promise.resolve([] as DiscoveredInstance[]),
    ])

    const cloudOptions = await discoverCloudBrowsers()

    // Check if a Chrome binary is available for headless mode
    const headlessOption: BrowserOption[] = await (async () => {
      try {
        const { resolveBrowserExecutablePath } = await import('./browser-config.js')
        resolveBrowserExecutablePath()
        return [{
          key: 'headless',
          type: 'headless' as const,
          browser: 'Chrome (Headless)',
          profile: '-',
        }]
      } catch {
        return []
      }
    })()

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
      ...directInstances.map(instanceToBrowserOption),
      ...headlessOption,
      ...cloudOptions,
    ]

    if (allOptions.length === 0) {
      console.log('No browsers detected.\n')
      console.log('  Extension: click the Playwriter icon on a tab to connect')
      console.log('  Direct:    open chrome://inspect/#remote-debugging in Chrome')
      console.log('  Headless:  run `playwriter browser install` then `--browser headless`')
      console.log('  Cloud:     run `playwriter cloud login` to connect cloud browsers')
      return
    }

    printBrowserTable(allOptions)
    console.log('')

    const hasDirectInstances = allOptions.some((opt) => {
      return opt.type === 'direct'
    })
    if (hasDirectInstances) {
      console.log(pc.dim('Connect with: playwriter session new --direct'))
      console.log(pc.dim('Chrome may ask to approve the debugging connection.'))
    } else {
      console.log(pc.dim('Use with: playwriter session new [--browser <key>]'))
    }

    const hasCloud = allOptions.some((opt) => {
      return opt.type === 'cloud'
    })
    if (!hasCloud) {
      printCloudTip()
    }
  })

// ── Cloud commands ──────────────────────────────────────────────────

cli
  .command('cloud login', 'Authenticate with playwriter.dev to use cloud browsers')
  .option('--base-url <url>', 'Website base URL (default: https://playwriter.dev)')
  .action(async (options, ctx) => {
    const baseUrl = options.baseUrl || ctx.process.env.PLAYWRITER_CLOUD_URL || 'https://playwriter.dev'

    // Use the better-auth client SDK so we don't hardcode endpoint URLs.
    // Hardcoded URLs broke before when better-auth changed paths between versions.
    const { createAuthClient } = await import('better-auth/client')
    const { deviceAuthorizationClient } = await import('better-auth/client/plugins')
    const client = createAuthClient({
      baseURL: baseUrl,
      plugins: [deviceAuthorizationClient()],
    })

    if (ctx.daemon.isDaemon) {
      // ── DAEMON: poll until user approves in browser ──
      // Logs are visible to the parent when started with attach: true.
      const deviceCode = ctx.process.env.PLAYWRITER_DEVICE_CODE!
      const pollInterval = Number(ctx.process.env.PLAYWRITER_POLL_INTERVAL || 5) * 1000
      const expiresIn = Number(ctx.process.env.PLAYWRITER_DEVICE_EXPIRES_IN || 300)
      const deadline = Date.now() + expiresIn * 1000

      while (Date.now() < deadline) {
        await new Promise((r) => { setTimeout(r, pollInterval) })
        const { data: tokenData, error: pollError } = await client.device.token({
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: deviceCode,
          client_id: 'playwriter-cli',
        })
        if (tokenData?.access_token) {
          saveCloudAuth({ token: tokenData.access_token, baseUrl })
          return // daemon exits, PID file is cleaned up
        }
        if (pollError?.error === 'authorization_pending' || pollError?.error === 'slow_down') continue
        if (pollError) {
          ctx.console.error(`Device authorization failed: ${pollError.error_description || pollError.error}`)
          ctx.process.exit(1)
          return
        }
      }
      ctx.console.error('Device authorization timed out.')
      ctx.process.exit(1)
      return
    }

    // ── FOREGROUND CLIENT ──
    ctx.console.log('Requesting device authorization...')
    const { data: deviceData, error: requestError } = await client.device.code({
      client_id: 'playwriter-cli',
    })
    if (requestError || !deviceData) {
      ctx.console.error(`Error: failed to request device code — ${requestError?.error_description || requestError?.error || 'unknown error'}`)
      ctx.process.exit(1)
      return
    }

    const verificationUrl = deviceData.verification_uri_complete || `${baseUrl}/device?user_code=${deviceData.user_code}`
    ctx.console.log(`\nOpen this URL in your browser:\n  ${verificationUrl}\n`)
    ctx.console.log(`Code: ${deviceData.user_code}\n`)

    await openInBrowser(verificationUrl)

    const expiresIn = deviceData.expires_in || 300
    const daemonEnv = {
      PLAYWRITER_DEVICE_CODE: deviceData.device_code,
      PLAYWRITER_POLL_INTERVAL: String(deviceData.interval || 5),
      PLAYWRITER_DEVICE_EXPIRES_IN: String(expiresIn),
      PLAYWRITER_CLOUD_URL: baseUrl,
    }
    const timeoutMs = expiresIn * 1000

    if (isAgent) {
      // Agent: start daemon detached, return immediately
      await ctx.daemon.start({ timeoutMs, env: daemonEnv })
      ctx.console.log('Login running in background.')
      ctx.console.log('After approving in browser, verify with: playwriter cloud me')
      return
    }

    // Interactive: attach to daemon, see real-time logs and errors
    ctx.console.log('Waiting for approval...')
    await ctx.daemon.start({ attach: true, timeoutMs, env: daemonEnv })
    ctx.console.log(pc.green('\nLogged in successfully!'))
    ctx.console.log('Cloud browsers will now appear in `playwriter session new`.')
  })

cli
  .command('cloud me', 'Check cloud auth status (exits 1 if not logged in)')
  .action(async (_options, ctx) => {
    const auth = loadCloudAuth()
    if (auth) {
      ctx.console.log('Authenticated')
      ctx.console.log(`Cloud URL: ${auth.baseUrl}`)
      return
    }

    // Check if login daemon is still running (user might not have approved yet)
    const loginDaemon = ctx.daemon.forCommand('cloud login')
    if (await loginDaemon.isRunning()) {
      ctx.console.error('Login in progress. Approve in browser first.')
      ctx.process.exit(1)
    }

    ctx.console.error('Not logged in. Run `playwriter cloud login` first.')
    ctx.process.exit(1)
  })

cli
  .command('cloud logout', 'Clear cloud auth')
  .action(async (_options, ctx) => {
    // Stop any running login daemon
    const loginDaemon = ctx.daemon.forCommand('cloud login')
    await loginDaemon.stop()

    // Remove the auth file
    try {
      const authFile = path.join(os.homedir(), '.playwriter', 'auth.json')
      fs.unlinkSync(authFile)
    } catch {
      // already gone
    }

    ctx.console.log('Logged out from cloud')
  })

cli
  .command('cloud subscribe', 'Open the subscription page to purchase cloud browser sessions')
  .action(async () => {
    const auth = loadCloudAuth()
    if (!auth) {
      console.error('Not logged in. Run `playwriter cloud login` first.')
      process.exit(1)
    }
    const subscribeUrl = new URL('/dashboard', auth.baseUrl).toString()
    console.log(`Open your browser to manage your subscription:\n  ${subscribeUrl}\n`)
    await openInBrowser(subscribeUrl)
  })

cli
  .command('cloud status', 'Show active cloud browser sessions')
  .action(async () => {
    const client = getCloudClient()
    if (!client) {
      console.error('Not logged in. Run `playwriter cloud login` first.')
      process.exit(1)
    }

    try {
      const { sessions } = await client.getStatus()

      if (sessions.length === 0) {
        console.log('No active cloud sessions.')
        console.log(pc.dim('Start one with: playwriter session new --browser cloud'))
        return
      }

      const keyWidth = Math.max(3, ...sessions.map((s) => `cloud-${s.index}`.length))
      console.log('KEY'.padEnd(keyWidth) + '  ' + 'STATUS'.padEnd(10) + '  ' + 'DETAILS')
      console.log('-'.repeat(keyWidth + 30))

      for (const s of sessions) {
        const key = `cloud-${s.index}`
        const timeoutAt = new Date(s.timeoutAt).toLocaleTimeString()
        console.log(
          key.padEnd(keyWidth) +
            '  ' +
            pc.green('running'.padEnd(10)) +
            '  ' +
            `expires ${timeoutAt}`,
        )
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error(`Error: ${msg}`)
      process.exit(1)
    }
  })

cli
  .command('cloud live [key]', 'Open a live browser view for an active cloud session')
  .action(async (key) => {
    const client = getCloudClient()
    if (!client) {
      console.error('Not logged in. Run `playwriter cloud login` first.')
      process.exit(1)
    }

    try {
      const { sessions } = await client.getStatus()
      if (sessions.length === 0) {
        console.log('No active cloud sessions.')
        console.log(pc.dim('Start one with: playwriter session new --browser cloud'))
        process.exit(1)
      }

      let session: (typeof sessions)[number] | undefined
      if (key) {
        // Match by cloud-N key or by cloudSessionId
        session = sessions.find((s) => {
          return `cloud-${s.index}` === key || s.cloudSessionId === key || s.browserUseSessionId === key
        })
        if (!session) {
          console.error(`No active session matching "${key}".`)
          console.error('Active sessions: ' + sessions.map((s) => { return `cloud-${s.index}` }).join(', '))
          process.exit(1)
        }
      } else if (sessions.length === 1) {
        session = sessions[0]!
      } else {
        console.log('Multiple active sessions. Specify one:\n')
        for (const s of sessions) {
          console.log(`  cloud-${s.index}  (expires ${new Date(s.timeoutAt).toLocaleTimeString()})`)
        }
        console.log(`\nUsage: playwriter cloud live cloud-1`)
        process.exit(1)
      }

      if (!session.cdpUrl) {
        console.error('Session has no CDP URL — it may still be starting.')
        process.exit(1)
      }
      const auth = loadCloudAuth()!
      const liveUrl = buildLiveUrl(session.cdpUrl, auth.baseUrl)
      console.log(liveUrl)
      await openInBrowser(liveUrl)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error(`Error: ${msg}`)
      process.exit(1)
    }
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
cli.completions()
cli.version(VERSION)

await cli.parse()
