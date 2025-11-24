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

import type { CDPEvent, Protocol } from 'playwriter/src/cdp-types';
import type { ExtensionCommandMessage, ExtensionResponseMessage } from 'playwriter/src/extension/protocol';

let activeConnection: RelayConnection | undefined;

export const logger = {
  log: (...args: any[]) => logToRemote('log', args),
  debug: (...args: any[]) => logToRemote('debug', args),
  info: (...args: any[]) => logToRemote('info', args),
  warn: (...args: any[]) => logToRemote('warn', args),
  error: (...args: any[]) => logToRemote('error', args),
};

function logToRemote(level: 'log' | 'debug' | 'info' | 'warn' | 'error', args: any[]) {
  // Always log to local console
  console[level](...args);

  if (activeConnection) {
    activeConnection.sendLog(level, args);
  }
}

function safeSerialize(arg: any): string {
  if (arg === undefined) return 'undefined';
  if (arg === null) return 'null';
  if (typeof arg === 'function') return `[Function: ${arg.name || 'anonymous'}]`;
  if (typeof arg === 'symbol') return String(arg);

  if (arg instanceof Error) {
    return arg.stack || arg.message || String(arg);
  }

  if (typeof arg === 'object') {
    try {
      const seen = new WeakSet();
      return JSON.stringify(arg, (key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) return '[Circular]';
          seen.add(value);

          if (value instanceof Map) {
            return {
              dataType: 'Map',
              value: Array.from(value.entries())
            };
          }

          if (value instanceof Set) {
            return {
              dataType: 'Set',
              value: Array.from(value.values())
            };
          }
        }
        return value;
      });
    } catch (e) {
      return String(arg);
    }
  }

  return String(arg);
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
  private _closed = false;
  private _onCloseCallback?: (reason: string, code: number) => void;
  private _onTabDetachedCallback?: (tabId: number, reason: `${chrome.debugger.DetachReason}`) => void
  private _onTabAttachedCallback?: (tabId: number, targetId: string) => void

  constructor({ ws, onClose, onTabDetached, onTabAttached }: {
    ws: WebSocket;
    onClose?: (reason: string, code: number) => void;
    onTabDetached?: (tabId: number, reason: `${chrome.debugger.DetachReason}`) => void;
    onTabAttached?: (tabId: number, targetId: string) => void;
  }) {
    this._ws = ws;
    this._onCloseCallback = onClose;
    this._onTabDetachedCallback = onTabDetached;
    this._onTabAttachedCallback = onTabAttached;
    this._ws.onmessage = async (event: MessageEvent) => {
      let message: ExtensionCommandMessage;
      try {
        message = JSON.parse(event.data);
      } catch (error: any) {
        logger.debug('Error parsing message:', error);
        this._sendMessage({
          error: {
            code: -32700,
            message: `Error parsing message: ${error.message}`,
          },
        });
        return;
      }

      logger.debug('Received message:', message);

      const response: ExtensionResponseMessage = {
        id: message.id,
      };
      try {
        response.result = await this._handleCommand(message);
      } catch (error: any) {
        logger.debug('Error handling command:', error);
        response.error = error.message;
      }
      logger.debug('Sending response:', response);
      this._sendMessage(response);
    };
    this._ws.onclose = (event: CloseEvent) => {
      logger.debug('WebSocket onclose event:', {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean
      });
      this._onClose(event.reason, event.code);
    };
    this._ws.onerror = (event: Event) => {
      logger.debug('WebSocket onerror event:', event);
    };
    chrome.debugger.onEvent.addListener(this._onDebuggerEvent);
    chrome.debugger.onDetach.addListener(this._onDebuggerDetach);
    logger.debug('RelayConnection created, WebSocket readyState:', this._ws.readyState);
    activeConnection = this;
  }

  sendLog(level: string, args: any[]) {
    this._sendMessage({
      method: 'log',
      params: {
        level,
        args: args.map(arg => safeSerialize(arg))
      }
    });
  }

  async attachTab(tabId: number): Promise<Protocol.Target.TargetInfo> {
    const debuggee = { tabId };

    logger.debug('Attaching debugger to tab:', tabId, 'WebSocket state:', this._ws.readyState);

    try {
      await chrome.debugger.attach(debuggee, '1.3');
      logger.debug('Debugger attached successfully to tab:', tabId);
    } catch (error: any) {
      logger.debug('ERROR attaching debugger to tab:', tabId, error);
      throw error;
    }

    logger.debug('Sending Target.getTargetInfo command for tab:', tabId);
    const result = await chrome.debugger.sendCommand(
      debuggee,
      'Target.getTargetInfo'
    ) as Protocol.Target.GetTargetInfoResponse;

    logger.debug('Received targetInfo for tab:', tabId, result.targetInfo);

    const targetInfo = result.targetInfo;
    const sessionId = `pw-tab-${this._nextSessionId++}`;

    this._attachedTabs.set(tabId, {
      debuggee,
      targetId: targetInfo.targetId,
      sessionId,
      targetInfo,
    });

    logger.debug('Sending Target.attachedToTarget event, WebSocket state:', this._ws.readyState);
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

    logger.debug('Tab attached successfully:', tabId, 'sessionId:', sessionId, 'targetId:', targetInfo.targetId);
    this._onTabAttachedCallback?.(tabId, targetInfo.targetId);
    return targetInfo;
  }

  detachTab(tabId: number): void {
    this._cleanupTab(tabId, true);
  }

  private _cleanupTab(tabId: number, shouldDetachDebugger: boolean): void {
    const tab = this._attachedTabs.get(tabId);
    if (!tab) {
      logger.debug('cleanupTab: tab not found in map:', tabId);
      return;
    }

    logger.debug('Cleaning up tab:', tabId, 'sessionId:', tab.sessionId, 'shouldDetach:', shouldDetachDebugger);

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

    this._attachedTabs.delete(tabId);
    logger.debug('Removed tab from _attachedTabs map. Remaining tabs:', this._attachedTabs.size);

    if (shouldDetachDebugger) {
      chrome.debugger.detach(tab.debuggee)
        .then(() => {
          logger.debug('Successfully detached debugger from tab:', tabId);
        })
        .catch((err) => {
          logger.debug('Error detaching debugger from tab:', tabId, err.message);
        });
    }
  }

  close(message: string): void {
    logger.debug('Closing RelayConnection, reason:', message, 'current state:', this._ws.readyState);
    this._ws.close(1000, message);
    this._onClose(message, 1000);
  }

  private _onClose(reason: string = 'Unknown', code: number = 1000) {
    if (this._closed) {
      logger.debug('_onClose called but already closed');
      return;
    }

    logger.debug('Connection closing, attached tabs count:', this._attachedTabs.size);
    this._closed = true;


    chrome.debugger.onEvent.removeListener(this._onDebuggerEvent);
    chrome.debugger.onDetach.removeListener(this._onDebuggerDetach);

    const tabIds = Array.from(this._attachedTabs.keys());
    logger.debug('Detaching all tabs:', tabIds);

    for (const [tabId, tab] of this._attachedTabs) {
      logger.debug('Detaching debugger from tab:', tabId);
      chrome.debugger.detach(tab.debuggee)
        .then(() => {
          logger.debug('Successfully detached from tab:', tabId);
        })
        .catch((err) => {
          logger.debug('Error detaching from tab:', tabId, err.message);
        });
    }

    this._attachedTabs.clear();
    logger.debug('All tabs cleared from map. Chrome automation bar should disappear in a few seconds.');

    logger.debug('Connection closed, calling onClose callback');
    if (activeConnection === this) {
      activeConnection = undefined;
    }
    this._onCloseCallback?.(reason, code);
  }

  private _onDebuggerEvent = (source: chrome.debugger.DebuggerSession, method: string, params: any): void => {
    const tab = this._attachedTabs.get(source.tabId!);
    if (!tab) return;

    // Track execution contexts so we can replay them when Playwright reconnects.
    // Chrome's debugger only sends Runtime.executionContextCreated events once per context,
    // not on every Runtime.enable call. We cache them here and replay on reconnection.

    logger.debug('Forwarding CDP event:', method, 'from tab:', source.tabId);

    this._sendMessage({
      method: 'forwardCDPEvent',
      params: {
        sessionId: source.sessionId || tab.sessionId,
        method,
        params,
      },
    });
  };

  private _onDebuggerDetach = (source: chrome.debugger.Debuggee, reason: `${chrome.debugger.DetachReason}`): void => {
    const tabId = source.tabId;
    logger.debug('_onDebuggerDetach called for tab:', tabId, 'reason:', reason, 'isAttached:', tabId ? this._attachedTabs.has(tabId) : false);

    if (!tabId || !this._attachedTabs.has(tabId)) {
      logger.debug('Ignoring debugger detach event for untracked tab:', tabId);
      return;
    }

    logger.debug(`Manual debugger detachment detected for tab ${tabId}: ${reason}`);
    logger.debug('User closed debugger via Chrome automation bar, calling onTabDetached callback');
    this._onTabDetachedCallback?.(tabId, reason);

    this._cleanupTab(tabId, false);
  };

  private async _handleCommand(msg: ExtensionCommandMessage): Promise<any> {
    if (msg.method === 'attachToTab') {
      return {};
    }

    if (msg.method === 'forwardCDPCommand') {


      if (msg.params.method === 'Target.createTarget') {
        const url = msg.params.params?.url || 'about:blank';
        logger.debug('Creating new tab with URL:', url);

        const tab = await chrome.tabs.create({ url, active: false });
        if (!tab.id) {
          throw new Error('Failed to create tab');
        }

        logger.debug('Created tab:', tab.id, 'waiting for it to load...');

        // Wait a bit for tab to initialize
        await new Promise(resolve => setTimeout(resolve, 100));

        // Attach to the new tab
        const targetInfo = await this.attachTab(tab.id);

        return { targetId: targetInfo.targetId };
      }

      if (msg.params.method === 'Target.closeTarget'  && msg.params.params?.targetId) {
        logger.debug('Closing target:', msg.params.params.targetId);

        for (const [tabId, tab] of this._attachedTabs) {
          if (tab.targetId === msg.params.params.targetId) {
            logger.debug('Found tab to close:', tabId);
            await chrome.tabs.remove(tabId);
            return { success: true };
          }
        }

        logger.debug('Target not found:', msg.params.params.targetId);
        throw new Error(`Target not found: ${msg.params.params.targetId}`);
      }

      let targetTab: AttachedTab | undefined;

      for (const [tabId, tab] of this._attachedTabs) {
        if (tab.sessionId === msg.params.sessionId) {
          targetTab = tab;
          break;
        }
      }

      if (!targetTab) {
        if (msg.params.method === 'Browser.getVersion' || msg.params.method === 'Target.getTargets') {
          targetTab = this._attachedTabs.values().next().value;
        }

        if (!targetTab) {
          throw new Error(`No tab found for method ${msg.params.method} sessionId: ${msg.params.sessionId}`);
        }
      }

      logger.debug('CDP command:', msg.params.method, 'for tab:', targetTab.debuggee.tabId);

      const debuggerSession: chrome.debugger.DebuggerSession = {
        ...targetTab.debuggee,
        sessionId: msg.params.sessionId !== targetTab.sessionId ? msg.params.sessionId : undefined,
      };

      // CRITICAL FIX FOR PLAYWRIGHT HANGS:
      // When Playwright connects to an existing page, it sends 'Runtime.enable' and waits for
      // 'Runtime.executionContextCreated' events to map out available execution contexts (frames, workers).
      //
      // However, if the Runtime domain is already enabled or if Chrome doesn't re-emit these events
      // for existing contexts upon a standard 'Runtime.enable' call, Playwright never gets the
      // context IDs it needs. This causes commands like `page.evaluate()` to hang indefinitely
      // because Playwright is waiting for a context that it believes hasn't been created yet.
      //
      // To fix this, we intercept 'Runtime.enable' and force a reset:
      // 1. We send 'Runtime.disable'. This clears Chrome's internal Runtime state for this session.
      // 2. We wait a brief moment (100ms) to ensure the disable command propagates.
      // 3. Then we allow the original 'Runtime.enable' command to proceed.
      //
      // This sequence forces Chrome to treat the enablement as a fresh start, causing it to
      // re-scan and emit 'Runtime.executionContextCreated' events for ALL existing contexts.
      // Playwright receives these events, populates its context map, and the hang is resolved.
      if (msg.params.method === 'Runtime.enable') {
        logger.debug('Runtime.enable called, disabling first to force context refresh for tab:', targetTab.debuggee.tabId);
        try {
          await chrome.debugger.sendCommand(debuggerSession, 'Runtime.disable');
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (e) {
          logger.debug('Error disabling Runtime (ignoring):', e);
        }
      }

      const result = await chrome.debugger.sendCommand(
        debuggerSession,
        msg.params.method,
        msg.params.params
      );

      return result;
    }

  }

  private _sendMessage(message: any): void {
    if (this._ws.readyState === WebSocket.OPEN) {
      try {
        this._ws.send(JSON.stringify(message));
        // logger.debug('Message sent successfully, type:', message.method || 'response');
      } catch (error: any) {
        // Use console directly to avoid infinite recursion if logger tries to send log over this same connection
        console.debug('ERROR sending message:', error, 'message type:', message.method || 'response');
      }
    } else {
       // Use console directly to avoid infinite recursion
      console.debug('Cannot send message, WebSocket not open. State:', this._ws.readyState, 'message type:', message.method || 'response');
    }
  }
}
