A Chrome extension and CLI that let your agents control **your actual browser** — with
logins, extensions, and cookies already there. No headless instance, no bot detection, no extra memory.
[Star on GitHub](https://github.com/remorses/playwriter).

<Bleed>
<PixelatedImage
  src="/screenshot@2x.png"
  alt="Playwriter controlling Chrome with accessibility labels overlay"
  width={1280}
  height={800}
/>
</Bleed>

<Caption>Your existing Chrome session. Extensions, logins, cookies — all there.</Caption>

Other browser MCPs either **spawn a fresh Chrome** or give agents a fixed set of tools. New Chrome
means no logins, no extensions, instant bot detection, and double the memory. Fixed tools mean the agent
can't profile performance, can't set breakpoints, can't intercept network requests — it can
only do what someone decided to expose.

Playwriter gives agents the **full Playwright API** through a single `execute` tool. One
tool, any Playwright code, no wrappers. Low context usage because there's no schema bloat from dozens of
tool definitions. And it runs in your existing browser, so **nothing extra gets spawned**.

## Getting started

**Four steps** and your agent is browsing.

### Install the extension

1. Install the [Chrome extension](https://chromewebstore.google.com/detail/playwriter-mcp/jfeammnjpkecdekppnclgkkffahnhfhe)
2. Click the extension icon on a tab — it turns green

### Install CLI + skill

Install the CLI, then add the skill so your agent knows the good Playwriter workflows.

```bash
npm i -g playwriter
```

Then install the **skill** — it teaches your agent how to use Playwriter: which
selectors to use, how to avoid timeouts, how to read snapshots, and all available utilities.

```bash
npx -y skills add remorses/playwriter
```

#### First commands

The extension connects your browser to a **local WebSocket relay** on
`localhost:19988`. The CLI sends Playwright code through the relay. No remote servers, no
accounts, nothing leaves your machine.

```bash
playwriter session new              # new sandbox, outputs id (e.g. 1)
playwriter -e "page.goto('https://example.com')"
playwriter -e "snapshot({ page })"
playwriter -e "page.locator('aria-ref=e5').click()"
```

<Caption>Extension icon green = connected. Gray = not attached to this tab.</Caption>

## How it works

Click the extension icon on a tab — it attaches via `chrome.debugger` and opens a
WebSocket to a local relay. Your agent (CLI, MCP, or a Playwright script) connects to the same relay.
**CDP commands flow through**; the extension forwards them to Chrome and sends responses back. No
Chrome restart, no flags, no special setup.

```diagram
┌─────────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│   BROWSER           │     │   LOCALHOST          │     │   CLIENT        │
│                     │     │                      │     │                 │
│  ┌───────────────┐  │     │ WebSocket Server     │     │  ┌───────────┐  │
│  │   Extension   │<───────┬───>  :19988          │     │  │ CLI / MCP │  │
│  └───────┬───────┘  │ WS  │                      │     │  └───────────┘  │
│          │          │     │  /extension          │     │        │        │
│    chrome.debugger  │     │       │              │     │        v        │
│          v          │     │       v              │     │  ┌────────────┐ │
│  ┌───────────────┐  │     │  /cdp/:id <───────────────>│  │ execute    │ │
│  │ Tab 1 (green) │  │     └──────────────────────┘  WS │  └────────────┘ │
│  │ Tab 2 (green) │  │                                  │        │        │
│  │ Tab 3 (gray)  │  │     Tab 3 not controlled         │ Playwright API  │
└─────────────────────┘     (extension not clicked)      └─────────────────┘
```

The relay **multiplexes sessions**, so multiple agents or CLI instances can work with the same
browser at the same time.

## Collaboration

Because the agent works in **your browser**, you can collaborate. You see everything it does in
real time. When it hits a captcha, **you solve it**. When a consent wall appears, you click
through it. When the agent gets stuck, you disable the extension on that tab, fix things manually, re-enable
it, and the agent picks up where it left off.

You're not watching a remote screen or reading logs after the fact. You're
**sharing a browser** — the agent does the repetitive work, you step in when it needs
a human.

## Accessibility snapshots

Your agent needs to **see the page** before it can act. Accessibility snapshots return every
interactive element as text, with Playwright locators attached.
**5–20KB instead of 100KB+** for a screenshot — cheaper, faster, and the
agent can parse them without vision.

```bash
playwriter -e "snapshot({ page })"

# Output:
# - banner:
#     - link "Home" [id="nav-home"]
#     - navigation:
#         - link "Docs" [data-testid="docs-link"]
#         - link "Blog" role=link[name="Blog"]
```

### Search and diff

Each line ends with a **locator** you can pass directly to `page.locator()`.
Subsequent calls return a **diff**, so you only see what changed. Use `search` to
filter large pages.

```bash
# Search for specific elements
playwriter -e "snapshot({ page, search: /button|submit/i })"

# Always print URL first, then snapshot — pages can redirect
playwriter -e "console.log('URL:', page.url()); snapshot({ page }).then(console.log)"
```

Use snapshots as the **primary way to read pages**. Only reach for screenshots when spatial
layout matters — grids, dashboards, maps.

## Visual labels

When the agent needs to understand **where things are on screen**,
`screenshotWithAccessibilityLabels` overlays **Vimium-style labels** on every
interactive element. The agent sees the screenshot, reads the labels, and clicks by reference.

```bash
playwriter -e "screenshotWithAccessibilityLabels({ page })"
# Returns screenshot + accessibility snapshot with aria-ref selectors

playwriter -e "page.locator('aria-ref=e5').click()"
```

Labels are **color-coded by element type**: yellow for links, orange for buttons, coral for
inputs, pink for checkboxes, peach for sliders, salmon for menus, amber for tabs. The ref system is shared
with `snapshot()`, so you can switch between text and visual modes freely.

<Caption>Vimium-style labels. Screenshot + snapshot in one call.</Caption>

## Sessions

### Isolated state

Run **multiple agents at once** without them stepping on each other. Each session is an
isolated sandbox with its own `state` object. Variables, pages, and listeners persist between
calls. Browser tabs are shared, but state is not.

```bash
playwriter session new    # => 1
playwriter session new    # => 2
playwriter session list   # shows sessions + state keys

# Session 1 stores data
playwriter -s 1 -e "state.users = page.$$eval('.user', els => els.map(e => e.textContent))"

# Session 2 can't see it
playwriter -s 2 -e "console.log(state.users)"  # undefined
```

### Dedicated pages

Create your own page to **avoid interference** from other agents. Reuse an existing
`about:blank` tab or create a fresh one, and store it in `state`.

```bash
playwriter -s 1 -e "state.myPage = context.pages().find(p => p.url() === 'about:blank') ?? context.newPage(); state.myPage.goto('https://example.com')"

# All subsequent calls use state.myPage
playwriter -s 1 -e "state.myPage.title()"
```

## Debugger & editor

Things no other browser MCP can do. **Set breakpoints**, step through code, inspect variables at
runtime. **Live-edit page scripts and CSS** without reloading. Full Chrome DevTools Protocol
access, not a watered-down subset.

```bash
# Set breakpoints and debug
playwriter -e "state.cdp = getCDPSession({ page }); state.dbg = createDebugger({ cdp: state.cdp }); state.dbg.enable()"
playwriter -e "state.scripts = state.dbg.listScripts({ search: 'app' }); state.scripts.map(s => s.url)"
playwriter -e "state.dbg.setBreakpoint({ file: state.scripts[0].url, line: 42 })"

# Live edit page code
playwriter -e "state.editor = createEditor({ cdp: state.cdp }); state.editor.enable()"
playwriter -e "state.editor.edit({ url: 'https://example.com/app.js', oldString: 'const DEBUG = false', newString: 'const DEBUG = true' })"
```

Edits are **in-memory** and persist until the page reloads. Useful for toggling debug flags,
patching broken code, or testing quick fixes without touching source files. The editor also supports
`grep` across all loaded scripts.

<Caption>Breakpoints, stepping, variable inspection — from the CLI.</Caption>

## Network interception

Let the agent **watch network traffic** to reverse-engineer APIs, scrape data behind JavaScript
rendering, or debug failing requests. Captured data lives in `state` and persists across calls.

```bash
# Start intercepting
playwriter -e "state.responses = []; page.on('response', async res => { if (res.url().includes('/api/')) { try { state.responses.push({ url: res.url(), status: res.status(), body: await res.json() }); } catch {} } })"

# Trigger actions, then analyze
playwriter -e "page.click('button.load-more')"
playwriter -e "console.log('Captured', state.responses.length, 'API calls'); state.responses.forEach(r => console.log(r.status, r.url.slice(0, 80)))"

# Replay an API call directly
playwriter -e "page.evaluate(async (url) => { const res = await fetch(url); return res.json(); }, state.responses[0].url)"
```

**Faster than scraping the DOM.** The agent captures the real API calls, inspects their schemas,
and replays them with different parameters. Works for pagination, authenticated endpoints, and anything behind
client-side rendering.

## Screen recording

Have the agent **record what it's doing** as MP4 video. The recording uses
`chrome.tabCapture` and runs in the extension context, so it
**survives page navigation**.

```bash
# Start recording
playwriter -e "startRecording({ page, outputPath: './recording.mp4', frameRate: 30 })"

# Navigate, interact — recording continues
playwriter -e "page.click('a'); page.waitForLoadState('domcontentloaded')"
playwriter -e "page.goBack()"

# Stop and save
playwriter -e "stopRecording({ page })"
```

Unlike `getDisplayMedia`, this approach
**persists across navigations** because the extension holds the `MediaRecorder`, not
the page. You can also check recording status with `isRecording` or cancel without saving with
`cancelRecording`.

<Caption>Native tab capture. 30–60fps. Survives navigation.</Caption>

## Comparison

Why use this over the alternatives.

<ComparisonTable
  title="vs Playwright MCP"
  headers={['', 'Playwright MCP', 'Playwriter']}
  rows={[
    ['Browser', 'Spawns new Chrome', 'Uses your Chrome'],
    ['Extensions', 'None', 'Your existing ones'],
    ['Login state', 'Fresh', 'Already logged in'],
    ['Bot detection', 'Always detected', 'Can bypass'],
    ['Collaboration', 'Separate window', 'Same browser as user']
  ]}
/>

<ComparisonTable
  title="vs Playwright CLI"
  headers={['', 'Playwright CLI', 'Playwriter']}
  rows={[
    ['Browser', 'Spawns new browser', 'Uses your Chrome'],
    ['Login state', 'Fresh', 'Already logged in'],
    ['Extensions', 'None', 'Your existing ones'],
    ['Captchas', 'Always blocked', 'Bypass (disconnect extension)'],
    ['Collaboration', 'Separate window', 'Same browser as user'],
    ['Capabilities', 'Limited command set', 'Anything Playwright can do'],
    ['Raw CDP access', 'No', 'Yes'],
    ['Video recording', 'File-based tracing', 'Native tab capture (30–60fps)']
  ]}
/>

<ComparisonTable
  title="vs BrowserMCP"
  headers={['', 'BrowserMCP', 'Playwriter']}
  rows={[
    ['Tools', '12+ dedicated tools', '1 execute tool'],
    ['API', 'Limited actions', 'Full Playwright'],
    ['Context usage', 'High (tool schemas)', 'Low'],
    ['LLM knowledge', 'Must learn tools', 'Already knows Playwright']
  ]}
/>

<ComparisonTable
  title="vs Claude Browser Extension"
  headers={['', 'Claude Extension', 'Playwriter']}
  rows={[
    ['Agent support', 'Claude only', 'Any MCP client'],
    ['Windows WSL', 'No', 'Yes'],
    ['Context method', 'Screenshots (100KB+)', 'A11y snapshots (5–20KB)'],
    ['Playwright API', 'No', 'Full'],
    ['Debugger', 'No', 'Yes'],
    ['Live code editing', 'No', 'Yes'],
    ['Network interception', 'Limited', 'Full'],
    ['Raw CDP access', 'No', 'Yes']
  ]}
/>

## Remote access

### Tunnel

Control Chrome on a **remote machine** — a headless Mac mini, a cloud VM, a
devcontainer. A [traforo](https://traforo.dev) tunnel exposes the relay through Cloudflare.
**No VPN, no firewall rules, no port forwarding.**

```bash
# On the host machine — start relay with tunnel
npx -y traforo -p 19988 -t my-machine -- npx -y playwriter serve --token <secret>

# From anywhere — set env vars and use normally
export PLAYWRITER_HOST=https://my-machine-tunnel.traforo.dev
export PLAYWRITER_TOKEN=<secret>
playwriter -e "page.goto('https://example.com')"
```

### LAN

Also works on a **LAN without tunnels** — just set
`PLAYWRITER_HOST=192.168.1.10`. Works for MCP too — set `PLAYWRITER_HOST` and
`PLAYWRITER_TOKEN` in your MCP client env config. Use cases: headless Mac mini, remote user
support, multi-machine automation, dev from a VM or devcontainer.

## Security

Everything runs **on your machine**. The relay binds to `localhost:19988` and only
accepts connections from the extension. No remote server, no account, no telemetry.

- **Local only** — WebSocket server binds to localhost. Nothing leaves your machine.
- **Origin validation** — only the Playwriter extension origin is accepted. Browsers cannot spoof the Origin header, so malicious websites cannot connect.
- **Explicit consent** — only tabs where you clicked the extension icon are controlled. No background access.
- **Visible automation** — Chrome shows an automation banner on controlled tabs.
