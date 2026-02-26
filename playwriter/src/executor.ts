/**
 * PlaywrightExecutor - Manages browser connection and code execution per session.
 * Used by both MCP and CLI to execute Playwright code with persistent state.
 */

import { Page, Frame, Browser, BrowserContext, chromium, Locator, FrameLocator } from '@xmorse/playwright-core'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import util from 'node:util'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import * as acorn from 'acorn'
import { createSmartDiff } from './diff-utils.js'
import { getCdpUrl, parseRelayHost } from './utils.js'
import { getExtensionOutdatedWarning } from './relay-client.js'
import { waitForPageLoad, WaitForPageLoadOptions, WaitForPageLoadResult } from './wait-for-page-load.js'
import { ICDPSession, getCDPSessionForPage } from './cdp-session.js'
import { Debugger } from './debugger.js'
import { Editor } from './editor.js'
import { getStylesForLocator, formatStylesAsText, type StylesResult } from './styles.js'
import { getReactSource, type ReactSourceLocation } from './react-source.js'
import { ScopedFS } from './scoped-fs.js'
import {
  screenshotWithAccessibilityLabels,
  getAriaSnapshot,
  resizeImage,
  type ScreenshotResult,
  type SnapshotFormat,
} from './aria-snapshot.js'
import { createGhostBrowserChrome, type GhostBrowserCommandResult } from './ghost-browser.js'
export type { SnapshotFormat }
import { getCleanHTML, type GetCleanHTMLOptions } from './clean-html.js'
import { getPageMarkdown, type GetPageMarkdownOptions } from './page-markdown.js'
import { createRecordingApi } from './screen-recording.js'
import { createDemoVideo } from './ffmpeg.js'
import { type GhostCursorClientOptions } from './ghost-cursor.js'
import { RecordingGhostCursorController } from './recording-ghost-cursor.js'

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

/**
 * Determines if code should be auto-wrapped with `return await (...)`.
 * Returns true for single expression statements that aren't assignments.
 */
export function shouldAutoReturn(code: string): boolean {
  try {
    const ast = acorn.parse(code, {
      ecmaVersion: 'latest',
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      sourceType: 'script',
    })

    // Must be exactly one statement
    if (ast.body.length !== 1) {
      return false
    }

    const stmt = ast.body[0]

    // If it's already a return statement, don't auto-wrap
    if (stmt.type === 'ReturnStatement') {
      return false
    }

    // Must be an ExpressionStatement
    if (stmt.type !== 'ExpressionStatement') {
      return false
    }

    // Don't auto-return side-effect expressions
    const expr = stmt.expression
    if (
      expr.type === 'AssignmentExpression' ||
      expr.type === 'UpdateExpression' ||
      (expr.type === 'UnaryExpression' && (expr as acorn.UnaryExpression).operator === 'delete')
    ) {
      return false
    }

    // Don't auto-return sequence expressions that contain assignments
    if (expr.type === 'SequenceExpression') {
      const hasAssignment = expr.expressions.some((e: acorn.Expression) => e.type === 'AssignmentExpression')
      if (hasAssignment) {
        return false
      }
    }

    return true
  } catch {
    // Parse failed, don't auto-return
    return false
  }
}

const EXTENSION_NOT_CONNECTED_ERROR = `The Playwriter Chrome extension is not connected. Make sure you have:
1. Installed the extension: https://chromewebstore.google.com/detail/playwriter-mcp/jfeammnjpkecdekppnclgkkffahnhfhe
2. Clicked the extension icon on a tab to enable it (or refreshed the page if just installed)`

const NO_PAGES_AVAILABLE_ERROR =
  'No Playwright pages are available. Enable Playwriter on a tab or set PLAYWRITER_AUTO_ENABLE=1 to auto-create one.'

const MAX_LOGS_PER_PAGE = 5000

