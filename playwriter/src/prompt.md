# playwriter execute

Control user's Chrome browser via playwright code snippets. Prefer single-line code with semicolons between statements. If you get "extension is not connected" or "no browser tabs have Playwriter enabled" error, tell user to click the playwriter extension icon on the tab they want to control.

You can collaborate with the user - they can help with captchas, difficult elements, or reproducing bugs.

## context variables

- `state` - object persisted between calls, use to store data/pages (e.g., `state.myPage = await context.newPage()`)
- `page` - default page the user activated, use this unless working with multiple pages
- `context` - browser context, access all pages via `context.pages()`
- `require` - load Node.js modules like fs
- Node.js globals: `setTimeout`, `setInterval`, `fetch`, `URL`, `Buffer`, `crypto`, etc.

## rules

- **Multiple calls**: use multiple execute calls for complex logic - helps understand intermediate state and isolate which action failed
- **Never close**: never call `browser.close()` or `context.close()`. Only close pages you created or if user asks
- **No bringToFront**: never call unless user asks - it's disruptive and unnecessary, you can interact with background pages
- **Check state after actions**: always verify page state after clicking/submitting (see next section)
- **Clean up listeners**: call `page.removeAllListeners()` at end of message to prevent leaks
- **CDP sessions**: use `getCDPSession({ page })` not `page.context().newCDPSession()` - NEVER use `newCDPSession()` method, it doesn't work through playwriter relay
- **Wait for load**: use `page.waitForLoadState('domcontentloaded')` not `page.waitForEvent('load')` - waitForEvent times out if already loaded
- **Avoid timeouts**: prefer proper waits over `page.waitForTimeout()` - there are better ways to wait for elements

## checking page state

After any action (click, submit, navigate), verify what happened:

```js
console.log('url:', page.url()); console.log(await accessibilitySnapshot({ page }).then(x => x.split('\n').slice(0, 30).join('\n')));
```

For visually complex pages (grids, galleries, dashboards), use `screenshotWithAccessibilityLabels({ page })` instead to understand spatial layout.

If nothing changed, try `await page.waitForLoadState('networkidle', {timeout: 3000})` or you may have clicked the wrong element.

## accessibility snapshots

```js
await accessibilitySnapshot({ page, search?, showDiffSinceLastCall? })
```

- `search` - string/regex to filter results (returns first 10 matching lines)
- `showDiffSinceLastCall` - returns diff since last snapshot (useful after actions)

For pagination, use `.split('\n').slice(offset, offset + limit).join('\n')`:
```js
console.log((await accessibilitySnapshot({ page })).split('\n').slice(0, 50).join('\n'));   // first 50 lines
console.log((await accessibilitySnapshot({ page })).split('\n').slice(50, 100).join('\n')); // next 50 lines
```

Example output:

```md
- banner [ref=e3]:
    - link "Home" [ref=e5] [cursor=pointer]:
        - /url: /
    - navigation [ref=e12]:
        - link "Docs" [ref=e13] [cursor=pointer]:
            - /url: /docs
```

Use `aria-ref` to interact - **no quotes around the ref value**:

```js
await page.locator('aria-ref=e13').click()
```

Search for specific elements:

```js
const snapshot = await accessibilitySnapshot({ page, search: /button|submit/i })
```

## choosing between snapshot methods

Both `accessibilitySnapshot` and `screenshotWithAccessibilityLabels` use the same `aria-ref` system, so you can combine them effectively.

**Use `accessibilitySnapshot` when:**
- Page has simple, semantic structure (articles, forms, lists)
- You need to search for specific text or patterns
- Token usage matters (text is smaller than images)
- You need to process the output programmatically

**Use `screenshotWithAccessibilityLabels` when:**
- Page has complex visual layout (grids, galleries, dashboards, maps)
- Spatial position matters (e.g., "first image", "top-left button")
- DOM order doesn't match visual order
- You need to understand the visual hierarchy

**Combining both:** Use screenshot first to understand layout and identify target elements visually, then use `accessibilitySnapshot({ search: /pattern/ })` for efficient searching in subsequent calls.

## selector best practices

**For unknown websites**: use `accessibilitySnapshot()` with `aria-ref` - it shows what's actually interactive.

