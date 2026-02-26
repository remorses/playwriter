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
  /** Relay server port (default: 19988) */
  relayPort?: number
}

export interface StopRecordingOptions {
  /** Target page that is being recorded */
  page: Page
  /** CDP tab session ID (pw-tab-* format) to identify which tab to stop recording */
  sessionId?: string
  /** Relay server port (default: 19988) */
  relayPort?: number
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
  relayPort: number
  ghostCursorController: RecordingGhostCursorController
  onStart: () => void
  onFinish: () => void
  getExecutionTimestamps: () => ExecutionTimestamp[]
}

interface StartRecordingWithDefaultsOptions extends Omit<StartRecordingOptions, 'relayPort'> {}
interface StopRecordingWithDefaultsOptions extends Omit<StopRecordingOptions, 'relayPort'> {}
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
  relayPort: number
  defaultPage: Page
  fn: (opts: T & { relayPort: number; sessionId?: string }) => Promise<R>
}): (input?: T) => Promise<R> {
  const { relayPort, defaultPage, fn } = options
  return async (input: T = {} as T) => {
    const targetPage = input.page || defaultPage
    const sessionId = input.sessionId || targetPage.sessionId() || undefined
    return fn({ page: targetPage, sessionId, relayPort, ...input })
  }
}

export function createRecordingApi(options: CreateRecordingApiOptions): {
  start: (opts?: StartRecordingWithDefaultsOptions) => Promise<RecordingState>
  stop: (opts?: StopRecordingWithDefaultsOptions) => Promise<{ path: string; duration: number; size: number; executionTimestamps: ExecutionTimestamp[] }>
  isRecording: (opts?: IsRecordingWithDefaultsOptions) => Promise<RecordingState>
  cancel: (opts?: CancelRecordingWithDefaultsOptions) => Promise<void>
} {
  const { context, defaultPage, relayPort, ghostCursorController, onStart, onFinish, getExecutionTimestamps } = options

  const startWithDefaults = withRecordingDefaults<StartRecordingWithDefaultsOptions, RecordingState>({
    relayPort,
    defaultPage,
    fn: startRecording,
  })
  const stopWithDefaults = withRecordingDefaults<StopRecordingWithDefaultsOptions, { path: string; duration: number; size: number }>({
    relayPort,
    defaultPage,
    fn: stopRecording,
  })
  const isRecordingWithDefaults = async (opts: IsRecordingWithDefaultsOptions = {}): Promise<RecordingState> => {
    const targetPage = opts.page || defaultPage
    const sessionId = opts.sessionId || targetPage.sessionId() || undefined
    return isRecording({ page: targetPage, sessionId, relayPort })
  }

  const cancelWithDefaults = async (opts: CancelRecordingWithDefaultsOptions = {}): Promise<void> => {
    const targetPage = opts.page || defaultPage
    const sessionId = opts.sessionId || targetPage.sessionId() || undefined
    await cancelRecording({ page: targetPage, sessionId, relayPort })
  }

  const start = async (opts?: StartRecordingWithDefaultsOptions): Promise<RecordingState> => {
    const targetPage = resolveRecordingTargetPage({ context, defaultPage, ghostCursorController, target: opts })
    const result = await startWithDefaults(opts)
    onStart()
    await ghostCursorController.enableForRecording({ page: targetPage })
    return result
  }

  const stop = async (
    opts?: StopRecordingWithDefaultsOptions,
  ): Promise<{ path: string; duration: number; size: number; executionTimestamps: ExecutionTimestamp[] }> => {
    const targetPage = resolveRecordingTargetPage({ context, defaultPage, ghostCursorController, target: opts })
    const result = await stopWithDefaults(opts)
    const executionTimestamps = [...getExecutionTimestamps()]
    onFinish()
    await ghostCursorController.disableForRecording({ page: targetPage })
    return { ...result, executionTimestamps }
  }

  const cancel = async (opts?: CancelRecordingWithDefaultsOptions): Promise<void> => {
    const targetPage = resolveRecordingTargetPage({ context, defaultPage, ghostCursorController, target: opts })
    await cancelWithDefaults(opts)
    onFinish()
    await ghostCursorController.disableForRecording({ page: targetPage })
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
    relayPort = 19988,
  } = options

  // Resolve relative paths to absolute using the caller's cwd.
  // The relay server may have a different cwd, so we must resolve here.
  const absoluteOutputPath = path.resolve(outputPath)

  const response = await fetch(`http://127.0.0.1:${relayPort}/recording/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  const { sessionId, relayPort = 19988 } = options

  const response = await fetch(`http://127.0.0.1:${relayPort}/recording/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  relayPort?: number
}): Promise<RecordingState> {
  const { sessionId, relayPort = 19988 } = options

  const url = new URL(`http://127.0.0.1:${relayPort}/recording/status`)
  if (sessionId) {
    url.searchParams.set('sessionId', sessionId)
  }
  const response = await fetch(url.toString())
  const result = (await response.json()) as IsRecordingResult

  return { isRecording: result.isRecording, startedAt: result.startedAt, tabId: result.tabId }
}

/**
 * Cancel recording without saving.
 */
export async function cancelRecording(options: {
  page: Page
  sessionId?: string
  relayPort?: number
}): Promise<void> {
  const { sessionId, relayPort = 19988 } = options

  const response = await fetch(`http://127.0.0.1:${relayPort}/recording/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  })

  const result = (await response.json()) as CancelRecordingResult

  if (!result.success) {
    throw new Error(`Failed to cancel recording: ${result.error}`)
  }
}
