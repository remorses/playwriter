<div align='center'>
    <br/>
    <picture>
        <source media="(prefers-color-scheme: dark)" srcset="banner-dark.png" />
        <source media="(prefers-color-scheme: light)" srcset="banner.png" />
    <img src="banner.png" alt="Playwriter - For browser automation MCP" width="400" height="278" />
    </picture>
    <br/>
    <br/>
    <p>Like Playwright MCP but via extension. 90% less context window. 10x more capable (full playwright API)</p>
    <br/>
    <a href="https://chromewebstore.google.com/detail/playwriter-mcp/jfeammnjpkecdekppnclgkkffahnhfhe">
        <strong>Install Extension from Chrome Web Store</strong>
    </a>
    <br/>
    <br/>
</div>

## Installation

1. **Install the Chrome Extension**

   [**Install Extension**](https://chromewebstore.google.com/detail/playwriter-mcp/jfeammnjpkecdekppnclgkkffahnhfhe) - Install the [Playwriter MCP Extension](https://chromewebstore.google.com/detail/playwriter-mcp/jfeammnjpkecdekppnclgkkffahnhfhe) from the Chrome Web Store (or load it unpacked during development). Pin the extension to your Chrome toolbar for easy access.

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

**Important:** Before using the MCP, you must [install](https://chromewebstore.google.com/detail/playwriter-mcp/jfeammnjpkecdekppnclgkkffahnhfhe) and enable the extension on at least one tab:

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

### Environment Variables

#### `PLAYWRITER_AUTO_ENABLE`

When set, the MCP will automatically create an initial tab when a Playwright client connects and no tabs are currently enabled. This is useful for fully automated workflows where you don't want to manually click the extension icon.

```json
{
  "mcpServers": {
    "playwriter": {
      "command": "npx",
      "args": ["playwriter@latest"],
      "env": {
        "PLAYWRITER_AUTO_ENABLE": "1"
      }
    }
  }
}
```

With this setting, when your AI agent starts, it will immediately have a page to work with without requiring manual extension activation.

**Note:** The auto-created tab starts at `about:blank`. Your agent can then navigate it to any URL.

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

### vs Antigravity (Jetski)

Antigravity's browser integration suffers from the same fundamental problem as BrowserMCP: it creates a separate tool for every browser action instead of using the Playwright API that LLMs already understand.

**The Context Window Problem:**

Jetski exposes 17+ browser tools (`capture_browser_screenshot`, `browser_click_element`, `browser_input`, `browser_scroll`, `wait_5_seconds`, etc.). Each tool definition consumes context window space with parameter schemas, descriptions, and examples. This bloated schema forces Antigravity to spawn a **subagent every time you want to use the browser**, adding significant latency and indirection to every browser interaction.

**Playwriter's Approach:**

- **1 tool instead of 17+** - Only the `execute` tool is needed
- **No subagent spawning** - Browser operations happen directly without extra layers
- **Lower latency** - No need to spawn/teardown agents for each browser task
- **Leverages existing knowledge** - LLMs already know Playwright's API from their training data
- **More capable** - Full Playwright API access vs a limited set of predefined actions

The irony is that by trying to make browser control "simpler" with dedicated tools, these integrations make it slower, less capable, and waste context window that could be used for actual work.

## Architecture

```
+---------------------+     +-------------------+     +-----------------+
|   BROWSER           |     |   LOCALHOST       |     |   MCP CLIENT    |
|                     |     |                   |     |                 |
|  +---------------+  |     | WebSocket Server  |     |  +-----------+  |
|  |   Extension   |<--------->  :19988         |     |  | AI Agent  |  |
|  |  (bg script)  |  | WS  |                   |     |  | (Claude)  |  |
|  +-------+-------+  |     |  /extension       |     |  +-----------+  |
|          |          |     |       ^           |     |        |        |
|          | chrome   |     |       |           |     |        v        |
|          | .debug   |     |       v           |     |  +-----------+  |
|          v          |     |  /cdp/:id <--------------> |  execute  |  |
|  +---------------+  |     |                   |  WS |  |   tool    |  |
|  | Tab 1 (green) |  |     | Routes:           |     |  +-----------+  |
|  +---------------+  |     |  - CDP commands   |     |        |        |
|  +---------------+  |     |  - CDP events     |     |        v        |
|  | Tab 2 (green) |  |     |  - attach/detach  |     |  +-----------+  |
|  +---------------+  |     |    Target events  |     |  | Playwright|  |
|  +---------------+  |     +-------------------+     |  |    API    |  |
|  | Tab 3 (gray)  |  |                               |  +-----------+  |
|  +---------------+  |     Tab 3 not controlled      +-----------------+
|                     |     (user didn't click icon)
+---------------------+
```

## Remote Agents (Devcontainers, VMs, SSH)

Run agents in isolated environments (devcontainers, VMs, SSH) while controlling Chrome on your host.

**On host (where Chrome runs):**

```bash
npx playwriter serve --token <secret>
# or use environment variable:
PLAYWRITER_TOKEN=<secret> npx playwriter serve
```

**In container/VM (where agent runs):**

Using environment variables:

```bash
export PLAYWRITER_HOST="host.docker.internal"
export PLAYWRITER_TOKEN="<secret>"
```

Or using CLI options:

```bash
npx playwriter --host host.docker.internal --token <secret>
```

Use `host.docker.internal` for devcontainers, or your host's IP for VMs/SSH.

## Known Issues

- If all pages urls return `about:blank` in every MCP session restart your Chrome browser. This seems to be a Chrome bug that sometimes happen. It is some hidden state in `chrome.debugger` Extensions API. Restarting the extension worker does not fix it. 
- When connecting the MCP to a page, the browser may switch to light mode. This happens because Playwright, via CDP, automatically sends an "emulate media" command on start. If you'd like to see this behavior changed, you can upvote the related issue [here](https://github.com/microsoft/playwright/issues/37627).

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
