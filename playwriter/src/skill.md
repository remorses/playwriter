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

**Examples:**

```bash
# Navigate to a page
playwriter -s 1 -e 'state.page = await context.newPage(); await state.page.goto("https://example.com")'

# Click a button
playwriter -s 1 -e 'await state.page.click("button")'

# Get page title
playwriter -s 1 -e 'await state.page.title()'

# Take a screenshot
playwriter -s 1 -e 'await state.page.screenshot({ path: "screenshot.png", scale: "css" })'

# Get accessibility snapshot
playwriter -s 1 -e 'await snapshot({ page: state.page })'

# Get accessibility snapshot for a specific iframe
playwriter -s 1 -e 'const frame = await state.page.locator("iframe").contentFrame(); await snapshot({ frame })'
```

**Why single quotes?** Always wrap `-e` code in single quotes (`'...'`) to prevent bash from interpreting `$`, backticks, and other special characters inside your JS code. Use double quotes or backtick template literals for strings inside the JS code.

**Multiline code:**

```bash
# Preferred: use heredoc with quoted delimiter (disables all bash expansion)
playwriter -s 1 -e "$(cat <<'EOF'
const links = await state.page.$$eval('a', els => els.map(e => e.href));
console.log('Found', links.length, 'links');
const price = text.match(/\$[\d.]+/);
EOF
)"

# Alternative: $'...' syntax (but beware: \n and \t become special, and
# single quotes inside must be escaped as \')
playwriter -s 1 -e $'
const title = await state.page.title();
const url = state.page.url();
console.log({ title, url });
'
```

**Quoting rules summary:**

- **Single quotes** (`'...'`): best for one-liners. No bash expansion at all. But you cannot include a literal single quote inside — use double quotes for JS strings instead.
- **Heredoc** (`<<'EOF'`): best for multiline code. The quoted `'EOF'` delimiter disables all bash expansion. Any character works inside, including `$`, backticks, and single quotes.
- **`$'...'`**: allows `\'` escaping but `\n`, `\t`, `\\` become special — conflicts with JS regex patterns.

### Debugging playwriter issues

If some internal critical error happens you can read the relay server logs to understand the issue. The log file is located in the user home directory:

```bash
playwriter logfile  # prints the log file path
# typically: ~/.playwriter/relay-server.log
```

The relay log contains logs from the extension, MCP and WS server. A separate CDP JSONL log is created alongside it (see `playwriter logfile`) with all CDP commands/responses and events, with long strings truncated. Both files are recreated every time the server starts. For debugging internal playwriter errors, read these files with grep/rg to find relevant lines.

Example: summarize CDP traffic counts by direction + method:

```bash
jq -r '.direction + "\t" + (.message.method // "response")' ~/.playwriter/cdp.jsonl | uniq -c
```

If you find a bug, you can create a gh issue using `gh issue create -R remorses/playwriter --title title --body body`. Ask for user confirmation before doing this.

---

# playwriter best practices

Control user's Chrome browser via playwright code snippets. Prefer single-line code with semicolons between statements. Use playwriter immediately without waiting for user actions; only if you get "extension is not connected" or "no browser tabs have Playwriter enabled" should you ask the user to click the playwriter extension icon on the target tab.

**When to use playwriter instead of webfetch/curl:** If a website is JS-heavy (SPAs like Instagram, Twitter, Facebook, etc.), has cookie consent modals, login walls, lazy-loaded content, carousels, or infinite scroll — **always use playwriter**. Simple fetch/webfetch will return an empty HTML shell with no content. Do NOT waste time trying curl, webfetch, or parsing raw HTML from JS-rendered sites. Go straight to playwriter: navigate with a real browser, dismiss modals, then extract what you need via `page.evaluate()` or network interception.

**If Chrome is not running**, the extension can't connect. Start Chrome from the command line before retrying:

```bash
# macOS
open -a "Google Chrome" --args --profile-directory=Default

# Linux
google-chrome --profile-directory=Default &

# Windows (cmd)
start chrome.exe --profile-directory=Default

# Windows (PowerShell)
Start-Process chrome.exe -ArgumentList '--profile-directory=Default'
```

To also enable automatic tab capture for screen recording (no manual extension click needed), add the `--allowlisted-extension-id` and `--auto-accept-this-tab-capture` flags:

```bash
# macOS
open -a "Google Chrome" --args --profile-directory=Default --allowlisted-extension-id=jfeammnjpkecdekppnclgkkffahnhfhe --auto-accept-this-tab-capture

# Linux
google-chrome --profile-directory=Default --allowlisted-extension-id=jfeammnjpkecdekppnclgkkffahnhfhe --auto-accept-this-tab-capture &

# Windows
start chrome.exe --profile-directory=Default --allowlisted-extension-id=jfeammnjpkecdekppnclgkkffahnhfhe --auto-accept-this-tab-capture
```

You can collaborate with the user - they can help with captchas, difficult elements, or reproducing bugs.

## context variables

