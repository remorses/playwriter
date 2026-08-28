import { afterEach, describe, expect, it } from 'vitest'
import type { RelayServer } from './cdp-relay.js'
import { startServer } from './start-relay-server.js'

const TEST_PORT = 19989
const SERVER_URL = 'http://127.0.0.1:' + TEST_PORT

describe('startServer', () => {
  let server: RelayServer | null = null
  let previousToken: string | undefined

  afterEach(() => {
    server?.close()
    server = null
    if (previousToken === undefined) {
      delete process.env.PLAYWRITER_TOKEN
      return
    }
    process.env.PLAYWRITER_TOKEN = previousToken
  })

  it('uses PLAYWRITER_TOKEN for privileged routes when no token is supplied', async () => {
    previousToken = process.env.PLAYWRITER_TOKEN
    const token = 'test-relay-token'
    process.env.PLAYWRITER_TOKEN = token
    server = await startServer({ port: TEST_PORT })

    const unauthenticatedResponse = await fetch(SERVER_URL + '/cli/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(unauthenticatedResponse.status).toBe(401)

    const authenticatedResponse = await fetch(SERVER_URL + '/cli/execute', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    })
    expect(authenticatedResponse.status).toBe(400)
    await expect(authenticatedResponse.json()).resolves.toEqual({ error: 'sessionId and code are required' })
  })
})
