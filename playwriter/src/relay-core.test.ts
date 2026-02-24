import { createMCPClient } from './mcp-client.js'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getCDPSessionForPage } from './cdp-session.js'
import { getCdpUrl } from './utils.js'
import {
  setupTestContext,
  cleanupTestContext,
  getExtensionServiceWorker,
  type TestContext,
  withTimeout,
  js,
  tryJsonParse,
  createSimpleServer,
} from './test-utils.js'
import './test-declarations.js'

const TEST_PORT = 19987

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
    },
    {
      name: 'shadcn-ui',
      url: 'https://ui.shadcn.com/',
      expectedContent: ['shadcn'],
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
              await state.page.goto('${testCase.url}', { waitUntil: 'domcontentloaded' });
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

    // Test that logs are cleared on page reload
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

    // Check logs after reload - old logs should be gone
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
    expect(afterReloadOutput).not.toContain('[log] Before reload 99999')

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

    // Test that reloading page A clears only page A logs
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

    // Check page A logs - should only have new log
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
    expect(pageAAfterReloadOutput).not.toContain('[log] PageA log 11111')

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
})