- `state` - object persisted between calls **within your session**. Each session has its own isolated state. Use to store pages, data, listeners (e.g., `state.page = await context.newPage()`)
- `page` - a default page (may be shared with other agents). Prefer creating your own page and storing it in `state` (see "working with pages")
- `context` - browser context, access all pages via `context.pages()`
- `require` - load Node.js modules (e.g., `const fs = require('node:fs')`). ESM `import` is not available in the sandbox
- Node.js globals: `setTimeout`, `setInterval`, `fetch`, `URL`, `Buffer`, `crypto`, etc.

**Important:** `state` is **session-isolated** but pages are **shared** across all sessions. See "working with pages" for how to avoid interference.

## rules

- **Initialize state.page first**: see "working with pages" — at the start of a task, assign `state.page` (reuse `about:blank` or create one) and use `state.page` for all automation steps.
- **Multiple calls**: use multiple execute calls for complex logic - helps understand intermediate state and isolate which action failed
- **Never close**: never call `browser.close()` or `context.close()`. Only close pages you created or if user asks
- **No bringToFront**: never call unless user asks - it's disruptive and unnecessary, you can interact with background pages
- **Check state after actions**: always verify page state after clicking/submitting (see next section)
- **Clean up listeners**: call `state.page.removeAllListeners()` at end of message to prevent leaks
- **CDP sessions**: use `getCDPSession({ page: state.page })` not `state.page.context().newCDPSession()` - NEVER use `newCDPSession()` method, it doesn't work through playwriter relay
- **Wait for load**: use `state.page.waitForLoadState('domcontentloaded')` not `state.page.waitForEvent('load')` - waitForEvent times out if already loaded
- **Minimize timeouts**: prefer proper waits (`waitForSelector`, `waitForPageLoad`) over `state.page.waitForTimeout()`. Short timeouts (1-2s) are acceptable for non-deterministic events like popups, animations, or tab opens where no specific selector is available
- **Snapshot before screenshot**: always use `snapshot()` first to understand page state (text-based, fast, cheap). Only use `screenshot` when you specifically need visual/spatial information. Never take a screenshot just to check if a page loaded or to read text content — snapshot gives you that instantly without burning image tokens
- **Snapshot replaces page.evaluate() for inspection**: do NOT write `page.evaluate()` calls to manually query class names, bounding boxes, child counts, or visibility flags. `snapshot()` already shows every interactive element with its text, role, and a ready-to-use locator. If you catch yourself writing `document.querySelector` or `getBoundingClientRect` inside evaluate — stop and use `snapshot()` instead. Reserve `page.evaluate()` for actions that modify page state (e.g., `localStorage.clear()`, scroll manipulation) or extract non-DOM data (e.g., `window.__CONFIG__`)

## interaction feedback loop

Every browser interaction must follow **observe → act → observe**. Never chain multiple actions blindly.

1. **Open page** — get or create your page, navigate to URL
2. **Observe** — print `state.page.url()` + `snapshot()`. Always print URL — pages can redirect unexpectedly.
3. **Check** — if page isn't ready (loading, wrong URL, content missing), wait and observe again
4. **Act** — perform one action (click, type, submit)
5. **Observe again** — print URL + snapshot to verify the action's effect
6. **Repeat** from step 3 until task is complete

```js
// Each step should be a separate execute call:
// Step 1: navigate + observe
state.page = context.pages().find((p) => p.url() === 'about:blank') ?? (await context.newPage())
await state.page.goto('https://example.com', { waitUntil: 'domcontentloaded' })
console.log('URL:', state.page.url())
await snapshot({ page: state.page }).then(console.log)
```

```js
// Step 2: act + observe
await state.page.locator('button:has-text("Submit")').click()
console.log('URL:', state.page.url())
await snapshot({ page: state.page }).then(console.log)
```

If nothing changed after an action, try `waitForPageLoad({ page: state.page, timeout: 3000 })` or you may have clicked the wrong element.

**Deeper observation** — when snapshots aren't enough to understand what happened, combine multiple channels:

```js
// Check console for errors after an action
const errors = await getLatestLogs({ page: state.page, search: /error|fail/i, count: 20 })

// Combine snapshot + logs for full picture
const snap = await snapshot({ page: state.page, search: /dialog|error|message/ })
const logs = await getLatestLogs({ page: state.page, search: /error/i, count: 10 })
console.log('UI:', snap)
console.log('Logs:', logs)
```

Use `getLatestLogs()` for console errors, `state.page.url()` for navigation, screenshots only for visual layout issues.

## common mistakes to avoid

**1. Not verifying actions succeeded**
Always check page state after important actions (form submissions, uploads, typing). Your mental model can diverge from actual browser state:

```js
await state.page.keyboard.type('my text')
await snapshot({ page: state.page, search: /my text/ })
// If verifying visual layout specifically, use screenshotWithAccessibilityLabels instead
```

**2. Assuming paste/upload worked**
Clipboard paste (`Meta+v`) can silently fail. For file uploads, prefer file input:

```js
// Reliable: use file input
const fileInput = state.page.locator('input[type="file"]').first()
await fileInput.setInputFiles('/path/to/image.png')

// Unreliable: clipboard paste may silently fail, need to focus textarea first for example
await state.page.keyboard.press('Meta+v') // always verify with screenshot!
```

