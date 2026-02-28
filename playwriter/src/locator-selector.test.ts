// Tests for Locator.selector() — verifies the raw selector strings returned
// by various locator creation methods (getByRole, locator, getByText, etc.)

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { chromium, type Page, type Browser } from '@xmorse/playwright-core'

const HTML = `<!DOCTYPE html>
<html>
<body>
  <div id="main">
    <button>Submit</button>
    <button>Cancel</button>
    <button class="primary">Save</button>
    <input type="text" placeholder="Enter name" />
    <input type="email" placeholder="Enter email" />
    <a href="/about">About Us</a>
    <h1>Page Title</h1>
    <p>Some paragraph text</p>
    <div class="card">
      <span>Card content</span>
    </div>
    <div class="card">
      <span>Another card</span>
    </div>
    <div class="card">
      <span>Third card</span>
    </div>
    <label for="age">Age</label>
    <input id="age" type="number" />
    <img alt="Logo" src="/logo.png" />
    <div data-testid="dashboard">Dashboard</div>
  </div>
</body>
</html>`

describe('Locator.selector()', () => {
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext()
    page = await context.newPage()
    await page.setContent(HTML)
  })

  afterAll(async () => {
    await browser.close()
  })

  it('CSS selectors', () => {
    expect(page.locator('#main').selector()).toMatchInlineSnapshot(`"#main"`)
    expect(page.locator('.card').selector()).toMatchInlineSnapshot(`".card"`)
    expect(page.locator('button').selector()).toMatchInlineSnapshot(`"button"`)
    expect(page.locator('div.card > span').selector()).toMatchInlineSnapshot(`"div.card > span"`)
    expect(page.locator('#main .card:first-child').selector()).toMatchInlineSnapshot(`"#main .card:first-child"`)
  })

  it('getByRole', () => {
    expect(page.getByRole('button').selector()).toMatchInlineSnapshot(`"internal:role=button"`)
    expect(page.getByRole('button', { name: 'Submit' }).selector()).toMatchInlineSnapshot(`"internal:role=button[name="Submit"i]"`)
    expect(page.getByRole('link').selector()).toMatchInlineSnapshot(`"internal:role=link"`)
    expect(page.getByRole('heading').selector()).toMatchInlineSnapshot(`"internal:role=heading"`)
    expect(page.getByRole('textbox').selector()).toMatchInlineSnapshot(`"internal:role=textbox"`)
  })

  it('getByText', () => {
    expect(page.getByText('Submit').selector()).toMatchInlineSnapshot(`"internal:text="Submit"i"`)
    expect(page.getByText('Some paragraph').selector()).toMatchInlineSnapshot(`"internal:text="Some paragraph"i"`)
    expect(page.getByText(/card/i).selector()).toMatchInlineSnapshot(`"internal:text=/card/i"`)
  })

  it('getByPlaceholder', () => {
    expect(page.getByPlaceholder('Enter name').selector()).toMatchInlineSnapshot(`"internal:attr=[placeholder="Enter name"i]"`)
    expect(page.getByPlaceholder('Enter email').selector()).toMatchInlineSnapshot(`"internal:attr=[placeholder="Enter email"i]"`)
  })

  it('getByLabel', () => {
    expect(page.getByLabel('Age').selector()).toMatchInlineSnapshot(`"internal:label="Age"i"`)
  })

  it('getByAltText', () => {
    expect(page.getByAltText('Logo').selector()).toMatchInlineSnapshot(`"internal:attr=[alt="Logo"i]"`)
  })

  it('getByTestId', () => {
    expect(page.getByTestId('dashboard').selector()).toMatchInlineSnapshot(`"internal:testid=[data-testid="dashboard"s]"`)
  })

  it('chained locators', () => {
    expect(page.locator('#main').locator('.card').selector()).toMatchInlineSnapshot(`"#main >> .card"`)
    expect(page.locator('.card').first().selector()).toMatchInlineSnapshot(`".card >> nth=0"`)
    expect(page.locator('.card').last().selector()).toMatchInlineSnapshot(`".card >> nth=-1"`)
    expect(page.locator('.card').nth(1).selector()).toMatchInlineSnapshot(`".card >> nth=1"`)
  })

  it('filtered locators', () => {
    expect(page.locator('button').filter({ hasText: 'Save' }).selector()).toMatchInlineSnapshot(`"button >> internal:has-text="Save"i"`)
    expect(page.locator('div').filter({ has: page.locator('span') }).selector()).toMatchInlineSnapshot(`"div >> internal:has="span""`)
    expect(page.locator('button').filter({ hasNotText: 'Cancel' }).selector()).toMatchInlineSnapshot(`"button >> internal:has-not-text="Cancel"i"`)
  })

  it('described locators', () => {
    expect(page.locator('button').describe('main action button').selector()).toMatchInlineSnapshot(`"button >> internal:describe="main action button""`)
  })

  it('combined with and/or', () => {
    expect(
      page.locator('button').and(page.locator('.primary')).selector(),
    ).toMatchInlineSnapshot(`"button >> internal:and=".primary""`)
    expect(
      page.locator('button').or(page.locator('a')).selector(),
    ).toMatchInlineSnapshot(`"button >> internal:or="a""`)
  })
})
