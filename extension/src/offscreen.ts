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
 * 7. Offscreen creates MediaRecorder and starts encoding to webm
 * 8. Chunks are sent back to extension → relay server → written to output file
 * 
 * KEY APIS:
 * - chrome.tabCapture.getMediaStreamId() - Extension API, gets capture permission
 * - chrome.offscreen.createDocument()    - Extension API, creates this document
 * - navigator.mediaDevices.getUserMedia() - Web API, gets MediaStream from streamId
 * - MediaRecorder                         - Web API, encodes video to webm
 */

interface OffscreenRecordingState {
  recorder: MediaRecorder
  stream: MediaStream
  startedAt: number
  tabId: number
}

let recording: OffscreenRecordingState | null = null

// Message types
type StartRecordingMessage = {
  action: 'startRecording'
  tabId: number
  streamId: string
  frameRate?: number
  videoBitsPerSecond?: number
  audioBitsPerSecond?: number
  audio?: boolean
}

type StopRecordingMessage = {
  action: 'stopRecording'
}

type IsRecordingMessage = {
  action: 'isRecording'
}

type CancelRecordingMessage = {
  action: 'cancelRecording'
}

type OffscreenMessage = StartRecordingMessage | StopRecordingMessage | IsRecordingMessage | CancelRecordingMessage

chrome.runtime.onMessage.addListener((message: OffscreenMessage, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse)
  return true // Keep channel open for async response
})

async function handleMessage(message: OffscreenMessage): Promise<any> {
  switch (message.action) {
    case 'startRecording':
      return handleStartRecording(message)
    case 'stopRecording':
      return handleStopRecording()
    case 'isRecording':
      return handleIsRecording()
    case 'cancelRecording':
      return handleCancelRecording()
    default:
      return { success: false, error: 'Unknown action' }
  }
}

async function handleStartRecording(params: StartRecordingMessage): Promise<any> {
  if (recording) {
    return { success: false, error: 'Recording already in progress' }
  }

  try {
    // Get media stream from the streamId provided by tabCapture.getMediaStreamId
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: params.audio ? {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: params.streamId,
        }
      } as any : false,
      video: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: params.streamId,
          minFrameRate: params.frameRate || 30,
          maxFrameRate: params.frameRate || 30,
        }
      } as any,
    })

    // Determine best codec
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      ? 'video/webm;codecs=vp9,opus'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
        ? 'video/webm;codecs=vp8,opus'
        : 'video/webm'

    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: params.videoBitsPerSecond || 2500000,
      audioBitsPerSecond: params.audioBitsPerSecond || 128000,
    })

    const startedAt = Date.now()

    recording = {
      recorder,
      stream,
      startedAt,
      tabId: params.tabId,
    }

    // Send chunks to service worker
    recorder.ondataavailable = async (event) => {
      if (event.data.size > 0) {
        // Convert blob to array buffer and send to service worker
        const arrayBuffer = await event.data.arrayBuffer()
        const uint8Array = new Uint8Array(arrayBuffer)
        chrome.runtime.sendMessage({
          action: 'recordingChunk',
          tabId: params.tabId,
          data: Array.from(uint8Array), // Convert to regular array for message passing
        })
      }
    }

    recorder.onerror = (event: Event) => {
      console.error('MediaRecorder error:', (event as ErrorEvent).error)
      handleCancelRecording()
    }

    recorder.onstop = () => {
      console.log('MediaRecorder stopped')
    }

    // Start with 1 second chunks
    recorder.start(1000)

    return { success: true, tabId: params.tabId, startedAt, mimeType }
  } catch (error: any) {
    console.error('Failed to start recording:', error)
    return { success: false, error: error.message }
  }
}

async function handleStopRecording(): Promise<any> {
  if (!recording) {
    return { success: false, error: 'No active recording' }
  }

  try {
    const { recorder, stream, startedAt, tabId } = recording

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
    stream.getTracks().forEach((track: MediaStreamTrack) => { track.stop() })

    const duration = Date.now() - startedAt

    // Send final marker
    chrome.runtime.sendMessage({
      action: 'recordingChunk',
      tabId,
      final: true,
    })

    recording = null

    return { success: true, tabId, duration }
  } catch (error: any) {
    console.error('Failed to stop recording:', error)
    return { success: false, error: error.message }
  }
}

function handleIsRecording(): any {
  if (!recording) {
    return { isRecording: false }
  }
  return {
    isRecording: recording.recorder?.state === 'recording',
    tabId: recording.tabId,
    startedAt: recording.startedAt,
  }
}

function handleCancelRecording(): any {
  if (!recording) {
    return { success: true }
  }

  try {
    const { recorder, stream, tabId } = recording

    if (recorder.state !== 'inactive') {
      recorder.stop()
    }
    stream.getTracks().forEach((track: MediaStreamTrack) => { track.stop() })

    chrome.runtime.sendMessage({
      action: 'recordingCancelled',
      tabId,
    })

    recording = null

    return { success: true }
  } catch (error: any) {
    console.error('Failed to cancel recording:', error)
    return { success: false, error: error.message }
  }
}

console.log('Playwriter offscreen document loaded')
