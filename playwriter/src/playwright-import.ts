/**
 * Playwright driver import. Each connection picks its driver: @xmorse/playwright-core by default,
 * or @playwriter/patchright-core for `session new --patchright` sessions, and for the MCP with
 * PLAYWRITER_PATCHRIGHT=1.
 *
 * Type imports use @xmorse/playwright-core for both drivers.
 */

export type {
  Page,
  Frame,
  Browser,
  BrowserContext,
  Locator,
  FrameLocator,
  ElementHandle,
  CDPSession,
  MouseActionEvent,
} from '@xmorse/playwright-core'

export type { BrowserType } from '@xmorse/playwright-core'

type Chromium = typeof import('@xmorse/playwright-core').chromium

const chromiumByDriver = new Map<'playwright' | 'patchright', Promise<Chromium>>()

/** Chromium BrowserType of the chosen driver. Both drivers can be loaded in one process. */
export function getChromium({ patchright = false }: { patchright?: boolean } = {}): Promise<Chromium> {
  const driver = patchright ? 'patchright' : 'playwright'
  let chromium = chromiumByDriver.get(driver)
  if (!chromium) {
    // Lazy: Patchright is only loaded by sessions that use it.
    // Both packages ship the same types.d.ts (Playwright 1.64.1), but TS cannot relate the generic
    // conditional types (Unboxed<Arg>) of two separate declaration copies, so the cast stays.
    chromium = patchright
      ? import('@playwriter/patchright-core').then((mod) => mod.chromium as unknown as Chromium)
      : import('@xmorse/playwright-core').then((mod) => mod.chromium)
    chromiumByDriver.set(driver, chromium)
  }
  return chromium
}

/** Process-wide Patchright opt-in for the MCP (`playwriter --patchright`). CLI sessions choose per session. */
export function isPatchrightEnvEnabled(): boolean {
  return process.env.PLAYWRITER_PATCHRIGHT === '1' || process.env.PLAYWRITER_PATCHRIGHT === 'true'
}
