import { createMCPClient } from './mcp-client.js'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { chromium } from 'playwright-core'
import { getCdpUrl } from './utils.js'
import { setupTestContext, cleanupTestContext, getExtensionServiceWorker, type TestContext, js } from './test-utils.js'
import './test-declarations.js'

const TEST_PORT = 19990

describe('MCP Connection Tests', () => {
    let client: Awaited<ReturnType<typeof createMCPClient>>['client']
    let cleanup: (() => Promise<void>) | null = null
    let testCtx: TestContext | null = null

    beforeAll(async () => {
        testCtx = await setupTestContext({ port: TEST_PORT, tempDirPrefix: 'pw-conn-test-', toggleExtension: true })

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

    it('should handle new pages and toggling with new connections', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        // 1. Create a new page
        const page = await browserContext.newPage()
        const testUrl = 'https://example.com/'
        await page.goto(testUrl)

        await page.bringToFront()

        // 2. Enable extension on this new tab
        const result = await serviceWorker.evaluate(async () => {
            return await globalThis.toggleExtensionForActiveTab()
        })
        expect(result.isConnected).toBe(true)

        // 3. Verify we can connect via direct CDP and see the page
        let directBrowser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
        let contexts = directBrowser.contexts()
        let pages = contexts[0].pages()

        let foundPage = pages.find(p => p.url() === testUrl)
        expect(foundPage).toBeDefined()
        expect(foundPage?.url()).toBe(testUrl)

        const sum1 = await foundPage?.evaluate(() => 1 + 1)
        expect(sum1).toBe(2)

        await directBrowser.close()

        // 4. Disable extension on this tab
        const resultDisabled = await serviceWorker.evaluate(async () => {
            return await globalThis.toggleExtensionForActiveTab()
        })
        expect(resultDisabled.isConnected).toBe(false)

        // 5. Connect again - page should NOT be visible
        directBrowser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
        contexts = directBrowser.contexts()
        pages = contexts[0].pages()

        foundPage = pages.find(p => p.url() === testUrl)
        expect(foundPage).toBeUndefined()

        await directBrowser.close()

        // 6. Re-enable extension
        const resultEnabled = await serviceWorker.evaluate(async () => {
            return await globalThis.toggleExtensionForActiveTab()
        })
        expect(resultEnabled.isConnected).toBe(true)

        // 7. Verify page is back
        directBrowser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
        await new Promise(r => setTimeout(r, 100))

        contexts = directBrowser.contexts()
        if (contexts[0].pages().length === 0) {
             await new Promise(r => setTimeout(r, 100))
        }
        pages = contexts[0].pages()

        foundPage = pages.find(p => p.url() === testUrl)
        expect(foundPage).toBeDefined()
        expect(foundPage?.url()).toBe(testUrl)

        const sum2 = await foundPage?.evaluate(() => 2 + 2)
        expect(sum2).toBe(4)

        await directBrowser.close()
        await page.close()
    })

    it('should handle new pages and toggling with persistent connection', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        const directBrowser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
        await new Promise(r => setTimeout(r, 100))

        // 1. Create a new page
        const page = await browserContext.newPage()
        const testUrl = 'https://example.com/persistent'
        await page.goto(testUrl)
        await page.bringToFront()

        // 2. Enable extension
        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })

        // 3. Verify page appears (polling)
        let foundPage
        for (let i = 0; i < 50; i++) {
            const pages = directBrowser.contexts()[0].pages()
            foundPage = pages.find(p => p.url() === testUrl)
            if (foundPage) break
            await new Promise(r => setTimeout(r, 100))
        }
        expect(foundPage).toBeDefined()
        expect(foundPage?.url()).toBe(testUrl)

        const sum1 = await foundPage?.evaluate(() => 10 + 20)
        expect(sum1).toBe(30)

        // 4. Disable extension
        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })

        // 5. Verify page disappears (polling)
        for (let i = 0; i < 50; i++) {
            const pages = directBrowser.contexts()[0].pages()
            foundPage = pages.find(p => p.url() === testUrl)
            if (!foundPage) break
            await new Promise(r => setTimeout(r, 100))
        }
        expect(foundPage).toBeUndefined()

        // 6. Re-enable extension
        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })

        // 7. Verify page reappears (polling)
        for (let i = 0; i < 50; i++) {
            const pages = directBrowser.contexts()[0].pages()
            foundPage = pages.find(p => p.url() === testUrl)
            if (foundPage) break
            await new Promise(r => setTimeout(r, 100))
        }
        expect(foundPage).toBeDefined()
        expect(foundPage?.url()).toBe(testUrl)

        const sum2 = await foundPage?.evaluate(() => 30 + 40)
        expect(sum2).toBe(70)

        await page.close()
        await directBrowser.close()
    })

    it('should maintain connection across reloads and navigation', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        // 1. Setup page
        const page = await browserContext.newPage()
        const initialUrl = 'https://example.com/'
        await page.goto(initialUrl)
        await page.bringToFront()

        // 2. Enable extension
        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })

        // 3. Connect via CDP
        const cdpUrl = getCdpUrl({ port: TEST_PORT })
        const directBrowser = await chromium.connectOverCDP(cdpUrl)
        const connectedPage = directBrowser.contexts()[0].pages().find(p => p.url() === initialUrl)
        expect(connectedPage).toBeDefined()

        expect(await connectedPage?.evaluate(() => 1 + 1)).toBe(2)

        // 4. Reload
        await connectedPage?.reload()
        await connectedPage?.waitForLoadState('domcontentloaded')
        expect(await connectedPage?.title()).toBe('Example Domain')

        expect(await connectedPage?.evaluate(() => 2 + 2)).toBe(4)

        // 5. Navigate to new URL
        const newUrl = 'https://example.org/'
        await connectedPage?.goto(newUrl)
        await connectedPage?.waitForLoadState('domcontentloaded')

        expect(connectedPage?.url()).toBe(newUrl)
        expect(await connectedPage?.title()).toContain('Example Domain')

        expect(await connectedPage?.evaluate(() => 3 + 3)).toBe(6)

        await directBrowser.close()
        await page.close()
    })

    it('should support multiple concurrent tabs', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)
        await new Promise(resolve => setTimeout(resolve, 100))

        // Tab A
        const pageA = await browserContext.newPage()
        await pageA.goto('https://example.com/tab-a')
        await pageA.bringToFront()
        await new Promise(resolve => setTimeout(resolve, 100))
        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })

        // Tab B
        const pageB = await browserContext.newPage()
        await pageB.goto('https://example.com/tab-b')
        await pageB.bringToFront()
        await new Promise(resolve => setTimeout(resolve, 100))
        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })

        // Get target IDs for both
        const targetIds = await serviceWorker.evaluate(async () => {
             const state = globalThis.getExtensionState()
             const chrome = globalThis.chrome
             const tabs = await chrome.tabs.query({})
             const tabA = tabs.find((t: any) => t.url?.includes('tab-a'))
             const tabB = tabs.find((t: any) => t.url?.includes('tab-b'))
             return {
                 idA: state.tabs.get(tabA?.id ?? -1)?.targetId,
                 idB: state.tabs.get(tabB?.id ?? -1)?.targetId
             }
        })

        expect(targetIds).toMatchInlineSnapshot({
            idA: expect.any(String),
            idB: expect.any(String)
        }, `
          {
            "idA": Any<String>,
            "idB": Any<String>,
          }
        `)
        expect(targetIds.idA).not.toBe(targetIds.idB)

        // Verify independent connections
        const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))

        const pages = browser.contexts()[0].pages()

        const results = await Promise.all(pages.map(async (p) => ({
            url: p.url(),
            title: await p.title()
        })))

        expect(results).toMatchInlineSnapshot(`
          [
            {
              "title": "",
              "url": "about:blank",
            },
            {
              "title": "Example Domain",
              "url": "https://example.com/tab-a",
            },
            {
              "title": "Example Domain",
              "url": "https://example.com/tab-b",
            },
          ]
        `)

        // Verify execution on both pages
        const pageA_CDP = pages.find(p => p.url().includes('tab-a'))
        const pageB_CDP = pages.find(p => p.url().includes('tab-b'))

        expect(await pageA_CDP?.evaluate(() => 10 + 10)).toBe(20)
        expect(await pageB_CDP?.evaluate(() => 20 + 20)).toBe(40)

        await browser.close()
        await pageA.close()
        await pageB.close()
    })

    it('should show correct url when enabling extension after navigation', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        const page = await browserContext.newPage()
        const targetUrl = 'https://example.com/late-enable'
        await page.goto(targetUrl)
        await page.bringToFront()

        await page.waitForLoadState('domcontentloaded')

        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })

        const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
        await new Promise(r => setTimeout(r, 100))

        const cdpPage = browser.contexts()[0].pages().find(p => p.url() === targetUrl)

        expect(cdpPage).toBeDefined()
        expect(cdpPage?.url()).toBe(targetUrl)

        await browser.close()
        await page.close()
    }, 60000)

    it('should be able to reconnect after disconnecting everything', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        const pages = await browserContext.pages()
        expect(pages.length).toBeGreaterThan(0)
        const page = pages[0]

        await page.goto('https://example.com/disconnect-test')
        await page.waitForLoadState('domcontentloaded')
        await page.bringToFront()

        // Enable extension on this page
        const initialEnable = await serviceWorker.evaluate(async () => {
            return await globalThis.toggleExtensionForActiveTab()
        })
        console.log('Initial enable result:', initialEnable)
        expect(initialEnable.isConnected).toBe(true)

        await new Promise(resolve => setTimeout(resolve, 100))

        // Verify MCP can see the page
        const beforeDisconnect = await client.callTool({
            name: 'execute',
            arguments: {
                code: js`
          const pages = context.pages();
          console.log('Pages before disconnect:', pages.length);
          const testPage = pages.find(p => p.url().includes('disconnect-test'));
          console.log('Found test page:', !!testPage);
          return { pagesCount: pages.length, foundTestPage: !!testPage };
        `,
            },
        })

        const beforeOutput = (beforeDisconnect as any).content[0].text
        expect(beforeOutput).toContain('foundTestPage')
        console.log('Before disconnect:', beforeOutput)

        // 2. Disconnect everything
        console.log('Calling disconnectEverything...')
        await serviceWorker.evaluate(async () => {
            await globalThis.disconnectEverything()
        })

        await new Promise(resolve => setTimeout(resolve, 100))

        // 3. Verify MCP cannot execute code anymore (no pages available)
        const afterDisconnect = await client.callTool({
            name: 'execute',
            arguments: {
                code: js`
          const pages = context.pages();
          console.log('Pages after disconnect:', pages.length);
          return { pagesCount: pages.length };
        `,
            },
        })

        const afterDisconnectOutput = (afterDisconnect as any).content[0].text
        console.log('After disconnect:', afterDisconnectOutput)
        expect((afterDisconnect as any).isError).toBe(true)
        expect(afterDisconnectOutput).toContain('No Playwright pages are available')

        // 4. Re-enable extension on the same page
        console.log('Re-enabling extension...')
        await page.bringToFront()
        const reconnectResult = await serviceWorker.evaluate(async () => {
            console.log('About to call toggleExtensionForActiveTab')
            const result = await globalThis.toggleExtensionForActiveTab()
            console.log('toggleExtensionForActiveTab result:', result)
            return result
        })

        console.log('Reconnect result:', reconnectResult)
        expect(reconnectResult.isConnected).toBe(true)

        console.log('Waiting for reconnection to stabilize...')
        await new Promise(resolve => setTimeout(resolve, 100))

        // 5. Reset the MCP client's playwright connection
        console.log('Resetting MCP playwright connection...')
        const resetResult = await client.callTool({
            name: 'reset',
            arguments: {},
        })
        console.log('Reset result:', (resetResult as any).content[0].text)
        expect((resetResult as any).content[0].text).toContain('Connection reset successfully')

        // 6. Verify MCP can see the page again
        console.log('Attempting to access page via MCP...')
        const afterReconnect = await client.callTool({
            name: 'execute',
            arguments: {
                code: js`
          console.log('Checking pages after reconnect...');
          const pages = context.pages();
          console.log('Pages after reconnect:', pages.length);

          if (pages.length === 0) {
            console.log('No pages found!');
            return { pagesCount: 0, foundTestPage: false };
          }

          const testPage = pages.find(p => p.url().includes('disconnect-test'));
          console.log('Found test page after reconnect:', !!testPage);

          if (testPage) {
            console.log('Test page URL:', testPage.url());
            return { pagesCount: pages.length, foundTestPage: true, url: testPage.url() };
          }

          return { pagesCount: pages.length, foundTestPage: false };
        `,
            },
        })

        const afterReconnectOutput = (afterReconnect as any).content[0].text
        console.log('After reconnect:', afterReconnectOutput)
        expect(afterReconnectOutput).toContain('foundTestPage')
        expect(afterReconnectOutput).toContain('disconnect-test')

        // Clean up
        await page.goto('about:blank')
    })

    it('should auto-reconnect MCP after extension WebSocket reconnects', async () => {
        const serviceWorker = await getExtensionServiceWorker(testCtx!.browserContext)

        // 1. Create a test page and enable extension
        const page = await testCtx!.browserContext.newPage()
        await page.goto('https://example.com/auto-reconnect-test')
        await page.waitForLoadState('domcontentloaded')
        await page.bringToFront()

        const initialEnable = await serviceWorker.evaluate(async () => {
            return await globalThis.toggleExtensionForActiveTab()
        })
        expect(initialEnable.isConnected).toBe(true)
        await new Promise(resolve => setTimeout(resolve, 100))

        // 2. Verify MCP can execute commands
        const beforeResult = await client.callTool({
            name: 'execute',
            arguments: {
                code: js`
          let testPage;
          for (let i = 0; i < 20; i++) {
            const pages = context.pages();
            testPage = pages.find(p => p.url().includes('auto-reconnect-test'));
            if (testPage) break;
            await new Promise((r) => { setTimeout(r, 100) });
          }
          const pages = context.pages();
          return { pagesCount: pages.length, foundTestPage: !!testPage, url: testPage?.url() };
        `,
            },
        })
        const beforeOutput = (beforeResult as any).content[0].text
        expect(beforeOutput).toContain('foundTestPage')
        expect(beforeOutput).toContain('true')
        expect(beforeOutput).toContain('auto-reconnect-test')

        // 3. Simulate extension WebSocket reconnection
        await serviceWorker.evaluate(async () => {
            await globalThis.disconnectEverything()
        })
        await new Promise(resolve => setTimeout(resolve, 100))

        // Re-enable extension
        await page.bringToFront()
        const reconnectResult = await serviceWorker.evaluate(async () => {
            return await globalThis.toggleExtensionForActiveTab()
        })
        expect(reconnectResult.isConnected).toBe(true)
        await new Promise(resolve => setTimeout(resolve, 100))

        // 4. Execute command WITHOUT calling resetPlaywright()
        const afterResult = await client.callTool({
            name: 'execute',
            arguments: {
                code: js`
          let testPage;
          for (let i = 0; i < 20; i++) {
            const pages = context.pages();
            testPage = pages.find(p => p.url().includes('auto-reconnect-test'));
            if (testPage) break;
            await new Promise((r) => { setTimeout(r, 100) });
          }
          const pages = context.pages();
          return { pagesCount: pages.length, foundTestPage: !!testPage, url: testPage?.url() };
        `,
            },
        })

        const afterOutput = (afterResult as any).content[0].text
        expect(afterOutput).toContain('foundTestPage')
        expect(afterOutput).toContain('true')
        expect(afterOutput).toContain('auto-reconnect-test')
        expect(afterOutput).not.toContain('Extension not connected')
        expect((afterResult as any).isError).not.toBe(true)

        // Clean up
        await page.goto('about:blank')
    })

    it('should maintain correct page.url() with service worker pages', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        const page = await browserContext.newPage()
        const targetUrl = 'https://example.com/sw-test'
        await page.goto(targetUrl)
        await page.bringToFront()

        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })

        await new Promise(r => setTimeout(r, 100))

        const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
        const cdpPages = browser.contexts()[0].pages()
        const testPage = cdpPages.find(p => p.url().includes('sw-test'))

        expect(testPage).toBeDefined()
        expect(testPage?.url()).toContain('sw-test')
        expect(testPage?.url()).not.toContain('sw.js')

        await browser.close()
        await page.close()
    }, 30000)

    it('should maintain correct page.url() after repeated connections', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        const page = await browserContext.newPage()
        const targetUrl = 'https://example.com/repeated-test'
        await page.goto(targetUrl)
        await page.bringToFront()

        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })

        for (let i = 0; i < 5; i++) {
            const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
            const cdpPages = browser.contexts()[0].pages()
            const testPage = cdpPages.find(p => p.url().includes('repeated-test'))

            expect(testPage).toBeDefined()
            expect(testPage?.url()).toBe(targetUrl)

            await browser.close()
            await new Promise(r => setTimeout(r, 100))
        }

        await page.close()
    }, 30000)

    it('should maintain correct page.url() with concurrent MCP and CDP connections', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        const page = await browserContext.newPage()
        const targetUrl = 'https://example.com/concurrent-test'
        await page.goto(targetUrl)
        await page.bringToFront()

        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })

        await new Promise(r => setTimeout(r, 400))

        const [mcpResult, cdpBrowser] = await Promise.all([
            client.callTool({
                name: 'execute',
                arguments: {
                    code: js`
              const pages = context.pages();
              const testPage = pages.find(p => p.url().includes('concurrent-test'));
              return { url: testPage?.url(), found: !!testPage };
            `,
                },
            }),
            chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
        ])

        const mcpOutput = (mcpResult as any).content[0].text
        expect(mcpOutput).toContain(targetUrl)

        const cdpPages = cdpBrowser.contexts()[0].pages()
        const cdpPage = cdpPages.find(p => p.url().includes('concurrent-test'))
        expect(cdpPage?.url()).toBe(targetUrl)

        await cdpBrowser.close()
        await page.close()
    }, 30000)
})
