/**
 * PlaywrightExecutor - Manages browser connection and code execution per session.
 * Used by both MCP and CLI to execute Playwright code with persistent state.
 */

import { Page, Browser, BrowserContext, chromium } from 'playwright-core'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import util from 'node:util'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { createPatch } from 'diff'
import { getCdpUrl } from './utils.js'
import { waitForPageLoad, WaitForPageLoadOptions, WaitForPageLoadResult } from './wait-for-page-load.js'
import { getCDPSessionForPage, CDPSession, ICDPSession } from './cdp-session.js'
import { Debugger } from './debugger.js'
import { Editor } from './editor.js'
import { getStylesForLocator, formatStylesAsText, type StylesResult } from './styles.js'
import { getReactSource, type ReactSourceLocation } from './react-source.js'
import { ScopedFS } from './scoped-fs.js'
import { screenshotWithAccessibilityLabels, formatSnapshot, DEFAULT_SNAPSHOT_FORMAT, type ScreenshotResult, type SnapshotFormat } from './aria-snapshot.js'
export type { SnapshotFormat }
import { getCleanHTML, type GetCleanHTMLOptions } from './clean-html.js'
import { startRecording, stopRecording, isRecording, cancelRecording } from './screen-recording.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const require = createRequire(import.meta.url)

export class CodeExecutionTimeoutError extends Error {
  constructor(timeout: number) {
    super(`Code execution timed out after ${timeout}ms`)
    this.name = 'CodeExecutionTimeoutError'
  }
}

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

const EXTENSION_NOT_CONNECTED_ERROR = `The Playwriter Chrome extension is not connected. Make sure you have:
1. Installed the extension: https://chromewebstore.google.com/detail/playwriter-mcp/jfeammnjpkecdekppnclgkkffahnhfhe
2. Clicked the extension icon on a tab to enable it (or refreshed the page if just installed)`

const NO_PAGES_AVAILABLE_ERROR =
  'No Playwright pages are available. Enable Playwriter on a tab or set PLAYWRITER_AUTO_ENABLE=1 to auto-create one.'

const MAX_LOGS_PER_PAGE = 5000

const ALLOWED_MODULES = new Set([
  'path', 'node:path',
  'url', 'node:url',
  'querystring', 'node:querystring',
  'punycode', 'node:punycode',
  'crypto', 'node:crypto',
  'buffer', 'node:buffer',
  'string_decoder', 'node:string_decoder',
  'util', 'node:util',
  'assert', 'node:assert',
  'events', 'node:events',
  'timers', 'node:timers',
  'stream', 'node:stream',
  'zlib', 'node:zlib',
  'http', 'node:http',
  'https', 'node:https',
  'http2', 'node:http2',
  'os', 'node:os',
  'fs', 'node:fs',
])

export interface ExecuteResult {
  text: string
  images: Array<{ data: string; mimeType: string }>
  isError: boolean
}

export interface ExecutorLogger {
  log(...args: any[]): void
  error(...args: any[]): void
}

export interface CdpConfig {
  host?: string
  port?: number
  token?: string
}

export interface ExecutorOptions {
  cdpConfig: CdpConfig
  logger?: ExecutorLogger
  /** Working directory for scoped fs access */
  cwd?: string
}

function isRegExp(value: any): value is RegExp {
  return (
    typeof value === 'object' && value !== null && typeof value.test === 'function' && typeof value.exec === 'function'
  )
}

function isPromise(value: any): value is Promise<unknown> {
  return typeof value === 'object' && value !== null && typeof value.then === 'function'
}



export class PlaywrightExecutor {
  private isConnected = false
  private page: Page | null = null
  private browser: Browser | null = null
  private context: BrowserContext | null = null

  private userState: Record<string, any> = {}
  private browserLogs: Map<string, string[]> = new Map()
  private lastSnapshots: WeakMap<Page, string> = new WeakMap()
  private cdpSessionCache: WeakMap<Page, CDPSession> = new WeakMap()
  private scopedFs: ScopedFS
  private sandboxedRequire: NodeRequire

  private cdpConfig: CdpConfig
  private logger: ExecutorLogger

