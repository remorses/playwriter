import { CDPEventFor, ProtocolMapping } from './cdp-types.js'

export const VERSION = 1

type ForwardCDPCommand = {
  [K in keyof ProtocolMapping.Commands]: {
    id: number
    method: 'forwardCDPCommand'
    params: {
      method: K
      sessionId?: string
      params?: ProtocolMapping.Commands[K]['paramsType'][0]
      source?: 'playwriter'
    }
  }
}[keyof ProtocolMapping.Commands]

export type ExtensionCommandMessage = ForwardCDPCommand

export type ExtensionResponseMessage = {
  id: number
  method?: undefined
  result?: any
  error?: string
}

/**
 * This produces a discriminated union for narrowing, similar to ForwardCDPCommand,
 * but for forwarded CDP events. Uses CDPEvent to maintain proper type extraction.
 */
export type ExtensionEventMessage = {
  [K in keyof ProtocolMapping.Events]: {
    id?: undefined
    method: 'forwardCDPEvent'
    params: {
      method: CDPEventFor<K>['method']
      sessionId?: string
      params?: CDPEventFor<K>['params']
    }
  }
}[keyof ProtocolMapping.Events]

export type ExtensionLogMessage = {
  id?: undefined
  method: 'log'
  params: {
    level: 'log' | 'debug' | 'info' | 'warn' | 'error'
    args: string[]
  }
}

export type ExtensionPongMessage = {
  id?: undefined
  method: 'pong'
}

export type ServerPingMessage = {
  method: 'ping'
  id?: undefined
}

export type RecordingDataMessage = {
  id?: undefined
  method: 'recordingData'
  params: {
    tabId: number
    final?: boolean
  }
}

export type RecordingCancelledMessage = {
  id?: undefined
  method: 'recordingCancelled'
  params: {
    tabId: number
  }
}

/**
 * Sent right before the extension forwards a completed Page.downloadProgress event.
 * Chrome rejects Browser.setDownloadBehavior on a tab-scoped debugger session, so the
 * relay cannot make Chrome write downloads into Playwright's artifact directory.
 * chrome.downloads is the only place the real path is readable, so the extension
 * reports it and the relay copies the file where Playwright expects to find it.
 */
export type DownloadCompletedMessage = {
  id?: undefined
  method: 'downloadCompleted'
  params: {
    guid: string
    /** Absolute path Chrome wrote the finished download to. */
    filename?: string
    /** Why the extension could not resolve a finished file, when filename is absent. */
    error?: string
  }
}

export type ExtensionMessage =
  | ExtensionResponseMessage
  | ExtensionEventMessage
  | ExtensionLogMessage
  | ExtensionPongMessage
  | RecordingDataMessage
  | RecordingCancelledMessage
  | DownloadCompletedMessage

// Recording command messages (MCP -> Extension via relay)
export type StartRecordingParams = {
  /** CDP tab session ID (pw-tab-*) to identify which tab to record. */
  sessionId?: string
  frameRate?: number
  audio?: boolean
  videoBitsPerSecond?: number
  audioBitsPerSecond?: number
}

/** HTTP body for /recording/start endpoint */
export type StartRecordingBody = StartRecordingParams & {
  outputPath: string
}

export type StopRecordingParams = {
  /** CDP tab session ID (pw-tab-*) to identify which tab to stop recording. */
  sessionId?: string
}

export type IsRecordingParams = {
  /** CDP tab session ID (pw-tab-*) to identify which tab to check. */
  sessionId?: string
}

export type CancelRecordingParams = {
  /** CDP tab session ID (pw-tab-*) to identify which tab to cancel. */
  sessionId?: string
}

export type StartRecordingMessage = {
  id: number
  method: 'startRecording'
  params: StartRecordingParams
}

export type StopRecordingMessage = {
  id: number
  method: 'stopRecording'
  params: StopRecordingParams
}

export type IsRecordingMessage = {
  id: number
  method: 'isRecording'
  params: IsRecordingParams
}

export type CancelRecordingMessage = {
  id: number
  method: 'cancelRecording'
  params: CancelRecordingParams
}

