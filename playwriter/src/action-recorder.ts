// Action recording for the `playwriter recorder` CLI feature.
//
// Playwright's API-mode recorder is the only action source. We persist those
// actions plus mutating xhr/fetch, same-origin GET xhr/fetch, and toast or
// alert text from ARIA live regions. CDP screencast writes a jpeg per visual
// change into a timestamped folder. A click ripple marks user clicks in those
// frames. No post-action page work: it froze typing.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { BrowserContext, Frame, Page, Request } from '@xmorse/playwright-core'
import { getCDPSessionForPage, type ICDPSession } from './cdp-session.js'
import { isRemoteExtensionKey } from './relay-state.js'

// Read at call time (not module load) so tests can point recordings at a temp
// dir via PLAYWRITER_RECORDINGS_DIR without polluting ~/.playwriter
export function getRecordingsDir(): string {
  return process.env.PLAYWRITER_RECORDINGS_DIR || path.join(os.homedir(), '.playwriter', 'recordings')
}

export function recordingFilePath(recordingId: string): string {
  if (!/^\d+$/.test(recordingId)) {
    throw new Error(`Invalid recording id: ${recordingId}`)
  }
  const jsonPath = path.join(getRecordingsDir(), `${recordingId}.json`)
  if (fs.existsSync(jsonPath)) {
    return jsonPath
  }
  const jsonlPath = path.join(getRecordingsDir(), `${recordingId}.jsonl`)
  if (fs.existsSync(jsonlPath)) {
    return jsonlPath
  }
  return jsonPath
}

/** Highest recording id present on disk, or null when there are no recordings.
 *  Used to default `recorder events` to the most recent recording. */
export function latestRecordingId(): string | null {
  let max = 0
  try {
    for (const file of fs.readdirSync(getRecordingsDir())) {
      const match = file.match(/^(\d+)\.(json|jsonl)$/)
      if (match) {
        max = Math.max(max, Number(match[1]))
      }
    }
  } catch {}
  return max > 0 ? String(max) : null
}

/** Parse a recording file. New files are a JSON array; old ones are jsonl. */
export function parseRecording(content: string): RecordedEvent[] {
  const trimmed = content.trim()
  if (!trimmed) {
    return []
  }
  if (trimmed.startsWith('[')) {
    const parsed: unknown = JSON.parse(trimmed)
    if (!Array.isArray(parsed)) {
      throw new Error('Recording file is not a JSON array')
    }
    return parsed as RecordedEvent[]
  }
  return trimmed.split('\n').filter(Boolean).map((line) => {
    return JSON.parse(line) as RecordedEvent
  })
}

interface RecorderLogger {
  log: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

interface RecorderAction {
  name: string
  /** Full selector: frames are `internal:control=enter-frame` parts, also listed in framePath */
  selector?: string
  text?: string
  key?: string
  options?: string[]
  files?: string[]
  button?: string
  modifiers?: number
  clickCount?: number
  url?: string
}

/** Added by our Playwright fork: page alias used in `code`, frames of the action selector */
interface RecorderFrame {
  pageAlias?: string
  framePath: string[]
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

type ExtraActionFields = {
  text?: string
  key?: string
  options?: string[]
  files?: string[]
  button?: string
  modifiers?: number
}

/** Internal Playwright recording API (BrowserContext._startRecording, one recording per connection). */
export type RecordingBrowserContext = BrowserContext & {
  _startRecording(
    params: { language?: string },
    sink: {
      actionAdded?: (page: Page, action: RecorderAction, code: string, frame?: RecorderFrame) => void
      actionUpdated?: (page: Page, action: RecorderAction, code: string, frame?: RecorderFrame) => void
      signalAdded?: (page: Page, signal: { name: string; url?: string }, code: string, frame?: RecorderFrame) => void
    },
  ): Promise<void>
  _stopRecording(): Promise<void>
}

export interface RecordedEvent {
  /** Seconds since recording start, 1 decimal */
  t: number
  type: string
  [key: string]: unknown
}

export type RecordingSummary = {
  recordingId: string
  sessionId: string
  pageUrls: string[]
  lastUrl: string
}

/** Error with an HTTP status code hint for the relay routes */
export class RecordingError extends Error {
  statusCode: number
  recordings?: RecordingSummary[]
  constructor(message: string, statusCode: number) {
    super(message)
    this.statusCode = statusCode
  }
}

/** Toolbar /recorder/start sends no sessionId. Never fail on many sessions. */
export function pickRecorderStartSession(options: {
  explicitSessionId?: string
  sessions: Array<{ id: string; extensionId: string | null }>
  busySessionIds: readonly string[]
}): { kind: 'use'; sessionId: string } | { kind: 'create' } {
  const explicit = options.explicitSessionId?.trim()
  if (explicit) {
    return { kind: 'use', sessionId: explicit }
  }
  const busy = new Set(options.busySessionIds)
  const free = options.sessions.find((session) => {
    return session.extensionId && !isRemoteExtensionKey(session.extensionId) && !busy.has(session.id)
  })
  if (free) {
    return { kind: 'use', sessionId: free.id }
  }
  return { kind: 'create' }
}

export function formatAmbiguousRecordingsError(recordings: RecordingSummary[]): string {
  const lines = recordings.map((recording) => {
    const shown = recording.pageUrls.length > 0 ? recording.pageUrls.join(', ') : recording.lastUrl || '(no pages)'
    return `  ${recording.recordingId}  session ${recording.sessionId}  ${shown}`
  })
  return `Multiple active recordings. Pass a recording id.\n\n${lines.join('\n')}`
}

// The file stores FULL event data (generous caps below). Context economy
// happens at read time: `recorder events` prints a thin projection (heavy
// fields replaced by sizes, see projectThinEvent) and specific event ids can
// be passed to read the full details on demand.
const TRACKED_RESOURCE_TYPES = new Set(['xhr', 'fetch'])
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const PERSIST_DEBOUNCE_MS = 50
const MAX_EVENTS = 10000
export const DEFAULT_RECORDING_MAX_DURATION_MS = 20 * 60 * 1000
// Frames plus events. A busy 3 minute recording wrote ~530 MB of frames.
export const DEFAULT_RECORDING_MAX_BYTES = 500 * 1024 * 1024
export const DEFAULT_RECORDER_ENABLE_TIMEOUT_MS = 15_000
export const DEFAULT_RECORDER_DISABLE_TIMEOUT_MS = 2_000
// Cap concurrent recordings. A new start past the cap stops the oldest
// recording instead of failing.
export const MAX_ACTIVE_RECORDINGS = 10
const MAX_RESPONSE_BODY_BYTES = 50000
const MAX_POST_DATA_BYTES = 10000
const MAX_CONSOLE_TEXT_CHARS = 2000
// Network and toast events get `afterAction` when they start this soon after an action
const AFTER_ACTION_WINDOW_MS = 3000
const ACTION_REPORT_SLACK_MS = 300
const TOAST_BINDING = '__playwriterRecorderToast'
const MAX_TOAST_TEXT_CHARS = 500
const TEXTUAL_CONTENT_TYPE = /json|text|xml|x-www-form-urlencoded|graphql/i
const SENSITIVE_FIELD_NAMES = [
  'apikey',
  'authorization',
  'cookie',
  'code',
  'credential',
  'csrf',
  'onetimecode',
  'otp',
  'passwd',
  'password',
  'privatekey',
  'refreshtoken',
  'secret',
  'secretaccesskey',
  'session',
  'sessionid',
  'sig',
  'signature',
  'token',
  'xamzcredential',
  'xamzsecuritytoken',
  'xamzsignature',
]
const TELEMETRY_HOST_SUFFIXES = [
  'google-analytics.com',
  'googletagmanager.com',
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'hotjar.com',
  'mixpanel.com',
  'segment.io',
  'segment.com',
  'fullstory.com',
  'amplitude.com',
  'clarity.ms',
]

export function isTelemetryUrl(url: string): boolean {
  const hostname = (() => {
    try {
      return new URL(url).hostname.toLowerCase()
    } catch {
      return ''
    }
  })()
  if (!hostname) {
    return false
  }
  return TELEMETRY_HOST_SUFFIXES.some((suffix) => {
    return hostname === suffix || hostname.endsWith(`.${suffix}`)
  })
}

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value
  }
  return value.slice(0, max) + `… (${value.length - max} more chars)`
}