const ALLOWED_MODULES = new Set([
  'path',
  'node:path',
  'url',
  'node:url',
  'querystring',
  'node:querystring',
  'punycode',
  'node:punycode',
  'crypto',
  'node:crypto',
  'buffer',
  'node:buffer',
  'string_decoder',
  'node:string_decoder',
  'util',
  'node:util',
  'assert',
  'node:assert',
  'events',
  'node:events',
  'timers',
  'node:timers',
  'stream',
  'node:stream',
  'zlib',
  'node:zlib',
  'http',
  'node:http',
  'https',
  'node:https',
  'http2',
  'node:http2',
  'os',
  'node:os',
  'fs',
  'node:fs',
])

export interface ExecuteResult {
  text: string
  images: Array<{ data: string; mimeType: string }>
  isError: boolean
}

interface WarningEvent {
  id: number
  message: string
}

interface WarningScope {
  cursor: number
}

export interface ExecutorLogger {
  log(...args: any[]): void
  error(...args: any[]): void
}

export interface CdpConfig {
  host?: string
  port?: number
  token?: string
  extensionId?: string | null
}

export interface SessionMetadata {
  extensionId: string | null
  browser: string | null
  profile: { email: string; id: string } | null
}

export interface ExecutorOptions {
  cdpConfig: CdpConfig
  sessionMetadata?: SessionMetadata
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
  private lastRefToLocator: WeakMap<Page, Map<string, string>> = new WeakMap()
  private warningEvents: WarningEvent[] = []
  private nextWarningEventId = 0
  private lastDeliveredWarningEventId = 0

  // Recording timestamp tracking: when recording is active, each execute()
  // call pushes {start, end} (seconds relative to recordingStartedAt).
  // Returned by stopRecording() so the model can speed up idle sections.
  private recordingStartedAt: number | null = null
  private executionTimestamps: Array<{ start: number; end: number }> = []
  private activeWarningScopes = new Set<WarningScope>()
  private pagesWithListeners = new WeakSet<Page>()
  private suppressPageCloseWarnings = false

  private scopedFs: ScopedFS
  private sandboxedRequire: NodeRequire

  private cdpConfig: CdpConfig
  private logger: ExecutorLogger
  private sessionMetadata: SessionMetadata
  private hasWarnedExtensionOutdated = false

