# Changelog

## 0.0.18

### Patch Changes

- **Marked project as production ready**: Removed "Still in development" notice from README

## 0.0.17

### Patch Changes

- **Improved error debugging**: Log file path now included in error messages and tool description. Log file writes to OS temp directory by default (`PLAYWRITER_LOG_PATH` env var to override)
- **Added CDP Session tests**: New test suite for direct CDP usage via `page.context().newCDPSession(page)`
  - Debugger test: pauses on `debugger` statement, captures stack trace, local variables, and evaluates expressions
  - Profiler test: profiles JavaScript execution with inline snapshot of function names
  - Performance metrics test: captures metrics like Documents, Nodes, JSHeapUsedSize
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