/**
 * Offscreen document for Playwriter screen recording.
 *
 * WHY OFFSCREEN DOCUMENT?
 * Manifest V3 service workers cannot use MediaRecorder or getUserMedia directly.
 * This hidden document provides access to Web APIs while the service worker orchestrates.
 *
 * RECORDING FLOW:
 *
 * ┌─────────────────┐     HTTP      ┌─────────────────┐    WebSocket    ┌─────────────────┐
 * │  User Code      │ ────────────► │  Relay Server   │ ───────────────►│  Extension      │
 * │  startRecording │               │  /recording/*   │                 │  background.ts  │
 * └─────────────────┘               └─────────────────┘                 └────────┬────────┘
 *                                                                                │
 *                                          ┌─────────────────────────────────────┘
 *                                          ▼
 *                                   ┌─────────────────┐
 *                                   │  Offscreen Doc  │  ◄── MediaRecorder
 *                                   │  (this file)    │
 *                                   └─────────────────┘
 *
 * STEP BY STEP:
 * 1. User calls startRecording() → HTTP POST to relay server
 * 2. Relay server forwards to extension via WebSocket
 * 3. Extension calls chrome.tabCapture.getMediaStreamId() to get capture permission
 *    - Requires --allowlisted-extension-id flag OR user clicking extension icon
 * 4. Extension creates this offscreen document via chrome.offscreen.createDocument()
 * 5. Extension sends streamId to offscreen document
 * 6. Offscreen calls navigator.mediaDevices.getUserMedia() with streamId
 * 7. Offscreen creates MediaRecorder and starts encoding to mp4
 * 8. Chunks are sent back to extension → relay server → written to output file
 *
 * KEY APIS:
 * - chrome.tabCapture.getMediaStreamId() - Extension API, gets capture permission
 * - chrome.offscreen.createDocument()    - Extension API, creates this document
 * - navigator.mediaDevices.getUserMedia() - Web API, gets MediaStream from streamId
 * - MediaRecorder                         - Web API, encodes video to mp4
 */

import type {
  OffscreenMessage,
  OffscreenStartRecordingMessage,
  OffscreenStopRecordingMessage,
  OffscreenIsRecordingMessage,
  OffscreenCancelRecordingMessage,
  OffscreenStartRecordingResult,
  OffscreenStopRecordingResult,
  OffscreenIsRecordingResult,
  OffscreenCancelRecordingResult,
  ChromeTabCaptureAudioConstraints,
  ChromeTabCaptureVideoConstraints,
} from './offscreen-types'

interface OffscreenRecordingState {
  recorder: MediaRecorder
  stream: MediaStream
  startedAt: number
  tabId: number
}

// Map of tabId -> recording state for concurrent recording support
const recordings = new Map<number, OffscreenRecordingState>()

type OffscreenResult =
  | OffscreenStartRecordingResult
  | OffscreenStopRecordingResult
  | OffscreenIsRecordingResult
  | OffscreenCancelRecordingResult

chrome.runtime.onMessage.addListener((message: OffscreenMessage, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse)
  return true // Keep channel open for async response
})

async function handleMessage(message: OffscreenMessage): Promise<OffscreenResult> {
  switch (message.action) {
    case 'startRecording':
      return handleStartRecording(message)
    case 'stopRecording':
      return handleStopRecording(message)
    case 'isRecording':
      return handleIsRecording(message)
    case 'cancelRecording':
      return handleCancelRecording(message)
    default:
      return { success: false, error: 'Unknown action' }
  }
}

