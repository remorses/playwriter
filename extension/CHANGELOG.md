# Changelog

## 0.0.97

### Changes

- **10s timeout for CDP init commands** — frozen or hibernated tabs (common in Ghost Browser and other Chromium forks) no longer block the entire Playwright connection setup. Init commands like `Page.enable`, `Runtime.enable`, and `Network.enable` time out individually after 10 seconds instead of hanging for 30 seconds each.
- **Multi-profile relay routing** — extension connections are now identified by a per-profile install id before falling back to Google account identity. Two Chrome profiles signed into the same account no longer replace each other's relay connection. New tabs are created in the window where the extension was activated.
- **Better browser name detection** — `playwriter session new` shows more specific browser names using full user-agent client hints.

## 0.0.93

### Changes

- **New "Copy React Component Source Path" right-click menu item**. When you right-click an element on a React page, this copies the source file path (e.g. `src/components/Button.tsx:42`) to your clipboard. Uses bippy to walk the React fiber tree and resolve source locations. Flashes green on success, red if the element isn't part of a React app or no source maps are available.

## 0.0.92

### Changes

- **Pinned element copy is command-only**. Toolbar pins and the right-click context menu now copy only `playwriter -e 'inspectPinnedElement(...)'`, without the natural-language prefix, so pasted clipboard text is shorter and shell-ready.

## 0.0.91

### Changes

- **Pinned element copy now includes React inspection**. Toolbar pins and the right-click context menu now copy a tiny `inspectPinnedElement(url, expression)` command that prints the pinned element `outerHTML` plus React component info when the installed Playwriter CLI supports it. Non-React elements still inspect cleanly with `react: null`.

## 0.0.90

### Changes

- **Fixed pinned element outerHTML snippet** using unnecessary dynamic `evaluate` parameter. The pin number is already known at string-build time, so it's now inlined directly instead of passing it as a runtime argument.

## 0.0.89

### Changes

- **"Copied" toast now appears near the pinned element** instead of bottom-center of the viewport. Positioned like a tooltip just below the selection rectangle, horizontally centered on the element. Flips above if near the viewport bottom. Falls back to bottom-center when no anchor rect is provided.

## 0.0.88

### Changes

- **Debounced idle hide for the ghost cursor**. The cursor now fades out after 5 seconds of no Playwright-driven mouse activity so it doesn't bother the user during manual browsing sessions. Any new action (move, click, wheel) wakes it back up by teleporting to the new target position and fading back in with the snappy 140ms press duration. The fade-out uses a gentler 600ms curve so it "dims away" rather than blinking off. All state is browser-side inside `ghost-cursor-client.ts` — no Node-side timers, no extra CDP round-trips. Constants `IDLE_HIDE_DELAY_MS = 5000` and `IDLE_FADE_OUT_MS = 600` live at the top of the file for easy tuning.

## 0.0.87

### Changes

- **Ghost cursor animation polish** (Emil Kowalski design-engineering principles applied). Four changes, all in `playwriter/src/ghost-cursor-client.ts`:
  1. Move easing switched from strong ease-out `cubic-bezier(0.16, 1, 0.3, 1)` to easeInOutCubic `cubic-bezier(0.65, 0, 0.35, 1)`. The cursor now accelerates smoothly out of its rest position and decelerates into the target instead of starting at full speed — feels like a hand gliding, not a lurch. Emil's rule: "on-screen movement → ease-in-out".
  2. Press feedback has a dedicated fast duration (140ms) and strong ease-out curve (`cubic-bezier(0.23, 1, 0.32, 1)`), independent of the move transition's 220-1500ms range. Previously the scale-down animation on click inherited the move duration — a click during a long diagonal sweep would scale down over 1500ms, which looked broken.
  3. Press scale subtlety: dropped from 0.82 (dot) / 0.93 (minimal) / 0.94 (screenstudio) to 0.92 / 0.95 / 0.95. Follows Emil's "subtle (0.95-0.98)" button press guideline. The old 0.82 dot press looked like the cursor was disappearing.
  4. `transform-origin` anchored to the cursor hotspot (arrow tip / pointer anchor). Default center origin was causing a ~0.7px tip shift on every press scale change — subtle but visible to attentive eyes. Now the tip stays pinned while the cursor "pulses" around it.
