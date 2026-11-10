// End-to-end tests for the `playwriter recorder` action recording feature:
// relay /recorder/* endpoints + ActionRecorder JSON output. Trusted input is
// dispatched via raw CDP so it goes through the injected recorder exactly
// like real user interactions.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from '@xmorse/playwright-core'
import { getCdpUrl } from './utils.js'
import { getCDPSessionForPage } from './cdp-session.js'
import { parseRecording, projectThinEvent, sanitizeRecordedBody, sanitizeRecordedUrl, type RecordingBrowserContext } from './action-recorder.js'
import {
  setupTestContext,
  cleanupTestContext,
  getExtensionServiceWorker,
  createSimpleServer,
  type TestContext,
} from './test-utils.js'
import './test-declarations.js'

const TEST_PORT = 19997
const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`

const jsonHeaders = { 'Content-Type': 'application/json' }

// Tests share one Chrome. A leftover session keeps its disabled recorder
// bindings on every page, so delete each session when its test ends.
async function deleteSession(sessionId: string) {
  await fetch(`${SERVER_URL}/cli/session/delete`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ sessionId }),
  })
}

describe('recorded network redaction', () => {
  it('redacts URL and structured body secrets while keeping useful fields', () => {
    expect(
      sanitizeRecordedUrl(
        'https://user:password@example.com/api?access_token=url-secret&X-Amz-Signature=signed-secret&query=visible#private-fragment',
      ),
    ).toMatchInlineSnapshot(`
      {
        "redacted": true,
        "value": "https://%5Bredacted%5D:%5Bredacted%5D@example.com/api?access_token=%5Bredacted%5D&X-Amz-Signature=%5Bredacted%5D&query=visible",
      }
    `)
    expect(
      sanitizeRecordedBody({
        body: JSON.stringify({
          email: 'person@example.com',
          password: 'body-secret',
          nested: { refresh_token: 'refresh-secret', count: 2 },
        }),
        contentType: 'application/json',
        maxBytes: 1000,
      }),
    ).toMatchInlineSnapshot(`
      {
        "originalBytes": 104,
        "redacted": true,
        "truncated": false,
        "value": "{"email":"person@example.com","password":"[redacted]","nested":{"refresh_token":"[redacted]","count":2}}",
      }
    `)
    expect(
      sanitizeRecordedBody({
        body: 'name=Tommy&csrf_token=form-secret',
        contentType: 'application/x-www-form-urlencoded',
        maxBytes: 1000,
      }),
    ).toMatchInlineSnapshot(`
      {
        "originalBytes": 36,
        "redacted": true,
        "truncated": false,
        "value": "name=Tommy&csrf_token=%5Bredacted%5D",
      }
    `)
    expect(
      sanitizeRecordedBody({
        body: '{"password":"unterminated',
        contentType: 'application/json',
        maxBytes: 1000,
      }),
    ).toMatchInlineSnapshot(`
      {
        "originalBytes": 27,
        "redacted": true,
        "truncated": false,
        "value": "[omitted invalid JSON body]",
      }
    `)
    expect(
      sanitizeRecordedBody({
        body: JSON.stringify({ tokenizer: 'keep', secretary: 'keep', cookiePolicy: 'keep' }),
        contentType: 'application/json',
        maxBytes: 1000,
      }),
    ).toMatchInlineSnapshot(`
      {
        "originalBytes": 61,
        "redacted": false,
        "truncated": false,
        "value": "{"tokenizer":"keep","secretary":"keep","cookiePolicy":"keep"}",
      }
    `)
    expect(
      sanitizeRecordedBody({
        body: 'password=plain-text-secret',
        contentType: 'text/plain',
        maxBytes: 1000,
      }),
    ).toMatchInlineSnapshot(`
      {
        "originalBytes": 27,
        "redacted": true,
        "truncated": false,
        "value": "[omitted unstructured body]",
      }
    `)
  })

  it('limits recorded bodies by UTF-8 bytes', () => {
    expect(
      sanitizeRecordedBody({
        body: JSON.stringify({ message: '😀😀😀😀' }),
        contentType: 'application/json',
        maxBytes: 20,
      }),
    ).toMatchInlineSnapshot(`
      {
        "originalBytes": 30,
        "redacted": false,
        "truncated": true,
        "value": "{"message":"😀😀",
      }
    `)
  })
})

describe('action recording', () => {
  let testCtx: TestContext | null = null
  let recordingsDir: string | null = null

  beforeAll(async () => {
    // Isolate recordings in a temp dir so tests never pollute the user's real
    // ~/.playwriter/recordings (and never collide with a running relay's ids).
    // The relay runs in-process, so the env var is read by getRecordingsDir().
    recordingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-recordings-test-'))
    process.env.PLAYWRITER_RECORDINGS_DIR = recordingsDir
    testCtx = await setupTestContext({ port: TEST_PORT, tempDirPrefix: 'pw-record-test-', toggleExtension: true })
  }, 600000)

  afterAll(async () => {
    await cleanupTestContext(testCtx, null)
    testCtx = null
    delete process.env.PLAYWRITER_RECORDINGS_DIR
    if (recordingsDir) {
      fs.rmSync(recordingsDir, { recursive: true, force: true })
    }
  })

  it('records user actions with locator strings and state changes', async () => {
    const browserContext = testCtx!.browserContext
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    const page = await browserContext.newPage()
    await page.goto('https://example.com/')
    await page.bringToFront()
    await serviceWorker.evaluate(async () => {
      await globalThis.toggleExtensionForActiveTab()
    })
    await new Promise((r) => setTimeout(r, 200))

    // create an executor session on the relay
    const sessionResponse = await fetch(`${SERVER_URL}/cli/session/new`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({}),
    })
    const session = (await sessionResponse.json()) as { id: string }
    expect(session.id).toBeTruthy()

    // start recording
    const startResponse = await fetch(`${SERVER_URL}/recorder/start`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ sessionId: session.id }),
    })
    const start = (await startResponse.json()) as { recordingId: string; file: string; error?: string }
    expect(start.error).toBeUndefined()
    expect(start.recordingId).toBeTruthy()

    // starting again on the same session must fail with 409 Conflict
    const duplicateResponse = await fetch(`${SERVER_URL}/recorder/start`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ sessionId: session.id }),
    })
    expect(duplicateResponse.status).toBe(409)

    // inject a form and interact via trusted CDP input like a real user
    const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
    const cdpPage = browser
      .contexts()[0]
      .pages()
      .find((p) => p.url().includes('example.com'))
    expect(cdpPage).toBeDefined()
    await cdpPage!.evaluate(() => {
      document.body.innerHTML = `
        <button id="submit-btn" onclick="localStorage.setItem('submitted', 'yes'); this.textContent = 'Done!'">Submit order</button>
        <input id="email" placeholder="Email address" type="text" />
        <input id="password" placeholder="Password" type="password" />
        <input id="attachment" aria-label="Attachment" type="file" />
      `
    })

    const cdp = await getCDPSessionForPage({ page: cdpPage! })
    const clickAt = async (selector: string) => {
      const box = await cdpPage!.locator(selector).boundingBox()
      expect(box).toBeTruthy()
      const x = box!.x + box!.width / 2
      const y = box!.y + box!.height / 2
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
    }

    await clickAt('#submit-btn')
    await clickAt('#email')
    await cdp.send('Input.insertText', { text: 'hi@example.com' })
    await clickAt('#password')
    await cdp.send('Input.insertText', { text: 'recorded-password-secret' })

    // trigger the extra recorded signals: console error, toast, in-page fetches
    // (same-origin GET is kept, cross-origin GET is dropped), and a file upload
    await cdpPage!.evaluate(async () => {
      console.error('recorder-test-error')
      const toast = document.createElement('div')
      toast.setAttribute('role', 'status')
      document.body.appendChild(toast)
      toast.textContent = 'You have reached your concurrent generation limit'
      await fetch('/?same-origin-get=kept')
      await fetch('https://www.iana.org/?cross-origin-get-dropped').catch(() => {})
      await fetch('/?access_token=recorded-url-secret&query=visible', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'recorded-body-secret', operation: 'recorder-test' }),
      }).then((r) => r.text())
    })
    const tmpFile = path.join(os.tmpdir(), 'recorder-test-attachment.txt')
    fs.writeFileSync(tmpFile, 'hello')
    await cdpPage!.locator('#attachment').setInputFiles(tmpFile)
    // another trusted action so the post-action capture picks up the upload diff
    await clickAt('#submit-btn')

    // wait for fill-capture debounce + post-action captures to settle
    await new Promise((r) => setTimeout(r, 3000))

    // status shows the active recording
    const statusResponse = await fetch(`${SERVER_URL}/recorder/status`)
    const status = (await statusResponse.json()) as { recordings: Array<{ recordingId: string; sessionId: string }> }
    expect(status.recordings).toHaveLength(1)
    expect(status.recordings[0].sessionId).toBe(session.id)

    // stop recording
    const stopResponse = await fetch(`${SERVER_URL}/recorder/stop`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({}),
    })
    const stop = (await stopResponse.json()) as { recordingId: string; eventCount: number; filePath: string }
    expect(stop.recordingId).toBe(start.recordingId)
    expect(stop.eventCount).toBeGreaterThan(3)

    const events = parseRecording(fs.readFileSync(stop.filePath, 'utf-8'))
    const serializedEvents = JSON.stringify(events)
    expect(serializedEvents).not.toContain('recorded-password-secret')
    expect(serializedEvents).not.toContain('recorded-url-secret')
    expect(serializedEvents).not.toContain('recorded-body-secret')
    expect(serializedEvents).toContain('[redacted]')
    expect(serializedEvents).toContain('recorder-test')

    // recorded actions carry generated locator code
    const actionCodes = events.filter((e) => e.type === 'action').map((e) => e.code)
    expect(actionCodes).toMatchInlineSnapshot(`
      [
        "await page.getByRole('button', { name: 'Submit order' }).click();",
        "await page.getByRole('textbox', { name: 'Email address' }).click();",
        "await page.getByRole('textbox', { name: 'Email address' }).fill('[redacted]');",
        "await page.getByRole('textbox', { name: 'Password' }).click();",
        "await page.getByRole('textbox', { name: 'Password' }).fill('[redacted]');",
        "await page.getByRole('button', { name: 'Attachment' }).setInputFiles('recorder-test-attachment.txt');",
        "await page.getByRole('button', { name: 'Done!' }).click();",
      ]
    `)

    const types = new Set(events.map((e) => e.type))
    expect(types.has('recording-started')).toBe(true)
    expect(types.has('recording-stopped')).toBe(true)
    expect(types.has('snapshot-diff')).toBe(false)
    expect(types.has('storage')).toBe(false)
    expect(types.has('focus')).toBe(false)
    expect(types.has('screenshot')).toBe(false)
    const clickActions = events.filter((e) => e.type === 'action' && e.action === 'click')
    expect(clickActions.length).toBeGreaterThan(0)
    expect(clickActions[0].button).toBe('left')
    expect(clickActions[0].x).toBeUndefined()
    const fillActions = events.filter((e) => e.type === 'action' && e.action === 'fill')
    expect(fillActions.map((event) => event.text)).toEqual(['[redacted]', '[redacted]'])
    // console.error was recorded
    const consoleEvents = events.filter((e) => e.type === 'console')
    expect(JSON.stringify(consoleEvents)).toContain('recorder-test-error')
    // mutating in-page fetch keeps useful structure without persisted secrets
    const fetchEvents = events.filter((e) => e.type === 'network' && e.resourceType === 'fetch')
    expect(fetchEvents.map((e) => e.method)).toEqual(['GET', 'POST'])
    expect(fetchEvents[0].url).toContain('same-origin-get=kept')
    expect(JSON.stringify(fetchEvents)).not.toContain('cross-origin-get-dropped')
    // toast text from the role=status region, linked to the password click
    const toasts = events.filter((e) => e.type === 'toast')
    expect(toasts.map((e) => [e.role, e.text])).toEqual([['status', 'You have reached your concurrent generation limit']])
    expect(events.find((e) => e.id === toasts[0].afterAction)?.action).toBeTruthy()
    expect(fetchEvents[1]).toMatchObject({
      postDataRedacted: true,
      urlRedacted: true,
    })
    expect(fetchEvents[0].responseBody || fetchEvents[0].responseBodyOmitted).toBeTruthy()
    const uploadActions = events.filter((e) => e.type === 'action' && String(e.code).includes('setInputFiles'))
    expect(JSON.stringify(uploadActions)).toContain('recorder-test-attachment.txt')
    expect(uploadActions[0].files).toEqual(['recorder-test-attachment.txt'])
    // every event has a sequential id for the drill-down view
    expect(events.map((e) => e.id)).toEqual(events.map((_, i) => i + 1))
    // thin projection replaces heavy payloads with sizes
    const thinFetch = projectThinEvent(fetchEvents[1])
    expect(thinFetch.responseBody).toBeUndefined()
    expect(thinFetch.postData).toBeUndefined()
    expect(typeof thinFetch.postDataSize).toBe('number')

    // stopping again → 404, no active recording
    const stopAgainResponse = await fetch(`${SERVER_URL}/recorder/stop`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({}),
    })
    expect(stopAgainResponse.status).toBe(404)

    // events are also served over HTTP for remote relays
    const eventsResponse = await fetch(`${SERVER_URL}/recorder/events/${start.recordingId}`)
    expect(eventsResponse.status).toBe(200)
    const remoteEvents = parseRecording(await eventsResponse.text())
    expect(remoteEvents.length).toBe(stop.eventCount)

    // ── second recording on the same session must record actions again ──
    // (regression test for the fork fix: re-enabling the recorder used to
    // leave the cached server recorder in mode 'none')
    const start2Response = await fetch(`${SERVER_URL}/recorder/start`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ sessionId: session.id }),
    })
    const start2 = (await start2Response.json()) as { recordingId: string }
    expect(start2.recordingId).not.toBe(start.recordingId)

    await new Promise((r) => setTimeout(r, 300))
    await clickAt('#submit-btn')
    await new Promise((r) => setTimeout(r, 2000))

    const stop2Response = await fetch(`${SERVER_URL}/recorder/stop`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({}),
    })
    const stop2 = (await stop2Response.json()) as { filePath: string }
    const events2 = parseRecording(fs.readFileSync(stop2.filePath, 'utf-8'))
    const actions2 = events2.filter((e) => e.type === 'action')
    // exactly one action: duplicate listeners in the fork would produce doubles
    expect(actions2.map((e) => e.code)).toMatchInlineSnapshot(`
      [
        "await page.getByRole('button', { name: 'Done!' }).click();",
      ]
    `)

    // SPA pushState mid-fill must stay one action with the final text
    const start3Response = await fetch(`${SERVER_URL}/recorder/start`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ sessionId: session.id }),
    })
    const start3 = (await start3Response.json()) as { recordingId: string }
    expect(start3.recordingId).toBeTruthy()
    await cdpPage!.evaluate(`
      document.body.innerHTML = '<input id="q" placeholder="Search" type="text" />'
      const input = document.getElementById('q')
      input.addEventListener('input', () => {
        if (input.value.length >= 2) history.pushState({}, '', '/changed')
      })
    `)
    await clickAt('#q')
    await cdp.send('Input.insertText', { text: 'a' })
    await new Promise((r) => setTimeout(r, 50))
    await cdp.send('Input.insertText', { text: 'b' })
    await new Promise((r) => setTimeout(r, 50))
    await cdp.send('Input.insertText', { text: 'c' })
    await new Promise((r) => setTimeout(r, 1500))
    const stop3Response = await fetch(`${SERVER_URL}/recorder/stop`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({}),
    })
    const stop3 = (await stop3Response.json()) as { filePath: string }
    const events3 = parseRecording(fs.readFileSync(stop3.filePath, 'utf-8'))
    const fills3 = events3.filter((e) => e.type === 'action' && e.action === 'fill')
    expect(fills3.map((e) => e.code)).toEqual([
      "await page.getByRole('textbox', { name: 'Search' }).fill('[redacted]');",
    ])
    expect(fills3[0].text).toBe('[redacted]')

    await deleteSession(session.id)
    await browser.close()
  }, 120000)

  it('records one click when a second CDP client also enables the recorder', async () => {
    const browserContext = testCtx!.browserContext
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    const page = await browserContext.newPage()
    await page.goto('https://example.com/?second-client')
    await page.bringToFront()
    await serviceWorker.evaluate(async () => {
      await globalThis.toggleExtensionForActiveTab()
    })
    await new Promise((r) => setTimeout(r, 200))

    const sessionResponse = await fetch(`${SERVER_URL}/cli/session/new`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({}),
    })
    const session = (await sessionResponse.json()) as { id: string }
    expect(session.id).toBeTruthy()

    const startResponse = await fetch(`${SERVER_URL}/recorder/start`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ sessionId: session.id }),
    })
    const start = (await startResponse.json()) as { recordingId: string; error?: string }
    expect(start.error).toBeUndefined()

    const extraBrowser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
    const extraContext = extraBrowser.contexts()[0]
    expect(extraContext).toBeDefined()
    await (extraContext as RecordingBrowserContext)._startRecording({ language: 'javascript' }, {
      actionAdded: () => {},
      actionUpdated: () => {},
    })

    const cdpPage = extraContext!
      .pages()
      .find((p) => p.url().includes('?second-client'))
    expect(cdpPage).toBeDefined()
    await cdpPage!.evaluate(() => {
      document.body.innerHTML = `<button id="only-once">Only once</button>`
    })
    const cdp = await getCDPSessionForPage({ page: cdpPage! })
    const box = await cdpPage!.locator('#only-once').boundingBox()
    expect(box).toBeTruthy()
    const x = box!.x + box!.width / 2
    const y = box!.y + box!.height / 2
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
    await new Promise((r) => setTimeout(r, 1500))

    const stopResponse = await fetch(`${SERVER_URL}/recorder/stop`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ recordingId: start.recordingId }),
    })
    const stop = (await stopResponse.json()) as { filePath: string }
    const events = parseRecording(fs.readFileSync(stop.filePath, 'utf-8'))
    const clicks = events.filter((e) => e.type === 'action' && e.action === 'click')
    // Page alias depends on tabs left by earlier tests, so ignore the number
    expect(clicks.map((e) => String(e.code).replace(/page\d+/, 'page'))).toEqual([
      "await page.getByRole('button', { name: 'Only once' }).click();",
    ])

    await deleteSession(session.id)
    await extraBrowser.close()
  }, 120000)

  it('binding calls are answered only by the client that exposed them', async () => {
    const browserContext = testCtx!.browserContext
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    const page = await browserContext.newPage()
    await page.goto('https://example.com/?binding-owner')
    await page.bringToFront()
    await serviceWorker.evaluate(async () => {
      await globalThis.toggleExtensionForActiveTab()
    })
    await new Promise((r) => setTimeout(r, 200))

    const owner = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
    const other = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
    const ownerPage = owner.contexts()[0].pages().find((p) => p.url().includes('?binding-owner'))!
    expect(other.contexts()[0].pages().some((p) => p.url().includes('?binding-owner'))).toBe(true)
    // Slow binding: the other client answers first if it answers at all
    await ownerPage.exposeFunction('slowDouble', async (n: number) => {
      await new Promise((r) => setTimeout(r, 300))
      return n * 2
    })

    const result = await ownerPage.evaluate(() => (window as any).slowDouble(21).catch((e: Error) => e.message))
    expect(result).toBe(42)

    await other.close()
    await owner.close()
  }, 120000)

  // New tabs only reach the recorder if the extension attaches them: popup
  // windows via relocation, modifier/middle/_blank tabs via tab group inheritance.
  it('records popup windows and links opened in new tabs', async () => {
    const htmlServer = await createSimpleServer({
      routes: {
        '/opener': `<!doctype html><html><body>
          <button id="open-popup" onclick="window.open('/popup-target', '', 'width=400,height=300,popup=1')">Open popup</button>
          <p><a id="mod-link" href="/mod-target">Modifier link</a></p>
          <p><a id="middle-link" href="/middle-target">Middle link</a></p>
          <p><a id="blank-link" href="/blank-target" target="_blank">Blank link</a></p>
        </body></html>`,
        '/popup-target': `<!doctype html><html><body><button id="in-popup">Inside popup</button></body></html>`,
        '/mod-target': `<!doctype html><html><body><button id="in-mod">Inside modifier tab</button></body></html>`,
        '/middle-target': `<!doctype html><html><body><h1>Middle target</h1></body></html>`,
        '/blank-target': `<!doctype html><html><body><h1>Blank target</h1></body></html>`,
      },
    })
    const browserContext = testCtx!.browserContext
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    const page = await browserContext.newPage()
    await page.goto(`${htmlServer.baseUrl}/opener`)
    await page.bringToFront()
    await serviceWorker.evaluate(async () => {
      await globalThis.toggleExtensionForActiveTab()
    })

    const sessionResponse = await fetch(`${SERVER_URL}/cli/session/new`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({}),
    })
    const session = (await sessionResponse.json()) as { id: string }
    const startResponse = await fetch(`${SERVER_URL}/recorder/start`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ sessionId: session.id }),
    })
    const start = (await startResponse.json()) as { recordingId: string; error?: string }
    expect(start.error).toBeUndefined()

    const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
    const base = htmlServer.baseUrl
    const waitForPage = async (pathname: string) => {
      const deadline = Date.now() + 5000
      while (Date.now() < deadline) {
        const found = browser
          .contexts()[0]
          .pages()
          .find((p) => p.url() === `${base}${pathname}`)
        if (found) {
          return found
        }
        await new Promise((r) => setTimeout(r, 50))
      }
      throw new Error(`Page ${pathname} was not attached`)
    }
    const clickIn = async ({
      target,
      selector,
      button = 'left',
      modifiers = 0,
    }: {
      target: Awaited<ReturnType<typeof waitForPage>>
      selector: string
      button?: 'left' | 'middle'
      modifiers?: number
    }) => {
      const cdp = await getCDPSessionForPage({ page: target })
      const box = await target.locator(selector).boundingBox()
      expect(box).toBeTruthy()
      const x = box!.x + box!.width / 2
      const y = box!.y + box!.height / 2
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: 1, modifiers })
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: 1, modifiers })
    }
    // CDP modifiers bitfield: Ctrl=2, Meta=4. Cmd+click on mac, Ctrl+click elsewhere.
    const newTabModifier = process.platform === 'darwin' ? 4 : 2
    const opener = await waitForPage('/opener')

    await clickIn({ target: opener, selector: '#open-popup' })
    await clickIn({ target: await waitForPage('/popup-target'), selector: '#in-popup' })
    await clickIn({ target: opener, selector: '#mod-link', modifiers: newTabModifier })
    await clickIn({ target: await waitForPage('/mod-target'), selector: '#in-mod' })
    await clickIn({ target: opener, selector: '#middle-link', button: 'middle' })
    await waitForPage('/middle-target')
    await clickIn({ target: opener, selector: '#blank-link' })
    await waitForPage('/blank-target')
    // let the recorder flush the last actions and signals
    await new Promise((r) => setTimeout(r, 500))

    const stopResponse = await fetch(`${SERVER_URL}/recorder/stop`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ recordingId: start.recordingId }),
    })
    const stop = (await stopResponse.json()) as { filePath: string }
    const events = parseRecording(fs.readFileSync(stop.filePath, 'utf-8'))
    // Alias numbers depend on tabs left by earlier tests: renumber by first use
    const aliases = new Map<string, string>()
    const timeline = events
      .filter((e) => ['action', 'page-opened', 'signal'].includes(e.type))
      .map((e) => {
        return [e.type, e.action || e.signal, e.code || e.url, e.pageAlias && `alias=${e.pageAlias}`]
          .filter(Boolean)
          .join(' ')
          .split(base)
          .join('BASE')
          .replace(/\bpage\d+\b/g, (alias) => {
            if (!aliases.has(alias)) {
              aliases.set(alias, `page${aliases.size + 1}`)
            }
            return aliases.get(alias)!
          })
      })
    expect(timeline).toMatchInlineSnapshot(`
      [
        "action click await page.getByRole('button', { name: 'Open popup' }).click(); alias=page",
        "page-opened BASE/popup-target",
        "signal popup alias=page",
        "action click await page1.getByRole('button', { name: 'Inside popup' }).click(); alias=page1",
        "action click await page.getByRole('link', { name: 'Modifier link' }).click({ modifiers: ['ControlOrMeta'] }); alias=page",
        "page-opened BASE/mod-target",
        "action openPage const page2 = await context.newPage(); await page2.goto('BASE/mod-target'); alias=page2",
        "action click await page2.getByRole('button', { name: 'Inside modifier tab' }).click(); alias=page2",
        "action click await page.getByRole('link', { name: 'Middle link' }).click({ button: 'middle' }); alias=page",
        "page-opened BASE/middle-target",
        "action openPage const page3 = await context.newPage(); await page3.goto('BASE/middle-target'); alias=page3",
        "action click await page.getByRole('link', { name: 'Blank link' }).click(); alias=page",
        "page-opened BASE/blank-target",
        "signal popup alias=page",
      ]
    `)

    await deleteSession(session.id)
    await browser.close()
    await htmlServer.close()
  }, 120000)
})