**For development** (when you have source code access), prefer stable selectors in this order:

1. **Best**: `[data-testid="submit"]` - explicit test attributes, never change accidentally
2. **Good**: `getByRole('button', { name: 'Save' })` - accessible, semantic
3. **Good**: `getByText('Sign in')`, `getByLabel('Email')` - readable, user-facing
4. **OK**: `input[name="email"]`, `button[type="submit"]` - semantic HTML
5. **Avoid**: `.btn-primary`, `#submit` - classes/IDs change frequently
6. **Last resort**: `div.container > form > button` - fragile, breaks easily

Combine locators for precision:

```js
page.locator('tr').filter({ hasText: 'John' }).locator('button').click()
page.locator('button').nth(2).click()
```

If a locator matches multiple elements, Playwright throws "strict mode violation". Use `.first()`, `.last()`, or `.nth(n)`:

```js
await page.locator('button').first().click()  // first match
await page.locator('.item').last().click()    // last match
await page.locator('li').nth(3).click()       // 4th item (0-indexed)
```

## working with pages

Find a specific page:

```js
const pages = context.pages().filter(x => x.url().includes('localhost'));
if (pages.length !== 1) throw new Error(`Expected 1 page, found ${pages.length}`);
state.targetPage = pages[0];
```

Create new page:

```js
state.newPage = await context.newPage();
await state.newPage.goto('https://example.com');
```

## navigation

**Use `domcontentloaded`** for `page.goto()`:

```js
await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
await waitForPageLoad({ page, timeout: 5000 });
```

## common patterns

**Popups** - capture before triggering:

```js
const [popup] = await Promise.all([page.waitForEvent('popup'), page.click('a[target=_blank]')]);
await popup.waitForLoadState(); console.log('Popup URL:', popup.url());
```

**Downloads** - capture and save:

```js
const [download] = await Promise.all([page.waitForEvent('download'), page.click('button.download')]);
await download.saveAs(`/tmp/${download.suggestedFilename()}`);
```

**iFrames** - use frameLocator:

```js
const frame = page.frameLocator('#my-iframe');
await frame.locator('button').click();
```

**Dialogs** - handle alerts/confirms/prompts:

```js
page.on('dialog', async dialog => { console.log(dialog.message()); await dialog.accept(); });
await page.click('button.trigger-alert');
```

## utility functions

**getLatestLogs** - retrieve captured browser console logs (up to 5000 per page, cleared on navigation):

```js
await getLatestLogs({ page?, count?, search? })
// Examples:
const errors = await getLatestLogs({ search: /error/i, count: 50 })
const pageLogs = await getLatestLogs({ page })
```

For custom log collection across runs, store in state: `state.logs = []; page.on('console', m => state.logs.push(m.text()))`

**getCleanHTML** - get cleaned HTML from a locator or page, with search and diffing:

```js
await getCleanHTML({ locator, search?, showDiffSinceLastCall?, includeStyles? })
// Examples:
const html = await getCleanHTML({ locator: page.locator('body') })
const html = await getCleanHTML({ locator: page, search: /button/i })
const diff = await getCleanHTML({ locator: page, showDiffSinceLastCall: true })
```

- `locator` - Playwright Locator or Page to get HTML from
- `search` - string/regex to filter results (returns first 10 matching lines)
- `showDiffSinceLastCall` - returns diff since last snapshot
- `includeStyles` - keep style and class attributes (default: false)

Returns cleaned HTML with only essential attributes (aria-*, data-*, href, role, title, alt, etc.). Removes script, style, svg, head tags.

For pagination, use `.split('\n').slice(offset, offset + limit).join('\n')`:
```js
console.log((await getCleanHTML({ locator: page })).split('\n').slice(0, 50).join('\n'));   // first 50 lines
console.log((await getCleanHTML({ locator: page })).split('\n').slice(50, 100).join('\n')); // next 50 lines
```

**waitForPageLoad** - smart load detection that ignores analytics/ads:

```js
await waitForPageLoad({ page, timeout?, pollInterval?, minWait? })
// Returns: { success, readyState, pendingRequests, waitTimeMs, timedOut }
```

**getCDPSession** - send raw CDP commands:

```js
const cdp = await getCDPSession({ page });
const metrics = await cdp.send('Page.getLayoutMetrics');
```

**getLocatorStringForElement** - get stable selector from ephemeral aria-ref:

```js
const selector = await getLocatorStringForElement(page.locator('aria-ref=e14'));
// => "getByRole('button', { name: 'Save' })"
```

**getReactSource** - get React component source location (dev mode only):

```js
const source = await getReactSource({ locator: page.locator('aria-ref=e5') });
// => { fileName, lineNumber, columnNumber, componentName }
```

**getStylesForLocator** - inspect CSS styles applied to an element, like browser DevTools "Styles" panel. Useful for debugging styling issues, finding where a CSS property is defined (file:line), and checking inherited styles. Returns selector, source location, and declarations for each matching rule. ALWAYS read `https://playwriter.dev/resources/styles-api.md` first.

```js
const styles = await getStylesForLocator({ locator: page.locator('.btn'), cdp: await getCDPSession({ page }) });
console.log(formatStylesAsText(styles));
```

**createDebugger** - set breakpoints, step through code, inspect variables at runtime. Useful for debugging issues that only reproduce in browser, understanding code flow, and inspecting state at specific points. Can pause on exceptions, evaluate expressions in scope, and blackbox framework code. ALWAYS read `https://playwriter.dev/resources/debugger-api.md` first.

```js
const cdp = await getCDPSession({ page }); const dbg = createDebugger({ cdp }); await dbg.enable();
const scripts = await dbg.listScripts({ search: 'app' });
await dbg.setBreakpoint({ file: scripts[0].url, line: 42 });
// when paused: dbg.inspectLocalVariables(), dbg.stepOver(), dbg.resume()
```

**createEditor** - view and live-edit page scripts and CSS at runtime. Edits are in-memory (persist until reload). Useful for testing quick fixes, searching page scripts with grep, and toggling debug flags. ALWAYS read `https://playwriter.dev/resources/editor-api.md` first.

```js
const cdp = await getCDPSession({ page }); const editor = createEditor({ cdp }); await editor.enable();
const matches = await editor.grep({ regex: /console\.log/ });
await editor.edit({ url: matches[0].url, oldString: 'DEBUG = false', newString: 'DEBUG = true' });
```

**screenshotWithAccessibilityLabels** - take a screenshot with Vimium-style visual labels overlaid on interactive elements. Shows labels, captures screenshot, then removes labels. The image and accessibility snapshot are automatically included in the response. Can be called multiple times to capture multiple screenshots. Use a timeout of **20 seconds** for complex pages.

Prefer this for pages with grids, image galleries, maps, or complex visual layouts where spatial position matters. For simple text-heavy pages, `accessibilitySnapshot` with search is faster and uses fewer tokens.

```js
await screenshotWithAccessibilityLabels({ page });
// Image and accessibility snapshot are automatically included in response
// Use aria-ref from snapshot to interact with elements
await page.locator('aria-ref=e5').click();

// Can take multiple screenshots in one execution
await screenshotWithAccessibilityLabels({ page });
await page.click('button');
await screenshotWithAccessibilityLabels({ page });
// Both images are included in the response
```

Labels are color-coded: yellow=links, orange=buttons, coral=inputs, pink=checkboxes, peach=sliders, salmon=menus, amber=tabs.

**startRecording / stopRecording** - record the page as a video at native FPS (30-60fps). Uses `getDisplayMedia` with `preferCurrentTab` for high-quality capture. Video is saved as WebM.

```js
// Start recording the current page
await startRecording({ page });
// or with options:
await startRecording({ page, frameRate: 30, audio: true, videoBitsPerSecond: 2500000 });

// Do interactions...
await page.click('button');
await page.waitForTimeout(2000);

// Stop and save to file
const { path, duration, size } = await stopRecording({ page, outputPath: './recording.webm' });
console.log(`Saved ${size} bytes, duration: ${duration}ms`);
```

Additional recording utilities:
```js
// Check if recording is active
const { isRecording, startedAt } = await isRecording({ page });

// Cancel recording without saving
await cancelRecording({ page });
```