- **Split CSS transitions for transform vs opacity**: opacity changes (press feedback dimming) always use the fast 140ms press duration, so they never inherit the move transition's long duration. Cursor fades and press pulses stay crisp even during long sweeps.

## 0.0.86

### Changes

- **Always-on ghost cursor**. The ghost cursor overlay is now injected into every Playwriter-attached tab the moment the debugger attaches, via `Page.addScriptToEvaluateOnNewDocument` + `Runtime.evaluate` in MAIN world. The bundle is the same `ghost-cursor-client.js` artifact used by `page.evaluate`-based callers, inlined into `background.js` at build time with vite's `?raw` loader so there is a single source of truth. The cursor auto-enables in the top frame (iframes early-return) and stays on the last spot that Playwright clicked or moved to. Recording no longer toggles it on and off — the cursor is always visible. `ghostCursor.show/hide` is still available for changing the style or hiding the overlay on demand.
- **Cursor torn down on tab detach**. `detachTab` now calls `__playwriterGhostCursor?.disable()` via `chrome.scripting.executeScript`, mirroring the existing toolbar-destroy pattern, so tabs that leave Playwriter control don't retain a stale cursor overlay.

## 0.0.85

### Changes

- **Clipboard is now a natural-language prompt wrapping the `playwriter -e` command**. Pin-click copies `` see the element I pinned in the playwriter tab `playwriter -e '<code>'` `` instead of just the raw JS snippet. The agent reads this as a prompt, adds its own `-s <session>` (or relies on `PLAYWRITER_SESSION`), and runs it. Makes the intent obvious when the user pastes the clipboard into a chat message — the agent sees the goal plus the exact code it should run.
- **Bash-safe single-quote wrapping**: `buildInspectionCode` now replaces every literal `'` in the JSON-stringified URL and element summary with `\u0027` (a valid JSON escape that the JS engine parses back to `'`). Previously, element text containing a single quote (e.g. "Don't save", an apostrophe in an `aria-label`) leaked into the code and broke the outer bash `'…'` wrapper. The generated code is now guaranteed to be single-quote-free regardless of page content.

## 0.0.84

### Changes

- **Drop session-id plumbing from the pin-click clipboard**. The toolbar now copies only the raw JS eval code (the two `;`-separated statements that pick the page by URL and log the pre-baked summary + live `outerHTML`). The agent wraps it in their own `playwriter -s <session> -e '<paste>'` call, using whichever session they already have or creating a new one. Removes `fetchSessionSummary`, `ToolbarConfig`, `__playwriterUpdateSessions`, `pickSessionId`, and `shellSingleQuote` — along with all the per-inject relay fetches. Toolbar state shrinks back to just `pinModeActive`/`pinCount`/`toastTimer`/`overlayEl`.

## 0.0.83

### Changes

- **Toolbar pin-click now copies a full `playwriter -s <id> -e '…'` command** instead of a plain `globalThis.playwriterPinnedElemN` reference. When the agent pastes the command, it prints the pinned element's URL, metadata (tag, id, class, role, aria-label, href, type, text, bounding rect, visibility), and the current `outerHTML` of the element — all in one shot. The generated JS is deliberately tiny: two `;`-separated statements that pick the right page by URL, assign `state.page`, and `console.log` a pre-baked summary plus a live `page.evaluate(n => globalThis["playwriterPinnedElem" + n]?.outerHTML)` call. No Playwright sandbox helpers (`getCleanHTML`, `getLocatorStringForElement`) required, so the command always runs regardless of playwriter version.
- **Element metadata pre-baked at pin time**: the toolbar runs synchronously in MAIN world and already has full DOM access, so it captures tag/id/class/role/aria/text/rect at click time and bakes the result as a string literal in the clipboard command via `JSON.stringify`. Eval time only fetches the current `outerHTML` — everything else is instant.
- **`ToolbarConfig` passed at inject time**: the service worker now fetches `/extension/sessions` from the relay (new public endpoint) right before injecting the toolbar, and passes the result as `chrome.scripting.executeScript({ args })`. The toolbar caches the session list in a closure so pin-click builds the command without any runtime network calls. The session id is picked as `firstExistingId ?? nextSuggested ?? '1'`, keeping the agent in their current session when one exists.
- **Toolbar tolerates a missing or old relay**: `fetchSessionSummary` returns a safe `{ sessions: [], nextSuggested: '1' }` fallback on fetch error, timeout, non-OK response, or malformed JSON. The extension stays backward-compatible with older relays that don't know about `/extension/sessions`.
- **Re-inject on navigation refreshes cached sessions**: `webNavigation.onDOMContentLoaded` re-injection also re-fetches sessions and routes them through `window.__playwriterUpdateSessions`, so the guarded re-init path picks up new session ids without tearing down and rebuilding the toolbar DOM.

