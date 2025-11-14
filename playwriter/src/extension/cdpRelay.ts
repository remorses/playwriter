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

/**
 * WebSocket server that bridges Playwright MCP and Chrome Extension
 *
 * Endpoints:
 * - /cdp/guid - Full CDP interface for Playwright MCP
 * - /extension/guid - Extension connection for chrome.debugger forwarding
 */

 import net from 'net';

import http from 'http';

import { debug, ws, wsServer } from 'playwright-core/lib/utilsBundle';

import { ManualPromise } from 'playwright-core/lib/utils';



import type { WebSocket, WebSocketServer } from 'playwright-core/lib/utilsBundle';
import type websocket from 'ws';
import type { ExtensionCommandMessage, ExtensionEventMessage, ExtensionMessage } from './protocol.js';
import type { CDPCommand, CDPResponse, CDPEvent, Protocol } from '../cdp-types.js';


const debugLogger = debug('pw:mcp:relay');

interface ConnectedTarget {
  sessionId: string;
  targetId: string;
  targetInfo: Protocol.Target.TargetInfo;
}

export class CDPRelayServer {
  private _wsHost: string;

  private _cdpPath: string;
  private _extensionPath: string;
  private _wss: WebSocketServer;
  private _playwrightConnection: WebSocket | null = null;
  private _extensionConnection: ExtensionConnection | null = null;
  private _connectedTargets: Map<string, ConnectedTarget> = new Map();
  private _extensionConnectionPromise!: ManualPromise<void>;

  constructor(server: http.Server, ) {
    this._wsHost = httpAddressToString(server.address()).replace(/^http/, 'ws');


    this._cdpPath = `/cdp`;
    this._extensionPath = `/extension`;

    this._resetExtensionConnection();
    this._wss = new wsServer({ server });
    this._wss.on('connection', this._onConnection.bind(this));
  }

  cdpEndpoint() {
    return `${this._wsHost}${this._cdpPath}`;
  }

  extensionEndpoint() {
    return `${this._wsHost}${this._extensionPath}`;
  }


  stop(): void {
    this.closeConnections('Server stopped');
    this._wss.close();
  }

  closeConnections(reason: string) {
    this._closePlaywrightConnection(reason);
    this._closeExtensionConnection(reason);
  }

  private _onConnection(ws: WebSocket, request: http.IncomingMessage): void {
    const url = new URL(`http://localhost${request.url}`);
    debugLogger(`New connection to ${url.pathname}`);
    if (url.pathname === this._cdpPath) {
      this._handlePlaywrightConnection(ws);
    } else if (url.pathname === this._extensionPath) {
      this._handleExtensionConnection(ws);
    } else {
      debugLogger(`Invalid path: ${url.pathname}`);
      ws.close(4004, 'Invalid path');
    }
  }

  private _handlePlaywrightConnection(ws: WebSocket): void {
    if (this._playwrightConnection) {
      debugLogger('Rejecting second Playwright connection');
      ws.close(1000, 'Another CDP client already connected');
      return;
    }
    this._playwrightConnection = ws;
    ws.on('message', async data => {
      try {
        const message = JSON.parse(data.toString());
        await this._handlePlaywrightMessage(message);
      } catch (error: any) {
        debugLogger(`Error while handling Playwright message\n${data.toString()}\n`, error);
      }
    });
    ws.on('close', () => {
      if (this._playwrightConnection !== ws)
        return;
      this._playwrightConnection = null;
      debugLogger('Playwright WebSocket closed - extension stays connected');
    });
    ws.on('error', error => {
      debugLogger('Playwright WebSocket error:', error);
    });
    debugLogger('Playwright MCP connected');
  }

  private _closeExtensionConnection(reason: string) {
    this._extensionConnection?.close(reason);
    this._extensionConnectionPromise.reject(new Error(reason));
    this._resetExtensionConnection();
  }

  private _resetExtensionConnection() {
    this._connectedTargets.clear();
    this._extensionConnection = null;
    this._extensionConnectionPromise = new ManualPromise();
    void this._extensionConnectionPromise.catch(logUnhandledError);
  }


  private _closePlaywrightConnection(reason: string) {
    if (this._playwrightConnection?.readyState === ws.OPEN)
      this._playwrightConnection.close(1000, reason);
    this._playwrightConnection = null;
  }

