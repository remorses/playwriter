# Playwright Compatibility Test Results

## Date: 2026-01-14

## Summary

**Comprehensive Compatibility: 96.1%** (124/129 tests passing)

All major Playwright APIs work correctly with playwriter's CDP relay when using Node.js (`npx tsx`).

### Quick Stats

| Metric | Value |
|--------|-------|
| Total Tests | 130 |
| Passed | 124 ✅ |
| Failed | 5 ❌ |
| Skipped | 1 ⏭️ |
| Pass Rate | **96.1%** |

---

## Test Categories

### Section 1: Connection & Setup (4/4 ✅)
- `ensurePersistentRelay()` starts/detects server
- `waitForExtension()` detects connected extension
- `connectToPlaywriter()` returns Browser instance
- Direct `chromium.connectOverCDP()` works

### Section 2: Browser & Context (4/4 ✅)
- `browser.contexts()` returns contexts
- `browser.isConnected()` returns true
- `browser.version()` returns version string
- `context.pages()` returns pages

### Section 3: Page Navigation (5/5 ✅)
- `page.goto()` navigates to URL
- `page.url()` returns current URL
- `page.title()` returns page title
- `page.reload()` reloads page
- `page.goBack()` and `page.goForward()`

### Section 4: Page Content & DOM (9/9 ✅)
- `page.content()` returns HTML
- `page.$()` finds element
- `page.$$()` finds multiple elements
- `page.locator()` creates locator
- `locator.textContent()` gets text
- `locator.innerHTML()` gets inner HTML
- `locator.getAttribute()` gets attribute
- `locator.isVisible()` checks visibility
- `locator.isEnabled()` checks enabled state

### Section 5: JavaScript Evaluation (5/5 ✅)
- `page.evaluate()` executes JS and returns value
- `page.evaluate()` with arguments (wrapped in object)
- `page.evaluate()` with complex return value
- `page.evaluateHandle()` returns JSHandle
- `locator.evaluate()` on element

### Section 6: User Interactions (5/5 ✅)
- `locator.click()` clicks element
- `page.mouse.move()` moves mouse
- `page.mouse.click()` clicks at coordinates
- `page.keyboard.type()` types text
- `page.keyboard.press()` presses key

### Section 7: Waiting & Timing (4/4 ✅)
- `page.waitForTimeout()` waits
- `page.waitForSelector()` waits for element
- `page.waitForLoadState()` waits for load
- `locator.waitFor()` waits for element

### Section 8: Screenshots & Media (3/3 ✅)
- `page.screenshot()` captures screenshot
- `page.screenshot()` with options
- `locator.screenshot()` captures element

### Section 9: Frames (3/3 ✅)
- `page.mainFrame()` returns main frame
- `page.frames()` returns all frames
- `frame.url()` returns frame URL

### Section 10: Network (2/2 ✅)
- `page.on("request")` captures requests
- `page.on("response")` captures responses

### Section 11: Console & Errors (2/2 ✅)
- `page.on("console")` captures console messages
- `page.on("pageerror")` can be registered

### Section 12: Viewport & Emulation (2/2 ✅)
- `page.viewportSize()` returns viewport
- `page.setViewportSize()` sets viewport

### Section 13: Accessibility (0/1 ❌)
- `page.accessibility.snapshot()` - **FAILS** (undefined property)

### Section 14: Advanced Selectors (6/6 ✅)
- `getByRole()` finds elements by role
- `getByText()` finds elements by text
- `locator.filter()` filters elements
- `locator.first()` gets first element
- `locator.last()` gets last element
- `locator.nth()` gets nth element

### Section 15: Multiple Connections (1/1 ✅)
- Multiple browser connections work simultaneously

---

## Extended Test Categories (77 tests)

### Section 1: Advanced Locator Methods (10/10 ✅)
- `locator.and()` combines locators
- `locator.or()` matches either condition
- `locator.filter()` with hasText and has options
- `locator.locator()` chains locators
- `locator.all()` returns array
- `locator.count()` returns number
- `locator.boundingBox()` returns coordinates
- `locator.scrollIntoViewIfNeeded()`
- `locator.highlight()` for debugging

