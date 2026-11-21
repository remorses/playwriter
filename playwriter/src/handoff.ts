/**
 * Hands a tab to the user for a step only they can do (a sign-in, a 2FA code, a captcha, an approval).
 *
 * handoff() shows a Playwriter card saying what to do: in the top-right corner, or beside a `target` element
 * with a ring around it. It never steals focus; it returns a link that brings the tab to the front when the
 * user opens it. waitForHandoff() then waits for the page to show the step is done, so the user's own action
 * is what resumes the agent.
 *
 * The card has to work on any page, so:
 * - it lives in a shadow root, and its styles are a constructed stylesheet: a strict `style-src` CSP blocks
 *   a <style> element
 * - every node, SVGs included, is built with createElement(NS): a page enforcing Trusted Types refuses innerHTML
 * - clicks pass through it everywhere except its close and Done buttons
 * - the ring and the spotlight card follow the target with CSS anchor positioning, so nothing reads the
 *   scroll position. An anchor name does not resolve from inside a shadow root, so the card's host and the
 *   ring are light-DOM elements positioned with inline !important styles
 * - each wait is one function predicate that also watches the close button, so closing the card ends any wait
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
// token → tab for the focus link, served by the relay at /handoff/:token
const focusTokens = new Map<string, Page>()

/**
 * Shows the card without stealing focus. Returns a link for the chat: opening it brings the tab to the front,
 * so focus only changes when the user asks for it.
 */
export async function handoff({
  page,
  message,
  target,
  manual = false,
  relayUrl,
}: HandoffOptions & { relayUrl: string }): Promise<{ link: string }> {
  await clearTarget({ page })
  if (target) {
    await target.evaluate((el, attr) => el.setAttribute(attr, ''), TARGET_ATTR)
  }
  await showCard({ page, spec: { message, manual, spot: Boolean(target), done: false } })
  await scrollToTarget({ page })
  forgetFocusTokens({ page })
  const token = crypto.randomUUID()
  focusTokens.set(token, page)
  return { link: `${relayUrl}/handoff/${token}` }
}

/** The relay calls this when the user opens a focus link. Returns false for an unknown or ended handoff. */
export async function focusHandoff({ token }: { token: string }): Promise<boolean> {
  const page = focusTokens.get(token)
  if (!page || page.isClosed()) {
    return false
  }
  await page.bringToFront()
  // the user may have scrolled since the handoff started
  await scrollToTarget({ page })
  return true
}

async function scrollToTarget({ page }: { page: Page }): Promise<void> {
  await evaluateIsolated({
    target: page,
    fn: (attr: string) => {
      const el = document.querySelector(`[${attr}]`)
      const rect = el?.getBoundingClientRect()
      if (!el || (rect.top >= 0 && rect.bottom <= window.innerHeight)) return
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    },
    arg: TARGET_ATTR,
  }).catch(() => {})
}

function forgetFocusTokens({ page }: { page: Page }): void {
  for (const [token, tokenPage] of focusTokens) {
    if (tokenPage === page) focusTokens.delete(token)
  }
}

/**
 * Page the focus link opens. It asks the relay to bring the handoff tab to the front, then closes itself:
 * Chrome lets a script close a tab with one history entry, which a tab opened from another app has.
 * Focusing first matters: closing the active tab would make Chrome pick a neighbour tab.
 */
export function focusPageHtml(): string {
  const logo = `<svg viewBox="${ICON.viewBox}" aria-hidden="true">${ICON.parts
    .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([key, value]) => `${key}="${value}"`).join(' ')}/>`)
    .join('')}</svg>`
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Playwriter</title>
<style>
  :root { color-scheme: light dark; --bg: #f5f5f7; --card: #fff; --label: #1d1d1f; --secondary: #6e6e73; --hairline: rgba(0, 0, 0, 0.08); }
  @media (prefers-color-scheme: dark) { :root { --bg: #000; --card: #1c1c1e; --label: #f5f5f7; --secondary: #98989d; --hairline: rgba(255, 255, 255, 0.1); } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg);
    font: 15px/22px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif; color: var(--label);
    -webkit-font-smoothing: antialiased; }
  main { box-sizing: border-box; width: min(400px, calc(100vw - 32px)); padding: 32px 28px 28px; border-radius: 24px; text-align: center;
    background: var(--card); box-shadow: 0 0 0 0.5px var(--hairline), 0 16px 40px rgba(0, 0, 0, 0.08); }
  svg { display: block; width: 56px; height: 56px; margin: 0 auto 18px; }
  h1 { margin: 0 0 8px; font-size: 20px; line-height: 26px; font-weight: 650; letter-spacing: -0.01em; }
  p { margin: 0; color: var(--secondary); }
  ul { margin: 16px 0 0; padding: 14px 16px; list-style: none; border-radius: 14px; background: var(--bg); color: var(--secondary);
    text-align: left; display: grid; gap: 6px; font-size: 14px; line-height: 20px; }
  li { position: relative; padding-left: 14px; }
  li::before { content: ""; position: absolute; left: 0; top: 8px; width: 5px; height: 5px; border-radius: 50%; background: currentColor; opacity: 0.6; }
  .hint { margin-top: 16px; font-size: 13px; line-height: 18px; }
  [hidden] { display: none; }
</style>
</head><body><main>
${logo}
<h1 id="title">Opening your tab…</h1>
<p id="text">Playwriter is bringing the tab that needs you to the front.</p>
<ul id="reasons" hidden>
  <li>You finished the step and the agent carried on.</li>
  <li>The card was closed, or the agent ended the handoff.</li>
  <li>The tab was closed, or Playwriter restarted.</li>
</ul>
<p class="hint" id="hint" hidden>Still need to do it? Ask the agent in chat for a new link.</p>
</main>
<script>
const show = (title, text, reasons) => {
  document.getElementById('title').textContent = title
  document.getElementById('text').textContent = text
  document.getElementById('reasons').hidden = !reasons
  document.getElementById('hint').hidden = !reasons
}
fetch(location.pathname, { method: 'POST' }).then((res) => {
  if (res.ok) {
    show('Your tab is in front', 'Do the step shown on the Playwriter card there. You can close this tab.')
    window.close()
    return
  }
  show('This handoff has ended', 'No step is waiting for you in Playwriter. Usually because:', true)
}).catch(() => {
  show('Playwriter is not running', 'The Playwriter relay on this computer stopped. Ask the agent in chat to start again.')
})
</script></body></html>`
}

