<div align='center'>
    <br/>
    <picture>
        <source media="(prefers-color-scheme: dark)" srcset="banner-dark.png" />
        <source media="(prefers-color-scheme: light)" srcset="banner.png" />
    <img src="banner.png" alt="Playwriter - For browser automation MCP" width="400" height="278" />
    </picture>
    <br/>
    <br/>
    <p>Let your agents control your own Chrome, via CLI or MCP. Your logins, extensions, cookies — already there.</p>
    <br/>
</div>

Other browser MCPs spawn a fresh Chrome — no logins, no extensions, instantly flagged by bot detectors, double the memory. Playwriter connects to **your running browser** instead. One Chrome extension, full Playwright API, everything you're already logged into.

> **Note:** Playwriter video recording is **100x more efficient than Playwright video recording**, which sends **base64 images for every frame**.

|               | Playwright MCP    | Playwriter                        |
| ------------- | ----------------- | --------------------------------- |
| Browser       | Spawns new Chrome | **Uses your Chrome**              |
| Extensions    | None              | Your existing ones                |
| Login state   | Fresh             | Already logged in                 |
| Bot detection | Always detected   | Can bypass (disconnect extension) |
| Collaboration | Separate window   | Same browser as user              |

## Installation

1. [**Install Extension**](https://chromewebstore.google.com/detail/playwriter-mcp/jfeammnjpkecdekppnclgkkffahnhfhe) from Chrome Web Store

2. Click extension icon on a tab → turns green when connected

3. Install the CLI and start automating the browser:

   ```bash
   npm i -g playwriter
   playwriter -s 1 -e "await page.goto('https://example.com')"
   ```

4. Install the skill so your agent knows how to use Playwriter:
   ```bash
   npx -y skills add remorses/playwriter
   ```

## Quick Start

```bash
playwriter session new  # creates stateful sandbox, outputs session id (e.g. 1)
playwriter -s 1 -e "await page.goto('https://example.com')"
playwriter -s 1 -e "console.log(await snapshot({ page }))"
playwriter -s 1 -e "await page.locator('aria-ref=e5').click()"
```

## CLI Usage

Each session has **isolated state**. Browser tabs are **shared** across sessions.

```bash
# Session management
playwriter session new              # creates stateful sandbox, outputs id (e.g. 1)
playwriter session list             # show sessions + state keys
playwriter session reset <id>       # fix connection issues

# Execute (always use -s)
playwriter -s 1 -e "await page.goto('https://example.com')"
playwriter -s 1 -e "await page.click('button')"
playwriter -s 1 -e "console.log(await page.title())"
```

Create your own page to avoid interference from other agents:

```bash
playwriter -s 1 -e "state.myPage = await context.newPage(); await state.myPage.goto('https://example.com')"
```

Multiline:

```bash
playwriter -s 1 -e $'
const title = await page.title();
console.log({ title, url: page.url() });
'
```

## Examples

Variables in scope: `page`, `context`, `state` (persists between calls), `require`, and Node.js globals.

**Persist data in state:**

```bash
playwriter -e "state.users = await page.$$eval('.user', els => els.map(e => e.textContent))"
playwriter -e "console.log(state.users)"
```

**Intercept network requests:**

```bash
playwriter -e "state.requests = []; page.on('response', r => { if (r.url().includes('/api/')) state.requests.push(r.url()) })"
playwriter -e "await Promise.all([page.waitForResponse(r => r.url().includes('/api/')), page.click('button')])"
playwriter -e "console.log(state.requests)"
```

**Set breakpoints and debug:**

```bash
playwriter -e "state.cdp = await getCDPSession({ page }); state.dbg = createDebugger({ cdp: state.cdp }); await state.dbg.enable()"
playwriter -e "state.scripts = await state.dbg.listScripts({ search: 'app' }); console.log(state.scripts.map(s => s.url))"
playwriter -e "await state.dbg.setBreakpoint({ file: state.scripts[0].url, line: 42 })"
```

**Live edit page code:**

```bash
playwriter -e "state.cdp = await getCDPSession({ page }); state.editor = createEditor({ cdp: state.cdp }); await state.editor.enable()"
playwriter -e "await state.editor.edit({ url: 'https://example.com/app.js', oldString: 'const DEBUG = false', newString: 'const DEBUG = true' })"
```

**Screenshot with labels:**

```bash
playwriter -e "await screenshotWithAccessibilityLabels({ page })"
```

## MCP Setup

Using the CLI with the skill (step 4 above) is the recommended approach. For direct MCP server configuration, see [MCP.md](./MCP.md).

## Visual Labels

Vimium-style labels for AI agents to identify elements:

```javascript
await screenshotWithAccessibilityLabels({ page })
// Returns screenshot + accessibility snapshot with aria-ref selectors
await page.locator('aria-ref=e5').click()
```

Color-coded: yellow=links, orange=buttons, coral=inputs, pink=checkboxes, peach=sliders, salmon=menus, amber=tabs.

## Comparison

### vs BrowserMCP

|               | BrowserMCP          | Playwriter               |
| ------------- | ------------------- | ------------------------ |
| Tools         | 12+ dedicated tools | 1 `execute` tool         |
| API           | Limited actions     | Full Playwright          |
| Context usage | High (tool schemas) | Low                      |
| LLM knowledge | Must learn tools    | Already knows Playwright |

### vs Antigravity (Jetski)

|          | Jetski                       | Playwriter       |
| -------- | ---------------------------- | ---------------- |
| Tools    | 17+ tools                    | 1 tool           |
| Subagent | Spawns for each browser task | Direct execution |
| Latency  | High (agent overhead)        | Low              |

### vs Claude Browser Extension

|                      | Claude Extension     | Playwriter              |
| -------------------- | -------------------- | ----------------------- |
| Agent support        | Claude only          | Any MCP client          |
| Windows WSL          | No                   | Yes                     |
| Context method       | Screenshots (100KB+) | A11y snapshots (5-20KB) |
| Playwright API       | No                   | Full                    |
| Debugger/breakpoints | No                   | Yes                     |
| Live code editing    | No                   | Yes                     |
| Network interception | Limited              | Full                    |
| Raw CDP access       | No                   | Yes                     |

## Architecture

```
+---------------------+     +-------------------+     +-----------------+
|   BROWSER           |     |   LOCALHOST       |     |   MCP CLIENT    |
|                     |     |                   |     |                 |
|  +---------------+  |     | WebSocket Server  |     |  +-----------+  |
|  |   Extension   |<--------->  :19988         |     |  | AI Agent  |  |
|  +-------+-------+  | WS  |                   |     |  +-----------+  |
|          |          |     |  /extension       |     |        |        |
|    chrome.debugger  |     |       |           |     |        v        |
|          v          |     |       v           |     |  +-----------+  |
|  +---------------+  |     |  /cdp/:id <--------------> |  execute  |  |
|  | Tab 1 (green) |  |     +-------------------+  WS |  +-----------+  |
|  | Tab 2 (green) |  |                               |        |        |
|  | Tab 3 (gray)  |  |     Tab 3 not controlled      |  Playwright API |
+---------------------+     (no extension click)      +-----------------+
```

## Remote Access

Control Chrome on a remote machine over the internet using [traforo](https://traforo.dev) tunnels:

**On host:**

```bash
npx -y traforo -p 19988 -t my-machine -- npx -y playwriter serve --token <secret>
```

**From remote:**

```bash
export PLAYWRITER_HOST=https://my-machine-tunnel.traforo.dev
export PLAYWRITER_TOKEN=<secret>
playwriter -s 1 -e "await page.goto('https://example.com')"
```

Also works on a LAN without traforo (`PLAYWRITER_HOST=192.168.1.10`). Full guide with use cases (remote Mac mini, user support, multi-machine control): [docs/remote-access.md](./docs/remote-access.md)

## Security

- **Local only**: WebSocket server on `localhost:19988`
- **Origin validation**: Only our extension IDs allowed (browsers can't spoof Origin)
- **Explicit consent**: Only tabs where you clicked the extension icon
- **Visible automation**: Chrome shows automation banner on controlled tabs
- **No remote access**: Malicious websites cannot connect

## Playwright API

Connect programmatically (without CLI):

```typescript
import { chromium } from 'playwright-core'
import { startPlayWriterCDPRelayServer, getCdpUrl } from 'playwriter'

const server = await startPlayWriterCDPRelayServer()
const browser = await chromium.connectOverCDP(getCdpUrl())
const page = browser.contexts()[0].pages()[0]

await page.goto('https://example.com')
await page.screenshot({ path: 'screenshot.png' })
// Don't call browser.close() - it closes the user's Chrome
server.close()
```

Or connect to a running server:

```bash
npx -y playwriter serve --host 127.0.0.1
```

```typescript
const browser = await chromium.connectOverCDP('http://127.0.0.1:19988')
```

## Troubleshooting

View relay server logs to debug issues:

```bash
playwriter logfile  # prints the log file path
# typically: ~/.playwriter/relay-server.log
```

The relay log contains extension, MCP and WebSocket server logs. A separate CDP JSONL log is also created alongside it (see `playwriter logfile`). Both are recreated on each server start.

Example: summarize CDP traffic counts by direction + method:

```bash
jq -r '.direction + "\t" + (.message.method // "response")' ~/.playwriter/cdp.jsonl | uniq -c
```

## Development Setup

To build and run Playwriter from source:

**Prerequisites:** [Node.js](https://nodejs.org/), [pnpm](https://pnpm.io/), and [bun](https://bun.sh/) installed.

```bash
# 1. Clone and bootstrap (inits git submodule, installs deps, builds playwright-core)
git clone https://github.com/remorses/playwriter.git
cd playwriter
pnpm run bootstrap

# 2. Build playwriter and the extension
pnpm run build

# 3. Link the CLI globally for local development
cd playwriter
pnpm link --global

# Verify
playwriter --help
```

For development with auto-rebuild:

```bash
pnpm run watch
```

## Support

If Playwriter is useful to you, consider [sponsoring the project](https://github.com/sponsors/remorses).

## Known Issues

- If all pages return `about:blank`, restart Chrome (Chrome bug in `chrome.debugger` API)
- Browser may switch to light mode on connect ([Playwright issue](https://github.com/microsoft/playwright/issues/37627))