function isSensitiveFieldName(name: string): boolean {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '')
  return SENSITIVE_FIELD_NAMES.some((field) => {
    return normalized === field || normalized.endsWith(field)
  })
}

function redactStructuredValue(value: JsonValue): { value: JsonValue; redacted: boolean } {
  if (Array.isArray(value)) {
    const items = value.map((item) => {
      return redactStructuredValue(item)
    })
    return {
      value: items.map((item) => {
        return item.value
      }),
      redacted: items.some((item) => {
        return item.redacted
      }),
    }
  }
  if (!value || typeof value !== 'object') {
    return { value, redacted: false }
  }

  const entries = Object.entries(value).map(([key, item]) => {
    if (isSensitiveFieldName(key)) {
      return [key, { value: '[redacted]', redacted: true }] as const
    }
    return [key, redactStructuredValue(item)] as const
  })
  return {
    value: Object.fromEntries(
      entries.map(([key, item]) => {
        return [key, item.value]
      }),
    ),
    redacted: entries.some(([, item]) => {
      return item.redacted
    }),
  }
}

function limitUtf8(value: string, maxBytes: number): { value: string; truncated: boolean; originalBytes: number } {
  const bytes = Buffer.from(value)
  if (bytes.length <= maxBytes) {
    return { value, truncated: false, originalBytes: bytes.length }
  }
  const limited = bytes
    .subarray(0, Math.max(0, maxBytes))
    .toString('utf8')
    .replace(/\uFFFD$/u, '')
  return { value: limited, truncated: true, originalBytes: bytes.length }
}

export function sanitizeRecordedUrl(url: string): { value: string; redacted: boolean } {
  try {
    const parsed = new URL(url)
    const hasCredentials = Boolean(parsed.username || parsed.password)
    if (parsed.username) {
      parsed.username = '[redacted]'
    }
    if (parsed.password) {
      parsed.password = '[redacted]'
    }
    const entries = [...parsed.searchParams.entries()]
    const redacted = entries.some(([key]) => {
      return isSensitiveFieldName(key)
    })
    parsed.search = new URLSearchParams(
      entries.map<[string, string]>(([key, value]) => {
        return [key, isSensitiveFieldName(key) ? '[redacted]' : value]
      }),
    ).toString()
    const hadFragment = Boolean(parsed.hash)
    parsed.hash = ''
    return { value: parsed.toString(), redacted: redacted || hadFragment || hasCredentials }
  } catch {
    return { value: url, redacted: false }
  }
}

export function sanitizeRecordedBody({
  body,
  contentType,
  maxBytes,
}: {
  body: string
  contentType: string
  maxBytes: number
}): { value: string; redacted: boolean; truncated: boolean; originalBytes: number } {
  const mediaType = contentType.toLowerCase()
  const sanitized = (() => {
    if (mediaType.includes('json')) {
      try {
        const parsed: JsonValue = JSON.parse(body)
        const result = redactStructuredValue(parsed)
        return { value: JSON.stringify(result.value), redacted: result.redacted }
      } catch {
        return { value: '[omitted invalid JSON body]', redacted: true }
      }
    }
    if (mediaType.includes('application/x-www-form-urlencoded')) {
      const params = new URLSearchParams(body)
      const entries = [...params.entries()]
      const redacted = entries.some(([key]) => {
        return isSensitiveFieldName(key)
      })
      const sanitized = new URLSearchParams(
        entries.map<[string, string]>(([key, value]) => {
          return [key, isSensitiveFieldName(key) ? '[redacted]' : value]
        }),
      )
      return { value: sanitized.toString(), redacted }
    }
    if (mediaType.includes('multipart/form-data')) {
      return { value: '[omitted multipart body]', redacted: true }
    }
    return { value: '[omitted unstructured body]', redacted: true }
  })()
  return { ...limitUtf8(sanitized.value, maxBytes), redacted: sanitized.redacted }
}

// Thin projection of an event for the default `recorder events` timeline view.
// Heavy payloads are replaced by sizes (or key lists) so the whole timeline is
// cheap to read; full details are fetched per event id.
export function projectThinEvent(event: RecordedEvent): RecordedEvent {
  const thin: RecordedEvent = { ...event }
  const replaceWithSize = (field: string, sizeField: string) => {
    const value = thin[field]
    if (typeof value === 'string') {
      delete thin[field]
      thin[sizeField] = value.length
    }
  }
  replaceWithSize('responseBody', 'responseBodySize')
  replaceWithSize('postData', 'postDataSize')
  if (event.type === 'console' && typeof event.text === 'string') {
    thin.text = truncate(event.text, 200)
  }
  if (event.type === 'page-error' && typeof event.message === 'string') {
    thin.message = truncate(event.message, 200)
  }
  return thin
}

/** Failed requests, console errors, page errors and toasts: why a step did not work */
export function isProblemEvent(event: RecordedEvent): boolean {
  if (event.type === 'network') {
    return Boolean(event.failure) || (typeof event.status === 'number' && event.status >= 400)
  }
  return event.type === 'console' || event.type === 'page-error' || event.type === 'toast'
}

