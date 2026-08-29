import { createMCPClient } from './mcp-client.js'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { chromium } from '@xmorse/playwright-core'
import { getCDPSessionForPage } from './cdp-session.js'
import { getCdpUrl } from './utils.js'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import {
  setupTestContext,
  cleanupTestContext,
  getExtensionServiceWorker,
  type TestContext,
  withTimeout,
  js,
  tryJsonParse,
  createSimpleServer,
  safeCloseCDPBrowser,
} from './test-utils.js'
import './test-declarations.js'

const TEST_PORT = 19987
const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`
const JSON_HEADERS = { 'Content-Type': 'application/json' }

describe('Relay Core Tests', () => {
  let client: Awaited<ReturnType<typeof createMCPClient>>['client']
  let cleanup: (() => Promise<void>) | null = null
  let testCtx: TestContext | null = null

  beforeAll(async () => {
    testCtx = await setupTestContext({ port: TEST_PORT, tempDirPrefix: 'pw-test-', toggleExtension: true })

    const result = await createMCPClient({ port: TEST_PORT })
    client = result.client
    cleanup = result.cleanup
  }, 600000)

  afterAll(async () => {
    await cleanupTestContext(testCtx, cleanup)
    cleanup = null
    testCtx = null
  })

  const getBrowserContext = () => {
    if (!testCtx?.browserContext) throw new Error('Browser not initialized')
    return testCtx.browserContext
  }

  const getCdpLogger = () => {
    if (!testCtx?.cdpLogger) throw new Error('Relay not initialized')
    return testCtx.cdpLogger
  }

  const ensureConnectedTabForExecute = async (): Promise<void> => {
    const browserContext = getBrowserContext()
    const serviceWorker = await getExtensionServiceWorker(browserContext)
    const connectedTabCount = await serviceWorker.evaluate(async () => {
      const state = globalThis.getExtensionState()
      return state.tabs.size
    })
    if (connectedTabCount > 0) {
      return
    }

    const page = await browserContext.newPage()
    await page.goto('about:blank')
    await page.bringToFront()

    await serviceWorker.evaluate(async () => {
      await globalThis.toggleExtensionForActiveTab()
    })

    await new Promise((r) => {
      setTimeout(r, 100)
    })
  }

  it('should inject script via addScriptTag through CDP relay', async () => {
    const browserContext = getBrowserContext()
    const serviceWorker = await withTimeout({
      promise: getExtensionServiceWorker(browserContext),
      timeoutMs: 5000,
      errorMessage: 'Timed out waiting for extension service worker for iframe test',
    })

    const page = await browserContext.newPage()
    const html = '<html><body><button id="btn">Click</button></body></html>'
    const dataUrl = `data:text/html,${encodeURIComponent(html)}`
    await page.goto(dataUrl)
    await page.bringToFront()

    await withTimeout({
      promise: serviceWorker.evaluate(async () => {
        await globalThis.toggleExtensionForActiveTab()
      }),
      timeoutMs: 10000,
      errorMessage: 'Timed out toggling extension for active tab',
    })
    await new Promise((r) => {
      setTimeout(r, 100)
    })

    const cdpSession = await withTimeout({
      promise: getCDPSessionForPage({ page }),
      timeoutMs: 10000,
      errorMessage: 'Timed out creating CDP session for page',
    })

    const hasGlobalBefore = await page.evaluate(() => {
      return Boolean((globalThis as { __testGlobal?: unknown }).__testGlobal)
    })
    expect(hasGlobalBefore).toBe(false)

    await withTimeout({
      promise: (async () => {
        await cdpSession.send('Page.enable')
        await cdpSession.send('Page.addScriptToEvaluateOnNewDocument', {
          source: 'globalThis.__testGlobal = { foo: "bar" }',
        })
        await page.reload({ waitUntil: 'domcontentloaded' })
      })(),
      timeoutMs: 10000,
      errorMessage: 'Timed out injecting script via CDP session',
    })

    const hasGlobalAfter = await page.evaluate(() => {
      return (globalThis as { __testGlobal?: unknown }).__testGlobal
    })
    expect(hasGlobalAfter).toEqual({ foo: 'bar' })

    await cdpSession.detach()
    await page.close()
  }, 60000)

  it('should emit download events for both Browser and Page domains in extension mode', async () => {
    const browserContext = getBrowserContext()
    const serviceWorker = await getExtensionServiceWorker(browserContext)
    const cdpLogger = getCdpLogger()
    const logFilePath = cdpLogger.logFilePath
    await cdpLogger.flush()
    const logLineCountBefore = fs.existsSync(logFilePath)
      ? fs
          .readFileSync(logFilePath, 'utf-8')
          .split('\n')
          .filter((line) => {
            return line.trim().length > 0
          }).length
      : 0

    const server = await createSimpleServer({
      routes: {
        '/': `<!doctype html>
<html>
  <body>
    <button id="download-button">Download</button>
    <script>
      const button = document.getElementById('download-button');
      button.addEventListener('click', () => {
        const blob = new Blob(['playwriter-download-test'], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'playwriter-download-test.txt';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => {
          URL.revokeObjectURL(url);
        }, 1000);
      });
    </script>
  </body>
