/*
 * Playwriter editorial page — benji.org/liveline-inspired design.
 * Uses the same editorial layout, typography, and styling system.
 * ChartPlaceholder boxes reserved for future showcase videos.
 *
 * Prism.js is used for syntax highlighting with a custom light theme
 * that matches the original benji.org subtle code block style.
 */

import { useEffect, useRef, useState } from "react";
import Prism from "prismjs";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-bash";
import "website/src/styles/liveline.css";
import "website/src/styles/liveline-prism.css";


/* =========================================================================
   TOC sidebar (fixed left)
   ========================================================================= */

/*
 * Tracks which section heading is currently in the top ~25% of the viewport.
 * Uses IntersectionObserver with rootMargin to create a detection zone:
 * -80px top (fixed header offset), -75% bottom (only top quarter triggers).
 * When multiple headings intersect, the last one in DOM order wins since
 * that's the section the user is actually reading.
 */
function useActiveTocId() {
  const [activeId, setActiveId] = useState("");

  useEffect(() => {
    const headings = document.querySelectorAll<HTMLElement>("h1[id]");
    if (headings.length === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        // Collect all currently-intersecting heading ids
        const visible: string[] = [];
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.target.id) {
            visible.push(entry.target.id);
          }
        });

        if (visible.length > 0) {
          // Pick the last one in DOM order (furthest down the page)
          const sorted = visible.sort((a, b) => {
            const elA = document.getElementById(a);
            const elB = document.getElementById(b);
            if (!elA || !elB) {
              return 0;
            }
            return elA.getBoundingClientRect().top - elB.getBoundingClientRect().top;
          });
          setActiveId(sorted[sorted.length - 1]);
        }
      },
      {
        // 80px for fixed header, bottom -75% so only top quarter triggers
        rootMargin: "-80px 0px -75% 0px",
        threshold: 0,
      },
    );

    headings.forEach((heading) => {
      observer.observe(heading);
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  return activeId;
}

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

function TableOfContents() {
  const activeId = useActiveTocId();

  return (
    <aside
      className="fixed top-[80px] hidden lg:block"
      style={{ left: "max(1rem, calc((100vw - 550px) / 2 - 200px))", width: "122px" }}
    >
      <nav>
        <a
          href="/"
          className="no-underline transition-colors block"
          style={{
            fontSize: "14px",
            fontWeight: 700,
            lineHeight: "20px",
            letterSpacing: "-0.09px",
            padding: "4px 0",
            color: "var(--ll-text-primary)",
            fontFamily: "var(--ll-font-primary)",
            marginBottom: "8px",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "var(--ll-text-hover)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "var(--ll-text-primary)";
          }}
        >
          playwriter
        </a>
        {tocItems.map((item) => {
          const isActive = `#${activeId}` === item.href;
          const defaultColor = isActive ? "var(--ll-text-primary)" : "var(--ll-text-secondary)";
          return (
            <a
              key={item.href}
              href={item.href}
              className="block no-underline"
              style={{
                fontSize: "13px",
                fontWeight: 475,
                lineHeight: "15.6px",
                letterSpacing: "-0.04px",
                padding: "3px 0",
                color: defaultColor,
                fontFamily: "var(--ll-font-primary)",
                transition: "color 0.15s ease",
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.color = "var(--ll-text-hover)";
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = defaultColor;
              }}
            >
              {item.label}
            </a>
          );
        })}
      </nav>
    </aside>
  );
}

/* =========================================================================
   Back button (fixed top-right)
   ========================================================================= */

function BackButton() {
  return (
    <a
      href="/"
      className="fixed top-5 right-5 z-[100000] flex items-center justify-center w-10 h-10 rounded-full no-underline"
      style={{
        background: "var(--ll-btn-bg)",
        color: "var(--ll-text-secondary)",
        boxShadow: "var(--ll-btn-shadow)",
        transition: "color 0.15s, transform 0.15s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = "var(--ll-text-hover)";
        e.currentTarget.style.transform = "scale(1.05)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = "var(--ll-text-secondary)";
        e.currentTarget.style.transform = "scale(1)";
      }}
      onMouseDown={(e) => {
        e.currentTarget.style.transform = "scale(0.95)";
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = "scale(1.05)";
      }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path
          d="M12.25 7H1.75M1.75 7L6.125 2.625M1.75 7L6.125 11.375"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </a>
  );
}

/* =========================================================================
   Reusable components
   ========================================================================= */

function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h1
      id={id}
      className="scroll-mt-[5.25rem]"
      style={{
        fontFamily: "var(--ll-font-primary)",
        fontSize: "14px",
        fontWeight: 560,
        lineHeight: "20px",
        letterSpacing: "-0.09px",
        color: "var(--ll-text-primary)",
        margin: 0,
        padding: 0,
        transform: "translateY(-10px)",
      }}
    >
      {children}
    </h1>
  );
}