/**
 * Merges runs of consecutive network events with the same method, url and status
 * (polling, bursts of identical calls) into the first one, with `repeat` and `lastId`.
 */
export function collapseRepeatedNetwork(events: RecordedEvent[]): RecordedEvent[] {
  const out: RecordedEvent[] = []
  const keyOf = (event: RecordedEvent) => {
    return event.type === 'network' ? `${event.method} ${event.url} ${event.status ?? event.failure}` : null
  }
  for (const event of events) {
    const previous = out[out.length - 1]
    const key = keyOf(event)
    if (previous && key && keyOf(previous) === key) {
      out[out.length - 1] = { ...previous, repeat: (Number(previous.repeat) || 1) + 1, lastId: event.id }
      continue
    }
    out.push(event)
  }
  return out
}

/** Frame file closest to `ms`: the last frame at or before it, else the first one after */
export function closestFrameFile({ frameFiles, ms }: { frameFiles: string[]; ms: number }): string | null {
  const frames = frameFiles
    .map((file) => {
      return { file, ms: Number(file.match(/^(\d+)(?:-\d+)?\.jpg$/)?.[1]) }
    })
    .filter((frame) => {
      return Number.isFinite(frame.ms)
    })
    .sort((a, b) => {
      return a.ms - b.ms
    })
  const before = frames.findLast((frame) => {
    return frame.ms <= ms
  })
  return (before ?? frames[0])?.file ?? null
}

interface PageHandlers {
  framenavigated: (frame: Frame) => void
  close: () => void
  download: (download: { url: () => string; suggestedFilename: () => string }) => void
  console: (message: { type: () => string; text: () => string }) => void
  pageerror: (error: Error) => void
}

export type RecordingStopReason = 'user' | 'max-duration' | 'max-size' | 'context-closed' | 'start-failed' | 'replaced'

export interface ActionRecorderOptions {
  context: BrowserContext
  sessionId: string
  recordingId: string
  logger: RecorderLogger
  maxDurationMs?: number
  /** Auto-stop when frames plus events exceed this many bytes. 0 or Infinity disables. */
  maxBytes?: number
  enableTimeoutMs?: number
  disableTimeoutMs?: number
  /** Test seam: resolve after enable, before the recording is marked ready. */
  holdAfterEnable?: () => Promise<void>
}

export class ActionRecorder {
  readonly recordingId: string
  readonly sessionId: string
  readonly filePath: string
  readonly startedAt = Date.now()
  /** Called once when the recording stops (manual stop or context close) */
  onDidStop: (() => void) | null = null

  private context: RecordingBrowserContext
  private logger: RecorderLogger
  private state: 'starting' | 'recording' | 'stopping' | 'stopped' = 'starting'
  private maxDurationMs: number
  private maxBytes: number
  private bytes = 0
  private enableTimeoutMs: number
  private disableTimeoutMs: number
  private holdAfterEnable: (() => Promise<void>) | null
  private maxDurationTimer: ReturnType<typeof setTimeout> | null = null
  private abortStart: ((error: Error) => void) | null = null

  private events: RecordedEvent[] = []

  // Serialize async captures so event order matches real order
  private captureChain: Promise<void> = Promise.resolve()
  private pendingCaptures = 0
  private persistTimer: ReturnType<typeof setTimeout> | null = null
  private pageHandlers = new Map<Page, PageHandlers>()
  private onPageHandler: ((page: Page) => void) | null = null
  private onContextCloseHandler: (() => void) | null = null
  private onRequestFinishedHandler: ((request: Request) => void) | null = null
  private onRequestFailedHandler: ((request: Request) => void) | null = null
  private framesDir: string | undefined
  private frameCount = 0
  private screencasts = new Map<Page, { session: ICDPSession; onFrame: (event: { data: string; sessionId: number; metadata?: { timestamp?: number } }) => void }>()
  private toastTaps = new Map<
    Page,
    { session: ICDPSession; scriptId: string; onBinding: (event: { name: string; payload: string }) => void } | null
  >()

  constructor(options: ActionRecorderOptions) {
    // Playwright's recording methods are internal, not in the public BrowserContext type
    this.context = options.context as RecordingBrowserContext
    this.sessionId = options.sessionId
    this.recordingId = options.recordingId
    this.logger = options.logger
    this.filePath = recordingFilePath(options.recordingId)
    this.maxDurationMs = options.maxDurationMs ?? DEFAULT_RECORDING_MAX_DURATION_MS
    this.maxBytes = options.maxBytes ?? DEFAULT_RECORDING_MAX_BYTES
    this.enableTimeoutMs = options.enableTimeoutMs ?? DEFAULT_RECORDER_ENABLE_TIMEOUT_MS
    this.disableTimeoutMs = options.disableTimeoutMs ?? DEFAULT_RECORDER_DISABLE_TIMEOUT_MS
    this.holdAfterEnable = options.holdAfterEnable ?? null
  }

  get eventCount() {
    return this.events.length
  }

  pageUrls(): string[] {
    try {
      return this.context.pages().map(safePageUrl).filter(Boolean)
    } catch {
      return []
    }
  }

  lastPageUrl(): string {
    for (let i = this.events.length - 1; i >= 0; i--) {
      const event = this.events[i]
      if (!event) {
        continue
      }
      if (event.type === 'navigation' && typeof event.url === 'string' && event.url) {
        return event.url
      }
      if (typeof event.pageUrl === 'string' && event.pageUrl) {
        return event.pageUrl
      }
      if (event.type === 'page-opened' && typeof event.url === 'string' && event.url) {
        return event.url
      }
      if (event.type === 'recording-started' && Array.isArray(event.urls)) {
        const urls = event.urls.filter((url): url is string => {
          return typeof url === 'string' && url.length > 0
        })
        if (urls.length > 0) {
          return urls[urls.length - 1]!
        }
      }
    }
    return ''
  }

  summarize(): RecordingSummary {
    return {
      recordingId: this.recordingId,
      sessionId: this.sessionId,
      pageUrls: this.pageUrls(),
      lastUrl: this.lastPageUrl(),
    }
  }

  /** @param at epoch ms when the event was observed (defaults to now) */
  private writeEvent(event: { type: string; [key: string]: unknown }, at?: number): number {
    if (this.state === 'stopped' && event.type !== 'recording-stopped') {
      return 0
    }
    if (this.events.length >= MAX_EVENTS && event.type !== 'recording-stopped') {
      if (this.events[this.events.length - 1]?.type !== 'truncated') {
        this.events.push({
          id: this.events.length + 1,
          t: this.relativeTime(Date.now()),
          ms: this.elapsedMs(Date.now()),
          type: 'truncated',
          maxEvents: MAX_EVENTS,
        })
        this.persist()
      }
      return 0
    }
    const id = this.events.length + 1
    const atMs = at ?? Date.now()
    const stored = {
      id,
      ...event,
      t: this.relativeTime(atMs),
      ms: this.elapsedMs(atMs),
    }
    this.events.push(stored)
    this.persist()
    this.addBytes(Buffer.byteLength(JSON.stringify(stored)))
    return id
  }

