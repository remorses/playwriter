## CLI Usage

If `playwriter` command is not found, install globally or use npx/bunx:

```bash
npm install -g playwriter@latest
# or use without installing:
npx playwriter@latest session new
bunx playwriter@latest session new
```

If using npx or bunx always use @latest for the first session command. so we are sure of using the latest version of the package

### Session management

Each session runs in an **isolated sandbox** with its own `state` object. Use sessions to:
- Keep state separate between different tasks or agents
- Persist data (pages, variables) across multiple execute calls
- Avoid interference when multiple agents use playwriter simultaneously

Get a new session ID to use in commands:

```bash
playwriter session new
# outputs: 1
```

**Always use your own session** - pass `-s <id>` to all commands. Using the same session preserves your `state` between calls. Using a different session gives you a fresh `state`.

List all active sessions with their state keys:

```bash
playwriter session list
# ID  State Keys
# --------------
# 1   myPage, userData
# 2   -
```

Reset a session if the browser connection is stale or broken:

```bash
playwriter session reset <sessionId>
```

### Execute code

```bash
playwriter -s <sessionId> -e "<code>"
```

The `-s` flag specifies a session ID (required). Get one with `playwriter session new`. Use the same session to persist state across commands.

Default timeout is 10 seconds. you can increase the timeout with `--timeout <ms>`

**Examples:**

```bash
# Navigate to a page
playwriter -s 1 -e "state.page = await context.newPage(); await state.page.goto('https://example.com')"

# Click a button
playwriter -s 1 -e "await page.click('button')"

# Get page title
playwriter -s 1 -e "console.log(await page.title())"

# Take a screenshot
playwriter -s 1 -e "await page.screenshot({ path: 'screenshot.png', scale: 'css' })"

# Get accessibility snapshot
playwriter -s 1 -e "console.log(await accessibilitySnapshot({ page }))"
```

**Multiline code:**

```bash
# Using $'...' syntax for multiline code
playwriter -s 1 -e $'
const title = await page.title();
const url = page.url();
console.log({ title, url });
'

# Or use heredoc
playwriter -s 1 -e "$(cat <<'EOF'
const links = await page.$$eval('a', els => els.map(e => e.href));
console.log('Found', links.length, 'links');
EOF
)"
```

### Debugging playwriter issues

If some internal critical error happens you can read the relay server logs to understand the issue. The log file is located in the system temp directory:

```bash
playwriter logfile  # prints the log file path
# typically: /tmp/playwriter/relay-server.log (Linux/macOS) or %TEMP%\playwriter\relay-server.log (Windows)
```

The relay log contains logs from the extension, MCP and WS server. A separate CDP JSONL log is created alongside it (see `playwriter logfile`) with all CDP commands/responses and events, with long strings truncated. Both files are recreated every time the server starts. For debugging internal playwriter errors, read these files with grep/rg to find relevant lines.

Example: summarize CDP traffic counts by direction + method:

```bash
jq -r '.direction + "\t" + (.message.method // "response")' /tmp/playwriter/cdp.jsonl | uniq -c
```

If you find a bug, you can create a gh issue using `gh issue create -R remorses/playwriter --title title --body body`. Ask for user confirmation before doing this.

---

# playwriter best practices

Control user's Chrome browser via playwright code snippets. Prefer single-line code with semicolons between statements. If you get "extension is not connected" or "no browser tabs have Playwriter enabled" error, tell user to click the playwriter extension icon on the tab they want to control.

You can collaborate with the user - they can help with captchas, difficult elements, or reproducing bugs.

## context variables

- `state` - object persisted between calls **within your session**. Each session has its own isolated state. Use to store pages, data, listeners (e.g., `state.myPage = await context.newPage()`)
- `page` - a default page (may be shared with other agents). Prefer creating your own page and storing it in `state` (see "working with pages")
- `context` - browser context, access all pages via `context.pages()`
- `require` - load Node.js modules like fs
- Node.js globals: `setTimeout`, `setInterval`, `fetch`, `URL`, `Buffer`, `crypto`, etc.

**Important:** `state` is **session-isolated** but pages are **shared** across all sessions. See "working with pages" for how to avoid interference.

## rules

- **Create your own page**: see "working with pages" — always create and store your own page in `state`, never use the default `page` for automation
- **Multiple calls**: use multiple execute calls for complex logic - helps understand intermediate state and isolate which action failed
- **Never close**: never call `browser.close()` or `context.close()`. Only close pages you created or if user asks
- **No bringToFront**: never call unless user asks - it's disruptive and unnecessary, you can interact with background pages
- **Check state after actions**: always verify page state after clicking/submitting (see next section)
- **Clean up listeners**: call `page.removeAllListeners()` at end of message to prevent leaks
- **CDP sessions**: use `getCDPSession({ page })` not `page.context().newCDPSession()` - NEVER use `newCDPSession()` method, it doesn't work through playwriter relay
- **Wait for load**: use `page.waitForLoadState('domcontentloaded')` not `page.waitForEvent('load')` - waitForEvent times out if already loaded
- **Avoid timeouts**: prefer proper waits over `page.waitForTimeout()` - there are better ways to wait for elements