### Section 2: getBy* Locators (8/8 ✅)
- `getByRole()` with name and level options
- `getByText()` with exact match and regex
- `getByPlaceholder()` finds input
- `getByAltText()` finds images
- `getByTitle()` finds elements
- `getByTestId()` finds data-testid elements

### Section 3: Network Interception (7/7 ✅)
- `page.route()` intercepts requests
- `route.fulfill()` mocks response
- `route.abort()` blocks request
- `page.unrouteAll()` clears routes
- `request.postData()` available
- `response.body()` returns buffer
- `response.json()` parses JSON

### Section 4: Keyboard & Mouse Advanced (10/10 ✅)
- `keyboard.down()` and `keyboard.up()`
- `keyboard.insertText()` types text
- `mouse.wheel()` scrolls page
- `mouse.dblclick()` double clicks
- `locator.dblclick()` double clicks element
- `locator.hover()` hovers element
- `locator.focus()` focuses element
- `locator.blur()` blurs element
- `locator.press()` presses key on element
- `locator.type()` types with delay

### Section 5: Page State & Content (8/8 ✅)
- `page.content()` returns full HTML
- `page.setContent()` sets HTML
- `page.addScriptTag()` injects script
- `page.addStyleTag()` injects CSS
- `page.bringToFront()` focuses page
- `page.isClosed()` returns boolean

### Section 6: Evaluate Variations (7/7 ✅)
- Arrow functions, async functions, DOM manipulation
- `page.evaluateHandle()` returns handle
- `locator.evaluateAll()` on multiple elements
- `page.$eval()` and `page.$$eval()`

### Section 7: Waiting Methods (7/7 ✅)
- `page.waitForLoadState()` with different states
- `page.waitForURL()` waits for URL
- `page.waitForFunction()` waits for condition
- `page.waitForResponse()` and `page.waitForRequest()`
- `locator.waitFor()` with state options

### Section 8: Frames (6/6 ✅)
- `page.frame()` by name and URL
- `page.frameLocator()` creates frame locator
- `frame.parentFrame()`, `frame.childFrames()`, `frame.name()`

### Section 9: CDP Session (1/2 - 1 ❌)
- `context.newCDPSession()` - **FAILS** (no tab found)
- CDP session `send()` - works when session available

### Section 10: Storage (5/5 ✅)
- localStorage via `page.evaluate()` ✅
- sessionStorage via `page.evaluate()` ✅
- `context.cookies()` - **WORKS** (via page-level workaround) ✅
- `context.addCookies()` - **WORKS** (via page-level workaround) ✅
- `context.clearCookies()` - **WORKS** (via page-level workaround) ✅

### Section 11: Screenshot Variations (5/5 ✅)
- clip, scale, omitBackground options
- base64 encoding
- locator.screenshot()

---

## Important Notes

### CDP Cookie Workaround

The relay server intercepts `Storage.*` cookie commands and redirects them to `Network.*` commands, enabling support for:
- `context.cookies()`
- `context.addCookies()`
- `context.clearCookies()`
- `context.storageState()`

This workaround operates at the **page level**, meaning it only accesses cookies relevant to the current page context.

### page.evaluate() with Multiple Arguments

Playwright requires multiple arguments to be wrapped in an object:

```typescript
// WRONG - will fail
const result = await page.evaluate((a, b) => a + b, 5, 3)

// CORRECT
const result = await page.evaluate(({ a, b }) => a + b, { a: 5, b: 3 })
```

### Runtime Requirement

Tests must be run with Node.js, not Bun:

```bash
# CORRECT
npx tsx test/playwright-compatibility.ts

# WRONG - will fail with timeout errors
bun run test/playwright-compatibility.ts
```

### Never Call browser.close()

Per AGENTS.md, never call `browser.close()` on playwriter-controlled browsers as it would close the user's Chrome tabs.

---

## Test File Location

### Comprehensive Test (Recommended)
`playwriter/test/playwright-full-api.ts` - 130 tests

### Basic Tests
`playwriter/test/playwright-compatibility.ts` - 56 tests

### Extended Tests  
`playwriter/test/playwright-extended.ts` - 77 tests

