# Chrome Web Store Submission Justifications

## Single Purpose Description

Connects browser tabs to local Playwright automation scripts via Chrome DevTools Protocol, allowing users to automate and control their browser for testing and development without launching a separate Chrome instance.

## Permission Justifications

### activeTab

Required to attach the Chrome debugger to the current tab when the user clicks the extension icon. Allows the extension to access only the tab that the user explicitly activates.

### debugger

Essential for core functionality. This permission allows the extension to attach Chrome DevTools Protocol (CDP) to tabs selected by the user (via clicking the extension icon). CDP access enables the extension to relay automation commands from local Playwright scripts to the browser, allowing actions like page navigation, element interaction, and JavaScript execution for testing and development purposes.

### tabs (Testing Only - Removed in Production Builds)

**Note: This permission is automatically removed during production builds and is only included in test builds.**

The tabs permission is only needed during development/testing to:

- Access the URL property of tabs for test identification (finding tabs by URL pattern)
- Query all tabs with full information for test assertions

In production, the extension functions perfectly without the tabs permission because:

- Tab event listeners (onRemoved, onActivated, onUpdated) work without it
- chrome.tabs.create() and chrome.tabs.remove() work without it
- chrome.tabs.query() for active tab works without it
- chrome.tabs.get() works without it (returns limited info which is sufficient)

The build process (vite.config.mts) automatically removes this permission when TESTING environment variable is not set.

### host_permissions (<all_urls>)

Required to attach the debugger to tabs on any domain the user chooses to automate. This permission does not allow the extension to modify page content or inject scripts - it only enables CDP debugger attachment for automation. Users need this flexibility to test and automate workflows across all websites.

## Remote Code Justification

**This extension does NOT download, load, or execute any remote code.**

All extension code (JavaScript, HTML, CSS) is fully bundled within the extension package and statically reviewed.

**WebSocket Connection (localhost only):**
The extension establishes a WebSocket connection to `ws://localhost:19988` - a local server running on the user's own machine. This connection is used exclusively for **message passing** (sending and receiving JSON data), NOT code execution.

**What the WebSocket is used for:**

- Receiving CDP (Chrome DevTools Protocol) command messages in JSON format from local Playwright scripts
- Forwarding these command messages to attached browser tabs via the `chrome.debugger` API
- Sending CDP event messages back to the local Playwright scripts

**What it is NOT used for:**

- Downloading or executing JavaScript, WebAssembly, or any other executable code
- Connecting to external/remote servers (strictly localhost only)
- Loading remote configurations that modify extension behavior

This is functionally similar to Native Messaging but uses WebSockets for cross-platform compatibility with existing Playwright tooling. The WebSocket serves as a local IPC (inter-process communication) channel, not a remote code delivery mechanism.

## Data Collection & Privacy

- No data is collected or transmitted to external servers
- All browser control happens locally through Chrome DevTools Protocol
- WebSocket connection is localhost-only (ws://localhost:19988)
- Extension operates entirely on the user's machine
- No analytics, tracking, or telemetry

## Screenshots Required

Need to provide at least one screenshot showing:

- Extension icon in toolbar (gray when disconnected, green when connected)
- Extension attached to a tab with Chrome's "debugging this browser" banner visible
- Welcome page or usage demonstration
