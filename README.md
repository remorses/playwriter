<div align='center'>
    <br/>
    <br/>
    <h3>playwriter</h3>
    <p>Still in development: Like Playwright MCP but via extension. 90% less context window. 10x more capable (full playwright API)</p>
    <br/>
    <br/>
</div>

## Installation

1. **Install the Chrome Extension**

   Install the [Playwriter MCP Extension](https://github.com/remorses/playwriter) from the Chrome Web Store (or load it unpacked during development). Pin the extension to your Chrome toolbar for easy access.

2. **Connect to a Tab**

   Click the Playwriter MCP extension icon on any tab you want to control. The icon will turn green when successfully connected.

   **Icon states:**
   - **Gray:** Not connected
   - **Green:** Connected and ready
   - **Orange badge (...):** Connecting
   - **Red badge (!):** Error

3. **Add MCP to Your Agent**

   Add the following configuration to your MCP client settings (e.g., Claude Desktop's `claude_desktop_config.json`):

   ```json
   {
     "mcpServers": {
       "playwriter": {
         "command": "npx",
         "args": [
           "playwriter@latest"
         ]
       }
     }
   }
   ```

   Restart your MCP client and you're ready to go! Your AI assistant can now control the browser through the extension.

## Usage

### Using the MCP

**Important:** Before using the MCP, you must enable the extension on at least one tab:

1. Pin the Playwriter extension to your Chrome toolbar (click the puzzle icon)
2. Navigate to a tab you want to control
3. Click the extension icon - it will turn green when connected

Once enabled on one or more tabs, your AI assistant can:
- Control all enabled tabs through the `execute` tool
- Switch between tabs using playwright's context and page APIs
- Create new tabs programmatically
- Run any Playwright code against your browser tabs

The MCP will automatically start a relay server and connect to your enabled browser tabs.

### Using with Playwright

You can use playwriter programmatically with playwright-core:

```typescript
import { chromium } from 'playwright-core'
import { startPlayWriterCDPRelayServer, getCdpUrl } from 'playwriter'


const server = await startPlayWriterCDPRelayServer()


const browser = await chromium.connectOverCDP(getCdpUrl())

const context = browser.contexts()[0]
const page = context.pages()[0]

await page.goto('https://example.com')
await page.screenshot({ path: 'screenshot.png' })

await browser.close()
server.close()
```

## Comparison

### vs Playwright MCP

Playwriter uses a Chrome extension instead of launching a full new Chrome window. This approach has several benefits:

- **Collaborate with your agent** - Work alongside the AI in the same browser, helping it when stuck on captchas or complex interactions
- **Start on existing pages** - Launch the MCP on a page in your existing browser to replicate bugs exactly as they occur
- **Reuse your extensions** - Keep using ad blockers, password managers, and other extensions you already have installed
- **Bypass automation detection** - Disable CDP/automation temporarily by disconnecting the extension to bypass detection systems like Google login, then reconnect to continue automation. With Playwright's headless Chrome, automation is always detected and blocks your workflow
- **Less resource usage** - No need to spawn a separate Chrome instance, saving memory and CPU
- **Single browser workflow** - Everything happens in your main Chrome browser, no switching between windows

### vs BrowserMCP

Playwriter has access to the full playwright API available, it can send any CDP command via the playwright methods. It only uses 1 tool `execute` to send playwright code snippets. This means that the LLM can reuse its knowledge about playwright and less context window is used to expose browser automations tools.

Playwriter is also more capable because it exposes the full playwright API instead of only a few tools.

For comparison here are the tools supported by BrowserMCP:

Navigation:

- `browsermcp_browser_navigate` - Navigate to a URL
- `browsermcp_browser_go_back` - Go back to the previous page
- `browsermcp_browser_go_forward` - Go forward to the next page
  Page Inspection:
- `browsermcp_browser_snapshot` - Capture accessibility snapshot of the current page (use this to get references to elements)
- `browsermcp_browser_screenshot` - Take a screenshot of the current page
- `browsermcp_browser_get_console_logs` - Get console logs from the browser
  Interactions:
- `browsermcp_browser_click` - Click on an element (requires element reference from snapshot)
- `browsermcp_browser_hover` - Hover over an element
- `browsermcp_browser_type` - Type text into an editable element (with optional submit)
- `browsermcp_browser_select_option` - Select an option in a dropdown
- `browsermcp_browser_press_key` - Press a key on the keyboard
  Utilities:
- `browsermcp_browser_wait` - Wait for a specified time in seconds

## Security

Playwriter is designed with security in mind, ensuring that only you can control your browser.

### How It Works

1. **Local WebSocket Server**: When the MCP starts, it launches a singleton WebSocket server on `localhost:19988`
2. **Dual Connection**: Both the Chrome extension and MCP client connect to this local server
3. **User-Controlled Access**: The extension can only control tabs where you explicitly clicked the extension icon (green icon indicates connected tabs)
4. **Localhost-Only**: The WebSocket server does not send CORS headers, preventing any web pages or remote servers from connecting to it - only processes running on your local machine can establish a connection
5. **Explicit Consent**: Chrome displays an "automation banner" on controlled tabs, making it obvious when a tab is being automated

### What Can Be Controlled

- **Only enabled tabs**: Tabs you explicitly connected by clicking the extension icon
- **New tabs created by automation**: Tabs created programmatically through Playwright commands
- **Nothing else**: Other browser tabs, your browsing history, or any tabs you haven't explicitly connected remain inaccessible

### What Cannot Happen

- **No remote access**: External websites or servers cannot connect to the WebSocket (localhost-only)
- **No passive monitoring**: The extension cannot read or monitor tabs you haven't connected
- **No automatic spreading**: The debugger won't automatically attach to new tabs you open manually

This architecture ensures that browser automation only happens with your explicit permission on tabs you choose.
