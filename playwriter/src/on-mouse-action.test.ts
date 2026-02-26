/**
 * Test for the page.onMouseAction callback added to the playwright fork.
 * Verifies the callback fires for both explicit page.mouse.* calls
 * and locator-initiated actions like page.locator().click().
 */
import { chromium } from '@xmorse/playwright-core'
import type { MouseActionEvent, Page } from '@xmorse/playwright-core'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getCdpUrl } from './utils.js'
import { enableGhostCursor, applyGhostCursorMouseAction, disableGhostCursor } from './ghost-cursor.js'
import {
  setupTestContext,
  cleanupTestContext,
  getExtensionServiceWorker,
  type TestContext,
  safeCloseCDPBrowser,
} from './test-utils.js'
import './test-declarations.js'

const TEST_PORT = 19994

describe('onMouseAction callback', () => {
  let cleanup: (() => Promise<void>) | null = null
  let testCtx: TestContext | null = null

  beforeAll(async () => {
    testCtx = await setupTestContext({
      port: TEST_PORT,
      tempDirPrefix: 'pw-mouse-action-test-',
      toggleExtension: true,
    })
  }, 600000)

  afterAll(async () => {
    await cleanupTestContext(testCtx, cleanup)
    cleanup = null
    testCtx = null
  })

  it('should fire onMouseAction for page.mouse.click()', async () => {
    const browserContext = testCtx!.browserContext
    const serviceWorker = await getExtensionServiceWorker(browserContext)

    const page = await browserContext.newPage()
    await page.goto('data:text/html,<html><body><button id="btn">Click me</button></body></html>')
    await page.bringToFront()

    await serviceWorker.evaluate(async () => {
      await (globalThis as any).toggleExtensionForActiveTab()
    })
    await new Promise((r) => { setTimeout(r, 200) })

    const directBrowser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
    const contexts = directBrowser.contexts()
    const pages = contexts[0].pages()
    const targetPage = pages.find((p) => p.url().startsWith('data:'))
    expect(targetPage).toBeDefined()

    const events: MouseActionEvent[] = []
    targetPage!.onMouseAction = async (event) => {
      events.push({ ...event })
    }

    await targetPage!.mouse.click(100, 100)

    // click dispatches: move → down → up
    const types = events.map((e) => e.type)
    expect(types).toContain('move')
    expect(types).toContain('down')
    expect(types).toContain('up')

    // All events should have coordinates
    for (const event of events) {
      expect(typeof event.x).toBe('number')
      expect(typeof event.y).toBe('number')
      expect(typeof event.button).toBe('string')
    }

    // The move event should have the target coordinates
    const moveEvent = events.find((e) => e.type === 'move')!
    expect(moveEvent.x).toBe(100)
    expect(moveEvent.y).toBe(100)

    await safeCloseCDPBrowser(directBrowser)
  }, 30000)

  it('should fire onMouseAction for locator.click()', async () => {
    const browserContext = testCtx!.browserContext

    const directBrowser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
    const contexts = directBrowser.contexts()
    const pages = contexts[0].pages()
    const targetPage = pages.find((p) => p.url().startsWith('data:'))
    expect(targetPage).toBeDefined()

    const events: MouseActionEvent[] = []
    targetPage!.onMouseAction = async (event) => {
      events.push({ ...event })
    }

    // locator.click() resolves coordinates server-side, then calls server Mouse
    await targetPage!.locator('#btn').click()

    const types = events.map((e) => e.type)
    expect(types).toContain('move')
    expect(types).toContain('down')
    expect(types).toContain('up')

    // The button center should be somewhere reasonable (not 0,0)
    const moveEvent = events.find((e) => e.type === 'move')!
    expect(moveEvent.x).toBeGreaterThan(0)
    expect(moveEvent.y).toBeGreaterThan(0)

    await safeCloseCDPBrowser(directBrowser)
  }, 30000)

  it('should animate ghost cursor from onMouseAction callback', async () => {
    const browserContext = testCtx!.browserContext

    const directBrowser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
    let targetPage: Page | null = null
    try {
      const contexts = directBrowser.contexts()
      const pages = contexts[0].pages()
      targetPage = pages.find((p) => p.url().startsWith('data:'))!
      expect(targetPage).toBeDefined()
      const pageForTest = targetPage

      await enableGhostCursor({ page: pageForTest })
      pageForTest.onMouseAction = async (event) => {
        await applyGhostCursorMouseAction({ page: pageForTest, event })
      }

      await pageForTest.mouse.click(140, 120)

      const cursorState = await pageForTest.evaluate(() => {
        const cursorElement = document.getElementById('__playwriter_ghost_cursor__')
        if (!cursorElement) {
          return { exists: false, transform: '' }
        }
        return {
          exists: true,
          transform: cursorElement.getAttribute('style') || '',
        }
      })

      expect(cursorState.exists).toBe(true)
      const translateMatch = cursorState.transform.match(/translate3d\(([-\d.]+)px, ([-\d.]+)px, 0(?:px)?\)/)
      expect(translateMatch).toBeTruthy()
      const translateX = Number(translateMatch![1])
      const translateY = Number(translateMatch![2])
      // Screen Studio cursor uses a hotspot offset, so CSS position is slightly above/left of click target.
      expect(translateX).toBeLessThanOrEqual(140)
      expect(translateY).toBeLessThanOrEqual(120)
      expect(translateX).toBeGreaterThan(120)
      expect(translateY).toBeGreaterThan(100)

      await disableGhostCursor({ page: pageForTest })

      const hasGhostCursor = await pageForTest.evaluate(() => {
        return Boolean(document.getElementById('__playwriter_ghost_cursor__'))
      })
      expect(hasGhostCursor).toBe(false)
    } finally {
      if (targetPage) {
        targetPage.onMouseAction = null
        await disableGhostCursor({ page: targetPage })
      }
      await safeCloseCDPBrowser(directBrowser)
    }
  }, 30000)

  it('should not fire when onMouseAction is set to null', async () => {
    const browserContext = testCtx!.browserContext

    const directBrowser = await chromium.connectOverCDP(getCdpUrl({ port: TEST_PORT }))
    const contexts = directBrowser.contexts()
    const pages = contexts[0].pages()
    const targetPage = pages.find((p) => p.url().startsWith('data:'))
    expect(targetPage).toBeDefined()

    const events: MouseActionEvent[] = []
    targetPage!.onMouseAction = async (event) => {
      events.push({ ...event })
    }

    // Disable callback
    targetPage!.onMouseAction = null

    await targetPage!.mouse.click(50, 50)

    expect(events).toHaveLength(0)

    await safeCloseCDPBrowser(directBrowser)
  }, 30000)
})