**3. Using stale locators from old snapshots**
Locators (especially ones with `>> nth=`) can change when the page updates. Always get a fresh snapshot before clicking, then immediately use locators from that output:

```js
await snapshot({ page: state.page, showDiffSinceLastCall: true })
// Now use the NEW locators from this output
```

**4. Wrong assumptions about current page/element**
Before destructive actions (delete, submit), verify you're targeting the right thing:

```js
// Before deleting, verify it's the right item
await screenshotWithAccessibilityLabels({ page: state.page })
// READ the screenshot to confirm, THEN proceed with delete
```

**5. Text concatenation without line breaks**
`keyboard.type()` doesn't insert newlines from `\n` in strings. Use `keyboard.press('Enter')` between lines:

```js
await state.page.keyboard.type('Line 1')
await state.page.keyboard.press('Enter')
await state.page.keyboard.type('Line 2')
```

**6. Quote escaping in bash**
Bash parses `$`, backticks, and `\` inside double-quoted strings. This silently corrupts JS code. Always use single quotes or heredoc:

```bash
# single quotes — bash passes everything through literally
playwriter -s 1 -e 'await state.page.locator(`[id="_r_a_"]`).click()'

# heredoc for complex code with mixed quotes
playwriter -s 1 -e "$(cat <<'EOF'
await state.page.locator('[id="_r_a_"]').click()
const match = html.match(/\$[\d.]+/g)
EOF
)"
```

**7. Using screenshots when snapshots suffice**
Screenshots + image analysis is expensive and slow. Only use screenshots for visual/CSS issues. Use snapshot for text checks:

```js
await snapshot({ page: state.page, search: /expected text/i })
```

**8. Assuming page content loaded**
Even after `goto()`, dynamic content may not be ready:

```js
await state.page.goto('https://example.com')
// Content may still be loading via JavaScript!
await state.page.waitForSelector('article', { timeout: 10000 })
// Or use waitForPageLoad utility
await waitForPageLoad({ page: state.page, timeout: 5000 })
```

**9. Not using playwriter for JS-rendered sites**
Do NOT waste context trying webfetch, curl, or Playwright CLI screenshots on SPAs (Instagram, Twitter, etc.). These return empty HTML shells. Use playwriter directly:

```js
state.page = context.pages().find((p) => p.url() === 'about:blank') ?? (await context.newPage())
await state.page.goto('https://www.instagram.com/p/ABC123/', { waitUntil: 'domcontentloaded' })
await waitForPageLoad({ page: state.page, timeout: 8000 })
await snapshot({ page: state.page, search: /cookie|consent|accept/i }).then(console.log)
```

**10. Login buttons that open popups**
Playwriter cannot control popup windows. Use cmd+click to open in a new tab instead:

```js
await state.page.locator('button:has-text("Login with Google")').click({ modifiers: ['Meta'] })
await state.page.waitForTimeout(2000)

// Verify new tab opened - last page should be the login page
const pages = context.pages()
const loginPage = pages[pages.length - 1]
if (loginPage.url() === state.page.url()) {
  throw new Error('Cmd+click did not open new tab - login may have opened as popup')
}

// Complete login flow in loginPage, cookies are shared with original page
await loginPage.locator('[data-email]').first().click()
await loginPage.waitForURL('**/callback**')
// Original page should now be authenticated
```

**11. Click times out or does nothing — snapshot to find the blocker**
When a click times out, a **modal or overlay** is likely intercepting pointer events. Do not retry with different selectors or `{ force: true }` — snapshot to find the blocker:

```js
// click timed out → don't retry blindly, find what's blocking
await snapshot({ page: state.page, search: /dialog|modal/i })
// Found modal → interact with it properly (don't just close via X, it may reappear)
await state.page.getByRole('radio', { name: 'Nope, Vanilla' }).click()
```

**12. Never use `dispatchEvent` or `{ force: true }` to bypass blockers**
`dispatchEvent(new MouseEvent(...))`, `{ force: true }`, and `element.click()` inside `page.evaluate()` bypass Playwright checks but **do not trigger React/Vue/Svelte handlers** — state won't update. Use snapshot to find the real interactive element:

```js
await state.page.getByRole('radio', { name: 'Node.js' }).click()
```

**13. Over-investigating instead of just interacting**
When something doesn't respond to a click, do NOT start inspecting CDP event listeners, React fibers, canvas pixel data, or writing `page.evaluate()` to read class names and bounding boxes. This wastes massive context. Instead:

1. Take a `snapshot()` — it shows every interactive element and what to click
2. Try a different interaction pattern if `click()` didn't work:
   - **Drawing/annotation tools, canvas paint** → `mouse.down`, move with steps, `mouse.up` (see drag section)
   - **Keyboard-activated modes** → press the shortcut key (snapshot shows tooltip text like "Draw mode D")
   - **Sliders, timeline scrubbers** → drag pattern
   - **Collapsed/toggled toolbars** → click the toggle first, wait, then interact
3. Take another `snapshot()` to see what changed
4. Only investigate DOM internals if correct interaction patterns produce zero response after 2–3 attempts

## accessibility snapshots

```js
await snapshot({ page: state.page, search?, showDiffSinceLastCall? })
```

- `search` - string/regex to filter results (returns first 10 matching lines)
- `showDiffSinceLastCall` - returns diff since last snapshot (default: `true`, but `false` when `search` is provided). Pass `false` to get full snapshot.

Snapshots return full content on first call, then diffs on subsequent calls. Diff is only returned when shorter than full content. If nothing changed, returns "No changes since last snapshot" message. Use `showDiffSinceLastCall: false` to always get full content. When `search` is provided, diffing is disabled by default so the search filters the full content — pass `showDiffSinceLastCall: true` explicitly to combine both. This diffing behavior also applies to `getCleanHTML` and `getPageMarkdown`.

Example output:

```md
- banner:
  - link "Home" [id="nav-home"]
  - navigation:
    - link "Docs" [data-testid="docs-link"]
    - link "Blog" role=link[name="Blog"]