async function handleStartRecording(params: OffscreenStartRecordingMessage): Promise<OffscreenStartRecordingResult> {
  const { tabId } = params

  if (recordings.has(tabId)) {
    return { success: false, error: `Recording already in progress for tab ${tabId}` }
  }

  try {
    // Build Chrome-specific tabCapture constraints
    // These use Chrome's proprietary API that TypeScript doesn't have built-in types for
    const audioConstraints: ChromeTabCaptureAudioConstraints | false = params.audio
      ? {
          mandatory: {
            chromeMediaSource: 'tab',
            chromeMediaSourceId: params.streamId,
          },
        }
      : false

    const videoConstraints: ChromeTabCaptureVideoConstraints = {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: params.streamId,
        minFrameRate: params.frameRate || 30,
        maxFrameRate: params.frameRate || 30,
      },
    }

    // Get media stream from the streamId provided by tabCapture.getMediaStreamId
    // Cast to MediaStreamConstraints since Chrome accepts the extended constraints
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints,
      video: videoConstraints,
    } as MediaStreamConstraints)

    const recorder = new MediaRecorder(stream, {
      mimeType: 'video/mp4',
      videoBitsPerSecond: params.videoBitsPerSecond || 2500000,
      audioBitsPerSecond: params.audioBitsPerSecond || 128000,
    })

    const startedAt = Date.now()

    recordings.set(tabId, {
      recorder,
      stream,
      startedAt,
      tabId,
    })

    // Send chunks to service worker - each chunk includes tabId for routing
    recorder.ondataavailable = async (event) => {
      if (event.data.size > 0) {
        // Convert blob to array buffer and send to service worker
        const arrayBuffer = await event.data.arrayBuffer()
        const uint8Array = new Uint8Array(arrayBuffer)
        chrome.runtime.sendMessage({
          action: 'recordingChunk',
          tabId,
          data: Array.from(uint8Array), // Convert to regular array for message passing
        })
      }
    }

    recorder.onerror = (event: Event) => {
      console.error(`MediaRecorder error for tab ${tabId}:`, (event as ErrorEvent).error)
      handleCancelRecordingForTab(tabId)
    }

    recorder.onstop = () => {
      console.log(`MediaRecorder stopped for tab ${tabId}`)
    }

    // Wait for MediaRecorder to actually start before returning.
    // This ensures the encoder is initialized and ready to capture frames.
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('MediaRecorder failed to start within 5 seconds'))
      }, 5000)

      recorder.onstart = () => {
        clearTimeout(timeout)
        console.log(`MediaRecorder started for tab ${tabId}`)
        resolve()
      }

      // Start with 1 second chunks
      recorder.start(1000)
    })

    return { success: true, tabId, startedAt, mimeType: 'video/mp4' }
  } catch (error: any) {
    console.error(`Failed to start recording for tab ${tabId}:`, error)
    return { success: false, error: error.message }
  }
}

async function handleStopRecording(params: OffscreenStopRecordingMessage): Promise<OffscreenStopRecordingResult> {
  const { tabId } = params
  const recording = recordings.get(tabId)

  if (!recording) {
    return { success: false, error: `No active recording for tab ${tabId}` }
  }

  try {
    const { recorder, stream, startedAt } = recording

    // Stop recorder and wait for final data
    await new Promise<void>((resolve) => {
      const originalOnStop = recorder.onstop
      recorder.onstop = (event: Event) => {
        if (originalOnStop) {
          originalOnStop.call(recorder, event)
        }
        resolve()
      }
      if (recorder.state !== 'inactive') {
        recorder.stop()
      } else {
        resolve()
      }
    })

    // Stop all tracks
    stream.getTracks().forEach((track: MediaStreamTrack) => {
      track.stop()
    })

    const duration = Date.now() - startedAt

    // Send final marker
    chrome.runtime.sendMessage({
      action: 'recordingChunk',
      tabId,
      final: true,
    })

    recordings.delete(tabId)

    return { success: true, tabId, duration }
  } catch (error: any) {
    console.error(`Failed to stop recording for tab ${tabId}:`, error)
    return { success: false, error: error.message }
  }
}

function handleIsRecording(params: OffscreenIsRecordingMessage): OffscreenIsRecordingResult {
  const { tabId } = params
  const recording = recordings.get(tabId)

  if (!recording) {
    return { isRecording: false, tabId }
  }

  return {
    isRecording: recording.recorder?.state === 'recording',
    tabId,
    startedAt: recording.startedAt,
  }
}

function handleCancelRecording(params: OffscreenCancelRecordingMessage): OffscreenCancelRecordingResult {
  const { tabId } = params
  return handleCancelRecordingForTab(tabId)
}

// Helper function to cancel recording for a specific tab - used by error handlers too
function handleCancelRecordingForTab(tabId: number): OffscreenCancelRecordingResult {
  const recording = recordings.get(tabId)

  if (!recording) {
    return { success: true, tabId }
  }

  try {
    const { recorder, stream } = recording

    if (recorder.state !== 'inactive') {
      recorder.stop()
    }
    stream.getTracks().forEach((track: MediaStreamTrack) => {
      track.stop()
    })

    chrome.runtime.sendMessage({
      action: 'recordingCancelled',
      tabId,
    })

    recordings.delete(tabId)

    return { success: true, tabId }
  } catch (error: any) {
    console.error(`Failed to cancel recording for tab ${tabId}:`, error)
    return { success: false, error: error.message }
  }
}

console.log('Playwriter offscreen document loaded')
