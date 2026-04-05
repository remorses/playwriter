# Memory

## Auto-returned values in playwriter CLI: skip useless Playwright handles (Apr 2026)

The CLI auto-returns single-expression code (e.g. `await page.goto(url)`).
Playwright methods return handle objects (Response, Page, Browser, Locator)
that are useless to print — they're programmatic references, not display
data. The user does NOT want a hint message either — just silently skip.

Rule: if auto-returned value is a ChannelOwner (duck-type: `_type` +
`_guid` + `_connection`), emit nothing. The `Code executed successfully
(no output)` fallback handles the "nothing else printed" case.

User must explicitly `console.log(response)` or return specific fields
(`return response.url()`) to see data. `console.log` still works safely
via the playwright-core custom inspect handler.

## Playwright browsers install is broken locally (Apr 2026)

`pnpm exec playwright install` fails with `Command "playwright" not found`
because this repo uses `@xmorse/playwright-core` not `playwright`. The core
CLI `node playwright/packages/playwright-core/cli.js install chromium` also
fails with `TypeError: onExit is not a function`.

Workaround for `pnpm test` (which needs `chromium-1209`): symlink the
already-installed 1208 build to 1209. Tests launchPersistentContext and
work with the slightly older binary:

```bash
ln -sf ~/Library/Caches/ms-playwright/chromium-1208 \
       ~/Library/Caches/ms-playwright/chromium-1209
ln -sf ~/Library/Caches/ms-playwright/chromium_headless_shell-1208 \
       ~/Library/Caches/ms-playwright/chromium_headless_shell-1209
```

For standalone integration tests: pass
`executablePath: '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'`
to `chromium.launch({ headless: true, executablePath })`.

## Node util.inspect bypasses Proxy traps (Apr 2026)

Node's `util.inspect` does NOT invoke Proxy `get` traps when looking up
`Symbol.for('nodejs.util.inspect.custom')`. It reads the symbol property
directly from the proxy target object.

To expose a custom inspect handler on a proxied object, the symbol MUST be
set on the underlying target, not via the proxy's `get` trap:

```ts
// BAD — never fires
new Proxy(target, {
  get: (obj, prop) => {
    if (prop === Symbol.for('nodejs.util.inspect.custom'))
      return () => 'custom output'
    return obj[prop]
  },
})

// GOOD — works
target[Symbol.for('nodejs.util.inspect.custom')] = function () {
  return 'custom output'
}
const proxy = new Proxy(target, { get: (obj, prop) => obj[prop] })
```

Direct property access `proxy[Symbol.for('nodejs.util.inspect.custom')]`
DOES go through the proxy get trap — only `util.inspect`'s internal lookup
bypasses it.

## Popup windows auto-relocated to tabs via chrome.windows.onCreated (Apr 2026)

Implemented in extension 0.0.80 / playwriter 0.0.104. The extension listens
for `chrome.windows.onCreated` where `type === 'popup'`, moves the tab(s)
into the main normal window with `chrome.tabs.move`, and closes the empty
popup window. No `"windows"` permission needed — `chrome.windows` API is
always available to extensions.

After relocating, the tab is NOT debugger-attached automatically — chrome's
CDP auto-attach only works for *child targets* at the CDP protocol layer,
not through the `chrome.debugger` Chrome extension API. So the extension
must explicitly call `connectTab(tabId)` on the relocated tab for it to
appear in `context.pages()` via Playwright.

Heuristic for deciding whether to auto-attach the relocated tab: use
`store.getState().tabs.size > 0` (any tab already connected) rather than
checking the popup's `openerTabId`. Chrome sets `openerTabId=null` on
popup-window tabs opened via `window.open(url, '', 'popup=1,width=...')`
(verified on Chromium 145). The "anyTabConnected" heuristic is robust
because popups opened while the user has Playwriter active on any tab
should become controllable.

