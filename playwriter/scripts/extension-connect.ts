import playwright from 'playwright-core'

async function main() {
  const cdpEndpoint = `ws://localhost:19988/cdp/${Date.now()}`
  const browser = await playwright.chromium.connectOverCDP(cdpEndpoint, {})

  const contexts = browser.contexts()
  console.log(`Found ${contexts.length} browser context(s)`)

  // Sleep 200 ms
  await new Promise((resolve) => setTimeout(resolve, 200))
  for (const context of contexts) {
    const pages = context.pages()
    console.log(`Context has ${pages.length} page(s):`)

    for (const page of pages) {
      await page.emulateMedia({ colorScheme: null })
      const url = page.url()
      console.log(`\nPage URL: ${url}`)

      const html = await page.content()
      const lines = html.split('\n').slice(0, 3)
      console.log('First 3 lines of HTML:')
      lines.forEach((line, i) => {
        console.log(`  ${i + 1}: ${line}`)
      })
      // Watch for browser console logs and log them in Node.js
      page.on('console', (msg) => {
        console.log(`Browser log: [${msg.type()}] ${msg.text()}`)
      })

      console.log(`running eval`)
      // Evaluate a sum in the browser and log something from inside the browser context
      const sumResult = await page.evaluate(() => {
        console.log('Logging from inside browser context!')
        return 1 + 2 + 3
      })
      console.log(`Sum result evaluated in browser: ${sumResult}`)
      if ((page as any)._snapshotForAI) {
        const snapshot = await (page as any)._snapshotForAI()
        const snapshotStr = typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot)
        console.log('First 100 chars of _snapshotForAI():', snapshotStr.slice(0, 100))
      } else {
        console.log('_snapshotForAI is not available on this page.')
      }
    }
  }
}

main()
