/**
 * Screen recording utility for playwriter using chrome.tabCapture.
 * Recording happens in the extension context, so it survives page navigation.
 *
 * This module communicates with the relay server which forwards commands to the extension.
 * sessionId (pw-tab-* format) is used to identify which tab to record.
 */

import os from 'node:os'
import path from 'node:path'
import type { BrowserContext, Page } from '@xmorse/playwright-core'
import type {
  StartRecordingResult,
  StopRecordingResult,
  IsRecordingResult,
  CancelRecordingResult,
} from './protocol.js'
import { EXTENSION_IDS } from './utils.js'
import { RecordingGhostCursorController } from './recording-ghost-cursor.js'

/**
 * Generate a shell command to quit and restart Chrome with flags that allow automatic tab capture.
 * This enables screen recording without user interaction (clicking extension icon).
 *
 * Required flags:
 * - --allowlisted-extension-id=<id> - grants the extension special privileges (one per extension)
 * - --auto-accept-this-tab-capture - auto-accepts tab capture permission requests
 */
export function getChromeRestartCommand(): string {
  const platform = os.platform()
  const extensionFlags = EXTENSION_IDS.map((id) => `--allowlisted-extension-id=${id}`).join(' ')
  // --profile-directory=Default skips the profile picker on startup, preventing Chrome from hanging
  const flags = `${extensionFlags} --auto-accept-this-tab-capture --profile-directory=Default`

  if (platform === 'darwin') {
    return `osascript -e 'quit app "Google Chrome"' && sleep 1 && open -a "Google Chrome" --args ${flags}`
  }
  if (platform === 'win32') {
    return `taskkill /IM chrome.exe /F & timeout /t 1 & start chrome.exe ${flags}`
  }
  // Linux
  return `pkill chrome; sleep 1; google-chrome ${flags}`
}

const DEFAULT_ASPECT_RATIO = { width: 16, height: 9 }

/** Default max recording duration: 15 minutes in milliseconds */
const DEFAULT_MAX_DURATION_MS = 15 * 60 * 1000

/**
 * Compute the largest viewport that fits inside `current` at the target aspect ratio.
 * Never increases width or height beyond current values — only shrinks the
 * dimension that's "too large" relative to the target ratio.
 */
export function fitToAspectRatio(
  current: { width: number; height: number },
  ratio: { width: number; height: number } = DEFAULT_ASPECT_RATIO,
): { width: number; height: number } {
  const targetRatio = ratio.width / ratio.height
  const currentRatio = current.width / current.height
  if (currentRatio > targetRatio) {
    // Too wide — keep height, shrink width
    return { width: Math.round(current.height * targetRatio), height: current.height }
  }
  // Too tall (or already exact) — keep width, shrink height
  return { width: current.width, height: Math.round(current.width / targetRatio) }
}

/**
 * Check if an error is related to missing activeTab permission for recording.
 */
function isActiveTabPermissionError(error: string): boolean {
  return (
    error.includes('Extension has not been invoked') ||
    error.includes('activeTab') ||
    error.includes('enable recording')
  )
}

export interface StartRecordingOptions {
  /** Target page to record */
  page: Page
  /** CDP tab session ID (pw-tab-* format) to identify which tab to record */
  sessionId?: string
  /** Frame rate (default: 30) */
  frameRate?: number
  /** Video bitrate in bps (default: 2500000 = 2.5 Mbps) */
  videoBitsPerSecond?: number
  /** Audio bitrate in bps (default: 128000 = 128 kbps) */
  audioBitsPerSecond?: number
  /** Include audio from tab (default: false) */
  audio?: boolean
  /** Path to save the video file */
  outputPath: string
  /** Relay server host (default: '127.0.0.1') */
  relayHost?: string
  /** Relay server port (default: 19988) */
  relayPort?: number
  /** Authentication token for remote relay server */
  relayToken?: string
  /** Aspect ratio to fit viewport to before recording (default: { width: 16, height: 9 }).
   *  Set to null to skip viewport resizing. */
  aspectRatio?: { width: number; height: number } | null
  /** Max recording duration in ms (default: 15 min = 900000). Auto-stops recording
   *  when exceeded to prevent accidentally filling disk. Set to 0 or Infinity to disable. */
  maxDurationMs?: number
}

