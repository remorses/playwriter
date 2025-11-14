/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { Protocol } from 'playwriter/src/cdp-types';
import type { ExtensionCommandMessage, ExtensionResponseMessage } from 'playwriter/src/extension/protocol';

export function debugLog(...args: unknown[]): void {
  const enabled = true;
  if (enabled) {
    // eslint-disable-next-line no-console
    console.log('[Extension]', ...args);
  }
}

interface AttachedTab {
  debuggee: chrome.debugger.Debuggee;
  targetId: string;
  sessionId: string;
  targetInfo: Protocol.Target.TargetInfo;
}

export class RelayConnection {
  private _attachedTabs: Map<number, AttachedTab> = new Map();
  private _nextSessionId: number = 1;
  private _ws: WebSocket;
  private _eventListener: (source: chrome.debugger.DebuggerSession, method: string, params: any) => void;
  private _detachListener: (source: chrome.debugger.Debuggee, reason: string) => void;
  private _closed = false;

  onclose?: () => void;

  constructor(ws: WebSocket) {
    this._ws = ws;
    this._ws.onmessage = this._onMessage.bind(this);
    this._ws.onclose = (event) => {
      debugLog('WebSocket onclose event:', {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean
      });
      this._onClose();
    };
    this._ws.onerror = (event) => {
      debugLog('WebSocket onerror event:', event);
    };
    this._eventListener = this._onDebuggerEvent.bind(this);
    this._detachListener = this._onDebuggerDetach.bind(this);
    chrome.debugger.onEvent.addListener(this._eventListener);
    chrome.debugger.onDetach.addListener(this._detachListener);
    debugLog('RelayConnection created, WebSocket readyState:', this._ws.readyState);
  }

  async attachTab(tabId: number): Promise<Protocol.Target.TargetInfo> {
    const debuggee = { tabId };
    
    debugLog('Attaching debugger to tab:', tabId, 'WebSocket state:', this._ws.readyState);
    
    try {
      await chrome.debugger.attach(debuggee, '1.3');
      debugLog('Debugger attached successfully to tab:', tabId);
    } catch (error: any) {
      debugLog('ERROR attaching debugger to tab:', tabId, error);
      throw error;
    }
    
    debugLog('Sending Target.getTargetInfo command for tab:', tabId);
    const result = await chrome.debugger.sendCommand(
      debuggee, 
      'Target.getTargetInfo'
    ) as Protocol.Target.GetTargetInfoResponse;
    
    debugLog('Received targetInfo for tab:', tabId, result.targetInfo);
    
    const targetInfo = result.targetInfo;
    const sessionId = `pw-tab-${this._nextSessionId++}`;
    
    this._attachedTabs.set(tabId, {
      debuggee,
      targetId: targetInfo.targetId,
      sessionId,
      targetInfo
    });
    
    debugLog('Sending Target.attachedToTarget event, WebSocket state:', this._ws.readyState);
    this._sendMessage({
      method: 'forwardCDPEvent',
      params: {
        method: 'Target.attachedToTarget',
        params: {
          sessionId,
          targetInfo: {
            ...targetInfo,
            attached: true
          },
          waitingForDebugger: false
        }
      }
    });
    
    debugLog('Tab attached successfully:', tabId, 'sessionId:', sessionId, 'targetId:', targetInfo.targetId);
    return targetInfo;
  }

  detachTab(tabId: number): void {
    const tab = this._attachedTabs.get(tabId);
    if (!tab) return;
    
    debugLog('Detaching tab:', tabId, 'sessionId:', tab.sessionId);
    
    this._sendMessage({
      method: 'forwardCDPEvent',
      params: {
        method: 'Target.detachedFromTarget',
        params: {
          sessionId: tab.sessionId,
          targetId: tab.targetId
        }
      }
    });
    
    chrome.debugger.detach(tab.debuggee).catch(() => {});
    this._attachedTabs.delete(tabId);
  }

  close(message: string): void {
    debugLog('Closing RelayConnection, reason:', message, 'current state:', this._ws.readyState);
    this._ws.close(1000, message);
    this._onClose();
  }

