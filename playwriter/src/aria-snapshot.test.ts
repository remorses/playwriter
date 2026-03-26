import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import net from 'node:net'
import { Page } from '@xmorse/playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import { getAriaSnapshot } from './aria-snapshot.js'
import { getCdpUrl } from './utils.js'
import { getCDPSessionForPage } from './cdp-session.js'
import { setupTestContext, cleanupTestContext, getExtensionServiceWorker, type TestContext } from './test-utils.js'

const TEST_PORT = 19986
const SNAPSHOTS_DIR = path.join(import.meta.dirname, 'aria-snapshots')
const AX_DEBUG_DIR = path.join(import.meta.dirname, '__snapshots__', 'ax-debug')
const SHOULD_DUMP_AX = process.env.PLAYWRITER_DUMP_AX === '1'

type HtmlServer = {
  baseUrl: string
  close: () => Promise<void>
}

async function createHtmlServer({ htmlByPath }: { htmlByPath: Record<string, string> }): Promise<HtmlServer> {
  const openSockets: Set<net.Socket> = new Set()
  const server = http.createServer((req, res) => {
    const requestUrl = req.url || '/'
    const html = htmlByPath[requestUrl]
    if (!html) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Not found')
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(html)
  })

  server.on('connection', (socket) => {
    openSockets.add(socket)
    socket.on('close', () => {
      openSockets.delete(socket)
    })
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind test server')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => {
      for (const socket of openSockets) {
        socket.destroy()
      }
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    },
  }
}

