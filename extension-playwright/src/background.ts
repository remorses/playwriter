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

import { RelayConnection, debugLog } from './relayConnection';

// Relay URL - fixed port for MCP bridge
const RELAY_URL = 'ws://localhost:9988/extension';

class SimplifiedExtension {
  private _connection: RelayConnection | undefined;
  private _connectedTabs: Map<number, string> = new Map();

  constructor() {
    debugLog(`Using relay URL: ${RELAY_URL}`);
    chrome.tabs.onRemoved.addListener(this._onTabRemoved.bind(this));
    chrome.tabs.onActivated.addListener(this._onTabActivated.bind(this));
    chrome.action.onClicked.addListener(this._onActionClicked.bind(this));
  }

  private async _onActionClicked(tab: chrome.tabs.Tab): Promise<void> {
    if (!tab.id) {
      debugLog('No tab ID available');
      return;
    }

    if (this._connectedTabs.has(tab.id)) {
      await this._disconnectTab(tab.id);
    } else {
      await this._connectTab(tab.id);
    }
  }

  private async _waitForServer(): Promise<void> {
    const httpUrl = 'http://localhost:9988';

    while (true) {
      try {
        debugLog('Checking if relay server is available...');
        await fetch(httpUrl, { method: 'HEAD' });
        debugLog('Server is available');
        return;
      } catch (error: any) {
        debugLog(`Server not available, retrying in 1 second...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  private async _connectTab(tabId: number): Promise<void> {
    try {
      debugLog(`=== Starting connection to tab ${tabId} ===`);
      await this._updateIcon(tabId, 'connecting');

      if (!this._connection) {
        debugLog('No existing connection, creating new relay connection');
        debugLog('Waiting for server at http://localhost:9988...');
        await this._waitForServer();
        
        debugLog('Server is ready, creating WebSocket connection to:', RELAY_URL);
        const socket = new WebSocket(RELAY_URL);
        debugLog('WebSocket created, initial readyState:', socket.readyState, '(0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED)');
        
        await new Promise<void>((resolve, reject) => {
          let timeoutFired = false;
          const timeout = setTimeout(() => {
            timeoutFired = true;
            debugLog('=== WebSocket connection TIMEOUT after 5 seconds ===');
            debugLog('Final WebSocket readyState:', socket.readyState);
            debugLog('WebSocket URL:', socket.url);
            debugLog('Socket protocol:', socket.protocol);
            reject(new Error('Connection timeout'));
          }, 5000);
          
          socket.onopen = () => {
            if (timeoutFired) {
              debugLog('WebSocket opened but timeout already fired!');
              return;
            }
            debugLog('WebSocket onopen fired! readyState:', socket.readyState);
            clearTimeout(timeout);
            resolve();
          };
          
          socket.onerror = (error) => {
            debugLog('WebSocket onerror during connection:', error);
            debugLog('Error type:', error.type);
            debugLog('Current readyState:', socket.readyState);
            if (!timeoutFired) {
              clearTimeout(timeout);
              reject(new Error('WebSocket connection failed'));
            }
          };
          
          socket.onclose = (event) => {
            debugLog('WebSocket onclose during connection setup:', {
              code: event.code,
              reason: event.reason,
              wasClean: event.wasClean,
              readyState: socket.readyState
            });
            if (!timeoutFired) {
              clearTimeout(timeout);
              reject(new Error(`WebSocket closed: ${event.reason || event.code}`));
            }
          };
          
          debugLog('Event handlers set, waiting for connection...');
        });

        debugLog('WebSocket connected successfully, creating RelayConnection instance');
        this._connection = new RelayConnection(socket);
        this._connection.onclose = () => {
          debugLog('=== Relay connection onclose callback triggered ===');
          debugLog('Connected tabs before clearing:', Array.from(this._connectedTabs.keys()));
          this._connection = undefined;
          for (const tabId of this._connectedTabs.keys()) {
            debugLog('Updating icon to disconnected for tab:', tabId);
            void this._updateIcon(tabId, 'disconnected');
          }
          this._connectedTabs.clear();
          debugLog('All tabs cleared');
        };
      } else {
        debugLog('Reusing existing connection');
      }

      debugLog('Calling attachTab for tab:', tabId);
      const targetInfo = await this._connection.attachTab(tabId);
      debugLog('attachTab completed, storing in connectedTabs map');
      this._connectedTabs.set(tabId, targetInfo.targetId);
      
      await this._updateIcon(tabId, 'connected');
      debugLog(`=== Successfully connected to tab ${tabId} ===`);
    } catch (error: any) {
      debugLog(`=== Failed to connect to tab ${tabId} ===`);
      debugLog('Error details:', error);
      debugLog('Error stack:', error.stack);
      await this._updateIcon(tabId, 'disconnected');

      chrome.action.setBadgeText({ tabId, text: '!' });
      chrome.action.setBadgeBackgroundColor({ tabId, color: '#f44336' });
      chrome.action.setTitle({ tabId, title: `Error: ${error.message}` });

      setTimeout(() => {
        if (!this._connectedTabs.has(tabId)) {
          chrome.action.setBadgeText({ tabId, text: '' });
          chrome.action.setTitle({ tabId, title: 'Click to attach debugger' });
        }
      }, 3000);
    }
  }

  private async _disconnectTab(tabId: number): Promise<void> {
    debugLog(`=== Disconnecting tab ${tabId} ===`);
    
    if (!this._connectedTabs.has(tabId)) {
      debugLog('Tab not in connectedTabs map, ignoring disconnect');
      return;
    }
    
    debugLog('Calling detachTab on connection');
    this._connection?.detachTab(tabId);
    this._connectedTabs.delete(tabId);
    debugLog('Tab removed from connectedTabs map');
    
    await this._updateIcon(tabId, 'disconnected');
    
    debugLog('Connected tabs remaining:', this._connectedTabs.size);
    if (this._connectedTabs.size === 0 && this._connection) {
      debugLog('No tabs remaining, closing relay connection');
      this._connection.close('All tabs disconnected');
      this._connection = undefined;
    }
  }

  private async _updateIcon(tabId: number, state: 'connected' | 'disconnected' | 'connecting'): Promise<void> {
    try {
      switch (state) {
        case 'connected':
          await chrome.action.setIcon({
            tabId,
            path: {
              '16': '/icons/icon-green-16.png',
              '32': '/icons/icon-green-32.png',
              '48': '/icons/icon-green-48.png',
              '128': '/icons/icon-green-128.png'
            }
          });
          await chrome.action.setBadgeText({ tabId, text: '' });
          await chrome.action.setTitle({ tabId, title: 'Connected - Click to disconnect' });
          break;

        case 'connecting':
          await chrome.action.setIcon({
            tabId,
            path: {
              '16': '/icons/icon-gray-16.png',
              '32': '/icons/icon-gray-32.png',
              '48': '/icons/icon-gray-48.png',
              '128': '/icons/icon-gray-128.png'
            }
          });
          await chrome.action.setBadgeText({ tabId, text: '...' });
          await chrome.action.setBadgeBackgroundColor({ tabId, color: '#FF9800' });
          await chrome.action.setTitle({ tabId, title: 'Connecting...' });
          break;

        case 'disconnected':
        default:
          await chrome.action.setIcon({
            tabId,
            path: {
              '16': '/icons/icon-gray-16.png',
              '32': '/icons/icon-gray-32.png',
              '48': '/icons/icon-gray-48.png',
              '128': '/icons/icon-gray-128.png'
            }
          });
          await chrome.action.setBadgeText({ tabId, text: '' });
          await chrome.action.setTitle({ tabId, title: 'Click to attach debugger' });
          break;
      }
    } catch (error: any) {
      // Ignore errors (tab may be closed)
      debugLog(`Error updating icon: ${error.message}`);
    }
  }

  private async _onTabRemoved(tabId: number): Promise<void> {
    debugLog('Tab removed event for tab:', tabId, 'is connected:', this._connectedTabs.has(tabId));
    if (!this._connectedTabs.has(tabId)) return;
    
    debugLog(`Connected tab ${tabId} was closed, disconnecting`);
    await this._disconnectTab(tabId);
  }

  private async _onTabActivated(activeInfo: chrome.tabs.TabActiveInfo): Promise<void> {
    const isConnected = this._connectedTabs.has(activeInfo.tabId);
    debugLog('Tab activated:', activeInfo.tabId, 'is connected:', isConnected);
    await this._updateIcon(activeInfo.tabId, isConnected ? 'connected' : 'disconnected');
  }
}

new SimplifiedExtension();
