import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { chromium } from 'playwright-core'
import { getCdpUrl } from './utils.js'
import { setupTestContext, cleanupTestContext, getExtensionServiceWorker, type TestContext, withTimeout, createSimpleServer } from './test-utils.js'
import './test-declarations.js'

const TEST_PORT = 19992

describe('Relay Navigation Tests', () => {
    let testCtx: TestContext | null = null

    beforeAll(async () => {
        testCtx = await setupTestContext({ port: TEST_PORT, tempDirPrefix: 'pw-nav-test-', toggleExtension: true })
    }, 600000)

    afterAll(async () => {
        await cleanupTestContext(testCtx)
        testCtx = null
    })

    const getBrowserContext = () => {
        if (!testCtx?.browserContext) throw new Error('Browser not initialized')
        return testCtx.browserContext
    }

    it('should be usable after toggle with valid URL', async () => {
        // Validates the extension waits for a non-empty URL before attaching.

        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)
        const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
        const context = browser.contexts()[0]

        const server = await createSimpleServer({
            routes: {
                '/': '<!doctype html><html><body>ok</body></html>',
            },
        })

        const page = await browserContext.newPage()
        try {
            await page.goto(server.baseUrl, { waitUntil: 'domcontentloaded' })
            await page.bringToFront()

            const pagePromise = context.waitForEvent('page', { timeout: 5000 })

            await serviceWorker.evaluate(async () => {
                await globalThis.toggleExtensionForActiveTab()
            })

            const targetPage = await pagePromise
            console.log('Page URL when event fired:', targetPage.url())

            expect(targetPage.url()).not.toBe('')
            expect(targetPage.url()).not.toBe(':')
            expect(targetPage.url()).toContain(server.baseUrl)

            const result = await targetPage.evaluate(() => window.location.href)
            expect(result).toContain(server.baseUrl)
        } finally {
            await browser.close()
            await page.close()
            await server.close()
        }
    }, 15000)

    it('should expose iframe frames when connecting to an existing page over CDP', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        const childServer = await createSimpleServer({
            routes: {
                '/child.html': '<!doctype html><html><body>child</body></html>',
            },
        })
        const childUrl = `${childServer.baseUrl}/child.html`

        const parentServer = await createSimpleServer({
            routes: {
                '/': `<!doctype html><html><body><iframe src="${childUrl}"></iframe></body></html>`,
            },
        })

        const page = await browserContext.newPage()
        try {
            await withTimeout({
                promise: page.goto(parentServer.baseUrl, { waitUntil: 'domcontentloaded', timeout: 5000 }),
                timeoutMs: 6000,
                errorMessage: 'Timed out loading parent page for iframe test',
            })
            await withTimeout({
                promise: page.frameLocator('iframe').locator('body').waitFor({ timeout: 5000 }),
                timeoutMs: 6000,
                errorMessage: 'Timed out waiting for iframe to attach in parent page',
            })
            expect(page.frames().map((frame) => frame.url())).toContain(childUrl)
            await page.bringToFront()

            await withTimeout({
                promise: serviceWorker.evaluate(async () => {
                    await globalThis.toggleExtensionForActiveTab()
                }),
                timeoutMs: 5000,
                errorMessage: 'Timed out toggling extension for iframe test',
            })
            await new Promise((r) => { setTimeout(r, 400) })

            const browser = await withTimeout({
                promise: chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT })),
                timeoutMs: 5000,
                errorMessage: 'Timed out connecting over CDP for iframe test',
            })
            const context = browser.contexts()[0]
            const cdpPage = context.pages().find((candidate) => {
                return candidate.url().startsWith(parentServer.baseUrl)
            })
            expect(cdpPage).toBeDefined()

            const frames = cdpPage!.frames()
            const childFrame = frames.find((frame) => {
                return frame.url() === childUrl
            })

            expect(frames.length).toBe(2)
            expect(childFrame).toBeDefined()

            await withTimeout({
                promise: browser.close(),
                timeoutMs: 5000,
                errorMessage: 'Timed out closing CDP browser for iframe test',
            })
        } finally {
            await withTimeout({
                promise: page.close(),
                timeoutMs: 5000,
                errorMessage: 'Timed out closing page for iframe test',
            })
            await Promise.all([
                parentServer.close(),
                childServer.close(),
            ])
        }
    }, 60000)

    it('should have non-empty URLs when connecting to already-loaded pages', async () => {
        const _browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(_browserContext)

        const page = await _browserContext.newPage()
        await page.goto('https://discord.com/login', { waitUntil: 'load' })
        await page.bringToFront()

        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })

        const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
        const context = browser.contexts()[0]

        const pages = context.pages()
        console.log('All page URLs:', pages.map(p => p.url()))

        expect(pages.length).toBeGreaterThan(0)
        for (const p of pages) {
            expect(p.url()).not.toBe('')
            expect(p.url()).not.toBe(':')
            expect(p.url()).not.toBeUndefined()
        }

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

        const response = await cdpPage!.goto('https://www.youtube.com', { waitUntil: 'domcontentloaded', timeout: 20000 })
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

    it('should expose CDP discovery endpoints /json/version and /json/list', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

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

        // Test /json/version/ (trailing slash)
        const versionSlashRes = await fetch(`http://127.0.0.1:${TEST_PORT}/json/version/`)
        expect(versionSlashRes.status).toBe(200)

        // Test /json/list
        const listRes = await fetch(`http://127.0.0.1:${TEST_PORT}/json/list`)
        expect(listRes.status).toBe(200)
        const listJson = await listRes.json() as Array<{ url?: string }>
        expect(Array.isArray(listJson)).toBe(true)
        expect(listJson.length).toBeGreaterThan(0)

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

    // Skip: chrome.tabCapture.getMediaStreamId() requires activeTab permission
    it.skip('should record screen with navigation using chrome.tabCapture', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)
        const path = await import('node:path')
        const fs = await import('node:fs')

        const recordingPage = await browserContext.newPage()
        await recordingPage.goto('https://news.ycombinator.com/', { waitUntil: 'domcontentloaded' })
        await recordingPage.bringToFront()
        
        await serviceWorker.evaluate(async () => {
            await globalThis.toggleExtensionForActiveTab()
        })
        await new Promise(r => setTimeout(r, 200))

        const outputPath = path.join(process.cwd(), 'tmp', 'test-recording.mp4')
        if (!fs.existsSync(path.dirname(outputPath))) {
            fs.mkdirSync(path.dirname(outputPath), { recursive: true })
        }

        const { startRecording, stopRecording, isRecording } = await import('./screen-recording.js')
        
        const startResult = await startRecording({
            page: recordingPage,
            outputPath,
            frameRate: 30,
            audio: false,
            videoBitsPerSecond: 1500000,
            relayPort: TEST_PORT,
        })
        expect(startResult.isRecording).toBe(true)

        await recordingPage.locator('.titleline a').first().click()
        await recordingPage.waitForLoadState('domcontentloaded')
        await new Promise(r => setTimeout(r, 500))
        
        await recordingPage.goBack()
        await recordingPage.waitForLoadState('domcontentloaded')

        const status = await isRecording({ page: recordingPage, relayPort: TEST_PORT })
        expect(status.isRecording).toBe(true)

        const stopResult = await stopRecording({ page: recordingPage, relayPort: TEST_PORT })
        expect(stopResult.path).toBe(outputPath)
        expect(stopResult.size).toBeGreaterThan(10000)
        expect(fs.existsSync(outputPath)).toBe(true)

        await recordingPage.close()
        fs.unlinkSync(outputPath)
    }, 60000)
})
