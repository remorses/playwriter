import { CDPEventFor, ProtocolMapping } from './cdp-types.js'

export const VERSION = 1

type ForwardCDPCommand =
  {
    [K in keyof ProtocolMapping.Commands]: {
      id: number
      method: 'forwardCDPCommand'
      params: {
        method: K
        sessionId?: string
        params?: ProtocolMapping.Commands[K]['paramsType'][0]
        source?: 'playwriter'
      }
    }
  }[keyof ProtocolMapping.Commands]

export type ExtensionCommandMessage = ForwardCDPCommand

export type ExtensionResponseMessage = {
  id: number
  method?: undefined
  result?: any
  error?: string
}

/**
 * This produces a discriminated union for narrowing, similar to ForwardCDPCommand,
 * but for forwarded CDP events. Uses CDPEvent to maintain proper type extraction.
 */
export type ExtensionEventMessage =
  {
    [K in keyof ProtocolMapping.Events]: {
      id?: undefined
      method: 'forwardCDPEvent'
      params: {
        method: CDPEventFor<K>['method']
        sessionId?: string
        params?: CDPEventFor<K>['params']
      }
    }
  }[keyof ProtocolMapping.Events]

export type ExtensionLogMessage = {
  id?: undefined
  method: 'log'
  params: {
    level: 'log' | 'debug' | 'info' | 'warn' | 'error'
    args: string[]
  }
}

export type ExtensionPongMessage = {
  id?: undefined
  method: 'pong'
}

export type ServerPingMessage = {
  method: 'ping'
  id?: undefined
}

export type ExtensionMessage = ExtensionResponseMessage | ExtensionEventMessage | ExtensionLogMessage | ExtensionPongMessage