## common mistakes to avoid

**1. Not verifying actions succeeded**
Always screenshot and READ the image after important actions (form submissions, uploads, typing). Your mental model can diverge from actual browser state:
```js
await page.keyboard.type('my text');
await page.screenshotWithAccessibilityLabels({ page });
// Then READ the screenshot file to verify text appeared correctly
```

**2. Assuming paste/upload worked**
Clipboard paste (`Meta+v`) can silently fail. For file uploads, prefer file input:
```js
// Reliable: use file input
const fileInput = page.locator('input[type="file"]').first();
await fileInput.setInputFiles('/path/to/image.png');

// Unreliable: clipboard paste may silently fail, need to focus textarea first for example
await page.keyboard.press('Meta+v');  // always verify with screenshot!
```

**3. Using stale refs from old snapshots**
`[ref=e23]` refs change when page updates. Always get a fresh snapshot before clicking:
```js
// BAD: using ref from minutes ago
await page.locator('[ref=e23]').click();  // element may have changed

// GOOD: get fresh snapshot, then immediately use refs from it
console.log(await accessibilitySnapshot({ page, showDiffSinceLastCall: true }));
// Now use the NEW refs from this output
```

**4. Wrong assumptions about current page/element**
Before destructive actions (delete, submit), verify you're targeting the right thing:
```js
// Before deleting, verify it's the right item
await page.screenshotWithAccessibilityLabels({ page });
// READ the screenshot to confirm, THEN proceed with delete
```

**5. Text concatenation without line breaks**
`keyboard.type()` doesn't insert newlines from `\n` in strings. Use `keyboard.press('Enter')`:
```js
// BAD: newlines in string don't create line breaks
await page.keyboard.type('Line 1\nLine 2');  // becomes "Line 1Line 2"

// GOOD: use Enter key for line breaks
await page.keyboard.type('Line 1');
await page.keyboard.press('Enter');
await page.keyboard.type('Line 2');
```

**6. Assuming page content loaded**
Even after `goto()`, dynamic content may not be ready:
```js
await page.goto('https://example.com');
// Content may still be loading via JavaScript!
await page.waitForSelector('article', { timeout: 10000 });
// Or use waitForPageLoad utility
await waitForPageLoad({ page, timeout: 5000 });
```

**7. Login buttons that open popups**
Playwriter extension cannot control popup windows. If a login button opens a popup (common with OAuth/SSO), use cmd+click to open in a new tab instead:
```js
// BAD: popup window is not controllable by playwriter
await page.click('button:has-text("Login with Google")');

// GOOD: cmd+click opens in new tab that playwriter can control
await page.locator('button:has-text("Login with Google")').click({ modifiers: ['Meta'] });
await page.waitForTimeout(2000);

// Verify new tab opened - last page should be the login page
const pages = context.pages();
const loginPage = pages[pages.length - 1];
if (loginPage.url() === page.url()) {
  throw new Error('Cmd+click did not open new tab - login may have opened as popup');
}

// Complete login flow in loginPage, cookies are shared with original page
await loginPage.locator('[data-email]').first().click();
await loginPage.waitForURL('**/callback**');
// Original page should now be authenticated
```

## checking page state

After any action (click, submit, navigate), verify what happened:

```js
console.log('url:', page.url()); console.log(await accessibilitySnapshot({ page }).then(x => x.split('\n').slice(0, 30).join('\n')));
```

For visually complex pages (grids, galleries, dashboards), use `screenshotWithAccessibilityLabels({ page })` instead to understand spatial layout.

If nothing changed, try `await waitForPageLoad({ page, timeout: 3000 })` or you may have clicked the wrong element.

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

**Pages are shared, state is not.** `context.pages()` returns all browser tabs with playwriter enabled — shared across all sessions. Multiple agents see the same tabs. If another agent navigates or closes a page you're using, you'll be affected. To avoid interference, **always create your own page**.

**Always create your own page (first call):**

On your very first execute call, create a dedicated page and store it in `state`. Use `state.myPage` for all subsequent operations — never the default `page` variable:

```js
state.myPage = await context.newPage();
await state.myPage.goto('https://example.com');
// Use state.myPage for ALL subsequent operations
```

**Handle page closures gracefully:**

The user may close your page by accident (e.g., closing a tab in Chrome). Always check before using it and recreate if needed:

```js
if (!state.myPage || state.myPage.isClosed()) {
  state.myPage = await context.newPage();
}
await state.myPage.goto('https://example.com');
```

**Use an existing page only when the user asks:**