  constructor(options: ExecutorOptions) {
    this.cdpConfig = options.cdpConfig
    this.logger = options.logger || { log: console.log, error: console.error }
    this.sessionMetadata = options.sessionMetadata || { extensionId: null, browser: null, profile: null }
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

  private clearUserState() {
    Object.keys(this.userState).forEach((key) => delete this.userState[key])
  }

  private clearConnectionState() {
    this.isConnected = false
    this.browser = null
    this.page = null
    this.context = null
  }

  private enqueueWarning(message: string) {
    this.nextWarningEventId += 1
    this.warningEvents.push({ id: this.nextWarningEventId, message })
  }

  private beginWarningScope(): WarningScope {
    const scope: WarningScope = {
      cursor: this.nextWarningEventId,
    }
    this.activeWarningScopes.add(scope)
    return scope
  }

  private flushWarningsForScope(scope: WarningScope): string {
    const relevantWarnings = this.warningEvents.filter((warning) => {
      return warning.id > scope.cursor
    })
    const latestWarningId = relevantWarnings.at(-1)?.id
    if (latestWarningId && latestWarningId > this.lastDeliveredWarningEventId) {
      this.lastDeliveredWarningEventId = latestWarningId
    }

    this.activeWarningScopes.delete(scope)
    this.pruneDeliveredWarnings()

    if (relevantWarnings.length === 0) {
      return ''
    }

    return `${relevantWarnings.map((warning) => `[WARNING] ${warning.message}`).join('\n')}\n`
  }

  private pruneDeliveredWarnings() {
    const activeCursors = [...this.activeWarningScopes].map((scope) => {
      return scope.cursor
    })
    const minActiveCursor = activeCursors.length > 0 ? Math.min(...activeCursors) : this.lastDeliveredWarningEventId
    const pruneBeforeOrAt = Math.min(this.lastDeliveredWarningEventId, minActiveCursor)
    this.warningEvents = this.warningEvents.filter((warning) => {
      return warning.id > pruneBeforeOrAt
    })
  }

  private warnIfExtensionOutdated(playwriterVersion: string | null) {
    if (this.hasWarnedExtensionOutdated) {
      return
    }
    const warning = getExtensionOutdatedWarning(playwriterVersion)
    if (warning) {
      this.logger.log(warning)
      this.hasWarnedExtensionOutdated = true
    }
  }

  private setupPageListeners(page: Page) {
    if (this.pagesWithListeners.has(page)) {
      return
    }
    this.pagesWithListeners.add(page)
    this.setupPageCloseDetection(page)
    this.setupPageConsoleListener(page)
    this.setupPopupDetection(page)
  }

  private setupPageCloseDetection(page: Page) {
    page.on('close', () => {
      const stateKeysForClosedPage = Object.entries(this.userState)
        .filter(([, value]) => {
          return value === page
        })
        .map(([key]) => key)

      const wasCurrentPage = this.page === page
      let replacementPageInfo: { index: string; url: string } | null = null

      if (wasCurrentPage) {
        this.page = null
        const context = this.context || page.context()
        const openPages = context.pages().filter((candidate) => {
          return !candidate.isClosed()
        })
        if (openPages.length > 0) {
          const replacementPage = openPages[0]
          this.page = replacementPage
          const replacementIndex = context.pages().indexOf(replacementPage)
          replacementPageInfo = {
            index: replacementIndex >= 0 ? String(replacementIndex) : 'unknown',
            url: replacementPage.url() || 'unknown',
          }
        }
      }

      if (!this.isConnected || this.suppressPageCloseWarnings || stateKeysForClosedPage.length === 0) {
        return
      }

      const stateKeyLabel = stateKeysForClosedPage.map((key) => `state.${key}`).join(', ')
      const closedUrl = page.url() || 'unknown'

      if (!wasCurrentPage) {
        this.enqueueWarning(
          `Page closed (url: ${closedUrl}) for ${stateKeyLabel}. ` +
            `Assign a new open page to ${stateKeyLabel} before reusing it.`,
        )
        return
      }

      if (replacementPageInfo) {
        this.enqueueWarning(
          `The current page in ${stateKeyLabel} was closed (url: ${closedUrl}). ` +
            `Switched active page to index ${replacementPageInfo.index} (url: ${replacementPageInfo.url}). ` +
            `Reassign ${stateKeyLabel} before using it again.`,
        )
        return
      }

      this.enqueueWarning(
        `The current page in ${stateKeyLabel} was closed (url: ${closedUrl}). ` +
          `No open pages remain. Open a tab with Playwriter enabled, then reassign ${stateKeyLabel}.`,
      )
    })
  }

  private setupPopupDetection(page: Page) {
    // Listen for popup events (window.open, target=_blank) on each page.
    // This is more reliable than checking page.opener() on context 'page' event,
    // which also fires for context.newPage() and CDP reconnection scenarios.
    page.on('popup', (popup) => {
      const context = page.context()
      const pages = context.pages()
      const rawIndex = pages.indexOf(popup)
      const pageIndex = rawIndex >= 0 ? String(rawIndex) : 'unknown'
      const url = popup.url()
      this.enqueueWarning(
        `Popup window detected (page index ${pageIndex}, url: ${url}). ` +
          `Popup windows cannot be controlled by playwriter. ` +
          `Repeat the interaction in a way that does not open a popup, or navigate to the URL directly in a new tab.`,
      )
    })
  }

  private setupPageConsoleListener(page: Page) {
    // Use targetId() if available, fallback to internal _guid for CDP connections
    const targetId = page.targetId() || ((page as any)._guid as string | undefined)
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

  private async checkExtensionStatus(): Promise<{
    connected: boolean
    activeTargets: number
    playwriterVersion: string | null
  }> {
    const { host = '127.0.0.1', port = 19988, extensionId } = this.cdpConfig
    const { httpBaseUrl } = parseRelayHost(host, port)
    const notConnected = { connected: false, activeTargets: 0, playwriterVersion: null }
    try {
      if (extensionId) {
        const response = await fetch(`${httpBaseUrl}/extensions/status`, {
          signal: AbortSignal.timeout(2000),
        })
        if (!response.ok) {
          const fallback = await fetch(`${httpBaseUrl}/extension/status`, {
            signal: AbortSignal.timeout(2000),
          })
          if (!fallback.ok) {
            return notConnected
          }
          return (await fallback.json()) as {
            connected: boolean
            activeTargets: number
            playwriterVersion: string | null
          }
        }
        const data = (await response.json()) as {
          extensions: Array<{
            extensionId: string
            stableKey?: string
            activeTargets: number
            playwriterVersion?: string | null
          }>
        }
        const extension = data.extensions.find((item) => {
          return item.extensionId === extensionId || item.stableKey === extensionId
        })
        if (!extension) {
          return notConnected
        }
        return {
          connected: true,
          activeTargets: extension.activeTargets,
          playwriterVersion: extension?.playwriterVersion || null,
        }
      }

      const response = await fetch(`${httpBaseUrl}/extension/status`, {
        signal: AbortSignal.timeout(2000),
      })
      if (!response.ok) {
        return notConnected
      }
      return (await response.json()) as { connected: boolean; activeTargets: number; playwriterVersion: string | null }
    } catch {
      return notConnected
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
    this.warnIfExtensionOutdated(extensionStatus.playwriterVersion)

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
      this.setupPageListeners(page)
    })

    context.pages().forEach((p) => this.setupPageListeners(p))
    const page = await this.ensurePageForContext({ context, timeout: 10000 })

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
      this.suppressPageCloseWarnings = true
      try {
        await this.browser.close()
      } catch (e) {
        this.logger.error('Error closing browser:', e)
      } finally {
        this.suppressPageCloseWarnings = false
      }
    }

    this.clearConnectionState()
    this.clearUserState()

    // Check extension status first to provide better error messages
    const extensionStatus = await this.checkExtensionStatus()
    if (!extensionStatus.connected) {
      throw new Error(EXTENSION_NOT_CONNECTED_ERROR)
    }
    this.warnIfExtensionOutdated(extensionStatus.playwriterVersion)

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
      this.setupPageListeners(page)
    })

    context.pages().forEach((p) => this.setupPageListeners(p))
    const page = await this.ensurePageForContext({ context, timeout: 10000 })

    await this.setDeviceScaleFactorForMacOS(context)

    this.browser = browser
    this.page = page
    this.context = context
    this.isConnected = true

    return { page, context }
  }

  async execute(code: string, timeout = 10000): Promise<ExecuteResult> {
    const consoleLogs: Array<{ method: string; args: any[] }> = []
    const warningScope = this.beginWarningScope()

    const formatConsoleLogs = (logs: Array<{ method: string; args: any[] }>, prefix = 'Console output') => {
      if (logs.length === 0) {
        return ''
      }
      let text = `${prefix}:\n`
      logs.forEach(({ method, args }) => {
        const formattedArgs = args
          .map((arg) => {
            if (typeof arg === 'string') return arg
            return util.inspect(arg, {
              depth: 4,
              colors: false,
              maxArrayLength: 100,
              maxStringLength: 1000,
              breakLength: 80,
            })
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

      const snapshot = async (options: {
        page?: Page
        /** Optional frame to scope the snapshot (e.g. from iframe.contentFrame() or page.frames()) */
        frame?: Frame | FrameLocator
        /** Optional locator to scope the snapshot to a subtree */
        locator?: Locator
        search?: string | RegExp
        showDiffSinceLastCall?: boolean
        /** Snapshot format (currently raw only) */
        format?: SnapshotFormat
        /** Only include interactive elements (default: true) */
        interactiveOnly?: boolean
      }) => {
        const {
          page: targetPage,
          frame,
          locator,
          search,
          showDiffSinceLastCall = true,
          interactiveOnly = false,
        } = options
        const resolvedPage = targetPage || page
        if (!resolvedPage) {
          throw new Error('snapshot requires a page')
        }

        // Use new in-page implementation via getAriaSnapshot
        const {
          snapshot: rawSnapshot,
          refs,
          getSelectorForRef,
        } = await getAriaSnapshot({
          page: resolvedPage,
          frame,
          locator,
          interactiveOnly,
        })
        const snapshotStr = rawSnapshot.toWellFormed?.() ?? rawSnapshot

        const refToLocator = new Map<string, string>()
        for (const entry of refs) {
          const locatorStr = getSelectorForRef(entry.ref)
          if (locatorStr) {
            refToLocator.set(entry.shortRef, locatorStr)
          }
        }
        this.lastRefToLocator.set(resolvedPage, refToLocator)

        const shouldCacheSnapshot = !frame
        const previousSnapshot = shouldCacheSnapshot ? this.lastSnapshots.get(resolvedPage) : undefined
        if (shouldCacheSnapshot) {
          this.lastSnapshots.set(resolvedPage, snapshotStr)
        }

        // Never diff when agent is searching — search should always filter the full snapshot
        if (showDiffSinceLastCall && previousSnapshot && shouldCacheSnapshot && !search) {
          const diffResult = createSmartDiff({
            oldContent: previousSnapshot,
            newContent: snapshotStr,
            label: 'snapshot',
          })
          if (diffResult.type === 'no-change') {
            return 'No changes since last snapshot. Use showDiffSinceLastCall: false to see full content.'
          }
          return diffResult.content
        }

        if (!search) {
          return `${snapshotStr}\n\nuse refToLocator({ ref: 'e3' }) to get locators for ref strings.`
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

      const refToLocator = (options: { ref: string; page?: Page }): string | null => {
        const targetPage = options.page || page
        const map = this.lastRefToLocator.get(targetPage)
        if (!map) {
          return null
        }
        return map.get(options.ref) ?? null
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

      const getLatestLogs = async (options?: { page?: Page; count?: number; search?: string | RegExp }) => {
        const { page: filterPage, count, search } = options || {}
        let allLogs: string[] = []

        if (filterPage) {
          // Use targetId() if available, fallback to internal _guid for CDP connections
          const targetId = filterPage.targetId() || ((filterPage as any)._guid as string | undefined)
          if (!targetId) {
            throw new Error('Could not get page targetId')
          }
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
        if (options.page.isClosed()) {
          throw new Error('Cannot create CDP session for closed page')
        }
        return await getCDPSessionForPage({ page: options.page })
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
            info: (...args) => {
              this.logger.error('[playwriter]', ...args)
            },
            error: (...args) => {
              this.logger.error('[playwriter]', ...args)
            },
          },
        })
      }

      // Screen recording functions (via chrome.tabCapture in extension - survives navigation)
      // Recording uses chrome.tabCapture which requires activeTab permission.
      // This permission is granted when the user clicks the Playwriter extension icon on a tab.
      const relayPort = this.cdpConfig.port || 19988
      const self = this
      const recordingGhostCursor = new RecordingGhostCursorController({
        logger: {
          error: (...args: unknown[]) => {
            self.logger.error(...args)
          },
        },
      })

      const showGhostCursor = async (options?: ({ page?: Page } & GhostCursorClientOptions)) => {
        const targetPage = options?.page || page
        const cursorOptions: GhostCursorClientOptions | undefined = (() => {
          if (!options) {
            return undefined
          }

          const { page: _ignoredPage, ...rest } = options
          return rest
        })()

        await recordingGhostCursor.show({ page: targetPage, cursorOptions })
      }

      const hideGhostCursor = async (options?: { page?: Page }) => {
        const targetPage = options?.page || page
        await recordingGhostCursor.hide({ page: targetPage })
      }

      const recordingApi = createRecordingApi({
        context,
        defaultPage: page,
        relayPort,
        ghostCursorController: recordingGhostCursor,
        onStart: () => {
          self.recordingStartedAt = Date.now()
          self.executionTimestamps = []
        },
        onFinish: () => {
          self.recordingStartedAt = null
          self.executionTimestamps = []
        },
        getExecutionTimestamps: () => {
          return self.executionTimestamps
        },
      })

      // Ghost Browser API - creates chrome object that mirrors Ghost Browser's APIs
      // See extension/src/ghost-browser-api.d.ts for full API documentation
      const chromeGhostBrowser = createGhostBrowserChrome(async (namespace, method, args) => {
        const cdp = await getCDPSession({ page })
        const result = await cdp.send('ghost-browser' as any, { namespace, method, args })
        const typed = result as GhostBrowserCommandResult
        if (!typed.success) {
          throw new Error(typed.error || `Ghost Browser API call failed: ${namespace}.${method}`)
        }
        return typed.result
      })

      let vmContextObj: any = {
        page,
        context,
        state: this.userState,
        console: customConsole,
        snapshot,
        accessibilitySnapshot: snapshot, // backward compat alias
        refToLocator,
        getCleanHTML,
        getPageMarkdown,
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
        resizeImage,
        ghostCursor: {
          show: showGhostCursor,
          hide: hideGhostCursor,
        },
        recording: {
          start: recordingApi.start,
          stop: recordingApi.stop,
          isRecording: recordingApi.isRecording,
          cancel: recordingApi.cancel,
        },
        // Backward-compatible aliases
        startRecording: recordingApi.start,
        stopRecording: recordingApi.stop,
        isRecording: recordingApi.isRecording,
        cancelRecording: recordingApi.cancel,
        createDemoVideo,
        resetPlaywright: async () => {
          const { page: newPage, context: newContext } = await self.reset()
          vmContextObj.page = newPage
          vmContextObj.context = newContext
          return { page: newPage, context: newContext }
        },
        require: this.sandboxedRequire,
        import: (specifier: string) => import(specifier),
        // Ghost Browser API - only works in Ghost Browser, mirrors chrome.ghostPublicAPI etc
        chrome: chromeGhostBrowser,
        ...usefulGlobals,
      }

      const vmContext = vm.createContext(vmContextObj)
      const autoReturn = shouldAutoReturn(code)
      const wrappedCode = autoReturn ? `(async () => { return await (${code}) })()` : `(async () => { ${code} })()`
      const hasExplicitReturn = autoReturn || /\breturn\b/.test(code)

      // Track execution timestamps relative to recording start (seconds).
      // Used to identify idle gaps that can be sped up in demo videos.
      // Captured before execution so we can record timing even if it throws.
      const recordingStartSnapshot = this.recordingStartedAt
      const execStartSec = recordingStartSnapshot !== null
        ? (Date.now() - recordingStartSnapshot) / 1000
        : -1

      const result = await (async () => {
        try {
          return await Promise.race([
            vm.runInContext(wrappedCode, vmContext, { timeout, displayErrors: true }),
            new Promise((_, reject) => setTimeout(() => reject(new CodeExecutionTimeoutError(timeout)), timeout)),
          ])
        } finally {
          // Record timestamp even on error — the execution still occupied real time
          // that should not be sped up in the demo video.
          // Compare against snapshot to avoid cross-session contamination if
          // recording was stopped and restarted inside the same execute() call.
          if (recordingStartSnapshot !== null && execStartSec >= 0 && this.recordingStartedAt === recordingStartSnapshot) {
            const execEndSec = (Date.now() - recordingStartSnapshot) / 1000
            this.executionTimestamps.push({ start: execStartSec, end: execEndSec })
          }
        }
      })()

      let responseText = formatConsoleLogs(consoleLogs)

      // Only show return value if user explicitly used return
      if (hasExplicitReturn) {
        const resolvedResult = isPromise(result) ? await result : result
        if (resolvedResult !== undefined) {
          const formatted =
            typeof resolvedResult === 'string'
              ? resolvedResult
              : util.inspect(resolvedResult, {
                  depth: 4,
                  colors: false,
                  maxArrayLength: 100,
                  maxStringLength: 1000,
                  breakLength: 80,
                })
          if (formatted.trim()) {
            responseText += `[return value] ${formatted}\n`
          }
        }
      }

      responseText += this.flushWarningsForScope(warningScope)

      if (!responseText.trim()) {
        responseText = 'Code executed successfully (no output)'
      }

      for (const screenshot of screenshotCollector) {
        responseText += `\nScreenshot saved to: ${screenshot.path}\n`
        responseText += `Labels shown: ${screenshot.labelCount}\n\n`
        responseText += `Accessibility snapshot:\n${screenshot.snapshot}\n`
      }

      const MAX_LENGTH = 10000
      let finalText = responseText.trim()
      if (finalText.length > MAX_LENGTH) {
        finalText =
          finalText.slice(0, MAX_LENGTH) +
          `\n\n[Truncated to ${MAX_LENGTH} characters. Use search to find specific content]`
      }

      const images = screenshotCollector.map((s) => ({ data: s.base64, mimeType: s.mimeType }))

      return { text: finalText, images, isError: false }
    } catch (error: any) {
      const errorStack = error.stack || error.message
      const isTimeoutError =
        error instanceof CodeExecutionTimeoutError || error?.name === 'TimeoutError' || error?.name === 'AbortError'

      this.logger.error('Error in execute:', errorStack)

      const logsText = formatConsoleLogs(consoleLogs, 'Console output (before error)')
      const warningText = this.flushWarningsForScope(warningScope)
      const resetHint = isTimeoutError
        ? ''
        : '\n\n[HINT: If this is an internal Playwright error, page/browser closed, or connection issue, call reset to reconnect.]'

      // timeout stacks are internal noise (Promise.race / setTimeout); only show the message
      const errorText = isTimeoutError ? error.message : errorStack
      return {
        text: `${logsText}${warningText}\nError executing code: ${errorText}${resetHint}`,
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
      const waitTimeoutMs = Math.min(timeout, 1000)
      const startTime = Date.now()
      while (Date.now() - startTime < waitTimeoutMs) {
        const availablePages = context.pages().filter((p) => !p.isClosed())
        if (availablePages.length > 0) {
          return availablePages[0]
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      throw new Error(NO_PAGES_AVAILABLE_ERROR)
    }

    const page = await context.newPage()
    this.setupPageListeners(page)
    const pageUrl = page.url()
    if (pageUrl === 'about:blank') {
      return page
    }

    // Avoid burning the full timeout on about:blank-like pages.
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

  getSessionMetadata(): SessionMetadata {
    return this.sessionMetadata
  }
}

/**
 * Session manager for multiple executors, keyed by session ID (typically cwd hash)
 */
export class ExecutorManager {
  private executors = new Map<string, PlaywrightExecutor>()
  private cdpConfig: CdpConfig | ((sessionId: string) => CdpConfig)
  private logger: ExecutorLogger

  constructor(options: { cdpConfig: CdpConfig | ((sessionId: string) => CdpConfig); logger?: ExecutorLogger }) {
    this.cdpConfig = options.cdpConfig
    this.logger = options.logger || { log: console.log, error: console.error }
  }

  getExecutor(options: { sessionId: string; cwd?: string; sessionMetadata?: SessionMetadata }): PlaywrightExecutor {
    const { sessionId, cwd, sessionMetadata } = options
    let executor = this.executors.get(sessionId)
    if (!executor) {
      const baseConfig = typeof this.cdpConfig === 'function' ? this.cdpConfig(sessionId) : this.cdpConfig
      const cdpConfig = sessionMetadata?.extensionId
        ? { ...baseConfig, extensionId: sessionMetadata.extensionId }
        : baseConfig
      executor = new PlaywrightExecutor({
        cdpConfig,
        sessionMetadata,
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

  getSession(sessionId: string): PlaywrightExecutor | null {
    return this.executors.get(sessionId) || null
  }

  listSessions(): Array<{
    id: string
    stateKeys: string[]
    extensionId: string | null
    browser: string | null
    profile: { email: string; id: string } | null
  }> {
    return [...this.executors.entries()].map(([id, executor]) => {
      const metadata = executor.getSessionMetadata()
      return {
        id,
        stateKeys: executor.getStateKeys(),
        extensionId: metadata.extensionId,
        browser: metadata.browser,
        profile: metadata.profile,
      }
    })
  }
}