  private addBytes(count: number) {
    this.bytes += count
    this.stopIfTooLarge()
  }

  private stopIfTooLarge() {
    if (this.state !== 'recording' || !(this.maxBytes > 0) || this.bytes <= this.maxBytes) {
      return
    }
    this.stop({ reason: 'max-size' }).catch((error) => {
      this.logger.error('[record] auto-stop on max size failed:', error)
    })
  }

  private persist() {
    if (this.persistTimer) {
      return
    }
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      this.flushPersist()
    }, PERSIST_DEBOUNCE_MS)
    this.persistTimer.unref?.()
  }

  private flushPersist() {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    const tmpPath = `${this.filePath}.${process.pid}.tmp`
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(this.events) + '\n', { mode: 0o600 })
      if (process.platform === 'win32' && fs.existsSync(this.filePath)) {
        fs.unlinkSync(this.filePath)
      }
      fs.renameSync(tmpPath, this.filePath)
    } catch (error) {
      this.logger.error('[record] failed to write event:', error)
      try {
        fs.unlinkSync(tmpPath)
      } catch {}
    }
  }

  /** Id of the action that happened at most AFTER_ACTION_WINDOW_MS before `at` (epoch ms) */
  private actionBefore(at: number): number | undefined {
    const ms = this.elapsedMs(at)
    // Actions are timestamped when the recorder reports them, a few ms after the
    // click handler already started the request. Allow that delay.
    const action = this.events.findLast((event) => {
      return event.type === 'action' && typeof event.ms === 'number' && event.ms <= ms + ACTION_REPORT_SLACK_MS
    })
    if (!action || ms - Number(action.ms) > AFTER_ACTION_WINDOW_MS) {
      return undefined
    }
    return typeof action.id === 'number' ? action.id : undefined
  }

  private relativeTime(at: number): number {
    return Math.round((at - this.startedAt) / 100) / 10
  }

  private elapsedMs(at: number): number {
    return Math.max(0, Math.round(at - this.startedAt))
  }

  async start() {
    fs.mkdirSync(getRecordingsDir(), { recursive: true, mode: 0o700 })
    // 'wx' fails with EEXIST instead of truncating: another relay process
    // (e.g. tests on a different port) may have allocated the same id from the
    // shared recordings dir. The manager retries with the next id on EEXIST.
    fs.writeFileSync(this.filePath, '[]\n', { mode: 0o600, flag: 'wx' })

    try {
      await this.enableRecorder()
    } catch (error) {
      await this.failStart()
      throw error
    }
    if (this.state !== 'starting') {
      throw new RecordingError('Recording was stopped before it finished starting', 409)
    }

    this.onPageHandler = (page: Page) => {
      if (this.state !== 'recording') {
        return
      }
      this.writeEvent({ type: 'page-opened', url: safePageUrl(page) })
      this.attachPageListeners(page)
    }
    this.context.on('page', this.onPageHandler)

    // Auto-stop when the context closes (extension toggled off, session reset,
    // browser gone). Without this the manager would report a dead recording as
    // active forever and the poll timer would leak.
    this.onContextCloseHandler = () => {
      if (this.state !== 'recording') {
        return
      }
      this.writeEvent({ type: 'context-closed' })
      this.stop({ reason: 'context-closed' }).catch((error) => {
        this.logger.error('[record] auto-stop on context close failed:', error)
      })
    }
    this.context.on('close', this.onContextCloseHandler)

    this.onRequestFinishedHandler = (request: Request) => {
      this.recordNetworkRequest(request, null)
    }
    this.onRequestFailedHandler = (request: Request) => {
      this.recordNetworkRequest(request, request.failure()?.errorText || 'failed')
    }
    this.context.on('requestfinished', this.onRequestFinishedHandler)
    this.context.on('requestfailed', this.onRequestFailedHandler)

    for (const page of this.context.pages()) {
      this.attachPageListeners(page)
    }
    this.framesDir = path.join(getRecordingsDir(), this.recordingId, 'frames')
    fs.mkdirSync(this.framesDir, { recursive: true, mode: 0o700 })
    this.writeEvent({
      type: 'recording-started',
      startedAt: new Date(this.startedAt).toISOString(),
      sessionId: this.sessionId,
      recordingId: this.recordingId,
      framesDir: this.framesDir,
      urls: this.context.pages().map((p) => safePageUrl(p)),
    })
    await Promise.all(this.context.pages().map((page) => this.startPageScreencast(page)))
    if (this.holdAfterEnable) {
      await this.holdAfterEnable()
    }
    if (this.state !== 'starting') {
      throw new RecordingError('Recording was stopped before it finished starting', 409)
    }
    this.state = 'recording'
    this.scheduleMaxDurationStop()
    this.stopIfTooLarge()
  }

  async stop(options?: { reason?: RecordingStopReason }): Promise<{ eventCount: number; filePath: string }> {
    if (this.state === 'stopped' || this.state === 'stopping') {
      return { eventCount: this.eventCount, filePath: this.filePath }
    }
    const reason = options?.reason ?? 'user'
    if (this.state === 'starting') {
      this.abortStart?.(new RecordingError('Recording was stopped before it finished starting', 409))
    }
    this.clearMaxDurationTimer()
    // 1. Stop accepting new input: sink handlers and listeners check state
    this.state = 'stopping'
    this.detachListeners()
    this.flushPersist()
    // 2. Let in-flight captures finish. New captures can't be enqueued anymore.
    await this.captureChain.catch(() => {})
    await Promise.all([this.stopAllScreencasts(), this.stopAllToastTaps()])
    // 3. Finalize
    this.writeEvent({
      type: 'recording-stopped',
      reason,
      durationSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      framesDir: this.framesDir,
      frameCount: this.frameCount,
      bytes: this.bytes,
      maxBytes: reason === 'max-size' ? this.maxBytes : undefined,
    })
    this.flushPersist()
    await this.disableRecorder()
    this.state = 'stopped'
    this.onDidStop?.()
    this.onDidStop = null
    return { eventCount: this.eventCount, filePath: this.filePath }
  }

  // _startRecording can hang forever if a frame never gets a main world
  // (empty target, OOPIF). Race start against a timeout and against stop().
  private async enableRecorder() {
    const enable = this.context._startRecording(
      { language: 'javascript' },
      {
        actionAdded: (page, action, code, frame) => {
          this.onRecorderAction({ page, action, frame, code, isUpdate: false })
        },
        actionUpdated: (page, action, code, frame) => {
          this.onRecorderAction({ page, action, frame, code, isUpdate: true })
        },
        signalAdded: (page, signal, _code, frame) => {
          if (this.state !== 'recording') {
            return
          }
          const signalUrl = signal.url ? sanitizeRecordedUrl(signal.url) : null
          this.writeEvent({
            type: 'signal',
            signal: signal.name,
            url: signalUrl?.value,
            urlRedacted: signalUrl?.redacted || undefined,
            pageAlias: frame?.pageAlias,
            pageUrl: safePageUrl(page),
          })
        },
      },
    )
    enable.then(
      () => {
        if (this.state === 'stopped' || this.state === 'stopping') {
          void this.disableRecorder()
        }
      },
      () => {},
    )
    await this.raceStart(enable)
  }

  private raceStart(enable: Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (fn: () => void) => {
        if (settled) {
          return
        }
        settled = true
        this.abortStart = null
        if (timer) {
          clearTimeout(timer)
        }
        fn()
      }
      this.abortStart = (error) => {
        finish(() => {
          reject(error)
        })
      }
      const timer =
        this.enableTimeoutMs > 0
          ? setTimeout(() => {
              finish(() => {
                reject(
                  new RecordingError(
                    `Recorder failed to start within ${this.enableTimeoutMs}ms. A tab frame may be stuck without a document.`,
                    500,
                  ),
                )
              })
            }, this.enableTimeoutMs)
          : null
      timer?.unref?.()
      enable.then(
        () => {
          finish(() => {
            resolve()
          })
        },
        (error) => {
          finish(() => {
            reject(error)
          })
        },
      )
    })
  }

  private async failStart() {
    if (this.state === 'stopped' || this.state === 'stopping') {
      return
    }
    await this.stop({ reason: 'start-failed' }).catch((stopError) => {
      this.logger.error('[record] cleanup after failed start:', stopError)
    })
  }

  private async disableRecorder() {
    const disable = this.context._stopRecording().catch((error) => {
      this.logger.error('[record] failed to disable recorder:', error)
    })
    if (this.disableTimeoutMs <= 0) {
      await disable
      return
    }
    await Promise.race([
      disable,
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, this.disableTimeoutMs)
        timer.unref?.()
      }),
    ])
  }

  private scheduleMaxDurationStop() {
    this.clearMaxDurationTimer()
    if (!(this.maxDurationMs > 0) || this.maxDurationMs === Infinity) {
      return
    }
    this.maxDurationTimer = setTimeout(() => {
      this.maxDurationTimer = null
      this.stop({ reason: 'max-duration' }).catch((error) => {
        this.logger.error('[record] auto-stop on max duration failed:', error)
      })
    }, this.maxDurationMs)
    this.maxDurationTimer.unref?.()
  }

  private clearMaxDurationTimer() {
    if (!this.maxDurationTimer) {
      return
    }
    clearTimeout(this.maxDurationTimer)
    this.maxDurationTimer = null
  }

  private detachListeners() {
    if (this.onPageHandler) {
      this.context.off('page', this.onPageHandler)
      this.onPageHandler = null
    }
    if (this.onContextCloseHandler) {
      this.context.off('close', this.onContextCloseHandler)
      this.onContextCloseHandler = null
    }
    if (this.onRequestFinishedHandler) {
      this.context.off('requestfinished', this.onRequestFinishedHandler)
      this.onRequestFinishedHandler = null
    }
    if (this.onRequestFailedHandler) {
      this.context.off('requestfailed', this.onRequestFailedHandler)
      this.onRequestFailedHandler = null
    }
    for (const [page, handlers] of this.pageHandlers) {
      page.off('framenavigated', handlers.framenavigated)
      page.off('close', handlers.close)
      page.off('download', handlers.download)
      page.off('console', handlers.console)
      page.off('pageerror', handlers.pageerror)
    }
    this.pageHandlers.clear()
  }

  private attachPageListeners(page: Page) {
    if (this.pageHandlers.has(page)) {
      return
    }
    const handlers: PageHandlers = {
      framenavigated: (frame) => {
        if (this.state !== 'recording' || frame !== page.mainFrame()) {
          return
        }
        const url = sanitizeRecordedUrl(frame.url())
        this.writeEvent({ type: 'navigation', url: url.value, urlRedacted: url.redacted || undefined })
        // Same as the toolbar: MAIN-world script dies on hard navigation.
        // Re-inject once the new document exists.
        page.evaluate(installClickRipple).catch(() => {})
      },
      close: () => {
        if (this.state !== 'recording') {
          return
        }
        this.writeEvent({ type: 'page-closed', url: safePageUrl(page) })
        this.pageHandlers.delete(page)
        void this.stopPageScreencast(page)
        void this.stopToastTap(page)
      },
      // Downloads matter for document-harvesting flows (invoices, statements,
      // shipping labels): the skill needs to know which step produced the file
      download: (download) => {
        if (this.state !== 'recording') {
          return
        }
        const url = sanitizeRecordedUrl(download.url())
        this.writeEvent({
          type: 'download',
          url: truncate(url.value, 500),
          urlRedacted: url.redacted || undefined,
          suggestedFilename: download.suggestedFilename(),
          pageUrl: safePageUrl(page),
        })
      },
      // Console errors/warnings + page errors make recordings usable as bug
      // reproduction reports
      console: (message) => {
        if (this.state !== 'recording') {
          return
        }
        const level = message.type()
        if (level !== 'error' && level !== 'warning') {
          return
        }
        this.writeEvent({ type: 'console', level, text: truncate(message.text(), MAX_CONSOLE_TEXT_CHARS), pageUrl: safePageUrl(page) })
      },
      pageerror: (error) => {
        if (this.state !== 'recording') {
          return
        }
        this.writeEvent({ type: 'page-error', message: truncate(String(error.message || error), MAX_CONSOLE_TEXT_CHARS), pageUrl: safePageUrl(page) })
      },
    }
    this.pageHandlers.set(page, handlers)
    page.evaluate(installClickRipple).catch(() => {})
    void this.startPageScreencast(page)
    void this.startToastTap(page)
    page.on('framenavigated', handlers.framenavigated)
    page.on('close', handlers.close)
    page.on('download', handlers.download)
    page.on('console', handlers.console)
    page.on('pageerror', handlers.pageerror)
  }

  private onRecorderAction({
    page,
    action,
    frame,
    code,
    isUpdate,
  }: {
    page: Page
    action: RecorderAction
    frame: RecorderFrame | undefined
    code: string
    isUpdate: boolean
  }) {
    if (this.state !== 'recording') {
      return
    }
    const rawCodeText = sanitizeLocatorText(code.trim())
    const selector = action.selector ? sanitizeLocatorText(action.selector) : undefined
    const actionName = action.name
    const clickCount = typeof action.clickCount === 'number' ? action.clickCount : undefined
    const pageAlias = frame?.pageAlias
    const framePath = frame?.framePath.length ? frame.framePath : undefined
    const redactText = actionName === 'fill'
    const actionUrl = action.url ? sanitizeRecordedUrl(action.url) : null
    const codeText = (() => {
      if (redactText) {
        return redactFillCode(rawCodeText)
      }
      if (actionUrl?.redacted && action.url) {
        return rawCodeText.replace(action.url, actionUrl.value)
      }
      return rawCodeText
    })()
    const extras = extraActionFields({ action, redactText })
    // actionUpdated = same fill / dblclick. Only edit if it is the same action.
    if (isUpdate) {
      const last = this.lastAction()
      if (
        last &&
        typeof last.id === 'number' &&
        last.action === actionName &&
        last.selector === selector &&
        last.pageAlias === pageAlias
      ) {
        last.code = codeText
        last.pageUrl = safePageUrl(page)
        if (clickCount !== undefined) {
          last.clickCount = clickCount
        }
        Object.assign(last, extras)
        this.persist()
        return
      }
    }
    this.writeEvent({
      type: 'action',
      action: actionName,
      code: codeText,
      selector,
      clickCount,
      pageAlias,
      framePath,
      pageUrl: safePageUrl(page),
      redacted: redactText || actionUrl?.redacted || undefined,
      ...extras,
    })
  }

  private isInactive() {
    return this.state === 'stopped' || this.state === 'stopping'
  }

  private async startPageScreencast(page: Page) {
    if (this.screencasts.has(page) || page.isClosed() || !this.framesDir || this.isInactive()) {
      return
    }
    this.screencasts.set(page, { session: null as never, onFrame: () => {} })
    try {
      const session = await getCDPSessionForPage({ page })
      if (this.isInactive() || page.isClosed()) {
        this.screencasts.delete(page)
        return
      }
      // Chrome only emits screencastFrame when the compositor has a new frame.
      // Playwright's CDP session already acks; do not ack again.
      const onFrame = (event: { data: string; sessionId: number; metadata?: { timestamp?: number } }) => {
        if (!this.framesDir || this.state === 'stopped') {
          return
        }
        const at = event.metadata?.timestamp ? event.metadata.timestamp * 1000 : Date.now()
        const ms = this.elapsedMs(at)
        let name = `${ms}.jpg`
        if (fs.existsSync(path.join(this.framesDir, name))) {
          name = `${ms}-${this.frameCount + 1}.jpg`
        }
        const jpeg = Buffer.from(event.data, 'base64')
        fs.writeFileSync(path.join(this.framesDir, name), jpeg)
        this.frameCount += 1
        this.addBytes(jpeg.length)
      }
      session.on('Page.screencastFrame', onFrame)
      this.screencasts.set(page, { session, onFrame })
      await session.send('Page.startScreencast', {
        format: 'jpeg',
        quality: 50,
        maxWidth: 1280,
        maxHeight: 720,
      })
    } catch (error) {
      this.screencasts.delete(page)
      this.logger.error('[record] screencast failed:', error)
    }
  }

  private async stopPageScreencast(page: Page) {
    const active = this.screencasts.get(page)
    if (!active) {
      return
    }
    this.screencasts.delete(page)
    if (!active.session) {
      return
    }
    active.session.off('Page.screencastFrame', active.onFrame)
    await active.session.send('Page.stopScreencast').catch(() => {})
  }

  private async stopAllScreencasts() {
    await Promise.all([...this.screencasts.keys()].map((page) => this.stopPageScreencast(page)))
  }

  // Toasts and alerts often explain a failed step that sent no request (client-side
  // limit checks, validation). A raw CDP binding plus init script reports text
  // changes in ARIA live regions. Playwright ignores bindingCalled for names it
  // did not expose, so sharing its CDP session is safe.
  private async startToastTap(page: Page) {
    if (this.toastTaps.has(page) || page.isClosed() || this.isInactive()) {
      return
    }
    this.toastTaps.set(page, null)
    try {
      const session = await getCDPSessionForPage({ page })
      if (this.isInactive() || page.isClosed()) {
        this.toastTaps.delete(page)
        return
      }
      const onBinding = (event: { name: string; payload: string }) => {
        if (event.name !== TOAST_BINDING || this.state !== 'recording') {
          return
        }
        const toast = (() => {
          try {
            return JSON.parse(event.payload) as { role?: string; text?: string }
          } catch {
            return null
          }
        })()
        if (!toast?.text) {
          return
        }
        const now = Date.now()
        this.writeEvent(
          {
            type: 'toast',
            role: toast.role,
            text: truncate(toast.text, MAX_TOAST_TEXT_CHARS),
            pageUrl: safePageUrl(page),
            afterAction: this.actionBefore(now),
          },
          now,
        )
      }
      session.on('Runtime.bindingCalled', onBinding)
      await session.send('Runtime.addBinding', { name: TOAST_BINDING })
      const { identifier } = await session.send('Page.addScriptToEvaluateOnNewDocument', {
        source: TOAST_OBSERVER_SOURCE,
        runImmediately: true,
      })
      this.toastTaps.set(page, { session, scriptId: identifier, onBinding })
      if (this.isInactive()) {
        await this.stopToastTap(page)
      }
    } catch (error) {
      this.toastTaps.delete(page)
      this.logger.error('[record] toast tap failed:', error)
    }
  }

  private async stopToastTap(page: Page) {
    const tap = this.toastTaps.get(page)
    this.toastTaps.delete(page)
    if (!tap) {
      return
    }
    tap.session.off('Runtime.bindingCalled', tap.onBinding)
    // The observer stays in the current document, but its calls reach no client
    // after removeBinding. A later recording reuses the same observer.
    await Promise.all([
      tap.session.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: tap.scriptId }).catch(() => {}),
      tap.session.send('Runtime.removeBinding', { name: TOAST_BINDING }).catch(() => {}),
    ])
  }

  private async stopAllToastTaps() {
    await Promise.all([...this.toastTaps.keys()].map((page) => this.stopToastTap(page)))
  }

  private lastAction(): RecordedEvent | undefined {
    return this.events.findLast((event) => {
      return event.type === 'action'
    })
  }

  private enqueueCapture(task: () => Promise<void>) {
    if (this.state === 'stopped') {
      return
    }
    this.pendingCaptures++
    this.captureChain = this.captureChain.then(async () => {
      try {
        if (this.state === 'stopped') {
          return
        }
        // Timeout so one hung page.evaluate (crashed tab, blocked renderer)
        // can't stall all later captures and block stop() forever
        await Promise.race([
          task(),
          new Promise<void>((_, reject) => {
            setTimeout(() => {
              reject(new Error('capture timed out after 15s'))
            }, 15000).unref?.()
          }),
        ]).catch((error) => {
          this.logger.error('[record] capture failed:', error)
        })
      } finally {
        this.pendingCaptures--
      }
    })
  }

  private recordNetworkRequest(request: Request, failure: string | null) {
    if (this.state !== 'recording') {
      return
    }
    const resourceType = request.resourceType()
    if (!TRACKED_RESOURCE_TYPES.has(resourceType)) {
      return
    }
    const url = request.url()
    // Reads matter too (quota checks, polling for job status), but third-party
    // GETs are mostly widgets and config noise
    if (!MUTATING_METHODS.has(request.method().toUpperCase()) && !isSameOriginAsFrame(request)) {
      return
    }
    if (url.startsWith('data:') || url.startsWith('chrome-extension:') || isTelemetryUrl(url)) {
      return
    }
    // Timestamp is captured now (when the request finished), not when the
    // queued capture task eventually writes the event
    const observedAt = Date.now()
    const startTime = request.timing().startTime
    const afterAction = this.actionBefore(startTime > 0 ? startTime : observedAt)
    this.enqueueCapture(async () => {
      const response = failure ? null : await request.response().catch(() => null)
      const postData = request.postData()
      const requestContentType = request.headers()['content-type'] || ''
      const sanitizedUrl = sanitizeRecordedUrl(url)
      const sanitizedPostData = postData
        ? sanitizeRecordedBody({ body: postData, contentType: requestContentType, maxBytes: MAX_POST_DATA_BYTES })
        : null
      // Capture textual xhr/fetch response bodies (truncated): they let the
      // agent reverse-engineer the site's API into typed clients or skills
      // that call the API directly instead of driving the UI
      const contentType = response?.headers()['content-type']
      const responseCapture = await (async (): Promise<{
        body: ReturnType<typeof sanitizeRecordedBody> | null
        omitted?: 'too-large' | 'unknown-size' | 'unavailable'
      }> => {
        if (!response || resourceType === 'document' || !contentType || !TEXTUAL_CONTENT_TYPE.test(contentType)) {
          return { body: null }
        }
        // responseBodySize is the wire size, compressed for gzip/br. Compressed
        // bodies can decode larger than the cap; limitUtf8 truncates them after.
        const sizes = await request.sizes().catch(() => null)
        if (!sizes || !Number.isSafeInteger(sizes.responseBodySize) || sizes.responseBodySize < 0) {
          return { body: null, omitted: 'unknown-size' }
        }
        if (sizes.responseBodySize > MAX_RESPONSE_BODY_BYTES) {
          return { body: null, omitted: 'too-large' }
        }
        const body = await response.text().catch(() => null)
        if (!body) {
          return { body: null, omitted: 'unavailable' }
        }
        return {
          body: sanitizeRecordedBody({ body, contentType, maxBytes: MAX_RESPONSE_BODY_BYTES }),
        }
      })()
      this.writeEvent(
        {
          type: 'network',
          method: request.method(),
          url: truncate(sanitizedUrl.value, 500),
          urlRedacted: sanitizedUrl.redacted || undefined,
          resourceType,
          status: response?.status(),
          contentType,
          failure: failure || undefined,
          postData: sanitizedPostData?.value || undefined,
          postDataRedacted: sanitizedPostData?.redacted || undefined,
          postDataTruncated: sanitizedPostData?.truncated || undefined,
          responseBody: responseCapture.body?.value || undefined,
          responseBodyRedacted: responseCapture.body?.redacted || undefined,
          responseBodyTruncated: responseCapture.body?.truncated || undefined,
          responseBodyOmitted: responseCapture.omitted,
          afterAction,
        },
        observedAt,
      )
    })
  }

}