/**
 * Waits for Done on a manual card, or for `until` on any other, shows a short confirmation, then clears the card.
 * Throws if the user closes the card instead.
 */
export async function waitForHandoff({ page, until, timeout = 0 }: WaitForHandoffOptions): Promise<void> {
  const current = handoffs.get(page)
  if (!current) {
    throw new Error('waitForHandoff: no handoff is showing on this page. Call handoff({ page, message }) first.')
  }
  // the buttons set data-state on the host ("done" or "closed"), `until` covers everything else
  let finished: string
  if (current.spec.manual) {
    finished = 'false'
  } else if (util.types.isRegExp(until)) {
    // sandbox code builds its RegExp in another realm, so `instanceof RegExp` would be false
    finished = `new RegExp(${JSON.stringify(until.source)}, ${JSON.stringify(until.flags)}).test(location.href)`
  } else if (typeof until === 'function') {
    finished = `Boolean((${until.toString()})())`
  } else {
    throw new Error('waitForHandoff needs `until` (a URL RegExp or a page function), or a handoff with `manual: true`')
  }
  // a function built from source, not a string predicate: Playwright evals a string on every poll, which a
  // strict CSP refuses, but compiles a function once
  const predicate = new Function(
    `return document.getElementById(${JSON.stringify(HOST_ID)})?.dataset.state || (${finished} && 'done')`,
  ) as () => string | false
  const handle = await page.waitForFunction(predicate, undefined, { polling: 500, timeout })
  if ((await handle.jsonValue()) === 'closed') {
    await clearHandoff({ page })
    throw new Error('waitForHandoff: the user closed the Playwriter card without finishing. Ask them in chat what to do.')
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
  forgetFocusTokens({ page })
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
    cross: CROSS,
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
  cross: SvgArt
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
  const button = ({ cls, label, state }: { cls: string; label: string; state: 'done' | 'closed' }) => {
    const node = el('button', cls)
    node.type = 'button'
    node.setAttribute('aria-label', label)
    node.addEventListener('click', () => {
      host.dataset.state = state
      if (state !== 'closed') return
      card.classList.add('leaving')
      document.getElementById(arg.ringId)?.remove()
    })
    return node
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

  const card = el('div', `card ${spot ? 'spot' : 'corner'}${spec.done ? ' done' : ''}`)
  card.setAttribute('role', 'status')
  const head = el('div', 'head')
  head.append(el('span', 'app', 'Playwriter'))
  if (!spec.done) {
    const close = button({ cls: 'close', label: 'Close', state: 'closed' })
    close.append(svg(arg.cross, 'cross'))
    head.append(close)
  }
  card.append(svg(arg.icon, 'icon'), head)
  if (spec.done) {
    const got = el('div', 'got')
    got.append(svg(arg.check, 'check'), 'Got it, carrying on.')
    card.append(got)
  } else {
    const foot = el('div', 'foot')
    foot.append(el('span', 'hint', spec.manual ? "Press Done when finished." : "Continues by itself once you're done."))
    if (spec.manual) {
      const done = button({ cls: 'done-button', label: 'Done', state: 'done' })
      done.textContent = 'Done'
      foot.append(done)
    }
    card.append(el('div', 'ask', spec.message), foot)
  }
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
  corner: { ...SHELL, top: '16px', right: '16px' },
  // beside the target so it never covers the next field, or below it when there is no room
  spot: {
    ...SHELL,
    margin: '14px',
    'position-anchor': '--playwriter-handoff',
    'position-area': 'right',
    'position-try-fallbacks': 'flip-inline, bottom span-right, top span-right',
  },
  ring: {
    ...SHELL,
    'z-index': '2147483646',
    'position-anchor': '--playwriter-handoff',
    top: 'calc(anchor(top) - 4px)',
    left: 'calc(anchor(left) - 4px)',
    right: 'calc(anchor(right) - 4px)',
    bottom: 'calc(anchor(bottom) - 4px)',
    'border-radius': '10px',
    background: 'none',
    border: '0',
    'box-shadow': '0 0 0 2px #83c995, 0 0 0 6px rgba(131, 201, 149, 0.3)',
  },
}

const FONT = `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif`

// iOS notification look: translucent material over a backdrop blur, light or dark with the system
const CSS = `
  :host { all: initial; }
  .card {
    --label: #1d1d1f; --secondary: rgba(60, 60, 67, 0.62); --material: rgba(246, 246, 248, 0.78);
    --hairline: rgba(0, 0, 0, 0.08); --fill: rgba(120, 120, 128, 0.14); --fill-hover: rgba(120, 120, 128, 0.24);
    --button: #1d1d1f; --button-label: #fff;
    box-sizing: border-box; width: 344px; max-width: calc(100vw - 32px);
    display: grid; grid-template-columns: 28px minmax(0, 1fr); column-gap: 12px; align-items: start;
    padding: 14px 14px 14px 14px; border-radius: 24px;
    font: 15px/20px ${FONT}; letter-spacing: -0.01em; color: var(--label); -webkit-font-smoothing: antialiased;
    background: var(--material);
    -webkit-backdrop-filter: blur(30px) saturate(180%); backdrop-filter: blur(30px) saturate(180%);
    box-shadow: 0 0 0 0.5px var(--hairline), 0 2px 6px rgba(0, 0, 0, 0.06), 0 16px 40px rgba(0, 0, 0, 0.16);
    transition: opacity 180ms ease, transform 180ms ease;
    animation: enter 460ms cubic-bezier(0.32, 0.72, 0, 1); }
  @media (prefers-color-scheme: dark) {
    .card { --label: #f5f5f7; --secondary: rgba(235, 235, 245, 0.6); --material: rgba(28, 28, 30, 0.82);
      --hairline: rgba(255, 255, 255, 0.12); --fill: rgba(120, 120, 128, 0.3); --fill-hover: rgba(120, 120, 128, 0.42);
      --button: #f5f5f7; --button-label: #1d1d1f; } }
  .icon { grid-row: 1 / span 3; width: 28px; height: 28px; margin-top: 2px; filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.12)); }
  .icon svg, .check svg, .cross svg { display: block; width: 100%; height: 100%; }
  .head { grid-column: 2; display: flex; align-items: center; gap: 8px; height: 20px; }
  .app { flex: 1; font-size: 13px; line-height: 18px; font-weight: 600; letter-spacing: 0; color: var(--secondary); }
  .ask { grid-column: 2; margin-top: 1px; font-weight: 600; overflow-wrap: anywhere; }
  .foot { grid-column: 2; display: flex; align-items: center; gap: 12px; margin-top: 4px; min-height: 18px; }
  .hint { flex: 1; font-size: 13px; line-height: 18px; letter-spacing: 0; color: var(--secondary); }
  button { all: unset; pointer-events: auto; cursor: pointer; flex: none; -webkit-tap-highlight-color: transparent;
    transition: background-color 150ms ease, opacity 150ms ease, transform 150ms ease; }
  button:active { transform: scale(0.94); }
  button:focus-visible { outline: 2px solid #83c995; outline-offset: 2px; }
  .close { display: grid; place-items: center; width: 22px; height: 22px; margin-right: -2px; border-radius: 50%;
    color: var(--secondary); background: var(--fill); }
  .close:hover { background: var(--fill-hover); }
  .cross { width: 8px; height: 8px; }
  .done-button { height: 30px; padding: 0 16px; border-radius: 15px; font: 600 14px/30px ${FONT};
    color: var(--button-label); background: var(--button); }
  .done-button:hover { opacity: 0.86; }
  .got { grid-column: 2; display: flex; align-items: center; gap: 6px; margin-top: 1px; font-weight: 600; }
  .check { flex: none; width: 18px; height: 18px; }
  .card.leaving { opacity: 0; transform: scale(0.96); }
  @keyframes enter { from { opacity: 0; transform: translateY(-8px) scale(0.96); } }
  .card.done { animation: none; }
  @media (prefers-reduced-motion: reduce) { .card { animation: none; transition: opacity 180ms ease; } }
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

const CROSS: SvgArt = {
  viewBox: '0 0 10 10',
  parts: [['path', { d: 'M1.5 1.5l7 7M8.5 1.5l-7 7', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round' }]],
}