Listener lives at `extension/src/background.ts` next to the other
`chrome.tabs.*` / `chrome.windows.*` listeners near the bottom of the file.
Test coverage: `playwriter/src/popup-relocation.test.ts` uses a local
HTTP server with a button that calls `window.open(..., 'popup=1')`, then
asserts the new page appears in `context.pages()` and no popup-type window
remains via `chrome.windows.getAll`.

## Better alternative to openerTabId: chrome.webNavigation.onCreatedNavigationTarget

When you need to reliably know which tab opened a new tab/window in a Chrome
extension, DO NOT rely on `chrome.tabs.Tab.openerTabId` — it is often `null`
for popup windows created via `window.open(url, '', 'popup=1,width=...')`
(Chromium 145 verified). Instead use
`chrome.webNavigation.onCreatedNavigationTarget` which fires with a
`{ sourceTabId, tabId, sourceFrameId, url, timeStamp }` details object and
reliably provides the source tab ID for every window.open/target=_blank
navigation. This also lets you decide WHICH main window to relocate a popup
into (the source tab's window, not an arbitrary "first normal" window).

## Warning delivery timing in PlaywrightExecutor is fragile

`enqueueWarning` + `flushWarningsForScope` at `playwriter/src/executor.ts:375-405`
only emit warnings whose `id > scope.cursor` at the moment `flushWarningsForScope`
runs. If a `page.on('popup')` (or other async) listener enqueues a warning
AFTER the execute() call's flush has already run, the warning is delivered
but attributed to the NEXT execute() call's scope. If `execute()` is never
called again, the warning is silently lost.

For popup detection: enqueue synchronously inside the `page.on('popup')`
listener so the warning lands BEFORE the current execute() call's flush.
If you need info that only becomes available async (like the final URL
after navigation), accept that the synchronous warning will have stale data
(url: about:blank) and tell the agent to inspect context.pages() for final
state.

## Oracle review findings for popup relocation (Apr 2026)

Critical bug in first implementation: gated `connectTab()` on
`anyTabConnected` but forgot to gate `tabs.move()` / `windows.remove()`,
meaning the extension changed Chrome popup behavior globally even when
Playwriter was idle. Always gate the WHOLE relocation side effect, not just
the auto-attach step.

`anyTabConnected` is too broad a heuristic: privacy/context leak if user
has playwriter on tab A for site X, then switches to tab B for site Y and
B opens a popup — the popup would get auto-attached and exposed to the
agent. Correct fix: use webNavigation.onCreatedNavigationTarget to map
popup → source tab, then only relocate+attach if the source tab is in
`store.tabs`.

`connectTab` is not tab-close-safe: if the popup closes while async attach
is in flight, the error catch block can write a `{state: 'error'}` entry
for a tabId that onTabRemoved already deleted, leaking dead tabs into
store.tabs/badge/group sync. Fix: check `chrome.tabs.get(tabId)` fails
before writing error state.

Focus policy for relocated popups: do NOT call `chrome.tabs.update(tabId,
{active: true})` or `chrome.windows.update(windowId, {focused: true})`
after moving the popup tab. Stealing focus from the user's current tab is
disruptive. Let the user switch tabs themselves when they notice the new
tab appearing next to its opener. The tab is already added at `index: -1`
(end of tab strip) where the user can see it.

## Playwright ChannelOwner leaks process.env via util.inspect (issue #82)

Playwright's `ChannelOwner._connection._platform.env` is set to `process.env`
on node. At depth 4, `util.inspect(response)` traverses:

```
Response → _connection → _platform → env: { ALL_ENV_VARS }
```

This dumps every environment variable (API keys, tokens, passwords).
Happened whenever a user auto-returned a Playwright object from the CLI,
e.g. `playwriter -s 1 -e 'await page.goto(url)'`.

Fix: custom `[Symbol.for('nodejs.util.inspect.custom')]` on ChannelOwner
prototype + on the channel proxy target. See
`playwright/packages/playwright-core/src/client/channelOwner.ts`.
