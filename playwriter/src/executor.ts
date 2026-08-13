/**
 * PlaywrightExecutor - Manages browser connection and code execution per session.
 * Used by both MCP and CLI to execute Playwright code with persistent state.
 */

import type { Page, Frame, Browser, BrowserContext, Locator, FrameLocator, ElementHandle } from '@xmorse/playwright-core'
import { getChromium, isPatchrightEnabled } from './playwright-import.js'
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
import { getCdpUrl, parseRelayHost, shouldAutoEnablePlaywriter } from './utils.js'
import { getExtensionOutdatedWarning } from './relay-client.js'
import { waitForPageLoad, WaitForPageLoadOptions, WaitForPageLoadResult } from './wait-for-page-load.js'
import { ICDPSession, getCDPSessionForPage } from './cdp-session.js'
import { Debugger } from './debugger.js'
import { Editor } from './editor.js'
import { getStylesForLocator, formatStylesAsText, type StylesResult } from './styles.js'
import { getReactSource, getReactComponentInfo, type ReactSourceLocation } from './react-source.js'
import { ScopedFS } from './scoped-fs.js'
import {
  screenshotWithAccessibilityLabels,
  getAriaSnapshot,
  resizeImageForAgent,
  type ScreenshotResult,
  type SnapshotFormat,
} from './aria-snapshot.js'
import { createGhostBrowserChrome, type GhostBrowserCommandResult } from './ghost-browser.js'
export type { SnapshotFormat }
import { getCleanHTML, type GetCleanHTMLOptions } from './clean-html.js'
import { getPageMarkdown, type GetPageMarkdownOptions } from './page-markdown.js'
import { createRecordingApi, createStreamApi } from './screen-recording.js'
import { createDemoVideo } from './ffmpeg.js'
import { type GhostCursorClientOptions } from './ghost-cursor.js'
import { GhostCursorController } from './ghost-cursor-controller.js'


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
  process,
} as const

/**
 * Parse code and check if it's a single expression that should be auto-returned.
 * Returns the exact expression source (without trailing semicolon) using AST
 * node offsets, or null if the code should not be auto-wrapped. See #58.
 */
export function getAutoReturnExpression(code: string): string | null {
  try {
    const ast = acorn.parse(code, {
      ecmaVersion: 'latest',
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      sourceType: 'script',
    })

    // Must be exactly one statement
    if (ast.body.length !== 1) {
      return null
    }

    const stmt = ast.body[0]

    // If it's already a return statement, don't auto-wrap
    if (stmt.type === 'ReturnStatement') {
      return null
    }

    // Must be an ExpressionStatement
    if (stmt.type !== 'ExpressionStatement') {
      return null
    }

    // Don't auto-return side-effect expressions
    const expr = stmt.expression
    if (
      expr.type === 'AssignmentExpression' ||
      expr.type === 'UpdateExpression' ||
      (expr.type === 'UnaryExpression' && expr.operator === 'delete')
    ) {
      return null
    }

    // Don't auto-return sequence expressions that contain assignments
    if (expr.type === 'SequenceExpression') {
      const hasAssignment = expr.expressions.some((e) => e.type === 'AssignmentExpression')
      if (hasAssignment) {
        return null
      }
    }

    // Use the expression node's start/end offsets to extract just the expression
    // source, excluding any trailing semicolon. This is more robust than regex.
    return code.slice(expr.start, expr.end)
  } catch {
    // Parse failed, don't auto-return
    return null
  }
}

/** Backward-compatible helper: returns true if code should be auto-wrapped. */
export function shouldAutoReturn(code: string): boolean {
  return getAutoReturnExpression(code) !== null
}

/**
 * Wraps user code in an async IIFE for vm execution.
 * Uses AST node offsets to extract the expression without trailing semicolons,
 * avoiding SyntaxError when embedding inside `return await (...)`. See #58.
 */
export function wrapCode(code: string): string {
  const expr = getAutoReturnExpression(code)
  if (expr !== null) {
    return `(async () => { return await (${expr}) })()`
  }
  return `(async () => { ${code} })()`
}

const EXTENSION_NOT_CONNECTED_ERROR = `The Playwriter Chrome extension is not connected. Make sure you have:
1. Installed the extension: https://chromewebstore.google.com/detail/playwriter-mcp/jfeammnjpkecdekppnclgkkffahnhfhe
2. Clicked the extension icon on a tab to enable it (or refreshed the page if just installed)
3. Or use a cloud browser instead: run \`playwriter cloud login\` in your terminal to rent a browser in the cloud, with auto CAPTCHA solving, residential proxies and anti-detection built in`

const NO_PAGES_AVAILABLE_ERROR =
  'No Playwright pages are available. Enable Playwriter on a tab or unset PLAYWRITER_AUTO_ENABLE=false to auto-create one.'

const CLOUD_SESSION_EXPIRED_ERROR =
  'Cloud browser session expired or was destroyed. Create a new session with: playwriter session new --browser cloud'

/** Patterns that indicate the browser/page/context was closed or the WebSocket died.
 *  Used to detect cloud VM expiration vs other Playwright errors. */