describe('aria-snapshot', () => {
  let ctx: TestContext
  let page: Page

  beforeAll(async () => {
    ctx = await setupTestContext({ port: TEST_PORT, tempDirPrefix: 'aria-snapshot-test-', toggleExtension: true })
    page = await ctx.browserContext.newPage()
    const serviceWorker = await getExtensionServiceWorker(ctx.browserContext)
    await page.goto('about:blank')
    await serviceWorker.evaluate(async () => {
      await (globalThis as any).toggleExtensionForActiveTab()
    })
    if (!fs.existsSync(SNAPSHOTS_DIR)) {
      fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true })
    }
    if (SHOULD_DUMP_AX && !fs.existsSync(AX_DEBUG_DIR)) {
      fs.mkdirSync(AX_DEBUG_DIR, { recursive: true })
    }
  }, 60000)

  afterAll(async () => {
    await cleanupTestContext(ctx)
  })

  const sites = [
    { name: 'hackernews', url: 'https://news.ycombinator.com' },
    { name: 'github', url: 'https://github.com' },
    { name: 'prosemirror', url: 'https://prosemirror.net/' },
  ]

  for (const site of sites) {
    it(`${site.name} - snapshot`, async () => {
      await page.goto(site.url, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1000)

      if (SHOULD_DUMP_AX) {
        const cdp = await getCDPSessionForPage({ page })
        try {
          await cdp.send('DOM.enable')
          await cdp.send('Accessibility.enable')
          const axTree = await cdp.send('Accessibility.getFullAXTree')
          const domTree = await cdp.send('DOM.getFlattenedDocument', { depth: -1, pierce: true })
          fs.writeFileSync(path.join(AX_DEBUG_DIR, `${site.name}-ax-tree.json`), JSON.stringify(axTree, null, 2))
          fs.writeFileSync(path.join(AX_DEBUG_DIR, `${site.name}-dom-flat.json`), JSON.stringify(domTree, null, 2))
        } finally {
          await cdp.detach()
        }
      }

      const { snapshot } = await getAriaSnapshot({ page })
      expect(snapshot.length).toBeGreaterThan(0)
      // Check for locator format: attribute selector or role selector
      expect(snapshot).toMatch(/(?:\[id="|\[data-[\w-]+="|role=)/)
      const wrapperLines = snapshot.split('\n').filter((line) => {
        const trimmed = line.trim()
        return /^-\s+(generic|group|none|presentation)\s*:?$/.test(trimmed)
      })
      expect(wrapperLines).toEqual([])
      fs.writeFileSync(path.join(SNAPSHOTS_DIR, `${site.name}-raw.txt`), snapshot)
      console.log(`\n📊 ${site.name.toUpperCase()} snapshot size: ${snapshot.length} bytes`)

      const { snapshot: interactiveSnapshot } = await getAriaSnapshot({
        page,
        interactiveOnly: true,
      })
      expect(interactiveSnapshot).not.toMatch(/^-\s+heading\b/m)
      // Check for locator format: attribute selector or role selector
      expect(interactiveSnapshot).toMatch(/(?:\[id="|\[data-[\w-]+="|role=)/)
      fs.writeFileSync(path.join(SNAPSHOTS_DIR, `${site.name}-interactive.txt`), interactiveSnapshot)
    }, 30000)
  }

  it('prosemirror editor - contenteditable appears in snapshot and is interactable', async () => {
    await page.goto('https://prosemirror.net/', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2000)

    const { snapshot: interactiveSnapshot } = await getAriaSnapshot({ page, interactiveOnly: true })

    fs.writeFileSync(path.join(SNAPSHOTS_DIR, 'prosemirror-interactive.txt'), interactiveSnapshot)
    console.log('\n--- PROSEMIRROR INTERACTIVE SNAPSHOT ---')
    console.log(interactiveSnapshot)

    // The ProseMirror editor uses a bare <div contenteditable="true"> without role="textbox".
    // After the contenteditable promotion fix, it should appear as a textbox.
    expect(interactiveSnapshot).toContain('textbox')
    expect(interactiveSnapshot).toContain('[contenteditable="true"]')

    // The generated locator should actually work in Playwright
    const editor = page.locator('[contenteditable="true"]')
    const editorCount = await editor.count()
    expect(editorCount).toBe(1)

    // Click on the editor and type content
    await editor.click()
    // Select all existing content and replace it
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type('Hello from playwriter test!')

    const content = await editor.innerText()
    expect(content).toContain('Hello from playwriter test!')

    // Take full snapshot again and verify the new content is visible
    const { snapshot: afterSnapshot } = await getAriaSnapshot({ page })
    expect(afterSnapshot).toContain('Hello from playwriter test')
  }, 30000)

  it('bare contenteditable without role=textbox shows in snapshot', async () => {
    // Reproduces the core issue: bare contenteditable divs (like ProseMirror uses)
    // have no explicit role="textbox", so Chrome's AX tree reports them as "generic".
    // Our fix promotes them to textbox.
    const htmlServer = await createHtmlServer({
      htmlByPath: {
        '/': `<!doctype html>
<html>
<head><meta charset="utf-8"><title>ContentEditable Test</title></head>
<body>
  <h1>Rich Text Editor Test</h1>
  <div id="editor-with-id" contenteditable="true"
       style="border: 1px solid #ccc; padding: 8px; min-height: 60px;">
    <p>Editor with id, no role attribute.</p>
  </div>
  <div class="ProseMirror" contenteditable="true"
       style="border: 1px solid #ccc; padding: 8px; min-height: 60px;">
    <p>Bare ProseMirror-style editor, no role, no id.</p>
  </div>
  <div contenteditable=""
       style="border: 1px solid #ccc; padding: 8px; min-height: 60px;">
    <p>Editor with empty contenteditable attr.</p>
  </div>
  <div contenteditable="plaintext-only"
       style="border: 1px solid #ccc; padding: 8px; min-height: 60px;">
    <p>Plaintext-only editor.</p>
  </div>
  <div contenteditable="true" role="textbox" aria-label="Labeled editor"
       style="border: 1px solid #ccc; padding: 8px; min-height: 60px;">
    <p>Editor with explicit role=textbox.</p>
  </div>
  <input type="text" placeholder="Normal input" />
</body>
</html>`,
      },
    })

    try {
      await page.goto(htmlServer.baseUrl, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(500)

      const { snapshot: interactiveSnapshot } = await getAriaSnapshot({ page, interactiveOnly: true })
      console.log('\n--- CONTENTEDITABLE INTERACTIVE SNAPSHOT ---')
      console.log(interactiveSnapshot)

      // All contenteditable divs should appear as textbox
      const textboxLines = interactiveSnapshot.split('\n').filter((line) => {
        return line.includes('textbox')
      })
      // 5 contenteditable (id, bare, empty-attr, plaintext-only, explicit-role) + 1 input = 6
      expect(textboxLines.length).toBeGreaterThanOrEqual(6)

      // The editor with id should use [id="editor-with-id"] as locator
      expect(interactiveSnapshot).toContain('[id="editor-with-id"]')

      // The bare contenteditable without id/role should use [contenteditable="true"]
      expect(interactiveSnapshot).toContain('[contenteditable="true"]')

      // Try clicking and typing in the bare contenteditable (no role, no id)
      const bareEditors = page.locator('[contenteditable="true"]')
      const bareCount = await bareEditors.count()
      expect(bareCount).toBeGreaterThanOrEqual(2) // at least the 2 bare ones

      // Click the first bare contenteditable and type
      await bareEditors.first().click()
      await page.keyboard.press('ControlOrMeta+A')
      await page.keyboard.type('Typed via locator!')

      const content = await bareEditors.first().innerText()
      expect(content).toContain('Typed via locator!')
    } finally {
      await htmlServer.close()
    }
  }, 30000)

  it('scopes snapshot to cross-origin iframe locator', async () => {
    const iframeServer = await createHtmlServer({
      htmlByPath: {
        '/iframe.html': `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Iframe Content</title>
  </head>
  <body>
    <h1>Iframe Heading</h1>
    <button data-testid="iframe-button">Iframe Button</button>
  </body>
</html>`,
      },
    })

    const outerServer = await createHtmlServer({
      htmlByPath: {
        '/': `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Outer Page</title>
  </head>
  <body>
    <h1>Outer Heading</h1>
    <iframe data-testid="external-iframe" src="${iframeServer.baseUrl}/iframe.html"></iframe>
  </body>
</html>`,
      },
    })

    try {
      await page.goto(outerServer.baseUrl, { waitUntil: 'domcontentloaded', timeout: 10000 })
      await page.locator('[data-testid="external-iframe"]').waitFor({ timeout: 5000 })
      await page
        .frameLocator('[data-testid="external-iframe"]')
        .locator('[data-testid="iframe-button"]')
        .waitFor({ timeout: 5000 })

      // Convert iframe Locator to Frame
      const iframeHandle = await page.locator('[data-testid="external-iframe"]').elementHandle()
      const iframeFrame = await iframeHandle!.contentFrame()

      const { snapshot } = await getAriaSnapshot({
        page,
        frame: iframeFrame!,
      })

      expect(snapshot).toContain('Iframe Heading')
      // TODO we seem to be using name with higher priority than test id for some reason in snapshots
      // expect(snapshot).toContain('[data-testid="iframe-button"]')
      expect(snapshot).not.toContain('Outer Heading')
    } finally {
      await outerServer.close()
      await iframeServer.close()
    }
  }, 30000)
})
