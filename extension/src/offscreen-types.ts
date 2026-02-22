/**
 * Types for communication between background.ts and offscreen.ts.
 * These are Chrome extension internal messages, separate from the WS protocol types.
 */

// Chrome-specific MediaStreamConstraints that TypeScript doesn't know about.
// These use Chrome's proprietary tabCapture API constraints.
// See: https://developer.chrome.com/docs/extensions/reference/tabCapture/
export interface ChromeTabCaptureAudioConstraints {
  mandatory: {
    chromeMediaSource: 'tab'
    chromeMediaSourceId: string
  }
}

export interface ChromeTabCaptureVideoConstraints {
  mandatory: {
    chromeMediaSource: 'tab'
    chromeMediaSourceId: string
    minFrameRate?: number
    maxFrameRate?: number
  }
}

// Offscreen document message types
export interface OffscreenStartRecordingMessage {
  action: 'startRecording'
  tabId: number
  streamId: string
  frameRate?: number
  videoBitsPerSecond?: number
  audioBitsPerSecond?: number
  audio?: boolean
}

export interface OffscreenStopRecordingMessage {
  action: 'stopRecording'
  tabId: number
}

export interface OffscreenIsRecordingMessage {
  action: 'isRecording'
  tabId: number
}

export interface OffscreenCancelRecordingMessage {
  action: 'cancelRecording'
  tabId: number
}

export type OffscreenMessage =
  | OffscreenStartRecordingMessage
  | OffscreenStopRecordingMessage
  | OffscreenIsRecordingMessage
  | OffscreenCancelRecordingMessage

// Offscreen document response types
export type OffscreenStartRecordingResult =
  | {
      success: true
      tabId: number
      startedAt: number
      mimeType: string
    }
  | {
      success: false
      error: string
    }

export type OffscreenStopRecordingResult =
  | {
      success: true
      tabId: number
      duration: number
    }
  | {
      success: false
      error: string
    }

export interface OffscreenIsRecordingResult {
  isRecording: boolean
  tabId: number
  startedAt?: number
}

export type OffscreenCancelRecordingResult =
  | {
      success: true
      tabId: number
    }
  | {
      success: false
      error: string
    }

// Messages sent FROM offscreen TO background
export interface OffscreenRecordingChunkMessage {
  action: 'recordingChunk'
  tabId: number
  data?: number[] // Array from Uint8Array for message passing
  final?: boolean
}

export interface OffscreenRecordingCancelledMessage {
  action: 'recordingCancelled'
  tabId: number
}

export type OffscreenOutgoingMessage = OffscreenRecordingChunkMessage | OffscreenRecordingCancelledMessage
