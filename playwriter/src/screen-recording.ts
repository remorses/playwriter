/**
 * Screen recording utility for playwriter using chrome.tabCapture.
 * Recording happens in the extension context, so it survives page navigation.
 * 
 * This module communicates with the relay server which forwards commands to the extension.
 * SessionId (pw-tab-X format) is used to identify which tab to record.
 */

import os from 'node:os'
import type { Page } from 'playwright-core'
import type {
  StartRecordingResult,
  StopRecordingResult,
  IsRecordingResult,
  CancelRecordingResult,
} from './protocol.js'
import { EXTENSION_IDS } from './utils.js'

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
  const flags = EXTENSION_IDS.map(id => `--allowlisted-extension-id=${id}`).join(' ') + ' --auto-accept-this-tab-capture'
  
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
  return error.includes('Extension has not been invoked') || 
         error.includes('activeTab') ||
         error.includes('enable recording')
}

export interface StartRecordingOptions {
  /** Target page to record */
  page: Page
  /** Session ID (pw-tab-X format) to identify which tab to record */
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
  /** Session ID (pw-tab-X format) to identify which tab to stop recording */
  sessionId?: string
  /** Relay server port (default: 19988) */
  relayPort?: number
}

export interface RecordingState {
  isRecording: boolean
  startedAt?: number
  tabId?: number
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
  
  const response = await fetch(`http://127.0.0.1:${relayPort}/recording/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, frameRate, videoBitsPerSecond, audioBitsPerSecond, audio, outputPath }),
  })

  const result = await response.json() as StartRecordingResult

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
        `Or click the Playwriter extension icon on the tab once to grant permission.`
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
export async function stopRecording(options: StopRecordingOptions): Promise<{ path: string; duration: number; size: number }> {
  const { sessionId, relayPort = 19988 } = options

  const response = await fetch(`http://127.0.0.1:${relayPort}/recording/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  })

  const result = await response.json() as StopRecordingResult

  if (!result.success) {
    throw new Error(`Failed to stop recording: ${result.error}`)
  }

  return { path: result.path, duration: result.duration, size: result.size }
}

/**
 * Check if recording is currently active.
 */
export async function isRecording(options: { page: Page; sessionId?: string; relayPort?: number }): Promise<RecordingState> {
  const { sessionId, relayPort = 19988 } = options

  const url = sessionId 
    ? `http://127.0.0.1:${relayPort}/recording/status?sessionId=${encodeURIComponent(sessionId)}`
    : `http://127.0.0.1:${relayPort}/recording/status`
  const response = await fetch(url)
  const result = await response.json() as IsRecordingResult

  return { isRecording: result.isRecording, startedAt: result.startedAt, tabId: result.tabId }
}

/**
 * Cancel recording without saving.
 */
export async function cancelRecording(options: { page: Page; sessionId?: string; relayPort?: number }): Promise<void> {
  const { sessionId, relayPort = 19988 } = options

  const response = await fetch(`http://127.0.0.1:${relayPort}/recording/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  })

  const result = await response.json() as CancelRecordingResult

  if (!result.success) {
    throw new Error(`Failed to cancel recording: ${result.error}`)
  }
}
