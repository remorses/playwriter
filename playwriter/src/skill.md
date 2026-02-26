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
playwriter -s 1 -e "await state.page.click('button')"

# Get page title
playwriter -s 1 -e "await state.page.title()"

# Take a screenshot
playwriter -s 1 -e "await state.page.screenshot({ path: 'screenshot.png', scale: 'css' })"

# Get accessibility snapshot
playwriter -s 1 -e "await snapshot({ page: state.page })"

# Get accessibility snapshot for a specific iframe
const frame = await state.page.locator('iframe').contentFrame()
await snapshot({ frame })
```

**Multiline code:**

```bash
# Using $'...' syntax for multiline code
playwriter -s 1 -e $'
const title = await state.page.title();
const url = state.page.url();
console.log({ title, url });
'

# Or use heredoc
playwriter -s 1 -e "$(cat <<'EOF'
const links = await state.page.$$eval('a', els => els.map(e => e.href));
console.log('Found', links.length, 'links');
EOF
)"
```

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
- **Snapshot before screenshot**: always use `snapshot()` first to understand page state (text-based, fast, cheap). Only use `screenshot` or `screenshotWithAccessibilityLabels` when you specifically need visual/spatial information. Never take a screenshot just to check if a page loaded or to read text content — snapshot gives you that instantly without burning image tokens

## interaction feedback loop

Every browser interaction should follow a **observe → act → observe** loop. After every action, you must check its result before proceeding. Never chain multiple actions blindly — the page may not have responded as expected.

**Core loop:**

1. **Open page** — get or create your page and navigate to the target URL
2. **Observe** — print `state.page.url()` and take an accessibility snapshot. Always print the URL so you know where you are — pages can redirect, and actions can trigger unexpected navigation.
3. **Check** — read the snapshot and URL. If the page isn't ready (still loading, expected content missing, wrong URL), **wait and observe again** — don't act on stale or incomplete state. Only proceed when you can identify the element to interact with.
4. **Act** — perform one action (click, type, submit)
5. **Observe again** — print URL + snapshot to verify the action's effect. If the action didn't take effect (nothing changed, page still loading), wait and observe again before proceeding.
6. **Repeat** — continue from step 3 until the task is complete

```
┌─────────────────────────────────────────────┐
│            open page + goto URL             │
└──────────────────┬──────────────────────────┘
                   ▼
          ┌────────────────┐
     ┌───►│    observe      │◄─────────────────┐
     │    │ (url + snapshot) │                   │
     │    └───────┬────────┘                   │
     │            ▼                            │
     │    ┌────────────────┐                   │
     │    │     check       │                   │
     │    │  (read result)  │                   │
     │    └───┬────────┬───┘                   │
     │  not   │        │ ready                 │
     │  ready │        ▼                       │
     └────────┘ ┌────────────────┐             │
                │      act        │             │
                │  (click/type)   │─────────────┘
                └────────────────┘
