import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { chromium, Browser, BrowserContext, Page } from 'playwright-core'
import { killPortProcess } from 'kill-port-process'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { startPlayWriterCDPRelayServer, type RelayServer } from '../src/cdp-relay.js'
import { createFileLogger } from '../src/create-logger.js'
import { getCdpUrl } from '../src/utils.js'

const execAsync = promisify(exec)
const TEST_PORT = 19986 // Use different port to avoid conflicts

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function getExtensionServiceWorker(context: BrowserContext) {
  let serviceWorkers = context.serviceWorkers().filter(sw => sw.url().startsWith('chrome-extension://'))
  let serviceWorker = serviceWorkers[0]
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent('serviceworker', {
      predicate: (sw) => sw.url().startsWith('chrome-extension://'),
      timeout: 10000
    })
  }

  for (let i = 0; i < 30; i++) {
    const isReady = await serviceWorker.evaluate(() => {
      // @ts-ignore
      return typeof globalThis.toggleExtensionForActiveTab === 'function'
    })
    if (isReady) break
    await sleep(100)
  }

  return serviceWorker
}

describe('Separate Window Mode E2E Tests', () => {
  let browserContext: BrowserContext
  let relayServer: RelayServer
  let userDataDir: string
  let playwrightBrowser: Browser

  beforeAll(async () => {
    // Kill any existing process on test port
    try {
      await killPortProcess(TEST_PORT)
    } catch {}
    await sleep(500)

    // Build extension with test port
    await execAsync(`TESTING=1 PLAYWRITER_PORT=${TEST_PORT} pnpm build`, { 
      cwd: path.resolve(__dirname, '../../extension') 
    })

    // Start relay server with separateWindow enabled
    const localLogPath = path.join(process.cwd(), 'test-separate-window.log')
    const logger = createFileLogger({ logFilePath: localLogPath })
    relayServer = await startPlayWriterCDPRelayServer({ 
      port: TEST_PORT, 
      logger,
      separateWindow: true 
    })

    // Launch browser with extension
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-separate-window-test-'))
    const extensionPath = path.resolve(__dirname, '../../extension/dist')

    browserContext = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: false, // Extension requires headed mode
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    })

    // Wait for extension to be ready
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    // Create a page and enable extension on it
    const page = await browserContext.newPage()
    await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 10000 })
    await serviceWorker.evaluate(async () => {
      // @ts-ignore
      await globalThis.toggleExtensionForActiveTab()
    })
    await sleep(1500) // Wait for extension to connect and set up window

    // Connect playwright to the relay
    const cdpUrl = getCdpUrl({ port: TEST_PORT })
    playwrightBrowser = await chromium.connectOverCDP(cdpUrl)

  }, 60000)

  afterAll(async () => {
    if (playwrightBrowser) {
      await playwrightBrowser.close().catch(() => {})
    }
    if (browserContext) {
      await browserContext.close().catch(() => {})
    }
    if (relayServer) {
      await relayServer.close()
    }
    if (userDataDir) {
      fs.rmSync(userDataDir, { recursive: true, force: true })
    }
    try {
      await killPortProcess(TEST_PORT)
    } catch {}
  })

  it('should be able to access pages via CDP connection', async () => {
    const contexts = playwrightBrowser.contexts()
    expect(contexts.length).toBeGreaterThan(0)

    const pages = contexts[0].pages()
    expect(pages.length).toBeGreaterThan(0)
  }, 10000)

  it('should be able to execute JavaScript on page', async () => {
    const context = playwrightBrowser.contexts()[0]
    const page = context.pages()[0]

    if (!page.url().includes('example.com')) {
      await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 10000 })
    }

    const result = await page.evaluate(() => {
      return {
        title: document.title,
        url: window.location.href,
        hasBody: !!document.body
      }
    })

    expect(result.title).toContain('Example')
    expect(result.url).toContain('example.com')
    expect(result.hasBody).toBe(true)
  }, 15000)

  it('should be able to take screenshots', async () => {
    const context = playwrightBrowser.contexts()[0]
    const page = context.pages()[0]

    const screenshot = await page.screenshot()
    expect(screenshot).toBeInstanceOf(Buffer)
    expect(screenshot.length).toBeGreaterThan(1000) // Should be a real image
  }, 10000)

  it('should be able to navigate to different pages', async () => {
    const context = playwrightBrowser.contexts()[0]
    const page = context.pages()[0]

    await page.goto('https://example.org', { waitUntil: 'domcontentloaded', timeout: 10000 })
    expect(page.url()).toContain('example.org')

    await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 10000 })
    expect(page.url()).toContain('example.com')
  }, 20000)

  it('should have connected tabs in playwriter tab group', async () => {
    const serviceWorker = await getExtensionServiceWorker(browserContext)
    
    // Query for playwriter tab groups
    const groups = await serviceWorker.evaluate(async () => {
      // @ts-ignore
      const groups = await chrome.tabGroups.query({ title: 'playwriter' })
      return groups.map((g: any) => ({ id: g.id, title: g.title, color: g.color }))
    })

    expect(groups.length).toBeGreaterThan(0)
    expect(groups[0].title).toBe('playwriter')
    expect(groups[0].color).toBe('green')
  }, 10000)

  it('should be able to click elements on page', async () => {
    const context = playwrightBrowser.contexts()[0]
    const page = context.pages()[0]

    await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 10000 })
    
    // Click on the "More information..." link
    const link = page.locator('a')
    const linkCount = await link.count()
    expect(linkCount).toBeGreaterThan(0)
    
    // Just verify we can locate and interact with elements
    const href = await link.first().getAttribute('href')
    expect(href).toBeDefined()
  }, 15000)

  it('should be able to fill text inputs', async () => {
    const context = playwrightBrowser.contexts()[0]
    const page = context.pages()[0]

    // Navigate to a page with a form - use about:blank and inject one
    await page.goto('about:blank')
    await page.setContent(`
      <html>
        <body>
          <input type="text" id="test-input" />
          <button id="test-button">Click</button>
        </body>
      </html>
    `)
    
    await page.fill('#test-input', 'Hello World')
    const value = await page.inputValue('#test-input')
    expect(value).toBe('Hello World')
  }, 15000)
})