export interface StopRecordingOptions {
  /** Target page that is being recorded */
  page: Page
  /** CDP tab session ID (pw-tab-* format) to identify which tab to stop recording */
  sessionId?: string
  /** Relay server host (default: '127.0.0.1') */
  relayHost?: string
  /** Relay server port (default: 19988) */
  relayPort?: number
  /** Authentication token for remote relay server */
  relayToken?: string
}

export interface RecordingState {
  isRecording: boolean
  startedAt?: number
  tabId?: number
}

export interface ExecutionTimestamp {
  start: number
  end: number
}

interface RecordingTargetOptions {
  page?: Page
  sessionId?: string
}

interface CreateRecordingApiOptions {
  context: BrowserContext
  defaultPage: Page
  relayHost: string
  relayPort: number
  relayToken?: string
  ghostCursorController: RecordingGhostCursorController
  onStart: () => void
  onFinish: () => void
  getExecutionTimestamps: () => ExecutionTimestamp[]
}

interface StartRecordingWithDefaultsOptions extends Omit<StartRecordingOptions, 'relayHost' | 'relayPort' | 'relayToken'> {}
interface StopRecordingWithDefaultsOptions extends Omit<StopRecordingOptions, 'relayHost' | 'relayPort' | 'relayToken'> {}
interface IsRecordingWithDefaultsOptions {
  page?: Page
  sessionId?: string
}
interface CancelRecordingWithDefaultsOptions {
  page?: Page
  sessionId?: string
}

function resolveRecordingTargetPage(options: {
  context: BrowserContext
  defaultPage: Page
  ghostCursorController: RecordingGhostCursorController
  target?: RecordingTargetOptions
}): Page {
  return options.ghostCursorController.resolveRecordingTargetPage({
    context: options.context,
    defaultPage: options.defaultPage,
    target: options.target,
  })
}

function withRecordingDefaults<T extends { page?: Page; sessionId?: string }, R>(options: {
  relayHost: string
  relayPort: number
  relayToken?: string
  defaultPage: Page
  fn: (opts: T & { relayHost: string; relayPort: number; relayToken?: string; sessionId?: string }) => Promise<R>
}): (input?: T) => Promise<R> {
  const { relayHost, relayPort, relayToken, defaultPage, fn } = options
  return async (input: T = {} as T) => {
    const targetPage = input.page || defaultPage
    const sessionId = input.sessionId || targetPage.sessionId() || undefined
    return fn({ page: targetPage, sessionId, relayHost, relayPort, relayToken, ...input })
  }
}