  private _handleExtensionConnection(ws: WebSocket): void {
    if (this._extensionConnection) {
      ws.close(1000, 'Another extension connection already established');
      return;
    }
    this._extensionConnection = new ExtensionConnection(ws);
    this._extensionConnection.onclose = (c, reason) => {
      debugLogger('Extension WebSocket closed:', reason, c === this._extensionConnection);
      if (this._extensionConnection !== c)
        return;
      this._resetExtensionConnection();
      this._closePlaywrightConnection(`Extension disconnected: ${reason}`);
    };
    this._extensionConnection.onmessage = this._handleExtensionMessage.bind(this);
    this._extensionConnectionPromise.resolve();
  }

  private _handleExtensionMessage(message: ExtensionEventMessage) {
    if (message.method === 'forwardCDPEvent') {
      const { method, params, sessionId } = message.params;
      
      if (method === 'Target.attachedToTarget') {
        const targetParams = params as Protocol.Target.AttachedToTargetEvent;
        this._connectedTargets.set(targetParams.sessionId, {
          sessionId: targetParams.sessionId,
          targetId: targetParams.targetInfo.targetId,
          targetInfo: targetParams.targetInfo
        });
        
        debugLogger('\x1b[33m← Extension:\x1b[0m', `Target.attachedToTarget sessionId=${targetParams.sessionId}, targetId=${targetParams.targetInfo.targetId}`);
        
        this._sendToPlaywright({
          method: 'Target.attachedToTarget',
          params: targetParams
        } as CDPEvent);
        
      } else if (method === 'Target.detachedFromTarget') {
        const detachParams = params as Protocol.Target.DetachedFromTargetEvent;
        this._connectedTargets.delete(detachParams.sessionId);
        
        debugLogger('\x1b[33m← Extension:\x1b[0m', `Target.detachedFromTarget sessionId=${detachParams.sessionId}`);
        
        this._sendToPlaywright({
          method: 'Target.detachedFromTarget',
          params: detachParams
        } as CDPEvent);
        
      } else {
        this._sendToPlaywright({
          sessionId,
          method,
          params
        } as CDPEvent);
      }
    }
  }

  private async _handlePlaywrightMessage(message: CDPCommand): Promise<void> {
    debugLogger('\x1b[36m← Playwright:\x1b[0m', `${message.method} (id=${message.id})`);
    const { id, sessionId, method, params } = message;
    try {
      const result = await this._handleCDPCommand(method, params, sessionId);
      this._sendToPlaywright({ id, sessionId, result });
    } catch (e) {
      debugLogger('\x1b[31mError in the extension:\x1b[0m', e);
      this._sendToPlaywright({
        id,
        sessionId,
        error: { message: (e as Error).message }
      });
    }
  }

  private async _handleCDPCommand(method: string, params: any, sessionId: string | undefined): Promise<any> {
    switch (method) {
      case 'Browser.getVersion': {
        return {
          protocolVersion: '1.3',
          product: 'Chrome/Extension-Bridge',
          revision: '1.0.0',
          userAgent: 'CDP-Bridge-Server/1.0.0',
          jsVersion: 'V8',
        } satisfies Protocol.Browser.GetVersionResponse;
      }
      case 'Browser.setDownloadBehavior': {
        return { };
      }
      case 'Target.setAutoAttach': {
        if (sessionId) {
          break;
        }
        
        debugLogger('Target.setAutoAttach received (manual attach mode)');
        debugLogger('Sending Target.attachedToTarget events for existing targets:', this._connectedTargets.size);
        
        for (const target of this._connectedTargets.values()) {
          debugLogger('Sending Target.attachedToTarget for sessionId:', target.sessionId, 'targetId:', target.targetId);
          this._sendToPlaywright({
            method: 'Target.attachedToTarget',
            params: {
              sessionId: target.sessionId,
              targetInfo: {
                ...target.targetInfo,
                attached: true
              },
              waitingForDebugger: false
            }
          } as CDPEvent);
        }
        
        return {};
      }
      case 'Target.getTargetInfo': {
        const targetId = params?.targetId;
        
        if (targetId) {
          for (const target of this._connectedTargets.values()) {
            if (target.targetId === targetId) {
              return { targetInfo: target.targetInfo };
            }
          }
        }
        
        if (sessionId) {
          const target = this._connectedTargets.get(sessionId);
          if (target) {
            return { targetInfo: target.targetInfo };
          }
        }
        
        const firstTarget = this._connectedTargets.values().next().value;
        return { targetInfo: firstTarget?.targetInfo };
      }
      case 'Target.getTargets': {
        return {
          targetInfos: Array.from(this._connectedTargets.values()).map(t => ({
            ...t.targetInfo,
            attached: true,
          }))
        };
      }
      case 'Target.closeTarget': {
        break;
      }
    }
    return await this._forwardToExtension(method, params, sessionId);
  }