function installClickRipple() {
  const win = window as Window & { __playwriterRipple?: boolean }
  if (win.__playwriterRipple) {
    return
  }
  win.__playwriterRipple = true
  window.addEventListener(
    'mousedown',
    (event) => {
      if (event.button !== 0) {
        return
      }
      const root = document.documentElement
      if (!root) {
        return
      }
      const el = document.createElement('div')
      el.style.cssText = [
        'position:fixed',
        `left:${event.clientX}px`,
        `top:${event.clientY}px`,
        'width:12px',
        'height:12px',
        'margin:-6px 0 0 -6px',
        'border-radius:50%',
        'border:2px solid #ff2d55',
        'pointer-events:none',
        'z-index:2147483647',
        'transition:transform .4s ease-out,opacity .4s ease-out',
      ].join(';')
      root.appendChild(el)
      window.setTimeout(() => {
        el.style.transform = 'scale(4)'
        el.style.opacity = '0'
      }, 0)
      setTimeout(() => {
        el.remove()
      }, 400)
    },
    true,
  )
}

// Runs in the page as an init script. Reports new text of ARIA live regions and
// toasts through the binding. One observer per document, reused across recordings.
// Plain JS string: this package compiles without DOM types.
const TOAST_OBSERVER_SOURCE = `(() => {
  if (window.__playwriterToastObserver) return
  window.__playwriterToastObserver = true
  const bindingName = ${JSON.stringify(TOAST_BINDING)}
  const selector = '[role="alert"],[role="alertdialog"],[role="status"],[aria-live="polite"],[aria-live="assertive"],[data-sonner-toast]'
  // bigger regions are page content marked live, not messages
  const maxRegionChars = 1000
  const lastText = new WeakMap()
  const pending = new Set()
  let timer = null
  const flush = () => {
    timer = null
    for (const region of pending) {
      if (!region.isConnected) continue
      const text = (region.innerText || '').replace(/\\s+/g, ' ').trim()
      if (!text || text.length > maxRegionChars || lastText.get(region) === text) continue
      lastText.set(region, text)
      const role = region.getAttribute('role') || (region.hasAttribute('data-sonner-toast') ? 'toast' : 'live')
      if (typeof window[bindingName] === 'function') window[bindingName](JSON.stringify({ role, text }))
    }
    pending.clear()
  }
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      const node = mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target.parentElement
      const region = node && node.closest(selector)
      if (region) pending.add(region)
      for (const added of mutation.addedNodes) {
        if (added.nodeType !== Node.ELEMENT_NODE) continue
        if (added.matches(selector)) pending.add(added)
        for (const inner of added.querySelectorAll(selector)) pending.add(inner)
      }
    }
    // let the toast finish rendering before reading its text
    if (pending.size > 0 && !timer) timer = setTimeout(flush, 150)
  }).observe(document, { subtree: true, childList: true, characterData: true })
})()`