const DISCONNECTION_PATTERNS = [
  'browser has been closed',
  'browser.close',
  'Target page, context or browser has been closed',
  'Target closed',
  'connection refused',
  'WebSocket is not open',
  'WebSocket error',
  'connect ECONNREFUSED',
  'Session closed',
  'Connection closed',
  'NS_ERROR_NET_RESET',
]

function isDisconnectionError(error: Error): boolean {
  const msg = error.message || ''
  const stack = error.stack || ''
  const matchesHere = DISCONNECTION_PATTERNS.some((pattern) => {
    return msg.includes(pattern) || stack.includes(pattern)
  })
  if (matchesHere) return true
  // Walk the cause chain — ensureConnection wraps the real WebSocket error
  // in a new Error with { cause }, so we need to check nested causes too.
  if (error.cause instanceof Error) {
    return isDisconnectionError(error.cause)
  }
  return false
}

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

export interface ExecuteScreenshot {
  path: string
  base64: string
  mimeType: 'image/png'
  snapshot: string
  labelCount: number
}

export interface ExecuteResult {
  text: string
  images: Array<{ data: string; mimeType: string }>
  screenshots: ExecuteScreenshot[]
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
  /** Direct CDP WebSocket URL — bypasses relay + extension, connects straight to Chrome */
  directCdpUrl?: string
  /** Launch a headless Chrome via chromium.launch() instead of connecting to an existing one.
   *  Uses direct Playwright browser management, no extension or relay CDP routing needed. */
  headless?: boolean
}

export interface SessionMetadata {
  extensionId: string | null
  browser: string | null
  profile: { email: string; id: string } | null
}

export interface SessionInfo {
  id: string
  stateKeys: string[]
  extensionId: string | null
  browser: string | null
  profile: { email: string; id: string } | null
  cwd: string | null
}

export interface CloudSessionInfo {
  /** Timestamp (epoch ms) when the BU VM will hard-timeout */
  timeoutAt?: number
  /** Whether proxy is enabled — when true, images/video/fonts are blocked to save bandwidth.
   *  Set to false via --disable-proxy-bandwidth-acceleration to allow all resources. */
  blockProxyResources?: boolean
}

export interface ExecutorOptions {
  cdpConfig: CdpConfig
  sessionMetadata?: SessionMetadata
  logger?: ExecutorLogger
  /** Working directory for scoped fs access */
  cwd?: string
  /** Set when this executor is connected to a cloud Browser Use VM */
  cloudSession?: CloudSessionInfo
}

function isRegExp(value: any): value is RegExp {
  return (
    typeof value === 'object' && value !== null && typeof value.test === 'function' && typeof value.exec === 'function'
  )
}

function isPromise(value: any): value is Promise<unknown> {
  return typeof value === 'object' && value !== null && typeof value.then === 'function'
}

/**
 * Duck-type check for a Playwright ChannelOwner (Response, Page, Browser,
 * Request, Frame, BrowserContext, etc.). Used to skip auto-printing these
 * objects from the REPL — they're meant for programmatic use, and dumping
 * them risks leaking internal fields. Users can still `console.log(obj)` to
 * inspect them via the safe handler in playwright-core. See issue #82.
 */
export function isPlaywrightChannelOwner(value: any): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value._type === 'string' &&
    typeof value._guid === 'string' &&
    value._connection !== undefined
  )
}

export class PlaywrightExecutor {
  private isConnected = false
  private page: Page | null = null
  private browser: Browser | null = null
  private context: BrowserContext | null = null

  private userState: Record<string, any> = {}
  private browserLogs: Map<Page, string[]> = new Map()
  // Tracks the index up to which getLatestLogs({ sinceLastCall: true }) has
  // returned logs. 0 means "return everything" (first call gets full buffer).
  // When addBrowserLog shifts old entries (cap at MAX_LOGS_PER_PAGE), cursors
  // are decremented so they stay in sync with the array.
  private pageLogCursor: Map<Page, number> = new Map()
  private lastSnapshots: WeakMap<Page, Map<string, string>> = new WeakMap()
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
  private sessionCwd: string | null
  private hasWarnedExtensionOutdated = false

  private ghostCursorController: GhostCursorController
  /** Non-null when this executor is backed by a cloud Browser Use VM */
  private cloudSession: CloudSessionInfo | null
  /** Last minute bucket for which a cloud timeout warning was enqueued (dedup) */
  private lastCloudTimeoutWarningMinute: number | null = null