## 0.0.82

### New Features

- **In-page floating toolbar**: A compact dark pill toolbar is now injected into the top-right corner of every tab that has Playwriter attached. The toolbar uses a closed Shadow DOM so it is completely isolated from page styles. It is removed automatically when the tab disconnects.
- **Pin element mode**: The clipboard icon button in the toolbar toggles a "pin element" mode. While active, hovering over any element shows a blue highlight overlay. Clicking the element assigns it to `globalThis.playwriterPinnedElemN` and copies the reference string to the clipboard — the same format as the right-click context menu. Press `Esc` to exit pin mode. The `×` button hides the toolbar for the session.
- **Shared pin counter**: Both the toolbar and the right-click context menu now use `window.__playwriterPinCount` (a MAIN-world counter) to allocate element names, so the two flows never produce conflicting `playwriterPinnedElemN` indices.
- **Toolbar re-injection on navigation**: The toolbar is automatically re-injected after hard page navigations in connected tabs via `chrome.webNavigation.onDOMContentLoaded`. SPA route changes are handled transparently because the toolbar DOM persists across pushState navigations.

## 0.0.81

### Bug Fixes

- **Stop cross-browser relay takeovers when Chrome identity is unavailable**: The extension now persists a per-install `installId` in `chrome.storage.local` and sends it to the relay. When Chromium/Vivaldi/other unsigned profiles report empty `chrome.identity` info, the relay uses `install:<browser>:<installId>` instead of the coarse `browser:<name>` fallback, so two idle Chromium-family browsers no longer replace each other's WebSocket connection.
- **Do not reclaim a merely idle replacement connection**: after a `4001 Extension Replaced` disconnect, the service worker now waits for `/extension/status` to report `connected: false` before reconnecting. This avoids the handoff race where a fresh replacement temporarily reports `activeTargets: 0`, causing the old worker to steal the slot back and drop the live tab.
- **Add `storage` permission**: required to persist the per-install relay identity above.

## 0.0.80

### Changes

- **Auto-relocate popup windows into the source tab's main window as tabs**: The extension now listens for `chrome.webNavigation.onCreatedNavigationTarget` to map every new tab to its source tab, and for `chrome.windows.onCreated` with `type === 'popup'` to relocate popups. When the popup was opened by a Playwriter-connected tab, the tab is moved into the source tab's window (at the end of the tab strip), the empty popup window is closed, and Playwriter auto-attaches so the tab appears in `context.pages()`. Focus is not stolen — the user's active tab stays active. When no Playwriter tab is connected to the source, the popup is left alone — unrelated sites keep normal Chrome popup behavior. Agents no longer need the `cmd+click` (`{ modifiers: ['Meta'] }`) workaround to control OAuth login flows.
- **New `webNavigation` permission**: required to track source-tab → new-tab correlations. `chrome.tabs.Tab.openerTabId` is unreliable for popup-window tabs (Chromium 145 leaves it null), so the extension uses `webNavigation.onCreatedNavigationTarget` instead.
- **connectTab is now tab-close-safe**: if a tab closes while `connectTab` is attaching to it, the error path no longer leaks a dead tab entry into `store.tabs`/badge/group sync state.

## 0.0.79

### Bug Fixes

- **Fix debugger crash on pages with chrome-extension:// iframes** ([#18](https://github.com/remorses/playwriter/issues/18)): Extensions like LastPass, SurfingKeys, and password managers inject `chrome-extension://` iframes into every page. Chrome's `chrome.debugger.attach` API refuses to attach to tabs containing these iframes, causing the extension to immediately disconnect after clicking the icon. Two-layer fix:
  1. Before `chrome.debugger.attach`: detect the failure, remove restricted iframes via `chrome.scripting.executeScript`, then retry attachment.
  2. After attachment: filter `Target.attachedToTarget` events for restricted child targets in `onDebuggerEvent`, preventing the relay from sending CDP commands to restricted sessions.