function isSameOriginAsFrame(request: Request): boolean {
  try {
    return new URL(request.url()).origin === new URL(request.frame().url()).origin
  } catch {
    // Service worker requests have no frame
    return false
  }
}

function safePageUrl(page: Page): string {
  try {
    return sanitizeRecordedUrl(page.url()).value
  } catch {
    return ''
  }
}

// Icon fonts put private-use glyphs in accessible names (` Login`). Strip them
// so recorded locators stay `getByRole('button', { name: 'Login' })`.
function sanitizeLocatorText(text: string): string {
  return text.replace(/[\uE000-\uF8FF]\s*/g, '').replace(/\s+/g, ' ')
}

// Fields Playwright already puts on the action object. Copy them onto the
// recorded event so agents do not have to parse `.code`.
function redactFillCode(code: string): string {
  const fillIndex = code.lastIndexOf('.fill(')
  if (fillIndex < 0) {
    return code
  }
  return `${code.slice(0, fillIndex)}.fill('[redacted]');`
}

function extraActionFields({
  action,
  redactText,
}: {
  action: RecorderAction
  redactText: boolean
}): ExtraActionFields {
  const fields: ExtraActionFields = {}
  if (typeof action.text === 'string') {
    fields.text = redactText ? '[redacted]' : action.text
  }
  if (typeof action.key === 'string') {
    fields.key = action.key
  }
  if (Array.isArray(action.options)) {
    fields.options = action.options
  }
  if (Array.isArray(action.files)) {
    fields.files = action.files
  }
  if (typeof action.button === 'string') {
    fields.button = action.button
  }
  if (typeof action.modifiers === 'number') {
    fields.modifiers = action.modifiers
  }
  return fields
}