</html>`,
      },
    })

    const page = await browserContext.newPage()
    await page.goto(server.baseUrl, { waitUntil: 'domcontentloaded' })
    await page.bringToFront()

    await serviceWorker.evaluate(async () => {
      await globalThis.toggleExtensionForActiveTab()
    })

    const directBrowser = await withTimeout({
      promise: chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT })),
      timeoutMs: 10000,
      errorMessage: 'Timed out connecting over CDP for download reproduction test',
    })

    const connectedPage = directBrowser
      .contexts()[0]
      .pages()
      .find((candidatePage) => {
        return candidatePage.url() === server.baseUrl + '/'
      })
    if (!connectedPage) {
      throw new Error('Connected page not found for download reproduction test')
    }

    const downloadResult = await Promise.all([
      connectedPage.waitForEvent('download', { timeout: 3000 }).then(
        (download) => {
          return { timedOut: false, suggestedFilename: download.suggestedFilename() }
        },
        (error: Error) => {
          return { timedOut: true, errorMessage: error.message }
        },
      ),
      connectedPage.click('#download-button'),
    ])

    expect(downloadResult[0]).toMatchInlineSnapshot(`
      {
        "suggestedFilename": "playwriter-download-test.txt",
        "timedOut": false,
      }
    `)

    await directBrowser.close()
    await page.close()
    await server.close()

    // The logger batches writes every 500ms, so what crossed the relay is only all on disk
    // once it has been drained.
    await cdpLogger.flush()
    const logLinesAfter = fs
      .readFileSync(logFilePath, 'utf-8')
      .split('\n')
      .filter((line) => {
        return line.trim().length > 0
      })
      .slice(logLineCountBefore)

    const newEntries = logLinesAfter
      .map((line) => {
        return tryJsonParse(line)
      })
      .filter((entry): entry is { direction: string; message: { method?: string } } => {
        return Boolean(entry && typeof entry === 'object' && 'direction' in entry && 'message' in entry)
      })

    const methods = newEntries
      .map((entry) => {
        return {
          direction: entry.direction,
          method: typeof entry.message?.method === 'string' ? entry.message.method : 'response',
        }
      })
      .filter((entry) => {
        return (
          entry.method.includes('download') ||
          entry.method === 'Browser.setDownloadBehavior' ||
          entry.method === 'Page.setDownloadBehavior'
        )
      })

    const summary = {
      hasBrowserSetDownloadBehavior: methods.some((entry) => {
        return entry.direction === 'from-playwright' && entry.method === 'Browser.setDownloadBehavior'
      }),
      // False on purpose. Chrome answers every Page.setDownloadBehavior variant on an
      // extension-owned tab session with "Cannot not access browser-level commands", and
      // does not expose Browser.setDownloadBehavior there at all, so the relay keeps the
      // path Playwright asked for and copies the finished file into it instead.
      hasPageSetDownloadBehavior: methods.some((entry) => {
        return entry.direction === 'to-extension' && entry.method === 'Page.setDownloadBehavior'
      }),
      hasPageDownloadWillBegin: methods.some((entry) => {
        return entry.method === 'Page.downloadWillBegin'
      }),
      hasPageDownloadProgress: methods.some((entry) => {
        return entry.method === 'Page.downloadProgress'
      }),
      hasBrowserDownloadWillBegin: methods.some((entry) => {
        return entry.method === 'Browser.downloadWillBegin'
      }),
      hasBrowserDownloadProgress: methods.some((entry) => {
        return entry.method === 'Browser.downloadProgress'
      }),
    }

    expect(summary).toMatchInlineSnapshot(`
      {
        "hasBrowserDownloadProgress": true,
        "hasBrowserDownloadWillBegin": true,
        "hasBrowserSetDownloadBehavior": true,
        "hasPageDownloadProgress": true,
        "hasPageDownloadWillBegin": true,
        "hasPageSetDownloadBehavior": false,
      }
    `)
  }, 120000)

  it('should save a download twice from one URL without reusing the earlier file', async () => {
    const browserContext = getBrowserContext()
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    // One stable export URL that answers with different bytes each time, which is what
    // makes an old download indistinguishable from the new one by URL alone.
    let exportCount = 0
    const server = await createSimpleServer({
      routes: {
        '/export.txt': () => {
          exportCount += 1
          return `export-body-${exportCount}`
        },
        '/': `<!doctype html>
<html>
  <body>
    <a id="download-link" href="/export.txt" download="export.txt">Download</a>
  </body>
</html>`,
      },
    })

    const page = await browserContext.newPage()
    await page.goto(server.baseUrl, { waitUntil: 'domcontentloaded' })
    await page.bringToFront()

    await serviceWorker.evaluate(async () => {
      await globalThis.toggleExtensionForActiveTab()
    })

    const directBrowser = await withTimeout({
      promise: chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT })),
      timeoutMs: 10000,
      errorMessage: 'Timed out connecting over CDP for download saveAs test',
    })

    const connectedPage = directBrowser
      .contexts()[0]
      .pages()
      .find((candidatePage) => {
        return candidatePage.url() === server.baseUrl + '/'
      })
    if (!connectedPage) {
      throw new Error('Connected page not found for download saveAs test')
    }

    const saveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-saveas-'))
    const saveDownload = async (destination: string): Promise<void> => {
      const [download] = await Promise.all([
        connectedPage.waitForEvent('download', { timeout: 5000 }),
        connectedPage.click('#download-link'),
      ])
      await download.saveAs(destination)
    }

    const firstPath = path.join(saveDir, 'first.txt')
    const secondPath = path.join(saveDir, 'second.txt')
    await saveDownload(firstPath)
    await saveDownload(secondPath)

    // Matching the finished download by URL would answer the second download with the
    // first download's file, so the second save would read export-body-1 again.
    expect(fs.readFileSync(firstPath, 'utf8')).toBe('export-body-1')
    expect(fs.readFileSync(secondPath, 'utf8')).toBe('export-body-2')

    fs.rmSync(saveDir, { recursive: true, force: true })
    await safeCloseCDPBrowser(directBrowser)
    await page.close()
    await server.close()
  }, 120000)

  it('should not save the bytes of an unrelated in-progress download of the same URL', async () => {
    const browserContext = getBrowserContext()
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    // One stable export URL, the way a real export endpoint is stable. The first request is
    // answered with headers and one chunk and then held open, so that download is still
    // running while the second one happens: being in progress is the freshness that must not
    // be mistaken for being ours.
    let exportRequests = 0
    const heldResponses: http.ServerResponse[] = []
    const server = await createSimpleServer({
      routes: {
        '/export.txt': {
          handle: (_req, res) => {
            exportRequests += 1
            res.writeHead(200, {
              'Content-Type': 'application/octet-stream',
              'Content-Disposition': 'attachment; filename="export.txt"',
              'Cache-Control': 'no-store',
            })
            if (exportRequests === 1) {
              res.write('unrelated-body')
              heldResponses.push(res)
              return
            }
            res.end('attached-body')
          },
        },
        '/': `<!doctype html>
<html>
  <body>
    <a id="download-link" href="/export.txt" download="export.txt">Download</a>
  </body>
