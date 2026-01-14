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
const TEST_PORT = 19985 // Use different port to avoid conflicts

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

describe('Cookie API E2E Tests', () => {
  let browserContext: BrowserContext
  let relayServer: RelayServer
  let userDataDir: string
  let playwrightBrowser: Browser
  let testPage: Page

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

    // Start relay server
    const localLogPath = path.join(process.cwd(), 'test-cookie-api.log')
    const logger = createFileLogger({ logFilePath: localLogPath })
    relayServer = await startPlayWriterCDPRelayServer({ 
      port: TEST_PORT, 
      logger 
    })

    // Launch browser with extension
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-cookie-test-'))
    const extensionPath = path.resolve(__dirname, '../../extension/dist')

    browserContext = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    })

    // Wait for extension to be ready and enable it
    const serviceWorker = await getExtensionServiceWorker(browserContext)
    const page = await browserContext.newPage()
    await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 10000 })
    await serviceWorker.evaluate(async () => {
      // @ts-ignore
      await globalThis.toggleExtensionForActiveTab()
    })
    await sleep(1000)

    // Connect playwright to the relay
    const cdpUrl = getCdpUrl({ port: TEST_PORT })
    playwrightBrowser = await chromium.connectOverCDP(cdpUrl)
    
    const context = playwrightBrowser.contexts()[0]
    testPage = context.pages()[0]
    
    // Ensure we're on example.com
    if (!testPage.url().includes('example.com')) {
      await testPage.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 10000 })
    }

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

  it('should add cookies via context.addCookies()', async () => {
    const context = playwrightBrowser.contexts()[0]
    
    await context.addCookies([{
      name: 'test_cookie',
      value: 'test_value_123',
      domain: 'example.com',
      path: '/'
    }])

    // Verify via context.cookies()
    const cookies = await context.cookies()
    const found = cookies.find(c => c.name === 'test_cookie')
    
    expect(found).toBeDefined()
    expect(found?.value).toBe('test_value_123')
  }, 10000)

  it('should read cookies via context.cookies()', async () => {
    const context = playwrightBrowser.contexts()[0]
    
    const cookies = await context.cookies()
    
    expect(Array.isArray(cookies)).toBe(true)
    // Should have at least the test_cookie from previous test
    expect(cookies.length).toBeGreaterThan(0)
  }, 10000)

  it('should read cookies filtered by URL', async () => {
    const context = playwrightBrowser.contexts()[0]
    
    // Add a cookie for example.com specifically
    await context.addCookies([{
      name: 'url_test_cookie',
      value: 'url_test_value',
      domain: 'example.com',
      path: '/'
    }])
    
    const cookies = await context.cookies('https://example.com')
    const found = cookies.find(c => c.name === 'url_test_cookie')
    
    expect(found).toBeDefined()
    expect(found?.value).toBe('url_test_value')
  }, 10000)

  it('should clear cookies via context.clearCookies()', async () => {
    const context = playwrightBrowser.contexts()[0]
    
    // First add a cookie
    await context.addCookies([{
      name: 'cookie_to_clear',
      value: 'will_be_cleared',
      domain: 'example.com',
      path: '/'
    }])
    
    // Verify it exists
    let cookies = await context.cookies()
    let found = cookies.find(c => c.name === 'cookie_to_clear')
    expect(found).toBeDefined()
    
    // Clear all cookies
    await context.clearCookies()
    
    // Verify it's gone
    cookies = await context.cookies()
    found = cookies.find(c => c.name === 'cookie_to_clear')
    expect(found).toBeUndefined()
  }, 10000)

  it('should add multiple cookies at once', async () => {
    const context = playwrightBrowser.contexts()[0]
    
    await context.addCookies([
      { name: 'multi_1', value: 'value_1', domain: 'example.com', path: '/' },
      { name: 'multi_2', value: 'value_2', domain: 'example.com', path: '/' },
      { name: 'multi_3', value: 'value_3', domain: 'example.com', path: '/' },
    ])
    
    const cookies = await context.cookies()
    const found1 = cookies.find(c => c.name === 'multi_1')
    const found2 = cookies.find(c => c.name === 'multi_2')
    const found3 = cookies.find(c => c.name === 'multi_3')
    
    expect(found1?.value).toBe('value_1')
    expect(found2?.value).toBe('value_2')
    expect(found3?.value).toBe('value_3')
    
    // Cleanup
    await context.clearCookies()
  }, 10000)

  it('should get storage state via context.storageState()', async () => {
    const context = playwrightBrowser.contexts()[0]
    
    // Add a cookie first
    await context.addCookies([{
      name: 'storage_test',
      value: 'storage_value',
      domain: 'example.com',
      path: '/'
    }])
    
    const state = await context.storageState()
    
    expect(state).toBeDefined()
    expect(typeof state).toBe('object')
    expect(state).toHaveProperty('cookies')
    expect(state).toHaveProperty('origins')
    expect(Array.isArray(state.cookies)).toBe(true)
    
    // Should have our test cookie
    const found = state.cookies.find((c: any) => c.name === 'storage_test')
    expect(found).toBeDefined()
    
    // Cleanup
    await context.clearCookies()
  }, 10000)

  it('should handle cookies with URL-encoded special characters in value', async () => {
    const context = playwrightBrowser.contexts()[0]
    
    // Note: semicolons are not allowed in cookie values per spec, use URL encoding
    const specialValue = 'hello%3Dworld%3Btest%26foo'
    
    await context.addCookies([{
      name: 'special_cookie',
      value: specialValue,
      domain: 'example.com',
      path: '/'
    }])
    
    const cookies = await context.cookies()
    const found = cookies.find(c => c.name === 'special_cookie')
    
    expect(found).toBeDefined()
    expect(found?.value).toBe(specialValue)
    
    // Cleanup
    await context.clearCookies()
  }, 10000)

  it('should set cookie with expiration', async () => {
    const context = playwrightBrowser.contexts()[0]
    
    const expires = Math.floor(Date.now() / 1000) + 3600 // 1 hour from now
    
    await context.addCookies([{
      name: 'expiring_cookie',
      value: 'will_expire',
      domain: 'example.com',
      path: '/',
      expires
    }])
    
    const cookies = await context.cookies()
    const found = cookies.find(c => c.name === 'expiring_cookie')
    
    expect(found).toBeDefined()
    expect(found?.expires).toBeGreaterThan(Date.now() / 1000)
    
    // Cleanup
    await context.clearCookies()
  }, 10000)
})
