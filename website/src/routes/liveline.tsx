/*
 * Playwriter editorial page — content only.
 * Components imported from website/src/components/markdown.tsx.
 * Styles from liveline.css and liveline-prism.css.
 */

import type { MetaFunction } from "react-router";
import dedent from "string-dedent";
import "website/src/styles/liveline.css";
import "website/src/styles/liveline-prism.css";
import {
  EditorialPage,
  P,
  A,
  Code,
  Caption,
  CodeBlock,
  Section,
  ComparisonTable,
  List,
  OL,
  Li,
} from "website/src/components/markdown";

export const meta: MetaFunction = () => {
  const title = "Playwriter - Control your Chrome with Playwright API";
  const description =
    "Chrome extension + CLI for browser automation. Full Playwright API on your existing browser. No new windows, no flags, no context bloat.";
  const image = "https://playwriter.dev/og-image.png";
  return [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:image", content: image },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:type", content: "website" },
    { property: "og:url", content: "https://playwriter.dev/liveline" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: image },
  ];
};

const tocItems = [
  { label: "Getting started", href: "#getting-started" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Snapshots", href: "#snapshots" },
  { label: "Visual labels", href: "#visual-labels" },
  { label: "Sessions", href: "#sessions" },
  { label: "Debugger & editor", href: "#debugger-and-editor" },
  { label: "Network interception", href: "#network-interception" },
  { label: "Screen recording", href: "#screen-recording" },
  { label: "Comparison", href: "#comparison" },
  { label: "Remote access", href: "#remote-access" },
  { label: "Security", href: "#security" },
];

export default function LivelinePage() {
  return (
    <EditorialPage toc={tocItems} logo="playwriter">

      <P>
        Playwriter lets you <strong>control your Chrome browser</strong> with the full
        Playwright API. A Chrome extension, a local relay, and a CLI. No new
        browser windows, no Chrome flags, no context bloat.{" "}
        <A href="https://github.com/remorses/playwriter">Star on GitHub</A>.
      </P>

      <div className="ll-bleed" style={{ display: "flex", justifyContent: "center" }}>
        <img
          src="/screenshot@2x.png"
          alt="Playwriter controlling Chrome with accessibility labels overlay"
          style={{ display: "block", maxWidth: "100%" }}
        />
      </div>
      <Caption>
        Your existing Chrome session. Extensions, logins, cookies &mdash; all there.
      </Caption>

      <P>
        Every browser automation MCP I tried either spawns a new Chrome
        instance or forces you into a limited set of predefined tools. Playwriter
        does neither. It connects to the browser you already have open,
        exposes the <strong>full Playwright API</strong> through a single{" "}
        <Code>execute</Code> tool, and gets out of the way.
        One tool. Any Playwright code. No wrappers.
      </P>

      <Section id="getting-started" title="Getting started">

        <P>
          <strong>Three steps.</strong> Extension, icon click, then you&apos;re automating.
        </P>

        <OL>
          <Li>
            Install the{" "}
            <A href="https://chromewebstore.google.com/detail/playwriter-mcp/jfeammnjpkecdekppnclgkkffahnhfhe">Chrome extension</A>
          </Li>
          <Li>Click the extension icon on a tab — it turns green</Li>
          <Li>Install CLI and run your first command:</Li>
        </OL>

        <CodeBlock lang="bash">{dedent`
          npm i -g playwriter
          playwriter -s 1 -e "await page.goto('https://example.com')"
        `}</CodeBlock>

        <P>
          The extension connects your browser to a <strong>local WebSocket relay</strong> on{" "}
          <Code>localhost:19988</Code>. The CLI sends Playwright
          code through the relay. No remote servers, no accounts, nothing
          leaves your machine.
        </P>

        <CodeBlock lang="bash">{dedent`
          playwriter session new              # new sandbox, outputs id (e.g. 1)
          playwriter -s 1 -e "await page.goto('https://example.com')"
          playwriter -s 1 -e "console.log(await snapshot({ page }))"
          playwriter -s 1 -e "await page.locator('aria-ref=e5').click()"
        `}</CodeBlock>

        <Caption>
          Extension icon green = connected. Gray = not attached to this tab.
        </Caption>

      </Section>

      <Section id="how-it-works" title="How it works">

        <P>
          The extension uses <Code>chrome.debugger</Code> to
          attach to tabs where you clicked the icon. It opens a WebSocket
          connection to a local relay server. The CLI (or MCP, or your own
          Playwright script) connects to the same relay. <strong>CDP commands flow
          through</strong>; the extension forwards them to Chrome and sends responses
          back.
        </P>

        <CodeBlock lang="bash">{dedent`
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
        `}</CodeBlock>

        <P>
          <strong>No Chrome restart required.</strong> No <Code>--remote-debugging-port</Code>{" "}
          flags. The extension handles the CDP attachment transparently, and
          the relay <strong>multiplexes sessions</strong> so multiple agents or CLI instances
          can work with the same browser simultaneously.
        </P>

      </Section>

      <Section id="snapshots" title="Accessibility snapshots">

        <P>
          The core feedback loop is <strong>observe &rarr; act &rarr; observe</strong>.
          Accessibility snapshots are the primary way to read page state. They return
          the full interactive element tree as text, with Playwright locators attached
          to every element.
        </P>

        <CodeBlock lang="bash">{dedent`
          playwriter -s 1 -e "await snapshot({ page })"

          # Output:
          # - banner:
          #     - link "Home" [id="nav-home"]
          #     - navigation:
          #         - link "Docs" [data-testid="docs-link"]
          #         - link "Blog" role=link[name="Blog"]
        `}</CodeBlock>

        <P>
          Each line ends with a <strong>locator</strong> you can pass directly to{" "}
          <Code>page.locator()</Code>. Subsequent calls return a
          <strong> diff</strong>, so you only see what changed. Use{" "}
          <Code>search</Code> to filter large pages.
        </P>

        <CodeBlock lang="bash">{dedent`
          # Search for specific elements
          playwriter -s 1 -e "await snapshot({ page, search: /button|submit/i })"

          # Always print URL first, then snapshot — pages can redirect
          playwriter -s 1 -e "console.log('URL:', page.url()); await snapshot({ page }).then(console.log)"
        `}</CodeBlock>

        <P>
          Snapshots are <strong>text</strong>. They cost a fraction of what screenshots cost in
          tokens. Use them as your <strong>primary debugging tool</strong>. Only reach for
          screenshots when spatial layout matters &mdash; grids, dashboards, maps.
        </P>

        <Caption>
          Accessibility tree as text. 5&ndash;20KB vs 100KB+ for screenshots.
        </Caption>

      </Section>

      <Section id="visual-labels" title="Visual labels">

        <P>
          For pages where spatial layout matters,{" "}
          <Code>screenshotWithAccessibilityLabels</Code> overlays{" "}
          <strong>Vimium-style labels</strong> on every interactive element. Take a screenshot,
          read the labels, click by reference.
        </P>

        <CodeBlock lang="bash">{dedent`
          playwriter -s 1 -e "await screenshotWithAccessibilityLabels({ page })"
          # Returns screenshot + accessibility snapshot with aria-ref selectors

          playwriter -s 1 -e "await page.locator('aria-ref=e5').click()"
        `}</CodeBlock>

        <P>
          Labels are <strong>color-coded by element type</strong>: yellow for links, orange for
          buttons, coral for inputs, pink for checkboxes, peach for sliders,
          salmon for menus, amber for tabs. The ref system is shared with{" "}
          <Code>snapshot()</Code>, so you can switch between text
          and visual modes freely.
        </P>

        <Caption>
          Vimium-style labels. Screenshot + snapshot in one call.
        </Caption>

      </Section>

      <Section id="sessions" title="Sessions">

        <P>
          Each session runs in an <strong>isolated sandbox</strong> with its own{" "}
          <Code>state</Code> object. Variables, pages, listeners
          persist between calls within a session. Different sessions get
          different state. Browser tabs are shared.
        </P>

        <CodeBlock lang="bash">{dedent`
          playwriter session new    # => 1
          playwriter session new    # => 2
          playwriter session list   # shows sessions + state keys

          # Session 1 stores data
          playwriter -s 1 -e "state.users = await page.$$eval('.user', els => els.map(e => e.textContent))"

          # Session 2 can't see it
          playwriter -s 2 -e "console.log(state.users)"  # undefined
        `}</CodeBlock>

        <P>
          Create your own page to <strong>avoid interference</strong> from other agents. Reuse
          an existing <Code>about:blank</Code> tab or create a
          fresh one, and store it in <Code>state</Code>.
        </P>

        <CodeBlock lang="bash">{dedent`
          playwriter -s 1 -e "state.myPage = context.pages().find(p => p.url() === 'about:blank') ?? await context.newPage(); await state.myPage.goto('https://example.com')"

          # All subsequent calls use state.myPage
          playwriter -s 1 -e "console.log(await state.myPage.title())"
        `}</CodeBlock>

      </Section>

      <Section id="debugger-and-editor" title="Debugger & editor">

        <P>
          <strong>Full Chrome DevTools Protocol access.</strong> Set breakpoints, step through
          code, inspect variables at runtime. Live-edit page scripts and CSS
          without reloading.
        </P>

        <CodeBlock lang="bash">{dedent`
          # Set breakpoints and debug
          playwriter -s 1 -e "state.cdp = await getCDPSession({ page }); state.dbg = createDebugger({ cdp: state.cdp }); await state.dbg.enable()"
          playwriter -s 1 -e "state.scripts = await state.dbg.listScripts({ search: 'app' }); console.log(state.scripts.map(s => s.url))"
          playwriter -s 1 -e "await state.dbg.setBreakpoint({ file: state.scripts[0].url, line: 42 })"

          # Live edit page code
          playwriter -s 1 -e "state.editor = createEditor({ cdp: state.cdp }); await state.editor.enable()"
          playwriter -s 1 -e "await state.editor.edit({ url: 'https://example.com/app.js', oldString: 'const DEBUG = false', newString: 'const DEBUG = true' })"
        `}</CodeBlock>

        <P>
          Edits are <strong>in-memory</strong> and persist until the page reloads. Useful for
          toggling debug flags, patching broken code, or testing quick fixes
          without touching source files. The editor also supports{" "}
          <Code>grep</Code> across all loaded scripts.
        </P>

        <Caption>
          Breakpoints, stepping, variable inspection &mdash; from the CLI.
        </Caption>

      </Section>

      <Section id="network-interception" title="Network interception">

        <P>
          <strong>Intercept requests and responses</strong> to reverse-engineer APIs, scrape
          data, or debug network issues. Store captured data in{" "}
          <Code>state</Code> and analyze across calls.
        </P>

        <CodeBlock lang="bash">{dedent`
          # Start intercepting
          playwriter -s 1 -e "state.responses = []; page.on('response', async res => { if (res.url().includes('/api/')) { try { state.responses.push({ url: res.url(), status: res.status(), body: await res.json() }); } catch {} } })"

          # Trigger actions, then analyze
          playwriter -s 1 -e "await page.click('button.load-more')"
          playwriter -s 1 -e "console.log('Captured', state.responses.length, 'API calls'); state.responses.forEach(r => console.log(r.status, r.url.slice(0, 80)))"

          # Replay an API call directly
          playwriter -s 1 -e "const data = await page.evaluate(async (url) => { const res = await fetch(url); return res.json(); }, state.responses[0].url); console.log(data)"
        `}</CodeBlock>

        <P>
          This is <strong>faster than scrolling through DOM</strong>. Capture the real API
          calls, inspect their schemas, and replay them with different
          parameters. Works for pagination, authenticated endpoints, and
          anything behind JavaScript rendering.
        </P>

      </Section>

      <Section id="screen-recording" title="Screen recording">

        <P>
          <strong>Record the active tab as video</strong> using{" "}
          <Code>chrome.tabCapture</Code>. The recording runs in
          the extension context, so it <strong>survives page navigation</strong>. Video is saved
          as MP4.
        </P>

        <CodeBlock lang="bash">{dedent`
          # Start recording
          playwriter -s 1 -e "await startRecording({ page, outputPath: './recording.mp4', frameRate: 30 })"

          # Navigate, interact — recording continues
          playwriter -s 1 -e "await page.click('a'); await page.waitForLoadState('domcontentloaded')"
          playwriter -s 1 -e "await page.goBack()"

          # Stop and save
          playwriter -s 1 -e "const { path, duration, size } = await stopRecording({ page }); console.log(path, duration + 'ms', size + ' bytes')"
        `}</CodeBlock>

        <P>
          Unlike <Code>getDisplayMedia</Code>, this approach
          <strong> persists across navigations</strong> because the extension holds the{" "}
          <Code>MediaRecorder</Code>, not the page. You can also
          check recording status with <Code>isRecording</Code> or
          cancel without saving with <Code>cancelRecording</Code>.
        </P>

        <Caption>
          Native tab capture. 30&ndash;60fps. Survives navigation.
        </Caption>

      </Section>

      <Section id="comparison" title="Comparison">

        <P>
          How Playwriter compares to other browser automation approaches.
        </P>

        <ComparisonTable
          title="vs Playwright MCP"
          headers={["", "Playwright MCP", "Playwriter"]}
          rows={[
            ["Browser", "Spawns new Chrome", "Uses your Chrome"],
            ["Extensions", "None", "Your existing ones"],
            ["Login state", "Fresh", "Already logged in"],
            ["Bot detection", "Always detected", "Can bypass"],
            ["Collaboration", "Separate window", "Same browser as user"],
          ]}
        />

        <ComparisonTable
          title="vs BrowserMCP"
          headers={["", "BrowserMCP", "Playwriter"]}
          rows={[
            ["Tools", "12+ dedicated tools", "1 execute tool"],
            ["API", "Limited actions", "Full Playwright"],
            ["Context usage", "High (tool schemas)", "Low"],
            ["LLM knowledge", "Must learn tools", "Already knows Playwright"],
          ]}
        />

        <ComparisonTable
          title="vs Claude Browser Extension"
          headers={["", "Claude Extension", "Playwriter"]}
          rows={[
            ["Agent support", "Claude only", "Any MCP client"],
            ["Windows WSL", "No", "Yes"],
            ["Context method", "Screenshots (100KB+)", "A11y snapshots (5\u201320KB)"],
            ["Playwright API", "No", "Full"],
            ["Debugger", "No", "Yes"],
            ["Live code editing", "No", "Yes"],
            ["Network interception", "Limited", "Full"],
            ["Raw CDP access", "No", "Yes"],
          ]}
        />

      </Section>

      <Section id="remote-access" title="Remote access">

        <P>
          Control Chrome on <strong>any machine from anywhere</strong> over the internet.
          The relay runs on the host alongside Chrome.
          A{" "}
          <A href="https://traforo.dev">traforo</A>{" "}
          tunnel exposes it through Cloudflare, giving you a <strong>secure public URL</strong>.
          No VPN, no firewall rules, no port forwarding.
        </P>

        <CodeBlock lang="bash">{dedent`
          # On the host machine — start relay with tunnel
          npx -y traforo -p 19988 -t my-machine -- npx -y playwriter serve --token <secret>

          # From anywhere — set env vars and use normally
          export PLAYWRITER_HOST=https://my-machine-tunnel.traforo.dev
          export PLAYWRITER_TOKEN=<secret>
          playwriter -s 1 -e "await page.goto('https://example.com')"
        `}</CodeBlock>

        <P>
          Also works on a <strong>LAN without tunnels</strong> &mdash; just set{" "}
          <Code>PLAYWRITER_HOST=192.168.1.10</Code>. Works for MCP
          too &mdash; set <Code>PLAYWRITER_HOST</Code> and{" "}
          <Code>PLAYWRITER_TOKEN</Code> in your MCP client env config.
          Use cases: headless Mac mini, remote user support,
          multi-machine automation, dev from a VM or devcontainer.
        </P>

      </Section>

      <Section id="security" title="Security">

        <P>
          Playwriter is <strong>local by default</strong>. The relay runs on{" "}
          <Code>localhost:19988</Code> and only accepts connections
          from the extension. There&apos;s no remote server, no account, no
          telemetry.
        </P>

        <List>
          <Li>
            <strong>Local only</strong> &mdash; WebSocket server binds to
            localhost. Nothing leaves your machine.
          </Li>
          <Li>
            <strong>Origin validation</strong> &mdash; only the Playwriter
            extension origin is accepted. Browsers cannot spoof the Origin
            header, so malicious websites cannot connect.
          </Li>
          <Li>
            <strong>Explicit consent</strong> &mdash; only tabs where you
            clicked the extension icon are controlled. No background access.
          </Li>
          <Li>
            <strong>Visible automation</strong> &mdash; Chrome shows an
            automation banner on controlled tabs.
          </Li>
        </List>

      </Section>

    </EditorialPage>
  );
}
