# Changelog

## 0.0.56

### Bug Fixes

- **Fix hung navigations on YouTube and similar sites**: Resume filtered targets (like service workers) to avoid blocking navigations. CDP `Target.setAutoAttach` with `waitForDebuggerOnStart: true` requires calling `Runtime.runIfWaitingForDebugger` even on targets we filter out, otherwise they hang forever.
- **Fix auto-enable page selection when no pages**: Properly handles the case when there are no existing pages during auto-enable

### Features

- **CDP JSONL logging**: Added structured CDP logging to a JSONL file (`/tmp/playwriter/cdp.jsonl`) for debugging. Log all CDP messages with direction, timestamp, and source info. Use `jq` to analyze.
- **Sync tab state for automated tabs**: Tab state is now properly synced for programmatically created tabs

### Improvements

- **Better logging output**: Use `util.inspect` for cleaner log output with proper object formatting
- **Set default timeout**: Added sensible default timeouts for operations

## 0.0.55

### Features

- **`playwriter skill` CLI command**: New command that prints full MCP instructions to stdout, useful for agents that need up-to-date documentation without relying on MCP resources

### Internal

- **Moved SKILL.md to src/**: Source of truth for agent instructions now lives in `src/skill.md`
- **Removed docker.package.json**: Cleaned up unused Docker configuration

## 0.0.54

### Features

- **Faster aria snapshot ref lookup**: Refs are now extracted directly from the snapshot string and fetched in parallel (20 concurrent requests), significantly reducing time to generate accessibility snapshots with labels
- **`refFilter` parameter for `getAriaSnapshot`**: New optional filter to include only specific refs by role/name, reducing unnecessary ref lookups
- **Increased default execution timeout**: Execution timeout increased from 5s to 10s for better handling of slow operations

### Bug Fixes

- **Pass cwd to executor in MCP**: File operations in executed code now use the correct working directory

## 0.0.53

### Bug Fixes

- **Fix CLI relay server startup from source**: Detect source vs compiled via `__filename.endsWith('.ts')` instead of env var, fixing `tsx` and `vite-node` execution
- **Wait for extension to reconnect**: CLI now waits up to 10 seconds for extension to reconnect after server (re)start before executing commands

### Improvements

- **Colored CLI output**: Setup messages now use colors (dim for progress, green for success, yellow for warnings)

## 0.0.52

### Features

- **First extension keeps connection**: When multiple Playwriter extensions are installed (e.g., dev and prod), the first one with active tabs now keeps the connection instead of being replaced by newer connections. Idle extensions (no tabs) can still be replaced.
- **Smarter extension slot detection**: `/extension/status` endpoint now returns `activeTargets` count, allowing extensions to know when the slot becomes available (no active tabs).
- **Accessibility snapshot format options**: `accessibilitySnapshot` now supports `format` option (`'yaml'` or `'markdown'`) with deduplication of interactive refs
- **Session management CLI commands**: New CLI commands for managing relay sessions (`playwriter sessions list`, `playwriter sessions kill`)
- **Eval CLI flag**: New `-e/--eval` CLI flag for quick code execution from command line
- **Auto-enable environment variable**: CLI now passes `PLAYWRITER_AUTO_ENABLE` when starting relay server

### Bug Fixes

- **Relay server auto-recovery**: Restored auto-recovery on every execute call
- **Preserve tabs during relay reconnects**: Tabs now persist correctly when relay reconnects
- **Show log file path on connection refused error**: Better debugging experience with log file location in errors
- **Improved error messages for extension connection states**: Clearer error messages when extension isn't connected

### Security

- **Block browser access to CLI endpoints**: Prevents browsers from accessing CLI-specific endpoints

### Internal

- **SKILL.md as source of truth**: Refactored to generate `prompt.md` from `SKILL.md`
- **Aria snapshot module**: New `aria-snapshot.ts` with dedicated accessibility snapshot functions

## 0.0.50

### Bug Fixes

- **Sharp fallback with viewport clipping**: When sharp is unavailable (optional dependency), screenshots now clip to max 1568px instead of relying on Claude's auto-resize
- **Error logging for sharp failures**: Added logging when sharp import or resize fails, making it easier to debug screenshot optimization issues

## 0.0.49

### Features

- **CORS support for relay server**: Added CORS middleware to allow extension's fetch/XHR requests during development. Only allows requests from our specific extension IDs for security.

### Bug Fixes

- **Clearer error messages**: Improved error messages when another Playwriter extension connects, making it easier to diagnose connection issues

## 0.0.48

### Bug Fixes

- **Fix SSE streaming (issue #22)**: CDP's Network domain buffers response bodies by default, which breaks SSE/streaming - data arrives at Chrome but `ReadableStream` never receives it. Now `Network.enable` defaults to `maxTotalBufferSize: 0` to disable buffering.

### Features

- **Auto-switch to another page when default page is closed**: When the current page is closed, MCP automatically switches to another available page instead of erroring
- **Optimized screenshot token usage**: Screenshots are now resized with sharp to reduce Claude token consumption
- **Reading response bodies**: Agents can re-enable Network buffering via `Network.disable` + `Network.enable` with explicit buffer sizes when they need `response.body()`

### Changes

- **Dependencies cleanup**: Removed unused deps, updated to zod v4, replaced chalk with picocolors

## 0.0.47

### Bug Fixes

- **Improved connection reliability**: Use `127.0.0.1` instead of `localhost` to avoid DNS/IPv6 resolution issues, add 15s global timeout wrapper around `connect()` to prevent hanging forever
- **Use domcontentloaded everywhere**: Changed `getCurrentPage()` and prompt guidance to use `domcontentloaded` instead of `load` for faster, more reliable page detection
- **Allow attaching to own extension pages**: Extension pages can now be debugged while still blocking other extensions

### Changes

- **Centralized target filtering**: Consolidated extension ID arrays and target filtering logic for cleaner code
- **Optional wsUrl in getCDPSessionForPage**: `wsUrl` parameter now defaults to `getCdpUrl()` if not provided

## 0.0.46

### Bug Fixes

- **Limit screenshot dimensions to 2000px**: Screenshots are now clipped to max 2000x2000 pixels to avoid Claude API rejection for many-image requests (Claude enforces 2000px limit when >20 images in a request)

## 0.0.45

### Bug Fixes

- **Filter non-page targets from Playwright (issue #14)**: Service workers, web workers, and other non-page targets are now filtered out at the server level. This prevents Playwright from trying to initialize these targets, which would cause timeouts waiting for `executionContextCreated` events and errors on `Target.detachFromTarget`.

## 0.0.44

### Features

- **Search context lines**: `accessibilitySnapshot`, `getCleanHTML`, and `getLatestLogs` now include 5 lines of context above and below each search match
  - Non-contiguous sections are separated by `---`
  - Provides better context for understanding search results

- **CDP discovery endpoints**: Added standard Chrome DevTools Protocol HTTP discovery endpoints
  - `/json/version` - Returns browser info and `webSocketDebuggerUrl`
  - `/json/list` - Returns list of debuggable targets
  - `/json` - Alias for `/json/list`
  - Supports both GET and PUT methods (Chrome 66+ compatibility)
  - Handles trailing slash variants (Playwright compatibility)
  - Allows `chromium.connectOverCDP('http://127.0.0.1:19988')` without needing to call `getCdpUrl` first

## 0.0.43

### Features

- **`getCleanHTML` utility**: New function to get cleaned HTML from a locator or page
  - Removes script, style, svg, head tags
  - Keeps only essential attributes (aria-*, data-*, href, role, title, alt, etc.)
  - Supports `search` option to filter results (returns first 10 matching lines)
  - Supports `showDiffSinceLastCall` to see changes since last snapshot
  - Supports `includeStyles` to optionally keep style/class attributes

### Changes

- **Simplified `accessibilitySnapshot` search**: Removed `contextLines` parameter, search now returns just matching lines instead of context around matches. Use `.split('\n').slice()` for pagination instead.

## 0.0.42

### Bug Fixes

- **Fix "no low surrogate in string" API error**: Sanitize accessibility snapshot text using `toWellFormed()` to remove unpaired Unicode surrogates that break JSON encoding for Claude API (requires Node.js 20+ for sanitization, gracefully degrades on older versions)

## 0.0.41

### Features

- **Arrow connectors in screenshot labels**: Visual labels now show arrow lines from label to element center, making it clearer which element each label references

### Patch Changes

- **Bigger label font**: Increased label font size from 11px to 12px for better readability
- **Fixed screenshot dimensions**: Screenshots now use actual viewport size (`innerWidth`/`innerHeight`) with `scale: 'css'` to match visual appearance

## 0.0.40

### Features

- **`screenshotWithAccessibilityLabels`**: New utility function that takes a screenshot with Vimium-style visual labels overlaid on interactive elements
  - Labels show aria-ref IDs that can be used with `page.locator('aria-ref=e5')`
  - Image and accessibility snapshot are automatically included in the response
  - Can be called multiple times to capture multiple screenshots
  - Labels are color-coded by element type
- **Media elements in aria labels**: Added `img`, `video`, `audio` to INTERACTIVE_ROLES
  - Light blue color scheme for media element labels
  - Agents can now reference images by aria-ref for visual tasks

### Patch Changes

- **Extension fix**: Query playwriter tab group by title instead of caching ID, fixing stale group issues after debugger detach/reattach

## 0.0.39

### Patch Changes

- **Fix icon not updating on WS disconnect**: `maintainLoop` now ensures tabs transition to 'connecting' state when WebSocket is not connected, fixing edge cases where `handleClose` wasn't called
- **Increased aria-labels auto-hide timeout**: Labels now auto-hide after 30 seconds instead of 5 seconds

## 0.0.38

### Patch Changes

- Internal connection handling improvements

## 0.0.36

### Features

- **Visual Aria Ref Labels**: New `showAriaRefLabels()` and `hideAriaRefLabels()` functions overlay Vimium-style labels on interactive elements
  - Labels show aria-ref IDs (e.g., "e1", "e5") that can be used with `page.locator('aria-ref=e5')`
  - Color-coded by element type: yellow=links, orange=buttons, coral=inputs, pink=checkboxes, peach=sliders, salmon=menus, amber=tabs
  - Only shows truly interactive roles (button, link, textbox, combobox, checkbox, etc.)
  - Skips elements covered by opaque overlays using `elementsFromPoint()`
  - Greedy overlap prevention skips labels that would overlap with already-placed ones
  - Auto-hides after 30 seconds to prevent stale labels (timer cancelled if called again)
  - Available in MCP execute context

### Usage

```js
const { snapshot, labelCount } = await showAriaRefLabels({ page });
await page.screenshot({ path: '/tmp/labeled-page.png' });
await page.locator('aria-ref=e5').click();
// Labels auto-hide after 30 seconds, or call hideAriaRefLabels({ page }) manually
```

## 0.0.35

### Patch Changes

- **Persistent WS connection**: Extension now connects to relay server at startup and maintains connection indefinitely, retrying every 5 seconds silently in background
- **Silent background retry**: Connecting badge only shows when user explicitly clicks to attach a tab, not during background reconnection attempts
- **Fixed tab group race condition**: All tab group operations now queue through `tabGroupQueue` to prevent race conditions between `syncTabGroup`, `disconnectEverything`, and `onTabUpdated`
- **Simplified connection states**: Renamed `'disconnected'` to `'idle'`, removed global `'connecting'` state (only individual tabs show connecting state)
- **Auto-create initial tab**: When `PLAYWRITER_AUTO_ENABLE` env var is set, automatically creates an about:blank tab when Playwright connects and no tabs exist

## 0.0.34

### Patch Changes

- **Skip server restart for newer versions**: MCP no longer kills and restarts the relay server when the server version is higher than the MCP version. This prevents older MCPs from disrupting newer server instances.
- **Ping/pong keep-alive**: Added WebSocket ping/pong mechanism to prevent Chrome extension service worker from terminating due to inactivity.

## 0.0.33

### Patch Changes

- **Fixed prompt.md not found error**: Read `prompt.md` from `src/` instead of `dist/`, fixing `ENOENT: no such file or directory` error when running the MCP

## 0.0.32

### Patch Changes

- **Build-time resource generation**: API docs (debugger-api, editor-api, styles-api) are now generated at build time via `build-resources.ts`
- **Hosted resources on playwriter.dev**: Resources now use `https://playwriter.dev/resources/*.md` URLs instead of `playwriter://` custom URIs
- **Simplified mcp.ts**: Resource handlers now read pre-built markdown files from `dist/` instead of constructing content at runtime

## 0.0.31

### Patch Changes

- **Added `styles-api` resource**: New MCP resource (`playwriter://styles-api`) with types and examples for `getStylesForLocator` CSS inspection API
- **Reduced prompt context**: Simplified prompt.md to reference resources (`playwriter://debugger-api`, `playwriter://editor-api`, `playwriter://styles-api`) instead of inline documentation

## 0.0.30

### Patch Changes

- **Wait for main frame execution context**: `Runtime.enable` now waits for the main frame's default execution context (`auxData.isDefault === true`) instead of any context. This prevents "Frame has been detached" errors when pages weren't fully ready.
- **Fix race condition when toggling extension**: When re-enabling the extension on a tab, ignore group removal events while the tab is still in 'connecting' state. Previously, `syncTabGroup` would ungroup 'connecting' tabs which triggered a disconnect during connection.

## 0.0.29

### Patch Changes

- **Fixed Editor/Debugger script listing after page load**: `listScripts()` and `list()` now work correctly even when called after page has loaded
  - `enable()` now disables first then re-enables to force CDP to emit `scriptParsed` and `styleSheetAdded` events
  - Added 100ms debounced wait for events to arrive before returning
  - `listScripts()` and `list()` are now async and auto-call `enable()`
- **Bun/bunx compatibility**: Removed known issue about bunx - the MCP now works with both `npx` and `bunx`

## 0.0.28

### Patch Changes

- **Added `getReactSource` utility**: Extract React component source location (file, line, column) from DOM elements
  - Uses bippy library for React fiber introspection
  - Returns `{ fileName, lineNumber, columnNumber, componentName }` or `null`
  - Only works on local dev servers (Vite, Next.js, CRA) with JSX transform in development mode
- **CSP bypass for script injection**: Changed `getLocatorStringForElement` and `getReactSource` to use CDP `Runtime.evaluate` instead of `addScriptTag`
  - Scripts now work on pages with strict Content Security Policy
- **Switched to Bun.build**: Replaced esbuild and esm.sh downloads with Bun.build for bundling selector-generator and bippy
  - New `build-selector-generator.ts` and `build-bippy.ts` scripts

## 0.0.27

### Patch Changes

- **Fixed gray icon on about:blank pages**: `about:blank` pages now show the black (clickable) icon instead of gray (restricted). Chrome returns `undefined` for `tab.url` on blank pages, which was incorrectly treated as restricted.
- **Auto-recovery after extension replacement**: When another extension instance takes over the connection, the replaced extension now polls `/extension/status` every 3 seconds. When the slot becomes free, it clears the error state so the user can click to reconnect.

## 0.0.26

### Patch Changes

- **Fixed CDP commands sent too soon after attach**: Added 400ms delay after debugger attach before sending CDP commands to prevent race conditions
- **Deferred page emulation setup**: Disabled early `setDeviceScaleFactorForMacOS` and `preserveSystemColorScheme` calls that could fail on newly attached pages
- **Fixed main tab cleanup on detach**: `Target.detachedFromTarget` now properly removes main tabs from state, not just child sessions

## 0.0.25

### Patch Changes

- **Wait for extension after server start**: When MCP starts the relay server, wait 3 seconds for the extension to connect before proceeding

## 0.0.24

### Patch Changes

- **Auto-restart relay server on version mismatch**: Server now exposes `/version` endpoint, MCP checks and restarts server if versions differ after package update
- **Simplified logging**: Single `relay-server.log` file instead of timestamped files with symlinks
- **Cross-platform process killing**: Use `kill-port-process` package for Windows/Mac/Linux compatibility
- **IPv4 compatibility**: Use `127.0.0.1` instead of `localhost` to avoid IPv6 resolution issues
- **Reset tabs on disconnect**: Clear connected tabs state when extension disconnects

## 0.0.23

### Patch Changes

- **Windows compatibility**: Use `os.tmpdir()` for log files instead of XDG paths, ensuring cross-platform support
- **Removed `xdg-basedir` dependency**: Simplified path handling by using Node's built-in `os.tmpdir()`

## 0.0.22

### Patch Changes

- **Green icons for connected tabs**: Extension now uses distinct green icons when tabs are connected
- **Cleaner timeout handling**: Code execution timeouts no longer suggest using reset tool

## 0.0.21

### Patch Changes

- **Improved debug message clarity**: Changed log file path hint to specify "internal playwriter errors" for better guidance

## 0.0.20

### Patch Changes

- **Timestamped log files**: Log files now include timestamps in filename (`relay-server-{timestamp}.log`) instead of overwriting a single file
- **Automatic log cleanup**: Keeps only the 10 most recent log files, deleting older ones automatically
- **Async log writes**: Logger now uses a queue for async file writes instead of blocking sync writes

## 0.0.19

### Patch Changes

- **Added `getCDPSession` utility**: New function to send raw CDP commands through the relay
  - Works with `getCDPSession({ page })` in MCP execute context
  - Returns `{ send, on, off, detach }` interface for CDP commands and events
  - Uses page index matching with URL verification for reliable target identification
- **Converted CDP tests to use relay**: All CDP Session tests now go through the relay instead of direct playwright CDP
  - Debugger, Profiler, and layout metrics tests all use `getCDPSessionForPage`
- **Added warning about `newCDPSession`**: Documented in prompt.md that `page.context().newCDPSession()` does not work through the relay

## 0.0.18

### Patch Changes

- **Marked project as production ready**: Removed "Still in development" notice from README

## 0.0.17

### Patch Changes

- **Improved error debugging**: Log file path now included in error messages and tool description. Log file writes to OS temp directory by default (`PLAYWRITER_LOG_PATH` env var to override)
- **Added CDP Session tests**: New test suite for CDP commands through the relay
  - Debugger test: pauses on `debugger` statement, captures stack trace, local variables, and evaluates expressions
  - Profiler test: profiles JavaScript execution with inline snapshot of function names
  - Layout metrics test: captures viewport dimensions via CDP
- **Refactored test setup**: Extracted `setupTestContext()` and `cleanupTestContext()` to deduplicate beforeAll/afterAll code
- **Improved `getExtensionServiceWorker`**: Now waits for extension global functions to be ready before returning
- **Better TypeScript types**: Uses `Protocol.Debugger.PausedEvent`, `Protocol.Profiler.Profile`, `Protocol.Performance.Metric` instead of `any`

## 0.0.16

### Patch Changes

- **Fixed Stagehand timeout**: Send `Target.attachedToTarget` event after `Target.attachToTarget` returns
  - Stagehand creates sessions from `attachToTarget` response, then expects `attachedToTarget` event to create Page
  - Previously events were only sent from `setAutoAttach` which arrived before sessions were created

## 0.0.15

### Patch Changes

- **Fixed logger safety**: Added optional chaining to logger calls in CDP relay to prevent errors when logger methods are undefined

## 0.0.14

### Patch Changes

- **Added Stagehand support**: CDP relay now works with Stagehand's `cdpUrl` connection option
  - Added `Target.setDiscoverTargets` handler that sends `Target.targetCreated` events for connected targets
  - Added `Target.attachToTarget` handler that returns existing sessionId for already-attached targets
  - Added Stagehand integration test verifying connection and page access
- **Viewport initialization**: Extension now sets initial viewport via `Emulation.setDeviceMetricsOverride` when attaching to tabs
  - Gets layout metrics via `Page.getLayoutMetrics`
  - Sends `Page.frameResized` event after setting viewport

## 0.0.13

### Patch Changes

- **Fixed home directory expansion on Windows**: Use `os.homedir()` instead of `process.env.HOME` for `~` path expansion in browser-config.ts, which doesn't exist on Windows.

## 0.0.12

### Patch Changes

- **Fixed Windows path resolution**: Use `fileURLToPath` for prompt.md path resolution, fixing issues on Windows where `import.meta.url` paths weren't being handled correctly.

## 0.0.11

### Patch Changes

- **Fixed `page.url()` returning empty after extension runs for a while**: The `Target.targetInfoChanged` handler was incorrectly updating the parent page's cached `targetInfo` with child target info (service workers, iframes). Now correctly looks up targets by `targetId` instead of `sessionId`.

## 0.0.10

### Patch Changes

- **Browser console log capture**: Added `getLatestLogs` function to capture and retrieve browser console logs
  - Automatically captures up to 5000 logs per page
  - Logs cleared on page reload/navigation
  - Logs deleted when page is closed
  - Supports filtering by page, search string/regex, and count limit
- **Fixed test contamination**: Added `clearAllLogs` function to prevent log persistence across tests
- **Improved console listener setup**: Made listeners synchronous using page `_guid` for immediate log capture
- **Critical reconnection test**: Added test verifying extension reconnection after `disconnectEverything()`
  - Tests full disconnect/reconnect cycle
  - Verifies MCP client can reconnect with `resetPlaywright()`
  - Ensures pages are visible after reconnection
- **Persistent console listeners**: Console logs now persist across browser reconnections (not cleared in `resetConnection`)

## 0.0.9

### Patch Changes

- Added `tabs` permission to extension manifest to fix `chrome.tabs` access issues
- Implemented `toggleExtensionForActiveTab` global helper in extension background script
- Automated extension loading and toggling in MCP tests using `chromium.launchPersistentContext`
- Added comprehensive tests for extension lifecycle:
  - Toggling extension on new and existing pages
  - Verifying direct CDP connection to relay
  - Handling Playwright connection before extension attachment
- Fixed `getCdpUrl` utility usage in tests
- Updated tests to use unique URLs for better debugging

## 0.0.8

### Patch Changes

- Added `getLocatorStringForElement` utility to `execute` tool context
- Helper generates Playwright locator strings for element handles
- Fixed bug where timeout was not correctly passed to `waitForEvent` in `getCurrentPage`

## 0.0.7

### Patch Changes

- Increased default timeout for execute tool from 3000ms to 5000ms

## 0.0.6

### Patch Changes

- Added `resetPlaywright` functionality to reset Playwright connection
- Added `getCdpUrl` utility function for CDP endpoint access
- Support for multiple tabs in CDP relay
- Support for multiple Playwright clients
- Enhanced prompt documentation with better examples
- Improved CDP relay error handling and logging
- Added `utils.ts` with helper functions

## 0.0.5

### Patch Changes

- Added `activateTab(page)` utility function to bring browser tabs to front and focus them
- Added `Playwriter.activateTab` CDP command support in relay server
- Added `activateTab` message type to extension protocol
- Extension now handles tab activation via `chrome.tabs.update` and `chrome.windows.update`

## 0.0.4

### Patch Changes

- Added `context` field to `State` type
- Renamed `ToolState` interface to `State`
- Limit execute tool output to 1000 characters with truncation message

## 0.0.3

### Patch Changes

- Replace CommonJS `require` with ESM `import` for user-agents module

## 2025-07-24 22:15

- Changed Chrome process stdio from 'ignore' to 'inherit' to print Chrome logs
- Helps with debugging CDP connection issues

## 2025-07-24 22:00

- Simplified email validation by checking profiles directly in MCP connect tool
- Connect tool validates email against available profiles before starting Chrome
- Returns helpful message with available profiles when email doesn't match
- startPlaywriter now simply throws an error for invalid emails

## 2025-07-24 21:45

- Added test infrastructure with vitest for MCP server testing
- Created mcp-client.ts with MCP client setup using vite-node
- Added comprehensive tests for Chrome CDP connection and console log capture
- Fixed callTool signatures to match MCP SDK API
- Added proper TypeScript types for CallToolResult

## 2025-07-24 21:30

- Moved profile listing functionality into connect tool when emailProfile is not provided
- Updated parameter description with agent-appropriate phrasing ("ask your user/owner")
- Removed separate get_profiles tool for cleaner API
- Connect tool now handles both profile listing and connection in one place

## 2025-07-24 21:15

- Modified startPlaywriter to accept optional emailProfile parameter
- Removed prompts dependency and interactive profile selection
- Connect tool now accepts emailProfile parameter or returns available profiles
- Added security guidance for profile selection in MCP response
- Suggests storing selected email in AGENTS.md or CLAUDE.md to avoid repeated selection

## 2025-07-24 21:00

- Integrated Chrome launch via startPlaywriter from playwriter.ts
- Connect tool now starts Chrome with CDP port and connects via playwright.chromium.connectOverCDP
- Added proper cleanup handlers for browser and Chrome process on server shutdown
- Removed placeholder getActivePage function in favor of direct browser connection

## 2025-07-24 20:50

- Moved console object definition outside of the Function constructor template string
- Improved code readability and maintainability

## 2025-07-24 20:45

- Refactored console capture to use a custom console object instead of overriding global console
- Cleaner implementation that avoids modifying global state

## 2025-07-24 20:40

- Enhanced execute tool to capture console.log, console.info, console.warn, console.error, and console.debug output
- Console methods are temporarily overridden during code execution to collect logs
- Output now includes both console logs and return values in a formatted response

## 2025-07-24 20:35

- Added execute tool to run arbitrary JavaScript code with page and context in scope
- The tool uses the Playwright automation guide from prompt.md as its description

## 2025-07-24 20:30

- Fixed MCP server tool registration API usage to match the correct method signature (name, description, schema, handler)