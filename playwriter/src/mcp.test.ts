import { createMCPClient } from './mcp-client.js'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { chromium, BrowserContext } from 'playwright-core'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { getCdpUrl } from './utils.js'

import { spawn } from 'node:child_process'


const execAsync = promisify(exec)

async function getExtensionServiceWorker(context: BrowserContext) {

    let serviceWorkers = context.serviceWorkers().filter(sw => sw.url().startsWith('chrome-extension://'))


    let serviceWorker = serviceWorkers[0]
    if (!serviceWorker) {
        serviceWorker = await context.waitForEvent('serviceworker', {
            predicate: (sw) => sw.url().startsWith('chrome-extension://')
        })
    }


    return serviceWorker
}

function js(strings: TemplateStringsArray, ...values: any[]): string {
    return strings.reduce(
        (result, str, i) => result + str + (values[i] || ''),
        '',
    )
}

async function killProcessOnPort(port: number): Promise<void> {
    try {
        const { stdout } = await execAsync(`lsof -ti:${port}`)
        const pids = stdout.trim().split('\n').filter(Boolean)
        if (pids.length > 0) {
            await execAsync(`kill -9 ${pids.join(' ')}`)
            console.log(`Killed processes ${pids.join(', ')} on port ${port}`)
            await new Promise((resolve) => setTimeout(resolve, 1000))
        }
    } catch (error) {
        // No process running on port or already killed
    }
}

declare global {
    var toggleExtensionForActiveTab: () => Promise<{ isConnected: boolean; state: any }>;
    var getExtensionState: () => { connectedTabs: Map<number, { targetId: string }> };
    var disconnectEverything: () => Promise<void>;
    var chrome: any;
}

