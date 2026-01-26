import { createMCPClient } from './mcp-client.js'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { chromium } from 'playwright-core'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { getCdpUrl } from './utils.js'
import type { ExtensionState } from 'mcp-extension/src/types.js'
import type { Protocol } from 'devtools-protocol'
import { imageSize } from 'image-size'
import { getCDPSessionForPage } from './cdp-session.js'
import { Debugger } from './debugger.js'
import { Editor } from './editor.js'
import type { CDPCommand } from './cdp-types.js'
import { setupTestContext, cleanupTestContext, getExtensionServiceWorker, createSseServer, type TestContext, withTimeout } from './test-utils.js'
import { screenshotWithAccessibilityLabels } from './aria-snapshot.js'

declare const window: any
declare const document: any

const TEST_PORT = 19987


function js(strings: TemplateStringsArray, ...values: any[]): string {
    return strings.reduce(
        (result, str, i) => result + str + (values[i] || ''),
        '',
    )
}


declare global {
    var toggleExtensionForActiveTab: () => Promise<{ isConnected: boolean; state: ExtensionState }>;
    var getExtensionState: () => ExtensionState;
    var disconnectEverything: () => Promise<void>;
}

describe('MCP Server Tests', () => {
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
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        const page = await browserContext.newPage()
        await page.setContent('<html><body><button id="btn">Click</button></body></html>')
        await page.bringToFront()

        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })
        await new Promise((r) => { setTimeout(r, 100) })

        const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
        const cdpPage = browser.contexts()[0].pages().find(p => {
            return p.url().startsWith('about:')
        })
        expect(cdpPage).toBeDefined()

        const hasGlobalBefore = await cdpPage!.evaluate(() => !!(globalThis as any).__testGlobal)
        expect(hasGlobalBefore).toBe(false)

        await cdpPage!.addScriptTag({ content: 'globalThis.__testGlobal = { foo: "bar" };' })

        const hasGlobalAfter = await cdpPage!.evaluate(() => (globalThis as any).__testGlobal)
        expect(hasGlobalAfter).toEqual({ foo: 'bar' })

        await browser.close()
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
          [log] 'Page title:' 'Example Domain'

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
                connectionState: state.connectionState
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

    it('should get accessibility snapshot of hacker news', async () => {
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
          await state.page.goto('https://news.ycombinator.com/item?id=1', { waitUntil: 'domcontentloaded' });
          const snapshot = await state.page._snapshotForAI();
          return snapshot;
        `,
            },
        })

        const initialData =
            typeof result === 'object' && result.content?.[0]?.text
                ? tryJsonParse(result.content[0].text)
                : result
        await expect(initialData).toMatchFileSnapshot(
            'snapshots/hacker-news-initial-accessibility.md',
        )
        expect(result.content).toBeDefined()
        expect(initialData).toContain('table')
        expect(initialData).toContain('Hacker News')
    }, 30000)

    it('should get accessibility snapshot of shadcn UI', async () => {
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

        const snapshot = await client.callTool({
            name: 'execute',
            arguments: {
                code: js`
          await state.page.goto('https://ui.shadcn.com/', { waitUntil: 'domcontentloaded' });
          const snapshot = await state.page._snapshotForAI();
          return snapshot;
        `,
            },
        })

        const data =
            typeof snapshot === 'object' && snapshot.content?.[0]?.text
                ? tryJsonParse(snapshot.content[0].text)
                : snapshot
        await expect(data).toMatchFileSnapshot('snapshots/shadcn-ui-accessibility.md')
        expect(snapshot.content).toBeDefined()
        expect(data).toContain('shadcn')
    }, 30000)

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

    it('should handle new pages and toggling with new connections', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        // 1. Create a new page
        const page = await browserContext.newPage()
        const testUrl = 'https://example.com/'
        await page.goto(testUrl)

        await page.bringToFront()

        // 2. Enable extension on this new tab
        // Since it's a new page, extension is not connected yet
        const result = await serviceWorker.evaluate(async () => {
            return await globalThis.toggleExtensionForActiveTab()
        })
        expect(result.isConnected).toBe(true)

        // 3. Verify we can connect via direct CDP and see the page

        let directBrowser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
        let contexts = directBrowser.contexts()
        let pages = contexts[0].pages()

        // Find our page
        let foundPage = pages.find(p => p.url() === testUrl)
        expect(foundPage).toBeDefined()
        expect(foundPage?.url()).toBe(testUrl)

        // Verify execution works
        const sum1 = await foundPage?.evaluate(() => 1 + 1)
        expect(sum1).toBe(2)

        await directBrowser.close()


        // 4. Disable extension on this tab
        const resultDisabled = await serviceWorker.evaluate(async () => {
            return await globalThis.toggleExtensionForActiveTab()
        })
        expect(resultDisabled.isConnected).toBe(false)

        // 5. Try to connect/use the page.
        // connecting to relay will succeed, but listing pages should NOT show our page

        // Connect to relay again
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
        // Wait a bit for targets to populate
        await new Promise(r => setTimeout(r, 100))

        contexts = directBrowser.contexts()
        // pages() might need a moment if target attached event comes in
        if (contexts[0].pages().length === 0) {
             await new Promise(r => setTimeout(r, 100))
        }
        pages = contexts[0].pages()

        foundPage = pages.find(p => p.url() === testUrl)
        expect(foundPage).toBeDefined()
        expect(foundPage?.url()).toBe(testUrl)

        // Verify execution works again
        const sum2 = await foundPage?.evaluate(() => 2 + 2)
        expect(sum2).toBe(4)

        await directBrowser.close()
        await page.close()
    })

    it('should handle new pages and toggling with persistent connection', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        // Connect once
        const directBrowser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
        // Wait a bit for connection and initial target discovery
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

        // Verify execution works
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

        // Verify execution works again
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

        // Verify execution
        expect(await connectedPage?.evaluate(() => 1 + 1)).toBe(2)

        // 4. Reload
        // We use a loop to check if it's still connected because reload might cause temporary disconnect/reconnect events
        // that Playwright handles natively if the session ID stays valid.
        await connectedPage?.reload()
        await connectedPage?.waitForLoadState('domcontentloaded')
        expect(await connectedPage?.title()).toBe('Example Domain')

        // Verify execution after reload
        expect(await connectedPage?.evaluate(() => 2 + 2)).toBe(4)

        // 5. Navigate to new URL
        const newUrl = 'https://example.org/'
        await connectedPage?.goto(newUrl)
        await connectedPage?.waitForLoadState('domcontentloaded')

        expect(connectedPage?.url()).toBe(newUrl)
        expect(await connectedPage?.title()).toContain('Example Domain')

        // Verify execution after navigation
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

        // Wait for load
        await page.waitForLoadState('domcontentloaded')

        // 2. Enable extension for this page
        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })

        // 3. Verify via CDP that the correct URL is shown
        const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
        // Wait for sync
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

        // Wait for extension to fully connect
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

        // Wait for disconnect to complete
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
        // After disconnect, there are no pages - so we expect an error
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

        // Wait for extension to fully reconnect and relay server to be ready
        console.log('Waiting for reconnection to stabilize...')
        await new Promise(resolve => setTimeout(resolve, 100))

        // 5. Reset the MCP client's playwright connection since it was closed by disconnectEverything
        // Must use the reset tool since execute requires a valid page
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

        // Clean up - navigate page back to about:blank to not interfere with other tests
        await page.goto('about:blank')
    })

    it('should auto-reconnect MCP after extension WebSocket reconnects', async () => {
        // This test verifies that the MCP automatically reconnects when the browser
        // disconnects (e.g., when the extension WebSocket reconnects and the relay
        // server closes all playwright clients). The fix adds browser.on('disconnected')
        // handler that clears state.isConnected, so ensureConnection() creates a new connection.

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
          const pages = context.pages();
          const testPage = pages.find(p => p.url().includes('auto-reconnect-test'));
          return { pagesCount: pages.length, foundTestPage: !!testPage };
        `,
            },
        })
        const beforeOutput = (beforeResult as any).content[0].text
        expect(beforeOutput).toContain('foundTestPage')
        expect(beforeOutput).toContain('true')

        // 3. Simulate extension WebSocket reconnection
        // This causes relay server to close all playwright client WebSockets
        await serviceWorker.evaluate(async () => {
            await globalThis.disconnectEverything()
        })
        await new Promise(resolve => setTimeout(resolve, 100))

        // Re-enable extension (simulates extension reconnecting)
        await page.bringToFront()
        const reconnectResult = await serviceWorker.evaluate(async () => {
            return await globalThis.toggleExtensionForActiveTab()
        })
        expect(reconnectResult.isConnected).toBe(true)
        await new Promise(resolve => setTimeout(resolve, 100))

        // 4. Execute command WITHOUT calling resetPlaywright()
        // The browser.on('disconnected') handler should have cleared state.isConnected,
        // causing ensureConnection() to automatically create a new connection
        const afterResult = await client.callTool({
            name: 'execute',
            arguments: {
                code: js`
          const pages = context.pages();
          const testPage = pages.find(p => p.url().includes('auto-reconnect-test'));
          return { pagesCount: pages.length, foundTestPage: !!testPage, url: testPage?.url() };
        `,
            },
        })

        const afterOutput = (afterResult as any).content[0].text
        // The command should succeed and find our test page
        expect(afterOutput).toContain('foundTestPage')
        expect(afterOutput).toContain('true')
        expect(afterOutput).toContain('auto-reconnect-test')
        // Should NOT contain error about extension not connected
        expect(afterOutput).not.toContain('Extension not connected')
        expect((afterResult as any).isError).not.toBe(true)

        // Clean up
        await page.goto('about:blank')
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
        const pages = browser.contexts()[0].pages()
        const testPage = pages.find(p => p.url().includes('sw-test'))

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
            const pages = browser.contexts()[0].pages()
            const testPage = pages.find(p => p.url().includes('repeated-test'))

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

    it('should be usable after toggle with valid URL', async () => {
        // This test validates the extension properly waits for valid URLs before
        // sending Target.attachedToTarget. Uses Discord - a heavy React SPA.
        //
        // We use waitForEvent('page') to wait for Playwright to process the event.
        // The KEY assertion is that when the event fires, the URL is VALID (not empty).
        // Before the fix: event fired with empty URL -> page broken forever
        // After the fix: event fires with valid URL -> page works immediately

        const _browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(_browserContext)
        const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
        const context = browser.contexts()[0]

        const page = await _browserContext.newPage()
        await page.goto('https://discord.com/login')
        await page.bringToFront()

        // Set up listener BEFORE toggle
        const pagePromise = context.waitForEvent('page', { timeout: 10000 })

        // Toggle extension - extension waits for valid URL before sending event
        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })

        // Wait for page event
        const targetPage = await pagePromise
        console.log('Page URL when event fired:', targetPage.url())

        // KEY ASSERTION: URL must NOT be empty - this is what the extension fix guarantees
        expect(targetPage.url()).not.toBe('')
        expect(targetPage.url()).not.toBe(':')
        expect(targetPage.url()).toContain('discord.com')

        // evaluate() works immediately - no waiting needed
        const result = await targetPage.evaluate(() => window.location.href)
        expect(result).toContain('discord.com')

        await browser.close()
        await page.close()
    }, 60000)

    it('should have non-empty URLs when connecting to already-loaded pages', async () => {
        // This test validates that when we connect to a browser with already-loaded pages,
        // all pages have non-empty URLs. Empty URLs break Playwright permanently.

        const _browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(_browserContext)

        // Create and fully load a heavy page BEFORE connecting
        const page = await _browserContext.newPage()
        await page.goto('https://discord.com/login', { waitUntil: 'load' })
        await page.bringToFront()

        // Toggle extension to attach to the loaded page
        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })

        // NOW connect via CDP - page should already be attached
        const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
        const context = browser.contexts()[0]

        // Get all pages and verify NONE have empty URLs
        const pages = context.pages()
        console.log('All page URLs:', pages.map(p => p.url()))

        expect(pages.length).toBeGreaterThan(0)
        for (const p of pages) {
            expect(p.url()).not.toBe('')
            expect(p.url()).not.toBe(':')
            expect(p.url()).not.toBeUndefined()
        }

        // Find Discord page and verify it works
        const discordPage = pages.find(p => p.url().includes('discord.com'))
        expect(discordPage).toBeDefined()

        const result = await discordPage!.evaluate(() => window.location.href)
        expect(result).toContain('discord.com')

        await browser.close()
        await page.close()
    }, 60000)

    it('should navigate to notion without hanging', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        const page = await browserContext.newPage()
        const initialUrl = 'https://example.com/notion-repro'
        await page.goto(initialUrl)
        await page.bringToFront()

        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })

        await new Promise(r => setTimeout(r, 100))

        const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
        const cdpPage = browser.contexts()[0].pages().find(p => p.url() === initialUrl)
        expect(cdpPage).toBeDefined()

        const response = await cdpPage!.goto('https://www.notion.so', { waitUntil: 'domcontentloaded', timeout: 20000 })

        const currentUrl = cdpPage!.url()
        const responseUrl = response?.url() ?? ''
        expect(responseUrl).toMatch(/notion\.(so|com)/)
        expect(currentUrl).toMatch(/notion\.(so|com)/)
        expect(await cdpPage!.evaluate(() => document.readyState)).not.toBe('loading')

        await browser.close()
        await page.close()
    }, 60000)

    it('should navigate to youtube without hanging', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        const page = await browserContext.newPage()
        await page.goto('about:blank')
        await page.bringToFront()

        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })

        await new Promise(r => setTimeout(r, 100))

        const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
        const cdpPage = browser.contexts()[0].pages().find(p => p.url().includes('about:'))
        expect(cdpPage).toBeDefined()

        const response = await cdpPage!.goto('https://www.youtube.com', { waitUntil: 'load', timeout: 5000 })
        const currentUrl = cdpPage!.url()
        const responseUrl = response?.url() ?? ''

        expect(responseUrl).toContain('youtube')
        expect(currentUrl).toContain('youtube')
        expect(await cdpPage!.evaluate(() => document.readyState)).not.toBe('loading')

        await browser.close()
        await page.close()
    }, 60000)

    it('should maintain correct page.url() with iframe-heavy pages', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        const page = await browserContext.newPage()
        await page.setContent(`
            <html>
                <head><title>Iframe Test Page</title></head>
                <body>
                    <h1>Iframe Heavy Page</h1>
                    <iframe src="about:blank" id="frame1"></iframe>
                    <iframe src="about:blank" id="frame2"></iframe>
                    <iframe src="about:blank" id="frame3"></iframe>
                </body>
            </html>
        `)
        await page.bringToFront()

        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })

        await new Promise(r => setTimeout(r, 100))

        for (let i = 0; i < 3; i++) {
            const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
            const pages = browser.contexts()[0].pages()
            let iframePage
            for (const p of pages) {
                const html = await p.content()
                if (html.includes('Iframe Heavy Page')) {
                    iframePage = p
                    break
                }
            }

            expect(iframePage).toBeDefined()
            expect(iframePage?.url()).toContain('about:')

            await browser.close()
            await new Promise(r => setTimeout(r, 100))
        }

        await page.close()
    }, 30000)

    it('should capture screenshot correctly', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        const page = await browserContext.newPage()
        await page.goto('https://example.com/')
        await page.bringToFront()

        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })

        await new Promise(r => setTimeout(r, 100))

        const capturedCommands: CDPCommand[] = []
        const commandHandler = ({ command }: { clientId: string; command: CDPCommand }) => {
            if (command.method === 'Page.captureScreenshot') {
                capturedCommands.push(command)
            }
        }
        testCtx!.relayServer.on('cdp:command', commandHandler)

        const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
        const cdpPage = browser.contexts()[0].pages().find(p => p.url().includes('example.com'))

        expect(cdpPage).toBeDefined()

        const viewportSize = cdpPage!.viewportSize()
        console.log('Viewport size:', viewportSize)

        const viewportScreenshot = await cdpPage!.screenshot()
        expect(viewportScreenshot).toBeDefined()

        const viewportDimensions = imageSize(viewportScreenshot)
        console.log('Viewport screenshot dimensions:', viewportDimensions)
        expect(viewportDimensions.width).toBeGreaterThan(0)
        expect(viewportDimensions.height).toBeGreaterThan(0)
        if (viewportSize) {
            expect(viewportDimensions.width).toBe(viewportSize.width)
            expect(viewportDimensions.height).toBe(viewportSize.height)
        }

        const fullPageScreenshot = await cdpPage!.screenshot({ fullPage: true })
        expect(fullPageScreenshot).toBeDefined()

        const fullPageDimensions = imageSize(fullPageScreenshot)
        console.log('Full page screenshot dimensions:', fullPageDimensions)
        expect(fullPageDimensions.width).toBeGreaterThan(0)
        expect(fullPageDimensions.height).toBeGreaterThan(0)
        expect(fullPageDimensions.width).toBeGreaterThanOrEqual(viewportDimensions.width!)

        testCtx!.relayServer.off('cdp:command', commandHandler)

        expect(capturedCommands.length).toBe(2)
        expect(capturedCommands.map(c => ({
            method: c.method,
            params: c.params
        }))).toMatchInlineSnapshot(`
          [
            {
              "method": "Page.captureScreenshot",
              "params": {
                "captureBeyondViewport": false,
                "clip": {
                  "height": 720,
                  "scale": 1,
                  "width": 1280,
                  "x": 0,
                  "y": 0,
                },
                "format": "png",
              },
            },
            {
              "method": "Page.captureScreenshot",
              "params": {
                "captureBeyondViewport": false,
                "clip": {
                  "height": 528,
                  "scale": 1,
                  "width": 1280,
                  "x": 0,
                  "y": 0,
                },
                "format": "png",
              },
            },
          ]
        `)

        const screenshotPath = path.join(os.tmpdir(), 'playwriter-test-screenshot.png')
        fs.writeFileSync(screenshotPath, viewportScreenshot)
        console.log('Screenshot saved to:', screenshotPath)

        await browser.close()
        await page.close()
    }, 60000)

    it('should capture element screenshot with correct coordinates', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        const target = { x: 200, y: 150, width: 300, height: 100 }
        const scrolledTarget = { x: 100, y: 1500, width: 200, height: 80 }

        const page = await browserContext.newPage()
        await page.setContent(`
            <html>
                <head>
                    <style>
                        body { margin: 0; padding: 0; height: 2000px; }
                        #target {
                            position: absolute;
                            top: ${target.y}px;
                            left: ${target.x}px;
                            width: ${target.width}px;
                            height: ${target.height}px;
                            background: red;
                        }
                        #scrolled-target {
                            position: absolute;
                            top: ${scrolledTarget.y}px;
                            left: ${scrolledTarget.x}px;
                            width: ${scrolledTarget.width}px;
                            height: ${scrolledTarget.height}px;
                            background: blue;
                        }
                    </style>
                </head>
                <body>
                    <div id="target">Target Element</div>
                    <div id="scrolled-target">Scrolled Target</div>
                </body>
            </html>
        `)
        await page.bringToFront()

        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })

        await new Promise(r => setTimeout(r, 100))

        const capturedCommands: CDPCommand[] = []
        const commandHandler = ({ command }: { clientId: string; command: CDPCommand }) => {
            if (command.method === 'Page.captureScreenshot') {
                capturedCommands.push(command)
            }
        }
        testCtx!.relayServer.on('cdp:command', commandHandler)

        const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
        let cdpPage
        for (const p of browser.contexts()[0].pages()) {
            const html = await p.content()
            if (html.includes('scrolled-target')) {
                cdpPage = p
                break
            }
        }
        expect(cdpPage).toBeDefined()

        await cdpPage!.locator('#target').screenshot()

        await cdpPage!.locator('#scrolled-target').screenshot()

        testCtx!.relayServer.off('cdp:command', commandHandler)

        expect(capturedCommands.length).toBe(2)

        const targetCmd = capturedCommands[0]
        expect(targetCmd.method).toBe('Page.captureScreenshot')
        const targetClip = (targetCmd.params as any).clip
        expect(targetClip.x).toBe(target.x)
        expect(targetClip.y).toBe(target.y)
        expect(targetClip.width).toBe(target.width)
        expect(targetClip.height).toBe(target.height)

        const scrolledCmd = capturedCommands[1]
        expect(scrolledCmd.method).toBe('Page.captureScreenshot')
        const scrolledClip = (scrolledCmd.params as any).clip
        expect(scrolledClip.x).toBe(scrolledTarget.x)
        expect(scrolledClip.y).toBe(scrolledTarget.y)
        expect(scrolledClip.width).toBe(scrolledTarget.width)
        expect(scrolledClip.height).toBe(scrolledTarget.height)

        await browser.close()
        await page.close()
    }, 60000)

    it('should get locator string for element using getLocatorStringForElement', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        const page = await browserContext.newPage()
        await page.setContent(`
            <html>
                <body>
                    <button id="test-btn">Click Me</button>
                    <input type="text" placeholder="Enter name" />
                </body>
            </html>
        `)
        await page.bringToFront()

        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })

        await new Promise(r => setTimeout(r, 400))

        const result = await client.callTool({
            name: 'execute',
            arguments: {
                code: js`
                    let testPage;
                    for (const p of context.pages()) {
                        const html = await p.content();
                        if (html.includes('test-btn')) { testPage = p; break; }
                    }
                    if (!testPage) throw new Error('Test page not found');
                    const btn = testPage.locator('#test-btn');
                    const locatorString = await getLocatorStringForElement(btn);
                    console.log('Locator string:', locatorString);
                    const locatorFromString = eval('testPage.' + locatorString);
                    const count = await locatorFromString.count();
                    console.log('Locator count:', count);
                    const text = await locatorFromString.textContent();
                    console.log('Locator text:', text);
                `,
                timeout: 30000,
            },
        })

        expect(result.isError).toBeFalsy()
        const text = (result.content as any)[0]?.text || ''
        expect(text).toContain('Locator string:')
        expect(text).toContain("getByRole('button', { name: 'Click Me' })")
        expect(text).toContain('Locator count:')
        expect(text).toContain('Locator text:')
        expect(text).toContain('Click Me')

        await page.close()
    }, 60000)

    it('should get styles for element using getStylesForLocator', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        const page = await browserContext.newPage()
        await page.setContent(`
            <html>
                <head>
                    <style>
                        body { font-family: Arial, sans-serif; color: #333; }
                        .container { padding: 20px; margin: 10px; }
                        #main-btn { background-color: blue; color: white; border-radius: 4px; }
                        .btn { padding: 8px 16px; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <button id="main-btn" class="btn" style="font-weight: bold;">Click Me</button>
                    </div>
                </body>
            </html>
        `)
        await page.bringToFront()

        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })

        await new Promise(r => setTimeout(r, 400))

        const stylesResult = await client.callTool({
            name: 'execute',
            arguments: {
                code: js`
                    let testPage;
                    for (const p of context.pages()) {
                        const html = await p.content();
                        if (html.includes('main-btn')) { testPage = p; break; }
                    }
                    if (!testPage) throw new Error('Test page not found');
                    const btn = testPage.locator('#main-btn');
                    const styles = await getStylesForLocator({ locator: btn });
                    return styles;
                `,
                timeout: 30000,
            },
        })

        expect(stylesResult.isError).toBeFalsy()
        const stylesText = (stylesResult.content as any)[0]?.text || ''
        expect(stylesText).toMatchInlineSnapshot(`
          "[return value] {
            element: 'button#main-btn.btn',
            inlineStyle: { 'font-weight': 'bold' },
            rules: [
              {
                selector: '.btn',
                source: null,
                origin: 'regular',
                declarations: {
                  padding: '8px 16px',
                  'padding-top': '8px',
                  'padding-right': '16px',
                  'padding-bottom': '8px',
                  'padding-left': '16px'
                },
                inheritedFrom: null
              },
              {
                selector: '#main-btn',
                source: null,
                origin: 'regular',
                declarations: {
                  'background-color': 'blue',
                  color: 'white',
                  'border-radius': '4px',
                  'border-top-left-radius': '4px',
                  'border-top-right-radius': '4px',
                  'border-bottom-right-radius': '4px',
                  'border-bottom-left-radius': '4px'
                },
                inheritedFrom: null
              },
              {
                selector: '.container',
                source: null,
                origin: 'regular',
                declarations: {
                  padding: '20px',
                  margin: '10px',
                  'padding-top': '20px',
                  'padding-right': '20px',
                  'padding-bottom': '20px',
                  'padding-left': '20px',
                  'margin-top': '10px',
                  'margin-right': '10px',
                  'margin-bottom': '10px',
                  'margin-left': '10px'
                },
                inheritedFrom: 'ancestor[1]'
              },
              {
                selector: 'body',
                source: null,
                origin: 'regular',
                declarations: { 'font-family': 'Arial, sans-serif', color: 'rgb(51, 51, 51)' },
                inheritedFrom: 'ancestor[2]'
              }
            ]
          }"
        `)

        const formattedResult = await client.callTool({
            name: 'execute',
            arguments: {
                code: js`
                    let testPage;
                    for (const p of context.pages()) {
                        const html = await p.content();
                        if (html.includes('main-btn')) { testPage = p; break; }
                    }
                    if (!testPage) throw new Error('Test page not found');
                    const btn = testPage.locator('#main-btn');
                    const styles = await getStylesForLocator({ locator: btn });
                    return formatStylesAsText(styles);
                `,
                timeout: 30000,
            },
        })

        expect(formattedResult.isError).toBeFalsy()
        const formattedText = (formattedResult.content as any)[0]?.text || ''
        expect(formattedText).toMatchInlineSnapshot(`
          "[return value] 'Element: button#main-btn.btn\\n' +
            '\\n' +
            'Inline styles:\\n' +
            '  font-weight: bold\\n' +
            '\\n' +
            'Matched rules:\\n' +
            '  .btn {\\n' +
            '    padding: 8px 16px;\\n' +
            '    padding-top: 8px;\\n' +
            '    padding-right: 16px;\\n' +
            '    padding-bottom: 8px;\\n' +
            '    padding-left: 16px;\\n' +
            '  }\\n' +
            '  #main-btn {\\n' +
            '    background-color: blue;\\n' +
            '    color: white;\\n' +
            '    border-radius: 4px;\\n' +
            '    border-top-left-radius: 4px;\\n' +
            '    border-top-right-radius: 4px;\\n' +
            '    border-bottom-right-radius: 4px;\\n' +
            '    border-bottom-left-radius: 4px;\\n' +
            '  }\\n' +
            '\\n' +
            'Inherited from ancestor[1]:\\n' +
            '  .container {\\n' +
            '    padding: 20px;\\n' +
            '    margin: 10px;\\n' +
            '    padding-top: 20px;\\n' +
            '    padding-right: 20px;\\n' +
            '    padding-bottom: 20px;\\n' +
            '    padding-left: 20px;\\n' +
            '    margin-top: 10px;\\n' +
            '    margin-right: 10px;\\n' +
            '    margin-bottom: 10px;\\n' +
            '    margin-left: 10px;\\n' +
            '  }\\n' +
            '\\n' +
            'Inherited from ancestor[2]:\\n' +
            '  body {\\n' +
            '    font-family: Arial, sans-serif;\\n' +
            '    color: rgb(51, 51, 51);\\n' +
            '  }\\n'"
        `)

        await page.close()
    }, 60000)

    it('should return correct layout metrics via CDP', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        const page = await browserContext.newPage()
        await page.goto('https://example.com/')
        await page.bringToFront()

        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })

        await new Promise(r => setTimeout(r, 100))

        const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
        const cdpPage = browser.contexts()[0].pages().find(p => p.url().includes('example.com'))
        expect(cdpPage).toBeDefined()

        const wsUrl = getCdpUrl({ port: TEST_PORT })
        const cdpSession = await getCDPSessionForPage({ page: cdpPage!, wsUrl })

        const layoutMetrics = await cdpSession.send('Page.getLayoutMetrics')

        const normalized = {
            cssLayoutViewport: layoutMetrics.cssLayoutViewport,
            cssVisualViewport: layoutMetrics.cssVisualViewport,
            layoutViewport: layoutMetrics.layoutViewport,
            visualViewport: layoutMetrics.visualViewport,
            devicePixelRatio: layoutMetrics.cssVisualViewport.clientWidth > 0
                ? layoutMetrics.visualViewport.clientWidth / layoutMetrics.cssVisualViewport.clientWidth
                : 1,
        }

        expect(normalized).toMatchInlineSnapshot(`
          {
            "cssLayoutViewport": {
              "clientHeight": 720,
              "clientWidth": 1280,
              "pageX": 0,
              "pageY": 0,
            },
            "cssVisualViewport": {
              "clientHeight": 720,
              "clientWidth": 1280,
              "offsetX": 0,
              "offsetY": 0,
              "pageX": 0,
              "pageY": 0,
              "scale": 1,
              "zoom": 1,
            },
            "devicePixelRatio": 1,
            "layoutViewport": {
              "clientHeight": 720,
              "clientWidth": 1280,
              "pageX": 0,
              "pageY": 0,
            },
            "visualViewport": {
              "clientHeight": 720,
              "clientWidth": 1280,
              "offsetX": 0,
              "offsetY": 0,
              "pageX": 0,
              "pageY": 0,
              "scale": 1,
              "zoom": 1,
            },
          }
        `)

        const windowDpr = await cdpPage!.evaluate(() => (globalThis as any).devicePixelRatio)
        console.log('window.devicePixelRatio:', windowDpr)
        expect(windowDpr).toBe(1)

        cdpSession.close()
        await browser.close()
        await page.close()
    }, 60000)

    it('should support getCDPSession through the relay', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        const page = await browserContext.newPage()
        await page.goto('https://example.com/')
        await page.bringToFront()

        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })

        await new Promise(r => setTimeout(r, 100))

        const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
        const cdpPage = browser.contexts()[0].pages().find(p => p.url().includes('example.com'))
        expect(cdpPage).toBeDefined()

        const wsUrl = getCdpUrl({ port: TEST_PORT })
        const client = await getCDPSessionForPage({ page: cdpPage!, wsUrl })

        const layoutMetrics = await client.send('Page.getLayoutMetrics')
        expect(layoutMetrics.cssVisualViewport).toBeDefined()
        expect(layoutMetrics.cssVisualViewport.clientWidth).toBeGreaterThan(0)

        client.close()
        await browser.close()
        await page.close()
    }, 60000)

    it('should work with stagehand', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        await serviceWorker.evaluate(async () => {
            await globalThis.disconnectEverything()
        })
        await new Promise(r => setTimeout(r, 100))

        const targetUrl = 'https://example.com/'

        const enableResult = await serviceWorker.evaluate(async (url) => {
            const tab = await chrome.tabs.create({ url, active: true })
            await new Promise(r => setTimeout(r, 100))
            return await globalThis.toggleExtensionForActiveTab()
        }, targetUrl)

        console.log('Extension enabled:', enableResult)
        expect(enableResult.isConnected).toBe(true)

        await new Promise(r => setTimeout(r, 100))

        const { Stagehand } = await import('@browserbasehq/stagehand')

        const stagehand = new Stagehand({
            env: 'LOCAL',
            verbose: 1,
            disablePino: true,
            localBrowserLaunchOptions: {
                cdpUrl: getCdpUrl({ port: TEST_PORT }),
            },
        })

        console.log('Initializing Stagehand...')
        await stagehand.init()
        console.log('Stagehand initialized')

        const context = stagehand.context
        // console.log('Stagehand context:', context)
        expect(context).toBeDefined()

        const pages = context.pages()
        console.log('Stagehand pages:', pages.length, pages.map(p => p.url()))

        const stagehandPage = pages.find(p => p.url().includes('example.com'))
        expect(stagehandPage).toBeDefined()

        const url = stagehandPage!.url()
        console.log('Stagehand page URL:', url)
        expect(url).toContain('example.com')

        await stagehand.close()
    }, 60000)

    it('should preserve system color scheme instead of forcing light mode', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        const page = await browserContext.newPage()
        await page.goto('https://example.com')
        await page.bringToFront()

        const colorSchemeBefore = await page.evaluate(() => {
            return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
        })
        console.log('Color scheme before MCP connection:', colorSchemeBefore)

        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })
        await new Promise(r => setTimeout(r, 100))

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

        expect(result.content).toMatchInlineSnapshot(`
          [
            {
              "text": "[return value] { matchesDark: false, matchesLight: true }",
              "type": "text",
            },
          ]
        `)

        await page.close()
    }, 60000)

    it('should get aria ref for locator using getAriaSnapshot', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        const page = await browserContext.newPage()
        await page.setContent(`
            <html>
                <body>
                    <button id="submit-btn">Submit Form</button>
                    <a href="/about">About Us</a>
                    <input type="text" placeholder="Enter your name" />
                </body>
            </html>
        `)
        await page.bringToFront()

        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })
        await new Promise(r => setTimeout(r, 400))

        const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
        let cdpPage
        for (const p of browser.contexts()[0].pages()) {
            const html = await p.content()
            if (html.includes('submit-btn')) {
                cdpPage = p
                break
            }
        }
        expect(cdpPage).toBeDefined()

        const { getAriaSnapshot } = await import('./aria-snapshot.js')

        // Get aria snapshot and verify we can get refs
        const ariaResult = await getAriaSnapshot({ page: cdpPage! })

        expect(ariaResult.snapshot).toBeDefined()
        expect(ariaResult.snapshot.length).toBeGreaterThan(0)
        expect(ariaResult.snapshot).toContain('Submit Form')

        // Verify refToElement map is populated
        expect(ariaResult.refToElement.size).toBeGreaterThan(0)
        console.log('RefToElement map size:', ariaResult.refToElement.size)
        console.log('RefToElement entries:', [...ariaResult.refToElement.entries()])

        // Verify we can select elements using aria-ref selectors
        const btnViaAriaRef = cdpPage!.locator('aria-ref=e2')
        const btnTextViaRef = await btnViaAriaRef.textContent()
        console.log('Button text via aria-ref=e2:', btnTextViaRef)
        expect(btnTextViaRef).toBe('Submit Form')

        // Get ref for the submit button using getRefForLocator
        const submitBtn = cdpPage!.locator('#submit-btn')
        const btnAriaRef = await ariaResult.getRefForLocator(submitBtn)
        console.log('Button ariaRef:', btnAriaRef)
        expect(btnAriaRef).toBeDefined()
        expect(btnAriaRef?.role).toBe('button')
        expect(btnAriaRef?.name).toBe('Submit Form')
        expect(btnAriaRef?.ref).toMatch(/^e\d+$/)

        // Verify the ref matches what we can use to select
        const btnFromRef = cdpPage!.locator(`aria-ref=${btnAriaRef?.ref}`)
        const btnText = await btnFromRef.textContent()
        expect(btnText).toBe('Submit Form')

        // Test getRefStringForLocator
        const btnRefStr = await ariaResult.getRefStringForLocator(submitBtn)
        console.log('Button ref string:', btnRefStr)
        expect(btnRefStr).toBe(btnAriaRef?.ref)

        // Test link
        const aboutLink = cdpPage!.locator('a')
        const linkAriaRef = await ariaResult.getRefForLocator(aboutLink)
        console.log('Link ariaRef:', linkAriaRef)
        expect(linkAriaRef).toBeDefined()
        expect(linkAriaRef?.role).toBe('link')
        expect(linkAriaRef?.name).toBe('About Us')

        // Verify the link ref works
        const linkFromRef = cdpPage!.locator(`aria-ref=${linkAriaRef?.ref}`)
        const linkText = await linkFromRef.textContent()
        expect(linkText).toBe('About Us')

        // Test input field
        const inputField = cdpPage!.locator('input')
        const inputAriaRef = await ariaResult.getRefForLocator(inputField)
        console.log('Input ariaRef:', inputAriaRef)
        expect(inputAriaRef).toBeDefined()
        expect(inputAriaRef?.role).toBe('textbox')

        // Test batch getRefsForLocators - single evaluate call for multiple elements
        const batchRefs = await ariaResult.getRefsForLocators([submitBtn, aboutLink, inputField])
        console.log('Batch refs:', batchRefs)
        expect(batchRefs).toHaveLength(3)
        expect(batchRefs[0]?.ref).toBe(btnAriaRef?.ref)
        expect(batchRefs[1]?.ref).toBe(linkAriaRef?.ref)
        expect(batchRefs[2]?.ref).toBe(inputAriaRef?.ref)

        await browser.close()
        await page.close()
    }, 60000)

    it('should show aria ref labels on real pages and save screenshots', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        const { showAriaRefLabels, hideAriaRefLabels } = await import('./aria-snapshot.js')
        const fs = await import('node:fs')
        const path = await import('node:path')

        // Create assets folder for screenshots
        const assetsDir = path.join(path.dirname(new URL(import.meta.url).pathname), 'assets')
        if (!fs.existsSync(assetsDir)) {
            fs.mkdirSync(assetsDir, { recursive: true })
        }

        const testPages = [
            { name: 'hacker-news', url: 'https://news.ycombinator.com/' },
            { name: 'google', url: 'https://www.google.com/' },
            { name: 'github', url: 'https://github.com/' },
        ]

        // Create all pages and enable extension for each
        const pages = await Promise.all(
            testPages.map(async ({ name, url }) => {
                const page = await browserContext.newPage()
                await page.goto(url, { waitUntil: 'domcontentloaded' })
                return { name, url, page }
            })
        )

        // Enable extension for each tab (must be done sequentially as it uses active tab)
        for (const { page } of pages) {
            await page.bringToFront()
            await serviceWorker.evaluate(async () => {
                await globalThis.toggleExtensionForActiveTab()
            })
        }

        // Connect CDP and process all pages concurrently
        const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))

        await Promise.all(
            pages.map(async ({ name, url, page }) => {
                const cdpPage = browser.contexts()[0].pages().find(p => p.url().includes(new URL(url).hostname))

                if (!cdpPage) {
                    console.log(`Could not find CDP page for ${name}, skipping...`)
                    return
                }

                // Show aria ref labels
                const { snapshot, labelCount } = await showAriaRefLabels({ page: cdpPage })
                console.log(`${name}: ${labelCount} labels shown`)
                expect(labelCount).toBeGreaterThan(0)

                // Take screenshot with labels visible
                const screenshot = await cdpPage.screenshot({ type: 'png', fullPage: false })
                const screenshotPath = path.join(assetsDir, `aria-labels-${name}.png`)
                fs.writeFileSync(screenshotPath, screenshot)
                console.log(`Screenshot saved: ${screenshotPath}`)

                // Save snapshot text for reference
                const snapshotPath = path.join(assetsDir, `aria-labels-${name}-snapshot.txt`)
                fs.writeFileSync(snapshotPath, snapshot)

                // Verify labels are in DOM
                const labelElements = await cdpPage.evaluate(() =>
                    document.querySelectorAll('.__pw_label__').length
                )
                expect(labelElements).toBe(labelCount)

                // Cleanup
                await hideAriaRefLabels({ page: cdpPage })

                // Verify labels removed
                const labelsAfterHide = await cdpPage.evaluate(() =>
                    document.getElementById('__playwriter_labels__')
                )
                expect(labelsAfterHide).toBeNull()

                await page.close()
            })
        )

        await browser.close()
        console.log(`Screenshots saved to: ${assetsDir}`)
    }, 120000)

    it('should take screenshot with accessibility labels via MCP execute tool', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        const page = await browserContext.newPage()
        await page.setContent(`
            <html>
                <head>
                    <style>
                        body {
                            margin: 0;
                            background: #e8f4f8;
                            position: relative;
                            min-height: 100vh;
                        }
                        .controls {
                            padding: 20px;
                            position: relative;
                            z-index: 10;
                        }
                        .grid-marker {
                            position: absolute;
                            background: rgba(255, 100, 100, 0.3);
                            border: 1px solid #ff6464;
                            font-size: 10px;
                            color: #333;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                        }
                        .h-marker {
                            left: 0;
                            width: 100%;
                            height: 20px;
                        }
                        .v-marker {
                            top: 0;
                            height: 100%;
                            width: 20px;
                        }
                    </style>
                </head>
                <body>
                    <div class="controls">
                        <button id="submit-btn">Submit Form</button>
                        <a href="/about">About Us</a>
                        <input type="text" placeholder="Enter your name" />
                    </div>
                    <!-- Horizontal markers every 200px -->
                    <div class="grid-marker h-marker" style="top: 200px;">200px</div>
                    <div class="grid-marker h-marker" style="top: 400px;">400px</div>
                    <div class="grid-marker h-marker" style="top: 600px;">600px</div>
                    <!-- Vertical markers every 200px -->
                    <div class="grid-marker v-marker" style="left: 200px;">200</div>
                    <div class="grid-marker v-marker" style="left: 400px;">400</div>
                    <div class="grid-marker v-marker" style="left: 600px;">600</div>
                    <div class="grid-marker v-marker" style="left: 800px;">800</div>
                    <div class="grid-marker v-marker" style="left: 1000px;">1000</div>
                    <div class="grid-marker v-marker" style="left: 1200px;">1200</div>
                </body>
            </html>
        `)
        await page.bringToFront()

        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })
        await new Promise(r => setTimeout(r, 400))

        // Take screenshot with accessibility labels via MCP
        const result = await client.callTool({
            name: 'execute',
            arguments: {
                code: js`
                    let testPage;
                    for (const p of context.pages()) {
                        const html = await p.content();
                        if (html.includes('submit-btn')) { testPage = p; break; }
                    }
                    if (!testPage) throw new Error('Test page not found');
                    await screenshotWithAccessibilityLabels({ page: testPage });
                `,
                timeout: 15000,
            },
        })

        expect(result.isError).toBeFalsy()

        // Verify response has both text and image content
        const content = result.content as any[]
        expect(content.length).toBe(2)

        // Check text content
        const textContent = content.find(c => c.type === 'text')
        expect(textContent).toBeDefined()
        expect(textContent.text).toContain('Screenshot saved to:')
        expect(textContent.text).toContain('.jpg')
        expect(textContent.text).toContain('Labels shown:')
        expect(textContent.text).toContain('Accessibility snapshot:')
        expect(textContent.text).toContain('Submit Form')

        // Check image content
        const imageContent = content.find(c => c.type === 'image')
        expect(imageContent).toBeDefined()
        expect(imageContent.mimeType).toBe('image/jpeg')
        expect(imageContent.data).toBeDefined()
        expect(imageContent.data.length).toBeGreaterThan(100) // base64 data should be substantial

        // Verify the image is valid JPEG by checking base64
        const buffer = Buffer.from(imageContent.data, 'base64')
        const dimensions = imageSize(buffer)

        // Get actual viewport size from page
        const viewport = await page.evaluate(() => ({
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
            outerWidth: window.outerWidth,
            outerHeight: window.outerHeight,
        }))
        console.log('Screenshot dimensions:', dimensions.width, 'x', dimensions.height)
        console.log('Window viewport:', viewport)

        expect(dimensions.type).toBe('jpg')
        expect(dimensions.width).toBeGreaterThan(0)
        expect(dimensions.height).toBeGreaterThan(0)

        await page.close()
    }, 60000)


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
        await new Promise(r => setTimeout(r, 400))

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
          "[return value] '<div data-testid="main">\\n' +
            ' <h1>Hello World</h1>\\n' +
            ' <button aria-label="Click me">Submit</button>\\n' +
            ' <a href="/about" title="About page">About</a>\\n' +
            ' <input type="text" placeholder="Enter name">\\n' +
            '</div>\\n'"
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
        await new Promise(r => setTimeout(r, 100))

        // 2. Create first page and enable extension
        const page1 = await browserContext.newPage()
        await page1.goto('https://example.com/first-page')
        await page1.bringToFront()

        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })
        await new Promise(r => setTimeout(r, 100))

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
        await new Promise(r => setTimeout(r, 100))

        // 6. Close the first page (which is the default `page` in MCP scope)
        await page1.close()
        await new Promise(r => setTimeout(r, 100))

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

    it('should expose CDP discovery endpoints /json/version and /json/list', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        // Enable extension on a page
        const page = await browserContext.newPage()
        await page.goto('https://example.com')
        await page.bringToFront()

        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })
        await new Promise(r => setTimeout(r, 200))

        // Test /json/version
        const versionRes = await fetch(`http://127.0.0.1:${TEST_PORT}/json/version`)
        expect(versionRes.status).toBe(200)
        const versionJson = await versionRes.json() as { webSocketDebuggerUrl: string }
        expect(versionJson).toMatchObject({
            'Browser': expect.stringContaining('Playwriter/'),
            'Protocol-Version': '1.3',
            'webSocketDebuggerUrl': expect.stringContaining('ws://'),
        })
        expect(versionJson.webSocketDebuggerUrl).toContain(`127.0.0.1:${TEST_PORT}/cdp`)

        // Test /json/version/ (trailing slash - Playwright uses this)
        const versionSlashRes = await fetch(`http://127.0.0.1:${TEST_PORT}/json/version/`)
        expect(versionSlashRes.status).toBe(200)

        // Test /json/list
        const listRes = await fetch(`http://127.0.0.1:${TEST_PORT}/json/list`)
        expect(listRes.status).toBe(200)
        const listJson = await listRes.json() as Array<{ url?: string }>
        expect(Array.isArray(listJson)).toBe(true)
        expect(listJson.length).toBeGreaterThan(0)

        // Find the example.com page (there may be other pages like about:blank)
        const examplePage = listJson.find((t) => t.url?.includes('example.com'))
        expect(examplePage).toBeDefined()
        expect(examplePage).toMatchObject({
            id: expect.any(String),
            type: 'page',
            url: expect.stringContaining('example.com'),
            webSocketDebuggerUrl: expect.stringContaining('ws://'),
        })

        // Test /json (alias for /json/list)
        const jsonRes = await fetch(`http://127.0.0.1:${TEST_PORT}/json`)
        expect(jsonRes.status).toBe(200)
        const jsonData = await jsonRes.json()
        expect(Array.isArray(jsonData)).toBe(true)

        // Test PUT method (Chrome 66+ prefers PUT)
        const putRes = await fetch(`http://127.0.0.1:${TEST_PORT}/json/version`, { method: 'PUT' })
        expect(putRes.status).toBe(200)

        await page.close()
    }, 60000)

})


