// Tests for handoff(): the card a tab shows while the user does a step only they can do.
// Pages are served with a strict CSP and Trusted Types, since the card has to render on sites like that.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import vm from 'node:vm'
import { chromium, type Page, type Browser } from '@xmorse/playwright-core'
import { clearHandoff, handoff, waitForHandoff } from './handoff.js'

const CSP = "default-src 'none'; style-src 'self'; require-trusted-types-for 'script'"
const CSS = `body { font: 16px system-ui; margin: 0; padding: 120px 80px; }
input { display: block; width: 320px; height: 36px; margin-top: 6px; }
#corner { position: fixed; top: 20px; right: 20px; }
.spacer { height: 2000px; }`
const SIGN_IN = `<!doctype html><html><head><title>Sign in</title><link rel="stylesheet" href="/s.css"></head><body>
<h1>Sign in</h1><label>Email<input id="email"></label><p><a id="go" href="/home">Continue</a></p>
<button id="corner">Under the card</button><div class="spacer"></div></body></html>`
const HOME = '<!doctype html><h1>Signed in</h1>'

const HOST = '#__playwriter_handoff'
const RING = '#__playwriter_handoff_ring'

describe('handoff', () => {
  let browser: Browser
  let page: Page
  let server: http.Server
  let baseUrl: string
  const errors: string[] = []

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = req.url || '/'
      const isCss = url === '/s.css'
      res.writeHead(200, { 'content-type': isCss ? 'text/css' : 'text/html', 'content-security-policy': CSP })
      res.end(isCss ? CSS : url.startsWith('/home') ? HOME : SIGN_IN)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('server has no port')
    baseUrl = `http://127.0.0.1:${address.port}`

    browser = await chromium.launch({ headless: true })
    page = await browser.newPage({ viewport: { width: 1000, height: 640 } })
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })
    page.on('pageerror', (error) => errors.push(String(error)))
  })

  afterAll(async () => {
    await browser?.close()
    server?.close()
  })

  it('shows a corner card with a Done button that ends a manual handoff', async () => {
    await page.goto(`${baseUrl}/sign-in`)
    await handoff({ page, message: 'Approve the sign-in on your phone.', manual: true })
    const card = page.locator(`${HOST} .card.corner`)
    expect(await card.textContent()).toMatchInlineSnapshot(
      `"PlaywriterApprove the sign-in on your phone.Press Done once you've finished.Done"`,
    )

    const wait = waitForHandoff({ page, timeout: 10_000 })
    await page.locator(`${HOST} button`).click()
    await page.locator(`${HOST} .got`).waitFor({ timeout: 2000 })
    expect(await page.locator(`${HOST} .got`).textContent()).toMatchInlineSnapshot(`"Got it, carrying on."`)
    await wait
    expect(await page.locator(HOST).count()).toBe(0)
  })

  it('lets clicks through everywhere except its Done button', async () => {
    await page.goto(`${baseUrl}/sign-in`)
    await page.evaluate(() => {
      document.querySelector('#corner')!.addEventListener('click', () => {
        document.body.dataset.clicked = '1'
      })
    })
    await handoff({ page, message: 'Sign in with your own account.' })
    const button = (await page.locator('#corner').boundingBox())!
    const card = (await page.locator(`${HOST} .card`).boundingBox())!
    expect(button.x > card.x && button.y > card.y && button.y < card.y + card.height).toBe(true)
    await page.mouse.click(button.x + button.width / 2, button.y + button.height / 2)
    expect(await page.evaluate(() => document.body.dataset.clicked)).toBe('1')
    await clearHandoff({ page })
  })

  it('comes back after a navigation until cleared', async () => {
    await page.goto(`${baseUrl}/sign-in`)
    await handoff({ page, message: 'Sign in with your own account.' })
    await page.goto(`${baseUrl}/sign-in?again`)
    await page.locator(`${HOST} .card.corner`).waitFor({ timeout: 2000 })
    await clearHandoff({ page })
    expect(await page.locator(HOST).count()).toBe(0)
    await page.goto(`${baseUrl}/sign-in`)
    expect(await page.locator(HOST).count()).toBe(0)
  })

  it('moves a target card to the corner when a navigation drops the target', async () => {
    await page.goto(`${baseUrl}/sign-in`)
    await handoff({ page, message: 'Type your email here.', target: page.locator('#email') })
    await page.goto(`${baseUrl}/sign-in?again`)
    await page.locator(`${HOST} .card.corner`).waitFor({ timeout: 2000 })
    expect(await page.locator(RING).count()).toBe(0)
    await clearHandoff({ page })
  })

  it('rings a target, follows it on scroll, and ends on a URL match', async () => {
    await page.goto(`${baseUrl}/sign-in`)
    await handoff({ page, message: 'Type your email here.', target: page.locator('#email') })
    const field = (await page.locator('#email').boundingBox())!
    const spot = page.locator(`${HOST} .card.spot`)
    // measure where the card lands, not where its entry animation starts
    await spot.evaluate((el) => Promise.all(el.getAnimations().map((animation) => animation.finished)))
    const ring = (await page.locator(RING).boundingBox())!
    const card = (await spot.boundingBox())!
    expect(Math.abs(ring.x - (field.x - 4))).toBeLessThan(1)
    expect(Math.abs(ring.width - (field.width + 8))).toBeLessThan(1)
    expect(Math.abs(card.y - (field.y + field.height + 14))).toBeLessThan(1)

    await page.mouse.wheel(0, 60)
    await page.waitForFunction((y) => document.querySelector('#email')!.getBoundingClientRect().y !== y, field.y)
    const scrolledField = (await page.locator('#email').boundingBox())!
    const scrolledRing = (await page.locator(RING).boundingBox())!
    expect(Math.abs(scrolledRing.y - (scrolledField.y - 4))).toBeLessThan(1)

    const wait = waitForHandoff({ page, until: /\/home$/, timeout: 10_000 })
    await page.locator('#go').click()
    await wait
    expect(page.url()).toBe(`${baseUrl}/home`)
    expect(await page.locator(`${HOST}, ${RING}`).count()).toBe(0)
  })

  it('ends on a page function', async () => {
    await page.goto(`${baseUrl}/sign-in`)
    await handoff({ page, message: 'Type anything in the email box.' })
    const wait = waitForHandoff({
      page,
      until: () => document.querySelector('#email').value.length > 0,
      timeout: 10_000,
    })
    await page.locator('#email').fill('x')
    await wait
    expect(await page.locator(HOST).count()).toBe(0)
  })

  it('accepts a RegExp built in the execute sandbox', async () => {
    await page.goto(`${baseUrl}/sign-in`)
    await handoff({ page, message: 'Press Continue.' })
    // sandbox code runs in its own vm context, so its RegExp is not an instance of this realm's RegExp
    const until = vm.runInNewContext('/\\/home$/')
    expect(until instanceof RegExp).toBe(false)
    const wait = waitForHandoff({ page, until, timeout: 10_000 })
    await page.locator('#go').click()
    await wait
    expect(await page.locator(HOST).count()).toBe(0)
  })

  it('needs a handoff, and `until` unless it is manual', async () => {
    await page.goto(`${baseUrl}/sign-in`)
    await expect(waitForHandoff({ page, until: /x/ })).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: waitForHandoff: no handoff is showing on this page. Call handoff({ page, message }) first.]`,
    )
    await handoff({ page, message: 'Sign in with your own account.' })
    await expect(waitForHandoff({ page })).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: waitForHandoff needs \`until\` (a URL RegExp or a page function), or a handoff with \`manual: true\`]`,
    )
    await clearHandoff({ page })
  })

  it('raises no console errors or CSP violations', () => {
    expect(errors).toEqual([])
  })
})