```

**Example: opening a Framer plugin via the command palette**

Each step is a separate execute call. Notice how every action is followed by a snapshot to verify what happened:

```js
// 1. Open page and observe — always print URL first
state.page = context.pages().find((p) => p.url() === 'about:blank') ?? (await context.newPage())
await state.page.goto('https://framer.com/projects/my-project', { waitUntil: 'domcontentloaded' })
console.log('URL:', state.page.url())
await snapshot({ page: state.page }).then(console.log)
```

```js
// 2. Act: open command palette → observe result
await state.page.keyboard.press('Meta+k')
console.log('URL:', state.page.url())
await snapshot({ page: state.page, search: /dialog|Search/ }).then(console.log)
// If dialog didn't appear, observe again before retrying
```

```js
// 3. Act: type search query → observe result
await state.page.keyboard.type('MCP')
console.log('URL:', state.page.url())
await snapshot({ page: state.page, search: /MCP/ }).then(console.log)
```

```js
// 4. Act: press Enter → observe plugin loaded
await state.page.keyboard.press('Enter')
await state.page.waitForTimeout(1000)
console.log('URL:', state.page.url())
const frame = state.page.frames().find((f) => f.url().includes('plugins.framercdn.com'))
await snapshot({ page: state.page, frame: frame || undefined }).then(console.log)
// If frame not found, wait and observe again — plugin may still be loading
```

**Other ways to observe action results:**

Snapshots are the primary feedback mechanism, but some actions have side effects that are better observed through other channels:

- **Console logs** — check for errors or app state after an action:
  ```js
  await getLatestLogs({ page: state.page, search: /error|fail/i, count: 20 })
  ```
- **Network requests** — verify API calls were made after a form submit or button click:
  ```js
  state.page.on('response', async (res) => {
    if (res.url().includes('/api/')) {
      console.log(res.status(), res.url())
    }
  })
  ```
- **URL changes** — confirm navigation happened:
  ```js
  console.log(state.page.url())
  ```
- **Screenshots** — only for visual layout issues (see "choosing between snapshot methods" below).

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
Locators (especially ones with `>> nth=`) can change when the page updates. Always get a fresh snapshot before clicking:

```js
// BAD: using ref from minutes ago
await state.page.locator('[id="old-id"]').click() // element may have changed

// GOOD: get fresh snapshot, then immediately use locators from it
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
`keyboard.type()` doesn't insert newlines from `\n` in strings. Use `keyboard.press('Enter')`:

```js
// BAD: newlines in string don't create line breaks
await state.page.keyboard.type('Line 1\nLine 2') // becomes "Line 1Line 2"

// GOOD: use Enter key for line breaks
await state.page.keyboard.type('Line 1')
await state.page.keyboard.press('Enter')
await state.page.keyboard.type('Line 2')
```

**6. Quote escaping in $'...' syntax**
When using `$'...'` for multiline code, nested quotes break parsing. Use different quote styles or escape them:

```bash
# BAD: nested double quotes break $'...'
playwriter -s 1 -e $'await state.page.locator("[id=\"_r_a_\"]").click()'

# GOOD: use single quotes inside, or template strings
playwriter -s 1 -e $'await state.page.locator(\'[id="_r_a_"]\').click()'

# GOOD: use heredoc for complex quoting
playwriter -s 1 -e "$(cat <<'EOF'
await state.page.locator('[id="_r_a_"]').click()
EOF
)"
```

**7. Using screenshots when snapshots suffice**
Screenshots + image analysis is expensive and slow. Only use screenshots for visual/CSS issues:

```js
// BAD: screenshot to check if text appeared (wastes tokens on image analysis)
await state.page.screenshot({ path: 'check.png', scale: 'css' })

// GOOD: snapshot is text — fast, cheap, searchable
await snapshot({ page: state.page, search: /expected text/i })

// GOOD: evaluate DOM directly for content checks
const text = await state.page.evaluate(() => document.querySelector('.message')?.textContent)
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
Do NOT waste context trying webfetch, curl, or Playwright CLI screenshots on SPAs (Instagram, Twitter, etc.). These sites return empty HTML shells — the real content is rendered by JavaScript. Use playwriter with a real browser session instead:

```js
// BAD: webfetch/curl on Instagram returns empty HTML, grep finds nothing, huge context wasted
// BAD: Playwright CLI screenshot needs browser install, produces blank/modal-blocked images

// GOOD: use playwriter — real browser, full JS rendering, interactive
state.page = context.pages().find((p) => p.url() === 'about:blank') ?? (await context.newPage())
await state.page.goto('https://www.instagram.com/p/ABC123/', { waitUntil: 'domcontentloaded' })
await waitForPageLoad({ page: state.page, timeout: 8000 })
await snapshot({ page: state.page, search: /cookie|consent|accept/i }).then(console.log)
// Now you can see modals, dismiss them, navigate carousels, extract content
```

**10. Login buttons that open popups**
Playwriter extension cannot control popup windows. If a login button opens a popup (common with OAuth/SSO), use cmd+click to open in a new tab instead:

```js
// BAD: popup window is not controllable by playwriter
await state.page.click('button:has-text("Login with Google")')