// ============================================================================
// Manager: tracks active recordings in the relay process. Recording ids are
// incremental numbers persisted as JSON filenames in ~/.playwriter/recordings
// so ids survive relay restarts (files outlive the process).
// ============================================================================

export class ActionRecordingManager {
  private recordings = new Map<string, ActionRecorder>()
  private logger: RecorderLogger
  private onActiveChanged: ((active: boolean) => void) | null

  constructor({
    logger,
    onActiveChanged,
  }: {
    logger: RecorderLogger
    onActiveChanged?: (active: boolean) => void
  }) {
    this.logger = logger
    this.onActiveChanged = onActiveChanged ?? null
  }

  private addRecording(recorder: ActionRecorder) {
    this.recordings.set(recorder.recordingId, recorder)
  }

  private removeRecording(recordingId: string) {
    if (!this.recordings.delete(recordingId)) {
      return
    }
    if (this.recordings.size === 0) {
      this.onActiveChanged?.(false)
    }
  }

  private markActive() {
    // Always notify. The toolbar only flips to Stop when it hears this.
    // Skipping after the first recording left the button stuck on Record Skill
    // while more starts piled up (daemon already had an active recording).
    this.onActiveChanged?.(true)
  }

  private nextRecordingId(): string {
    let max = Number(latestRecordingId() || 0)
    // Also consider active recordings whose file may not be listed yet
    for (const id of this.recordings.keys()) {
      max = Math.max(max, Number(id) || 0)
    }
    return String(max + 1)
  }