</html>`,
      },
    })

    const exportUrl = `${server.baseUrl}/export.txt`
    let directBrowser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null = null
    const strangerPage = await browserContext.newPage()
    const page = await browserContext.newPage()

    try {
      // A tab the extension is not attached to starts the first download. Chrome reports it
      // to the extension anyway, with a DownloadItem that names no tab.
      await strangerPage.goto(server.baseUrl, { waitUntil: 'domcontentloaded' })
      await strangerPage.click('#download-link')

      const waitForStranger = async (): Promise<number> => {
        return await serviceWorker.evaluate(async (url) => {
          for (let attempt = 0; attempt < 100; attempt++) {
            const items = await (globalThis as any).chrome.downloads.search({})
            const running = items.filter((item: any) => {
              return (item.url === url || item.finalUrl === url) && item.state === 'in_progress'
            })
            if (running.length > 0) {
              return running.length
            }
            await new Promise((r) => setTimeout(r, 100))
          }
          return 0
        }, exportUrl)
      }
      expect(await waitForStranger()).toBeGreaterThan(0)

      // Only now does the attached page download the same URL.
      await page.goto(server.baseUrl, { waitUntil: 'domcontentloaded' })
      await page.bringToFront()
      await serviceWorker.evaluate(async () => {
        await globalThis.toggleExtensionForActiveTab()
      })

      directBrowser = await withTimeout({
        promise: chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT })),
        timeoutMs: 10000,
        errorMessage: 'Timed out connecting over CDP for concurrent download test',
      })

      const connectedPage = directBrowser
        .contexts()[0]
        .pages()
        .find((candidatePage) => {
          return candidatePage.url() === server.baseUrl + '/'
        })
      if (!connectedPage) {
        throw new Error('Connected page not found for concurrent download test')
      }

      const saveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-concurrent-'))
      const savedPath = path.join(saveDir, 'attached.txt')
      const [download] = await Promise.all([
        connectedPage.waitForEvent('download', { timeout: 5000 }),
        connectedPage.click('#download-link'),
      ])

      // The unrelated download was the only one of this URL Chrome had running when this
      // one began, which is what makes it adoptable.
      expect(await waitForStranger()).toBeGreaterThan(0)
      // Release it now, while a wrong binding would still be waiting for a file: adopting
      // it writes unrelated-body here instead of failing visibly.
      for (const response of heldResponses) {
        response.end('-tail')
      }
      await download.saveAs(savedPath)

      expect(fs.readFileSync(savedPath, 'utf8')).toBe('attached-body')

      fs.rmSync(saveDir, { recursive: true, force: true })
    } finally {
      for (const response of heldResponses) {
        response.destroy()
      }
      if (directBrowser) {
        await safeCloseCDPBrowser(directBrowser)
      }
      await page.close()
      await strangerPage.close()
      await server.close()
    }
  }, 120000)

  it('should ignore duplicate dialog dismissals from multiple CDP clients', async () => {
    const browserContext = getBrowserContext()
    const serviceWorker = await getExtensionServiceWorker(browserContext)
    const logFilePath = `${process.cwd()}/relay-server.log`
    const logLineCountBefore = fs.existsSync(logFilePath)
      ? fs
          .readFileSync(logFilePath, 'utf-8')
          .split('\n')
          .filter((line) => {
            return line.trim().length > 0
          }).length
      : 0

    const server = await createSimpleServer({
      routes: {
        '/': `<!doctype html>
<html>
  <body>
    <button id="open-dialog">Open dialog</button>
    <script>
      document.getElementById('open-dialog').addEventListener('click', () => {
        alert('shared dialog')
      })
    </script>
  </body>