// GOOD: cmd+click opens in new tab that playwriter can control
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
`dispatchEvent(new MouseEvent(...))` and `{ force: true }` bypass Playwright checks but **do not trigger React/Vue/Svelte handlers** — state won't update. If a click "succeeds" but nothing changes, you're clicking the wrong node:

```js
// BAD: heading click bypasses overlay but React ignores it
await state.page.locator('h3:has-text("Node.js")').click({ force: true })
// GOOD: snapshot shows the real interactive element is a radio, not the heading
await state.page.getByRole('radio', { name: 'Node.js' }).click()
```

## checking page state

After any action (click, submit, navigate), verify what happened. Always print URL first, then snapshot:

```js
// Always print URL first, then snapshot
console.log('URL:', state.page.url())
await snapshot({ page: state.page }).then(console.log)

// Filter for specific content when snapshot is large
console.log('URL:', state.page.url())
await snapshot({ page: state.page, search: /dialog|button|error/i }).then(console.log)
```

If nothing changed, try `await waitForPageLoad({ page: state.page, timeout: 3000 })` or you may have clicked the wrong element.

## accessibility snapshots

```js
await snapshot({ page: state.page, search?, showDiffSinceLastCall? })
```

`accessibilitySnapshot` is still available as an alias for backward compatibility.

- `search` - string/regex to filter results (returns first 10 matching lines)
- `showDiffSinceLastCall` - returns diff since last snapshot (default: `true`). Pass `false` to get full snapshot.

Snapshots return full content on first call, then diffs on subsequent calls. Diff is only returned when shorter than full content. If nothing changed, returns "No changes since last snapshot" message. Use `showDiffSinceLastCall: false` to always get full content. This diffing behavior also applies to `getCleanHTML` and `getPageMarkdown`.

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

```js
await state.page.locator('[id="nav-home"]').click()
await state.page.locator('[data-testid="docs-link"]').click()
await state.page.locator('role=link[name="Blog"]').click()
```

Search for specific elements:

```js
const snap = await snapshot({ page: state.page, search: /button|submit/i })
```

**Filtering large snapshots in JS** — when the built-in `search` isn't enough (e.g., you need multiple patterns or custom logic), filter the snapshot string directly:

```js
const snap = await snapshot({ page: state.page, showDiffSinceLastCall: false })
const relevant = snap
  .split('\n')
  .filter((l) => l.includes('dialog') || l.includes('error') || l.includes('button'))
  .join('\n')
console.log(relevant)
```

This is much cheaper than taking a screenshot — use it as your primary debugging tool for verifying text content, checking if elements exist, or confirming state changes.

## choosing between snapshot methods

Both `snapshot` and `screenshotWithAccessibilityLabels` use the same ref system, so you can combine them effectively.

**Use `snapshot` when:**

- Page has simple, semantic structure (articles, forms, lists)
- You need to search for specific text or patterns
- Token usage matters (text is smaller than images)
- You need to process the output programmatically

**Use `screenshotWithAccessibilityLabels` when:**

- Page has complex visual layout (grids, galleries, dashboards, maps)
- Spatial position matters (e.g., "first image", "top-left button")
- DOM order doesn't match visual order
- You need to understand the visual hierarchy

**Combining both:** Use screenshot first to understand layout and identify target elements visually, then use `snapshot({ search: /pattern/ })` for efficient searching in subsequent calls.

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

**Authenticated fetches** - to access protected resources, fetch from within page context (includes session cookies automatically):

```js
// BAD: curl/external requests don't have session cookies
// curl -H "Cookie: ..." often fails due to missing cookies or CSRF

// GOOD: fetch inside state.page.evaluate uses browser's full session
const data = await state.page.evaluate(async (url) => {
  const resp = await fetch(url)
  return await resp.text()
}, 'https://example.com/protected/resource')
```

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

