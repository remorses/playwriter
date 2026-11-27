// Renders the real handoff card with handoff() in headless Chromium and saves what the video needs:
// screenshots of each state, plus assets/card/card.js with the card's DOM and CSS, so the video shows
// the same UI at any zoom.
// Run from the handoff worktree's playwriter folder: bun <this file>. It imports src/handoff.ts directly, so run it with bun (tsx injects a __name helper that breaks page functions).

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const WORKTREE = '/Users/morse/.kimaki/worktrees/888a7a78/review-pr-145'
const { chromium } = await import(`${WORKTREE}/playwright/packages/playwright-core/index.mjs`)
const { handoff, waitForHandoff, clearHandoff, focusPageHtml } = await import(`${WORKTREE}/playwriter/src/handoff.ts`)

const OUT = path.join(import.meta.dirname, '../assets/card')
const RELAY = 'http://playwriter.localhost:19988'
const VIEWPORT = { width: 1280, height: 800 }
const MESSAGES = {
  spot: 'Enter the 6-digit code from your phone.',
  corner: 'Sign in with your own account.',
}

const VERIFY = `<!doctype html><html><head><title>Verify it's you · shoply</title><style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f6f7f9;
    font: 15px/22px Inter, -apple-system, system-ui, sans-serif; color: #111827; }
  main { width: 400px; padding: 40px; background: #fff; border-radius: 16px; box-shadow: 0 0 0 1px #e5e7eb, 0 8px 24px rgba(0,0,0,.04); }
  .brand { font-weight: 700; font-size: 18px; letter-spacing: -0.02em; margin-bottom: 28px; }
  .brand b { color: #4f46e5; }
  h1 { margin: 0 0 6px; font-size: 22px; line-height: 28px; letter-spacing: -0.02em; }
  p { margin: 0; color: #6b7280; }
  #otp { display: flex; gap: 8px; margin: 24px 0; }
  #otp input { width: 52px; height: 60px; border: 1px solid #d1d5db; border-radius: 10px; text-align: center;
    font: 600 24px Inter, system-ui, sans-serif; color: #111827; outline: none; }
  button { width: 100%; height: 44px; border: 0; border-radius: 10px; background: #4f46e5; color: #fff; font: 600 15px Inter, system-ui, sans-serif; }
  .resend { margin-top: 16px; text-align: center; font-size: 14px; }
  .resend a { color: #4f46e5; text-decoration: none; }
</style></head><body><main>
  <div class="brand">shop<b>ly</b></div>
  <h1>Verify it's you</h1>
  <p>Enter the 6-digit code we sent to your phone ending in 42.</p>
  <div id="otp">${'<input maxlength="1" inputmode="numeric">'.repeat(6)}</div>
  <button>Verify</button>
  <div class="resend">Didn't get it? <a href="#">Resend code</a></div>
</main></body></html>`

function log(step: string) {
  console.log(`[capture] ${step}`)
}

fs.mkdirSync(OUT, { recursive: true })
const server = http.createServer((req, res) => {
  if (req.method === 'POST') return res.writeHead(200).end()
  // the real page closes itself after focusing the tab; keep it open for the screenshot
  const html = req.url?.startsWith('/handoff/') ? focusPageHtml().replace('window.close()', '') : VERIFY
  res.writeHead(200, { 'content-type': 'text/html' }).end(html)
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
if (!address || typeof address === 'string') throw new Error('server has no port')
const base = `http://127.0.0.1:${address.port}`

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2, colorScheme: 'light' })
const shot = async (name: string) => {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) })
  log(`saved ${name}.png`)
}
// strings, so tsx's __name helper never reaches the page
const settle = () =>
  page.evaluate(`Promise.all(document.getElementById('__playwriter_handoff')?.shadowRoot?.querySelector('.card')?.getAnimations().map((a) => a.finished) ?? [])`)
// the card's light-mode CSS and its DOM. The video seeks frames, so CSS animations are dropped there.
const dump = () =>
  page.evaluate(`(() => {
    const root = document.getElementById('__playwriter_handoff').shadowRoot
    const ring = document.getElementById('__playwriter_handoff_ring')
    const rules = [...root.adoptedStyleSheets[0].cssRules].filter((rule) => !(rule instanceof CSSMediaRule))
    return {
      css: rules.map((rule) => rule.cssText).join('\\n'),
      html: root.innerHTML,
      ringShadow: ring?.style.getPropertyValue('box-shadow') || null,
    }
  })()`)

log('verify page without card')
await page.goto(`${base}/verify`)
await shot('page')

log('spot card with ring')
const { link } = await handoff({ page, relayUrl: RELAY, message: MESSAGES.spot, target: page.locator('#otp') })
await settle()
await shot('spot')
const spot = await dump()

log('user types the code, card confirms')
const wait = waitForHandoff({ page, until: () => [...document.querySelectorAll('#otp input')].every((i) => i.value), timeout: 10_000 })
for (const [i, digit] of [...'482917'].entries()) await page.locator('#otp input').nth(i).fill(digit)
await page.locator('#__playwriter_handoff .got').waitFor()
await shot('done')
const done = await dump()
await wait

log('corner card')
await page.goto(`${base}/verify`)
await handoff({ page, relayUrl: RELAY, message: MESSAGES.corner })
await settle()
await shot('corner')
const corner = await dump()
await clearHandoff({ page })

log('focus link page')
await page.goto(`${base}/handoff/${link.split('/').pop()}`)
await page.waitForFunction(`document.getElementById('title')?.textContent !== 'Opening your tab…'`)
await shot('focus-page')

const card = { link, css: spot.css, ringShadow: spot.ringShadow, html: { spot: spot.html, done: done.html, corner: corner.html } }
fs.writeFileSync(path.join(OUT, 'card.js'), `// generated by scripts/capture-card.mts from handoff() output\nwindow.HANDOFF_CARD = ${JSON.stringify(card, null, 2)}\n`)
log('saved card.js')
await browser.close()
server.close()