function Paragraph({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <p
      className={className}
      style={{
        fontFamily: "var(--ll-font-primary)",
        fontSize: "14px",
        fontWeight: 475,
        lineHeight: "20px",
        letterSpacing: "-0.09px",
        color: "var(--ll-text-primary)",
        margin: 0,
      }}
    >
      {children}
    </p>
  );
}

function Caption({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontFamily: "var(--ll-font-primary)",
        fontSize: "12px",
        fontWeight: 475,
        lineHeight: "20px",
        letterSpacing: "-0.09px",
        color: "var(--ll-text-secondary)",
        margin: 0,
      }}
    >
      {children}
    </p>
  );
}

function Divider() {
  return (
    <div
      style={{
        height: "1px",
        background: "var(--ll-divider)",
        margin: 0,
      }}
    />
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <>
      <Divider />
      <SectionHeading id={id}>{title}</SectionHeading>
      {children}
    </>
  );
}

function List({ children }: { children: React.ReactNode }) {
  return (
    <ul
      className="m-0 pl-5"
      style={{
        fontFamily: "var(--ll-font-primary)",
        fontSize: "14px",
        fontWeight: 475,
        lineHeight: "20px",
        letterSpacing: "-0.09px",
        color: "var(--ll-text-primary)",
        listStyleType: "disc",
      }}
    >
      {children}
    </ul>
  );
}

function Li({ children }: { children: React.ReactNode }) {
  return <li style={{ padding: "0 0 8px 12px" }}>{children}</li>;
}

function CodeBlock({ children, lang = "jsx" }: { children: string; lang?: string }) {
  const codeRef = useRef<HTMLElement>(null);
  const lines = children.split("\n");

  useEffect(() => {
    if (codeRef.current) {
      Prism.highlightElement(codeRef.current);
    }
  }, [children]);

  return (
    <figure className="m-0 ll-bleed">
      <div className="relative">
        <pre
          className="overflow-x-auto"
          style={{
            background: "var(--ll-code-bg)",
            borderRadius: "8px",
            margin: 0,
            padding: 0,
          }}
        >
          <div
            className="flex"
            style={{
              padding: "12px 8px 8px",
              fontFamily: "var(--ll-font-code)",
              fontSize: "12px",
              fontWeight: 400,
              lineHeight: "18px",
              letterSpacing: "normal",
              color: "var(--ll-text-primary)",
              tabSize: 2,
            }}
          >
            {/* Line numbers */}
            <span
              className="select-none shrink-0"
              aria-hidden="true"
              style={{
                color: "var(--ll-code-line-nr)",
                textAlign: "right",
                paddingRight: "20px",
                minWidth: "28px",
                userSelect: "none",
              }}
            >
              {lines.map((_, i) => {
                return (
                  <span key={i} className="block">
                    {i + 1}
                  </span>
                );
              })}
            </span>
            {/* Highlighted code */}
            <code
              ref={codeRef}
              className={`language-${lang}`}
              style={{ whiteSpace: "pre", background: "none", padding: 0 }}
            >
              {children}
            </code>
          </div>
        </pre>
      </div>
    </figure>
  );
}