  constructor(options: ExecutorOptions) {
    this.cdpConfig = options.cdpConfig
    this.logger = options.logger || { log: console.log, error: console.error }
    this.sessionMetadata = options.sessionMetadata || { extensionId: null, browser: null, profile: null }
    this.sessionCwd = options.cwd ? path.resolve(options.cwd) : null
    this.cloudSession = options.cloudSession || null
    // ScopedFS expects an array of allowed directories. If cwd is provided, use it; otherwise use defaults.
    this.scopedFs = new ScopedFS(
      this.sessionCwd ? [this.sessionCwd, '/tmp', os.tmpdir()] : undefined,
      this.sessionCwd || undefined,
    )
    this.sandboxedRequire = this.createSandboxedRequire(require)
    this.ghostCursorController = new GhostCursorController({
      logger: {
        error: (...args: unknown[]) => {
          this.logger.error(...args)
        },
      },
    })
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

  /** Block images, video, and font resources via Network.setBlockedURLs to save
   *  residential proxy bandwidth. Single CDP command, zero per-request overhead.
   *  Applied per-context on every page (existing and future). */
  private async applyProxyResourceBlocking(context: BrowserContext): Promise<void> {
    // URL patterns using the URLPattern spec syntax (absolute patterns).
    // Covers the vast majority of image/video/font resources by file extension.
    const blockedPatterns = [
      // Images (SVGs excluded — lightweight and often used for icons/UI)
      '*.png', '*.jpg', '*.jpeg', '*.gif', '*.webp', '*.ico', '*.bmp', '*.avif',
    ]

    const applyToPage = async (page: Page) => {
      try {
        const cdpSession = await page.context().newCDPSession(page)
        await cdpSession.send('Network.enable')
        await cdpSession.send('Network.setBlockedURLs', {
          urls: blockedPatterns,
        })
        await cdpSession.detach()
      } catch (err) {
        // Best-effort: don't break the session if blocking fails
        this.logger.error('Failed to apply proxy resource blocking:', err)
      }
    }

    // Apply to existing pages
    const pages = context.pages().filter((p) => !p.isClosed())
    await Promise.all(pages.map(applyToPage))

    // Apply to future pages
    context.on('page', (page) => {
      applyToPage(page)
    })

    this.logger.log('Proxy bandwidth acceleration enabled: blocking raster images')
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

  enqueueWarning(message: string) {
    this.nextWarningEventId += 1
    this.warningEvents.push({ id: this.nextWarningEventId, message })
  }

  /** Update the cloud session timeout from external tracking (relay timer). */
  updateCloudTimeout(timeoutAt: number) {
    if (this.cloudSession) {
      this.cloudSession.timeoutAt = timeoutAt
    }
  }

  private beginWarningScope(): WarningScope {
    // Use lastDeliveredWarningEventId as cursor (not nextWarningEventId) so
    // warnings enqueued by the relay interval between execute() calls are
    // picked up by the next scope. Using nextWarningEventId would skip them.
    const scope: WarningScope = {
      cursor: this.lastDeliveredWarningEventId,
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
      // Enqueue so MCP agents see version-skew messages in their next execute
      // response — logger.log alone only reaches stdout, not the LLM.
      this.enqueueWarning(warning)
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
    this.setupNewPageLogging(page)
    this.ghostCursorController.attachToPage({ page })
    page.on('close', () => {
      this.ghostCursorController.detachFromPage({ page })
    })
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

  private setupNewPageLogging(page: Page) {
    // page.on('popup') fires for window.open, target=_blank, and cmd+click
    // (but not context.newPage() or CDP reconnection). The extension
    // auto-relocates popups to tabs, so these pages are controllable via
    // context.pages(). Enqueue synchronously so the warning lands in the
    // enclosing execute() call's scope. initialUrl may be 'about:blank'
    // for blank-then-scripted popups.
    page.on('popup', (popup) => {
      const pages = popup.context().pages()
      const rawIndex = pages.indexOf(popup)
      const pageIndex = rawIndex >= 0 ? String(rawIndex) : 'unknown'
      const initialUrl = popup.url() || 'about:blank'
      this.enqueueWarning(
        `New page opened from current page (index ${pageIndex}, initial url: ${initialUrl}). ` +
          `Access it via context.pages()[${pageIndex}] to interact with it.`,
      )
    })
  }

  private setupPageConsoleListener(page: Page) {
    if (!this.browserLogs.has(page)) {
      this.browserLogs.set(page, [])
    }

    // Logs are NOT cleared on navigation so that getLatestLogs({ sinceLastCall: true })
    // can return errors from the previous page load. The MAX_LOGS_PER_PAGE cap (5000)
    // prevents unbounded growth; old entries are shifted out in addBrowserLog.

    page.on('close', () => {
      this.browserLogs.delete(page)
      this.pageLogCursor.delete(page)
    })

    page.on('console', (msg) => {
      try {
        const logEntry = `[${msg.type()}] ${msg.text()}`
        this.addBrowserLog({ page, logEntry })
      } catch (e) {
        this.logger.error('[Executor] Failed to get console message text:', e)
      }
    })

    page.on('pageerror', (error) => {
      this.addBrowserLog({ page, logEntry: `[pageerror] ${error.message}` })
    })
  }

  private addBrowserLog(options: { page: Page; logEntry: string }) {
    if (!this.browserLogs.has(options.page)) {
      this.browserLogs.set(options.page, [])
    }
    const pageLogs = this.browserLogs.get(options.page)!
    pageLogs.push(options.logEntry)
    if (pageLogs.length > MAX_LOGS_PER_PAGE) {
      pageLogs.shift()
      // Decrement cursor so it stays in sync with the shifted array.
      // Clamp to 0 so the cursor never goes negative.
      const cursor = this.pageLogCursor.get(options.page)
      if (cursor !== undefined && cursor > 0) {
        this.pageLogCursor.set(options.page, cursor - 1)
      }
    }
  }

  private pagesRelatedToPage(page: Page): Page[] {
    const frameUrls = new Set(
      page
        .frames()
        .map((frame) => {
          return frame.url()
        })
        .filter((url) => {
          return url && url !== 'about:blank'
        }),
    )

    return page
      .context()
      .pages()
      .filter((candidate) => {
        return candidate === page || frameUrls.has(candidate.url())
      })
  }

  private async checkExtensionStatus(): Promise<{
    connected: boolean
    activeTargets: number
    playwriterVersion: string | null
  }> {
    const { host = '127.0.0.1', port = 19988, extensionId, token } = this.cdpConfig
    const { httpBaseUrl } = parseRelayHost(host, port)
    const notConnected = { connected: false, activeTargets: 0, playwriterVersion: null }
    const headers: Record<string, string> = {}
    const effectiveToken = token || process.env.PLAYWRITER_TOKEN
    if (effectiveToken) {
      headers['Authorization'] = `Bearer ${effectiveToken}`
    }
    try {
      if (extensionId) {
        const response = await fetch(`${httpBaseUrl}/extensions/status`, {
          signal: AbortSignal.timeout(2000),
          headers,
        })
        if (!response.ok) {
          const fallback = await fetch(`${httpBaseUrl}/extension/status`, {
            signal: AbortSignal.timeout(2000),
            headers,
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
        headers,
      })
      if (!response.ok) {
        return notConnected
      }
      return (await response.json()) as { connected: boolean; activeTargets: number; playwriterVersion: string | null }
    } catch {
      return notConnected
    }
  }

  private isDirectCdpMode(): boolean {
    return !!this.cdpConfig.directCdpUrl
  }

  private isHeadlessMode(): boolean {
    return !!this.cdpConfig.headless
  }

  /**
   * Connect to Chrome and set up context/page. Shared by ensureConnection and reset.
   * In headless mode, launches Chrome via chromium.launch().
   * In direct CDP mode, connects straight to Chrome's WebSocket.
   * In extension mode, checks extension status then connects via relay.
   */
  private async connectToBrowser(): Promise<{ browser: Browser; page: Page; context: BrowserContext }> {
    // Headless mode: launch Chrome directly via Playwright (no extension, no relay CDP routing)
    if (this.isHeadlessMode()) {
      return this.connectHeadlessBrowser()
    }

    if (this.isDirectCdpMode()) {
      // Direct CDP: connect straight to Chrome, no relay or extension needed
      const chromium = await getChromium()
      const browser = await chromium.connectOverCDP(this.cdpConfig.directCdpUrl!)

      browser.on('disconnected', () => {
        this.logger.log('Browser disconnected, clearing connection state')
        this.clearConnectionState()
      })

      const contexts = browser.contexts()
      const context = contexts.length > 0 ? contexts[0] : await browser.newContext()

      context.setDefaultTimeout(60000)
      context.setDefaultNavigationTimeout(10000)

      context.on('page', (page) => {
        this.setupPageListeners(page)
      })

      context.pages().forEach((p) => this.setupPageListeners(p))

      // In direct CDP mode, pages are always available (all tabs visible).
      // Use the first non-closed page, or create one.
      const pages = context.pages().filter((p) => !p.isClosed())
      const page = pages.length > 0 ? pages[0] : await context.newPage()
      this.setupPageListeners(page)

      await this.setDeviceScaleFactorForMacOS(context)

      // Block images, video, and fonts for cloud sessions with proxy enabled
      // to reduce residential proxy bandwidth costs. Uses Network.setBlockedURLs
      // which is a single fire-and-forget CDP command with zero per-request overhead.
      if (this.cloudSession?.blockProxyResources) {
        await this.applyProxyResourceBlocking(context)
      }

      return { browser, page, context }
    }

    // Extension mode: check status first for better error messages
    const extensionStatus = await this.checkExtensionStatus()
    if (!extensionStatus.connected) {
      throw new Error(EXTENSION_NOT_CONNECTED_ERROR)
    }
    this.warnIfExtensionOutdated(extensionStatus.playwriterVersion)

    const cdpUrl = getCdpUrl(this.cdpConfig)
    const chromium = await getChromium()
    const browser = await chromium.connectOverCDP(cdpUrl)

    browser.on('disconnected', () => {
      this.logger.log('Browser disconnected, clearing connection state')
      this.clearConnectionState()
    })

    const contexts = browser.contexts()
    const context = contexts.length > 0 ? contexts[0] : await browser.newContext()

    // Action timeout (click, fill, hover, etc.) is longer to tolerate slower
    // SPA/Turbo navigations and post-click settling on real sites.
    // Navigation timeout (goto, reload) remains separate.
    context.setDefaultTimeout(60000)
    context.setDefaultNavigationTimeout(10000)

    context.on('page', (page) => {
      this.setupPageListeners(page)
    })

    context.pages().forEach((p) => this.setupPageListeners(p))
    const page = await this.ensurePageForContext({ context, timeout: 10000 })

    await this.setDeviceScaleFactorForMacOS(context)

    return { browser, page, context }
  }

  /**
   * Launch a headless Chrome via chromium.launch(). No extension, no relay CDP routing.
   * Reuses an existing shared browser if one was already launched for headless mode.
   * Does NOT add per-session disconnect listeners to avoid accumulation on the shared
   * browser; instead, ensureConnection checks browser.isConnected() on each call.
   */
  private async connectHeadlessBrowser(): Promise<{ browser: Browser; page: Page; context: BrowserContext }> {
    const browser = await PlaywrightExecutor.getOrLaunchHeadlessBrowser()

    const context = await browser.newContext()
    try {
      context.setDefaultTimeout(60000)
      context.setDefaultNavigationTimeout(10000)

      context.on('page', (page) => {
        this.setupPageListeners(page)
      })

      const page = await context.newPage()
      this.setupPageListeners(page)

      await this.setDeviceScaleFactorForMacOS(context)

      PlaywrightExecutor._headlessExecutors.add(this)
      return { browser, page, context }
    } catch (e) {
      // Clean up the partially created context so it doesn't leak on the
      // long-lived shared browser.
      await context.close().catch(() => {})
      throw e
    }
  }

  /** Shared headless browser instance across all headless sessions.
   *  Uses a launch promise to prevent concurrent first-session races from
   *  spawning multiple browsers. The disconnect handler is registered once
   *  at launch time and clears both statics so the next session relaunches. */
  private static _sharedHeadlessBrowser: Browser | null = null
  private static _sharedHeadlessBrowserPromise: Promise<Browser> | null = null
  /** Active headless executors sharing the browser. Using a Set instead of a
   *  counter makes tracking idempotent: reset() re-adds the same executor (no-op),
   *  and concurrent deletes can't double-decrement. When the set empties after
   *  a session delete, the shared browser is auto-closed. */
  private static _headlessExecutors = new Set<PlaywrightExecutor>()

  private static async getOrLaunchHeadlessBrowser(): Promise<Browser> {
    // Check the cached browser is actually alive (not just non-null after a crash)
    if (PlaywrightExecutor._sharedHeadlessBrowser?.isConnected()) {
      return PlaywrightExecutor._sharedHeadlessBrowser
    }

    // Deduplicate concurrent launches: second caller awaits the first's promise
    if (PlaywrightExecutor._sharedHeadlessBrowserPromise) {
      return PlaywrightExecutor._sharedHeadlessBrowserPromise
    }

    const launchPromise = (async () => {
      const chromium = await getChromium()
      const { resolveBrowserExecutablePath } = await import('./browser-config.js')
      const executablePath = resolveBrowserExecutablePath()

      const browser = await chromium.launch({
        headless: true,
        executablePath,
      })

      // Single handler registered once per browser lifetime.
      // Only clears statics if this is still the current shared browser;
      // prevents an old browser's disconnect from wiping state for a newer one
      // (race: new session launches while old browser.close() is in progress).
      browser.on('disconnected', () => {
        if (PlaywrightExecutor._sharedHeadlessBrowser !== browser) {
          return
        }
        PlaywrightExecutor._sharedHeadlessBrowser = null
        PlaywrightExecutor._sharedHeadlessBrowserPromise = null
        PlaywrightExecutor._headlessExecutors.clear()
      })

      PlaywrightExecutor._sharedHeadlessBrowser = browser
      // Clear the promise now that the browser is cached; future callers
      // use _sharedHeadlessBrowser directly. Concurrent waiters already
      // hold a reference to launchPromise so they still resolve correctly.
      PlaywrightExecutor._sharedHeadlessBrowserPromise = null
      return browser
    })()

    PlaywrightExecutor._sharedHeadlessBrowserPromise = launchPromise
    try {
      return await launchPromise
    } catch (error) {
      PlaywrightExecutor._sharedHeadlessBrowserPromise = null
      throw error
    }
  }

  /** Close the headless context for this session (called on session delete).
   *  When the last headless executor is removed, the shared browser is also
   *  closed automatically so the Chrome process doesn't linger. */
  async closeHeadlessContext(): Promise<void> {
    if (!this.isHeadlessMode()) {
      return
    }
    const context = this.context
    this.clearConnectionState()

    if (context) {
      await context.close().catch((e) => {
        this.logger.error('Error closing headless context:', e)
      })
    }

    const wasTracked = PlaywrightExecutor._headlessExecutors.delete(this)
    if (wasTracked && PlaywrightExecutor._headlessExecutors.size === 0) {
      await PlaywrightExecutor.closeSharedHeadlessBrowser()
    }
  }

  /** Close the shared headless browser (called on relay shutdown or when last
   *  session is deleted). Nulls statics before awaiting close so concurrent
   *  callers of getOrLaunchHeadlessBrowser() launch a fresh browser instead
   *  of reusing one that is mid-shutdown. */
  static async closeSharedHeadlessBrowser(): Promise<void> {
    const browser = PlaywrightExecutor._sharedHeadlessBrowser
    if (browser) {
      // Detach from statics first so new sessions don't reuse a dying browser.
      // The disconnect handler checks identity, so it becomes a no-op for this browser.
      PlaywrightExecutor._sharedHeadlessBrowser = null
      PlaywrightExecutor._sharedHeadlessBrowserPromise = null
      await browser.close().catch(() => {})
    }
  }

  private async ensureConnection(): Promise<{ browser: Browser; page: Page }> {
    // In headless mode, also check the shared browser is still alive.
    // After a crash, isConnected() returns false and we need to reconnect.
    const browserAlive = this.isHeadlessMode() ? this.browser?.isConnected() : true
    if (this.isConnected && this.browser && this.page && browserAlive) {
      return { browser: this.browser, page: this.page }
    }

    try {
      const { browser, page, context } = await this.connectToBrowser()

      this.browser = browser
      this.page = page
      this.context = context
      this.isConnected = true

      return { browser, page }
    } catch (error) {
      // Cloud sessions that fail to connect are likely expired VMs.
      // Give a clear error instead of a cryptic WebSocket/connection error.
      if (this.cloudSession && error instanceof Error && isDisconnectionError(error)) {
        throw new Error(CLOUD_SESSION_EXPIRED_ERROR, { cause: error })
      }
      throw error
    }
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
    this.suppressPageCloseWarnings = true
    try {
      if (this.isHeadlessMode()) {
        // In headless mode, only close this session's context, not the shared browser.
        // Other headless sessions share the same browser instance.
        if (this.context) {
          await this.context.close().catch((e) => {
            this.logger.error('Error closing context:', e)
          })
        }
      } else if (this.browser) {
        await this.browser.close()
      }
    } catch (e) {
      this.logger.error('Error closing browser:', e)
    } finally {
      this.suppressPageCloseWarnings = false
    }

    this.clearConnectionState()
    this.clearUserState()

    const { browser, page, context } = await this.connectToBrowser()

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
      // Warn if cloud VM is approaching its hard timeout (deduped by minute bucket)
      if (this.cloudSession?.timeoutAt) {
        const remainingMs = this.cloudSession.timeoutAt - Date.now()
        if (remainingMs <= 0) {
          throw new Error(CLOUD_SESSION_EXPIRED_ERROR)
        }
        if (remainingMs < 5 * 60_000) {
          const mins = Math.ceil(remainingMs / 60_000)
          if (this.lastCloudTimeoutWarningMinute !== mins) {
            this.lastCloudTimeoutWarningMinute = mins
            this.enqueueWarning(
              `Cloud browser expires in ~${mins} minute${mins === 1 ? '' : 's'}. ` +
                `Create a new session soon with: playwriter session new --browser cloud`,
            )
          }
        }
      }

      await this.ensureConnection()
      const page = await this.getCurrentPage(timeout)
      const context = this.context || page.context()

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
          showDiffSinceLastCall = !search,
          interactiveOnly = false,
        } = options
        // A locator's page is authoritative; the default page may be another open tab.
        const resolvedPage = locator?.page() || targetPage || page
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
        // Cache keyed by locator selector so full-page and locator-scoped snapshots
        // don't pollute each other's diff baselines
        const snapshotKey = locator ? `locator:${locator.selector()}` : 'page'
        let pageSnapshots = this.lastSnapshots.get(resolvedPage)
        if (!pageSnapshots) {
          pageSnapshots = new Map()
          this.lastSnapshots.set(resolvedPage, pageSnapshots)
        }
        const previousSnapshot = shouldCacheSnapshot ? pageSnapshots.get(snapshotKey) : undefined
        if (shouldCacheSnapshot) {
          pageSnapshots.set(snapshotKey, snapshotStr)
        }

        // Diff defaults off when search is provided, but agent can explicitly enable both
        if (showDiffSinceLastCall && previousSnapshot && shouldCacheSnapshot) {
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

      const getLatestLogs = async (options?: {
        page?: Page
        count?: number
        search?: string | RegExp
        // When true, only return logs added since the last getLatestLogs call
        // with sinceLastCall: true. First call returns all buffered logs.
        // Cursors are tracked per page so navigations and new logs are
        // never missed. Useful for checking page errors after each action.
        sinceLastCall?: boolean
      }) => {
        const { page: filterPage, count, search, sinceLastCall = false } = options || {}
        let allLogs: string[] = []

        // Collect logs, optionally slicing from cursor when sinceLastCall is set
        const collectLogs = (targetPage: Page): string[] => {
          const logs = this.browserLogs.get(targetPage) || []
          if (!sinceLastCall) {
            return logs
          }
          const cursor = this.pageLogCursor.get(targetPage) || 0
          return logs.slice(cursor)
        }

        if (filterPage) {
          const relatedPages = this.pagesRelatedToPage(filterPage)
          allLogs = relatedPages.flatMap((relatedPage) => {
            return collectLogs(relatedPage)
          })
        } else {
          for (const [p] of this.browserLogs) {
            allLogs.push(...collectLogs(p))
          }
        }

        // Advance cursors after collecting so next sinceLastCall call starts fresh
        if (sinceLastCall) {
          const pagesToAdvance = filterPage
            ? this.pagesRelatedToPage(filterPage)
            : [...this.browserLogs.keys()]
          for (const p of pagesToAdvance) {
            const logs = this.browserLogs.get(p)
            if (logs) {
              this.pageLogCursor.set(p, logs.length)
            }
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
        this.pageLogCursor.clear()
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

      const getReactComponentInfoFn = async (options: { locator: Locator | ElementHandle }) => {
        const targetPage = await (async (): Promise<Page | null> => {
          if ('page' in options.locator) {
            return options.locator.page()
          }

          return (await options.locator.ownerFrame())?.page() ?? null
        })()
        if (!targetPage) {
          throw new Error('Could not get page from locator')
        }
        const cdp = await getCDPSession({ page: targetPage })
        return getReactComponentInfo({ locator: options.locator, cdp })
      }

      const inspectPinnedElement = async (pageUrl: string, elementExpression: string) => {
        const targetPage = context.pages().find((candidate) => candidate.url() === pageUrl) || context.pages()[0]
        if (!targetPage) {
          throw new Error('No Playwright pages are available')
        }

        this.userState.page = targetPage
        const handle = (await targetPage.evaluateHandle((expression) => {
          return Function(`return (${expression})`)()
        }, elementExpression)).asElement()

        const result = await (async () => {
          if (!handle) {
            return { url: targetPage.url(), outerHTML: null, react: null }
          }
          return {
            url: targetPage.url(),
            outerHTML: await handle.evaluate((el) => el.outerHTML),
            react: await getReactComponentInfoFn({ locator: handle }),
          }
        })()

        console.log(result)
        return result
      }

      const screenshotCollector: ScreenshotResult[] = []
      // Separate collector for images produced by resizeImageForAgent() calls.
      // These get merged into result.images so the CLI can emit them via Kitty Graphics.
      const resizedImageCollector: Array<{ data: string; mimeType: string }> = []

      const resizeImageForAgentFn: typeof resizeImageForAgent = async (options) => {
        const result = await resizeImageForAgent(options)
        resizedImageCollector.push({ data: result.buffer.toString('base64'), mimeType: result.mimeType })
        return result
      }

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
      const ghostCursorController = this.ghostCursorController

      const showGhostCursor = async (options?: ({ page?: Page } & GhostCursorClientOptions)) => {
        const targetPage = options?.page || page
        const cursorOptions: GhostCursorClientOptions | undefined = (() => {
          if (!options) {
            return undefined
          }

          const { page: _ignoredPage, ...rest } = options
          return rest
        })()

        await ghostCursorController.show({ page: targetPage, cursorOptions })
      }

      const hideGhostCursor = async (options?: { page?: Page }) => {
        const targetPage = options?.page || page
        await ghostCursorController.hide({ page: targetPage })
      }

      const recordingApi = createRecordingApi({
        context,
        defaultPage: page,
        relayPort,
        ghostCursorController,
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

      // Live RTMP streaming: pipes tabCapture chunks to ffmpeg in the relay
      // process. Streams keep running after execute() returns and CLI exits.
      const streamApi = createStreamApi({
        defaultPage: page,
        relayPort,
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
        browser: this.browser,
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
        getReactComponentInfo: getReactComponentInfoFn,
        inspectPinnedElement,
        screenshotWithAccessibilityLabels: screenshotWithAccessibilityLabelsFn,
        resizeImageForAgent: resizeImageForAgentFn,
        // Backward-compatible alias for resizeImageForAgent
        resizeImage: resizeImageForAgentFn,
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
        stream: {
          start: streamApi.start,
          stop: streamApi.stop,
          status: streamApi.status,
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
          vmContextObj.browser = self.browser
          return { page: newPage, context: newContext }
        },
        require: this.sandboxedRequire,
        import: (specifier: string) => import(specifier),
        // Ghost Browser API - only works in Ghost Browser, mirrors chrome.ghostPublicAPI etc
        chrome: chromeGhostBrowser,
        ...usefulGlobals,
        // Expose process with safety overrides:
        // - cwd() returns the session's cwd instead of the relay server's cwd
        // - exit() is blocked to prevent killing the relay server
        // - chdir() is blocked to prevent affecting other sessions
        process: new Proxy(process, {
          get(target, prop, receiver) {
            if (prop === 'cwd') return () => self.sessionCwd || target.cwd()
            if (prop === 'exit') return () => { throw new Error('process.exit() is not allowed in the sandbox') }
            if (prop === 'chdir') return () => { throw new Error('process.chdir() is not allowed in the sandbox, use a new session with a different cwd instead') }
            return Reflect.get(target, prop, receiver)
          },
        }),
      }

      const vmContext = vm.createContext(vmContextObj)
      const autoReturnExpr = getAutoReturnExpression(code)
      const wrappedCode = autoReturnExpr !== null
        ? `(async () => { return await (${autoReturnExpr}) })()`
        : `(async () => { ${code} })()`
      const hasExplicitReturn = autoReturnExpr !== null || /\breturn\b/.test(code)

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
        // Auto-returned Playwright handles (Response, Page, Browser, Request,
        // Frame, etc.) are silently skipped — they're programmatic references,
        // not useful display data. Users can `console.log(response)` or
        // return specific fields (`return response.url()`) to see values.
        // See issue #82.
        if (resolvedResult !== undefined && !isPlaywrightChannelOwner(resolvedResult)) {
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

      const MAX_LENGTH = 10000
      let finalText = responseText.trim()
      if (finalText.length > MAX_LENGTH) {
        finalText =
          finalText.slice(0, MAX_LENGTH) +
          `\n\n[Truncated to ${MAX_LENGTH} characters. Use search to find specific content]`
      }

      const images = [
        ...screenshotCollector.map((s) => ({ data: s.base64, mimeType: s.mimeType })),
        ...resizedImageCollector,
      ]
      const screenshots: ExecuteScreenshot[] = screenshotCollector.map((s) => ({
        path: s.path,
        base64: s.base64,
        mimeType: s.mimeType,
        snapshot: s.snapshot,
        labelCount: s.labelCount,
      }))

      return { text: finalText, images, screenshots, isError: false }
    } catch (error: any) {
      const errorStack = error.stack || error.message
      const isTimeoutError =
        error instanceof CodeExecutionTimeoutError || error?.name === 'TimeoutError' || error?.name === 'AbortError'

      this.logger.error('Error in execute:', errorStack)

      const logsText = formatConsoleLogs(consoleLogs, 'Console output (before error)')
      const warningText = this.flushWarningsForScope(warningScope)

      // Cloud sessions: disconnection errors mean the VM expired or was destroyed.
      // Give a clear actionable message instead of a generic "call reset" hint.
      const isDisconnect = error instanceof Error && isDisconnectionError(error)
      const resetHint = (() => {
        if (isTimeoutError) return ''
        if (this.cloudSession && isDisconnect) {
          return `\n\n[Cloud browser expired or disconnected. Create a new session with: playwriter session new --browser cloud]`
        }
        return '\n\n[HINT: If this is an internal Playwright error, page/browser closed, or connection issue, call reset to reconnect.]'
      })()

      // timeout stacks are internal noise (Promise.race / setTimeout); only show the message
      const errorText = isTimeoutError ? error.message : errorStack
      return {
        text: `${logsText}${warningText}\nError executing code: ${errorText}${resetHint}`,
        images: [],
        screenshots: [],
        isError: true,
      }
    }
  }

  // When extension is connected but has no pages, auto-create unless PLAYWRITER_AUTO_ENABLE=false disables it.
  // In direct CDP mode, always create a page (no extension check needed).
  private async ensurePageForContext(options: { context: BrowserContext; timeout: number }): Promise<Page> {
    const { context, timeout } = options
    const pages = context.pages().filter((p) => !p.isClosed())
    if (pages.length > 0) {
      return pages[0]
    }

    // Direct CDP mode: always create a new page, no extension involved
    if (this.isDirectCdpMode()) {
      const page = await context.newPage()
      this.setupPageListeners(page)
      await page.waitForLoadState('domcontentloaded', { timeout }).catch(() => {})
      return page
    }

    const extensionStatus = await this.checkExtensionStatus()
    if (!extensionStatus.connected) {
      throw new Error(EXTENSION_NOT_CONNECTED_ERROR)
    }

    if (!shouldAutoEnablePlaywriter()) {
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

  getSessionInfo({ id }: { id: string }): SessionInfo {
    return {
      id,
      stateKeys: this.getStateKeys(),
      extensionId: this.sessionMetadata.extensionId,
      browser: this.sessionMetadata.browser,
      profile: this.sessionMetadata.profile,
      cwd: this.sessionCwd,
    }
  }
}

/**
 * Session manager for multiple executors, keyed by session ID.
 */
export class ExecutorManager {
  private executors = new Map<string, PlaywrightExecutor>()
  private cdpConfig: CdpConfig | ((sessionId: string) => CdpConfig)
  private logger: ExecutorLogger

  constructor(options: { cdpConfig: CdpConfig | ((sessionId: string) => CdpConfig); logger?: ExecutorLogger }) {
    this.cdpConfig = options.cdpConfig
    this.logger = options.logger || { log: console.log, error: console.error }
  }

  getExecutor(options: {
    sessionId: string
    cwd?: string
    sessionMetadata?: SessionMetadata
    /** Override cdpConfig for this session (e.g. direct CDP connection) */
    cdpConfig?: CdpConfig
    /** Cloud session info (set when connecting to a Browser Use VM) */
    cloudSession?: CloudSessionInfo
  }): PlaywrightExecutor {
    const { sessionId, cwd, sessionMetadata } = options
    let executor = this.executors.get(sessionId)
    if (!executor) {
      const cdpConfig = (() => {
        // Per-session override takes priority (used for direct CDP sessions)
        if (options.cdpConfig) {
          return options.cdpConfig
        }
        const baseConfig = typeof this.cdpConfig === 'function' ? this.cdpConfig(sessionId) : this.cdpConfig
        if (sessionMetadata?.extensionId) {
          return { ...baseConfig, extensionId: sessionMetadata.extensionId }
        }
        return baseConfig
      })()
      executor = new PlaywrightExecutor({
        cdpConfig,
        sessionMetadata,
        logger: this.logger,
        cwd,
        cloudSession: options.cloudSession,
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

  listSessions(): SessionInfo[] {
    return [...this.executors.entries()].map(([id, executor]) => {
      return executor.getSessionInfo({ id })
    })
  }
}
