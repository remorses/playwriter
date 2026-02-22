/**
 * Screen recording functionality for the Playwriter extension.
 * Uses chrome.tabCapture to record tabs via an offscreen document.
 */

import type { RecordingInfo } from './types'
import type {
  StartRecordingParams,
  StopRecordingParams,
  IsRecordingParams,
  CancelRecordingParams,
  StartRecordingResult,
  ExtensionStopRecordingResult,
  IsRecordingResult,
  CancelRecordingResult,
} from 'playwriter/src/protocol'
import type {
  OffscreenStartRecordingResult,
  OffscreenStopRecordingResult,
  OffscreenIsRecordingResult,
} from './offscreen-types'
import { store, connectionManager, logger, sendMessage, getTabBySessionId } from './background'

// Active recordings - kept outside store since MediaRecorder/MediaStream can't be serialized
const activeRecordings: Map<number, RecordingInfo> = new Map()

// Offscreen document management
let offscreenDocumentCreating: Promise<void> | null = null

/**
 * Get the active recordings map (for cleanup on tab disconnect).
 */
export function getActiveRecordings(): Map<number, RecordingInfo> {
  return activeRecordings
}

async function ensureOffscreenDocument(): Promise<void> {
  // Check if already exists
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL('src/offscreen.html')],
  })

  if (existingContexts.length > 0) {
    return
  }

  // Reuse in-progress creation
  if (offscreenDocumentCreating) {
    return offscreenDocumentCreating
  }

  offscreenDocumentCreating = chrome.offscreen.createDocument({
    url: 'src/offscreen.html',
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: 'Screen recording via chrome.tabCapture',
  })

  try {
    await offscreenDocumentCreating
  } finally {
    offscreenDocumentCreating = null
  }
}

function resolveTabIdFromSessionId(sessionId?: string): number | undefined {
  if (!sessionId) {
    // Return the first connected tab
    for (const [tabId, tab] of store.getState().tabs) {
      if (tab.state === 'connected') {
        return tabId
      }
    }
    return undefined
  }

  const found = getTabBySessionId(sessionId)
  return found?.tabId
}

function updateTabRecordingState(tabId: number, isRecording: boolean): void {
  store.setState((state) => {
    const newTabs = new Map(state.tabs)
    const existing = newTabs.get(tabId)
    if (existing) {
      newTabs.set(tabId, { ...existing, isRecording })
    }
    return { tabs: newTabs }
  })
}

export async function handleStartRecording(params: StartRecordingParams): Promise<StartRecordingResult> {
  const tabId = resolveTabIdFromSessionId(params.sessionId)
  if (!tabId) {
    return {
      success: false,
      error: 'No connected tab found for recording. Click the Playwriter extension icon on the tab you want to record.',
    }
  }

  if (activeRecordings.has(tabId)) {
    return { success: false, error: 'Recording already in progress for this tab' }
  }

  const tabInfo = store.getState().tabs.get(tabId)
  if (!tabInfo || tabInfo.state !== 'connected') {
    return { success: false, error: 'Tab is not connected' }
  }

  logger.debug('Starting recording for tab:', tabId, 'params:', params)

  try {
    // Ensure offscreen document exists
    await ensureOffscreenDocument()

    // Get stream ID using chrome.tabCapture.getMediaStreamId (requires activeTab permission - user must click extension icon)
    const streamId = await new Promise<string>((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
        if (chrome.runtime.lastError) {
          const errorMsg = chrome.runtime.lastError.message || 'Unknown error'
          // Chrome returns this error when activeTab permission hasn't been granted
          // User must click the extension icon at least once per session - this is a Chrome security requirement
          if (errorMsg.includes('Extension has not been invoked') || errorMsg.includes('activeTab')) {
            reject(new Error(`${errorMsg}. Click the Playwriter extension icon on this tab to enable recording.`))
          } else {
            reject(new Error(errorMsg))
          }
        } else if (!id) {
          reject(new Error('Failed to get media stream ID'))
        } else {
          resolve(id)
        }
      })
    })

    logger.debug('Got stream ID for tab:', tabId, 'streamId:', streamId.substring(0, 20) + '...')

    // Send message to offscreen document to start recording
    const result = (await chrome.runtime.sendMessage({
      action: 'startRecording',
      tabId,
      streamId,
      frameRate: params.frameRate ?? 30,
      videoBitsPerSecond: params.videoBitsPerSecond ?? 2500000,
      audioBitsPerSecond: params.audioBitsPerSecond ?? 128000,
      audio: params.audio ?? false,
    })) as OffscreenStartRecordingResult

    if (!result.success) {
      return { success: false, error: result.error || 'Failed to start recording in offscreen document' }
    }

    const startedAt = result.startedAt || Date.now()

    // Store recording info
    activeRecordings.set(tabId, { tabId, startedAt })

    // Update tab state
    updateTabRecordingState(tabId, true)

    logger.debug('Recording started for tab:', tabId, 'mimeType:', result.mimeType)
    return { success: true, tabId, startedAt }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('Failed to start recording:', error)
    return { success: false, error: errorMessage }
  }
}

