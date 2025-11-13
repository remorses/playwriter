import * as playwright from 'playwright-core';


export type BrowserContextFactoryResult = {
  browserContext: playwright.BrowserContext;
  close: (afterClose: () => Promise<void>) => Promise<void>;
};

export interface BrowserContextFactory {
  createContext(clientInfo: ClientInfo, abortSignal: AbortSignal, toolName: string | undefined): Promise<BrowserContextFactoryResult>;
}

export type ClientInfo = {
  name: string;
  version: string;
  timestamp: number;
};