function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="ll-inline-code">
      {children}
    </code>
  );
}

function ChartPlaceholder({ height = 200, label }: { height?: number; label?: string }) {
  return (
    <div className="my-4 ll-bleed">
      <div
        className="w-full overflow-hidden relative"
        style={{
          height: `${height}px`,
          background: "rgb(17, 17, 17)",
        }}
      >
        {/* Simulated chart line */}
        <svg
          viewBox="0 0 550 200"
          className="absolute inset-0 w-full h-full"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d="M0,140 C30,135 60,120 90,125 C120,130 150,100 180,95 C210,90 240,110 270,105 C300,100 330,80 360,85 C390,90 420,70 450,65 C480,60 510,75 550,60"
            fill="none"
            stroke="#3b82f6"
            strokeWidth="2"
          />
          <path
            d="M0,140 C30,135 60,120 90,125 C120,130 150,100 180,95 C210,90 240,110 270,105 C300,100 330,80 360,85 C390,90 420,70 450,65 C480,60 510,75 550,60 L550,200 L0,200 Z"
            fill="url(#chartFill)"
          />
          {/* Live dot */}
          <circle cx="550" cy="60" r="4" fill="#3b82f6">
            <animate
              attributeName="r"
              values="4;6;4"
              dur="2s"
              repeatCount="indefinite"
            />
            <animate
              attributeName="opacity"
              values="1;0.6;1"
              dur="2s"
              repeatCount="indefinite"
            />
          </circle>
        </svg>
        {label && (
          <div
            className="absolute top-3 right-3 px-2 py-1 rounded text-xs"
            style={{
              background: "rgba(59, 130, 246, 0.15)",
              color: "#3b82f6",
              fontFamily: "var(--ll-font-code)",
              fontWeight: 475,
              fontSize: "11px",
            }}
          >
            {label}
          </div>
        )}
      </div>
    </div>
  );
}

