import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { Page, Browser, BrowserContext, chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import dedent from 'string-dedent'
import { createPatch } from 'diff'
import { getCdpUrl, LOG_FILE_PATH, VERSION, sleep } from './utils.js'
import { killPortProcess } from 'kill-port-process'
import { waitForPageLoad, WaitForPageLoadOptions, WaitForPageLoadResult } from './wait-for-page-load.js'
import { getCDPSessionForPage, CDPSession } from './cdp-session.js'
import { Debugger } from './debugger.js'
import { Editor } from './editor.js'

class CodeExecutionTimeoutError extends Error {
  constructor(timeout: number) {
    super(`Code execution timed out after ${timeout}ms`)
    this.name = 'CodeExecutionTimeoutError'
  }
}

const require = createRequire(import.meta.url)

const usefulGlobals = {
  setTimeout,
  setInterval,
  clearTimeout,
  clearInterval,
  URL,
  URLSearchParams,
  fetch,
  Buffer,
  TextEncoder,
  TextDecoder,
  crypto,
  AbortController,
  AbortSignal,
  structuredClone,
} as const

interface State {
  isConnected: boolean
  page: Page | null
  browser: Browser | null
  context: BrowserContext | null
}

interface VMContext {
  page: Page
  context: BrowserContext
  state: Record<string, any>
  console: {
    log: (...args: any[]) => void
    info: (...args: any[]) => void
    warn: (...args: any[]) => void
    error: (...args: any[]) => void
    debug: (...args: any[]) => void
  }
  accessibilitySnapshot: (options: {
    page: Page
    search?: string | RegExp
    contextLines?: number
    showDiffSinceLastCall?: boolean
  }) => Promise<string>
  getLocatorStringForElement: (element: any) => Promise<string>
  resetPlaywright: () => Promise<{ page: Page; context: BrowserContext }>
  getLatestLogs: (options?: { page?: Page; count?: number; search?: string | RegExp }) => Promise<string[]>
  clearAllLogs: () => void
  waitForPageLoad: (options: WaitForPageLoadOptions) => Promise<WaitForPageLoadResult>
  getCDPSession: (options: { page: Page }) => Promise<CDPSession>
  createDebugger: (options: { cdp: CDPSession }) => Debugger
  createEditor: (options: { cdp: CDPSession }) => Editor
  require: NodeRequire
  import: (specifier: string) => Promise<any>
}

type VMContextWithGlobals = VMContext & typeof usefulGlobals

type SelectorGenerator = typeof import('@mizchi/selector-generator')

const state: State = {
  isConnected: false,
  page: null,
  browser: null,
  context: null,
}

const userState: Record<string, any> = {}

// Store logs per page targetId
const browserLogs: Map<string, string[]> = new Map()
const MAX_LOGS_PER_PAGE = 5000

// Store last accessibility snapshot per page for diff feature
const lastSnapshots: WeakMap<Page, string> = new WeakMap()

// Cache CDP sessions per page
const cdpSessionCache: WeakMap<Page, CDPSession> = new WeakMap()

const RELAY_PORT = Number(process.env.PLAYWRITER_PORT) || 19988
const NO_TABS_ERROR = `No browser tabs are connected. Please install and enable the Playwriter extension on at least one tab: https://chromewebstore.google.com/detail/playwriter-mcp/jfeammnjpkecdekppnclgkkffahnhfhe`

async function setDeviceScaleFactorForMacOS(context: BrowserContext): Promise<void> {
  if (os.platform() !== 'darwin') {
    return
  }
  const options = (context as any)._options
  if (!options || options.deviceScaleFactor === 2) {
    return
  }
  options.deviceScaleFactor = 2
}

async function preserveSystemColorScheme(context: BrowserContext): Promise<void> {
  const options = (context as any)._options
  if (!options) {
    return
  }
  options.colorScheme = 'no-override'
  options.reducedMotion = 'no-override'
  options.forcedColors = 'no-override'
}

function isRegExp(value: any): value is RegExp {
  return (
    typeof value === 'object' && value !== null && typeof value.test === 'function' && typeof value.exec === 'function'
  )
}

function clearUserState() {
  Object.keys(userState).forEach((key) => delete userState[key])
}

function clearConnectionState() {
  state.isConnected = false
  state.browser = null
  state.page = null
  state.context = null
}

async function sendLogToRelayServer(level: string, ...args: any[]) {
  try {
    await fetch(`http://127.0.0.1:${RELAY_PORT}/mcp-log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level, args }),
      signal: AbortSignal.timeout(1000),
    })
  } catch {
    // Silently fail if relay server is not available
  }
}

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
  } catch (error) {
    return null
  }
}

async function killRelayServer(port: number): Promise<void> {
  try {
    await killPortProcess(port)
    await sleep(500)
  } catch {}
}

async function ensureRelayServer(): Promise<void> {
  const serverVersion = await getServerVersion(RELAY_PORT)

  if (serverVersion === VERSION) {
    return
  }

  if (serverVersion !== null) {
    console.error(`CDP relay server version mismatch (server: ${serverVersion}, mcp: ${VERSION}), restarting...`)
    await killRelayServer(RELAY_PORT)
  } else {
    console.error('CDP relay server not running, starting it...')
  }

  const scriptPath = require.resolve('../dist/start-relay-server.js')

  const serverProcess = spawn(process.execPath, [scriptPath], {
    detached: true,
    stdio: 'ignore',
  })

  serverProcess.unref()

  for (let i = 0; i < 10; i++) {
    await sleep(500)
    const newVersion = await getServerVersion(RELAY_PORT)
    if (newVersion === VERSION) {
      console.error('CDP relay server started successfully, waiting for extension to connect...')
      await sleep(1000)
      return
    }
  }

  throw new Error(`Failed to start CDP relay server after 5 seconds. Check logs at: ${LOG_FILE_PATH}`)
}

async function ensureConnection(): Promise<{ browser: Browser; page: Page }> {
  if (state.isConnected && state.browser && state.page) {
    return { browser: state.browser, page: state.page }
  }

  await ensureRelayServer()

  const cdpEndpoint = getCdpUrl({ port: RELAY_PORT })
  const browser = await chromium.connectOverCDP(cdpEndpoint)

  const contexts = browser.contexts()
  const context = contexts.length > 0 ? contexts[0] : await browser.newContext()

  // Set up console listener for all future pages
  context.on('page', (page) => {
    setupPageConsoleListener(page)
  })

  const pages = context.pages()
  if (pages.length === 0) {
    throw new Error(NO_TABS_ERROR)
  }
  const page = pages[0]

  // Set up console listener for all existing pages
  context.pages().forEach((p) => setupPageConsoleListener(p))

  // These functions only set context-level options, they do NOT send CDP commands to pages.
  // Sending CDP commands (like Emulation.setEmulatedMedia or setDeviceMetricsOverride) to pages
  // immediately after connectOverCDP causes pages to render white/blank with about:blank URLs,
  // because pages may not be fully initialized yet. Playwright applies these settings lazily.
  await preserveSystemColorScheme(context)
  await setDeviceScaleFactorForMacOS(context)

  state.browser = browser
  state.page = page
  state.context = context
  state.isConnected = true

  return { browser, page }
}

async function getPageTargetId(page: Page): Promise<string> {
  if (!page) {
    throw new Error('Page is null or undefined')
  }

  const guid = (page as any)._guid
  if (guid) {
    return guid
  }

  throw new Error('Could not get page identifier: _guid not available')
}

function setupPageConsoleListener(page: Page) {
  // Get targetId synchronously using _guid
  const targetId = (page as any)._guid as string | undefined

  if (!targetId) {
    // If no _guid, silently fail - this shouldn't happen in normal operation
    return
  }

  // Initialize logs array for this page
  if (!browserLogs.has(targetId)) {
    browserLogs.set(targetId, [])
  }

  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      browserLogs.set(targetId, [])
    }
  })

  page.on('close', () => {
    browserLogs.delete(targetId)
  })

  page.on('console', (msg) => {
    try {
      let logEntry = `[${msg.type()}] ${msg.text()}`

      if (!browserLogs.has(targetId)) {
        browserLogs.set(targetId, [])
      }
      const pageLogs = browserLogs.get(targetId)!

      pageLogs.push(logEntry)
      if (pageLogs.length > MAX_LOGS_PER_PAGE) {
        pageLogs.shift()
      }
    } catch (e) {
      console.error('[MCP] Failed to get console message text:', e)
      return
    }
  })
}

async function getCurrentPage(timeout = 5000) {
  if (state.page) {
    return state.page
  }

  if (state.browser) {
    const contexts = state.browser.contexts()
    if (contexts.length > 0) {
      const pages = contexts[0].pages()

      if (pages.length > 0) {
        const page = pages[0]
        await page.waitForLoadState('load', { timeout }).catch(() => {})
        return page
      }
    }
  }

  throw new Error(NO_TABS_ERROR)
}

async function resetConnection(): Promise<{ browser: Browser; page: Page; context: BrowserContext }> {
  if (state.browser) {
    try {
      await state.browser.close()
    } catch (e) {
      console.error('Error closing browser:', e)
    }
  }

  clearConnectionState()
  clearUserState()

  // DO NOT clear browser logs on reset - logs should persist across reconnections
  // browserLogs.clear()

  await ensureRelayServer()

  const cdpEndpoint = getCdpUrl({ port: RELAY_PORT })
  const browser = await chromium.connectOverCDP(cdpEndpoint)

  const contexts = browser.contexts()
  const context = contexts.length > 0 ? contexts[0] : await browser.newContext()

  // Set up console listener for all future pages
  context.on('page', (page) => {
    setupPageConsoleListener(page)
  })

  const pages = context.pages()
  if (pages.length === 0) {
    throw new Error(NO_TABS_ERROR)
  }
  const page = pages[0]

  // Set up console listener for all existing pages
  context.pages().forEach((p) => setupPageConsoleListener(p))

  await preserveSystemColorScheme(context)
  await setDeviceScaleFactorForMacOS(context)

  state.browser = browser
  state.page = page
  state.context = context
  state.isConnected = true

  return { browser, page, context }
}

const server = new McpServer({
  name: 'playwriter',
  title: 'The better playwright MCP: works as a browser extension. No context bloat. More capable.',
  version: '1.0.0',
})

const promptContent =
  fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'prompt.md'), 'utf-8') +
  `\n\nfor debugging internal playwriter errors, check playwriter relay server logs at: ${LOG_FILE_PATH}`

server.resource('debugger-api', 'playwriter://debugger-api', { mimeType: 'text/plain' }, async () => {
  const packageJsonPath = require.resolve('playwriter/package.json')
  const distDir = path.join(path.dirname(packageJsonPath), 'dist')

  const debuggerTypes = fs
    .readFileSync(path.join(distDir, 'debugger.d.ts'), 'utf-8')
    .replace(/\/\/# sourceMappingURL=.*$/gm, '')
    .trim()
  const debuggerExamples = fs.readFileSync(path.join(distDir, 'debugger-examples.ts'), 'utf-8')

  return {
    contents: [
      {
        uri: 'playwriter://debugger-api',
        text: dedent`
          # Debugger API Reference

          ## Types

          \`\`\`ts
          ${debuggerTypes}
          \`\`\`

          ## Examples

          \`\`\`ts
          ${debuggerExamples}
          \`\`\`
        `,
        mimeType: 'text/plain',
      },
    ],
  }
})

