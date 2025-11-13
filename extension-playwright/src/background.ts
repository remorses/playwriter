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
const RELAY_URL = 'ws://localhost:9988';

class SimplifiedExtension {
  private _connection: RelayConnection | undefined;
  private _connectedTabId: number | null = null;

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

    // Toggle: if connected to this tab, disconnect; otherwise connect
    if (this._connectedTabId === tab.id) {
      await this._disconnect();
    } else {
      await this._connect(tab.id);
    }
  }

  private async _connect(tabId: number): Promise<void> {
    try {
      debugLog(`Connecting to tab ${tabId}`);

      // Disconnect from any existing connection
      if (this._connection) {
        this._connection.close('Switching to new tab');
        this._connection = undefined;
      }

      // Update icon to show connecting state
      await this._updateIcon(tabId, 'connecting');

      // Connect to WebSocket relay
      const socket = new WebSocket(RELAY_URL);
      await new Promise<void>((resolve, reject) => {
        socket.onopen = () => resolve();
        socket.onerror = () => reject(new Error('WebSocket connection failed'));
        setTimeout(() => reject(new Error('Connection timeout')), 5000);
      });

      // Create relay connection
      this._connection = new RelayConnection(socket);
      this._connection.onclose = () => {
        debugLog('Connection closed');
        this._connection = undefined;
        void this._setConnectedTabId(null);
      };

      // Set the tab ID (this will attach debugger)
      this._connection.setTabId(tabId);

      // Update state
      await this._setConnectedTabId(tabId);

      debugLog(`Successfully connected to tab ${tabId}`);
    } catch (error: any) {
      debugLog(`Failed to connect: ${error.message}`);
      await this._updateIcon(tabId, 'disconnected');
      
      // Show error notification
      chrome.action.setBadgeText({ tabId, text: '!' });
      chrome.action.setBadgeBackgroundColor({ tabId, color: '#f44336' });
      chrome.action.setTitle({ tabId, title: `Error: ${error.message}` });
      
      // Clear error after 3 seconds
      setTimeout(() => {
        if (this._connectedTabId !== tabId) {
          chrome.action.setBadgeText({ tabId, text: '' });
          chrome.action.setTitle({ tabId, title: 'Click to attach debugger' });
        }
      }, 3000);
    }
  }

  private async _disconnect(): Promise<void> {
    debugLog('Disconnecting');
    
    const tabId = this._connectedTabId;
    
    this._connection?.close('User disconnected');
    this._connection = undefined;
    
    await this._setConnectedTabId(null);
    
    if (tabId) {
      await this._updateIcon(tabId, 'disconnected');
    }
  }

  private async _setConnectedTabId(tabId: number | null): Promise<void> {
    const oldTabId = this._connectedTabId;
    this._connectedTabId = tabId;

    // Clear old tab icon
    if (oldTabId && oldTabId !== tabId) {
      await this._updateIcon(oldTabId, 'disconnected');
    }

    // Set new tab icon
    if (tabId) {
      await this._updateIcon(tabId, 'connected');
    }
  }

  private async _updateIcon(tabId: number, state: 'connected' | 'disconnected' | 'connecting'): Promise<void> {
    try {
      switch (state) {
        case 'connected':
          await chrome.action.setBadgeText({ tabId, text: '✓' });
          await chrome.action.setBadgeBackgroundColor({ tabId, color: '#4CAF50' });
          await chrome.action.setTitle({ tabId, title: 'Connected - Click to disconnect' });
          break;
        
        case 'connecting':
          await chrome.action.setBadgeText({ tabId, text: '...' });
          await chrome.action.setBadgeBackgroundColor({ tabId, color: '#FF9800' });
          await chrome.action.setTitle({ tabId, title: 'Connecting...' });
          break;
        
        case 'disconnected':
        default:
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
    if (this._connectedTabId !== tabId) {
      return;
    }
    
    debugLog(`Connected tab ${tabId} was closed`);
    this._connection?.close('Browser tab closed');
    this._connection = undefined;
    this._connectedTabId = null;
  }

  private async _onTabActivated(activeInfo: chrome.tabs.TabActiveInfo): Promise<void> {
    // Update icon for the newly active tab
    if (this._connectedTabId === activeInfo.tabId) {
      await this._updateIcon(activeInfo.tabId, 'connected');
    } else {
      await this._updateIcon(activeInfo.tabId, 'disconnected');
    }
  }
}

new SimplifiedExtension();
