/**
 * Anti-bot features end to end, with the relay's human-like input on:
 * - execute warns when a navigation lands on a bot challenge, and waits out one that clears by itself
 * - relay input moves the mouse along a path of trusted events and spaces key presses
 */

import { createMCPClient } from './mcp-client.js'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import dedent from 'string-dedent'
import {
  setupTestContext,
  cleanupTestContext,
  createSimpleServer,
  type TestContext,
  type SimpleServer,
  js,
} from './test-utils.js'
import './test-declarations.js'

const TEST_PORT = 19974

describe('Anti-bot', () => {
  let client: Awaited<ReturnType<typeof createMCPClient>>['client']
  let cleanup: (() => Promise<void>) | null = null
  let testCtx: TestContext | null = null
  let server: SimpleServer | null = null

  beforeAll(async () => {
    testCtx = await setupTestContext({
      port: TEST_PORT,
      tempDirPrefix: 'pw-anti-bot-test-',
      toggleExtension: true,
      relayOptions: { humanInput: true },
    })
    const result = await createMCPClient({ port: TEST_PORT })
    client = result.client
    cleanup = result.cleanup

    server = await createSimpleServer({
      routes: {
        '/turnstile': dedent`
          <!doctype html>
          <title>Just a moment...</title>
          <p>Verify you are human by completing the action below.</p>
          <div class="cf-turnstile" style="width:300px;height:65px"></div>
        `,
        '/clears': dedent`
          <!doctype html>
          <title>Just a moment...</title>
          <div id="challenge-running">Checking your browser</div>
          <script>setTimeout(() => location.replace('/ok'), 800)</script>
        `,
        '/ok': '<!doctype html><title>Shop</title><h1>Welcome</h1>',
        '/input': dedent`
          <!doctype html>
          <button id="go" style="position:absolute;left:500px;top:400px;width:120px;height:40px">Go</button>
          <input id="name" style="position:absolute;left:40px;top:40px">
          <script>
            window.moves = []
            window.keys = []
            addEventListener('mousemove', (e) => { if (e.isTrusted) moves.push([e.clientX, e.clientY]) })
            addEventListener('keydown', (e) => { if (e.isTrusted) keys.push(performance.now()) })
          </script>
        `,
      },
    })
  }, 600000)

  afterAll(async () => {
    await server?.close()
    await cleanupTestContext(testCtx, cleanup)
    cleanup = null
    testCtx = null
  })

  it('warns about an interactive challenge and waits out one that clears', async () => {
    const turnstile = await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          state.page = await context.newPage();
          await state.page.goto('${server!.baseUrl}/turnstile');
        `,
      },
    })
    expect((turnstile as any).content[0].text.replace(server!.baseUrl, 'BASE')).toMatchInlineSnapshot(`"[WARNING] Bot challenge on BASE: cloudflare captcha or verification (title: Just a moment...). Do not reload, retry or try to solve it yourself. Ask the user to solve it in the browser tab, then continue."`)

    const cleared = await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          await state.page.goto('${server!.baseUrl}/clears');
          return 'navigated';
        `,
      },
    })
    const clearedText = (cleared as any).content[0].text as string
    expect(clearedText).not.toContain('[WARNING]')
    const title = await client.callTool({ name: 'execute', arguments: { code: 'return await state.page.title()' } })
    expect((title as any).content[0].text).toContain('Shop')
  })

  it('moves the mouse along a path and spaces key presses', async () => {
    const result = await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          await state.page.goto('${server!.baseUrl}/input');
          await state.page.mouse.move(20, 20);
          await state.page.click('#go');
          await state.page.locator('#name').pressSequentially('hello');
          return await state.page.evaluate(() => {
            const gaps = keys.slice(1).map((t, i) => t - keys[i]);
            return { moves: moves.length, keys: keys.length, minGap: Math.min(...gaps) };
          });
        `,
      },
    })
    const text = (result as any).content[0].text as string
    const read = (name: string) => Number(new RegExp(`${name}: ([\\d.]+)`).exec(text)?.[1])
    // Playwright alone sends 1 move per mouse.move/click; the relay adds a path of samples
    expect(read('moves')).toBeGreaterThan(10)
    expect(read('keys')).toBe(5)
    expect(read('minGap')).toBeGreaterThan(25)
  })
})