- **Add `scripting` permission**: Required for the iframe cleanup workaround above.

## 0.0.78

### Changes

- **Skip welcome tab in packaged automation builds**: Added a build-time flag so the extension copy bundled into the Playwriter CLI does not auto-open `welcome.html` on install. Regular dev/test extension builds still keep the welcome page.

## 0.0.77

### Changes

- **Use `workspace:^` for local Playwriter dependency**: Switched `playwriter` from `workspace:*` to `workspace:^` in `extension/package.json` to avoid pinned workspace versions when package metadata is packed.

## 0.0.76

### Bug Fixes

- **Write Prism assets to the active extension output directory**: `scripts/download-prism.ts` now respects `PLAYWRITER_EXTENSION_DIST` instead of always writing to `dist/src`. This fixes release builds (`dist-release`) missing `prism.min.js` and `prism-bash.min.js` used by `welcome.html`.

## 0.0.75

### Changes

- **Remove `alarms` permission and keepalive**: Removed `chrome.alarms` keepalive added in 0.0.73. The `maintainLoop` while-loop and `setInterval(checkMemory)` already keep the service worker alive. The alarm was a no-op that required an unnecessary permission.

## 0.0.74

### Bug Fixes

- **Fix Target.detachFromTarget routing on root CDP session**: Commands sent without a top-level sessionId (e.g. from Playwright's root browser session) now resolve the target tab via `params.sessionId` fallback. Previously the extension threw "No tab found" which caused cascading disconnects and instability. (#40)
- **No-op stale Target.detachFromTarget**: Unknown or already-cleaned-up sessions return `{}` instead of throwing, preventing error cascading during rapid connect/disconnect cycles.
- **Always re-apply tab group color**: Tab group title and color are now re-applied on every sync to prevent Chrome from resetting them to white/unlabeled.

## 0.0.73

### Bug Fixes

- **Service worker keepalive via chrome.alarms**: Added `chrome.alarms` keepalive to prevent Chrome MV3 from terminating the service worker when idle. Without this, the `maintainLoop` stops, the WebSocket closes, and the extension silently disconnects from the relay server — causing `session new` to fail with "Extension did not connect within timeout."

## 0.0.72

### Bug Fixes

- **Use runtime-scoped root CDP tab session IDs**: Root tab sessions now use `pw-tab-<scope>-<n>` instead of `pw-tab-<n>`, where scope is a random value generated once per extension runtime. This prevents session ID collisions across multiple connected Chrome profiles.

## 0.0.71

### Bug Fixes

- **Route Runtime.enable to child CDP sessions**: Runtime enable/disable now uses the incoming `sessionId` when targeting OOPIF child sessions instead of always using the tab root session. This fixes missing `Runtime.executionContextCreated` events for child iframe targets, which could cause iframe locator operations to hang.

## 0.0.69

### Features

- **First extension keeps connection**: When multiple Playwriter extensions are installed, the actively-used one (with tabs) now keeps the connection. New extensions are rejected with code 4002 instead of taking over.
- **Smarter reconnection**: Extension now polls `/extension/status` for `activeTargets` count and only attempts reconnection when the other extension has no active tabs.

### Bug Fixes

- **Proper state handling for 4002 rejection**: Fixed issue where extension would keep retrying forever when rejected during WebSocket handshake. Now correctly enters `extension-replaced` polling state.

## 0.0.68

### Bug Fixes

- **Improved connection reliability**: Use `127.0.0.1` instead of `localhost` to avoid DNS/IPv6 resolution issues
- **Global connection timeout**: Added 15-second global timeout wrapper around `connect()` to prevent hanging forever when individual timeouts fail
- **Better WebSocket handling**: Added `settled` flag to properly handle timeout/open/error/close race conditions

### Changes

- **Faster retry loop**: Reduced retry attempts from 30 to 5 since `maintainLoop` retries every 3 seconds anyway
- **Allow own extension pages**: Added `OUR_EXTENSION_IDS` to allow attaching to our own extension pages while blocking other extensions

## 0.0.67

- Initial changelog