function PropsTable({
  title,
  rows,
}: {
  title?: string;
  rows: Array<[string, string, string]>;
}) {
  return (
    <div className="w-full max-w-full overflow-x-auto" style={{ padding: "8px 0" }}>
      {title && (
        <div
          style={{
            fontFamily: "var(--ll-font-primary)",
            fontSize: "11px",
            fontWeight: 400,
            color: "var(--ll-text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.02em",
            padding: "0 0 6px",
          }}
        >
          {title}
        </div>
      )}
      <table
        className="w-full"
        style={{
          borderSpacing: 0,
          borderCollapse: "collapse",
        }}
      >
        <thead>
          <tr>
            {["Prop", "Type", "Default"].map((header) => {
              return (
                <th
                  key={header}
                  className="text-left"
                  style={{
                    padding: "4.8px 12px 4.8px 0",
                    fontSize: "11px",
                    fontWeight: 400,
                    fontFamily: "var(--ll-font-primary)",
                    color: "var(--ll-text-muted)",
                    borderBottom: "1px solid var(--ll-border)",
                  }}
                >
                  {header}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map(([prop, type, def]) => {
            return (
              <tr key={prop}>
                <td
                  style={{
                    padding: "4.8px 12px 4.8px 0",
                    fontSize: "11px",
                    fontWeight: 400,
                    fontFamily: "var(--ll-font-code)",
                    color: "var(--ll-text-primary)",
                    borderBottom: "1px solid var(--ll-border)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {prop}
                </td>
                <td
                  style={{
                    padding: "4.8px 12px 4.8px 0",
                    fontSize: "11px",
                    fontWeight: 400,
                    fontFamily: "var(--ll-font-code)",
                    color: "var(--ll-text-muted)",
                    borderBottom: "1px solid var(--ll-border)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {type}
                </td>
                <td
                  style={{
                    padding: "4.8px 12px 4.8px 0",
                    fontSize: "11px",
                    fontWeight: 400,
                    fontFamily: "var(--ll-font-code)",
                    color: "var(--ll-text-muted)",
                    borderBottom: "1px solid var(--ll-border)",
                  }}
                >
                  {def}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* =========================================================================
   Main page
   ========================================================================= */

export default function LivelinePage() {
  return (
    <div
      className="liveline-page relative min-h-screen overflow-x-hidden"
      style={{
        background: "var(--ll-bg)",
        color: "var(--ll-text-primary)",
        fontFamily: "var(--ll-font-primary)",
        WebkitFontSmoothing: "antialiased",
        textRendering: "optimizeLegibility",
      }}
    >
      <BackButton />
      <TableOfContents />

      <div
        className="mx-auto"
        style={{ width: "550px", maxWidth: "calc(100% - 2rem)", padding: "0 1rem 6rem" }}
      >
        {/* Top spacer */}
        <div style={{ height: "80px" }} />

        <article className="liveline-article flex flex-col gap-[16px]">
          {/* Intro */}
          <Paragraph>
            Playwriter lets you control your Chrome browser with the full
            Playwright API. A Chrome extension, a local relay, and a CLI. No new
            browser windows, no Chrome flags, no context bloat.
          </Paragraph>

          <ChartPlaceholder height={300} label="demo" />
          <Caption>
            Your existing Chrome session. Extensions, logins, cookies &mdash; all there.
          </Caption>

          <Paragraph>
            Every browser automation MCP I tried either spawns a new Chrome
            instance or forces you into a limited set of predefined tools. Playwriter
            does neither. It connects to the browser you already have open,
            exposes the full Playwright API through a single{" "}
            <InlineCode>execute</InlineCode> tool, and gets out of the way.
            One tool. Any Playwright code. No wrappers.
          </Paragraph>

          <Section id="getting-started" title="Getting started">

          <Paragraph>
            Three steps. Extension, icon click, then you&apos;re automating.
          </Paragraph>

          <CodeBlock lang="bash">{`# 1. Install the Chrome extension
#    https://chromewebstore.google.com/detail/playwriter-mcp/jfeammnjpkecdekppnclgkkffahnhfhe

# 2. Click the extension icon on a tab — it turns green

# 3. Install CLI and run your first command
npm i -g playwriter
playwriter -s 1 -e "await page.goto('https://example.com')"`}</CodeBlock>

          <Paragraph>
            The extension connects your browser to a local WebSocket relay on{" "}
            <InlineCode>localhost:19988</InlineCode>. The CLI sends Playwright
            code through the relay. No remote servers, no accounts, nothing
            leaves your machine.
          </Paragraph>

          <CodeBlock lang="bash">{`playwriter session new              # new sandbox, outputs id (e.g. 1)
playwriter -s 1 -e "await page.goto('https://example.com')"
playwriter -s 1 -e "console.log(await snapshot({ page }))"
playwriter -s 1 -e "await page.locator('aria-ref=e5').click()"`}</CodeBlock>

          <ChartPlaceholder height={200} label="getting started" />
          <Caption>
            Extension icon green = connected. Gray = not attached to this tab.
          </Caption>

          </Section>

          <Section id="how-it-works" title="How it works">

          <Paragraph>
            The extension uses <InlineCode>chrome.debugger</InlineCode> to
            attach to tabs where you clicked the icon. It opens a WebSocket
            connection to a local relay server. The CLI (or MCP, or your own
            Playwright script) connects to the same relay. CDP commands flow
            through; the extension forwards them to Chrome and sends responses
            back.
          </Paragraph>

          <CodeBlock lang="bash">{`+---------------------+     +-------------------+     +-----------------+
|   BROWSER           |     |   LOCALHOST        |     |   CLIENT        |
|                     |     |                    |     |                 |
|  +---------------+  |     | WebSocket Server   |     |  +-----------+ |
|  |   Extension   |<--------->  :19988          |     |  | CLI / MCP | |
|  +-------+-------+  | WS  |                    |     |  +-----------+ |
|          |          |     |  /extension        |     |        |       |
|    chrome.debugger  |     |       |            |     |        v       |
|          v          |     |       v            |     |  +-----------+ |
|  +---------------+  |     |  /cdp/:id <------------> |  | execute   | |
|  | Tab 1 (green) |  |     +--------------------+  WS |  +-----------+ |
|  | Tab 2 (green) |  |                                |        |       |
|  | Tab 3 (gray)  |  |     Tab 3 not controlled       | Playwright API |
+---------------------+     (extension not clicked)    +-----------------+`}</CodeBlock>

          <Paragraph>
            No Chrome restart required. No <InlineCode>--remote-debugging-port</InlineCode>{" "}
            flags. The extension handles the CDP attachment transparently, and
            the relay multiplexes sessions so multiple agents or CLI instances
            can work with the same browser simultaneously.
          </Paragraph>

          </Section>

          <Section id="snapshots" title="Accessibility snapshots">

          <Paragraph>
            The core feedback loop is <strong>observe &rarr; act &rarr; observe</strong>.
            Accessibility snapshots are the primary way to read page state. They return
            the full interactive element tree as text, with Playwright locators attached
            to every element.
          </Paragraph>

          <CodeBlock lang="bash">{`playwriter -s 1 -e "await snapshot({ page })"

# Output:
# - banner:
#     - link "Home" [id="nav-home"]
#     - navigation:
#         - link "Docs" [data-testid="docs-link"]
#         - link "Blog" role=link[name="Blog"]`}</CodeBlock>

          <Paragraph>
            Each line ends with a locator you can pass directly to{" "}
            <InlineCode>page.locator()</InlineCode>. Subsequent calls return a
            diff, so you only see what changed. Use{" "}
            <InlineCode>search</InlineCode> to filter large pages.
          </Paragraph>

          <CodeBlock lang="bash">{`# Search for specific elements
playwriter -s 1 -e "await snapshot({ page, search: /button|submit/i })"

# Always print URL first, then snapshot — pages can redirect
playwriter -s 1 -e "console.log('URL:', page.url()); await snapshot({ page }).then(console.log)"`}</CodeBlock>

          <Paragraph>
            Snapshots are text. They cost a fraction of what screenshots cost in
            tokens. Use them as your primary debugging tool. Only reach for
            screenshots when spatial layout matters &mdash; grids, dashboards, maps.
          </Paragraph>

          <ChartPlaceholder height={200} label="snapshot" />
          <Caption>
            Accessibility tree as text. 5&ndash;20KB vs 100KB+ for screenshots.
          </Caption>

          </Section>

          <Section id="visual-labels" title="Visual labels">

          <Paragraph>
            For pages where spatial layout matters,{" "}
            <InlineCode>screenshotWithAccessibilityLabels</InlineCode> overlays
            Vimium-style labels on every interactive element. Take a screenshot,
            read the labels, click by reference.
          </Paragraph>

          <CodeBlock lang="bash">{`playwriter -s 1 -e "await screenshotWithAccessibilityLabels({ page })"
# Returns screenshot + accessibility snapshot with aria-ref selectors

playwriter -s 1 -e "await page.locator('aria-ref=e5').click()"`}</CodeBlock>

          <Paragraph>
            Labels are color-coded by element type: yellow for links, orange for
            buttons, coral for inputs, pink for checkboxes, peach for sliders,
            salmon for menus, amber for tabs. The ref system is shared with{" "}
            <InlineCode>snapshot()</InlineCode>, so you can switch between text
            and visual modes freely.
          </Paragraph>

          <ChartPlaceholder height={260} label="visual labels" />
          <Caption>
            Vimium-style labels. Screenshot + snapshot in one call.
          </Caption>

          </Section>

          <Section id="sessions" title="Sessions">

          <Paragraph>
            Each session runs in an isolated sandbox with its own{" "}
            <InlineCode>state</InlineCode> object. Variables, pages, listeners
            persist between calls within a session. Different sessions get
            different state. Browser tabs are shared.
          </Paragraph>

          <CodeBlock lang="bash">{`playwriter session new    # => 1
playwriter session new    # => 2
playwriter session list   # shows sessions + state keys

# Session 1 stores data
playwriter -s 1 -e "state.users = await page.$$eval('.user', els => els.map(e => e.textContent))"

# Session 2 can't see it
playwriter -s 2 -e "console.log(state.users)"  # undefined`}</CodeBlock>

          <Paragraph>
            Create your own page to avoid interference from other agents. Reuse
            an existing <InlineCode>about:blank</InlineCode> tab or create a
            fresh one, and store it in <InlineCode>state</InlineCode>.
          </Paragraph>

          <CodeBlock lang="bash">{`playwriter -s 1 -e "state.myPage = context.pages().find(p => p.url() === 'about:blank') ?? await context.newPage(); await state.myPage.goto('https://example.com')"

# All subsequent calls use state.myPage
playwriter -s 1 -e "console.log(await state.myPage.title())"`}</CodeBlock>

          </Section>

          <Section id="debugger-and-editor" title="Debugger & editor">

          <Paragraph>
            Full Chrome DevTools Protocol access. Set breakpoints, step through
            code, inspect variables at runtime. Live-edit page scripts and CSS
            without reloading.
          </Paragraph>

          <CodeBlock lang="bash">{`# Set breakpoints and debug
playwriter -s 1 -e "state.cdp = await getCDPSession({ page }); state.dbg = createDebugger({ cdp: state.cdp }); await state.dbg.enable()"
playwriter -s 1 -e "state.scripts = await state.dbg.listScripts({ search: 'app' }); console.log(state.scripts.map(s => s.url))"
playwriter -s 1 -e "await state.dbg.setBreakpoint({ file: state.scripts[0].url, line: 42 })"

# Live edit page code
playwriter -s 1 -e "state.editor = createEditor({ cdp: state.cdp }); await state.editor.enable()"
playwriter -s 1 -e "await state.editor.edit({ url: 'https://example.com/app.js', oldString: 'const DEBUG = false', newString: 'const DEBUG = true' })"`}</CodeBlock>

          <Paragraph>
            Edits are in-memory and persist until the page reloads. Useful for
            toggling debug flags, patching broken code, or testing quick fixes
            without touching source files. The editor also supports{" "}
            <InlineCode>grep</InlineCode> across all loaded scripts.
          </Paragraph>

          <ChartPlaceholder height={200} label="debugger" />
          <Caption>
            Breakpoints, stepping, variable inspection &mdash; from the CLI.
          </Caption>

          </Section>

          <Section id="network-interception" title="Network interception">

          <Paragraph>
            Intercept requests and responses to reverse-engineer APIs, scrape
            data, or debug network issues. Store captured data in{" "}
            <InlineCode>state</InlineCode> and analyze across calls.
          </Paragraph>

          <CodeBlock lang="bash">{`# Start intercepting
playwriter -s 1 -e "state.responses = []; page.on('response', async res => { if (res.url().includes('/api/')) { try { state.responses.push({ url: res.url(), status: res.status(), body: await res.json() }); } catch {} } })"

# Trigger actions, then analyze
playwriter -s 1 -e "await page.click('button.load-more')"
playwriter -s 1 -e "console.log('Captured', state.responses.length, 'API calls'); state.responses.forEach(r => console.log(r.status, r.url.slice(0, 80)))"

# Replay an API call directly
playwriter -s 1 -e "const data = await page.evaluate(async (url) => { const res = await fetch(url); return res.json(); }, state.responses[0].url); console.log(data)"`}</CodeBlock>

          <Paragraph>
            This is faster than scrolling through DOM. Capture the real API
            calls, inspect their schemas, and replay them with different
            parameters. Works for pagination, authenticated endpoints, and
            anything behind JavaScript rendering.
          </Paragraph>

          </Section>

          <Section id="screen-recording" title="Screen recording">

          <Paragraph>
            Record the active tab as video using{" "}
            <InlineCode>chrome.tabCapture</InlineCode>. The recording runs in
            the extension context, so it survives page navigation. Video is saved
            as MP4.
          </Paragraph>

          <CodeBlock lang="bash">{`# Start recording
playwriter -s 1 -e "await startRecording({ page, outputPath: './recording.mp4', frameRate: 30 })"

# Navigate, interact — recording continues
playwriter -s 1 -e "await page.click('a'); await page.waitForLoadState('domcontentloaded')"
playwriter -s 1 -e "await page.goBack()"

# Stop and save
playwriter -s 1 -e "const { path, duration, size } = await stopRecording({ page }); console.log(path, duration + 'ms', size + ' bytes')"`}</CodeBlock>

          <Paragraph>
            Unlike <InlineCode>getDisplayMedia</InlineCode>, this approach
            persists across navigations because the extension holds the{" "}
            <InlineCode>MediaRecorder</InlineCode>, not the page. You can also
            check recording status with <InlineCode>isRecording</InlineCode> or
            cancel without saving with <InlineCode>cancelRecording</InlineCode>.
          </Paragraph>

          <ChartPlaceholder height={200} label="recording" />
          <Caption>
            Native tab capture. 30&ndash;60fps. Survives navigation.
          </Caption>

          </Section>

          <Section id="comparison" title="Comparison">

          <Paragraph>
            How Playwriter compares to other browser automation approaches.
          </Paragraph>

          <PropsTable
            title="vs Playwright MCP"
            rows={[
              ["Browser", "Spawns new Chrome", "Uses your Chrome"],
              ["Extensions", "None", "Your existing ones"],
              ["Login state", "Fresh", "Already logged in"],
              ["Bot detection", "Always detected", "Can bypass"],
              ["Collaboration", "Separate window", "Same browser as user"],
            ]}
          />

          <PropsTable
            title="vs BrowserMCP"
            rows={[
              ["Tools", "12+ dedicated tools", "1 execute tool"],
              ["API", "Limited actions", "Full Playwright"],
              ["Context usage", "High (tool schemas)", "Low"],
              ["LLM knowledge", "Must learn tools", "Already knows Playwright"],
            ]}
          />

          <PropsTable
            title="vs Antigravity (Jetski)"
            rows={[
              ["Tools", "17+ tools", "1 tool"],
              ["Subagent", "Spawns for each task", "Direct execution"],
              ["Latency", "High (agent overhead)", "Low"],
            ]}
          />

          <PropsTable
            title="vs Claude Browser Extension"
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

          <Paragraph>
            Control Chrome on a remote machine over the internet using tunnels.
            Run the relay on the host, expose it through a tunnel, and connect
            from anywhere.
          </Paragraph>

          <CodeBlock lang="bash">{`# On the host machine
npx -y traforo -p 19988 -t my-machine -- npx -y playwriter serve --token <secret>

# From anywhere
export PLAYWRITER_HOST=https://my-machine-tunnel.traforo.dev
export PLAYWRITER_TOKEN=<secret>
playwriter -s 1 -e "await page.goto('https://example.com')"`}</CodeBlock>

          <Paragraph>
            Also works on a LAN without tunnels &mdash; just set{" "}
            <InlineCode>PLAYWRITER_HOST=192.168.1.10</InlineCode>. Use cases
            include controlling a headless Mac mini, providing remote user
            support, and multi-machine automation.
          </Paragraph>

          </Section>

          <Section id="security" title="Security">

          <Paragraph>
            Playwriter is local by default. The relay runs on{" "}
            <InlineCode>localhost:19988</InlineCode> and only accepts connections
            from the extension. There&apos;s no remote server, no account, no
            telemetry.
          </Paragraph>

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
        </article>
      </div>
    </div>
  );
}