  constructor(options: ExecutorOptions) {
    this.cdpConfig = options.cdpConfig
    this.logger = options.logger || { log: console.log, error: console.error }
    // ScopedFS expects an array of allowed directories. If cwd is provided, use it; otherwise use defaults.
    this.scopedFs = new ScopedFS(options.cwd ? [options.cwd, '/tmp', os.tmpdir()] : undefined)
    this.sandboxedRequire = this.createSandboxedRequire(require)
  }

  private createSandboxedRequire(originalRequire: NodeRequire): NodeRequire {
    const scopedFs = this.scopedFs
    const sandboxedRequire = ((id: string) => {
      if (!ALLOWED_MODULES.has(id)) {
        const error = new Error(
          `Module "${id}" is not allowed in the sandbox. ` +
            `Only safe Node.js built-ins are permitted: ${[...ALLOWED_MODULES].filter((m) => !m.startsWith('node:')).join(', ')}`,
        )
        error.name = 'ModuleNotAllowedError'
        throw error
      }
      if (id === 'fs' || id === 'node:fs') {
        return scopedFs
      }
      return originalRequire(id)
    }) as NodeRequire

    sandboxedRequire.resolve = originalRequire.resolve
    sandboxedRequire.cache = originalRequire.cache
    sandboxedRequire.extensions = originalRequire.extensions
    sandboxedRequire.main = originalRequire.main

    return sandboxedRequire
  }

  private async setDeviceScaleFactorForMacOS(context: BrowserContext): Promise<void> {
    if (os.platform() !== 'darwin') {
      return
    }
    const options = (context as any)._options
    if (!options || options.deviceScaleFactor === 2) {
      return
    }
    options.deviceScaleFactor = 2
  }

  private async preserveSystemColorScheme(context: BrowserContext): Promise<void> {
    const options = (context as any)._options
    if (!options) {
      return
    }
    options.colorScheme = 'no-override'
    options.reducedMotion = 'no-override'
    options.forcedColors = 'no-override'
  }

  private clearUserState() {
    Object.keys(this.userState).forEach((key) => delete this.userState[key])
  }

  private clearConnectionState() {
    this.isConnected = false
    this.browser = null
    this.page = null
    this.context = null
  }

