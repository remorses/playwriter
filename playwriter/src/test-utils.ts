import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { chromium, BrowserContext } from 'playwright-core'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { startPlayWriterCDPRelayServer, type RelayServer } from './cdp-relay.js'
import { createFileLogger } from './create-logger.js'
import { killPortProcess } from 'kill-port-process'

const execAsync = promisify(exec)

export async function getExtensionServiceWorker(context: BrowserContext) {
  let serviceWorkers = context.serviceWorkers().filter((sw) => sw.url().startsWith('chrome-extension://'))
  let serviceWorker = serviceWorkers[0]
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent('serviceworker', {
      predicate: (sw) => sw.url().startsWith('chrome-extension://'),
    })
  }

  for (let i = 0; i < 50; i++) {
    const isReady = await serviceWorker.evaluate(() => {
      // @ts-ignore
      return typeof globalThis.toggleExtensionForActiveTab === 'function'
    })
    if (isReady) {
      break
    }
    await new Promise((r) => setTimeout(r, 100))
  }

  return serviceWorker
}

export interface TestContext {
  browserContext: BrowserContext
  userDataDir: string
  relayServer: RelayServer
}

export async function setupTestContext({
  port,
  tempDirPrefix,
  toggleExtension = false,
}: {
  port: number
  tempDirPrefix: string
  /** Create initial page and toggle extension on it */
  toggleExtension?: boolean
}): Promise<TestContext> {
  await killPortProcess(port).catch(() => {})

  console.log('Building extension...')
  await execAsync(`TESTING=1 PLAYWRITER_PORT=${port} pnpm build`, { cwd: '../extension' })
  console.log('Extension built')

  const localLogPath = path.join(process.cwd(), 'relay-server.log')
  const logger = createFileLogger({ logFilePath: localLogPath })
  const relayServer = await startPlayWriterCDPRelayServer({ port, logger })

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), tempDirPrefix))
  const extensionPath = path.resolve('../extension/dist')

  const browserContext = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: !process.env.HEADFUL,
    colorScheme: 'dark',
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  })

  const serviceWorker = await getExtensionServiceWorker(browserContext)

  if (toggleExtension) {
    const page = await browserContext.newPage()
    await page.goto('about:blank')
    await serviceWorker.evaluate(async () => {
      await (globalThis as any).toggleExtensionForActiveTab()
    })
  }

  return { browserContext, userDataDir, relayServer }
}

export async function cleanupTestContext(ctx: TestContext | null, cleanup?: (() => Promise<void>) | null): Promise<void> {
  if (ctx?.browserContext) {
    await ctx.browserContext.close()
  }
  if (ctx?.relayServer) {
    ctx.relayServer.close()
  }

  if (ctx?.userDataDir) {
    try {
      fs.rmSync(ctx.userDataDir, { recursive: true, force: true })
    } catch (e) {
      console.error('Failed to cleanup user data dir:', e)
    }
  }
  if (cleanup) {
    await cleanup()
  }
}