Only use a page from `context.pages()` if the user explicitly asks you to control a specific tab they already opened (e.g., they're logged into an app). Find it by URL pattern and store it in state:

```js
const pages = context.pages().filter(x => x.url().includes('myapp.com'));
if (pages.length === 0) throw new Error('No myapp.com page found. Ask user to enable playwriter on it.');
if (pages.length > 1) throw new Error(`Found ${pages.length} matching pages, expected 1`);
state.targetPage = pages[0];
```

**List all available pages:**

```js
console.log(context.pages().map(p => p.url()));
```

## navigation

**Use `domcontentloaded`** for `page.goto()`:

```js
await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
await waitForPageLoad({ page, timeout: 5000 });
```

## common patterns

**Authenticated fetches** - to access protected resources, fetch from within page context (includes session cookies automatically):

```js
// BAD: curl/external requests don't have session cookies
// curl -H "Cookie: ..." often fails due to missing cookies or CSRF

// GOOD: fetch inside page.evaluate uses browser's full session
const data = await page.evaluate(async (url) => {
  const resp = await fetch(url);
  return await resp.text();
}, 'https://example.com/protected/resource');
```

**Downloading large data** - console output truncates large strings. Trigger a browser download instead:

```js
// Fetch protected data and trigger download to user's Downloads folder
await page.evaluate(async (url) => {
  const resp = await fetch(url);
  const data = await resp.text();
  const blob = new Blob([data], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'data.json';
  a.click();
}, 'https://example.com/protected/large-file');
// File saves to ~/Downloads - read it from there
```

**Avoid permission-gated browser APIs** - some APIs require user permission prompts or special browser flags. These often fail silently or hang. Examples to avoid:
- `navigator.clipboard.writeText()` - requires permission
- Multiple concurrent downloads - browser may block
- `window.showSaveFilePicker()` - requires user gesture
- Geolocation, camera, microphone APIs

Instead, use simpler alternatives (single download via `a.click()`, store data in `state`, etc).

**Links that open new tabs** - use cmd+click to open in a controllable new tab:

```js
// For links with target=_blank or buttons that open popups
await page.locator('a[target=_blank]').click({ modifiers: ['Meta'] });
await page.waitForTimeout(1000);

// New tab is last in context.pages()
const pages = context.pages();
const newTab = pages[pages.length - 1];
console.log('New tab URL:', newTab.url());
```

Note: `page.waitForEvent('popup')` is unreliable - playwriter cannot control popup windows opened via `window.open`. Use cmd+click instead.

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

**getStylesForLocator** - inspect CSS styles applied to an element, like browser DevTools "Styles" panel. Useful for debugging styling issues, finding where a CSS property is defined (file:line), and checking inherited styles. Returns selector, source location, and declarations for each matching rule. ALWAYS fetch `https://playwriter.dev/resources/styles-api.md` first with curl or webfetch tool.

```js
const styles = await getStylesForLocator({ locator: page.locator('.btn'), cdp: await getCDPSession({ page }) });
console.log(formatStylesAsText(styles));
```

**createDebugger** - set breakpoints, step through code, inspect variables at runtime. Useful for debugging issues that only reproduce in browser, understanding code flow, and inspecting state at specific points. Can pause on exceptions, evaluate expressions in scope, and blackbox framework code. ALWAYS fetch `https://playwriter.dev/resources/debugger-api.md` first.

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

**startRecording / stopRecording** - record the page as a video at native FPS (30-60fps). Uses `chrome.tabCapture` in the extension context, so **recording survives page navigation**. Video is saved as mp4.

**Note**: Recording requires the user to have clicked the Playwriter extension icon on the tab. This grants `activeTab` permission needed for `chrome.tabCapture`. Recording works on tabs where the icon was clicked - if you need to record a new tab, ask the user to click the icon on it first.

```js
// Start recording - outputPath must be specified upfront
await startRecording({ 
  page, 
  outputPath: './recording.mp4',
  frameRate: 30,        // default: 30
  audio: false,         // default: false (tab audio)
  videoBitsPerSecond: 2500000  // 2.5 Mbps
});

// Navigate around - recording continues!
await page.click('a');
await page.waitForLoadState('domcontentloaded');
await page.goBack();

// Stop and get result
const { path, duration, size } = await stopRecording({ page });
console.log(`Saved ${size} bytes, duration: ${duration}ms`);
```

Additional recording utilities:
```js
// Check if recording is active
const { isRecording, startedAt } = await isRecording({ page });

// Cancel recording without saving
await cancelRecording({ page });
```

**Key difference from getDisplayMedia**: This approach uses `chrome.tabCapture` which runs in the extension context, not the page. The recording persists across navigations because the extension holds the `MediaRecorder`, not the page's JavaScript context.

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

If you want to read back the image file into context make sure to resize it first, scaling down the image to make sure max size is 1500px. for example with `sips --resampleHeightWidthMax 1500 input.png --out output.png` on macOS.

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

## capabilities

Examples of what playwriter can do:
- Monitor console logs while user reproduces a bug
- Intercept network requests to reverse-engineer APIs and build SDKs
- Scrape data by replaying paginated API calls instead of scrolling DOM
- Get accessibility snapshot to find elements, then automate interactions
- Use visual screenshots to understand complex layouts like image grids, dashboards, or maps
- Debug issues by collecting logs and controlling the page simultaneously
- Handle popups, downloads, iframes, and dialog boxes
- Record videos of browser sessions that survive page navigation


## debugging playwriter issues

if some internal critical error happens you can read your own relay ws logs to understand the issue, it will show logs from extension, mcp and ws server together. then you can create a gh issue using `gh issue create -R remorses/playwriter --title title --body body`. ask for user confirmation before doing this.
