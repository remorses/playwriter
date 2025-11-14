import playwright from 'playwright-core';

async function main() {
    const cdpEndpoint = `ws://localhost:9988/cdp`
    const browser = await playwright.chromium.connectOverCDP(cdpEndpoint);

    const contexts = browser.contexts();
    console.log(`Found ${contexts.length} browser context(s)`);

    for (const context of contexts) {
        const pages = context.pages();
        console.log(`Context has ${pages.length} page(s):`);

        for (const page of pages) {
            const url = page.url();
            console.log(`\nPage URL: ${url}`);

            const html = await page.content();
            const lines = html.split('\n').slice(0, 3);
            console.log('First 3 lines of HTML:');
            lines.forEach((line, i) => {
                console.log(`  ${i + 1}: ${line}`);
            });
        }
    }

    await browser.close();
}

main()