  activeRecordingForSession(sessionId: string): ActionRecorder | null {
    return [...this.recordings.values()].find((r) => r.sessionId === sessionId) || null
  }

  async start({
    context,
    sessionId,
    maxDurationMs,
    maxBytes,
    enableTimeoutMs,
    disableTimeoutMs,
    holdAfterEnable,
  }: {
    context: BrowserContext
    sessionId: string
    maxDurationMs?: number
    maxBytes?: number
    enableTimeoutMs?: number
    disableTimeoutMs?: number
    holdAfterEnable?: () => Promise<void>
  }): Promise<ActionRecorder> {
    const existing = this.activeRecordingForSession(sessionId)
    if (existing) {
      throw new RecordingError(
        `Session ${sessionId} already has an active recording (id ${existing.recordingId}). Stop it first.`,
        409,
      )
    }
    // Drop the oldest from the map in this turn, then add the new one, before
    // any await. Otherwise two concurrent starts can both pass a size check
    // and briefly exceed the cap.
    const evicted = (() => {
      if (this.recordings.size < MAX_ACTIVE_RECORDINGS) {
        return undefined
      }
      let oldest: ActionRecorder | undefined
      for (const recorder of this.recordings.values()) {
        if (!oldest || recorder.startedAt < oldest.startedAt) {
          oldest = recorder
        }
      }
      if (oldest) {
        this.removeRecording(oldest.recordingId)
      }
      return oldest
    })()
    // Retry on EEXIST: another relay process sharing the recordings dir may
    // allocate the same id concurrently; its file makes the next scan skip it
    for (let attempt = 0; attempt < 20; attempt++) {
      const recorder = new ActionRecorder({
        context,
        sessionId,
        recordingId: this.nextRecordingId(),
        logger: this.logger,
        maxDurationMs,
        maxBytes,
        enableTimeoutMs,
        disableTimeoutMs,
        holdAfterEnable,
      })
      // Reserve the id before the first await so concurrent starts in this
      // process can't pick the same id or bypass the duplicate-session guard
      this.addRecording(recorder)
      recorder.onDidStop = () => {
        this.removeRecording(recorder.recordingId)
      }
      try {
        if (evicted && attempt === 0) {
          await evicted.stop({ reason: 'replaced' }).catch((error) => {
            this.logger.error('[record] failed to stop oldest recording:', error)
          })
        }
        await recorder.start()
        this.markActive()
        return recorder
      } catch (error) {
        this.removeRecording(recorder.recordingId)
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          continue
        }
        throw error
      }
    }
    throw new RecordingError('Could not allocate a recording id after 20 attempts', 500)
  }

  async stop({ recordingId }: { recordingId?: string }): Promise<{ recordingId: string; eventCount: number; filePath: string }> {
    const recorder: ActionRecorder | null = (() => {
      if (recordingId) {
        return this.recordings.get(recordingId) || null
      }
      const all = [...this.recordings.values()]
      return all.length === 1 ? all[0] : null
    })()
    if (!recorder) {
      if (!recordingId && this.recordings.size > 1) {
        const recordings = [...this.recordings.values()].map((item) => {
          return item.summarize()
        })
        const error = new RecordingError(formatAmbiguousRecordingsError(recordings), 400)
        error.recordings = recordings
        throw error
      }
      throw new RecordingError(recordingId ? `Recording ${recordingId} not found` : 'No active recording', 404)
    }
    const result = await recorder.stop()
    return { recordingId: recorder.recordingId, ...result }
  }

  list(): Array<{
    recordingId: string
    sessionId: string
    startedAt: number
    eventCount: number
    filePath: string
    pageUrls: string[]
    lastUrl: string
  }> {
    return [...this.recordings.values()].map((r) => {
      return {
        ...r.summarize(),
        startedAt: r.startedAt,
        eventCount: r.eventCount,
        filePath: r.filePath,
      }
    })
  }
}