```

Each interactive line ends with a Playwright locator you can pass to `state.page.locator()`.
If multiple elements share the same locator, a `>> nth=N` suffix is added (0-based)
to make it unique.

**Use snapshot locators directly — never invent selectors.** The snapshot output IS the selector. Do not guess CSS selectors or `getByText` when the snapshot already gives you the exact match:

```js
// Snapshot shows: role=radio[name="Nope, Vanilla"]  →  use it directly
await state.page.getByRole('radio', { name: 'Nope, Vanilla' }).click()
// Snapshot shows: role=link[name="SIGN IN"]  →  or pass raw string to locator()
await state.page.locator('role=link[name="SIGN IN"]').click()
```

**Beware CSS text-transform**: snapshots show visual text (`heading "NODE.JS"`) but DOM may be `"Node.js"`. Use case-insensitive regex: `getByRole('heading', { name: /node\.js/i })`.

If a screenshot shows ref labels like `e3`, resolve them using the last snapshot:

```js
const snap = await snapshot({ page: state.page })
const locator = refToLocator({ ref: 'e3' })
await state.page.locator(locator!).click()
```

Search for specific elements:

```js
const snap = await snapshot({ page: state.page, search: /button|submit/i })
```

**Scoping snapshots to a specific element** — pass a `locator` instead of `page` to snapshot only a subtree. This dramatically reduces output size when you only care about one section of the page (e.g., the main content area, ignoring the sidebar/header/footer):

```js
// Full page snapshot: ~150 lines (sidebar, nav, header, footer, everything)
await snapshot({ page: state.page })

// Scoped to main: ~20 lines (just the content you care about)
await snapshot({ locator: state.page.locator('main') })

// Scope to a specific form, dialog, or section
await snapshot({ locator: state.page.locator('[role="dialog"]') })
await snapshot({ locator: state.page.locator('form#checkout') })
```

Use this whenever the full page snapshot is dominated by navigation or layout elements you don't need. It saves significant tokens and makes the output much easier to parse.

**Filtering large snapshots in JS** — when `search` isn't enough, filter the string directly: `snap.split('\n').filter(l => l.includes('dialog') || l.includes('error')).join('\n')`

## choosing between snapshot methods

Use `snapshot` for text-heavy pages (forms, articles) — fast, cheap, searchable. Use `screenshotWithAccessibilityLabels` for complex visual layouts (grids, galleries, dashboards) where spatial position matters. Both share the same ref system and can be combined.

## selector best practices

**For unknown websites**: use `snapshot()` - it shows what's actually interactive with stable locators.

**For development** (when you have source code access), prefer stable selectors in this order:

1. **Best**: `[data-testid="submit"]` - explicit test attributes, never change accidentally
2. **Good**: `getByRole('button', { name: 'Save' })` - accessible, semantic
3. **Good**: `getByText('Sign in')`, `getByLabel('Email')` - readable, user-facing
4. **OK**: `input[name="email"]`, `button[type="submit"]` - semantic HTML
5. **Avoid**: `.btn-primary`, `#submit` - classes/IDs change frequently
6. **Last resort**: `div.container > form > button` - fragile, breaks easily

Combine locators for precision:

```js
state.page.locator('tr').filter({ hasText: 'John' }).locator('button').click()
state.page.locator('button').nth(2).click()
```

If a locator matches multiple elements, Playwright throws "strict mode violation". Use `.first()`, `.last()`, or `.nth(n)`:

```js
await state.page.locator('button').first().click() // first match
await state.page.locator('.item').last().click() // last match
await state.page.locator('li').nth(3).click() // 4th item (0-indexed)
```

## working with pages

**Pages are shared, state is not.** `context.pages()` returns all browser tabs with playwriter enabled — shared across all sessions. Multiple agents see the same tabs. If another agent navigates or closes a page you're using, you'll be affected. To avoid interference, **get your own page**.

**Get or create your page (first call):**

On your very first execute call, reuse an existing empty tab or create a new one, and navigate it **in the same execute call**. Store it in `state` and use `state.page` for all subsequent operations instead of the default `page` variable:

```js
// Reuse an empty about:blank tab if available, otherwise create a new one.
// IMPORTANT: always navigate immediately in the same call to avoid another
// agent grabbing the same about:blank tab between execute calls.
state.page = context.pages().find((p) => p.url() === 'about:blank') ?? (await context.newPage())
await state.page.goto('https://example.com')
// Use state.page for ALL subsequent operations
```

**Handle page closures gracefully:**

The user may close your page by accident (e.g., closing a tab in Chrome). Always check before using it and recreate if needed:

```js
if (!state.page || state.page.isClosed()) {
  state.page = context.pages().find((p) => p.url() === 'about:blank') ?? (await context.newPage())
}
await state.page.goto('https://example.com')
```

**Use an existing page only when the user asks:**

Only use a page from `context.pages()` if the user explicitly asks you to control a specific tab they already opened (e.g., they're logged into an app). Find it by URL pattern and store it in state:

```js
const pages = context.pages().filter((x) => x.url().includes('myapp.com'))
if (pages.length === 0) throw new Error('No myapp.com page found. Ask user to enable playwriter on it.')
if (pages.length > 1) throw new Error(`Found ${pages.length} matching pages, expected 1`)
state.targetPage = pages[0]
```

**List all available pages:**

```js
context.pages().map((p) => p.url())
```

## navigation

**Use `domcontentloaded`** for `page.goto()`:

```js
await state.page.goto('https://example.com', { waitUntil: 'domcontentloaded' })
await waitForPageLoad({ page: state.page, timeout: 5000 })
```

## common patterns

**Authenticated fetches** - fetch from within page context to include session cookies automatically:

```js
const data = await state.page.evaluate(async (url) => {
  const resp = await fetch(url)
  return await resp.text()
}, 'https://example.com/protected/resource')
```

**Read page cookies via CDP** - use `Network.getCookies` on the page CDP session:

```js
const cdp = await getCDPSession({ page: state.page })
const { cookies } = await cdp.send('Network.getCookies', { urls: [state.page.url()] })
console.log(cookies)
```

MUST use this for page-scoped cookies in extension mode. `Storage.getCookies` is a root-session command and will fail in playwriter.

**Downloading large data** - console output truncates large strings. Trigger a browser download instead:

```js
// Fetch protected data and trigger download to user's Downloads folder
await state.page.evaluate(async (url) => {
  const resp = await fetch(url)
  const data = await resp.text()
  const blob = new Blob([data], { type: 'application/octet-stream' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'data.json'
  a.click()
}, 'https://example.com/protected/large-file')
// File saves to ~/Downloads - read it from there
```

**Avoid permission-gated browser APIs** - some APIs require user permission prompts or special browser flags. These often fail silently or hang. Examples to avoid:

- `navigator.clipboard.writeText()` - requires permission
- Multiple concurrent downloads - browser may block
- `window.showSaveFilePicker()` - requires user gesture
- Geolocation, camera, microphone APIs

Instead, use simpler alternatives (single download via `a.click()`, store data in `state`, etc).

**Downloads** - capture and save:

```js
const [download] = await Promise.all([state.page.waitForEvent('download'), state.page.click('button.download')])
await download.saveAs(`/tmp/${download.suggestedFilename()}`)
```

**iFrames** - two approaches depending on what you need:

```js
// frameLocator: for chaining locator operations (click, fill, etc.)
const frame = state.page.frameLocator('#my-iframe')
await frame.locator('button').click()

// contentFrame: returns a Frame object, needed for snapshot({ frame })
const frame2 = await state.page.locator('iframe').contentFrame()
await snapshot({ frame: frame2 })
```

**Dialogs** - handle alerts/confirms/prompts:

```js
state.page.on('dialog', async (dialog) => {
  console.log(dialog.message())
  await dialog.accept()
})
await state.page.click('button.trigger-alert')
```

**Handling page obstacles (cookie modals, login walls, age gates)** - most major websites show blocking overlays. Always check for these with `snapshot()` right after navigation and dismiss them before doing anything else:

```js
// After navigating, check for common obstacles
await waitForPageLoad({ page: state.page, timeout: 5000 })
const snap = await snapshot({
  page: state.page,
  search: /cookie|consent|accept|reject|decline|allow|age|verify|login|sign.in/i,
})
console.log(snap)
// Look for dismiss/accept/decline buttons in the snapshot, then click them:
// await state.page.locator('button:has-text("Accept")').click();
// await state.page.locator('button:has-text("Decline optional")').click();
// Then re-snapshot to confirm the modal is gone before proceeding
```

If the page requires login and the user is already logged into Chrome, their session cookies are available — just navigate and the page should load authenticated. If not, ask the user for help or use their existing logged-in tab via `context.pages()`.

**Extracting and downloading media (images, videos)** - use `page.evaluate()` to extract URLs from the rendered DOM, then download via Node.js in the sandbox. This is far more reliable than parsing raw HTML:

```js
// Extract all image URLs from rendered DOM
const images = await state.page.evaluate(() =>
  Array.from(document.querySelectorAll('img[src]')).map((img) => ({
    src: img.src,
    alt: img.alt,
    width: img.naturalWidth,
  })),
)
console.log(JSON.stringify(images, null, 2))

// Download a specific image to disk
const fs = require('node:fs')
const resp = await fetch(images[0].src)
const buf = Buffer.from(await resp.arrayBuffer())
fs.writeFileSync('./downloaded-image.jpg', buf)
console.log('Saved', buf.length, 'bytes')
```

For carousels or lazy-loaded galleries, you may need to click navigation arrows or scroll first, then re-extract. Use network interception (see "network interception" section) to capture high-resolution CDN URLs that may differ from the `img.src` thumbnails.

## utility functions

**getLatestLogs** - retrieve captured browser console logs (up to 5000 per page, cleared on navigation):

```js
await getLatestLogs({ page?, count?, search? })
// Examples:
const errors = await getLatestLogs({ search: /error/i, count: 50 })
const pageLogs = await getLatestLogs({ page: state.page })
```

For custom log collection across runs, store in state: `state.logs = []; state.page.on('console', m => state.logs.push(m.text()))`

**getCleanHTML** - get cleaned HTML from a locator or page, with search and diffing:

```js
await getCleanHTML({ locator, search?, showDiffSinceLastCall?, includeStyles? })
// Examples:
const html = await getCleanHTML({ locator: state.page.locator('body') })
const html = await getCleanHTML({ locator: state.page, search: /button/i })
const fullHtml = await getCleanHTML({ locator: state.page, showDiffSinceLastCall: false })  // disable diff
```

**Parameters:**

- `locator` - Playwright Locator or Page to get HTML from
- `search` - string/regex to filter results (returns first 10 matching lines with 5 lines context)
- `showDiffSinceLastCall` - returns diff since last call (default: `true`, but `false` when `search` is provided). Pass `false` to get full HTML.
- `includeStyles` - keep style and class attributes (default: false)

Cleans HTML automatically: removes script/style/svg/head tags, unwraps empty wrappers, removes empty elements, truncates long values. Keeps semantic attributes (`href`, `name`, `type`, `aria-*`, `data-*`).

**getPageMarkdown** - extract main page content as plain text using Mozilla Readability (same algorithm as Firefox Reader View). Strips navigation, ads, sidebars, and other clutter. Returns formatted text with title, author, and content:

```js
await getPageMarkdown({ page: state.page, search?, showDiffSinceLastCall? })
// Examples:
const content = await getPageMarkdown({ page: state.page, showDiffSinceLastCall: false })  // full article
const matches = await getPageMarkdown({ page: state.page, search: /API/i })  // search within content
```

**Output format:**

```
# Article Title

Author: John Doe | Site: example.com | Published: 2024-01-15

> Article excerpt or description

The main article content as plain text, with paragraphs preserved...
```

**Parameters:**

- `page` - Playwright Page to extract content from
- `search` - string/regex to filter content (returns first 10 matching lines with 5 lines context)
- `showDiffSinceLastCall` - returns diff since last call (default: `true`, but `false` when `search` is provided). Pass `false` to get full content.

**waitForPageLoad** - smart load detection that ignores analytics/ads:

```js
await waitForPageLoad({ page: state.page, timeout?, pollInterval?, minWait? })
// Returns: { success, readyState, pendingRequests, waitTimeMs, timedOut }
```

**getCDPSession** - send raw CDP commands:

```js
const cdp = await getCDPSession({ page: state.page })
const metrics = await cdp.send('Page.getLayoutMetrics')
```

**getLocatorStringForElement** - get stable Playwright selector from an element:

```js
const selector = await getLocatorStringForElement(state.page.locator('[id="submit-btn"]'))
// => "getByRole('button', { name: 'Save' })"
```

**getReactSource** - get React component source location (dev mode only):

```js
const source = await getReactSource({ locator: state.page.locator('[data-testid="submit-btn"]') })
// => { fileName, lineNumber, columnNumber, componentName }
```

**getStylesForLocator** - inspect CSS styles applied to an element, like browser DevTools "Styles" panel. Useful for debugging styling issues, finding where a CSS property is defined (file:line), and checking inherited styles. Returns selector, source location, and declarations for each matching rule. ALWAYS fetch `https://playwriter.dev/resources/styles-api.md` first with curl or webfetch tool.

```js
const styles = await getStylesForLocator({
  locator: state.page.locator('.btn'),
  cdp: await getCDPSession({ page: state.page }),
})
console.log(formatStylesAsText(styles))
```

**createDebugger** - set breakpoints, step through code, inspect variables at runtime. Useful for debugging issues that only reproduce in browser, understanding code flow, and inspecting state at specific points. Can pause on exceptions, evaluate expressions in scope, and blackbox framework code. ALWAYS fetch `https://playwriter.dev/resources/debugger-api.md` first.

```js
const cdp = await getCDPSession({ page: state.page })
const dbg = createDebugger({ cdp })
await dbg.enable()
const scripts = await dbg.listScripts({ search: 'app' })
await dbg.setBreakpoint({ file: scripts[0].url, line: 42 })
// when paused: dbg.inspectLocalVariables(), dbg.stepOver(), dbg.resume()
```

**createEditor** - view and live-edit page scripts and CSS at runtime. Edits are in-memory (persist until reload). Useful for testing quick fixes, searching page scripts with grep, and toggling debug flags. ALWAYS read `https://playwriter.dev/resources/editor-api.md` first.

```js
const cdp = await getCDPSession({ page: state.page })
const editor = createEditor({ cdp })
await editor.enable()
const matches = await editor.grep({ regex: /console\.log/ })
await editor.edit({ url: matches[0].url, oldString: 'DEBUG = false', newString: 'DEBUG = true' })
```

**screenshotWithAccessibilityLabels** - take a screenshot with Vimium-style visual labels overlaid on interactive elements. Shows labels, captures screenshot, then removes labels. The image and accessibility snapshot are automatically included in the response. Can be called multiple times to capture multiple screenshots. Use a timeout of **20 seconds** for complex pages.

Prefer this for pages with grids, image galleries, maps, or complex visual layouts where spatial position matters. For simple text-heavy pages, `snapshot` with search is faster and uses fewer tokens.

```js
await screenshotWithAccessibilityLabels({ page: state.page })
// Image and accessibility snapshot are automatically included in response
// Use refs from snapshot to interact with elements
await state.page.locator('[id="submit-btn"]').click()

// Can take multiple screenshots in one execution
await screenshotWithAccessibilityLabels({ page: state.page })
await state.page.click('button')
await screenshotWithAccessibilityLabels({ page: state.page })
// Both images are included in the response
```

Labels are color-coded: yellow=links, orange=buttons, coral=inputs, pink=checkboxes, peach=sliders, salmon=menus, amber=tabs.

**resizeImage** - shrink an image in-place so it consumes fewer tokens when read back into context. `await resizeImage({ input: './screenshot.png' })`. Also accepts `width`, `height`, `maxDimension`, `quality`, `output`.

**recording.start / recording.stop** - record the page as a video at native FPS (30-60fps). Uses `chrome.tabCapture` so **recording survives page navigation**. Auto-overlays a ghost cursor that follows mouse actions. Requires user to have clicked the Playwriter extension icon on the tab. Auto-resizes viewport to 16:9 (override with `aspectRatio: null`). Auto-stops after 15 min (override with `maxDurationMs`).

For demos, use interaction methods (`locator.click()`, `page.mouse.move()`) instead of `goto()` to show realistic cursor motion.

```js
await recording.start({
  page: state.page,
  outputPath: './recording.mp4',
  frameRate: 30, // default
  audio: false, // default (tab audio)
  videoBitsPerSecond: 2500000,
  aspectRatio: { width: 16, height: 9 }, // default, set null to skip
  maxDurationMs: 15 * 60 * 1000, // default, set 0 to disable
})

// Recording survives navigation
await state.page.click('a')
await state.page.waitForLoadState('domcontentloaded')

// Stop — save full result including executionTimestamps for createDemoVideo
state.recordingResult = await recording.stop({ page: state.page })

// Other: recording.isRecording({ page }), recording.cancel({ page })
```

**ghostCursor.show / ghostCursor.hide** - show/hide cursor overlay for screenshots and demos:

```js
await ghostCursor.show({ page: state.page, style: 'minimal' }) // 'minimal', 'dot', 'screenstudio'
await ghostCursor.hide({ page: state.page })
```

**createDemoVideo** - speeds up idle sections (time between execute() calls) while keeping interactions at normal speed. Requires `ffmpeg`/`ffprobe`. Timestamps are tracked automatically during recording and returned by `recording.stop()`. **Timeout**: can take 60–120+ seconds, always pass `--timeout 120000` or higher.

```js
// After recording.stop(), save full result to state (executionTimestamps powers idle detection)
state.recordingResult = await recording.stop({ page: state.page })

// In a SEPARATE execute call with --timeout 120000:
const demoPath = await createDemoVideo({
  recordingPath: state.recordingResult.path,
  durationMs: state.recordingResult.duration,
  executionTimestamps: state.recordingResult.executionTimestamps,
  speed: 6, // default 6x for idle sections
})
```

## pinned elements

Users can right-click → "Copy Playwriter Element Reference" to store elements in `globalThis.playwriterPinnedElem1` (increments for each pin). The reference is copied to clipboard:

```js
const el = await state.page.evaluateHandle(() => globalThis.playwriterPinnedElem1)
await el.click()
```

## taking screenshots

Always use `scale: 'css'` to avoid 2-4x larger images on high-DPI displays:

```js
await state.page.screenshot({ path: 'shot.png', scale: 'css' })
```

If you want to read back the image file into context, resize it first so it consumes fewer tokens:

```js
await resizeImage({ input: './shot.png' })
```

## page.evaluate

Code inside `page.evaluate()` runs in the browser - use plain JavaScript only, no TypeScript syntax. Return values and log outside (console.log inside evaluate runs in browser, not visible):

```js
const title = await state.page.evaluate(() => document.title)
console.log('Title:', title)

const info = await state.page.evaluate(() => ({
  url: location.href,
  buttons: document.querySelectorAll('button').length,
}))
console.log(info)
```

## loading files

Fill inputs with file content:

```js
const fs = require('node:fs')
const content = fs.readFileSync('./data.txt', 'utf-8')
await state.page.locator('textarea').fill(content)
```

## network interception

For scraping or reverse-engineering APIs, intercept network requests instead of scrolling DOM. Store in `state` to analyze across calls:

```js
state.requests = []
state.responses = []
state.page.on('request', (req) => {
  if (req.url().includes('/api/')) state.requests.push({ url: req.url(), method: req.method(), headers: req.headers() })
})
state.page.on('response', async (res) => {
  if (res.url().includes('/api/')) {
    try {
      state.responses.push({ url: res.url(), status: res.status(), body: await res.json() })
    } catch {}
  }
})
```

Then trigger actions (scroll, click, navigate) and analyze captured data:

```js
console.log('Captured', state.responses.length, 'API calls')
state.responses.forEach((r) => console.log(r.status, r.url.slice(0, 80)))
```

Inspect a specific response to understand schema:

```js
const resp = state.responses.find((r) => r.url.includes('users'))
console.log(JSON.stringify(resp.body, null, 2).slice(0, 2000))
```

Replay API directly (useful for pagination):

```js
const { url, headers } = state.requests.find((r) => r.url.includes('feed'))
const data = await state.page.evaluate(
  async ({ url, headers }) => {
    const res = await fetch(url, { headers })
    return res.json()
  },
  { url, headers },
)
console.log(data)
```

Clean up listeners when done: `state.page.removeAllListeners('request'); state.page.removeAllListeners('response');`

## computer use (low-level mouse/keyboard)

### clicking

```js
// Preferred: by locator (stable, auto-waits, no coordinates needed)
await state.page.locator('button[name="Submit"]').click()
await state.page.locator('text=Login').click({ button: 'right' })
await state.page.locator('text=Login').dblclick()
await state.page
  .locator('a')
  .first()
  .click({ modifiers: ['Meta'] }) // cmd+click opens new tab

// By coordinates (when locators aren't available, e.g. canvas, maps, custom widgets)
await state.page.mouse.click(450, 320) // left click
await state.page.mouse.click(450, 320, { button: 'right' }) // right click
await state.page.mouse.dblclick(450, 320) // double click
await state.page.mouse.click(450, 320, { clickCount: 3 }) // triple click
await state.page.mouse.click(450, 320, { modifiers: ['Shift'] }) // shift+click
```

### hover

```js
await state.page.locator('.tooltip-trigger').hover() // by locator (preferred)
await state.page.mouse.move(450, 320) // by coordinates
```

### scroll

```js
// By locator (preferred)
await state.page.locator('#footer').scrollIntoViewIfNeeded()

// By pixel (for canvas, maps, infinite scroll)
await state.page.mouse.wheel(0, 300) // scroll down 300px
await state.page.mouse.wheel(0, -300) // scroll up
await state.page.mouse.wheel(300, 0) // scroll right
await state.page.mouse.wheel(-300, 0) // scroll left

// Scroll at a specific position
await state.page.mouse.move(450, 320)
await state.page.mouse.wheel(0, 500)

// Scroll inside a container
await state.page.locator('.scrollable-list').evaluate((el) => {
  el.scrollTop += 500
})
```

### drag

```js
// By locator (preferred)
await state.page.locator('#item').dragTo(state.page.locator('#target'))

// By coordinates (for canvas, sliders, custom drag targets)
await state.page.mouse.move(100, 200)
await state.page.mouse.down()
await state.page.mouse.move(400, 500, { steps: 10 }) // steps for smooth drag
await state.page.mouse.up()
```

**Freehand drawing, annotation widgets, and canvas tools** use this same `mouse.down → move → up` pattern. If a widget expects a drawn stroke (paint tools, annotation overlays, range sliders, timeline scrubbers), always use held-mouse motion — not `mouse.click()`:

```js
// Draw a stroke across a canvas or annotation layer
await state.page.mouse.move(startX, startY)
await state.page.mouse.down()
await state.page.mouse.move(endX, endY, { steps: 15 }) // steps = smoother stroke
await state.page.mouse.up()
await state.page.waitForTimeout(500) // let the widget process the stroke
```

### key hold / release / repeat

```js
// Hold modifier while pressing another key
await state.page.keyboard.down('Shift')
await state.page.keyboard.press('ArrowDown')
await state.page.keyboard.up('Shift')

// Repeat a key
for (let i = 0; i < 5; i++) await state.page.keyboard.press('ArrowDown')
```

### resize viewport

```js
await state.page.setViewportSize({ width: 1280, height: 720 })
```

### region screenshot (zoom equivalent)

```js
await state.page.screenshot({ path: 'region.png', scale: 'css', clip: { x: 100, y: 200, width: 400, height: 300 } })
```

Prefer locator-based actions over coordinates — locators are stable across scroll/resize, auto-wait for elements, and don't require screenshot round-trips that burn ~800 image tokens per cycle.

## Ghost Browser integration

When running in [Ghost Browser](https://ghostbrowser.com/), the `chrome` object exposes APIs for multi-identity automation (identities, proxies, sessions). See `extension/src/ghost-browser-api.d.ts` for full API reference. Only works in Ghost Browser — calls fail in regular Chrome.