function tryJsonParse(str: string) {
    try {
        return JSON.parse(str)
    } catch {
        return str
    }
}

describe('CDP Session Tests', () => {
    let testCtx: TestContext | null = null

    beforeAll(async () => {
        testCtx = await setupTestContext({ port: TEST_PORT, tempDirPrefix: 'pw-cdp-test-', toggleExtension: true })

        const serviceWorker = await getExtensionServiceWorker(testCtx.browserContext)
        await serviceWorker.evaluate(async () => {
            await globalThis.disconnectEverything()
        })
        await new Promise(r => setTimeout(r, 100))
    }, 600000)

    afterAll(async () => {
        await cleanupTestContext(testCtx)
        testCtx = null
    })

    const getBrowserContext = () => {
        if (!testCtx?.browserContext) throw new Error('Browser not initialized')
        return testCtx.browserContext
    }

    it('should use Debugger class to set breakpoints and inspect variables', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        const page = await browserContext.newPage()
        await page.goto('https://example.com/')
        await page.bringToFront()

        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })
        await new Promise(r => setTimeout(r, 100))

        const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
        const cdpPage = browser.contexts()[0].pages().find(p => p.url().includes('example.com'))
        expect(cdpPage).toBeDefined()

        const wsUrl = getCdpUrl({ port: TEST_PORT })
        const cdpSession = await getCDPSessionForPage({ page: cdpPage!, wsUrl })
        const dbg = new Debugger({ cdp: cdpSession })

        await dbg.enable()

        expect(dbg.isPaused()).toBe(false)

        const pausedPromise = new Promise<void>((resolve) => {
            cdpSession.on('Debugger.paused', () => {
                resolve()
            })
        })

        cdpPage!.evaluate(`
            (function testFunction() {
                const localVar = 'hello';
                const numberVar = 42;
                debugger;
                return localVar + numberVar;
            })()
        `)

        await Promise.race([
            pausedPromise,
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Debugger.paused timeout')), 5000))
        ])

        expect(dbg.isPaused()).toBe(true)

        const location = await dbg.getLocation()
        expect(location.callstack[0].functionName).toBe('testFunction')
        expect(location.sourceContext).toContain('debugger')

        const vars = await dbg.inspectLocalVariables()
        expect(vars).toMatchInlineSnapshot(`
          {
            "localVar": "hello",
            "numberVar": 42,
          }
        `)

        const evalResult = await dbg.evaluate({ expression: 'localVar + " world"' })
        expect(evalResult.value).toBe('hello world')

        await dbg.resume()
        await new Promise(r => setTimeout(r, 100))
        expect(dbg.isPaused()).toBe(false)

        cdpSession.close()
        await browser.close()
        await page.close()
    }, 60000)

    it('should list scripts with Debugger class', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        const page = await browserContext.newPage()
        await page.setContent(`
            <html>
                <head>
                    <script src="data:text/javascript,function testScript() { return 42; }"></script>
                </head>
                <body><h1>Script Test</h1></body>
            </html>
        `)
        await page.bringToFront()

        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })
        await new Promise(r => setTimeout(r, 100))

        const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
        let cdpPage
        for (const p of browser.contexts()[0].pages()) {
            const html = await p.content()
            if (html.includes('Script Test')) {
                cdpPage = p
                break
            }
        }
        expect(cdpPage).toBeDefined()

        const wsUrl = getCdpUrl({ port: TEST_PORT })
        const cdpSession = await getCDPSessionForPage({ page: cdpPage!, wsUrl })
        const dbg = new Debugger({ cdp: cdpSession })

        const scripts = await dbg.listScripts()
        expect(scripts.length).toBeGreaterThan(0)
        expect(scripts[0]).toHaveProperty('scriptId')
        expect(scripts[0]).toHaveProperty('url')

        const dataScripts = await dbg.listScripts({ search: 'data:' })
        expect(dataScripts.length).toBeGreaterThan(0)

        cdpSession.close()
        await browser.close()
        await page.close()
    }, 60000)

    it('should manage breakpoints with Debugger class', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        const page = await browserContext.newPage()
        await page.setContent(`
            <html>
                <head>
                    <script src="data:text/javascript,function testFunc() { return 42; }"></script>
                </head>
                <body></body>
            </html>
        `)
        await page.bringToFront()

        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })
        await new Promise(r => setTimeout(r, 100))

        const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
        let cdpPage
        for (const p of browser.contexts()[0].pages()) {
            const html = await p.content()
            if (html.includes('testFunc')) {
                cdpPage = p
                break
            }
        }
        expect(cdpPage).toBeDefined()

        const wsUrl = getCdpUrl({ port: TEST_PORT })
        const cdpSession = await getCDPSessionForPage({ page: cdpPage!, wsUrl })
        const dbg = new Debugger({ cdp: cdpSession })

        await dbg.enable()

        expect(dbg.listBreakpoints()).toHaveLength(0)

        const bpId = await dbg.setBreakpoint({ file: 'https://example.com/test.js', line: 1 })
        expect(typeof bpId).toBe('string')
        expect(dbg.listBreakpoints()).toHaveLength(1)
        expect(dbg.listBreakpoints()[0]).toMatchObject({
            id: bpId,
            file: 'https://example.com/test.js',
            line: 1,
        })

        await dbg.deleteBreakpoint({ breakpointId: bpId })
        expect(dbg.listBreakpoints()).toHaveLength(0)

        cdpSession.close()
        await browser.close()
        await page.close()
    }, 60000)

    it('should step through code with Debugger class', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        const page = await browserContext.newPage()
        await page.goto('https://example.com/')
        await page.bringToFront()

        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })
        await new Promise(r => setTimeout(r, 100))

        const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
        const cdpPage = browser.contexts()[0].pages().find(p => p.url().includes('example.com'))
        expect(cdpPage).toBeDefined()

        const wsUrl = getCdpUrl({ port: TEST_PORT })
        const cdpSession = await getCDPSessionForPage({ page: cdpPage!, wsUrl })
        const dbg = new Debugger({ cdp: cdpSession })

        await dbg.enable()

        const pausedPromise = new Promise<void>((resolve) => {
            cdpSession.on('Debugger.paused', () => resolve())
        })

        cdpPage!.evaluate(`
            (function outer() {
                function inner() {
                    const x = 1;
                    debugger;
                    const y = 2;
                    return x + y;
                }
                const result = inner();
                return result;
            })()
        `)

        await pausedPromise
        expect(dbg.isPaused()).toBe(true)

        const location1 = await dbg.getLocation()
        expect(location1.callstack.length).toBeGreaterThanOrEqual(2)
        expect(location1.callstack[0].functionName).toBe('inner')
        expect(location1.callstack[1].functionName).toBe('outer')

        const stepOverPromise = new Promise<void>((resolve) => {
            cdpSession.on('Debugger.paused', () => resolve())
        })
        await dbg.stepOver()
        await stepOverPromise

        const location2 = await dbg.getLocation()
        expect(location2.lineNumber).toBeGreaterThan(location1.lineNumber)

        const stepOutPromise = new Promise<void>((resolve) => {
            cdpSession.on('Debugger.paused', () => resolve())
        })
        await dbg.stepOut()
        await stepOutPromise

        const location3 = await dbg.getLocation()
        expect(location3.callstack[0].functionName).toBe('outer')

        await dbg.resume()

        cdpSession.close()
        await browser.close()
        await page.close()
    }, 60000)

    it('should profile JavaScript execution using CDP Profiler', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        const page = await browserContext.newPage()
        await page.goto('https://example.com/')
        await page.bringToFront()

        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })
        await new Promise(r => setTimeout(r, 100))

        const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
        const cdpPage = browser.contexts()[0].pages().find(p => p.url().includes('example.com'))
        expect(cdpPage).toBeDefined()

        const wsUrl = getCdpUrl({ port: TEST_PORT })
        const cdpSession = await getCDPSessionForPage({ page: cdpPage!, wsUrl })
        await cdpSession.send('Profiler.enable')
        await cdpSession.send('Profiler.start')

        await cdpPage!.evaluate(`
            (() => {
                function fibonacci(n) {
                    if (n <= 1) return n
                    return fibonacci(n - 1) + fibonacci(n - 2)
                }
                for (let i = 0; i < 5; i++) {
                    fibonacci(20)
                }
                for (let i = 0; i < 1000; i++) {
                    document.querySelectorAll('*')
                }
            })()
        `)

        const stopResult = await cdpSession.send('Profiler.stop')
        const profile = stopResult.profile

        const functionNames = profile.nodes
            .map(n => n.callFrame.functionName)
            .filter(name => name && name.length > 0)
            .slice(0, 10)

        expect(profile.nodes.length).toBeGreaterThan(0)
        expect(profile.endTime - profile.startTime).toBeGreaterThan(0)
        expect(functionNames.every((name) => typeof name === 'string')).toBe(true)

        await cdpSession.send('Profiler.disable')
        cdpSession.close()
        await browser.close()
        await page.close()
    }, 60000)

    it('should update Target.getTargets URL after page navigation', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        // Clear any existing connected tabs from previous tests
        await serviceWorker.evaluate(async () => {
            await globalThis.disconnectEverything()
        })

        const page = await browserContext.newPage()
        await page.goto('https://example.com/')
        await page.bringToFront()

        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })
        await new Promise(r => setTimeout(r, 100))

        const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
        const cdpPage = browser.contexts()[0].pages().find(p => p.url().includes('example.com'))
        expect(cdpPage).toBeDefined()

        const wsUrl = getCdpUrl({ port: TEST_PORT })
        const cdpSession = await getCDPSessionForPage({ page: cdpPage!, wsUrl })

        const initialTargets = await cdpSession.send('Target.getTargets')
        const initialPageTarget = initialTargets.targetInfos.find(t => t.type === 'page' && t.url.includes('example.com'))
        expect(initialPageTarget?.url).toBe('https://example.com/')

        await cdpPage!.goto('https://example.org/', { waitUntil: 'domcontentloaded' })
        await new Promise(r => setTimeout(r, 100))

        const afterNavTargets = await cdpSession.send('Target.getTargets')
        const allPageTargets = afterNavTargets.targetInfos.filter(t => t.type === 'page')

        const aboutBlankTargets = allPageTargets.filter(t => t.url === 'about:blank')
        expect(aboutBlankTargets).toHaveLength(0)

        const exampleComTargets = allPageTargets.filter(t => t.url.includes('example.com'))
        expect(exampleComTargets).toHaveLength(0)

        const exampleOrgTargets = allPageTargets.filter(t => t.url.includes('example.org'))
        expect(exampleOrgTargets).toHaveLength(1)

        cdpSession.close()
        await browser.close()
        await page.close()
    }, 60000)

    it('should return correct targets for multiple pages via Target.getTargets', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        // Clear any existing connected tabs from previous tests
        await serviceWorker.evaluate(async () => {
            await globalThis.disconnectEverything()
        })

        const page1 = await browserContext.newPage()
        await page1.goto('https://example.com/')
        await page1.bringToFront()
        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })

        const page2 = await browserContext.newPage()
        await page2.goto('https://example.org/')
        await page2.bringToFront()
        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })

        await new Promise(r => setTimeout(r, 100))

        const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
        const cdpPage = browser.contexts()[0].pages().find(p => p.url().includes('example.com'))
        expect(cdpPage).toBeDefined()

        const wsUrl = getCdpUrl({ port: TEST_PORT })
        const cdpSession = await getCDPSessionForPage({ page: cdpPage!, wsUrl })

        const { targetInfos } = await cdpSession.send('Target.getTargets')
        const allPageTargets = targetInfos.filter(t => t.type === 'page')

        const aboutBlankTargets = allPageTargets.filter(t => t.url === 'about:blank')
        expect(aboutBlankTargets).toHaveLength(0)

        const pageTargets = allPageTargets
            .map(t => ({ type: t.type, url: t.url }))
            .sort((a, b) => a.url.localeCompare(b.url))

        expect(pageTargets).toMatchInlineSnapshot(`
          [
            {
              "type": "page",
              "url": "https://example.com/",
            },
            {
              "type": "page",
              "url": "https://example.org/",
            },
          ]
        `)

        cdpSession.close()
        await browser.close()
        await page1.close()
        await page2.close()
    }, 60000)

    it('should create CDP session for page after navigation', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        const page = await browserContext.newPage()
        await page.goto('https://example.com/')
        await page.bringToFront()

        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })
        await new Promise(r => setTimeout(r, 100))

        await page.goto('https://example.org/', { waitUntil: 'domcontentloaded' })
        await new Promise(r => setTimeout(r, 100))

        const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
        const cdpPage = browser.contexts()[0].pages().find(p => p.url().includes('example.org'))
        expect(cdpPage).toBeDefined()

        const wsUrl = getCdpUrl({ port: TEST_PORT })
        const cdpSession = await getCDPSessionForPage({ page: cdpPage!, wsUrl })

        const evalResult = await cdpSession.send('Runtime.evaluate', {
            expression: 'document.title',
            returnByValue: true,
        })
        expect(evalResult.result.value).toContain('Example Domain')

        cdpSession.close()
        await browser.close()
        await page.close()
    }, 60000)

    it('should maintain CDP session functionality after page URL change', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        const page = await browserContext.newPage()
        const initialUrl = 'https://example.com/'
        await page.goto(initialUrl)
        await page.bringToFront()

        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })
        await new Promise(r => setTimeout(r, 100))

        const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
        const cdpPage = browser.contexts()[0].pages().find(p => p.url().includes('example.com'))
        expect(cdpPage).toBeDefined()

        const wsUrl = getCdpUrl({ port: TEST_PORT })
        const cdpSession = await getCDPSessionForPage({ page: cdpPage!, wsUrl })

        const initialEvalResult = await cdpSession.send('Runtime.evaluate', {
            expression: 'document.title',
            returnByValue: true,
        })
        expect(initialEvalResult.result.value).toBe('Example Domain')

        const newUrl = 'https://example.org/'
        await cdpPage!.goto(newUrl, { waitUntil: 'domcontentloaded' })

        expect(cdpPage!.url()).toBe(newUrl)

        const layoutMetrics = await cdpSession.send('Page.getLayoutMetrics')
        expect(layoutMetrics.cssVisualViewport).toBeDefined()
        expect(layoutMetrics.cssVisualViewport.clientWidth).toBeGreaterThan(0)

        const afterNavEvalResult = await cdpSession.send('Runtime.evaluate', {
            expression: 'document.title',
            returnByValue: true,
        })
        expect(afterNavEvalResult.result.value).toContain('Example Domain')

        const locationResult = await cdpSession.send('Runtime.evaluate', {
            expression: 'window.location.href',
            returnByValue: true,
        })
        expect(locationResult.result.value).toBe(newUrl)

        cdpSession.close()
        await browser.close()
        await page.close()
    }, 60000)

    it('should pause on all exceptions with setPauseOnExceptions', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        const page = await browserContext.newPage()
        await page.goto('https://example.com/')
        await page.bringToFront()

        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })
        await new Promise(r => setTimeout(r, 100))

        const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
        const cdpPage = browser.contexts()[0].pages().find(p => p.url().includes('example.com'))
        expect(cdpPage).toBeDefined()

        const wsUrl = getCdpUrl({ port: TEST_PORT })
        const cdpSession = await getCDPSessionForPage({ page: cdpPage!, wsUrl })
        const dbg = new Debugger({ cdp: cdpSession })

        await dbg.enable()
        await dbg.setPauseOnExceptions({ state: 'all' })

        const pausedPromise = new Promise<void>((resolve) => {
            cdpSession.on('Debugger.paused', () => resolve())
        })

        cdpPage!.evaluate(`
            (function() {
                try {
                    throw new Error('Caught test error');
                } catch (e) {
                    // caught but should still pause with state 'all'
                }
            })()
        `).catch(() => {})

        await Promise.race([
            pausedPromise,
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Debugger.paused timeout')), 5000))
        ])

        expect(dbg.isPaused()).toBe(true)

        const location = await dbg.getLocation()
        expect(location.sourceContext).toContain('throw')

        await dbg.resume()

        await dbg.setPauseOnExceptions({ state: 'none' })

        cdpSession.close()
        await browser.close()
        await page.close()
    }, 60000)

    it('should inspect local and global variables with inline snapshots', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        const page = await browserContext.newPage()
        await page.setContent(`
            <html>
                <head>
                    <script>
                        const GLOBAL_CONFIG = 'production';
                        function runTest() {
                            const userName = 'Alice';
                            const userAge = 25;
                            const settings = { theme: 'dark', lang: 'en' };
                            const scores = [10, 20, 30];
                            debugger;
                            return userName;
                        }
                    </script>
                </head>
                <body>
                    <button onclick="runTest()">Run</button>
                </body>
            </html>
        `)
        await page.bringToFront()

        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })
        await new Promise(r => setTimeout(r, 100))

        const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
        let cdpPage
        for (const p of browser.contexts()[0].pages()) {
            const html = await p.content()
            if (html.includes('runTest')) {
                cdpPage = p
                break
            }
        }
        expect(cdpPage).toBeDefined()

        const wsUrl = getCdpUrl({ port: TEST_PORT })
        const cdpSession = await getCDPSessionForPage({ page: cdpPage!, wsUrl })
        const dbg = new Debugger({ cdp: cdpSession })

        await dbg.enable()

        const globalVars = await dbg.inspectGlobalVariables()
        expect(globalVars).toMatchInlineSnapshot(`
          [
            "GLOBAL_CONFIG",
          ]
        `)

        const pausedPromise = new Promise<void>((resolve) => {
            cdpSession.on('Debugger.paused', () => resolve())
        })

        cdpPage!.evaluate('runTest()')

        await pausedPromise
        expect(dbg.isPaused()).toBe(true)

        const localVars = await dbg.inspectLocalVariables()
        expect(localVars).toMatchInlineSnapshot(`
          {
            "GLOBAL_CONFIG": "production",
            "scores": "[array]",
            "settings": "[object]",
            "userAge": 25,
            "userName": "Alice",
          }
        `)

        await dbg.resume()

        cdpSession.close()
        await browser.close()
        await page.close()
    }, 60000)

    it('should click at correct coordinates on high-DPI simulation', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        const page = await browserContext.newPage()
        await page.goto('https://example.com/')
        await page.bringToFront()

        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })
        await new Promise(r => setTimeout(r, 100))

        const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
        const cdpPage = browser.contexts()[0].pages().find(p => p.url().includes('example.com'))
        expect(cdpPage).toBeDefined()

        const h1Bounds = await cdpPage!.locator('h1').boundingBox()
        expect(h1Bounds).toBeDefined()
        console.log('H1 bounding box:', h1Bounds)

        await cdpPage!.evaluate(() => {
            (window as any).clickedAt = null;
            document.addEventListener('click', (e) => {
                (window as any).clickedAt = { x: e.clientX, y: e.clientY };
            });
        })

        await cdpPage!.locator('h1').click()

        const clickedAt = await cdpPage!.evaluate(() => (window as any).clickedAt)
        console.log('Clicked at:', clickedAt)

        expect(clickedAt).toBeDefined()
        expect(clickedAt.x).toBeGreaterThan(0)
        expect(clickedAt.y).toBeGreaterThan(0)

        await browser.close()
        await page.close()
    }, 60000)

    it('should use Editor class to list, read, and edit scripts', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        const page = await browserContext.newPage()
        await page.goto('https://example.com/')
        await page.bringToFront()

        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })
        await new Promise(r => setTimeout(r, 100))

        const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
        const cdpPage = browser.contexts()[0].pages().find(p => p.url().includes('example.com'))
        expect(cdpPage).toBeDefined()

        const wsUrl = getCdpUrl({ port: TEST_PORT })
        const cdpSession = await getCDPSessionForPage({ page: cdpPage!, wsUrl })
        const editor = new Editor({ cdp: cdpSession })

        await editor.enable()

        await cdpPage!.addScriptTag({
            content: `
                function greetUser(name) {
                    console.log('Hello, ' + name);
                    return 'Hello, ' + name;
                }
            `,
        })
        await new Promise(r => setTimeout(r, 100))
        const scripts = await editor.list()
        expect(scripts.length).toBeGreaterThan(0)

        const matches = await editor.grep({ regex: /greetUser/ })
        expect(matches.length).toBeGreaterThan(0)

        const match = matches[0]
        const { content, totalLines } = await editor.read({ url: match.url })
        expect(content).toContain('greetUser')
        expect(totalLines).toBeGreaterThan(0)

        await editor.edit({
            url: match.url,
            oldString: "console.log('Hello, ' + name);",
            newString: "console.log('Hello, ' + name); console.log('EDITOR_TEST_MARKER');",
        })

        const consoleLogs: string[] = []
        cdpPage!.on('console', msg => {
            consoleLogs.push(msg.text())
        })

        await cdpPage!.evaluate(() => {
            (window as any).greetUser('World')
        })
        await new Promise(r => setTimeout(r, 100))

        expect(consoleLogs).toContain('Hello, World')
        expect(consoleLogs).toContain('EDITOR_TEST_MARKER')

        cdpSession.close()
        await browser.close()
        await page.close()
    }, 60000)

    it('editor can list, read, and edit CSS stylesheets', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        const page = await browserContext.newPage()
        await page.goto('https://example.com/')
        await page.bringToFront()

        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })
        await new Promise(r => setTimeout(r, 100))

        const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
        const cdpPage = browser.contexts()[0].pages().find(p => p.url().includes('example.com'))
        expect(cdpPage).toBeDefined()

        const wsUrl = getCdpUrl({ port: TEST_PORT })
        const cdpSession = await getCDPSessionForPage({ page: cdpPage!, wsUrl })
        const editor = new Editor({ cdp: cdpSession })

        await editor.enable()

        await cdpPage!.addStyleTag({
            content: `
                .editor-test-element {
                    color: rgb(255, 0, 0);
                    background-color: rgb(0, 0, 255);
                }
            `,
        })
        await new Promise(r => setTimeout(r, 100))
        const stylesheets = await editor.list({ pattern: /inline-css:/ })
        expect(stylesheets.length).toBeGreaterThan(0)

        const cssMatches = await editor.grep({ regex: /editor-test-element/, pattern: /inline-css:/ })
        expect(cssMatches.length).toBeGreaterThan(0)

        const cssMatch = cssMatches[0]
        const { content, totalLines } = await editor.read({ url: cssMatch.url })
        expect(content).toContain('editor-test-element')
        expect(content).toContain('rgb(255, 0, 0)')
        expect(totalLines).toBeGreaterThan(0)

        await cdpPage!.evaluate(() => {
            const el = document.createElement('div')
            el.className = 'editor-test-element'
            el.id = 'test-div'
            el.textContent = 'Test'
            document.body.appendChild(el)
        })

        const colorBefore = await cdpPage!.evaluate(() => {
            const el = document.getElementById('test-div')!
            return window.getComputedStyle(el).color
        })
        expect(colorBefore).toBe('rgb(255, 0, 0)')

        await editor.edit({
            url: cssMatch.url,
            oldString: 'color: rgb(255, 0, 0);',
            newString: 'color: rgb(0, 255, 0);',
        })

        const colorAfter = await cdpPage!.evaluate(() => {
            const el = document.getElementById('test-div')!
            return window.getComputedStyle(el).color
        })
        expect(colorAfter).toBe('rgb(0, 255, 0)')

        cdpSession.close()
        await browser.close()
        await page.close()
    }, 60000)

    it('should inject bippy and find React fiber with getReactSource', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        const page = await browserContext.newPage()
        await page.setContent(`
            <!DOCTYPE html>
            <html>
            <head>
                <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
                <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
            </head>
            <body>
                <div id="root"></div>
                <script>
                    function MyComponent() {
                        return React.createElement('button', { id: 'react-btn' }, 'Click me');
                    }
                    const root = ReactDOM.createRoot(document.getElementById('root'));
                    root.render(React.createElement(MyComponent));
                </script>
            </body>
            </html>
        `)
        await page.bringToFront()

        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })
        await new Promise(r => setTimeout(r, 500))

        const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
        const pages = browser.contexts()[0].pages()
        const cdpPage = pages.find(p => p.url().startsWith('about:'))
        expect(cdpPage).toBeDefined()

        const btn = cdpPage!.locator('#react-btn')
        const btnCount = await btn.count()
        expect(btnCount).toBe(1)

        const hasBippyBefore = await cdpPage!.evaluate(() => !!(globalThis as any).__bippy)
        expect(hasBippyBefore).toBe(false)

        const wsUrl = getCdpUrl({ port: TEST_PORT })
        const cdpSession = await getCDPSessionForPage({ page: cdpPage!, wsUrl })

        const { getReactSource } = await import('./react-source.js')
        const source = await getReactSource({ locator: btn, cdp: cdpSession })

        const hasBippyAfter = await cdpPage!.evaluate(() => !!(globalThis as any).__bippy)
        expect(hasBippyAfter).toBe(true)

        const hasFiber = await btn.evaluate((el) => {
            const bippy = (globalThis as any).__bippy
            const fiber = bippy.getFiberFromHostInstance(el)
            return !!fiber
        })
        expect(hasFiber).toBe(true)

        const componentName = await btn.evaluate((el) => {
            const bippy = (globalThis as any).__bippy
            const fiber = bippy.getFiberFromHostInstance(el)
            let current = fiber
            while (current) {
                if (bippy.isCompositeFiber(current)) {
                    return bippy.getDisplayName(current.type)
                }
                current = current.return
            }
            return null
        })
        expect(componentName).toBe('MyComponent')

        console.log('Component name from fiber:', componentName)
        console.log('Source location (null for UMD React, works on local dev servers with JSX transform):', source)

        await browser.close()
        await page.close()
    }, 60000)
})

