// Verifies CLI help stays runnable without loading browser-start-only dependencies.
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, test } from 'vitest'

const execFileAsync = promisify(execFile)
const currentDir = path.dirname(fileURLToPath(import.meta.url))
const playwriterDir = path.resolve(currentDir, '..')
const viteNodeBinary = path.join(
  playwriterDir,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'vite-node.cmd' : 'vite-node',
)

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(viteNodeBinary, ['src/cli.ts', ...args], {
    cwd: playwriterDir,
    env: process.env,
  })
}

async function createSessionServer({ sessionId }: { sessionId: string }): Promise<{
  host: string
  close: () => Promise<void>
}> {
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json')

    if (request.url === '/extensions/status') {
      response.end(
        JSON.stringify({
          extensions: [
            {
              extensionId: 'test-extension',
              stableKey: 'test-extension',
              browser: 'Chrome',
              profile: null,
              activeTargets: 1,
              playwriterVersion: null,
            },
          ],
        }),
      )
      return
    }

    if (request.url === '/cli/session/new' && request.method === 'POST') {
      response.end(JSON.stringify({ id: sessionId, extensionId: 'test-extension' }))
      return
    }

    response.statusCode = 404
    response.end(JSON.stringify({ error: 'not found' }))
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Session test server did not bind to a TCP port')
  }

  return {
    host: `http://127.0.0.1:${address.port}`,
    close: async () => {
      const closed = new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
      server.closeAllConnections()
      await closed
    },
  }
}

describe('playwriter cli help', () => {
  test('renders root help without crashing', async () => {
    const { stdout, stderr } = await runCli(['--help'])

    expect(stdout).toContain('playwriter')
    expect(stdout).toContain('serve')
    expect(stderr).toBe('')
  }, 30000)

  test('renders serve help without crashing', async () => {
    const { stdout, stderr } = await runCli(['serve', '--help'])

    expect(stdout).toContain('Start the relay server on this machine')
    expect(stdout).toContain('--replace')
    expect(stderr).toBe('')
  }, 30000)

  test('unknown command exits with code 1', async () => {
    try {
      await runCli(['run'])
      expect.unreachable('should have thrown')
    } catch (error: any) {
      expect(error.code).toBe(1)
      expect(error.stderr).toContain('Unknown command: run')
      expect(error.stderr).toContain('playwriter --help')
    }
  }, 30000)

  test('unknown subcommand exits with code 1', async () => {
    try {
      await runCli(['session', 'nonexistent'])
      expect.unreachable('should have thrown')
    } catch (error: any) {
      expect(error.code).toBe(1)
      expect(error.stdout).toContain('Unknown command: session nonexistent')
      expect(error.stdout).toContain('session new')
    }
  }, 30000)
})

describe('playwriter session new output', () => {
  test('prints only the session ID to stdout in extension mode', async () => {
    const server = await createSessionServer({ sessionId: '41' })
    try {
      const result = await runCli(['session', 'new', '--host', server.host])

      expect(result).toMatchInlineSnapshot(`
        {
          "stderr": "
        Tip: Need stealth browsing, VPS control, or auto CAPTCHA solving? Run \`playwriter cloud login\` or set PLAYWRITER_API_KEY
             to control a browser in the cloud instead of local Chrome.
        ",
          "stdout": "41
        ",
        }
      `)
    } finally {
      await server.close()
    }
  }, 30000)

  test('prints only the session ID to stdout in headless mode', async () => {
    const server = await createSessionServer({ sessionId: '42' })
    try {
      const result = await runCli(['session', 'new', '--host', server.host, '--browser', 'headless'])

      expect(result).toMatchInlineSnapshot(`
        {
          "stderr": "NOTE: Recording unavailable in headless mode.
        ",
          "stdout": "42
        ",
        }
      `)
    } finally {
      await server.close()
    }
  }, 30000)
})
