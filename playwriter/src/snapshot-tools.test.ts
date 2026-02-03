import { createMCPClient } from './mcp-client.js'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { chromium } from 'playwright-core'
import type { Page } from 'playwright-core'
import type { AriaSnapshotNode } from './aria-snapshot.js'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { imageSize } from 'image-size'
import { getCdpUrl } from './utils.js'
import { getCDPSessionForPage } from './cdp-session.js'
import type { CDPCommand } from './cdp-types.js'
import { screenshotWithAccessibilityLabels } from './aria-snapshot.js'
import { setupTestContext, cleanupTestContext, getExtensionServiceWorker, type TestContext, js } from './test-utils.js'
import './test-declarations.js'

const TEST_PORT = 19991

describe('Snapshot & Screenshot Tests', () => {
    let client: Awaited<ReturnType<typeof createMCPClient>>['client']
    let cleanup: (() => Promise<void>) | null = null
    let testCtx: TestContext | null = null

    beforeAll(async () => {
        testCtx = await setupTestContext({ port: TEST_PORT, tempDirPrefix: 'pw-snap-test-', toggleExtension: true })

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

        await new Promise(r => setTimeout(r, 400))

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
          "[return value] Element: button#main-btn.btn

          Inline styles:
            font-weight: bold

          Matched rules:
            .btn {
              padding: 8px 16px;
              padding-top: 8px;
              padding-right: 16px;
              padding-bottom: 8px;
              padding-left: 16px;
            }
            #main-btn {
              background-color: blue;
              color: white;
              border-radius: 4px;
              border-top-left-radius: 4px;
              border-top-right-radius: 4px;
              border-bottom-right-radius: 4px;
              border-bottom-left-radius: 4px;
            }

          Inherited from ancestor[1]:
            .container {
              padding: 20px;
              margin: 10px;
              padding-top: 20px;
              padding-right: 20px;
              padding-bottom: 20px;
              padding-left: 20px;
              margin-top: 10px;
              margin-right: 10px;
              margin-bottom: 10px;
              margin-left: 10px;
            }

          Inherited from ancestor[2]:
            body {
              font-family: Arial, sans-serif;
              color: rgb(51, 51, 51);
            }"
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
        const cdpClient = await getCDPSessionForPage({ page: cdpPage!, wsUrl })

        const layoutMetrics = await cdpClient.send('Page.getLayoutMetrics')
        expect(layoutMetrics.cssVisualViewport).toBeDefined()
        expect(layoutMetrics.cssVisualViewport.clientWidth).toBeGreaterThan(0)

        cdpClient.close()
        await browser.close()
        await page.close()
    }, 60000)

    it('should get aria ref for locator using getAriaSnapshot', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        const page = await browserContext.newPage()
        // Use data-testid for stable refs, regular id for the button
        await page.setContent(`
            <html>
                <body>
                    <button data-testid="submit-btn">Submit Form</button>
                    <a href="/about" data-testid="about-link">About Us</a>
                    <input type="text" placeholder="Enter your name" data-testid="name-input" />
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

        const ariaResult = await getAriaSnapshot({
          page: cdpPage!,
          wsUrl: getCdpUrl({ port: TEST_PORT }),
        })

        expect(ariaResult.snapshot).toBeDefined()
        expect(ariaResult.snapshot.length).toBeGreaterThan(0)
        expect(ariaResult.snapshot).toContain('Submit Form')
        // Snapshot lines include Playwright locators for interactive elements
        expect(ariaResult.snapshot).toContain('[data-testid="submit-btn"]')
        expect(ariaResult.snapshot).toContain('[data-testid="about-link"]')
        expect(ariaResult.snapshot).toContain('[data-testid="name-input"]')

        const flattenNodes = (nodes: AriaSnapshotNode[]): AriaSnapshotNode[] => {
          return nodes.flatMap((node) => {
            return [node, ...flattenNodes(node.children)]
          })
        }

        const allNodes = flattenNodes(ariaResult.tree)
        const findByLocator = (locator: string) => {
          return allNodes.find((node) => node.locator === locator)
        }

        const submitNode = findByLocator('[data-testid="submit-btn"]')
        const aboutNode = findByLocator('[data-testid="about-link"]')
        const nameNode = findByLocator('[data-testid="name-input"]')

        expect(submitNode).toBeDefined()
        expect(aboutNode).toBeDefined()
        expect(nameNode).toBeDefined()

        const submitLocator = cdpPage!.locator(submitNode!.locator!)
        const aboutLocator = cdpPage!.locator(aboutNode!.locator!)
        const nameLocator = cdpPage!.locator(nameNode!.locator!)

        expect(await submitLocator.count()).toBe(1)
        expect(await aboutLocator.count()).toBe(1)
        expect(await nameLocator.count()).toBe(1)

        expect(await submitLocator.textContent()).toBe('Submit Form')
        expect(await aboutLocator.textContent()).toBe('About Us')
        expect(await nameLocator.getAttribute('placeholder')).toBe('Enter your name')

        expect(ariaResult.refToElement.size).toBeGreaterThan(0)
        console.log('RefToElement map size:', ariaResult.refToElement.size)
        console.log('RefToElement entries:', [...ariaResult.refToElement.entries()])

        // Verify refs are stable test IDs
        expect(ariaResult.refToElement.has('submit-btn')).toBe(true)
        expect(ariaResult.refToElement.has('about-link')).toBe(true)
        expect(ariaResult.refToElement.has('name-input')).toBe(true)

        // Use getSelectorForRef to get CSS selector for a ref
        const btnSelector = ariaResult.getSelectorForRef('submit-btn')
        expect(btnSelector).toBeDefined()
        console.log('Button selector:', btnSelector)

        // Verify the selector works
        const btnViaSelector = cdpPage!.locator(btnSelector!)
        const btnTextViaRef = await btnViaSelector.textContent()
        console.log('Button text via selector:', btnTextViaRef)
        expect(btnTextViaRef).toBe('Submit Form')

        // Test role and name
        const btnInfo = ariaResult.refToElement.get('submit-btn')
        expect(btnInfo?.role).toBe('button')
        expect(btnInfo?.name).toBe('Submit Form')

        const linkInfo = ariaResult.refToElement.get('about-link')
        expect(linkInfo?.role).toBe('link')
        expect(linkInfo?.name).toBe('About Us')

        const inputInfo = ariaResult.refToElement.get('name-input')
        expect(inputInfo?.role).toBe('textbox')

        await browser.close()
        await page.close()
    }, 60000)

    it('should show aria ref labels on real pages and save screenshots', async () => {
        const browserContext = getBrowserContext()
        const serviceWorker = await getExtensionServiceWorker(browserContext)

        const { showAriaRefLabels, hideAriaRefLabels } = await import('./aria-snapshot.js')

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

        const loadPageWithRetries = async ({ name, url }: { name: string; url: string }) => {
            const page = await browserContext.newPage()
            page.setDefaultNavigationTimeout(60000)

            const attempts = 2
            let lastError: unknown = null
            for (let attempt = 1; attempt <= attempts; attempt += 1) {
                try {
                    console.log(`[labels] opening ${name}: ${url} (attempt ${attempt}/${attempts})`)
                    await page.goto(url, { waitUntil: 'domcontentloaded' })
                    await page.waitForLoadState('networkidle', { timeout: 15000 })
                    console.log(`[labels] loaded ${name}: ${page.url()}`)
                    return { name, url, page }
                } catch (error) {
                    lastError = error
                }
            }

            await page.close()
            throw new Error(`Failed to load ${name} after ${attempts} attempts`, { cause: lastError instanceof Error ? lastError : undefined })
        }

        const pages: Array<{ name: string; url: string; page: Page }> = []
        for (const testPage of testPages) {
            pages.push(await loadPageWithRetries(testPage))
        }

        for (const { page } of pages) {
            await page.bringToFront()
            await serviceWorker.evaluate(async () => {
                await globalThis.toggleExtensionForActiveTab()
            })
        }

        const browser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))

        const withTimeout = async <T,>(label: string, task: () => Promise<T>, timeoutMs: number): Promise<T> => {
            let timeoutId: NodeJS.Timeout | null = null
            const timeoutPromise = new Promise<never>((_, reject) => {
                timeoutId = setTimeout(() => {
                    reject(new Error(`Timed out after ${timeoutMs}ms: ${label}`))
                }, timeoutMs)
            })

            try {
                return await Promise.race([task(), timeoutPromise])
            } finally {
                if (timeoutId) {
                    clearTimeout(timeoutId)
                }
            }
        }

        const wsUrl = getCdpUrl({ port: TEST_PORT })

        for (const { name, url, page } of pages) {
            console.log(`[labels] start ${name}`)
            const cdpPage = browser.contexts()[0].pages().find(p => p.url().includes(new URL(url).hostname))

            if (!cdpPage) {
                throw new Error(`Could not find CDP page for ${name}`)
            }

            console.log(`[labels] show labels ${name}`)
            const { labelCount } = await withTimeout(
                `showAriaRefLabels(${name})`,
                async () => {
                    return await showAriaRefLabels({ page: cdpPage, wsUrl })
                },
                60000
            )
            console.log(`${name}: ${labelCount} labels shown`)
            if (name !== 'google') {
              expect(labelCount).toBeGreaterThan(0)
            }

            console.log(`[labels] screenshot ${name}`)
            const screenshot = await withTimeout(
                `screenshot(${name})`,
                async () => {
                    return await cdpPage.screenshot({ type: 'png', fullPage: false })
                },
                30000
            )
            const screenshotPath = path.join(assetsDir, `aria-labels-${name}.png`)
            fs.writeFileSync(screenshotPath, screenshot)
            console.log(`Screenshot saved: ${screenshotPath}`)

            console.log(`[labels] count dom labels ${name}`)
            const labelElements = await withTimeout(
                `countLabels(${name})`,
                async () => {
                    return await cdpPage.evaluate(() =>
                        document.querySelectorAll('.__pw_label__').length
                    )
                },
                10000
            )
            expect(labelElements).toBe(labelCount)

            console.log(`[labels] hide labels ${name}`)
            await withTimeout(
                `hideAriaRefLabels(${name})`,
                async () => {
                    await hideAriaRefLabels({ page: cdpPage })
                },
                10000
            )

            const labelsAfterHide = await withTimeout(
                `verifyHide(${name})`,
                async () => {
                    return await cdpPage.evaluate(() =>
                        document.getElementById('__playwriter_labels__')
                    )
                },
                10000
            )
            expect(labelsAfterHide).toBeNull()

            console.log(`[labels] close page ${name}`)
            await page.close()
        }

        await browser.close()
        console.log(`Screenshots saved to: ${assetsDir}`)
    }, 180000)

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

        const content = result.content as any[]
        expect(content.length).toBe(2)

        const textContent = content.find(c => c.type === 'text')
        expect(textContent).toBeDefined()
        expect(textContent.text).toContain('Screenshot saved to:')
        expect(textContent.text).toContain('.jpg')
        expect(textContent.text).toContain('Labels shown:')
        expect(textContent.text).toContain('Accessibility snapshot:')
        expect(textContent.text).toContain('Submit Form')

        const imageContent = content.find(c => c.type === 'image')
        expect(imageContent).toBeDefined()
        expect(imageContent.mimeType).toBe('image/jpeg')
        expect(imageContent.data).toBeDefined()
        expect(imageContent.data.length).toBeGreaterThan(100)

        const buffer = Buffer.from(imageContent.data, 'base64')
        const dimensions = imageSize(buffer)

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
})
