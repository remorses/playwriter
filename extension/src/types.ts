export type ConnectionState = 'idle' | 'connected' | 'extension-replaced'
export type TabState = 'connecting' | 'connected' | 'error'

export interface TabInfo {
  sessionId?: string
  targetId?: string
  state: TabState
  errorText?: string
  pinnedCount?: number
  attachOrder?: number
  isRecording?: boolean
}

export interface ExtensionState {
  tabs: Map<number, TabInfo>
  connectionState: ConnectionState
  currentTabId: number | undefined
  errorText: string | undefined
}

/**
 * Recording state - stored in service worker to track active recordings.
 * The actual MediaRecorder/MediaStream live in the offscreen document.
 */
export interface RecordingInfo {
  tabId: number
  startedAt: number
}