describe('Service Worker Target Tests', () => {
    let testCtx: TestContext | null = null

    beforeAll(async () => {
        testCtx = await setupTestContext({ port: TEST_PORT, tempDirPrefix: 'pw-sw-test-', toggleExtension: true })
    }, 600000)

    afterAll(async () => {
        await cleanupTestContext(testCtx)
        testCtx = null
    })

    const getBrowserContext = () => {
        if (!testCtx?.browserContext) throw new Error('Browser not initialized')
        return testCtx.browserContext
    }

    it('should not expose service worker targets to Playwright (issue #14)', async () => {
        // This test verifies that service worker targets are NOT forwarded to Playwright.
        // Issue #14: pages with service workers cause problems because Playwright tries to
        // initialize service worker sessions with Runtime.enable/Network.enable, which
        // times out waiting for executionContextCreated (service workers don't have main frames).
        //
        // The fix is to filter out non-page targets (service_worker, worker, etc.) in the
        // server so Playwright never sees them.

        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        // web.dev has a service worker - navigate there
        const page = await browserContext.newPage()
        await page.goto('https://web.dev/', { waitUntil: 'load' })
        await page.bringToFront()

        // Attach extension to the page
        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })
        await new Promise(r => setTimeout(r, 500))

        // Connect via Playwright CDP - this triggers Target.setAutoAttach
        const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
        const context = browser.contexts()[0]

        // Get all targets/pages that Playwright knows about
        const pages = context.pages()

        // All pages should be actual pages, not service workers or workers
        for (const p of pages) {
            const url = p.url()
            console.log('Page URL:', url)
            // Service workers would have URLs like https://web.dev/sw.js
            expect(url).not.toMatch(/sw\.js$/i)
            expect(url).not.toMatch(/service.?worker/i)
        }

        // Verify we can interact with the main page
        const targetPage = pages.find(p => p.url().includes('web.dev'))
        expect(targetPage).toBeDefined()

        const title = await targetPage!.title()
        expect(title).toBeTruthy()

        await browser.close()
        await page.close()
    }, 60000)

    it('should allow reading response bodies after re-enabling Network buffering', async () => {
        // By default, the relay sets maxTotalBufferSize: 0 to fix SSE streaming.
        // This test verifies that agents can re-enable buffering to read response bodies
        // using Playwright's response.body() API after re-enabling Network buffering via CDP.

        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        const page = await browserContext.newPage()
        await page.goto('https://example.com/')
        await page.bringToFront()

        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })
        await new Promise(r => setTimeout(r, 100))

        const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
        const cdpPage = browser.contexts()[0].pages().find(p => p.url().includes('example.com'))
        expect(cdpPage).toBeDefined()

        // Get CDP session to re-enable buffering (must use getCDPSessionForPage, not newCDPSession)
        const wsUrl = getCdpUrl({ port: TEST_PORT })
        const cdpSession = await getCDPSessionForPage({ page: cdpPage!, wsUrl })

        // Re-enable Network domain with buffering to allow response.body() to work
        await cdpSession.send('Network.disable')
        await cdpSession.send('Network.enable', {
            maxTotalBufferSize: 10000000,
            maxResourceBufferSize: 5000000
        })

        // Use Playwright's response API to capture and read response body
        const [response] = await Promise.all([
            cdpPage!.waitForResponse(resp => resp.url() === 'https://example.com/'),
            cdpPage!.goto('https://example.com/')
        ])

        // Now response.body() should work because we re-enabled buffering
        const body = await response.text()

        expect(body).toBeDefined()
        expect(body).toContain('Example Domain')
        expect(body).toContain('</html>')

        cdpSession.close()
        await browser.close()
        await page.close()
    }, 60000)

    it('should stream SSE without waiting for response end', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await withTimeout({
            promise: getExtensionServiceWorker(browserContext),
            timeoutMs: 5000,
            errorMessage: 'getExtensionServiceWorker timed out',
        })
        const sseServer = await withTimeout({
            promise: createSseServer(),
            timeoutMs: 5000,
            errorMessage: 'createSseServer timed out',
        })
        let page: Awaited<ReturnType<typeof browserContext.newPage>> | null = null
        let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null = null

        try {
            page = await withTimeout({
                promise: browserContext.newPage(),
                timeoutMs: 5000,
                errorMessage: 'newPage timed out',
            })
            await withTimeout({
                promise: page.goto(`${sseServer.baseUrl}/`),
                timeoutMs: 5000,
                errorMessage: 'page.goto timed out',
            })
            await page.bringToFront()

            await withTimeout({
                promise: serviceWorker.evaluate(async () => {
                    await globalThis.toggleExtensionForActiveTab()
                }),
                timeoutMs: 5000,
                errorMessage: 'toggleExtensionForActiveTab timed out',
            })
            await new Promise((resolve) => {
                setTimeout(resolve, 100)
            })

            browser = await withTimeout({
                promise: chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT })),
                timeoutMs: 5000,
                errorMessage: 'connectOverCDP timed out',
            })
            const cdpPage = browser.contexts()[0].pages().find((p) => {
                return p.url().startsWith(sseServer.baseUrl)
            })
            expect(cdpPage).toBeDefined()

            await cdpPage!.evaluate(() => {
                return window.startSse()
            })
            await withTimeout({
                promise: cdpPage!.waitForFunction(() => {
                    return window.__sseMessages.length > 0
                }, { timeout: 5000 }),
                timeoutMs: 7000,
                errorMessage: 'SSE message not received in time',
            })

            const firstMessage = await cdpPage!.evaluate(() => {
                return window.__sseMessages[0]
            })
            expect(firstMessage).toBe('hello')

            const sseState = sseServer.getState()
            expect(sseState.connected).toBe(true)
            expect(sseState.finished).toBe(false)
            expect(sseState.closed).toBe(false)
            expect(sseState.writeCount).toBeGreaterThan(0)

            const readyState = await cdpPage!.evaluate(() => {
                if (!window.__sseSource) {
                    return -1
                }
                return window.__sseSource.readyState
            })
            expect(readyState).toBe(1)

            await cdpPage!.evaluate(() => {
                window.stopSse()
            })
            await new Promise((resolve) => {
                setTimeout(resolve, 100)
            })
        } finally {
            if (browser) {
                await withTimeout({
                    promise: browser.close(),
                    timeoutMs: 5000,
                    errorMessage: 'browser.close timed out',
                })
            }
            if (page) {
                await withTimeout({
                    promise: page.close(),
                    timeoutMs: 5000,
                    errorMessage: 'page.close timed out',
                })
            }
            await withTimeout({
                promise: sseServer.close(),
                timeoutMs: 5000,
                errorMessage: 'sseServer.close timed out',
            })
        }
    }, 60000)
})