</html>`,
      },
    })

    const page = await browserContext.newPage()
    let browserA: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null = null
    let browserB: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null = null

    try {
      await page.goto(server.baseUrl, { waitUntil: 'domcontentloaded' })
      await page.bringToFront()

      await serviceWorker.evaluate(async () => {
        await globalThis.toggleExtensionForActiveTab()
      })

      await new Promise((r) => {
        setTimeout(r, 100)
      })

      browserA = await withTimeout({
        promise: chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT })),
        timeoutMs: 10000,
        errorMessage: 'Timed out connecting first CDP client for dialog test',
      })
      browserB = await withTimeout({
        promise: chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT })),
        timeoutMs: 10000,
        errorMessage: 'Timed out connecting second CDP client for dialog test',
      })

      const getConnectedPage = (browser: Awaited<ReturnType<typeof chromium.connectOverCDP>>) => {
        return browser
          .contexts()[0]
          ?.pages()
          .find((candidatePage) => {
            return candidatePage.url() === server.baseUrl + '/'
          })
      }

      const connectedPageA = getConnectedPage(browserA)
      const connectedPageB = getConnectedPage(browserB)

      expect(connectedPageA).toBeDefined()
      expect(connectedPageB).toBeDefined()

      await withTimeout({
        promise: connectedPageA!.click('#open-dialog'),
        timeoutMs: 5000,
        errorMessage: 'Timed out opening dialog with first CDP client',
      })

      const secondClientResult = await withTimeout({
        promise: connectedPageB!.evaluate(() => {
          return 2 + 2
        }),
        timeoutMs: 5000,
        errorMessage: 'Second CDP client stopped responding after shared dialog dismissal',
      })

      expect(secondClientResult).toBe(4)

      await new Promise((r) => {
        setTimeout(r, 200)
      })
    } finally {
      if (browserA) {
        await safeCloseCDPBrowser(browserA)
      }
      if (browserB) {
        await safeCloseCDPBrowser(browserB)
      }
      await page.close()
      await server.close()
    }

    const logLinesAfter = fs
      .readFileSync(logFilePath, 'utf-8')
      .split('\n')
      .filter((line) => {
        return line.trim().length > 0
      })
      .slice(logLineCountBefore)

    const unexpectedRelayCrashes = logLinesAfter.filter((line) => {
      return line.includes('Unhandled Rejection:')
    })

    expect(unexpectedRelayCrashes).toEqual([])
  }, 60000)

  it('should execute code and capture console output', async () => {
    await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          const newPage = await context.newPage();
          state.page = newPage;
          if (!state.pages) state.pages = [];
          state.pages.push(newPage);
        `,
      },
    })

    const result = await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          await state.page.goto('https://example.com');
          const title = await state.page.title();
          console.log('Page title:', title);
          return { url: state.page.url(), title };
        `,
      },
    })
    expect(result.content).toMatchInlineSnapshot(`
          [
            {
              "text": "Console output:
          [log] Page title: Example Domain

          [return value] { url: 'https://example.com/', title: 'Example Domain' }",
              "type": "text",
            },
          ]
        `)
    expect(result.content).toBeDefined()
  }, 30000)

  // Repro test for https://github.com/remorses/playwriter/issues/66.
  // Current limitation: extension-mode routing does not support root-session
  // Storage.getCookies in playwriter. MUST use Network.getCookies via page CDP
  // session instead (see test below), so this repro stays skipped.
  it.skip('should reproduce page.route failure in MCP execute path (issue #66)', async () => {
    const server = await createSimpleServer({
      routes: {
        '/': '<!doctype html><html><body>route issue repro</body></html>',
        '/api/data': '{"ok":true}',
      },
    })

    try {
      const result = await client.callTool({
        name: 'execute',
        arguments: {
          code: js`
            const newPage = await context.newPage();
            state.issue66Page = newPage;
            await newPage.goto('${server.baseUrl}', { waitUntil: 'domcontentloaded' });

            let routeFetchError = null;
            await newPage.route('**/api/**', async (route) => {
              try {
                const response = await route.fetch();
                await route.fulfill({ response });
              } catch (error) {
                routeFetchError = error instanceof Error ? error.message : String(error);
                await route.abort();
              }
            });

            await newPage.evaluate(async () => {
              await fetch('/api/data').catch(() => null);
            });

            return { routeFetchError };
          `,
        },
      })

      const resultWithContent = result as { content?: unknown }
      const content = Array.isArray(resultWithContent.content) ? resultWithContent.content : []
      const firstContent = content[0]
      const output =
        typeof firstContent === 'object' && firstContent !== null && 'text' in firstContent
          ? String((firstContent as { text?: unknown }).text ?? '')
          : ''
      expect(output).toContain('routeFetchError')
      expect(output).toContain('Storage.getCookies')
      expect(output).toContain('No tab found for method Storage.getCookies')
    } finally {
      try {
        await client.callTool({
          name: 'execute',
          arguments: {
            code: js`
              if (state.issue66Page && !state.issue66Page.isClosed()) {
                await state.issue66Page.close();
              }
              delete state.issue66Page;
            `,
          },
        })
      } catch {
        // Ignore cleanup failure if MCP disconnected due to the repro.
      }
      await server.close()
    }
  }, 30000)

  it('should read cookies via Network.getCookies through page CDP session', async () => {
    const browserContext = getBrowserContext()
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    const server = await createSimpleServer({
      routes: {
        '/': '<!doctype html><html><body>cookies test</body></html>',
      },
    })

    const page = await browserContext.newPage()
    try {
      await page.goto(server.baseUrl, { waitUntil: 'domcontentloaded' })
      await page.bringToFront()

      await serviceWorker.evaluate(async () => {
        await globalThis.toggleExtensionForActiveTab()
      })

      await new Promise((r) => {
        setTimeout(r, 200)
      })

      await page.evaluate(() => {
        document.cookie = 'issue66=ok; path=/'
      })

      const cdpSession = await getCDPSessionForPage({ page })
      const cookiesResult = await cdpSession.send('Network.getCookies', { urls: [page.url()] })
      const cookie = cookiesResult.cookies.find((value) => {
        return value.name === 'issue66'
      })
      expect(cookie?.value).toBe('ok')
    } finally {
      await page.close()
      await server.close()
    }
  }, 30000)

  it('should show extension as connected for pages created via newPage()', async () => {
    const browserContext = getBrowserContext()
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    // Create a page via MCP (which uses context.newPage())
    await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          const newPage = await context.newPage();
          state.testPage = newPage;
          await newPage.goto('https://example.com/mcp-test');
          return newPage.url();
        `,
      },
    })

    // Get extension state to verify the page is marked as connected
    const extensionState = await serviceWorker.evaluate(async () => {
      const state = globalThis.getExtensionState()
      const tabs = await chrome.tabs.query({})
      const testTab = tabs.find((t: any) => t.url?.includes('mcp-test'))
      return {
        connected: !!testTab && !!testTab.id && state.tabs.has(testTab.id),
        tabId: testTab?.id,
        tabInfo: testTab?.id ? state.tabs.get(testTab.id) : null,
        connectionState: state.connectionState,
      }
    })

    expect(extensionState.connected).toBe(true)
    expect(extensionState.tabInfo?.state).toBe('connected')
    expect(extensionState.connectionState).toBe('connected')

    // Clean up
    await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          if (state.testPage) {
            await state.testPage.close();
            delete state.testPage;
          }
        `,
      },
    })
  }, 30000)

  const snapshotTestCases = [
    {
      name: 'hacker-news',
      url: 'https://news.ycombinator.com/item?id=1',
      expectedContent: ['role=link', 'Hacker News'],
      waitForCode: js`
        await state.page.locator('a[href="news"]').first().waitFor({ timeout: 10000 });
        await state.page.locator('a.hnuser').first().waitFor({ timeout: 10000 });
      `,
    },
    {
      name: 'shadcn-ui',
      url: 'https://ui.shadcn.com/',
      expectedContent: ['shadcn'],
      waitForCode: js`
        await state.page.locator('text=shadcn/ui').first().waitFor({ timeout: 10000 });
      `,
    },
  ]

  for (const testCase of snapshotTestCases) {
    it(`should get accessibility snapshot of ${testCase.name}`, async () => {
      await client.callTool({
        name: 'execute',
        arguments: {
          code: js`
              const newPage = await context.newPage();
              state.page = newPage;
              if (!state.pages) state.pages = [];
              state.pages.push(newPage);
            `,
        },
      })

      // Capture interactiveOnly=true snapshot (default)
      const interactiveResult = await client.callTool({
        name: 'execute',
        arguments: {
          code: js`
              // External pages can expose a partial AX tree right after domcontentloaded,
              // so wait for stable page-specific content before snapshotting.
              await state.page.goto('${testCase.url}', { waitUntil: 'domcontentloaded' });
              ${testCase.waitForCode}
              const snap = await snapshot({ page: state.page, showDiffSinceLastCall: false, interactiveOnly: true });
              return snap;
            `,
        },
      })

      const interactiveData =
        typeof interactiveResult === 'object' && interactiveResult.content?.[0]?.text
          ? tryJsonParse(interactiveResult.content[0].text)
          : interactiveResult
      await expect(interactiveData).toMatchFileSnapshot(`snapshots/${testCase.name}-accessibility-interactive.md`)
      expect(interactiveResult.content).toBeDefined()
      for (const expected of testCase.expectedContent) {
        expect(interactiveData).toContain(expected)
      }

      // Capture interactiveOnly=false snapshot (full tree)
      const fullResult = await client.callTool({
        name: 'execute',
        arguments: {
          code: js`
              const snap = await snapshot({ page: state.page, showDiffSinceLastCall: false, interactiveOnly: false });
              return snap;
            `,
        },
      })

      const fullData =
        typeof fullResult === 'object' && fullResult.content?.[0]?.text
          ? tryJsonParse(fullResult.content[0].text)
          : fullResult
      await expect(fullData).toMatchFileSnapshot(`snapshots/${testCase.name}-accessibility-full.md`)
      expect(fullResult.content).toBeDefined()
      for (const expected of testCase.expectedContent) {
        expect(fullData).toContain(expected)
      }
    }, 60000)
  }

  it('should close all created pages', async () => {
    const result = await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          if (state.pages && state.pages.length > 0) {
            for (const page of state.pages) {
              await page.close();
            }
            const closedCount = state.pages.length;
            state.pages = [];
            return { closedCount };
          }
          return { closedCount: 0 };
        `,
      },
    })
  })

  it('should capture browser console logs with getLatestLogs', async () => {
    // Ensure clean state and clear any existing logs
    const resetResult = await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          // Clear any existing logs from previous tests
          clearAllLogs();
          console.log('Cleared all existing logs');

          // Verify connection is working
          const pages = context.pages();
          console.log('Current pages count:', pages.length);

          return { success: true, pagesCount: pages.length };
        `,
      },
    })
    console.log('Cleanup result:', resetResult)

    // Create a new page for this test
    await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          const newPage = await context.newPage();
          state.testLogPage = newPage;
          await newPage.goto('about:blank');
        `,
      },
    })

    // Generate some console logs in the browser
    await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          await state.testLogPage.evaluate(() => {
            console.log('Test log 12345');
            console.error('Test error 67890');
            console.warn('Test warning 11111');
            console.log('Test log 2 with', { data: 'object' });
            setTimeout(() => { throw new Error('Test pageerror 22222'); }, 0);
          });
          // Wait for logs to be captured
          await new Promise(resolve => setTimeout(resolve, 100));
        `,
      },
    })

    // Test getting all logs
    const allLogsResult = await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          const logs = await getLatestLogs();
          logs.forEach(log => console.log(log));
        `,
      },
    })

    const output = (allLogsResult as any).content[0].text
    expect(output).toContain('[log] Test log 12345')
    expect(output).toContain('[error] Test error 67890')
    expect(output).toContain('[warning] Test warning 11111')
    expect(output).toContain('[pageerror] Test pageerror 22222')

    // Test filtering by search string
    const errorLogsResult = await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          const logs = await getLatestLogs({ search: 'error' });
          logs.forEach(log => console.log(log));
        `,
      },
    })

    const errorOutput = (errorLogsResult as any).content[0].text
    expect(errorOutput).toContain('[error] Test error 67890')
    // With context lines (5 above/below), nearby logs are also included
    expect(errorOutput).toContain('[log] Test log 12345')

    // Test that logs persist across page reload
    await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          // First add a log before reload
          await state.testLogPage.evaluate(() => {
            console.log('Before reload 99999');
          });
          await new Promise(resolve => setTimeout(resolve, 100));
        `,
      },
    })

    // Verify the log exists
    const beforeReloadResult = await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          const logs = await getLatestLogs({ page: state.testLogPage });
          console.log('Logs before reload:', logs.length);
          logs.forEach(log => console.log(log));
        `,
      },
    })

    const beforeReloadOutput = (beforeReloadResult as any).content[0].text
    expect(beforeReloadOutput).toContain('[log] Before reload 99999')

    // Reload the page
    await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          await state.testLogPage.reload();
          await state.testLogPage.evaluate(() => {
            console.log('After reload 88888');
          });
          await new Promise(resolve => setTimeout(resolve, 100));
        `,
      },
    })

    // Check logs after reload - old logs persist (no longer cleared on navigation)
    // so both pre- and post-reload logs are present. Use sinceLastCall to get
    // only new logs if needed.
    const afterReloadResult = await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          const logs = await getLatestLogs({ page: state.testLogPage });
          console.log('Logs after reload:', logs.length);
          logs.forEach(log => console.log(log));
        `,
      },
    })

    const afterReloadOutput = (afterReloadResult as any).content[0].text
    expect(afterReloadOutput).toContain('[log] After reload 88888')
    expect(afterReloadOutput).toContain('[log] Before reload 99999')

    // Clean up
    await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          await state.testLogPage.close();
          delete state.testLogPage;
        `,
      },
    })
  }, 30000)

  it('should include uncaught errors from only the CLI session tracked page', async () => {
    const browserContext = getBrowserContext()
    const serviceWorker = await getExtensionServiceWorker(browserContext)
    const pageA = await browserContext.newPage()
    const pageB = await browserContext.newPage()

    const createCliSession = async (): Promise<string> => {
      const response = await fetch(`${SERVER_URL}/cli/session/new`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({}),
      })
      const result = (await response.json()) as { id: string }
      return result.id
    }
    const executeCli = async ({ sessionId, code }: { sessionId: string; code: string }) => {
      const response = await fetch(`${SERVER_URL}/cli/execute`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ sessionId, code }),
      })
      return (await response.json()) as { text: string; isError: boolean }
    }

    let sessionA = ''
    let sessionB = ''
    try {
      await pageA.goto('data:text/html,<title>tracked-agent-a</title>')
      await pageA.bringToFront()
      await serviceWorker.evaluate(async () => {
        await globalThis.toggleExtensionForActiveTab()
      })
      await pageB.goto('data:text/html,<title>tracked-agent-b</title>')
      await pageB.bringToFront()
      await serviceWorker.evaluate(async () => {
        await globalThis.toggleExtensionForActiveTab()
      })

      sessionA = await createCliSession()
      sessionB = await createCliSession()
      await executeCli({
        sessionId: sessionA,
        code: `state.page = context.pages().find((page) => page.url().includes('tracked-agent-a'))`,
      })
      await executeCli({
        sessionId: sessionB,
        code: `state.page = context.pages().find((page) => page.url().includes('tracked-agent-b')); state.pageError = state.page.waitForEvent('pageerror')`,
      })

      const sessionAResult = await executeCli({
        sessionId: sessionA,
        code: js`
          const otherPage = context.pages().find((page) => page.url().includes('tracked-agent-b'));
          const pageError = state.page.waitForEvent('pageerror');
          await state.page.evaluate(() => setTimeout(() => { throw new Error('tracked-agent-a-error'); }, 0));
          await otherPage.evaluate(() => setTimeout(() => { throw new Error('tracked-agent-b-error'); }, 0));
          await pageError;
        `,
      })
      expect(sessionAResult.text).toContain('[PAGE ERROR] tracked-agent-a-error')
      expect(sessionAResult.text).not.toContain('tracked-agent-b-error')
      expect(sessionAResult.isError).toBe(false)

      const sessionBResult = await executeCli({
        sessionId: sessionB,
        code: 'await state.pageError; return state.page.url()',
      })
      expect(sessionBResult.text).toContain('[PAGE ERROR] tracked-agent-b-error')
      expect(sessionBResult.text).not.toContain('tracked-agent-a-error')
      expect(sessionBResult.isError).toBe(false)
    } finally {
      await Promise.all([pageA.close(), pageB.close()])
      await Promise.all(
        [sessionA, sessionB].filter(Boolean).map(async (sessionId) => {
          await fetch(`${SERVER_URL}/cli/session/delete`, {
            method: 'POST',
            headers: JSON_HEADERS,
            body: JSON.stringify({ sessionId }),
          })
        }),
      )
    }
  }, 30000)

  it('should keep logs separate between different pages', async () => {
    // Clear any existing logs from previous tests
    await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          clearAllLogs();
          console.log('Cleared all existing logs for second log test');
        `,
      },
    })

    // Create two pages
    await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          state.pageA = await context.newPage();
          state.pageB = await context.newPage();
          await state.pageA.goto('about:blank');
          await state.pageB.goto('about:blank');
        `,
      },
    })

    // Generate logs in page A
    await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          await state.pageA.evaluate(() => {
            console.log('PageA log 11111');
            console.error('PageA error 22222');
          });
          await new Promise(resolve => setTimeout(resolve, 100));
        `,
      },
    })

    // Generate logs in page B
    await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          await state.pageB.evaluate(() => {
            console.log('PageB log 33333');
            console.error('PageB error 44444');
          });
          await new Promise(resolve => setTimeout(resolve, 100));
        `,
      },
    })

    // Check logs for page A - should only have page A logs
    const pageALogsResult = await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          const logs = await getLatestLogs({ page: state.pageA });
          console.log('Page A logs:', logs.length);
          logs.forEach(log => console.log(log));
        `,
      },
    })

    const pageAOutput = (pageALogsResult as any).content[0].text
    expect(pageAOutput).toContain('[log] PageA log 11111')
    expect(pageAOutput).toContain('[error] PageA error 22222')
    expect(pageAOutput).not.toContain('PageB')

    // Check logs for page B - should only have page B logs
    const pageBLogsResult = await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          const logs = await getLatestLogs({ page: state.pageB });
          console.log('Page B logs:', logs.length);
          logs.forEach(log => console.log(log));
        `,
      },
    })

    const pageBOutput = (pageBLogsResult as any).content[0].text
    expect(pageBOutput).toContain('[log] PageB log 33333')
    expect(pageBOutput).toContain('[error] PageB error 44444')
    expect(pageBOutput).not.toContain('PageA')

    // Check all logs - should have logs from both pages
    const allLogsResult = await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          const logs = await getLatestLogs();
          console.log('All logs:', logs.length);
          logs.forEach(log => console.log(log));
        `,
      },
    })

    const allOutput = (allLogsResult as any).content[0].text
    expect(allOutput).toContain('[log] PageA log 11111')
    expect(allOutput).toContain('[log] PageB log 33333')

    // Test that reloading page A preserves logs (no longer cleared on navigation)
    await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          await state.pageA.reload();
          await state.pageA.evaluate(() => {
            console.log('PageA after reload 55555');
          });
          await new Promise(resolve => setTimeout(resolve, 100));
        `,
      },
    })

    // Check page A logs - logs persist across navigation, so both old and new are present
    const pageAAfterReloadResult = await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          const logs = await getLatestLogs({ page: state.pageA });
          console.log('Page A logs after reload:', logs.length);
          logs.forEach(log => console.log(log));
        `,
      },
    })

    const pageAAfterReloadOutput = (pageAAfterReloadResult as any).content[0].text
    expect(pageAAfterReloadOutput).toContain('[log] PageA after reload 55555')
    expect(pageAAfterReloadOutput).toContain('[log] PageA log 11111')

    // Check page B logs - should still have original logs
    const pageBAfterAReloadResult = await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          const logs = await getLatestLogs({ page: state.pageB });
          console.log('Page B logs after A reload:', logs.length);
          logs.forEach(log => console.log(log));
        `,
      },
    })

    const pageBAfterAReloadOutput = (pageBAfterAReloadResult as any).content[0].text
    expect(pageBAfterAReloadOutput).toContain('[log] PageB log 33333')
    expect(pageBAfterAReloadOutput).toContain('[error] PageB error 44444')

    // Test that logs are deleted when page is closed
    await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          // Close page A
          await state.pageA.close();
          await new Promise(resolve => setTimeout(resolve, 100));
        `,
      },
    })

    // Check all logs - page A logs should be gone
    const logsAfterCloseResult = await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          const logs = await getLatestLogs();
          console.log('All logs after closing page A:', logs.length);
          logs.forEach(log => console.log(log));
        `,
      },
    })

    const logsAfterCloseOutput = (logsAfterCloseResult as any).content[0].text
    expect(logsAfterCloseOutput).not.toContain('PageA')
    expect(logsAfterCloseOutput).toContain('[log] PageB log 33333')

    // Clean up remaining page
    await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          await state.pageB.close();
          delete state.pageA;
          delete state.pageB;
        `,
      },
    })
  }, 30000)

  it('should capture console logs from cross-origin iframes', async () => {
    // Two servers on different ports = different origins
    const iframeServer = await createSimpleServer({
      routes: {
        '/iframe.html': `<!doctype html><html><body>
          <script>
            console.log('iframe-log-ALPHA');
            console.error('iframe-error-BETA');
            console.warn('iframe-warn-GAMMA');
          </script>
          <p>cross-origin iframe</p>
        </body></html>`,
      },
    })

    const parentServer = await createSimpleServer({
      routes: {
        '/': `<!doctype html><html><body>
          <script>console.log('parent-log-DELTA');</script>
          <iframe src="${iframeServer.baseUrl}/iframe.html"></iframe>
        </body></html>`,
      },
    })

    try {
      // Clear logs and navigate to the parent page with cross-origin iframe
      await client.callTool({
        name: 'execute',
        arguments: {
          code: js`
            clearAllLogs();
            state.iframePage = await context.newPage();
            await state.iframePage.goto('${parentServer.baseUrl}', { waitUntil: 'networkidle' });
            // Wait for iframe to load and logs to be captured
            await state.iframePage.frameLocator('iframe').locator('p').waitFor({ timeout: 5000 });
            await new Promise(resolve => setTimeout(resolve, 500));
          `,
        },
      })

      // Retrieve logs and verify both parent and iframe logs are captured
      const logsResult = await client.callTool({
        name: 'execute',
        arguments: {
          code: js`
            const logs = await getLatestLogs({ page: state.iframePage });
            console.log('Cross-origin iframe logs count:', logs.length);
            logs.forEach(log => console.log(log));
          `,
        },
      })

      const output = (logsResult as any).content[0].text
      // Parent page log
      expect(output).toContain('parent-log-DELTA')
      // Cross-origin iframe logs
      expect(output).toContain('iframe-log-ALPHA')
      expect(output).toContain('iframe-error-BETA')
      expect(output).toContain('iframe-warn-GAMMA')

      // Clean up
      await client.callTool({
        name: 'execute',
        arguments: {
          code: js`
            await state.iframePage.close();
            delete state.iframePage;
          `,
        },
      })
    } finally {
      await Promise.all([parentServer.close(), iframeServer.close()])
    }
  }, 60000)

  it(
    'should preserve system color scheme instead of forcing light mode',
    async () => {
      const browserContext = getBrowserContext()
      const serviceWorker = await getExtensionServiceWorker(browserContext)

      const page = await browserContext.newPage()
      await page.goto('https://example.com')
      await page.bringToFront()

      // test-utils launches with colorScheme: 'dark', so before MCP connection
      // the browser should report dark mode
      const colorSchemeBefore = await page.evaluate(() => {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      })
      expect(colorSchemeBefore).toBe('dark')

      await serviceWorker.evaluate(async () => {
        await globalThis.toggleExtensionForActiveTab()
      })
      await new Promise((r) => setTimeout(r, 500))

      const result = await client.callTool({
        name: 'execute',
        arguments: {
          code: js`
                    const pages = context.pages();
                    const urls = pages.map(p => p.url());
                    const targetPage = pages.find(p => p.url().includes('example.com'));
                    if (!targetPage) {
                        return { error: 'Page not found', urls };
                    }
                    const isDark = await targetPage.evaluate(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
                    const isLight = await targetPage.evaluate(() => window.matchMedia('(prefers-color-scheme: light)').matches);
                    return { matchesDark: isDark, matchesLight: isLight };
                `,
        },
      })

      console.log('Color scheme after MCP connection:', result.content)

      // After MCP connection, color scheme should NOT be forced to light.
      // The page.ts default is now 'no-override', so the browser's actual
      // color scheme (dark, from test-utils launch config) should be preserved.
      expect(result.content).toMatchInlineSnapshot(`
        [
          {
            "text": "[return value] { matchesDark: true, matchesLight: false }",
            "type": "text",
          },
        ]
      `)

      await page.close()
    },
    60000,
  )

  it('should get clean HTML with getCleanHTML', async () => {
    const browserContext = getBrowserContext()
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    const page = await browserContext.newPage()
    await page.setContent(`
            <html>
                <head>
                    <style>.hidden { display: none; }</style>
                    <script>console.log('test')</script>
                </head>
                <body>
                    <div class="container" data-testid="main">
                        <h1>Hello World</h1>
                        <button id="btn" aria-label="Click me">Submit</button>
                        <a href="/about" title="About page">About</a>
                        <input type="text" placeholder="Enter name" />
                    </div>
                </body>
            </html>
        `)
    await page.bringToFront()

    await serviceWorker.evaluate(async () => {
      await globalThis.toggleExtensionForActiveTab()
    })
    await new Promise((r) => setTimeout(r, 400))

    // Test basic getCleanHTML
    const result = await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
                    let testPage;
                    for (const p of context.pages()) {
                        const html = await p.content();
                        if (html.includes('Hello World')) { testPage = p; break; }
                    }
                    if (!testPage) throw new Error('Test page not found');
                    const html = await getCleanHTML({ locator: testPage.locator('body') });
                    return html;
                `,
        timeout: 15000,
      },
    })

    expect(result.isError).toBeFalsy()
    const text = (result.content as any)[0]?.text || ''

    // Inline snapshot of cleaned HTML
    expect(text).toMatchInlineSnapshot(`
          "[return value] <div data-testid="main">
           <h1>Hello World</h1>
           <button aria-label="Click me">Submit</button>
           <a href="/about" title="About page">About</a>
           <input type="text" placeholder="Enter name">
          </div>"
        `)

    // Should NOT contain script/style tags (they're removed)
    expect(text).not.toContain('<script')
    expect(text).not.toContain('<style')
    expect(text).not.toContain('console.log')

    // Test search functionality
    const searchResult = await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
                    let testPage;
                    for (const p of context.pages()) {
                        const html = await p.content();
                        if (html.includes('Hello World')) { testPage = p; break; }
                    }
                    if (!testPage) throw new Error('Test page not found');
                    const html = await getCleanHTML({ locator: testPage, search: /button/i });
                    return html;
                `,
        timeout: 15000,
      },
    })

    expect(searchResult.isError).toBeFalsy()
    const searchText = (searchResult.content as any)[0]?.text || ''
    expect(searchText).toContain('button')

    await page.close()
  }, 60000)

  it('should extract page content as markdown with getPageMarkdown', async () => {
    const browserContext = getBrowserContext()
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    const page = await browserContext.newPage()
    // Create a realistic article-like page structure
    await page.setContent(`
            <html>
                <head>
                    <title>Test Article Title</title>
                    <meta name="author" content="John Doe">
                    <script>console.log('analytics')</script>
                    <style>.nav { background: blue; }</style>
                </head>
                <body>
                    <nav class="nav">
                        <a href="/">Home</a>
                        <a href="/about">About</a>
                    </nav>
                    <article>
                        <h1>Test Article Title</h1>
                        <p>This is the first paragraph of the article content.</p>
                        <p>This is the second paragraph with more details about the topic.</p>
                        <p>The article continues with important information here.</p>
                    </article>
                    <aside>
                        <h3>Related Posts</h3>
                        <ul><li>Post 1</li><li>Post 2</li></ul>
                    </aside>
                    <footer>Copyright 2024</footer>
                </body>
            </html>
        `)
    await page.bringToFront()

    await serviceWorker.evaluate(async () => {
      await globalThis.toggleExtensionForActiveTab()
    })
    await new Promise((r) => setTimeout(r, 400))

    // Test basic getPageMarkdown
    const result = await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
                    let testPage;
                    for (const p of context.pages()) {
                        const html = await p.content();
                        if (html.includes('Test Article Title')) { testPage = p; break; }
                    }
                    if (!testPage) throw new Error('Test page not found');
                    const content = await getPageMarkdown({ page: testPage });
                    console.log(content);
                `,
        timeout: 15000,
      },
    })

    expect(result.isError).toBeFalsy()
    const text = (result.content as any)[0]?.text || ''

    // Snapshot the full output
    await expect(text).toMatchFileSnapshot('./snapshots/page-markdown-output.txt')

    // Should contain article content
    expect(text).toContain('Test Article Title')
    expect(text).toContain('first paragraph')
    expect(text).toContain('second paragraph')

    // Should NOT contain script/style content
    expect(text).not.toContain('analytics')
    expect(text).not.toContain('background: blue')

    // Test search functionality
    const searchResult = await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
                    let testPage;
                    for (const p of context.pages()) {
                        const html = await p.content();
                        if (html.includes('Test Article Title')) { testPage = p; break; }
                    }
                    if (!testPage) throw new Error('Test page not found');
                    const content = await getPageMarkdown({ page: testPage, search: /important/i, showDiffSinceLastCall: false });
                    return content;
                `,
        timeout: 15000,
      },
    })

    expect(searchResult.isError).toBeFalsy()
    const searchText = (searchResult.content as any)[0]?.text || ''
    expect(searchText).toContain('important')

    await page.close()
  }, 60000)

  it('should handle default page being closed and switch to another available page', async () => {
    // This test verifies that when the default `page` in MCP scope is closed,
    // the MCP automatically switches to another available page instead of failing
    // with cryptic "page closed" errors.

    const browserContext = getBrowserContext()
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    // 1. Disconnect everything to start fresh
    await serviceWorker.evaluate(async () => {
      await globalThis.disconnectEverything()
    })
    await new Promise((r) => setTimeout(r, 100))

    // 2. Create first page and enable extension
    const page1 = await browserContext.newPage()
    await page1.goto('https://example.com/first-page')
    await page1.bringToFront()

    await serviceWorker.evaluate(async () => {
      await globalThis.toggleExtensionForActiveTab()
    })
    await new Promise((r) => setTimeout(r, 100))

    // 3. Reset MCP to ensure page1 becomes the default page (only page available)
    const resetResult = await client.callTool({
      name: 'reset',
      arguments: {},
    })
    expect((resetResult as any).content[0].text).toContain('Connection reset successfully')

    // 4. Verify initial page is accessible via default `page`
    const initialResult = await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
                    const url = page.url();
                    console.log('Initial page URL:', url);
                    return { url };
                `,
      },
    })
    expect((initialResult as any).content[0].text).toContain('first-page')

    // 5. Create second page and enable extension
    const page2 = await browserContext.newPage()
    await page2.goto('https://example.com/second-page')
    await page2.bringToFront()

    await serviceWorker.evaluate(async () => {
      await globalThis.toggleExtensionForActiveTab()
    })
    await new Promise((r) => setTimeout(r, 100))

    // 6. Close the first page (which is the default `page` in MCP scope)
    await page1.close()
    await new Promise((r) => setTimeout(r, 100))

    // 7. Execute code via MCP - should NOT fail with "page closed" error
    // Instead, it should automatically switch to the second page
    const afterCloseResult = await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
                    const url = page.url();
                    console.log('Page URL after close:', url);
                    const title = await page.title();
                    return { url, title };
                `,
      },
    })

    // Should succeed and return the second page's info
    expect((afterCloseResult as any).isError).toBeFalsy()
    const output = (afterCloseResult as any).content[0].text
    expect(output).toContain('second-page')
    expect(output).not.toContain('page closed')
    expect(output).not.toContain('Target closed')

    // Cleanup
    await page2.close()
  }, 60000)

  it('should show descriptive error when clicking a hidden element', async () => {
    await ensureConnectedTabForExecute()

    // Create a fresh page and set content with a collapsed details element
    await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          state.errorTestPage = await context.newPage();
          await state.errorTestPage.setContent(\`
            <details>
              <summary>Toggle</summary>
              <button id="hidden-btn">Hidden Button</button>
            </details>
          \`);
        `,
      },
    })
    const result = await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          await state.errorTestPage.click('#hidden-btn', { timeout: 100 });
        `,
      },
    })
    expect(result).toMatchInlineSnapshot(`
      {
        "content": [
          {
            "text": "
      Error executing code: page.click: Timeout 100ms exceeded. Element is not visible — it may be hidden by CSS, inside a collapsed <details>, inactive tab, or closed accordion. Try: interact with the page to reveal it first, or use { force: true } to skip visibility checks
      Call log:
      [2m  - waiting for locator('#hidden-btn')[22m
      [2m    - locator resolved to <button id="hidden-btn">Hidden Button</button>[22m
      [2m  - attempting click action[22m
      [2m    2 × waiting for element to be visible, enabled and stable[22m
      [2m      - element is not visible[22m
      [2m    - retrying click action[22m
      [2m    - waiting 20ms[22m
      [2m    - waiting for element to be visible, enabled and stable[22m
      [2m    - element is not visible[22m
      [2m  - retrying click action[22m
      [2m    - waiting 100ms[22m
      ",
            "type": "text",
          },
        ],
        "isError": true,
      }
    `)
    // Cleanup
    await client.callTool({ name: 'execute', arguments: { code: js`await state.errorTestPage.close(); delete state.errorTestPage;` } })
  }, 30000)

  it('should show descriptive error when clicking an element covered by another', async () => {
    await ensureConnectedTabForExecute()

    await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          state.errorTestPage = await context.newPage();
          await state.errorTestPage.setContent(\`
            <div style="position:relative">
              <button id="covered-btn" style="position:absolute;top:0;left:0">Covered</button>
              <div id="overlay" style="position:absolute;top:0;left:0;width:200px;height:200px;background:red;z-index:10">Overlay</div>
            </div>
          \`);
        `,
      },
    })
    const result = await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          await state.errorTestPage.click('#covered-btn', { timeout: 100 });
        `,
      },
    })
    expect(result).toMatchInlineSnapshot(`
      {
        "content": [
          {
            "text": "
      Error executing code: page.click: Timeout 100ms exceeded. <div id="overlay">Overlay</div> intercepts pointer events
      Call log:
      [2m  - waiting for locator('#covered-btn')[22m
      [2m    - locator resolved to <button id="covered-btn">Covered</button>[22m
      [2m  - attempting click action[22m
      [2m    2 × waiting for element to be visible, enabled and stable[22m
      [2m      - element is visible, enabled and stable[22m
      [2m      - scrolling into view if needed[22m
      [2m      - done scrolling[22m
      [2m      - <div id="overlay">Overlay</div> intercepts pointer events[22m
      [2m    - retrying click action[22m
      [2m    - waiting 20ms[22m
      [2m    - waiting for element to be visible, enabled and stable[22m
      [2m    - element is visible, enabled and stable[22m
      [2m    - scrolling into view if needed[22m
      [2m    - done scrolling[22m
      [2m    - <div id="overlay">Overlay</div> intercepts pointer events[22m
      [2m  - retrying click action[22m
      [2m    - waiting 100ms[22m
      ",
            "type": "text",
          },
        ],
        "isError": true,
      }
    `)
    await client.callTool({ name: 'execute', arguments: { code: js`await state.errorTestPage.close(); delete state.errorTestPage;` } })
  }, 30000)

  it('should show descriptive error when clicking a display:none element', async () => {
    await ensureConnectedTabForExecute()

    await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          state.errorTestPage = await context.newPage();
          await state.errorTestPage.setContent('<button id="invisible" style="display:none">Invisible</button>');
        `,
      },
    })
    const result = await client.callTool({
      name: 'execute',
      arguments: {
        code: js`
          await state.errorTestPage.click('#invisible', { timeout: 100 });
        `,
      },
    })
    expect(result).toMatchInlineSnapshot(`
      {
        "content": [
          {
            "text": "
      Error executing code: page.click: Timeout 100ms exceeded. Element is not visible — it may be hidden by CSS, inside a collapsed <details>, inactive tab, or closed accordion. Try: interact with the page to reveal it first, or use { force: true } to skip visibility checks
      Call log:
      [2m  - waiting for locator('#invisible')[22m
      [2m    - locator resolved to <button id="invisible">Invisible</button>[22m
      [2m  - attempting click action[22m
      [2m    2 × waiting for element to be visible, enabled and stable[22m
      [2m      - element is not visible[22m
      [2m    - retrying click action[22m
      [2m    - waiting 20ms[22m
      [2m    - waiting for element to be visible, enabled and stable[22m
      [2m    - element is not visible[22m
      [2m  - retrying click action[22m
      [2m    - waiting 100ms[22m
      ",
            "type": "text",
          },
        ],
        "isError": true,
      }
    `)
    await client.callTool({ name: 'execute', arguments: { code: js`await state.errorTestPage.close(); delete state.errorTestPage;` } })
  }, 30000)

  // Sandbox escape tests (issue #105): process.getBuiltinModule and importModule()
  // must respect ALLOWED_MODULES the same way require() does.
  it('should block process.getBuiltinModule for disallowed modules', async () => {
    await ensureConnectedTabForExecute()
    const result = await client.callTool({
      name: 'execute',
      arguments: { code: js`return process.getBuiltinModule('node:child_process')` },
    })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('not allowed in the sandbox')
  }, 30000)

  it('should block importModule() for disallowed modules', async () => {
    await ensureConnectedTabForExecute()
    const result = await client.callTool({
      name: 'execute',
      arguments: { code: js`const cp = await importModule('node:child_process'); return cp` },
    })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('not allowed in the sandbox')
  }, 30000)

  it('should block getBuiltinModule via Object.getOwnPropertyDescriptor bypass', async () => {
    await ensureConnectedTabForExecute()
    const result = await client.callTool({
      name: 'execute',
      arguments: { code: js`
        const desc = Object.getOwnPropertyDescriptor(process, 'getBuiltinModule')
        return desc.value('node:child_process')
      ` },
    })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('not allowed in the sandbox')
  }, 30000)

})