  private setupPageConsoleListener(page: Page) {
    const targetId = (page as any)._guid as string | undefined
    if (!targetId) {
      return
    }

    if (!this.browserLogs.has(targetId)) {
      this.browserLogs.set(targetId, [])
    }

    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        this.browserLogs.set(targetId, [])
      }
    })

    page.on('close', () => {
      this.browserLogs.delete(targetId)
    })

    page.on('console', (msg) => {
      try {
        const logEntry = `[${msg.type()}] ${msg.text()}`
        if (!this.browserLogs.has(targetId)) {
          this.browserLogs.set(targetId, [])
        }
        const pageLogs = this.browserLogs.get(targetId)!
        pageLogs.push(logEntry)
        if (pageLogs.length > MAX_LOGS_PER_PAGE) {
          pageLogs.shift()
        }
      } catch (e) {
        this.logger.error('[Executor] Failed to get console message text:', e)
      }
    })
  }

  private async checkExtensionStatus(): Promise<{ connected: boolean; activeTargets: number }> {
    const { host = '127.0.0.1', port = 19988 } = this.cdpConfig
    try {
      const response = await fetch(`http://${host}:${port}/extension/status`, {
        signal: AbortSignal.timeout(2000),
      })
      if (!response.ok) {
        return { connected: false, activeTargets: 0 }
      }
      return await response.json() as { connected: boolean; activeTargets: number }
    } catch {
      return { connected: false, activeTargets: 0 }
    }
  }

  private async ensureConnection(): Promise<{ browser: Browser; page: Page }> {
    if (this.isConnected && this.browser && this.page) {
      return { browser: this.browser, page: this.page }
    }

    // Check extension status first to provide better error messages
    const extensionStatus = await this.checkExtensionStatus()
    if (!extensionStatus.connected) {
      throw new Error(EXTENSION_NOT_CONNECTED_ERROR)
    }

    // Generate a fresh unique URL for each Playwright connection
    const cdpUrl = getCdpUrl(this.cdpConfig)
    const browser = await chromium.connectOverCDP(cdpUrl)

    browser.on('disconnected', () => {
      this.logger.log('Browser disconnected, clearing connection state')
      this.clearConnectionState()
    })

    const contexts = browser.contexts()
    const context = contexts.length > 0 ? contexts[0] : await browser.newContext()

    context.on('page', (page) => {
      this.setupPageConsoleListener(page)
    })

    context.pages().forEach((p) => this.setupPageConsoleListener(p))
    const page = await this.ensurePageForContext({ context, timeout: 10000 })

    await this.preserveSystemColorScheme(context)
    await this.setDeviceScaleFactorForMacOS(context)

    this.browser = browser
    this.page = page
    this.context = context
    this.isConnected = true

    return { browser, page }
  }

  private async getCurrentPage(timeout = 10000): Promise<Page> {
    if (this.page && !this.page.isClosed()) {
      return this.page
    }

    if (this.browser) {
      const contexts = this.browser.contexts()
      if (contexts.length > 0) {
        const context = contexts[0]
        this.context = context
        const pages = context.pages().filter((p) => !p.isClosed())
        if (pages.length > 0) {
          const page = pages[0]
          await page.waitForLoadState('domcontentloaded', { timeout }).catch(() => {})
          this.page = page
          return page
        }
        const page = await this.ensurePageForContext({ context, timeout })
        this.page = page
        return page
      }
    }

    throw new Error(NO_PAGES_AVAILABLE_ERROR)
  }

  async reset(): Promise<{ page: Page; context: BrowserContext }> {
    if (this.browser) {
      try {
        await this.browser.close()
      } catch (e) {
        this.logger.error('Error closing browser:', e)
      }
    }

    this.clearConnectionState()
    this.clearUserState()

    // Check extension status first to provide better error messages
    const extensionStatus = await this.checkExtensionStatus()
    if (!extensionStatus.connected) {
      throw new Error(EXTENSION_NOT_CONNECTED_ERROR)
    }

    // Generate a fresh unique URL for each Playwright connection
    const cdpUrl = getCdpUrl(this.cdpConfig)
    const browser = await chromium.connectOverCDP(cdpUrl)

    browser.on('disconnected', () => {
      this.logger.log('Browser disconnected, clearing connection state')
      this.clearConnectionState()
    })

    const contexts = browser.contexts()
    const context = contexts.length > 0 ? contexts[0] : await browser.newContext()

    context.on('page', (page) => {
      this.setupPageConsoleListener(page)
    })

    context.pages().forEach((p) => this.setupPageConsoleListener(p))
    const page = await this.ensurePageForContext({ context, timeout: 10000 })

    await this.preserveSystemColorScheme(context)
    await this.setDeviceScaleFactorForMacOS(context)

    this.browser = browser
    this.page = page
    this.context = context
    this.isConnected = true

    return { page, context }
  }

  async execute(code: string, timeout = 10000): Promise<ExecuteResult> {
    const consoleLogs: Array<{ method: string; args: any[] }> = []

    const formatConsoleLogs = (logs: Array<{ method: string; args: any[] }>, prefix = 'Console output') => {
      if (logs.length === 0) {
        return ''
      }
      let text = `${prefix}:\n`
      logs.forEach(({ method, args }) => {
        const formattedArgs = args
          .map((arg) => {
            return util.inspect(arg, { depth: 4, colors: false, maxArrayLength: 100, breakLength: 80 })
          })
          .join(' ')
        text += `[${method}] ${formattedArgs}\n`
      })
      return text + '\n'
    }

    try {
      await this.ensureConnection()
      const page = await this.getCurrentPage(timeout)
      const context = this.context || page.context()
      context.setDefaultTimeout(timeout)

      this.logger.log('Executing code:', code)

      const customConsole = {
        log: (...args: any[]) => { consoleLogs.push({ method: 'log', args }) },
        info: (...args: any[]) => { consoleLogs.push({ method: 'info', args }) },
        warn: (...args: any[]) => { consoleLogs.push({ method: 'warn', args }) },
        error: (...args: any[]) => { consoleLogs.push({ method: 'error', args }) },
        debug: (...args: any[]) => { consoleLogs.push({ method: 'debug', args }) },
      }

      const accessibilitySnapshot = async (options: {
        page: Page
        search?: string | RegExp
        showDiffSinceLastCall?: boolean
        /** Snapshot format: 'raw', 'compact', 'interactive', 'interactive-dedup' (default) */
        format?: SnapshotFormat
      }) => {
        const { page: targetPage, search, showDiffSinceLastCall = false, format = DEFAULT_SNAPSHOT_FORMAT } = options
        if ((targetPage as any)._snapshotForAI) {
          const snapshot = await (targetPage as any)._snapshotForAI()
          const rawStr = typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot, null, 2)
          const sanitizedStr = rawStr.toWellFormed?.() ?? rawStr
          // Apply format transformation
          const snapshotStr = formatSnapshot(sanitizedStr, format, this.logger)

          if (showDiffSinceLastCall) {
            const previousSnapshot = this.lastSnapshots.get(targetPage)
            if (!previousSnapshot) {
              this.lastSnapshots.set(targetPage, snapshotStr)
              return 'No previous snapshot available. This is the first call for this page. Full snapshot stored for next diff.'
            }
            const patch = createPatch('snapshot', previousSnapshot, snapshotStr, 'previous', 'current', { context: 3 })
            if (patch.split('\n').length <= 4) {
              return 'No changes detected since last snapshot'
            }
            return patch
          }

          this.lastSnapshots.set(targetPage, snapshotStr)

          if (!search) {
            return snapshotStr
          }

          const lines = snapshotStr.split('\n')
          const matchIndices: number[] = []
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i]
            const isMatch = isRegExp(search) ? search.test(line) : line.includes(search)
            if (isMatch) {
              matchIndices.push(i)
              if (matchIndices.length >= 10) break
            }
          }

          if (matchIndices.length === 0) {
            return 'No matches found'
          }

          const CONTEXT_LINES = 5
          const includedLines = new Set<number>()
          for (const idx of matchIndices) {
            const start = Math.max(0, idx - CONTEXT_LINES)
            const end = Math.min(lines.length - 1, idx + CONTEXT_LINES)
            for (let i = start; i <= end; i++) {
              includedLines.add(i)
            }
          }

          const sortedIndices = [...includedLines].sort((a, b) => a - b)
          const result: string[] = []
          for (let i = 0; i < sortedIndices.length; i++) {
            const lineIdx = sortedIndices[i]
            if (i > 0 && sortedIndices[i - 1] !== lineIdx - 1) {
              result.push('---')
            }
            result.push(lines[lineIdx])
          }
          return result.join('\n')
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
          const scriptPath = path.join(__dirname, '..', 'dist', 'selector-generator.js')
          const scriptContent = fs.readFileSync(scriptPath, 'utf-8')
          const cdp = await getCDPSession({ page: elementPage })
          await cdp.send('Runtime.evaluate', { expression: scriptContent })
        }
        return await element.evaluate((el: any) => {
          const { createSelectorGenerator, toLocator } = (globalThis as any).__selectorGenerator
          const generator = createSelectorGenerator(globalThis)
          const result = generator(el)
          return toLocator(result.selector, 'javascript')
        })
      }

      const getPageTargetId = async (p: Page): Promise<string> => {
        const guid = (p as any)._guid
        if (guid) return guid
        throw new Error('Could not get page identifier: _guid not available')
      }

      const getLatestLogs = async (options?: { page?: Page; count?: number; search?: string | RegExp }) => {
        const { page: filterPage, count, search } = options || {}
        let allLogs: string[] = []

        if (filterPage) {
          const targetId = await getPageTargetId(filterPage)
          const pageLogs = this.browserLogs.get(targetId) || []
          allLogs = [...pageLogs]
        } else {
          for (const pageLogs of this.browserLogs.values()) {
            allLogs.push(...pageLogs)
          }
        }

        if (search) {
          const matchIndices: number[] = []
          for (let i = 0; i < allLogs.length; i++) {
            const log = allLogs[i]
            const isMatch = typeof search === 'string' ? log.includes(search) : isRegExp(search) && search.test(log)
            if (isMatch) matchIndices.push(i)
          }

          const CONTEXT_LINES = 5
          const includedIndices = new Set<number>()
          for (const idx of matchIndices) {
            const start = Math.max(0, idx - CONTEXT_LINES)
            const end = Math.min(allLogs.length - 1, idx + CONTEXT_LINES)
            for (let i = start; i <= end; i++) {
              includedIndices.add(i)
            }
          }

          const sortedIndices = [...includedIndices].sort((a, b) => a - b)
          const result: string[] = []
          for (let i = 0; i < sortedIndices.length; i++) {
            const logIdx = sortedIndices[i]
            if (i > 0 && sortedIndices[i - 1] !== logIdx - 1) {
              result.push('---')
            }
            result.push(allLogs[logIdx])
          }
          allLogs = result
        }

        return count !== undefined ? allLogs.slice(-count) : allLogs
      }

      const clearAllLogs = () => {
        this.browserLogs.clear()
      }

      const getCDPSession = async (options: { page: Page }) => {
        const cached = this.cdpSessionCache.get(options.page)
        if (cached) return cached
        // Generate a fresh unique URL for each CDP session to avoid client ID conflicts
        const wsUrl = getCdpUrl(this.cdpConfig)
        const session = await getCDPSessionForPage({ page: options.page, wsUrl })
        this.cdpSessionCache.set(options.page, session)
        return session
      }

      const createDebugger = (options: { cdp: ICDPSession }) => new Debugger(options)
      const createEditor = (options: { cdp: ICDPSession }) => new Editor(options)

      const getStylesForLocatorFn = async (options: { locator: any }) => {
        const cdp = await getCDPSession({ page: options.locator.page() })
        return getStylesForLocator({ locator: options.locator, cdp })
      }

      const getReactSourceFn = async (options: { locator: any }) => {
        const cdp = await getCDPSession({ page: options.locator.page() })
        return getReactSource({ locator: options.locator, cdp })
      }

      const screenshotCollector: ScreenshotResult[] = []

      const screenshotWithAccessibilityLabelsFn = async (options: { page: Page; interactiveOnly?: boolean }) => {
        return screenshotWithAccessibilityLabels({
          ...options,
          collector: screenshotCollector,
          logger: {
            info: (...args) => { this.logger.error('[playwriter]', ...args) },
            error: (...args) => { this.logger.error('[playwriter]', ...args) },
          },
        })
      }

      // Screen recording functions (via chrome.tabCapture in extension - survives navigation)
      // Recording uses chrome.tabCapture which requires activeTab permission.
      // This permission is granted when the user clicks the Playwriter extension icon on a tab.
      const relayPort = this.cdpConfig.port || 19988
      // Recording will work on any tab where the user has clicked the icon.
      const withRecordingDefaults = <T extends { page?: Page; sessionId?: string }, R>(
        fn: (opts: T & { relayPort: number; sessionId?: string }) => Promise<R>
      ) => {
        return async (options: T = {} as T) => {
          const targetPage = options.page || page
          // Get sessionId from cached CDP session to identify which tab to record
          const cdp = await getCDPSession({ page: targetPage })
          const sessionId = options.sessionId || cdp.getSessionId() || undefined
          return fn({ page: targetPage, sessionId, relayPort, ...options })
        }
      }
      const self = this

      let vmContextObj: any = {
        page,
        context,
        state: this.userState,
        console: customConsole,
        accessibilitySnapshot,
        getCleanHTML,
        getLocatorStringForElement,
        getLatestLogs,
        clearAllLogs,
        waitForPageLoad,
        getCDPSession,
        createDebugger,
        createEditor,
        getStylesForLocator: getStylesForLocatorFn,
        formatStylesAsText,
        getReactSource: getReactSourceFn,
        screenshotWithAccessibilityLabels: screenshotWithAccessibilityLabelsFn,
        startRecording: withRecordingDefaults(startRecording),
        stopRecording: withRecordingDefaults(stopRecording),
        isRecording: withRecordingDefaults(isRecording),
        cancelRecording: withRecordingDefaults(cancelRecording),
        resetPlaywright: async () => {
          const { page: newPage, context: newContext } = await self.reset()
          vmContextObj.page = newPage
          vmContextObj.context = newContext
          return { page: newPage, context: newContext }
        },
        require: this.sandboxedRequire,
        import: (specifier: string) => import(specifier),
        ...usefulGlobals,
      }

      const vmContext = vm.createContext(vmContextObj)
      const wrappedCode = `(async () => { ${code} })()`
      const hasExplicitReturn = /\breturn\b/.test(code)

      const result = await Promise.race([
        vm.runInContext(wrappedCode, vmContext, { timeout, displayErrors: true }),
        new Promise((_, reject) => setTimeout(() => reject(new CodeExecutionTimeoutError(timeout)), timeout)),
      ])

      let responseText = formatConsoleLogs(consoleLogs)

      // Only show return value if user explicitly used return
      if (hasExplicitReturn) {
        const resolvedResult = isPromise(result) ? await result : result
        if (resolvedResult !== undefined) {
          const formatted = util.inspect(resolvedResult, { depth: 4, colors: false, maxArrayLength: 100, breakLength: 80 })
          if (formatted.trim()) {
            responseText += `[return value] ${formatted}\n`
          }
        }
      }
      
      if (!responseText.trim()) {
        responseText = 'Code executed successfully (no output)'
      }

      for (const screenshot of screenshotCollector) {
        responseText += `\nScreenshot saved to: ${screenshot.path}\n`
        responseText += `Labels shown: ${screenshot.labelCount}\n\n`
        responseText += `Accessibility snapshot:\n${screenshot.snapshot}\n`
      }

      const MAX_LENGTH = 6000
      let finalText = responseText.trim()
      if (finalText.length > MAX_LENGTH) {
        finalText = finalText.slice(0, MAX_LENGTH) +
          `\n\n[Truncated to ${MAX_LENGTH} characters. Better manage your logs or paginate them to read the full logs]`
      }

      const images = screenshotCollector.map((s) => ({ data: s.base64, mimeType: s.mimeType }))

      return { text: finalText, images, isError: false }
    } catch (error: any) {
      const errorStack = error.stack || error.message
      const isTimeoutError = error instanceof CodeExecutionTimeoutError || error.name === 'TimeoutError'

      this.logger.error('Error in execute:', errorStack)

      const logsText = formatConsoleLogs(consoleLogs, 'Console output (before error)')
      const resetHint = isTimeoutError ? '' :
        '\n\n[HINT: If this is an internal Playwright error, page/browser closed, or connection issue, call reset to reconnect.]'

      return {
        text: `${logsText}\nError executing code: ${error.message}\n${errorStack}${resetHint}`,
        images: [],
        isError: true,
      }
    }
  }

  // When extension is connected but has no pages, auto-create only if PLAYWRITER_AUTO_ENABLE is set.
  private async ensurePageForContext(options: { context: BrowserContext; timeout: number }): Promise<Page> {
    const { context, timeout } = options
    const pages = context.pages().filter((p) => !p.isClosed())
    if (pages.length > 0) {
      return pages[0]
    }

    const extensionStatus = await this.checkExtensionStatus()
    if (!extensionStatus.connected) {
      throw new Error(EXTENSION_NOT_CONNECTED_ERROR)
    }

    if (!process.env.PLAYWRITER_AUTO_ENABLE) {
      throw new Error(NO_PAGES_AVAILABLE_ERROR)
    }

    const page = await context.newPage()
    this.setupPageConsoleListener(page)
    await page.waitForLoadState('domcontentloaded', { timeout }).catch(() => {})
    return page
  }

  /** Get info about current connection state */
  getStatus(): { connected: boolean; pageUrl: string | null; pagesCount: number } {
    return {
      connected: this.isConnected,
      pageUrl: this.page?.url() || null,
      pagesCount: this.context?.pages().length || 0,
    }
  }

  /** Get keys of user-defined state */
  getStateKeys(): string[] {
    return Object.keys(this.userState)
  }
}

/**
 * Session manager for multiple executors, keyed by session ID (typically cwd hash)
 */
export class ExecutorManager {
  private executors = new Map<string, PlaywrightExecutor>()
  private cdpConfig: CdpConfig
  private logger: ExecutorLogger

  constructor(options: { cdpConfig: CdpConfig; logger?: ExecutorLogger }) {
    this.cdpConfig = options.cdpConfig
    this.logger = options.logger || { log: console.log, error: console.error }
  }

  getExecutor(sessionId: string, cwd?: string): PlaywrightExecutor {
    let executor = this.executors.get(sessionId)
    if (!executor) {
      executor = new PlaywrightExecutor({
        cdpConfig: this.cdpConfig,
        logger: this.logger,
        cwd,
      })
      this.executors.set(sessionId, executor)
    }
    return executor
  }

  deleteExecutor(sessionId: string): boolean {
    return this.executors.delete(sessionId)
  }

  listSessions(): Array<{ id: string; stateKeys: string[] }> {
    return [...this.executors.entries()].map(([id, executor]) => {
      return {
        id,
        stateKeys: executor.getStateKeys(),
      }
    })
  }
}
