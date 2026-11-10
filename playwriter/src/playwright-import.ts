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
    // TODO: import it typed once both packages build on the same Playwright version. Patchright is 1.64
    // (patchright-playwriter submodule), @xmorse/playwright-core is 1.59, so overloads like Browser.on differ.
    chromium = patchright
      ? import('@playwriter/patchright-core' as string).then((mod: { chromium: Chromium }) => mod.chromium)
      : import('@xmorse/playwright-core').then((mod) => mod.chromium)
    chromiumByDriver.set(driver, chromium)
  }
  return chromium
}

/** Process-wide Patchright opt-in for the MCP (`playwriter --patchright`). CLI sessions choose per session. */
export function isPatchrightEnvEnabled(): boolean {
  return process.env.PLAYWRITER_PATCHRIGHT === '1' || process.env.PLAYWRITER_PATCHRIGHT === 'true'
}