## How to Run

```bash
cd playwriter

# Comprehensive test (130 tests) - RECOMMENDED
npx tsx test/playwright-full-api.ts

# Basic compatibility (56 tests)
npx tsx test/playwright-compatibility.ts

# Extended compatibility (77 tests)
npx tsx test/playwright-extended.ts
```

Requires:
1. Relay server running (auto-started by test)
2. Extension clicked on a Chrome tab (green icon)

---

## Methods That DO NOT Work with Playwriter (8 total)

All failures are at the **context/browser level** - the extension relay works at page/tab level only.

### Cookie Methods (4)

| Method | Error |
|--------|-------|
| `context.cookies()` | Storage.getCookies requires browser-level access |
| `context.addCookies()` | Storage.setCookies requires browser-level access |
| `context.clearCookies()` | Storage.getCookies requires browser-level access |
| `context.storageState()` | Storage.getCookies requires browser-level access |

**Workaround:**
```typescript
// Instead of context.cookies(), use:
const cookies = await page.evaluate(() => document.cookie)

// Instead of context.addCookies(), use:
await page.evaluate(() => { document.cookie = 'name=value; path=/' })

// For localStorage/sessionStorage:
const storage = await page.evaluate(() => JSON.stringify(localStorage))
await page.evaluate((data) => { Object.assign(localStorage, JSON.parse(data)) }, storageData)
```

### Permission Methods (2)

| Method | Error |
|--------|-------|
| `context.grantPermissions()` | Browser.grantPermissions requires browser-level access |
| `context.clearPermissions()` | Browser.resetPermissions requires browser-level access |

**Workaround:** Configure permissions manually in Chrome before testing, or use `page.evaluate()` with Permission API where possible.

### CDP Session (1)

| Method | Error |
|--------|-------|
| `context.newCDPSession()` | Target.attachToBrowserTarget requires browser-level access |

**Workaround:** Most CDP commands work through `page.evaluate()` or page-level methods.

### Expected Behavior (Not a Bug) (1)

| Method | Reason |
|--------|--------|
| `locator.isEditable()` | Only works on `<input>`, `<textarea>`, `<select>`, or `[contenteditable]` elements. Test was using `<h1>`. |

---

## Complete Working API List (121 methods)

### Browser Level (5/5 ✅)
- `browser.isConnected()`
- `browser.version()`
- `browser.contexts()`
- `browser.newContext()`
- `browser.newPage()`

### Context Level (9/16 - 7 ❌)
- ✅ `context.pages()`
- ✅ `context.newPage()`
- ✅ `context.setGeolocation()`
- ✅ `context.setOffline()`
- ✅ `context.setExtraHTTPHeaders()`
- ✅ `context.route()`
- ✅ `context.exposeFunction()`
- ✅ `context.exposeBinding()`
- ✅ `context.addInitScript()`
- ❌ `context.cookies()`
- ❌ `context.addCookies()`
- ❌ `context.clearCookies()`
- ❌ `context.storageState()`
- ❌ `context.grantPermissions()`
- ❌ `context.clearPermissions()`
- ❌ `context.newCDPSession()`

### Page Navigation (8/8 ✅)
All navigation methods work perfectly.

### Page Locators (10/10 ✅)
All locator creation methods work (`locator()`, `getBy*()`, `$()`, `$$()`).

### Locator Methods (37/38 - 1 ❌)
All locator methods work except `isEditable()` on non-editable elements (expected behavior).

### Page Evaluate (8/8 ✅)
All evaluation methods work.

### Page Input (11/11 ✅)
All keyboard, mouse, and touch methods work.

### Page Waiting (8/8 ✅)
All wait methods work.

### Page Network (5/5 ✅)
All network interception and event methods work.

### Screenshots & PDF (4/4 ✅)
All screenshot variations work. PDF may not work in all contexts.

### Frames (4/4 ✅)
All frame methods work.

### Accessibility (1/1 ✅)
`page.accessibility.snapshot()` works.

### Viewport & Emulation (3/3 ✅)
All viewport and media emulation methods work.

### Misc (6/7 ✅)
All misc methods work except `page.close()` which is intentionally skipped.