export type RecordingCommandMessage =
  | StartRecordingMessage
  | StopRecordingMessage
  | IsRecordingMessage
  | CancelRecordingMessage

// Recording result types
export type StartRecordingResult =
  | {
      success: true
      tabId: number
      startedAt: number
    }
  | {
      success: false
      error: string
    }

/** Result from extension - doesn't include path/size since relay writes the file */
export type ExtensionStopRecordingResult =
  | {
      success: true
      tabId: number
      duration: number
    }
  | {
      success: false
      error: string
    }

/** Final result from relay - includes path/size after file is written */
export type StopRecordingResult =
  | {
      success: true
      tabId: number
      duration: number
      path: string
      size: number
    }
  | {
      success: false
      error: string
    }

export type IsRecordingResult = {
  isRecording: boolean
  tabId?: number
  startedAt?: number
}

export type CancelRecordingResult = {
  success: boolean
  error?: string
}

// ============================================================================
// Streaming types (HTTP-only, used by /stream/* endpoints).
// Streaming reuses the recording WS messages (startRecording/stopRecording/
// recordingData) so no WS protocol changes are needed and old extensions keep
// working. The relay pipes chunks to ffmpeg instead of accumulating them.
// ============================================================================

export type StartStreamParams = {
  /** CDP tab session ID (pw-tab-*) to identify which tab to stream. */
  sessionId?: string
  /** RTMP destination URLs (or any ffmpeg-writable flv target, e.g. a file path for testing). */
  rtmpUrls: string[]
  /** Output resolution as WxH (default 1920x1080, X Live recommended). */
  resolution?: string
  /** Output frame rate (default 30). */
  fps?: number
  /** Video bitrate in kbps (default 9000, X Live recommended). */
  videoBitrateKbps?: number
  /** Audio bitrate in kbps (default 128). */
  audioBitrateKbps?: number
  /** Keyframe interval in seconds (default 3, X Live recommended and its max;
   *  Twitch recommends 2). */
  keyframeSeconds?: number
  /** Capture tab audio (default true). When false, a silent audio track is injected
   *  because platforms like X Live reject streams without audio. */
  audio?: boolean
  /** x264 preset (default veryfast). Only applies to libx264. */
  preset?: string
  /** Video codec for ffmpeg -c:v (default: auto-detect hardware encoder, falls back to libx264). */
  codec?: string
}

export type StartStreamResult =
  | {
      success: true
      tabId: number
      startedAt: number
      /** Destinations with stream keys redacted */
      destinations: string[]
    }
  | {
      success: false
      error: string
    }

export type StopStreamParams = {
  sessionId?: string
}

export type StopStreamResult =
  | {
      success: true
      tabId: number
      /** Stream duration in ms */
      duration: number
      /** Total bytes received from the extension and piped to ffmpeg */
      bytesReceived: number
    }
  | {
      success: false
      error: string
    }

export type StreamStats = {
  chunksReceived: number
  bytesReceived: number
  /** Encoder output fps parsed from ffmpeg progress lines */
  ffmpegFps?: number
  /** Encoder output bitrate in kbps parsed from ffmpeg progress lines */
  ffmpegBitrateKbps?: number
  /** Dropped frames parsed from ffmpeg progress lines */
  droppedFrames?: number
  lastFfmpegLine?: string
}

export type StreamStatusResult = {
  streaming: boolean
  tabId?: number
  startedAt?: number
  /** Destinations with stream keys redacted */
  destinations?: string[]
  stats?: StreamStats
  /** Error from the last stream that died unexpectedly (ffmpeg crash, RTMP failure) */
  error?: string
}

// Ghost Browser API command message (for Ghost Browser integration)
export type GhostBrowserCommandMessage = {
  id: number
  method: 'ghost-browser'
  params: {
    /** API namespace: 'ghostPublicAPI' | 'ghostProxies' | 'projects' */
    namespace: 'ghostPublicAPI' | 'ghostProxies' | 'projects'
    /** Method name within the namespace */
    method: string
    /** Arguments to pass to the method */
    args: unknown[]
  }
}

export type GhostBrowserCommandResult =
  | {
      success: true
      result: unknown
    }
  | {
      success: false
      error: string
    }