**Notes**:
- Recording requires user gesture or Chrome flags `--auto-accept-this-tab-capture --use-fake-ui-for-media-stream` for headless/automated use
- **Navigation resets recording**: If you navigate to a different URL, the recording state is lost (the MediaRecorder is stored in the page's window object). Record interactions on a single page, or stop recording before navigation.

## pinned elements

Users can right-click → "Copy Playwriter Element Reference" to store elements in `globalThis.playwriterPinnedElem1` (increments for each pin). The reference is copied to clipboard:

```js
const el = await page.evaluateHandle(() => globalThis.playwriterPinnedElem1);
await el.click();
```

## taking screenshots

Always use `scale: 'css'` to avoid 2-4x larger images on high-DPI displays:

```js
await page.screenshot({ path: 'shot.png', scale: 'css' });
```

## page.evaluate

Code inside `page.evaluate()` runs in the browser - use plain JavaScript only, no TypeScript syntax. Return values and log outside (console.log inside evaluate runs in browser, not visible):

```js
const title = await page.evaluate(() => document.title);
console.log('Title:', title);

const info = await page.evaluate(() => ({
    url: location.href,
    buttons: document.querySelectorAll('button').length,
}));
console.log(info);
```

## loading files

Fill inputs with file content:

```js
const fs = require('node:fs'); const content = fs.readFileSync('./data.txt', 'utf-8'); await page.locator('textarea').fill(content);
```

## network interception

For scraping or reverse-engineering APIs, intercept network requests instead of scrolling DOM. Store in `state` to analyze across calls:

```js
state.requests = []; state.responses = [];
page.on('request', req => { if (req.url().includes('/api/')) state.requests.push({ url: req.url(), method: req.method(), headers: req.headers() }); });
page.on('response', async res => { if (res.url().includes('/api/')) { try { state.responses.push({ url: res.url(), status: res.status(), body: await res.json() }); } catch {} } });
```

Then trigger actions (scroll, click, navigate) and analyze captured data:

```js
console.log('Captured', state.responses.length, 'API calls');
state.responses.forEach(r => console.log(r.status, r.url.slice(0, 80)));
```

Inspect a specific response to understand schema:

```js
const resp = state.responses.find(r => r.url.includes('users'));
console.log(JSON.stringify(resp.body, null, 2).slice(0, 2000));
```

Replay API directly (useful for pagination):

```js
const { url, headers } = state.requests.find(r => r.url.includes('feed'));
const data = await page.evaluate(async ({ url, headers }) => { const res = await fetch(url, { headers }); return res.json(); }, { url, headers });
console.log(data);
```

Clean up listeners when done: `page.removeAllListeners('request'); page.removeAllListeners('response');`

## reading response bodies

By default, playwriter disables CDP response body buffering to ensure SSE streaming works properly. If you need to read response bodies (e.g., for HAR recording or inspecting API responses), re-enable buffering first:

```js
// Get CDP session and re-enable Network buffering
const cdp = await getCDPSession({ page });
await cdp.send('Network.disable');
await cdp.send('Network.enable', {
  maxTotalBufferSize: 10000000,   // 10MB total buffer
  maxResourceBufferSize: 5000000  // 5MB per resource
});

// Now use Playwright's response API - it will work because buffering is enabled
const [response] = await Promise.all([
  page.waitForResponse(resp => resp.url().includes('/api/data')),
  page.click('button.load-data')
]);

const body = await response.text();  // or response.json(), response.body()
console.log(body);
```

**Note**: This may cause SSE/streaming responses to buffer. Only enable when you specifically need response bodies.

## capabilities

Examples of what playwriter can do:
- Monitor console logs while user reproduces a bug
- Intercept network requests to reverse-engineer APIs and build SDKs
- Scrape data by replaying paginated API calls instead of scrolling DOM
- Get accessibility snapshot to find elements, then automate interactions
- Use visual screenshots to understand complex layouts like image grids, dashboards, or maps
- Debug issues by collecting logs and controlling the page simultaneously
- Handle popups, downloads, iframes, and dialog boxes


## debugging playwriter issues

if some internal critical error happens you can read your own relay ws logs to understand the issue, it will show logs from extension, mcp and ws server together. then you can create a gh issue using `gh issue create -R remorses/playwriter --title title --body body`. ask for user confirmation before doing this.
