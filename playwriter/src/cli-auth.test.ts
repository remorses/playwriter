import http from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, test } from 'vitest'

const execFileAsync = promisify(execFile)
const currentDir = path.dirname(fileURLToPath(import.meta.url))
const playwriterDir = path.resolve(currentDir, '..')
const viteNodeBinary = path.join(
  playwriterDir,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'vite-node.cmd' : 'vite-node',
)

const servers: http.Server[] = []

afterEach(async () => {
  await Promise.all(
    servers.map((server) => {
      return new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    }),
  )
  servers.length = 0
})

type CapturedRequest = {
  method: string | undefined
  url: string | undefined
  authorization: string | undefined
  body?: unknown
}

function respondJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf-8'))
}

async function createRelayFixture(
  handler: (req: http.IncomingMessage, res: http.ServerResponse, captured: CapturedRequest) => Promise<void> | void,
): Promise<{ url: string; requests: CapturedRequest[] }> {
  const requests: CapturedRequest[] = []
  const server = http.createServer(async (req, res) => {
    const captured: CapturedRequest = {
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
    }
    requests.push(captured)
    try {
      await handler(req, res, captured)
    } catch (error: any) {
      respondJson(res, 500, { error: error.message })
    }
  })
  servers.push(server)

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve()
    })
  })

  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}`, requests }
}

async function runCli(args: string[], env: Record<string, string | undefined> = {}) {
  return execFileAsync(viteNodeBinary, ['src/cli.ts', ...args], {
    cwd: playwriterDir,
    env: {
      ...process.env,
      PLAYWRITER_HOST: '',
      PLAYWRITER_TOKEN: '',
      ...env,
    },
  })
}

describe('playwriter cli remote auth', () => {
  test('sends --token while discovering remote extensions for session creation', async () => {
    const relay = await createRelayFixture(async (req, res, captured) => {
      if (req.method === 'GET' && req.url === '/extensions/status') {
        respondJson(res, 200, {
          extensions: [
            {
              extensionId: 'ext-1',
              stableKey: 'stable-ext-1',
              browser: 'Chrome',
              profile: { email: 'user@example.com', id: 'Profile 1' },
              activeTargets: 1,
              playwriterVersion: null,
            },
          ],
        })
        return
      }

      if (req.method === 'POST' && req.url === '/cli/session/new') {
        captured.body = await readJson(req)
        respondJson(res, 200, { id: 'remote-1', extensionId: 'stable-ext-1' })
        return
      }

      respondJson(res, 404, { error: 'not found' })
    })

    const { stdout, stderr } = await runCli(['session', 'new', '--host', relay.url, '--token', 'secret-token'])

    expect(stderr).toBe('')
    expect(stdout).toContain('Session remote-1 created.')
    expect(relay.requests.map((request) => request.authorization)).toEqual([
      'Bearer secret-token',
      'Bearer secret-token',
    ])
    expect(relay.requests[1].body).toMatchObject({ extensionId: 'stable-ext-1' })
  }, 30000)

  test('sends PLAYWRITER_TOKEN when falling back to legacy extension status', async () => {
    const relay = await createRelayFixture(async (req, res, captured) => {
      if (req.method === 'GET' && req.url === '/extensions/status') {
        respondJson(res, 404, { error: 'not found' })
        return
      }

      if (req.method === 'GET' && req.url === '/extension/status') {
        respondJson(res, 200, {
          connected: true,
          browser: 'Chrome',
          profile: { email: 'user@example.com', id: 'Profile 1' },
          activeTargets: 1,
          playwriterVersion: null,
        })
        return
      }

      if (req.method === 'POST' && req.url === '/cli/session/new') {
        captured.body = await readJson(req)
        respondJson(res, 200, { id: 'remote-2', extensionId: null })
        return
      }

      respondJson(res, 404, { error: 'not found' })
    })

    const { stdout, stderr } = await runCli(['session', 'new', '--host', relay.url], {
      PLAYWRITER_TOKEN: 'env-token',
    })

    expect(stderr).toBe('')
    expect(stdout).toContain('Session remote-2 created.')
    expect(relay.requests.map((request) => request.authorization)).toEqual([
      'Bearer env-token',
      'Bearer env-token',
      'Bearer env-token',
    ])
    expect(relay.requests[2].body).toMatchObject({ extensionId: null })
  }, 30000)
})