**Links that open new tabs** - playwriter cannot control popup windows opened via `window.open`. Use cmd+click to open in a controllable new tab instead (see mistake #9 above for a full example):

```js
await state.page.locator('a[target=_blank]').click({ modifiers: ['Meta'] })
await state.page.waitForTimeout(1000)
const pages = context.pages()
const newTab = pages[pages.length - 1]
console.log('New tab URL:', newTab.url())
```

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
- `showDiffSinceLastCall` - returns diff since last call (default: `true`). Pass `false` to get full HTML.
- `includeStyles` - keep style and class attributes (default: false)

**HTML processing:**
The function cleans HTML for compact, readable output:

- **Removes tags**: script, style, link, meta, noscript, svg, head
- **Unwraps nested wrappers**: Empty divs/spans with no attributes that only wrap a single child are collapsed (e.g., `<div><div><div><p>text</p></div></div></div>` → `<div><p>text</p></div>`)
- **Removes empty elements**: Elements with no attributes and no content are removed
- **Truncates long values**: Attribute values >200 chars and text content >500 chars are truncated

**Attributes kept (summary):**

- Common semantic and ARIA attributes (e.g., `href`, `name`, `type`, `aria-*`)
- All `data-*` test attributes
- Frequently used test IDs and special attributes (e.g., `testid`, `qa`, `e2e`, `vimium-label`)

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
- `showDiffSinceLastCall` - returns diff since last call (default: `true`). Pass `false` to get full content.

**Use cases:**

- Extract article text for LLM processing without HTML noise
- Get readable content from news sites, blogs, documentation
- Compare content changes after interactions

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

**recording.start / recording.stop** - record the page as a video at native FPS (30-60fps). Uses `chrome.tabCapture` in the extension context, so **recording survives page navigation**. Video is saved as mp4.

While recording is active, Playwriter automatically overlays a smooth ghost cursor that follows automated mouse actions (`page.mouse.*`, `locator.click()`, hover flows) using `page.onMouseAction` from the Playwright fork.

For demos where cursor movement should be visible and human-like, drive the page with interaction methods (`locator.click()`, `page.click()`, `page.mouse.move()`, `press`, typing). Avoid skipping interactions with direct state jumps (for example, `goto(itemUrl)` instead of clicking the link) when your goal is to show realistic pointer motion in the recording.

**Note**: Recording requires the user to have clicked the Playwriter extension icon on the tab. This grants `activeTab` permission needed for `chrome.tabCapture`. Recording works on tabs where the icon was clicked - if you need to record a new tab, ask the user to click the icon on it first.

```js
// Start recording - outputPath must be specified upfront
await recording.start({
  page: state.page,
  outputPath: './recording.mp4',
  frameRate: 30, // default: 30
  audio: false, // default: false (tab audio)
  videoBitsPerSecond: 2500000, // 2.5 Mbps
})

// Navigate around - recording continues!
await state.page.click('a')
await state.page.waitForLoadState('domcontentloaded')
await state.page.goBack()

// Stop and get result
const { path, duration, size } = await recording.stop({ page: state.page })
console.log(`Saved ${size} bytes, duration: ${duration}ms`)
```

Additional recording utilities:

```js
// Check if recording is active
const { isRecording, startedAt } = await recording.isRecording({ page: state.page })

// Cancel recording without saving
await recording.cancel({ page: state.page })
```

**ghostCursor.show / ghostCursor.hide** - manually show or hide the in-page cursor overlay. Useful for screenshots and demos even when recording is not running.

```js
// Show cursor in the center (or keep current position if already visible)
await ghostCursor.show({ page: state.page })

// Optional styles: 'minimal' (default triangular pointer), 'dot', 'screenstudio'
await ghostCursor.show({ page: state.page, style: 'minimal' })

// Hide cursor overlay
await ghostCursor.hide({ page: state.page })
```

`startRecording`, `stopRecording`, `isRecording`, and `cancelRecording` remain available as backward-compatible aliases.

**Key difference from getDisplayMedia**: This approach uses `chrome.tabCapture` which runs in the extension context, not the page. The recording persists across navigations because the extension holds the `MediaRecorder`, not the page's JavaScript context.

**createDemoVideo** - create a polished demo video from a recording by automatically speeding up idle sections (time between execute() calls) while keeping interactions at normal speed. Useful for creating demo videos of agent workflows without long pauses.

While recording is active, playwriter tracks when each `execute()` call starts and ends. `recording.stop()` returns these timestamps alongside the video file. `createDemoVideo` uses this data to identify idle gaps and speed them up with ffmpeg in a single pass.

A 1-second buffer is preserved around each interaction so viewers see context before and after each action.

Requires `ffmpeg` and `ffprobe` installed on the system.

```js
// Start recording
await recording.start({ page: state.page, outputPath: './recording.mp4' })
```

```js
// ... multiple execute() calls with browser interactions ...
// Each call's timing is tracked automatically while recording is active
```

```js
// Stop recording — executionTimestamps is included in the result
const recordingResult = await recording.stop({ page: state.page })

// Create demo video — idle gaps are sped up 4x (default)
const demoPath = await createDemoVideo({
  recordingPath: recordingResult.path,
  durationMs: recordingResult.duration,
  executionTimestamps: recordingResult.executionTimestamps,
  speed: 5, // optional, default 5x for idle sections
  // outputFile: './demo.mp4', // optional, defaults to recording-demo.mp4
})
console.log('Demo video:', demoPath)
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

## debugging web apps

When debugging why a web app isn't working (e.g., content not rendering, API errors, state issues), use these techniques **before** resorting to screenshots:

**1. Console logs** — use `getLatestLogs` to check for errors:

```js
const errors = await getLatestLogs({ page: state.page, search: /error|fail/i, count: 20 })
const appLogs = await getLatestLogs({ page: state.page, search: /myComponent|state/i })
```

**2. DOM inspection via evaluate** — check content directly without screenshots:

```js
const info = await state.page.evaluate(() => {
  const msgs = document.querySelectorAll('.message')
  return Array.from(msgs).map((m) => ({
    text: m.textContent?.slice(0, 200),
    visible: m.offsetHeight > 0,
  }))
})
console.log(JSON.stringify(info, null, 2))
```

**3. Combine snapshot + logs for full picture:**

```js
await state.page.keyboard.press('Enter')
await state.page.waitForTimeout(2000)

const snap = await snapshot({ page: state.page, search: /dialog|error|message/ })
const logs = await getLatestLogs({ page: state.page, search: /error/i, count: 10 })
console.log('UI:', snap)
console.log('Logs:', logs)
```

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

## computer use

Playwriter provides the same browser control as Anthropic's `computer_20250124` tool and the Claude Chrome extension, using Playwright APIs instead of screenshot-based coordinate clicking. No computer use beta needed.

This section covers low-level mouse/keyboard APIs not documented elsewhere. For locator-based clicking, screenshots, navigation, forms, evaluate, snapshots, and network interception see their dedicated sections above.

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

Playwriter supports [Ghost Browser](https://ghostbrowser.com/) for multi-identity automation. When running in Ghost Browser, the `chrome` object exposes APIs to control identities, proxies, and sessions - useful for managing multiple accounts, rotating proxies, or isolated cookie sessions.

```js
// List identities and open tabs in different ones
const identities = await chrome.projects.getIdentitiesList()
await chrome.ghostPublicAPI.openTab({ url: 'https://reddit.com', identity: identities[0].id })

// Assign proxies per tab or identity
const proxies = await chrome.ghostProxies.getList()
await chrome.ghostProxies.setTabProxy(tabId, proxies[0].id)
```

For complete API reference with all methods, types, and examples, read:
`extension/src/ghost-browser-api.d.ts`

Note: Only works in Ghost Browser. In regular Chrome, calls fail with "not available".