export function createRecordingApi(options: CreateRecordingApiOptions): {
  start: (opts?: StartRecordingWithDefaultsOptions) => Promise<RecordingState>
  stop: (opts?: StopRecordingWithDefaultsOptions) => Promise<{ path: string; duration: number; size: number; executionTimestamps: ExecutionTimestamp[] }>
  isRecording: (opts?: IsRecordingWithDefaultsOptions) => Promise<RecordingState>
  cancel: (opts?: CancelRecordingWithDefaultsOptions) => Promise<void>
} {
  const { context, defaultPage, relayHost, relayPort, relayToken, ghostCursorController, onStart, onFinish, getExecutionTimestamps } = options

  // Stores the original viewport before aspect-ratio resize so we can restore on stop/cancel
  let preRecordingViewport: { width: number; height: number } | null = null
  // Auto-stop timer to prevent unbounded recordings
  let maxDurationTimer: ReturnType<typeof setTimeout> | null = null

  const isRecordingWithDefaults = async (opts: IsRecordingWithDefaultsOptions = {}): Promise<RecordingState> => {
    const targetPage = opts.page || defaultPage
    const sessionId = opts.sessionId || targetPage.sessionId() || undefined
    return isRecording({ page: targetPage, sessionId, relayHost, relayPort, relayToken })
  }

  const cancelWithDefaults = async (opts: CancelRecordingWithDefaultsOptions = {}): Promise<void> => {
    const targetPage = opts.page || defaultPage
    const sessionId = opts.sessionId || targetPage.sessionId() || undefined
    await cancelRecording({ page: targetPage, sessionId, relayHost, relayPort, relayToken })
  }

  const start = async (opts?: StartRecordingWithDefaultsOptions): Promise<RecordingState> => {
    const targetPage = resolveRecordingTargetPage({ context, defaultPage, ghostCursorController, target: opts })

    // Resize viewport to target aspect ratio (default 16:9) before recording.
    // Only shrinks — never increases width or height beyond current values.
    const aspectRatio = opts?.aspectRatio === undefined ? DEFAULT_ASPECT_RATIO : opts.aspectRatio
    if (aspectRatio) {
      const current = targetPage.viewportSize()
      if (current) {
        const fitted = fitToAspectRatio(current, aspectRatio)
        if (fitted.width !== current.width || fitted.height !== current.height) {
          preRecordingViewport = current
          await targetPage.setViewportSize(fitted)
        }
      }
    }

    const sessionId = opts?.sessionId || targetPage.sessionId() || undefined
    if (!opts?.outputPath) {
      throw new Error('outputPath is required for recording')
    }
    const result = await startRecording({ ...opts, page: targetPage, sessionId, relayHost, relayPort, relayToken, outputPath: opts.outputPath })
    onStart()
    await ghostCursorController.enableForRecording({ page: targetPage })

    // Schedule auto-stop to prevent unbounded recordings filling disk.
    // Default 15 min. Set maxDurationMs to 0 or Infinity to disable.
    const maxMs = opts?.maxDurationMs ?? DEFAULT_MAX_DURATION_MS
    if (maxMs > 0 && maxMs < Infinity) {
      maxDurationTimer = setTimeout(() => {
        maxDurationTimer = null
        stop(opts ? { page: opts.page, sessionId: opts.sessionId } : undefined).catch(() => {})
      }, maxMs)
    }

    return result
  }

  const clearMaxDurationTimer = (): void => {
    if (maxDurationTimer) {
      clearTimeout(maxDurationTimer)
      maxDurationTimer = null
    }
  }

  const restoreViewport = async (targetPage: Page): Promise<void> => {
    if (!preRecordingViewport) {
      return
    }
    const saved = preRecordingViewport
    preRecordingViewport = null
    await targetPage.setViewportSize(saved)
  }

  const stop = async (
    opts?: StopRecordingWithDefaultsOptions,
  ): Promise<{ path: string; duration: number; size: number; executionTimestamps: ExecutionTimestamp[] }> => {
    clearMaxDurationTimer()
    const targetPage = resolveRecordingTargetPage({ context, defaultPage, ghostCursorController, target: opts })
    const sessionId = opts?.sessionId || targetPage.sessionId() || undefined
    const result = await stopRecording({ ...opts, page: targetPage, sessionId, relayHost, relayPort, relayToken })
    const executionTimestamps = [...getExecutionTimestamps()]
    onFinish()
    await ghostCursorController.disableForRecording({ page: targetPage })
    await restoreViewport(targetPage)
    return { ...result, executionTimestamps }
  }

  const cancel = async (opts?: CancelRecordingWithDefaultsOptions): Promise<void> => {
    clearMaxDurationTimer()
    const targetPage = resolveRecordingTargetPage({ context, defaultPage, ghostCursorController, target: opts })
    await cancelWithDefaults(opts)
    onFinish()
    await ghostCursorController.disableForRecording({ page: targetPage })
    await restoreViewport(targetPage)
  }

  return {
    start,
    stop,
    isRecording: isRecordingWithDefaults,
    cancel,
  }
}

/**
 * Start recording the page.
 * The recording is handled by the extension, so it survives page navigation.
 */