  private async _forwardToExtension(method: string, params: any, sessionId: string | undefined): Promise<any> {
    if (!this._extensionConnection)
      throw new Error('Extension not connected');
    
    return await this._extensionConnection.send({ 
      method: 'forwardCDPCommand', 
      params: { sessionId, method, params } 
    });
  }

  private _sendToPlaywright(message: CDPResponse | CDPEvent): void {
    const logMessage = 'method' in message && message.method 
      ? message.method 
      : `response(id=${'id' in message ? message.id : 'unknown'})`;
    debugLogger('\x1b[32m→ Playwright:\x1b[0m', logMessage);
    this._playwrightConnection?.send(JSON.stringify(message));
  }
}

class ExtensionConnection {
  private readonly _ws: WebSocket;
  private readonly _callbacks = new Map<number, { resolve: (o: any) => void, reject: (e: Error) => void, error: Error }>();
  private _lastId = 0;

  onmessage?: (message: ExtensionEventMessage) => void;
  onclose?: (self: ExtensionConnection, reason: string) => void;

  constructor(ws: WebSocket) {
    this._ws = ws;
    this._ws.on('message', this._onMessage.bind(this));
    this._ws.on('close', this._onClose.bind(this));
    this._ws.on('error', this._onError.bind(this));
  }

  async send(command: Omit<ExtensionCommandMessage, 'id'>): Promise<any> {
    if (this._ws.readyState !== ws.OPEN)
      throw new Error(`Unexpected WebSocket state: ${this._ws.readyState}`);
    const id = ++this._lastId;
    this._ws.send(JSON.stringify({ id, ...command }));
    const error = new Error(`Protocol error: ${command.method}`);
    return new Promise((resolve, reject) => {
      this._callbacks.set(id, { resolve, reject, error });
    });
  }

  close(message: string) {
    debugLogger('closing extension connection:', message);
    if (this._ws.readyState === ws.OPEN)
      this._ws.close(1000, message);
  }

  private _onMessage(event: websocket.RawData) {
    const eventData = event.toString();
    let parsedJson;
    try {
      parsedJson = JSON.parse(eventData);
    } catch (e: any) {
      debugLogger(`<closing ws> Closing websocket due to malformed JSON. eventData=${eventData} e=${e?.message}`);
      this._ws.close();
      return;
    }
    try {
      this._handleParsedMessage(parsedJson);
    } catch (e: any) {
      debugLogger(`<closing ws> Closing websocket due to failed onmessage callback. eventData=${eventData} e=${e?.message}`);
      this._ws.close();
    }
  }

  private _handleParsedMessage(object: ExtensionMessage) {
    if ('id' in object && this._callbacks.has(object.id)) {
      const callback = this._callbacks.get(object.id)!;
      this._callbacks.delete(object.id);
      if (object.error) {
        const error = callback.error;
        error.message = object.error;
        callback.reject(error);
      } else {
        callback.resolve(object.result);
      }
    } else if ('id' in object) {
      debugLogger('← Extension: unexpected response', object);
    } else {
      this.onmessage?.(object as ExtensionEventMessage);
    }
  }

  private _onClose(event: websocket.CloseEvent) {
    debugLogger(`<ws closed> code=${event.code} reason=${event.reason}`);
    this._dispose();
    this.onclose?.(this, event.reason);
  }

  private _onError(event: websocket.ErrorEvent) {
    debugLogger(`<ws error> message=${event.message} type=${event.type} target=${event.target}`);
    this._dispose();
  }

  private _dispose() {
    for (const callback of this._callbacks.values())
      callback.reject(new Error('WebSocket closed'));
    this._callbacks.clear();
  }
}


export function httpAddressToString(address: string | net.AddressInfo | null): string {

  if (!address)
    throw new Error('Invalid null address passeds to httpAddressToString');
  if (typeof address === 'string')
    return address;
  const resolvedPort = address.port;
  let resolvedHost = address.family === 'IPv4' ? address.address : `[${address.address}]`;
  if (resolvedHost === '0.0.0.0' || resolvedHost === '[::]')
    resolvedHost = 'localhost';
  return `http://${resolvedHost}:${resolvedPort}`;
}
function logUnhandledError(e: unknown) {
  debugLogger('Unhandled promise rejection:', e instanceof Error ? e.stack || e.message : e);
}
