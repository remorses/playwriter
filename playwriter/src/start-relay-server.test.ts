import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFileLogger, type Logger } from './create-logger.js'
import type { RelayServer } from './cdp-relay.js'
import { startRelayServer } from './relay-server-runtime.js'

const TEST_PORTS = {
  environment: 19989,
  explicit: 19998,
  tokenless: 19999,
}

const requestInvalidExecute = async ({ port, token }: { port: number; token?: string }): Promise<Response> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) {
    headers.Authorization = 'Bearer ' + token
  }
  return fetch('http://127.0.0.1:' + port + '/cli/execute', {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  })
}

describe('startRelayServer', () => {
  let server: RelayServer | null = null
  let logger: Logger | null = null
  let logDir = ''
  let previousToken: string | undefined

  const getLogger = (): Logger => {
    if (!logger) {
      throw new Error('Logger not initialized')
    }
    return logger
  }

  beforeEach(() => {
    previousToken = process.env.PLAYWRITER_TOKEN
    logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'playwriter-start-relay-server-'))
    logger = createFileLogger({ logFilePath: path.join(logDir, 'relay-server.log') })
  })

  afterEach(async () => {
    try {
      server?.close()
      await logger?.flush()
    } finally {
      server = null
      logger = null
      if (previousToken === undefined) {
        delete process.env.PLAYWRITER_TOKEN
      } else {
        process.env.PLAYWRITER_TOKEN = previousToken
      }
      if (logDir) {
        fs.rmSync(logDir, { recursive: true, force: true })
        logDir = ''
      }
    }
  })

  it('uses PLAYWRITER_TOKEN for privileged routes when no token is supplied', async () => {
    const token = 'environment-token'
    process.env.PLAYWRITER_TOKEN = token
    server = await startRelayServer({ port: TEST_PORTS.environment, logger: getLogger() })

    const unauthenticatedResponse = await requestInvalidExecute({ port: TEST_PORTS.environment })
    expect(unauthenticatedResponse.status).toBe(401)

    const authenticatedResponse = await requestInvalidExecute({ port: TEST_PORTS.environment, token })
    expect(authenticatedResponse.status).toBe(400)
    await expect(authenticatedResponse.json()).resolves.toEqual({ error: 'sessionId and code are required' })
  })

  it('prefers an explicit token over PLAYWRITER_TOKEN', async () => {
    const environmentToken = 'environment-token'
    const explicitToken = 'explicit-token'
    process.env.PLAYWRITER_TOKEN = environmentToken
    server = await startRelayServer({ port: TEST_PORTS.explicit, token: explicitToken, logger: getLogger() })

    const environmentResponse = await requestInvalidExecute({ port: TEST_PORTS.explicit, token: environmentToken })
    expect(environmentResponse.status).toBe(401)

    const explicitResponse = await requestInvalidExecute({ port: TEST_PORTS.explicit, token: explicitToken })
    expect(explicitResponse.status).toBe(400)
    await expect(explicitResponse.json()).resolves.toEqual({ error: 'sessionId and code are required' })
  })

  it('keeps localhost tokenless when no token is configured', async () => {
    delete process.env.PLAYWRITER_TOKEN
    server = await startRelayServer({ port: TEST_PORTS.tokenless, logger: getLogger() })

    const response = await requestInvalidExecute({ port: TEST_PORTS.tokenless })
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'sessionId and code are required' })
  })
})
