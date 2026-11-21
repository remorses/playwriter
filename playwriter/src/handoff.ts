/**
 * Hands a tab to the user for a step only they can do (a sign-in, a 2FA code, a captcha, an approval).
 *
 * handoff() brings the tab to the front and shows a Playwriter card saying what to do: in the top-right
 * corner, or beside a `target` element with a ring around it. waitForHandoff() then waits for the page to
 * show the step is done, so the user's own action is what resumes the agent.
 *
 * The card has to work on any page, so:
 * - it lives in a shadow root, and its styles are a constructed stylesheet: a strict `style-src` CSP blocks
 *   a <style> element
 * - every node, SVGs included, is built with createElement(NS): a page enforcing Trusted Types refuses innerHTML
 * - clicks pass through it everywhere except its Done button
 * - the ring and the spotlight card follow the target with CSS anchor positioning, so nothing reads the
 *   scroll position. An anchor name does not resolve from inside a shadow root, so the card's host and the
 *   ring are light-DOM elements positioned with inline !important styles
 * - each wait is one function predicate: Playwright polls a string predicate with eval, which a strict
 *   CSP refuses
 */

import type { Locator, Page } from '@xmorse/playwright-core'
import util from 'node:util'
import { evaluateIsolated } from './playwright-import.js'
import { sleep } from './utils.js'

export interface HandoffOptions {
  page: Page
  /** One line telling the user what to do, e.g. "Sign in to Discord with your own account." */
  message: string
  /** Element to ring and put the card beside. Without it the card sits in the top-right corner. */
  target?: Locator
  /** Nothing on the page shows the step is done: the card gets a Done button, and waitForHandoff returns on it. */
  manual?: boolean
}

export interface WaitForHandoffOptions {
  page: Page
  /** URL pattern, or a function run in the page, that holds once the step is done. Not used by a manual handoff. */
  until?: RegExp | (() => unknown)
  /** Milliseconds; 0 (the default) waits until the execute timeout. */
  timeout?: number
}

interface CardSpec {
  message: string
  manual: boolean
  spot: boolean
  done: boolean
}

const HOST_ID = '__playwriter_handoff'
const RING_ID = '__playwriter_handoff_ring'
const TARGET_ATTR = 'data-playwriter-handoff-target'
const CONFIRM_MS = 1200

const handoffs = new WeakMap<Page, { spec: CardSpec; rerender: () => void }>()

export async function handoff({ page, message, target, manual = false }: HandoffOptions): Promise<void> {
  await clearTarget({ page })
  if (target) {
    await target.evaluate((el, attr) => el.setAttribute(attr, ''), TARGET_ATTR)
  }
  await showCard({ page, spec: { message, manual, spot: Boolean(target), done: false } })
  await page.bringToFront()
}

/** Waits for Done on a manual card, or for `until` on any other, shows a short confirmation, then clears the card. */
export async function waitForHandoff({ page, until, timeout = 0 }: WaitForHandoffOptions): Promise<void> {
  const current = handoffs.get(page)
  if (!current) {
    throw new Error('waitForHandoff: no handoff is showing on this page. Call handoff({ page, message }) first.')
  }
  const options = { polling: 500, timeout }
  if (current.spec.manual) {
    await page.waitForFunction((id) => document.getElementById(id)?.dataset.done === '1', HOST_ID, options)
  } else if (util.types.isRegExp(until)) {
    // sandbox code builds its RegExp in another realm, so `instanceof RegExp` would be false
    await page.waitForFunction(
      ({ source, flags }) => new RegExp(source, flags).test(window.location.href),
      { source: until.source, flags: until.flags },
      options,
    )
  } else if (typeof until === 'function') {
    await page.waitForFunction(until, undefined, options)
  } else {
    throw new Error('waitForHandoff needs `until` (a URL RegExp or a page function), or a handoff with `manual: true`')
  }
  await showCard({ page, spec: { ...current.spec, done: true } })
  await sleep(CONFIRM_MS)
  await clearHandoff({ page })
}

/** Removes the card and stops showing it again after navigations. */
export async function clearHandoff({ page }: { page: Page }): Promise<void> {
  const current = handoffs.get(page)
  if (current) {
    page.off('domcontentloaded', current.rerender)
    handoffs.delete(page)
  }
  await evaluateIsolated({
    target: page,
    fn: (ids: string[]) => ids.forEach((id) => document.getElementById(id)?.remove()),
    arg: [HOST_ID, RING_ID],
  }).catch(() => {})
  await clearTarget({ page })
}

async function clearTarget({ page }: { page: Page }): Promise<void> {
  await evaluateIsolated({
    target: page,
    fn: (attr: string) => document.querySelectorAll(`[${attr}]`).forEach((el) => el.removeAttribute(attr)),
    arg: TARGET_ATTR,
  }).catch(() => {})
}