describe('MCP Server Tests', () => {
    let client: Awaited<ReturnType<typeof createMCPClient>>['client']
    let cleanup: (() => Promise<void>) | null = null
    let browserContext: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | null = null
    let userDataDir: string
    let relayServerProcess: any

    beforeAll(async () => {
        await killProcessOnPort(19988)

        // Build extension
        console.log('Building extension...')
        await execAsync('TESTING=1 pnpm build', { cwd: '../extension' })
        console.log('Extension built')

        // Start Relay Server manually
        relayServerProcess = spawn('pnpm', ['tsx', 'src/start-relay-server.ts'], {
            cwd: process.cwd(),
            stdio: 'inherit'
        })

        // Wait for port 19988 to be ready
        await new Promise<void>((resolve, reject) => {
             let retries = 0
             const interval = setInterval(async () => {
                 try {
                     const { stdout } = await execAsync('lsof -ti:19988')
                     if (stdout.trim()) {
                         clearInterval(interval)
                         resolve()
                     }
                 } catch {
                     // ignore
                 }
                 retries++
                 if (retries > 30) {
                     clearInterval(interval)
                     reject(new Error('Relay server failed to start'))
                 }
             }, 1000)
        })

        const result = await createMCPClient()
        client = result.client
        cleanup = result.cleanup

        userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-test-'))
        const extensionPath = path.resolve('../extension/dist')

        browserContext = await chromium.launchPersistentContext(userDataDir, {
          channel: 'chromium', // <- this opts into new headless
          headless: !process.env.HEADFUL,
            args: [
                `--disable-extensions-except=${extensionPath}`,
                `--load-extension=${extensionPath}`,
            ],
        })

        // Wait for service worker and connect
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        // Wait for extension to initialize global functions
        for (let i = 0; i < 50; i++) {
             const isReady = await serviceWorker.evaluate(() => {
                 // @ts-ignore
                 return typeof globalThis.toggleExtensionForActiveTab === 'function'
             })
             if (isReady) break
             await new Promise(r => setTimeout(r, 100))
        }

        // Create a page to attach to
        const page = await browserContext.newPage()
        await page.goto('about:blank')

        // Connect the tab
        await serviceWorker.evaluate(async () => {
             await globalThis.toggleExtensionForActiveTab()
        })

    }, 600000) // 10 minutes timeout

    afterAll(async () => {
        if (browserContext) {
            await browserContext.close()
        }
        if (relayServerProcess) {
            relayServerProcess.kill()
        }
        await killProcessOnPort(19988)

        if (userDataDir) {
             try {
                fs.rmSync(userDataDir, { recursive: true, force: true })
            } catch (e) {
                console.error('Failed to cleanup user data dir:', e)
            }
        }
        if (cleanup) {
            await cleanup()
            cleanup = null
        }
    })

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
          await state.page.goto('https://news.ycombinator.com');
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
          [log] Page title: Hacker News

          Return value:
          {
            "url": "https://news.ycombinator.com/",
            "title": "Hacker News"
          }",
              "type": "text",
            },
          ]
        `)
        expect(result.content).toBeDefined()
    }, 30000)

    it('should show extension as connected for pages created via newPage()', async () => {
        if (!browserContext) throw new Error('Browser not initialized')
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
            const chrome = globalThis.chrome
            const tabs = await chrome.tabs.query({})
            const testTab = tabs.find((t: any) => t.url?.includes('mcp-test'))
            return {
                connected: !!testTab && state.connectedTabs.has(testTab.id),
                tabId: testTab?.id,
                tabInfo: testTab ? state.connectedTabs.get(testTab.id) : null,
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
          await state.page.goto('https://news.ycombinator.com/item?id=1', { waitUntil: 'networkidle' });
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
          await state.page.goto('https://ui.shadcn.com/', { waitUntil: 'networkidle' });
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
        if (!browserContext) throw new Error('Browser not initialized')

        // Find the correct service worker by URL
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

        let directBrowser = await chromium.connectOverCDP(getCdpUrl())
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
        directBrowser = await chromium.connectOverCDP(getCdpUrl())
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

        directBrowser = await chromium.connectOverCDP(getCdpUrl())
        // Wait a bit for targets to populate
        await new Promise(r => setTimeout(r, 500))

        contexts = directBrowser.contexts()
        // pages() might need a moment if target attached event comes in
        if (contexts[0].pages().length === 0) {
             await new Promise(r => setTimeout(r, 1000))
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
        if (!browserContext) throw new Error('Browser not initialized')

        const serviceWorker = await getExtensionServiceWorker(browserContext)

        // Connect once
        const directBrowser = await chromium.connectOverCDP(getCdpUrl())
        // Wait a bit for connection and initial target discovery
        await new Promise(r => setTimeout(r, 500))

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
        if (!browserContext) throw new Error('Browser not initialized')
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
        const cdpUrl = getCdpUrl()
        const directBrowser = await chromium.connectOverCDP(cdpUrl)
        const connectedPage = directBrowser.contexts()[0].pages().find(p => p.url() === initialUrl)
        expect(connectedPage).toBeDefined()

        // Verify execution
        expect(await connectedPage?.evaluate(() => 1 + 1)).toBe(2)

        // 4. Reload
        // We use a loop to check if it's still connected because reload might cause temporary disconnect/reconnect events
        // that Playwright handles natively if the session ID stays valid.
        await connectedPage?.reload()
        await connectedPage?.waitForLoadState('networkidle')
        expect(await connectedPage?.title()).toBe('Example Domain')

        // Verify execution after reload
        expect(await connectedPage?.evaluate(() => 2 + 2)).toBe(4)

        // 5. Navigate to new URL
        const newUrl = 'https://news.ycombinator.com/'
        await connectedPage?.goto(newUrl)
        await connectedPage?.waitForLoadState('networkidle')

        expect(connectedPage?.url()).toBe(newUrl)
        expect(await connectedPage?.title()).toContain('Hacker News')

        // Verify execution after navigation
        expect(await connectedPage?.evaluate(() => 3 + 3)).toBe(6)

        await directBrowser.close()
        await page.close()
    })

    it('should support multiple concurrent tabs', async () => {
        if (!browserContext) throw new Error('Browser not initialized')
        const serviceWorker = await getExtensionServiceWorker(browserContext)
        await new Promise(resolve => setTimeout(resolve, 500))

        // Tab A
        const pageA = await browserContext.newPage()
        await pageA.goto('https://example.com/tab-a')
        await pageA.bringToFront()
        await new Promise(resolve => setTimeout(resolve, 500))
        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })

        // Tab B
        const pageB = await browserContext.newPage()
        await pageB.goto('https://example.com/tab-b')
        await pageB.bringToFront()
        await new Promise(resolve => setTimeout(resolve, 500))
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
                 idA: state.connectedTabs.get(tabA?.id)?.targetId,
                 idB: state.connectedTabs.get(tabB?.id)?.targetId
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
        const browser = await chromium.connectOverCDP(getCdpUrl())

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

    it('should support multiple concurrent tabs', async () => {
        if (!browserContext) throw new Error('Browser not initialized')
        const serviceWorker = await getExtensionServiceWorker(browserContext)
        await new Promise(resolve => setTimeout(resolve, 500))

        // Tab A
        const pageA = await browserContext.newPage()
        await pageA.goto('https://example.com/tab-a')
        await pageA.bringToFront()
        await new Promise(resolve => setTimeout(resolve, 500))
        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })

        // Tab B
        const pageB = await browserContext.newPage()
        await pageB.goto('https://example.com/tab-b')
        await pageB.bringToFront()
        await new Promise(resolve => setTimeout(resolve, 500))
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
                 idA: state.connectedTabs.get(tabA?.id)?.targetId,
                 idB: state.connectedTabs.get(tabB?.id)?.targetId
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
        const browser = await chromium.connectOverCDP(getCdpUrl())

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
        if (!browserContext) throw new Error('Browser not initialized')
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        // 1. Open a new page (extension not yet enabled for it)
        const page = await browserContext.newPage()
        const targetUrl = 'https://example.com/late-enable'
        await page.goto(targetUrl)
        await page.bringToFront()

        // Wait for load
        await page.waitForLoadState('networkidle')

        // 2. Enable extension for this page
        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })

        // 3. Verify via CDP that the correct URL is shown
        const browser = await chromium.connectOverCDP(getCdpUrl())
        // Wait for sync
        await new Promise(r => setTimeout(r, 1000))

        const cdpPage = browser.contexts()[0].pages().find(p => p.url() === targetUrl)

        expect(cdpPage).toBeDefined()
        expect(cdpPage?.url()).toBe(targetUrl)

        await browser.close()
        await page.close()
    })

    it('should be able to reconnect after disconnecting everything', async () => {
        if (!browserContext) throw new Error('Browser not initialized')
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        // 1. Use the existing about:blank page from beforeAll
        const pages = await browserContext.pages()
        expect(pages.length).toBeGreaterThan(0)
        const page = pages[0]
        
        await page.goto('https://example.com/disconnect-test')
        await page.waitForLoadState('networkidle')
        await page.bringToFront()
        
        // Enable extension on this page
        const initialEnable = await serviceWorker.evaluate(async () => {
            return await globalThis.toggleExtensionForActiveTab()
        })
        console.log('Initial enable result:', initialEnable)
        expect(initialEnable.isConnected).toBe(true)
        
        // Wait for extension to fully connect
        await new Promise(resolve => setTimeout(resolve, 500))

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
        await new Promise(resolve => setTimeout(resolve, 500))

        // 3. Verify MCP cannot see the page anymore
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
        expect(afterDisconnectOutput).toContain('Pages after disconnect: 0')

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
        await new Promise(resolve => setTimeout(resolve, 1000))

        // 5. Reset the MCP client's playwright connection since it was closed by disconnectEverything
        console.log('Resetting MCP playwright connection...')
        const resetResult = await client.callTool({
            name: 'execute',
            arguments: {
                code: js`
          console.log('Resetting playwright connection');
          const result = await resetPlaywright();
          console.log('Reset complete, checking pages');
          const pages = context.pages();
          console.log('Pages after reset:', pages.length);
          return { reset: true, pagesCount: pages.length };
        `,
            },
        })
        console.log('Reset result:', (resetResult as any).content[0].text)

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
          const logs = await getLatestLogs({ searchFilter: 'error' });
          logs.forEach(log => console.log(log));
        `,
            },
        })

        const errorOutput = (errorLogsResult as any).content[0].text
        expect(errorOutput).toContain('[error] Test error 67890')
        expect(errorOutput).not.toContain('[log] Test log 12345')

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

})


function tryJsonParse(str: string) {
    try {
        return JSON.parse(str)
    } catch {
        return str
    }
}
