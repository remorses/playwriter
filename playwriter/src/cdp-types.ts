import type { Protocol } from 'devtools-protocol';
import type { ProtocolMapping } from 'devtools-protocol/types/protocol-mapping.js';

export type CDPCommandSource = 'playwriter';

export type CDPCommandFor<T extends keyof ProtocolMapping.Commands> = {
  id: number;
  sessionId?: string;
  method: T;
  params?: ProtocolMapping.Commands[T]['paramsType'][0];
  source?: CDPCommandSource;
};

export type CDPCommand = {
  [K in keyof ProtocolMapping.Commands]: CDPCommandFor<K>;
}[keyof ProtocolMapping.Commands];

export type CDPResponseFor<T extends keyof ProtocolMapping.Commands> = {
  id: number;
  sessionId?: string;
  result?: ProtocolMapping.Commands[T]['returnType'];
  error?: { code?: number; message: string };
};

export type CDPResponse = {
  [K in keyof ProtocolMapping.Commands]: CDPResponseFor<K>;
}[keyof ProtocolMapping.Commands];

export type CDPEventFor<T extends keyof ProtocolMapping.Events> = {
  method: T;
  sessionId?: string;
  params?: ProtocolMapping.Events[T][0];
};

export type CDPEvent = {
  [K in keyof ProtocolMapping.Events]: CDPEventFor<K>;
}[keyof ProtocolMapping.Events];

export type CDPResponseBase = {
  id: number;
  sessionId?: string;
  result?: unknown;
  error?: { code?: number; message: string };
};

export type CDPEventBase = {
  method: string;
  sessionId?: string;
  params?: unknown;
};

export type CDPMessage = CDPCommand | CDPResponse | CDPEvent;

export type RelayServerEvents = {
  'cdp:command': (data: { clientId: string; command: CDPCommand }) => void
  'cdp:event': (data: { event: CDPEventBase; sessionId?: string }) => void
  'cdp:response': (data: { clientId: string; response: CDPResponseBase; command: CDPCommand }) => void
}

export { Protocol, ProtocolMapping };

// types tests. to see if types are right with some simple examples
if (false as any) {
  const browserVersionCommand = {
    id: 1,
    method: 'Browser.getVersion',
  } satisfies CDPCommand;

  const browserVersionResponse = {
    id: 1,
    result: {
      protocolVersion: '1.3',
      product: 'Chrome',
      revision: '123',
      userAgent: 'Mozilla/5.0',
      jsVersion: 'V8',
    }
  } satisfies CDPResponse;

  const targetAttachCommand = {
    id: 2,
    method: 'Target.setAutoAttach',
    params: {
      autoAttach: true,
      waitForDebuggerOnStart: false,
    }
  } satisfies CDPCommand;

  const targetAttachResponse = {
    id: 2,
    result: undefined,
  } satisfies CDPResponse;

  const attachedToTargetEvent = {
    method: 'Target.attachedToTarget',
    params: {
      sessionId: 'session-1',
      targetInfo: {
        targetId: 'target-1',
        type: 'page',
        title: 'Example',
        url: 'https://example.com',
        attached: true,
        canAccessOpener: false,
      },
      waitingForDebugger: false,
    }
  } satisfies CDPEvent;

  const consoleMessageEvent = {
    method: 'Runtime.consoleAPICalled',
    params: {
      type: 'log',
      args: [],
      executionContextId: 1,
      timestamp: 123456789,
    }
  } satisfies CDPEvent;

  const pageNavigateCommand = {
    id: 3,
    method: 'Page.navigate',
    params: {
      url: 'https://example.com',
    }
  } satisfies CDPCommand;

  const pageNavigateResponse = {
    id: 3,
    result: {
      frameId: 'frame-1',
    }
  } satisfies CDPResponse;

  const networkRequestEvent = {
    method: 'Network.requestWillBeSent',
    sessionId: 'session-1',
    params: {
      requestId: 'req-1',
      loaderId: 'loader-1',
      documentURL: 'https://example.com',
      request: {
        url: 'https://example.com/api',
        method: 'GET',
        headers: {},
        initialPriority: 'High',
        referrerPolicy: 'no-referrer',
      },
      timestamp: 123456789,
      wallTime: 123456789,
      initiator: {
        type: 'other',
      },
      redirectHasExtraInfo: false,
      type: 'XHR',
    }
  } satisfies CDPEvent;
}
