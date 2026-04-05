/**
 * Tests for auto-relocation of popup windows to tabs.
 * - Connected source tab → popup gets relocated + auto-attached.
 * - No source tab connected → popup is left alone.
 */

import { createMCPClient } from './mcp-client.js'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  setupTestContext,
  cleanupTestContext,
  getExtensionServiceWorker,
  createSimpleServer,
  type TestContext,
  type SimpleServer,
  js,
} from './test-utils.js'
import './test-declarations.js'

const TEST_PORT = 19995

describe('Popup window relocation', () => {
  let client: Awaited<ReturnType<typeof createMCPClient>>['client']
  let cleanup: (() => Promise<void>) | null = null
  let testCtx: TestContext | null = null
  let htmlServer: SimpleServer | null = null

  beforeAll(async () => {
    testCtx = await setupTestContext({
      port: TEST_PORT,
      tempDirPrefix: 'pw-popup-test-',
      toggleExtension: true,
    })

    const result = await createMCPClient({ port: TEST_PORT })
    client = result.client
    cleanup = result.cleanup

    htmlServer = await createSimpleServer({
      routes: {
        '/opener': `<!doctype html>
<html>
  <body>
    <button id="open-popup" onclick="window.open('/target', '', 'width=400,height=300,popup=1')">Open popup</button>
  </body>
</html>`,
        '/target': `<!doctype html>
<html>
  <body>
    <h1 id="target-heading">Popup target page</h1>
  </body>
</html>`,
      },
    })
  }, 600000)

  afterAll(async () => {
    if (htmlServer) {
      await htmlServer.close()
    }
    await cleanupTestContext(testCtx, cleanup)
    cleanup = null
    testCtx = null
  })

  it('relocates popup window into main browser context as a tab', async () => {
    if (!htmlServer) throw new Error('html server not initialized')
    const browserContext = testCtx!.browserContext
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          state.popupTestPage = context.pages().find((p) => p.url() === 'about:blank') ?? (await context.newPage());
          await state.popupTestPage.goto('${htmlServer.baseUrl}/opener', { waitUntil: 'domcontentloaded' });
          return { url: state.popupTestPage.url(), pagesBefore: context.pages().length };
        `,
      },
    })

    const clickResult = await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          await state.popupTestPage.click('#open-popup');
          await state.popupTestPage.waitForTimeout(1500);
          return { pagesAfter: context.pages().length, allUrls: context.pages().map((p) => p.url()) };
        `,
      },
    })

    const clickOutput = (clickResult as any).content[0].text as string

    expect(clickOutput).toContain('/target')
    expect((clickResult as any).isError).not.toBe(true)
    expect(clickOutput).toContain('[WARNING] New page opened from current page')
    expect(clickOutput).not.toContain('Popup window detected')
    expect(clickOutput).not.toContain('cannot be controlled by playwriter')

    const windowTypes = await serviceWorker.evaluate(async () => {
      const windows = await chrome.windows.getAll({ populate: false })
      return windows.map((w) => w.type)
    })
    expect(windowTypes).not.toContain('popup')
    expect(windowTypes).toContain('normal')

    await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          const targetPage = context.pages().find((p) => p.url().endsWith('/target'));
          if (targetPage) { await targetPage.close(); }
          await state.popupTestPage.close();
          delete state.popupTestPage;
        `,
      },
    })
  }, 60000)

  it('leaves popup windows alone when no Playwriter tab is connected', async () => {
    if (!htmlServer) throw new Error('html server not initialized')
    const browserContext = testCtx!.browserContext
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    await serviceWorker.evaluate(async () => {
      await globalThis.disconnectEverything()
    })
    await new Promise((r) => {
      setTimeout(r, 200)
    })

    // Drive the browser directly via browserContext (not MCP/extension) so
    // the opener tab stays unconnected.
    const unconnectedPage = await browserContext.newPage()
    await unconnectedPage.goto(`${htmlServer.baseUrl}/opener`, { waitUntil: 'domcontentloaded' })
    await unconnectedPage.bringToFront()
    await unconnectedPage.click('#open-popup')
    // If relocation DID happen, the popup window would be gone by now.
    await new Promise((r) => {
      setTimeout(r, 1500)
    })

    const windowTypes = await serviceWorker.evaluate(async () => {
      const windows = await chrome.windows.getAll({ populate: false })
      return windows.map((w) => w.type)
    })
    expect(windowTypes).toContain('popup')

    const windowIdsToClose = await serviceWorker.evaluate(async () => {
      const windows = await chrome.windows.getAll({ populate: false })
      return windows.filter((w) => w.type === 'popup').map((w) => w.id)
    })
    for (const windowId of windowIdsToClose) {
      if (windowId !== undefined) {
        await serviceWorker.evaluate(async (id: number) => {
          await chrome.windows.remove(id)
        }, windowId)
      }
    }
    await unconnectedPage.close()
  }, 60000)
})
