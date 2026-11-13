import { describe, it, expect, afterEach } from 'vitest'
import { startPlayWriterCDPRelayServer } from '../src/cdp-relay.js'
import { WebSocket, WebSocketServer } from 'ws'
import { createFileLogger } from '../src/create-logger.js'
import { killPortProcess } from '../src/kill-port.js'
import { createMCPClient } from '../src/mcp-client.js'
import os from 'node:os'

const TEST_PORT = 19999

async function killProcessOnPort(port: number): Promise<void> {
  try {
    await killPortProcess({ port })
  } catch (err) {
    // Ignore if no process is running
  }
}

describe('Security Tests', () => {
  let server: any = null

  afterEach(async () => {
    if (server) {
      server.close()
      server = null
    }
    await killProcessOnPort(TEST_PORT)
  })

  it('should enforce token authentication for /cdp endpoint', async () => {
    const token = 'secret-token'
    const logger = createFileLogger()

    server = await startPlayWriterCDPRelayServer({
      port: TEST_PORT,
      token,
      logger,
    })

    // Helper to try connecting
    const tryConnect = (tokenParam?: string) => {
      return new Promise<void>((resolve, reject) => {
        const url = `ws://127.0.0.1:${TEST_PORT}/cdp${tokenParam ? `?token=${tokenParam}` : ''}`
        const ws = new WebSocket(url)

        ws.on('open', () => {
          ws.close()
          resolve()
        })

        ws.on('error', (err) => {
          reject(err)
        })

        ws.on('unexpected-response', (req, res) => {
          reject(new Error(`Unexpected response: ${res.statusCode}`))
          ws.close()
        })
      })
    }

    // 1. No token -> Should fail
    await expect(tryConnect()).rejects.toThrow(/Unexpected response: (400|401|403)/)

    // 2. Wrong token -> Should fail
    await expect(tryConnect('wrong-token')).rejects.toThrow(/Unexpected response: (400|401|403)/)

    // 3. Correct token -> Should succeed
    await expect(tryConnect(token)).resolves.not.toThrow()
  })

  it('starts the MCP against a token-protected remote relay', async () => {
    const token = 'secret-token'
    server = await startPlayWriterCDPRelayServer({ port: TEST_PORT, token })

    const mcp = await createMCPClient({
      args: ['--host', `http://0.0.0.0:${TEST_PORT}`, '--token', token],
    })

    await mcp.cleanup()
  })

  it('should enforce localhost restrictions for /extension endpoint', async () => {
    const logger = createFileLogger()
    server = await startPlayWriterCDPRelayServer({
      port: TEST_PORT,
      logger,
    })

    const tryConnectExtension = (origin?: string) => {
      return new Promise<void>((resolve, reject) => {
        const url = `ws://127.0.0.1:${TEST_PORT}/extension`
        const options = origin ? { headers: { Origin: origin } } : {}
        const ws = new WebSocket(url, options)

        ws.on('open', () => {
          ws.close()
          resolve()
        })

        ws.on('error', (err) => {
          reject(err)
        })

        ws.on('unexpected-response', (req, res) => {
          reject(new Error(`Unexpected response: ${res.statusCode}`))
          ws.close()
        })
      })
    }

    // 1. Valid chrome-extension origin -> Should succeed
    // Use a valid extension ID from ALLOWED_EXTENSION_IDS in cdp-relay.ts
    await expect(tryConnectExtension('chrome-extension://jfeammnjpkecdekppnclgkkffahnhfhe')).resolves.not.toThrow()
    await expect(tryConnectExtension('chrome-extension://laceiahnielojmkjcfpcjhjnnmjobckf')).resolves.not.toThrow()

    // 2. Invalid origin (e.g., http://evil.com) -> Should fail
    await expect(tryConnectExtension('http://evil.com')).rejects.toThrow(/Unexpected response: (400|401|403)/)

    // 3. No origin -> Should likely fail if strict checking is enabled, but typically extension connection requires specific origin handling.
    // Based on implementation, usually it checks if it starts with chrome-extension://
    await expect(tryConnectExtension()).rejects.toThrow(/Unexpected response: (400|401|403)/)
  })

  // =========================================================================
  // Privileged HTTP route hardening (/cli/*, /recorder/*)
  //
  // These tests verify that cross-origin browser requests are blocked even
  // without CORS preflight (the "simple request" attack vector where POST +
  // Content-Type: text/plain bypasses CORS entirely).
  // =========================================================================

  const httpRequest = ({
    path,
    method = 'POST',
    headers = {},
  }: {
    path: string
    method?: string
    headers?: Record<string, string>
  }) => {
    return fetch(`http://127.0.0.1:${TEST_PORT}${path}`, {
      method,
      headers,
      body: method === 'POST' ? JSON.stringify({ sessionId: '1', code: 'true' }) : undefined,
    })
  }

  it('should block cross-origin browser requests to /cli/* via Sec-Fetch-Site', async () => {
    const logger = createFileLogger()
    server = await startPlayWriterCDPRelayServer({ port: TEST_PORT, logger })

    // cross-site browser request → 403
    const crossSite = await httpRequest({
      path: '/cli/execute',
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' },
    })
    expect(crossSite.status).toBe(403)

    // same-site but not same-origin → 403
    const sameSite = await httpRequest({
      path: '/cli/execute',
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-site' },
    })
    expect(sameSite.status).toBe(403)
  })

  it('should block cross-origin browser requests to /recorder/* via Sec-Fetch-Site', async () => {
    const logger = createFileLogger()
    server = await startPlayWriterCDPRelayServer({ port: TEST_PORT, logger })

    const res = await httpRequest({
      path: '/recorder/status',
      method: 'GET',
      headers: { 'Sec-Fetch-Site': 'cross-site' },
    })
    expect(res.status).toBe(403)
  })

  it('should block POST with non-JSON Content-Type (text/plain bypass)', async () => {
    const logger = createFileLogger()
    server = await startPlayWriterCDPRelayServer({ port: TEST_PORT, logger })

    // text/plain is the classic CORS preflight bypass
    const textPlain = await httpRequest({
      path: '/cli/execute',
      headers: { 'Content-Type': 'text/plain' },
    })
    expect(textPlain.status).toBe(415)

    // form-urlencoded is another simple request type
    const formData = await httpRequest({
      path: '/cli/execute',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    expect(formData.status).toBe(415)

    // Still a simple request: the media type is text/plain, application/json is only a parameter
    const jsonParameter = await httpRequest({
      path: '/cli/execute',
      headers: { 'Content-Type': 'text/plain;x=application/json' },
    })
    expect(jsonParameter.status).toBe(415)

    // missing Content-Type entirely
    const noContentType = await httpRequest({
      path: '/cli/execute',
      headers: {},
    })
    expect(noContentType.status).toBe(415)
  })

  it('should allow requests without Sec-Fetch-Site (Node.js/CLI clients)', async () => {
    const logger = createFileLogger()
    server = await startPlayWriterCDPRelayServer({ port: TEST_PORT, logger })

    // Node.js clients don't send Sec-Fetch-Site, only Content-Type: application/json.
    // Request should pass the middleware (will 404 because no session exists, which is fine).
    const res = await httpRequest({
      path: '/cli/execute',
      headers: { 'Content-Type': 'application/json' },
    })
    // 404 = passed middleware, session just doesn't exist
    expect(res.status).toBe(404)
  })

  it('should allow same-origin browser requests', async () => {
    const logger = createFileLogger()
    server = await startPlayWriterCDPRelayServer({ port: TEST_PORT, logger })

    const res = await httpRequest({
      path: '/cli/execute',
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
    })
    // 404 = passed middleware
    expect(res.status).toBe(404)
  })

  it('should enforce token on /cli/* and /recorder/* when token mode is enabled', async () => {
    const secretToken = 'test-secret-token'
    const logger = createFileLogger()
    server = await startPlayWriterCDPRelayServer({ port: TEST_PORT, token: secretToken, logger })

    // No token → 401
    const noToken = await httpRequest({
      path: '/cli/sessions',
      method: 'GET',
      headers: {},
    })
    expect(noToken.status).toBe(401)

    // Wrong token → 401
    const wrongToken = await httpRequest({
      path: '/cli/sessions',
      method: 'GET',
      headers: { Authorization: 'Bearer wrong-token' },
    })
    expect(wrongToken.status).toBe(401)

    // Correct token via Authorization header → pass middleware
    const bearerOk = await httpRequest({
      path: '/cli/sessions',
      method: 'GET',
      headers: { Authorization: `Bearer ${secretToken}` },
    })
    expect(bearerOk.status).toBe(200)

    // Correct token via query param → pass middleware
    const queryOk = await fetch(`http://127.0.0.1:${TEST_PORT}/cli/sessions?token=${secretToken}`)
    expect(queryOk.status).toBe(200)

    // Token also enforced on /recorder/*
    const recordingNoToken = await httpRequest({
      path: '/recorder/status',
      method: 'GET',
      headers: {},
    })
    expect(recordingNoToken.status).toBe(401)

    const recordingWithToken = await httpRequest({
      path: '/recorder/status',
      method: 'GET',
      headers: { Authorization: `Bearer ${secretToken}` },
    })
    expect(recordingWithToken.status).toBe(200)

    const mcpLogWithoutToken = await fetch(`http://127.0.0.1:${TEST_PORT}/mcp-log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: 'log', args: ['test'] }),
    })
    expect(mcpLogWithoutToken.status).toBe(401)

    const mcpLogWithToken = await fetch(`http://127.0.0.1:${TEST_PORT}/mcp-log`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ level: 'log', args: ['test'] }),
    })
    expect(mcpLogWithToken.status).toBe(200)
  })

  it('should enforce token on browser metadata routes when token mode is enabled', async () => {
    const secretToken = 'test-secret-token'
    server = await startPlayWriterCDPRelayServer({ port: TEST_PORT, token: secretToken })
    const paths = ['/extension/status', '/extensions/status', '/json/list']

    const unauthorizedStatuses = await Promise.all(
      paths.map(async (path) => {
        const response = await fetch(`http://127.0.0.1:${TEST_PORT}${path}`)
        return response.status
      }),
    )
    expect(unauthorizedStatuses).toEqual(paths.map(() => 401))

    const authorizedStatuses = await Promise.all(
      paths.map(async (path) => {
        const response = await fetch(`http://127.0.0.1:${TEST_PORT}${path}`, {
          headers: { Authorization: `Bearer ${secretToken}` },
        })
        return response.status
      }),
    )
    expect(authorizedStatuses).toEqual(paths.map(() => 200))
  })

  it('should allow the extension worker to call /recorder/start and /recorder/stop', async () => {
    const logger = createFileLogger()
    server = await startPlayWriterCDPRelayServer({ port: TEST_PORT, logger })

    // Service worker fetch is Sec-Fetch-Site: cross-site (chrome-extension → localhost).
    // These two routes skip that block for our extension origin so the toolbar Record button works.
    const extensionHeaders = {
      'Content-Type': 'application/json',
      'Sec-Fetch-Site': 'cross-site',
      Origin: 'chrome-extension://jfeammnjpkecdekppnclgkkffahnhfhe',
    }
    const recorderStart = await httpRequest({ path: '/recorder/start', headers: extensionHeaders })
    expect(recorderStart.status).not.toBe(403)

    const recorderStop = await httpRequest({ path: '/recorder/stop', headers: extensionHeaders })
    expect(recorderStop.status).not.toBe(403)

    // A website sends a CORS-safelisted Content-Type with no preflight, so only the Origin check stops it
    const website = await httpRequest({
      path: '/recorder/start',
      headers: {
        'Content-Type': 'text/plain;x=application/json',
        'Sec-Fetch-Site': 'cross-site',
        Origin: 'https://evil.com',
      },
    })
    expect(website.status).toBe(403)

    const recorderStatus = await httpRequest({
      path: '/recorder/status',
      method: 'GET',
      headers: { 'Sec-Fetch-Site': 'cross-site' },
    })
    expect(recorderStatus.status).toBe(403)
  })

  it('should not allow a website origin to pass CORS preflight on /recorder/start', async () => {
    const logger = createFileLogger()
    server = await startPlayWriterCDPRelayServer({ port: TEST_PORT, logger })

    const preflight = ({ origin }: { origin: string }) => {
      return fetch(`http://127.0.0.1:${TEST_PORT}/recorder/start`, {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'POST',
        },
      })
    }

    const website = await preflight({ origin: 'https://evil.com' })
    expect(website.headers.get('access-control-allow-origin')).toBeNull()

    const extension = await preflight({
      origin: 'chrome-extension://jfeammnjpkecdekppnclgkkffahnhfhe',
    })
    expect(extension.headers.get('access-control-allow-origin')).toBe(
      'chrome-extension://jfeammnjpkecdekppnclgkkffahnhfhe',
    )
  })

  it('should still enforce Content-Type on /recorder/* cross-origin requests', async () => {
    const logger = createFileLogger()
    server = await startPlayWriterCDPRelayServer({ port: TEST_PORT, logger })

    // text/plain POST to /recorder/start should still be rejected (415)
    const textPlain = await httpRequest({
      path: '/recorder/start',
      headers: {
        'Content-Type': 'text/plain',
        'Sec-Fetch-Site': 'cross-site',
        Origin: 'chrome-extension://jfeammnjpkecdekppnclgkkffahnhfhe',
      },
    })
    expect(textPlain.status).toBe(415)
  })

  it('should not require token on local routes when no token is configured', async () => {
    const logger = createFileLogger()
    server = await startPlayWriterCDPRelayServer({ port: TEST_PORT, logger })

    const paths = ['/cli/sessions', '/extension/status', '/extensions/status', '/json/list']
    const statuses = await Promise.all(
      paths.map(async (path) => {
        const response = await fetch(`http://127.0.0.1:${TEST_PORT}${path}`)
        return response.status
      }),
    )
    expect(statuses).toEqual(paths.map(() => 200))

    const mcpLog = await fetch(`http://127.0.0.1:${TEST_PORT}/mcp-log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: 'log', args: ['test'] }),
    })
    expect(mcpLog.status).toBe(200)
  })
})

// Path-form tunnels share one host (wss://host/tunnel/{id}/extension), so the
// relay must key remote dials by the full wsUrl so each id stays a distinct dial;
// otherwise a second shared browser would bind to the first tunnel and replace its
// stableKey connection.
describe('Remote control dial isolation', () => {
  const FAKE_TUNNEL_PORT = 19871
  let server: any = null

  afterEach(async () => {
    if (server) {
      server.close()
      server = null
    }
    await killProcessOnPort(TEST_PORT)
    await killProcessOnPort(FAKE_TUNNEL_PORT)
  })

  it('dials a distinct tunnel per remote id, even when ids share one host', async () => {
    const dialedPaths: string[] = []
    const fakeTunnel = new WebSocketServer({ port: FAKE_TUNNEL_PORT, host: '127.0.0.1' })
    fakeTunnel.on('connection', (socket, req) => {
      const pathname = new URL(req.url || '/', 'ws://x').pathname
      dialedPaths.push(pathname)
      // /tunnel/{id}/extension → speak the extension protocol for that id
      const tunnelId = pathname.match(/^\/tunnel\/([a-z0-9-]+)\//)?.[1] || 'unknown'
      const sessionId = `pw-fake-${tunnelId}-1`
      socket.send(JSON.stringify({ method: 'hello', params: { browser: 'fake', version: '1', remote: true } }))
      socket.send(
        JSON.stringify({
          method: 'forwardCDPEvent',
          params: {
            method: 'Target.attachedToTarget',
            params: {
              sessionId,
              targetInfo: {
                targetId: `target-${tunnelId}`,
                url: 'https://example.com',
                type: 'page',
                attached: true,
              },
            },
          },
        }),
      )
    })

    server = await startPlayWriterCDPRelayServer({ port: TEST_PORT })

    const createSession = async (tunnelId: string) => {
      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/cli/session/new`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          remoteControlUrl: `ws://127.0.0.1:${FAKE_TUNNEL_PORT}/tunnel/${tunnelId}/extension`,
          cwd: os.tmpdir(),
        }),
      })
      const body = (await response.json()) as { id?: string; error?: string }
      expect(body.error, JSON.stringify(body)).toBeUndefined()
      expect(response.status).toBe(200)
      return body.id!
    }

    const first = await createSession('aaa111')
    const second = await createSession('bbb222')

    expect(first).not.toBe(second)
    // Both ids must get their own dial. The regression here was a single dial
    // for 'https://playwriter.dev' shared by every path-form id.
    expect(dialedPaths).toEqual(['/tunnel/aaa111/extension', '/tunnel/bbb222/extension'])

    fakeTunnel.close()
  })
})