  private _onClose() {
    if (this._closed) {
      debugLog('_onClose called but already closed');
      return;
    }
    
    debugLog('Connection closing, attached tabs count:', this._attachedTabs.size);
    this._closed = true;
    
    chrome.debugger.onEvent.removeListener(this._eventListener);
    chrome.debugger.onDetach.removeListener(this._detachListener);
    
    for (const [tabId, tab] of this._attachedTabs) {
      debugLog('Detaching debugger from tab:', tabId);
      chrome.debugger.detach(tab.debuggee).catch((err) => {
        debugLog('Error detaching debugger from tab:', tabId, err);
      });
    }
    this._attachedTabs.clear();
    
    debugLog('Connection closed, calling onclose callback');
    this.onclose?.();
  }

  private _onDebuggerEvent(source: chrome.debugger.DebuggerSession, method: string, params: any): void {
    const tab = this._attachedTabs.get(source.tabId!);
    if (!tab) return;
    
    debugLog('Forwarding CDP event:', method, 'from tab:', source.tabId);
    
    this._sendMessage({
      method: 'forwardCDPEvent',
      params: {
        sessionId: source.sessionId || tab.sessionId,
        method,
        params,
      },
    });
  }

  private _onDebuggerDetach(source: chrome.debugger.Debuggee, reason: string): void {
    const tabId = source.tabId;
    debugLog('_onDebuggerDetach called for tab:', tabId, 'reason:', reason, 'isAttached:', tabId ? this._attachedTabs.has(tabId) : false);
    
    if (!tabId || !this._attachedTabs.has(tabId)) {
      debugLog('Ignoring debugger detach event for untracked tab:', tabId);
      return;
    }
    
    debugLog(`Debugger detached from tab ${tabId}: ${reason}`);
    this.detachTab(tabId);
  }

  private _onMessage(event: MessageEvent): void {
    this._onMessageAsync(event).catch(e => debugLog('Error handling message:', e));
  }

  private async _onMessageAsync(event: MessageEvent): Promise<void> {
    let message: ExtensionCommandMessage;
    try {
      message = JSON.parse(event.data);
    } catch (error: any) {
      debugLog('Error parsing message:', error);
      this._sendError(-32700, `Error parsing message: ${error.message}`);
      return;
    }

    debugLog('Received message:', message);

    const response: ExtensionResponseMessage = {
      id: message.id,
    };
    try {
      response.result = await this._handleCommand(message);
    } catch (error: any) {
      debugLog('Error handling command:', error);
      response.error = error.message;
    }
    debugLog('Sending response:', response);
    this._sendMessage(response);
  }

  private async _handleCommand(message: ExtensionCommandMessage): Promise<any> {
    if (message.method === 'attachToTab') {
      return {};
    }
    
    if (message.method === 'forwardCDPCommand') {
      const { sessionId, method, params } = message.params;
      
      if (method === 'Target.closeTarget' && params?.targetId) {
        for (const [tabId, tab] of this._attachedTabs) {
          if (tab.targetId === params.targetId) {
            await chrome.tabs.remove(tabId);
            return { success: true };
          }
        }
        throw new Error(`Target not found: ${params.targetId}`);
      }
      
      let targetTab: AttachedTab | undefined;
      
      for (const [tabId, tab] of this._attachedTabs) {
        if (tab.sessionId === sessionId) {
          targetTab = tab;
          break;
        }
      }
      
      if (!targetTab) {
        if (method === 'Browser.getVersion' || method === 'Target.getTargets') {
          targetTab = this._attachedTabs.values().next().value;
        }
        
        if (!targetTab) {
          throw new Error(`No tab found for sessionId: ${sessionId}`);
        }
      }
      
      debugLog('CDP command:', method, 'for tab:', targetTab.debuggee.tabId);
      
      const debuggerSession: chrome.debugger.DebuggerSession = {
        ...targetTab.debuggee,
        sessionId: sessionId !== targetTab.sessionId ? sessionId : undefined,
      };
      
      return await chrome.debugger.sendCommand(
        debuggerSession,
        method,
        params
      );
    }
  }

  private _sendError(code: number, message: string): void {
    this._sendMessage({
      error: {
        code,
        message,
      },
    });
  }

  private _sendMessage(message: any): void {
    if (this._ws.readyState === WebSocket.OPEN) {
      try {
        this._ws.send(JSON.stringify(message));
        debugLog('Message sent successfully, type:', message.method || 'response');
      } catch (error: any) {
        debugLog('ERROR sending message:', error, 'message type:', message.method || 'response');
      }
    } else {
      debugLog('Cannot send message, WebSocket not open. State:', this._ws.readyState, 'message type:', message.method || 'response');
    }
  }
}