async function showCard({ page, spec }: { page: Page; spec: CardSpec }): Promise<void> {
  const arg: RenderArg = {
    spec,
    hostId: HOST_ID,
    ringId: RING_ID,
    targetAttr: TARGET_ATTR,
    css: CSS,
    place: PLACE,
    icon: ICON,
    check: CHECK,
  }
  const previous = handoffs.get(page)
  if (previous) {
    page.off('domcontentloaded', previous.rerender)
  }
  // a navigation drops the card, so it comes back on every new document until the handoff ends
  const rerender = () => {
    evaluateIsolated({ target: page, fn: renderCard, arg }).catch(() => {})
  }
  handoffs.set(page, { spec, rerender })
  page.on('domcontentloaded', rerender)
  await evaluateIsolated({ target: page, fn: renderCard, arg })
}

interface SvgArt {
  viewBox: string
  parts: Array<[string, Record<string, string>]>
}

interface RenderArg {
  spec: CardSpec
  hostId: string
  ringId: string
  targetAttr: string
  css: string
  place: Record<'corner' | 'spot' | 'ring', Record<string, string>>
  icon: SvgArt
  check: SvgArt
}

/** Runs in the page: (re)builds the card from its spec. */
function renderCard(arg: RenderArg): void {
  const { spec } = arg
  const el = (tag: string, cls?: string, text?: string) => {
    const node = document.createElement(tag)
    if (cls) node.className = cls
    if (text) node.textContent = text
    return node
  }
  const svg = (art: SvgArt, cls: string) => {
    const node = el('span', cls)
    const ns = 'http://www.w3.org/2000/svg'
    const root = document.createElementNS(ns, 'svg')
    root.setAttribute('viewBox', art.viewBox)
    root.setAttribute('aria-hidden', 'true')
    for (const [tag, attrs] of art.parts) {
      const part = document.createElementNS(ns, tag)
      for (const [key, value] of Object.entries(attrs)) part.setAttribute(key, value)
      root.append(part)
    }
    node.append(root)
    return node
  }
  const pin = (node, props: Record<string, string>) => {
    for (const [key, value] of Object.entries(props)) node.style.setProperty(key, value, 'important')
  }

  document.getElementById(arg.hostId)?.remove()
  document.getElementById(arg.ringId)?.remove()
  // a navigation drops the target, so the card falls back to the corner
  const anchor = spec.spot ? document.querySelector(`[${arg.targetAttr}]`) : null
  const spot = Boolean(anchor)
  const host = el('playwriter-handoff')
  host.id = arg.hostId
  pin(host, spot ? arg.place.spot : arg.place.corner)
  const root = host.attachShadow({ mode: 'open' })
  const sheet = new window.CSSStyleSheet()
  sheet.replaceSync(arg.css)
  root.adoptedStyleSheets = [sheet]
  anchor?.style.setProperty('anchor-name', '--playwriter-handoff')

  const app = el('div', 'app')
  if (spot) app.append(svg(arg.icon, 'icon'))
  app.append('Playwriter')
  const body = [app]
  if (spec.done) {
    const got = el('div', 'ask got')
    got.append(svg(arg.check, 'check'), 'Got it, carrying on.')
    body.push(got)
  } else {
    const foot = el('div', 'foot')
    foot.append(
      el('span', 'hint', spec.manual ? "Press Done once you've finished." : "Continues by itself once you're done."),
    )
    if (spec.manual) {
      const button = el('button', '', 'Done')
      button.type = 'button'
      button.addEventListener('click', () => {
        host.dataset.done = '1'
      })
      foot.append(button)
    }
    body.push(el('div', 'ask', spec.message), foot)
  }
  const text = el('div', 'text')
  text.append(...body)
  const card = el('div', `card ${spot ? 'spot' : 'corner'}${spec.done ? ' done' : ''}`)
  card.setAttribute('role', 'status')
  if (!spot) card.append(svg(arg.icon, 'icon'))
  card.append(text)
  root.append(card)
  document.documentElement.appendChild(host)
  if (spot && !spec.done) {
    const ring = el('playwriter-handoff-ring')
    ring.id = arg.ringId
    pin(ring, arg.place.ring)
    document.documentElement.appendChild(ring)
  }
}

const SHELL = { display: 'block', position: 'fixed', 'z-index': '2147483647', margin: '0', 'pointer-events': 'none' }

const PLACE: RenderArg['place'] = {
  corner: { ...SHELL, top: '12px', right: '12px' },
  spot: {
    ...SHELL,
    'position-anchor': '--playwriter-handoff',
    top: 'calc(anchor(bottom) + 14px)',
    left: 'calc(anchor(left) - 4px)',
    'position-try-fallbacks': 'flip-block',
  },
  ring: {
    ...SHELL,
    'z-index': '2147483646',
    'position-anchor': '--playwriter-handoff',
    top: 'calc(anchor(top) - 4px)',
    left: 'calc(anchor(left) - 4px)',
    right: 'calc(anchor(right) - 4px)',
    bottom: 'calc(anchor(bottom) - 4px)',
    'border-radius': '9px',
    background: 'none',
    border: '0',
    'box-shadow': '0 0 0 2px #83c995, 0 0 0 6px rgba(131, 201, 149, 0.28)',
  },
}