export async function handleStopRecording(params: StopRecordingParams): Promise<ExtensionStopRecordingResult> {
  const tabId = resolveTabIdFromSessionId(params.sessionId)
  if (!tabId) {
    return { success: false, error: 'No connected tab found' }
  }

  const recording = activeRecordings.get(tabId)
  if (!recording) {
    return { success: false, error: 'No active recording for this tab' }
  }

  logger.debug('Stopping recording for tab:', tabId)

  try {
    // Send message to offscreen document to stop recording - include tabId for concurrent support
    const result = (await chrome.runtime.sendMessage({
      action: 'stopRecording',
      tabId,
    })) as OffscreenStopRecordingResult

    if (!result.success) {
      return { success: false, error: result.error || 'Failed to stop recording in offscreen document' }
    }

    const duration = result.duration || Date.now() - recording.startedAt

    // Clean up
    activeRecordings.delete(tabId)
    updateTabRecordingState(tabId, false)

    logger.debug('Recording stopped for tab:', tabId, 'duration:', duration)
    return { success: true, tabId, duration }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('Failed to stop recording:', error)
    return { success: false, error: errorMessage }
  }
}

export async function handleIsRecording(params: IsRecordingParams): Promise<IsRecordingResult> {
  const tabId = resolveTabIdFromSessionId(params.sessionId)
  if (!tabId) {
    return { isRecording: false }
  }

  const recording = activeRecordings.get(tabId)
  if (!recording) {
    return { isRecording: false, tabId }
  }

  // Check with offscreen document for actual recording state - include tabId for concurrent support
  try {
    const result = (await chrome.runtime.sendMessage({
      action: 'isRecording',
      tabId,
    })) as OffscreenIsRecordingResult

    return {
      isRecording: result.isRecording,
      tabId,
      startedAt: recording.startedAt,
    }
  } catch {
    // If offscreen doc is gone, recording is not active
    return { isRecording: false, tabId }
  }
}

export async function handleCancelRecording(params: CancelRecordingParams): Promise<CancelRecordingResult> {
  const tabId = resolveTabIdFromSessionId(params.sessionId)
  if (!tabId) {
    return { success: false, error: 'No connected tab found' }
  }

  const recording = activeRecordings.get(tabId)
  if (!recording) {
    return { success: true } // Already not recording
  }

  logger.debug('Cancelling recording for tab:', tabId)

  try {
    // Send message to offscreen document to cancel recording - include tabId for concurrent support
    await chrome.runtime.sendMessage({
      action: 'cancelRecording',
      tabId,
    })

    activeRecordings.delete(tabId)
    updateTabRecordingState(tabId, false)

    // Send cancel marker
    if (connectionManager.ws?.readyState === WebSocket.OPEN) {
      sendMessage({
        method: 'recordingCancelled',
        params: { tabId },
      })
    }

    return { success: true }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('Failed to cancel recording:', error)
    return { success: false, error: errorMessage }
  }
}

/**
 * Clean up recordings when tab is disconnected.
 */
export async function cleanupRecordingForTab(tabId: number): Promise<void> {
  const recording = activeRecordings.get(tabId)
  if (recording) {
    logger.debug('Cleaning up recording for disconnected tab:', tabId)
    try {
      // Tell offscreen document to cancel recording - include tabId for concurrent support
      await chrome.runtime.sendMessage({ action: 'cancelRecording', tabId })
    } catch (e) {
      logger.debug('Error cleaning up recording:', e)
    }
    activeRecordings.delete(tabId)
  }
}
