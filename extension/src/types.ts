export type ConnectionState = 'disconnected' | 'reconnecting' | 'connected' | 'error'
export type TabState = 'connecting' | 'connected' | 'error'

export interface TabInfo {
  sessionId?: string
  targetId?: string
  state: TabState
  errorText?: string
}

export interface ExtensionState {
  tabs: Map<number, TabInfo>
  connectionState: ConnectionState
  currentTabId: number | undefined
  errorText: string | undefined
}
