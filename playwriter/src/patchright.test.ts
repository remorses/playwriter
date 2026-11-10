/**
 * Patchright sessions and verification pages end to end:
 * - execute warns when a navigation lands on a verification page, and waits out one that clears by itself
 * - a Patchright session moves the mouse along a path of trusted events and spaces key presses,
 *   while a Playwright session on localhost keeps Playwright's raw input
 * - a session switches to Patchright (isolated page.evaluate) and back mid-run
 * - pages see no playwriter globals, hooked DOM calls or DOM changes besides the toolbar and cursor
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

describe('Patchright and verification pages', () => {
  let client: Awaited<ReturnType<typeof createMCPClient>>['client']
  let cleanup: (() => Promise<void>) | null = null
  let testCtx: TestContext | null = null
  let server: SimpleServer | null = null

  const post = async (route: string, body: object) => {
    const response = await fetch(`http://127.0.0.1:${TEST_PORT}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return (await response.json()) as any
  }

  beforeAll(async () => {
    testCtx = await setupTestContext({
      port: TEST_PORT,
      tempDirPrefix: 'pw-patchright-test-',
      toggleExtension: true,
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
        // Records what page scripts can see: globals, hooked DOM calls from foreign scripts, DOM changes.
        // Adapted from anomalyco/browse stress/stealth/probe.html.
        '/probe': dedent`
          <!doctype html>
          <button id="go" style="position:absolute;left:300px;top:200px;width:120px;height:40px">Go</button>
          <script>
            const pageUrl = location.href
            const seen = { calls: [], nodes: [], htmlAttributes: [], clicks: [] }
            for (const [owner, name] of [[Document.prototype, 'querySelector'], [Document.prototype, 'getElementById'], [Document.prototype, 'createElement'], [Element.prototype, 'getBoundingClientRect']]) {
              const original = owner[name]
              owner[name] = function (...args) {
                const foreign = (new Error().stack || '').split('\\n').slice(2).some((line) => /\\bat\\b/.test(line) && !line.includes(pageUrl))
                if (foreign) seen.calls.push(name)
                return original.apply(this, args)
              }
            }
            new MutationObserver((records) => {
              for (const r of records) {
                if (r.type === 'attributes' && r.target === document.documentElement) seen.htmlAttributes.push(r.attributeName)
                for (const n of r.addedNodes) if (n.nodeType === 1) seen.nodes.push(n.tagName + (n.id ? '#' + n.id : ''))
              }
            }).observe(document.documentElement, { childList: true, subtree: true, attributes: true })
            addEventListener('click', (e) => seen.clicks.push([e.clientX, e.clientY]), true)
            const baseline = new Set(Object.getOwnPropertyNames(window))
            window.report = () => ({
              globals: Object.getOwnPropertyNames(window).filter((n) => !baseline.has(n) && n !== 'report'),
              calls: [...new Set(seen.calls)],
              nodes: seen.nodes,
              htmlAttributes: seen.htmlAttributes,
              clicks: seen.clicks,
            })
          </script>
        `,
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

  it('warns about a verification page and waits out one that clears', async () => {
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

  it('leaves no page-visible traces and clicks a little off center', async () => {
    const session = await post('/cli/session/new', { patchright: true })
    const result = await post('/cli/execute', {
      sessionId: session.id,
      timeout: 30000,
      code: js`
        const page = await context.newPage();
        await page.goto('${server!.baseUrl}/probe');
        await page.click('#go');
        await page.click('#go');
        await page.click('#go');
        await page.mouse.click(360, 220);
        await page.mouse.click(100, 100);
        await page.screenshot();
        // Patchright evaluates in an isolated world unless the third argument is false
        const report = await page.evaluate(() => JSON.stringify(window.report()), undefined, false);
        await page.close();
        return report;
      `,
    })
    await post('/cli/session/delete', { sessionId: session.id })
    const text = result.text as string
    const report = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1).replace(/\\"/g, '"'))
    const { clicks, ...visible } = report
    // The toolbar host is the only node playwriter adds; the ghost cursor element appears on the first click.
    expect(visible).toMatchInlineSnapshot(`
      {
        "calls": [],
        "globals": [],
        "htmlAttributes": [],
        "nodes": [
          "DIV",
          "DIV",
        ],
      }
    `)
    const elementClicks = clicks.slice(0, 3)
    for (const [x, y] of elementClicks) {
      expect(Math.abs(x - 360)).toBeLessThanOrEqual(10)
      expect(Math.abs(y - 220)).toBeLessThanOrEqual(8)
    }
    expect(elementClicks.some(([x, y]: number[]) => x !== 360 || y !== 220)).toBe(true)
    // Raw coordinates stay exact, also on the center an element click just used
    expect(clicks.slice(3)).toEqual([[360, 220], [100, 100]])
  }, 60000)

  it('Patchright sessions add mouse paths and key gaps, Playwright sessions on localhost do not', async () => {
    const measureInput = async (patchright: boolean) => {
      const session = await post('/cli/session/new', { patchright })
      expect(session.patchright).toBe(patchright)
      const result = await post('/cli/execute', {
        sessionId: session.id,
        timeout: 30000,
        code: js`
          const page = await context.newPage();
          await page.goto('${server!.baseUrl}/input');
          await page.mouse.move(20, 20);
          await page.click('#go');
          await page.locator('#name').pressSequentially('hello');
          const measured = await page.evaluate(() => {
            const gaps = keys.slice(1).map((t, i) => t - keys[i]);
            return { moves: moves.length, keys: keys.length, minGap: Math.min(...gaps) };
          }${patchright ? ', undefined, false' : ''});
          await page.close();
          return measured;
        `,
      })
      await post('/cli/session/delete', { sessionId: session.id })
      const read = (name: string) => Number(new RegExp(`${name}: ([\\d.]+)`).exec(result.text)?.[1])
      return { moves: read('moves'), keys: read('keys'), minGap: read('minGap') }
    }

    // Playwright alone sends 1 move per mouse.move/click; the relay adds a path of samples
    const on = await measureInput(true)
    expect(on.moves).toBeGreaterThan(10)
    expect(on.keys).toBe(5)
    expect(on.minGap).toBeGreaterThan(25)

    const playwright = await measureInput(false)
    expect(playwright.moves).toBeLessThanOrEqual(3)
    expect(playwright.keys).toBe(5)
  }, 60000)

  it('switches a session to Patchright and back mid-run, tabs stay open', async () => {
    const session = await post('/cli/session/new', {})
    const run = async (code: string) => {
      const result = await post('/cli/execute', { sessionId: session.id, timeout: 30000, code })
      expect(result.isError).toBeFalsy()
      return result.text as string
    }
    const findPage = js`const page = context.pages().find((p) => p.url().endsWith('/input'));`
    // Playwright evaluates in the main world, so page globals are visible
    expect(await run(js`
      state.page = await context.newPage();
      await state.page.goto('${server!.baseUrl}/input');
      return await state.page.evaluate(() => typeof window.moves);
    `)).toMatchInlineSnapshot(`"[return value] object"`)

    const on = await post('/cli/session/update', { sessionId: session.id, patchright: true })
    expect(on).toMatchInlineSnapshot(`
      {
        "patchright": true,
        "reconnected": true,
        "success": true,
      }
    `)
    expect(await run(js`
      ${findPage}
      await page.click('#go');
      return {
        state: Object.keys(state),
        isolated: await page.evaluate(() => typeof window.moves),
        main: await page.evaluate(() => typeof window.moves, undefined, false),
        humanized: await page.evaluate(() => moves.length > 10, undefined, false),
      };
    `)).toMatchInlineSnapshot(`"[return value] { state: [], isolated: 'undefined', main: 'object', humanized: true }"`)

    const off = await post('/cli/session/update', { sessionId: session.id, patchright: false })
    expect(off).toMatchInlineSnapshot(`
      {
        "patchright": false,
        "reconnected": true,
        "success": true,
      }
    `)
    expect(await run(js`
      ${findPage}
      const main = await page.evaluate(() => typeof window.moves);
      await page.close();
      return main;
    `)).toMatchInlineSnapshot(`"[return value] object"`)
    await post('/cli/session/delete', { sessionId: session.id })
  }, 60000)
})
