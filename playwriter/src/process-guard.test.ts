// Regression tests: agent mistakes in one execute call must not kill the relay process, and
// upgrades drain running executes instead of killing them.
// Runs a real relay child process (vitest would catch the faults in-process) with a headless session.
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getRelayServerVersion, stopRelayServer } from './relay-client.js'
import { sleep } from './utils.js'

const TEST_PORT = 19973
const __dirname = path.dirname(fileURLToPath(import.meta.url))

describe('relay process guard', () => {
  let relay: ChildProcess | null = null
  let tempDir = ''
  const baseUrl = `http://127.0.0.1:${TEST_PORT}`

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-guard-'))
    relay = spawn(process.execPath, ['--import', 'tsx', path.join(__dirname, 'start-relay-server.ts')], {
      cwd: path.join(__dirname, '..'),
      stdio: 'ignore',
      env: {
        ...process.env,
        PLAYWRITER_PORT: String(TEST_PORT),
        PLAYWRITER_LOG_FILE_PATH: path.join(tempDir, 'relay-server.log'),
      },
    })
    for (let i = 0; i < 100 && !(await getRelayServerVersion(TEST_PORT)); i++) {
      await sleep(100)
    }
  }, 30000)

  afterAll(() => {
    relay?.kill()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  const post = async (route: string, body: unknown) => {
    const response = await fetch(`${baseUrl}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return (await response.json()) as Record<string, any>
  }

  it('survives an un-awaited rejection and a throwing timer, then runs the next execute', async () => {
    const session = await post('/cli/session/new', { headless: true, cwd: tempDir })
    expect(session.error).toBeUndefined()
    const execute = (code: string) => post('/cli/execute', { sessionId: session.id, code, timeout: 10000 })

    const first = await execute(
      `state.p = await context.newPage(); state.p.click('#missing', { timeout: 300 }); setTimeout(() => { throw new Error('boom') }, 100); setTimeout(async () => { await new Promise((r) => setTimeout(r, 30)); Promise.reject(new Error('late')) }, 30); return 'started'`,
    )
    expect(first.text).toBe('[return value] started')

    await sleep(1000)
    expect(relay?.exitCode).toBe(null)

    const second = await execute(`return 1 + 1`)
    const warnings = second.text
      .split('\n')
      .filter((line: string) => line.startsWith('[WARNING]') || line.startsWith('[return value]'))
    expect(warnings).toMatchInlineSnapshot(`
      [
        "[WARNING] Unhandled promise rejection in your code (missing await?): Error: late",
        "[WARNING] setTimeout callback threw: Error: boom",
        "[WARNING] Unhandled promise rejection in your code (missing await?): page.click: Timeout 300ms exceeded.",
        "[return value] 2",
      ]
    `)
  }, 60000)

  // Must stay last: it stops the relay.
  it('aborts an execute when the caller disconnects, then drains running executes before exiting', async () => {
    const session = await post('/cli/session/new', { headless: true, cwd: tempDir })
    const execute = (code: string, signal?: AbortSignal) =>
      fetch(`${baseUrl}/cli/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.id, code, timeout: 20000 }),
        signal,
      })

    // A disconnected caller must not keep the session lock for the full 20s timeout.
    const caller = new AbortController()
    const abandoned = execute(`await new Promise((r) => setTimeout(r, 15000)); return 'late'`, caller.signal)
    await sleep(500)
    caller.abort()
    await abandoned.catch(() => {})
    const startedAt = Date.now()
    const next = (await (await execute(`return 'next'`)).json()) as { text: string }
    expect(next.text).toBe('[return value] next')
    expect(Date.now() - startedAt).toBeLessThan(5000)

    const running = execute(`await new Promise((r) => setTimeout(r, 1500)); return 'finished'`).then((r) => r.json() as Promise<{ text: string }>)
    await sleep(300)
    const stopping = stopRelayServer({ port: TEST_PORT })
    await sleep(300)
    const refused = await execute(`return 1`)
    expect(refused.status).toBe(503)
    await stopping
    expect((await running).text).toBe('[return value] finished')
    expect(await getRelayServerVersion(TEST_PORT)).toBe(null)
  }, 60000)
})
