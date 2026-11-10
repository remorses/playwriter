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
type EvaluateFunction<R> = string | ((...args: any[]) => R | Promise<R>)
type EvaluateArg = object | string | number | boolean | null

const chromiumByDriver = new Map<'playwright' | 'patchright', Promise<Chromium>>()
let patchrightChromium: Chromium | undefined

/** Chromium BrowserType of the chosen driver. Both drivers can be loaded in one process. */
export function getChromium({ patchright = false }: { patchright?: boolean } = {}): Promise<Chromium> {
  const driver = patchright ? 'patchright' : 'playwright'
  let chromium = chromiumByDriver.get(driver)
  if (!chromium) {
    // Lazy: Patchright is only loaded by sessions that use it.
    // Both packages ship the same types.d.ts (Playwright 1.64.1), but TS cannot relate the generic
    // conditional types (Unboxed<Arg>) of two separate declaration copies, so the cast stays.
    chromium = patchright
      ? import('@playwriter/patchright-core').then((mod) => {
          patchrightChromium = mod.chromium as unknown as Chromium
          return patchrightChromium
        })
      : import('@xmorse/playwright-core').then((mod) => mod.chromium)
    chromiumByDriver.set(driver, chromium)
  }
  return chromium
}

/**
 * Evaluates in Patchright's isolated world, where pages cannot see the call, its stack or the globals it sets.
 * Patchright's page.evaluate runs in the main world by default, like Playwright's. Playwriter's own helpers
 * (snapshot, page markdown, page load wait) use this to stay invisible. Playwright has no isolated
 * argument, so its sessions evaluate as usual.
 */
export async function evaluateIsolated<R>({
  target,
  fn,
  arg,
}: {
  target:
    | import('@xmorse/playwright-core').Page
    | import('@xmorse/playwright-core').Frame
    | import('@xmorse/playwright-core').Locator
  fn: EvaluateFunction<R>
  arg?: EvaluateArg
}): Promise<R> {
  const page = 'mainFrame' in target ? target : target.page()
  // Patchright's evaluate takes isolatedContext as fourth argument, Playwright's types do not have it
  const evaluate = target.evaluate.bind(target) as (
    fn: EvaluateFunction<R>,
    arg?: EvaluateArg,
    options?: undefined,
    isolatedContext?: boolean,
  ) => Promise<R>
  if (patchrightChromium && page.context().browser()?.browserType() === patchrightChromium) {
    return await evaluate(fn, arg, undefined, true)
  }
  return await evaluate(fn, arg)
}

/** Process-wide Patchright opt-in for the MCP (`playwriter --patchright`). CLI sessions choose per session. */
export function isPatchrightEnvEnabled(): boolean {
  return process.env.PLAYWRITER_PATCHRIGHT === '1' || process.env.PLAYWRITER_PATCHRIGHT === 'true'
}
