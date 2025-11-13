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

import * as playwright from 'playwright-core';
import { debug } from 'playwright-core/lib/utilsBundle';

import http from 'http';
import net from 'net'

import { CDPRelayServer } from './cdpRelay.js';
import { BrowserContextFactory, ClientInfo } from './types.js';



const debugLogger = debug('pw:mcp:relay');

export async function createExtensionContext(abortSignal: AbortSignal, ): Promise<{ browserContext: playwright.BrowserContext, close: () => Promise<void> }> {
  // Merge obtainBrowser into this function
  const httpServer = await startHttpServer({ port: 9988 });
  if (abortSignal.aborted) {
    httpServer.close();
    throw new Error(abortSignal.reason);
  }
  const cdpRelayServer = new CDPRelayServer(httpServer, );
  abortSignal.addEventListener('abort', () => cdpRelayServer.stop());
  debugLogger(`CDP relay server started, extension endpoint: ${cdpRelayServer.extensionEndpoint()}.`);

  // TODO simply call fetch. it was creatign a full fledged browser just to fetch an url previously. CRAZY
  // await cdpRelayServer.ensureExtensionConnectionForMCPContext(clientInfo, abortSignal, toolName);
  const browser = await playwright.chromium.connectOverCDP(cdpRelayServer.cdpEndpoint());

  return {
    browserContext: browser.contexts()[0],
    close: async () => {
      debugLogger('close() called for browser context');
      await browser.close();
    }
  };
}


export async function startHttpServer(config: { host?: string, port?: number }, abortSignal?: AbortSignal): Promise<http.Server> {
  const { host, port } = config;
  const httpServer = http.createServer();
  decorateServer(httpServer);
  await new Promise<void>((resolve, reject) => {
    httpServer.on('error', reject);
    abortSignal?.addEventListener('abort', () => {
      httpServer.close();
      reject(new Error('Aborted'));
    });
    httpServer.listen(port, host, () => {
      resolve();
      httpServer.removeListener('error', reject);
    });
  });
  return httpServer;
}



function decorateServer(server: net.Server) {
  const sockets = new Set<net.Socket>();
  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });

  const close = server.close;
  server.close = (callback?: (err?: Error) => void) => {
    for (const socket of sockets)
      socket.destroy();
    sockets.clear();
    return close.call(server, callback);
  };
}
