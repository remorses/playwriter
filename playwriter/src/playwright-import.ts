/**
 * Playwright driver import. Each connection picks its driver: @xmorse/playwright-core by default,
 * or @playwriter/patchright-core for `session new --patchright` sessions, and for the MCP with
 * PLAYWRITER_PATCHRIGHT=1.
 *
 * Type imports continue to use @xmorse/playwright-core directly (types are
 * the same in both packages) so TypeScript resolution works without the
 * optional patchright dep being installed.
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
    chromium = patchright ? importPatchright() : import('@xmorse/playwright-core').then((mod) => mod.chromium)
    // Don't cache a failed import, so installing the package later works without a restart
    chromium.catch(() => chromiumByDriver.delete(driver))
    chromiumByDriver.set(driver, chromium)
  }
  return chromium
}

async function importPatchright(): Promise<Chromium> {
  try {
    // Optional dependency. Types come from @xmorse/playwright-core (identical API surface).
    const mod: { chromium: Chromium } = await import('@playwriter/patchright-core' as string)
    return mod.chromium
  } catch (e: unknown) {
    throw new Error(
      '@playwriter/patchright-core is not installed. Reinstall playwriter with optional dependencies, or use the session without --patchright.',
      { cause: e },
    )
  }
}

/** Process-wide Patchright opt-in for the MCP (`playwriter --patchright`). CLI sessions choose per session. */
export function isPatchrightEnvEnabled(): boolean {
  return process.env.PLAYWRITER_PATCHRIGHT === '1' || process.env.PLAYWRITER_PATCHRIGHT === 'true'
}
