import playwright from 'playwright-core'

async function main() {
    const cdpEndpoint = `ws://localhost:19988/cdp/${Date.now()}`
    const browser = await playwright.chromium.connectOverCDP(cdpEndpoint, {

    })

    const contexts = browser.contexts()
    console.log(`Found ${contexts.length} browser context(s)`)

    // Sleep 200 ms
    await new Promise((resolve) => setTimeout(resolve, 1000))
    for (const context of contexts) {
        const pages = context.pages()
        console.log(`Context has ${pages.length} page(s):`)
        // Log urls of current pages
        pages.forEach((page, idx) => {
            console.log(`  Page ${idx + 1} URL: ${page.url()}`)
        })
    }
}

main()