server.resource('editor-api', 'playwriter://editor-api', { mimeType: 'text/plain' }, async () => {
  const packageJsonPath = require.resolve('playwriter/package.json')
  const distDir = path.join(path.dirname(packageJsonPath), 'dist')

  const editorTypes = fs
    .readFileSync(path.join(distDir, 'editor.d.ts'), 'utf-8')
    .replace(/\/\/# sourceMappingURL=.*$/gm, '')
    .trim()
  const editorExamples = fs.readFileSync(path.join(distDir, 'editor-examples.ts'), 'utf-8')

  return {
    contents: [
      {
        uri: 'playwriter://editor-api',
        text: dedent`
          # Editor API Reference

          The Editor class provides a Claude Code-like interface for viewing and editing web page scripts at runtime.

          ## Types

          \`\`\`ts
          ${editorTypes}
          \`\`\`

          ## Examples

          \`\`\`ts
          ${editorExamples}
          \`\`\`
        `,
        mimeType: 'text/plain',
      },
    ],
  }
})

server.tool(
  'execute',
  promptContent,
  {
    code: z
      .string()
      .describe(
        'js playwright code, has {page, state, context} in scope. Should be one line, using ; to execute multiple statements. you MUST call execute multiple times instead of writing complex scripts in a single tool call.',
      ),
    timeout: z.number().default(5000).describe('Timeout in milliseconds for code execution (default: 5000ms)'),
  },
  async ({ code, timeout }) => {
    const consoleLogs: Array<{ method: string; args: any[] }> = []

    const formatConsoleLogs = (logs: Array<{ method: string; args: any[] }>, prefix = 'Console output') => {
      if (logs.length === 0) {
        return ''
      }

      let text = `${prefix}:\n`
      logs.forEach(({ method, args }) => {
        const formattedArgs = args
          .map((arg) => {
            if (typeof arg === 'object') {
              return JSON.stringify(arg, null, 2)
            }
            return String(arg)
          })
          .join(' ')
        text += `[${method}] ${formattedArgs}\n`
      })
      return text + '\n'
    }

    try {
      await ensureRelayServer()
      await ensureConnection()

      const page = await getCurrentPage(timeout)
      const context = state.context || page.context()

      console.error('Executing code:', code)

      const customConsole = {
        log: (...args: any[]) => {
          consoleLogs.push({ method: 'log', args })
        },
        info: (...args: any[]) => {
          consoleLogs.push({ method: 'info', args })
        },
        warn: (...args: any[]) => {
          consoleLogs.push({ method: 'warn', args })
        },
        error: (...args: any[]) => {
          consoleLogs.push({ method: 'error', args })
        },
        debug: (...args: any[]) => {
          consoleLogs.push({ method: 'debug', args })
        },
      }

      const accessibilitySnapshot = async (options: {
        page: Page
        search?: string | RegExp
        contextLines?: number
        showDiffSinceLastCall?: boolean
      }) => {
        const { page: targetPage, search, contextLines = 10, showDiffSinceLastCall = false } = options
        if ((targetPage as any)._snapshotForAI) {
          const snapshot = await (targetPage as any)._snapshotForAI()
          const snapshotStr = typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot, null, 2)

          if (showDiffSinceLastCall) {
            const previousSnapshot = lastSnapshots.get(targetPage)

            if (!previousSnapshot) {
              lastSnapshots.set(targetPage, snapshotStr)
              return 'No previous snapshot available. This is the first call for this page. Full snapshot stored for next diff.'
            }

            const patch = createPatch('snapshot', previousSnapshot, snapshotStr, 'previous', 'current', {
              context: contextLines,
            })
            if (patch.split('\n').length <= 4) {
              return 'No changes detected since last snapshot'
            }
            return patch
          }

          lastSnapshots.set(targetPage, snapshotStr)

          if (!search) {
            return snapshotStr
          }

          const lines = snapshotStr.split('\n')
          const matches: { line: string; index: number }[] = []

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i]
            let isMatch = false
            if (isRegExp(search)) {
              isMatch = search.test(line)
            } else {
              isMatch = line.includes(search)
            }

            if (isMatch) {
              matches.push({ line, index: i })
              if (matches.length >= 10) break
            }
          }

          if (matches.length === 0) {
            return 'No matches found'
          }

          return matches
            .map((m) => {
              const start = Math.max(0, m.index - contextLines)
              const end = Math.min(lines.length, m.index + contextLines + 1)
              return lines.slice(start, end).join('\n')
            })
            .join('\n\n---\n\n')
        }
        throw new Error('accessibilitySnapshot is not available on this page')
      }

      const getLocatorStringForElement = async (element: any) => {
        if (!element || typeof element.evaluate !== 'function') {
          throw new Error('getLocatorStringForElement: argument must be a Playwright Locator or ElementHandle')
        }

        const elementPage = element.page ? element.page() : page
        const hasGenerator = await elementPage.evaluate(() => !!(globalThis as any).__selectorGenerator)

        if (!hasGenerator) {
          const currentDir = path.dirname(fileURLToPath(import.meta.url))
          const scriptPath = path.join(currentDir, '..', 'dist', 'selector-generator.js')
          const scriptContent = fs.readFileSync(scriptPath, 'utf-8')
          await elementPage.addScriptTag({ content: scriptContent })
        }

        return await element.evaluate((el: any) => {
          const { createSelectorGenerator, toLocator } = (globalThis as any).__selectorGenerator
          const generator = createSelectorGenerator(globalThis)
          const result = generator(el)
          return toLocator(result.selector, 'javascript')
        })
      }

      const getLatestLogs = async (options?: { page?: Page; count?: number; search?: string | RegExp }) => {
        const { page: filterPage, count, search } = options || {}

        let allLogs: string[] = []

        if (filterPage) {
          const targetId = await getPageTargetId(filterPage)
          const pageLogs = browserLogs.get(targetId) || []
          allLogs = [...pageLogs]
        } else {
          for (const pageLogs of browserLogs.values()) {
            allLogs.push(...pageLogs)
          }
        }

        if (search) {
          allLogs = allLogs.filter((log) => {
            if (typeof search === 'string') {
              return log.includes(search)
            } else if (isRegExp(search)) {
              return search.test(log)
            }
            return false
          })
        }

        return count !== undefined ? allLogs.slice(-count) : allLogs
      }

      const clearAllLogs = () => {
        browserLogs.clear()
      }

      const getCDPSession = async (options: { page: Page }) => {
        const cached = cdpSessionCache.get(options.page)
        if (cached) {
          return cached
        }
        const wsUrl = getCdpUrl({ port: RELAY_PORT })
        const session = await getCDPSessionForPage({ page: options.page, wsUrl })
        cdpSessionCache.set(options.page, session)
        return session
      }

      const createDebugger = (options: { cdp: CDPSession }) => {
        return new Debugger(options)
      }

      const createEditor = (options: { cdp: CDPSession }) => {
        return new Editor(options)
      }

      let vmContextObj: VMContextWithGlobals = {
        page,
        context,
        state: userState,
        console: customConsole,
        accessibilitySnapshot,
        getLocatorStringForElement,
        getLatestLogs,
        clearAllLogs,
        waitForPageLoad,
        getCDPSession,
        createDebugger,
        createEditor,
        resetPlaywright: async () => {
          const { page: newPage, context: newContext } = await resetConnection()

          const resetObj: VMContextWithGlobals = {
            page: newPage,
            context: newContext,
            state: userState,
            console: customConsole,
            accessibilitySnapshot,
            getLocatorStringForElement,
            getLatestLogs,
            clearAllLogs,
            waitForPageLoad,
            getCDPSession,
            createDebugger,
            createEditor,
            resetPlaywright: vmContextObj.resetPlaywright,
            require,
            // TODO --experimental-vm-modules is needed to make import work in vm
            import: vmContextObj.import,
            ...usefulGlobals,
          }
          Object.keys(vmContextObj).forEach((key) => delete (vmContextObj as any)[key])
          Object.assign(vmContextObj, resetObj)
          return { page: newPage, context: newContext }
        },
        require,
        import: (specifier: string) => import(specifier),
        ...usefulGlobals,
      }

      const vmContext = vm.createContext(vmContextObj)

      const wrappedCode = `(async () => { ${code} })()`

      const result = await Promise.race([
        vm.runInContext(wrappedCode, vmContext, {
          timeout,
          displayErrors: true,
        }),
        new Promise((_, reject) => setTimeout(() => reject(new CodeExecutionTimeoutError(timeout)), timeout)),
      ])

      let responseText = formatConsoleLogs(consoleLogs)

      if (result !== undefined) {
        responseText += 'Return value:\n'
        if (typeof result === 'string') {
          responseText += result
        } else {
          responseText += JSON.stringify(result, null, 2)
        }
      } else if (consoleLogs.length === 0) {
        responseText += 'Code executed successfully (no output)'
      }

      const MAX_LENGTH = 6000
      let finalText = responseText.trim()
      if (finalText.length > MAX_LENGTH) {
        finalText =
          finalText.slice(0, MAX_LENGTH) +
          `\n\n[Truncated to ${MAX_LENGTH} characters. Better manage your logs or paginate them to read the full logs]`
      }

      return {
        content: [
          {
            type: 'text',
            text: finalText,
          },
        ],
      }
    } catch (error: any) {
      const errorStack = error.stack || error.message
      console.error('Error in execute tool:', errorStack)

      const logsText = formatConsoleLogs(consoleLogs, 'Console output (before error)')

      const isTimeoutError = error instanceof CodeExecutionTimeoutError || error.name === 'TimeoutError'
      if (!isTimeoutError) {
        sendLogToRelayServer('error', '[MCP] Error:', errorStack)
      }

      const resetHint = isTimeoutError
        ? ''
        : '\n\n[HINT: If this is an internal Playwright error, page/browser closed, or connection issue, call the `reset` tool to reconnect. Do NOT reset for other non-connection non-internal errors.]'

      return {
        content: [
          {
            type: 'text',
            text: `${logsText}\nError executing code: ${error.message}\n${errorStack}${resetHint}`,
          },
        ],
        isError: true,
      }
    }
  },
)

server.tool(
  'reset',
  dedent`
    Recreates the CDP connection and resets the browser/page/context. Use this when the MCP stops responding, you get connection errors, assertion failures, page closed, or timeout issues.

    After calling this tool, the page and context variables are automatically updated in the execution environment.

    IMPORTANT: this completely resets the execution context, removing any custom properties you may have added to the global scope AND clearing all keys from the \`state\` object. Only \`page\`, \`context\`, \`state\` (empty), \`console\`, and utility functions will remain.
  `,
  {},
  async () => {
    try {
      const { page, context } = await resetConnection()
      const pagesCount = context.pages().length
      return {
        content: [
          {
            type: 'text',
            text: `Connection reset successfully. ${pagesCount} page(s) available. Current page URL: ${page.url()}`,
          },
        ],
      }
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to reset connection: ${error.message}`,
          },
        ],
        isError: true,
      }
    }
  },
)

async function main() {
  await ensureRelayServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((error) => {
  console.error('Fatal error starting MCP server:', error)
  process.exit(1)
})