describe('Auto-enable Tests', () => {
    let testCtx: TestContext | null = null
    let client: Awaited<ReturnType<typeof createMCPClient>>['client']
    let cleanup: (() => Promise<void>) | null = null

    beforeAll(async () => {
        process.env.PLAYWRITER_AUTO_ENABLE = '1'
        testCtx = await setupTestContext({ port: TEST_PORT, tempDirPrefix: 'pw-auto-test-' })

        const result = await createMCPClient({ port: TEST_PORT })
        client = result.client
        cleanup = result.cleanup

        // Disconnect all tabs to start with a clean state
        const serviceWorker = await getExtensionServiceWorker(testCtx.browserContext)
        await serviceWorker.evaluate(async () => {
            await globalThis.disconnectEverything()
        })
        await new Promise(r => setTimeout(r, 100))
    }, 600000)

    afterAll(async () => {
        delete process.env.PLAYWRITER_AUTO_ENABLE
        await cleanupTestContext(testCtx, cleanup)
        cleanup = null
        testCtx = null
    })

    const getBrowserContext = () => {
        if (!testCtx?.browserContext) throw new Error('Browser not initialized')
        return testCtx.browserContext
    }

    it('should auto-create a tab when Playwright connects and no tabs exist', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        // Ensure clean state - disconnect any tabs from previous tests or setup
        await serviceWorker.evaluate(async () => {
            await globalThis.disconnectEverything()
        })
        await new Promise(r => setTimeout(r, 100))

        // Verify no tabs are connected
        const tabCountBefore = await serviceWorker.evaluate(() => {
            const state = globalThis.getExtensionState()
            return state.tabs.size
        })
        expect(tabCountBefore).toBe(0)

        // Connect Playwright - this should trigger auto-create
        const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))

        // Verify a page was auto-created
        const pages = browser.contexts()[0].pages()
        expect(pages.length).toBeGreaterThan(0)
        expect(pages.length).toBe(1)

        const autoCreatedPage = pages[0]
        expect(autoCreatedPage.url()).toBe('about:blank')

        // Verify extension state shows the tab as connected
        const tabCountAfter = await serviceWorker.evaluate(() => {
            const state = globalThis.getExtensionState()
            return state.tabs.size
        })
        expect(tabCountAfter).toBe(1)

        // Verify we can interact with the auto-created page
        await autoCreatedPage.setContent('<h1>Auto-created page</h1>')
        const title = await autoCreatedPage.locator('h1').textContent()
        expect(title).toBe('Auto-created page')

        await browser.close()
    }, 60000)

    it('should auto-create a page when MCP executes with no connected pages', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        await serviceWorker.evaluate(async () => {
            await globalThis.disconnectEverything()
        })
        await new Promise((r) => { setTimeout(r, 100) })

        const tabCountBefore = await serviceWorker.evaluate(() => {
            const state = globalThis.getExtensionState()
            return state.tabs.size
        })
        expect(tabCountBefore).toBe(0)

        const result = await client.callTool({
            name: 'execute',
            arguments: {
                code: js`
                    return { pageCount: context.pages().length, url: page.url() };
                `,
            },
        })

        expect((result as any).isError).toBeFalsy()
        const text = (result as any).content[0].text
        expect(text).toContain('pageCount')
        expect(text).toContain('about:blank')

        const tabCountAfter = await serviceWorker.evaluate(() => {
            const state = globalThis.getExtensionState()
            return state.tabs.size
        })
        expect(tabCountAfter).toBe(1)

        await client.callTool({
            name: 'execute',
            arguments: {
                code: js`
                    await page.close();
                    return { remaining: context.pages().length };
                `,
            },
        })

        await new Promise((r) => { setTimeout(r, 100) })

        const afterCloseResult = await client.callTool({
            name: 'execute',
            arguments: {
                code: js`
                    return { pageCount: context.pages().length, url: page.url() };
                `,
            },
        })

        expect((afterCloseResult as any).isError).toBeFalsy()
        const afterCloseText = (afterCloseResult as any).content[0].text
        expect(afterCloseText).toContain('pageCount')
        expect(afterCloseText).toContain('about:blank')
    }, 60000)
})