export async function startRecording(options: StartRecordingOptions): Promise<RecordingState> {
  const {
    sessionId,
    frameRate = 30,
    videoBitsPerSecond = 2500000,
    audioBitsPerSecond = 128000,
    audio = false,
    outputPath,
    relayHost = '127.0.0.1',
    relayPort = 19988,
    relayToken,
  } = options

  // Resolve relative paths to absolute using the caller's cwd.
  // The relay server may have a different cwd, so we must resolve here.
  const absoluteOutputPath = path.resolve(outputPath)

  const response = await fetch(`http://${relayHost}:${relayPort}/recording/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(relayToken ? { Authorization: `Bearer ${relayToken}` } : {}),
    },
    body: JSON.stringify({
      sessionId,
      frameRate,
      videoBitsPerSecond,
      audioBitsPerSecond,
      audio,
      outputPath: absoluteOutputPath,
    }),
  })

  const result = (await response.json()) as StartRecordingResult

  if (!result.success) {
    const errorMsg = result.error || 'Unknown error'

    // If the error is about missing activeTab permission, provide helpful guidance
    if (isActiveTabPermissionError(errorMsg)) {
      const restartCmd = getChromeRestartCommand()
      throw new Error(
        `Failed to start recording: ${errorMsg}\n\n` +
          `For automated recording, Chrome must be restarted with special flags.\n` +
          `WARNING: This will close all Chrome windows. Save your work first!\n\n` +
          `  ${restartCmd}\n\n` +
          `Or click the Playwriter extension icon on the tab once to grant permission.`,
      )
    }

    throw new Error(`Failed to start recording: ${errorMsg}`)
  }

  return {
    isRecording: true,
    startedAt: result.startedAt,
    tabId: result.tabId,
  }
}

/**
 * Stop recording and save to file.
 * Returns the path to the saved video file.
 */
export async function stopRecording(
  options: StopRecordingOptions,
): Promise<{ path: string; duration: number; size: number }> {
  const { sessionId, relayHost = '127.0.0.1', relayPort = 19988, relayToken } = options

  const response = await fetch(`http://${relayHost}:${relayPort}/recording/stop`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(relayToken ? { Authorization: `Bearer ${relayToken}` } : {}),
    },
    body: JSON.stringify({ sessionId }),
  })

  const result = (await response.json()) as StopRecordingResult

  if (!result.success) {
    throw new Error(`Failed to stop recording: ${result.error}`)
  }

  return { path: result.path, duration: result.duration, size: result.size }
}

/**
 * Check if recording is currently active.
 */
export async function isRecording(options: {
  page: Page
  sessionId?: string
  relayHost?: string
  relayPort?: number
  relayToken?: string
}): Promise<RecordingState> {
  const { sessionId, relayHost = '127.0.0.1', relayPort = 19988, relayToken } = options

  const url = new URL(`http://${relayHost}:${relayPort}/recording/status`)
  if (sessionId) {
    url.searchParams.set('sessionId', sessionId)
  }
  const response = await fetch(url.toString(), {
    headers: {
      ...(relayToken ? { Authorization: `Bearer ${relayToken}` } : {}),
    },
  })
  const result = (await response.json()) as IsRecordingResult

  return { isRecording: result.isRecording, startedAt: result.startedAt, tabId: result.tabId }
}

/**
 * Cancel recording without saving.
 */
export async function cancelRecording(options: {
  page: Page
  sessionId?: string
  relayHost?: string
  relayPort?: number
  relayToken?: string
}): Promise<void> {
  const { sessionId, relayHost = '127.0.0.1', relayPort = 19988, relayToken } = options

  const response = await fetch(`http://${relayHost}:${relayPort}/recording/cancel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(relayToken ? { Authorization: `Bearer ${relayToken}` } : {}),
    },
    body: JSON.stringify({ sessionId }),
  })

  const result = (await response.json()) as CancelRecordingResult

  if (!result.success) {
    throw new Error(`Failed to cancel recording: ${result.error}`)
  }
}