const FONT = `-apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif`

const CSS = `
  :host { all: initial; }
  .card { display: flex; align-items: flex-start; gap: 12px;
    box-sizing: border-box; width: 340px; max-width: calc(100vw - 24px); padding: 12px 14px 12px 12px; border-radius: 14px;
    font: 13px/20px ${FONT}; color: #f4f4f5; -webkit-font-smoothing: antialiased; background: rgba(28, 28, 30, 0.94);
    -webkit-backdrop-filter: blur(20px) saturate(1.6); backdrop-filter: blur(20px) saturate(1.6);
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.1), 0 14px 36px rgba(0, 0, 0, 0.32);
    animation: enter 200ms cubic-bezier(0.2, 0.8, 0.2, 1); }
  .spot { padding: 10px 12px 12px; border-radius: 12px; }
  .corner > .icon { flex: none; width: 32px; height: 32px; }
  .icon svg, .check svg { display: block; width: 100%; height: 100%; }
  .text { flex: 1; display: grid; gap: 2px; min-width: 0; }
  .spot .text { gap: 4px; }
  .app { display: flex; align-items: center; gap: 6px; font-size: 12px; line-height: 16px; font-weight: 600; color: #fff; }
  /* optical alignment: a 16px icon beside 12px text reads 0.25px low */
  .app > .icon { flex: none; width: 16px; height: 16px; transform: translateY(-0.25px); }
  .foot { display: flex; align-items: center; gap: 12px; padding-top: 6px; }
  .spot .foot { padding-top: 4px; }
  .hint { font-size: 12px; line-height: 16px; color: #a1a1aa; }
  button { all: unset; pointer-events: auto; cursor: pointer; margin-left: auto; height: 24px; padding: 0 10px;
    border-radius: 6px; font: 600 12px/24px ${FONT}; color: #0a0a0a; background: #83c995; }
  button:hover { background: #95d4a5; }
  button:focus-visible { outline: 2px solid #83c995; outline-offset: 2px; }
  .got { display: flex; align-items: flex-start; gap: 6px; }
  /* optical alignment: the 16px check reads 0.44px high beside 13px text */
  .check { flex: none; width: 16px; height: 16px; margin-top: 2px; transform: translateY(0.4375px); }
  @keyframes enter { from { opacity: 0; transform: translateY(-6px); } }
  .card.done { animation: none; }
  @media (prefers-reduced-motion: reduce) { .card { animation: none; } }
`

/** The extension icon (extension/icons), in the green the toolbar shows while a tab is attached. */
const ICON: SvgArt = {
  viewBox: '0 0 424 424',
  parts: [
    [
      'path',
      {
        fill: '#83c995',
        d: 'M0 212C0 112.063 0 62.095 31.037 31.037 62.116 0 112.063 0 212 0s149.905 0 180.942 31.037C424 62.116 424 112.063 424 212s0 149.905-31.058 180.942C361.926 424 311.937 424 212 424s-149.905 0-180.963-31.058C0 361.926 0 311.937 0 212',
      },
    ],
    [
      'path',
      {
        fill: '#0a0a0a',
        d: 'M225.732 260.521l52.173 52.152c5.406 5.427 8.098 8.12 11.109 9.37 4.028 1.675 8.543 1.675 12.571 0 3.011-1.25 5.724-3.943 11.109-9.349 5.406-5.406 8.099-8.098 9.349-11.109a16.4 16.4 0 0 0 0-12.571c-1.25-3.011-3.943-5.724-9.349-11.109l-52.173-52.173 15.921-15.943c16.324-16.324 24.465-24.464 22.557-33.241-1.929-8.756-12.762-12.763-34.408-20.734l-72.207-26.606c-43.184-15.9-64.766-23.85-75.896-12.72s-3.18 32.712 12.72 75.896l26.606 72.207c7.971 21.646 11.978 32.479 20.734 34.408 8.755 1.929 16.917-6.233 33.241-22.557z',
      },
    ],
  ],
}

const CHECK: SvgArt = {
  viewBox: '0 0 16 16',
  parts: [
    ['circle', { cx: '8', cy: '8', r: '8', fill: '#22c55e' }],
    [
      'path',
      {
        d: 'M4.75 8.25 7 10.5l4.25-4.75',
        fill: 'none',
        stroke: '#fff',
        'stroke-width': '1.6',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      },
    ],
  ],
}
