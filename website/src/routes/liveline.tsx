/*
 * Recreation of benji.org/liveline page design.
 * Uses the same editorial layout, typography, and styling system.
 * Chart canvas components are replaced with dark placeholder boxes.
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
  { label: "Momentum", href: "#momentum" },
  { label: "Value overlay", href: "#value-overlay" },
  { label: "Time windows", href: "#time-windows" },
  { label: "Reference line", href: "#reference-line" },
  { label: "Orderbook", href: "#orderbook" },
  { label: "Theming", href: "#theming" },
  { label: "More features", href: "#more-features" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Props", href: "#props" },
  { label: "Stress testing", href: "#stress-testing" },
  { label: "Just a line", href: "#just-a-line" },
  { label: "Acknowledgements", href: "#acknowledgements" },
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
          className="no-underline transition-colors flex items-center gap-1"
          style={{
            fontSize: "14px",
            fontWeight: 475,
            lineHeight: "20px",
            letterSpacing: "-0.09px",
            padding: "4px 0",
            color: "rgba(0, 0, 0, 0.4)",
            fontFamily: "var(--ll-font-primary)",
            marginBottom: "8px",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "rgba(0, 0, 0, 0.7)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "rgba(0, 0, 0, 0.4)";
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
          {" "}Index
        </a>
        {tocItems.map((item) => {
          const isActive = `#${activeId}` === item.href;
          const defaultColor = isActive ? "rgba(0, 0, 0, 0.9)" : "rgba(0, 0, 0, 0.4)";
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
                  e.currentTarget.style.color = "rgba(0, 0, 0, 0.7)";
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
      className="fixed top-5 right-5 z-[100000] flex items-center justify-center w-10 h-10 rounded-full bg-white no-underline"
      style={{
        color: "rgba(0, 0, 0, 0.4)",
        boxShadow:
          "rgba(0, 0, 0, 0.08) 0px 2px 8px, rgba(0, 0, 0, 0.04) 0px 4px 16px, rgba(0, 0, 0, 0.06) 0px 0px 0px 1px inset",
        transition: "color 0.15s, transform 0.15s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = "rgba(0, 0, 0, 0.7)";
        e.currentTarget.style.transform = "scale(1.05)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = "rgba(0, 0, 0, 0.4)";
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
        color: "rgba(0, 0, 0, 0.4)",
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
        background: "rgb(242, 242, 242)",
        margin: 0,
      }}
    />
  );
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
    <figure className="m-0">
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
                color: "rgba(0, 0, 0, 0.15)",
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
    <code
      style={{
        fontFamily: "var(--ll-font-code)",
        fontSize: "12.25px",
        fontWeight: 475,
        lineHeight: "12.25px",
        letterSpacing: "-0.09px",
        padding: "0 4px",
      }}
    >
      {children}
    </code>
  );
}

function ChartPlaceholder({ height = 200, label }: { height?: number; label?: string }) {
  return (
    <div className="my-4">
      <div
        className="w-full rounded-lg overflow-hidden relative"
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
            color: "rgba(0, 0, 0, 0.35)",
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
                    color: "rgba(0, 0, 0, 0.35)",
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
                    color: "rgba(0, 0, 0, 0.35)",
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
                    color: "rgba(0, 0, 0, 0.35)",
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
      className="liveline-page relative min-h-screen"
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
        {/* Page header */}
        <header style={{ padding: "80px 0 40px" }}>
          <h2
            style={{
              fontFamily: "var(--ll-font-primary)",
              fontSize: "13px",
              fontWeight: 475,
              lineHeight: "15.6px",
              letterSpacing: "-0.04px",
              color: "rgba(18, 18, 18, 0.4)",
              margin: 0,
              padding: "0 0 16px",
            }}
          >
            Liveline
          </h2>
          <time
            style={{
              fontFamily: "var(--ll-font-primary)",
              fontSize: "13px",
              fontWeight: 400,
              lineHeight: "15.6px",
              letterSpacing: "-0.04px",
              color: "rgba(18, 18, 18, 0.25)",
            }}
          >
            16 February, 2026
          </time>
        </header>

        <article className="liveline-article flex flex-col gap-[16px]">
          {/* Intro */}
          <Paragraph>
            Liveline is a real-time animated line chart component for React. One{" "}
            <InlineCode>{"<canvas>"}</InlineCode>, no dependencies beyond React
            18, smooth interpolation at 60fps.
          </Paragraph>

          <ChartPlaceholder height={300} label="684.89" />
          <Caption>
            Degen mode (chart shake and particles) with momentum arrows.
          </Caption>

          <Paragraph>
            I built this because every charting library I tried was either too
            heavy for a simple live feed, or too rigid to feel alive. Liveline
            does one thing: draw a line that moves smoothly as new data arrives.
            Everything else is opt-in.
          </Paragraph>

          <Divider />

          {/* Getting started */}
          <SectionHeading id="getting-started">Getting started</SectionHeading>

          <CodeBlock lang="bash">npm install liveline</CodeBlock>

          <Paragraph>
            The component fills its parent container. Set a height on the
            wrapper.
          </Paragraph>

          <CodeBlock>
            {`import { Liveline } from 'liveline'
 
function Chart({ data, value }) {
  return (
    <div style={{ height: 200 }}>
      <Liveline data={data} value={value} />
    </div>
  )
}`}
          </CodeBlock>

          <Paragraph>
            <InlineCode>data</InlineCode> is an array of{" "}
            <InlineCode>{"{ time, value }"}</InlineCode> points.{" "}
            <InlineCode>value</InlineCode> is the latest number.
          </Paragraph>

          <ChartPlaceholder height={200} label="303.34" />
          <Caption>Two props. That&apos;s it.</Caption>

          <Paragraph>
            Feed it data however you like. WebSocket, polling, random walk.
            Liveline interpolates between updates so even infrequent data looks
            smooth. It works for anything with a value that changes over time.
          </Paragraph>

          <ChartPlaceholder height={200} label="98 bpm" />
          <Caption>
            Resting heart rate. Custom formatter, exaggerated Y-axis.
          </Caption>

          <Divider />

          {/* Momentum */}
          <SectionHeading id="momentum">Momentum</SectionHeading>

          <Paragraph>
            The <InlineCode>momentum</InlineCode> prop adds directional arrows
            and a glow to the live dot. Green for up, red for down, grey for
            flat. Pass <InlineCode>true</InlineCode> to auto-detect direction,
            or force it with{" "}
            <InlineCode>&quot;up&quot;</InlineCode>,{" "}
            <InlineCode>&quot;down&quot;</InlineCode>, or{" "}
            <InlineCode>&quot;flat&quot;</InlineCode>.
          </Paragraph>

          <ChartPlaceholder height={220} label="449.73" />
          <Caption>
            Arrows fade out fully before the new direction fades in.
          </Caption>

          <Divider />

          {/* Value overlay */}
          <SectionHeading id="value-overlay">Value overlay</SectionHeading>

          <Paragraph>
            <InlineCode>showValue</InlineCode> renders the current value as a
            large number over the chart. It updates at 60fps through direct DOM
            manipulation, not React re-renders. Pair it with{" "}
            <InlineCode>valueMomentumColor</InlineCode> to tint the number based
            on direction.
          </Paragraph>

          <ChartPlaceholder height={204} label="$17,138.03" />
          <Caption>60fps value overlay with momentum colouring.</Caption>

          <Divider />

          {/* Time windows */}
          <SectionHeading id="time-windows">Time windows</SectionHeading>

          <Paragraph>
            Pass a <InlineCode>windows</InlineCode> array to render time horizon
            buttons. Each entry has a <InlineCode>label</InlineCode> and{" "}
            <InlineCode>secs</InlineCode> value. Three styles are available via{" "}
            <InlineCode>windowStyle</InlineCode>:{" "}
            <InlineCode>&quot;default&quot;</InlineCode>,{" "}
            <InlineCode>&quot;rounded&quot;</InlineCode>, and{" "}
            <InlineCode>&quot;text&quot;</InlineCode>.
          </Paragraph>

          <CodeBlock>
            {`<Liveline
  windows={[
    { label: '1m', secs: 60 },
    { label: '5m', secs: 300 },
  ]}
  windowStyle="rounded"
/>`}
          </CodeBlock>

          <ChartPlaceholder height={186} label="30%" />
          <Caption>
            CPU usage with occasional spikes. Rounded time windows.
          </Caption>

          <Divider />

          {/* Reference line */}
          <SectionHeading id="reference-line">Reference line</SectionHeading>

          <Paragraph>
            <InlineCode>referenceLine</InlineCode> draws a horizontal line at a
            fixed value. Pass an object with <InlineCode>value</InlineCode> and
            an optional <InlineCode>label</InlineCode>.
          </Paragraph>

          <ChartPlaceholder height={186} label="$-18,576" />
          <Caption>
            Polymarket-style prediction line. &quot;Will Bitcoin stay above
            $67,500?&quot;
          </Caption>

          <Divider />

          {/* Orderbook */}
          <SectionHeading id="orderbook">Orderbook</SectionHeading>

          <Paragraph>
            Pass an <InlineCode>orderbook</InlineCode> prop with{" "}
            <InlineCode>bids</InlineCode> and <InlineCode>asks</InlineCode>{" "}
            arrays to render streaming order labels behind the line. Each entry
            is a <InlineCode>[price, size]</InlineCode> tuple. Labels spawn at
            the bottom, drift upward, and fade out. Green for bids, red for
            asks. Bigger orders appear brighter.
          </Paragraph>

          <Paragraph>
            The stream speed reacts to price momentum and orderbook churn (how
            much the bid/ask totals are changing). Calm markets drift slowly,
            volatile ones rush.
          </Paragraph>

          <ChartPlaceholder height={260} label="$61,904" />
          <Caption>
            Kalshi-style orderbook stream. Bid and ask sizes float upward behind
            the price line.
          </Caption>

          <Divider />

          {/* Theming */}
          <SectionHeading id="theming">Theming</SectionHeading>

          <Paragraph>
            Pass any CSS colour string to <InlineCode>color</InlineCode> and
            Liveline derives the full palette. Line, fill gradient, glow, badge,
            grid labels. It converts the input to HSL and generates every variant
            from there.
          </Paragraph>

          <ChartPlaceholder height={204} label="540.42" />
          <Caption>Dark theme. Same component, different colour.</Caption>

          <Divider />

          {/* More features */}
          <SectionHeading id="more-features">More features</SectionHeading>

          <Paragraph>
            Everything is off by default or has sensible defaults. A few more
            things you can turn on:
          </Paragraph>

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
            <li style={{ padding: "0 0 8px 12px" }}>
              <InlineCode>exaggerate</InlineCode> tightens the Y-axis range so
              small movements fill the full chart height. Useful for values that
              move in tiny increments, like the heart rate demo above.
            </li>
            <li style={{ padding: "0 0 8px 12px" }}>
              <InlineCode>scrub</InlineCode> shows a crosshair with time and
              value tooltips on hover. On by default.
            </li>
            <li style={{ padding: "0 0 8px 12px" }}>
              <InlineCode>degen</InlineCode> enables burst particles and chart
              shake on momentum swings. For when subtlety is not the goal.
            </li>
            <li style={{ padding: "0 0 8px 12px" }}>
              <InlineCode>badgeVariant=&quot;minimal&quot;</InlineCode> renders a
              quieter white pill instead of the accent-colored default. Or{" "}
              <InlineCode>{"badge={false}"}</InlineCode> to remove it entirely.
            </li>
          </ul>

          <Divider />

          {/* How it works */}
          <SectionHeading id="how-it-works">How it works</SectionHeading>

          <Paragraph>
            One <InlineCode>{"<canvas>"}</InlineCode>, one{" "}
            <InlineCode>requestAnimationFrame</InlineCode> loop. When a new
            value arrives, nothing jumps. The chart lerps toward the new state at
            8% per frame (<InlineCode>lerpSpeed</InlineCode>). The Y-axis range,
            the badge, the grid labels all use the same lerp. The range snaps
            outward instantly when data exceeds it, so the line is never clipped.
            That&apos;s why it feels like one thing breathing rather than a bunch
            of parts updating independently.
          </Paragraph>

          <Divider />

          {/* Props */}
          <SectionHeading id="props">Props</SectionHeading>

          <PropsTable
            title="Required"
            rows={[
              ["data", "LivelinePoint[]", "required"],
              ["value", "number", "required"],
            ]}
          />

          <PropsTable
            title="Appearance"
            rows={[
              ["theme", "'light' | 'dark'", "'dark'"],
              ["color", "string", "'#3b82f6'"],
              ["grid", "boolean", "true"],
              ["badge", "boolean", "true"],
              ["badgeVariant", "'default' | 'minimal'", "'default'"],
              ["badgeTail", "boolean", "true"],
              ["fill", "boolean", "true"],
              ["pulse", "boolean", "true"],
            ]}
          />

          <PropsTable
            title="Behaviour"
            rows={[
              ["momentum", "boolean | Momentum", "true"],
              ["scrub", "boolean", "true"],
              ["exaggerate", "boolean", "false"],
              ["showValue", "boolean", "false"],
              ["valueMomentumColor", "boolean", "false"],
              ["degen", "boolean | DegenOptions", "false"],
            ]}
          />

          <PropsTable
            title="Time"
            rows={[
              ["window", "number", "30"],
              ["windows", "WindowOption[]", "\u2014"],
              ["onWindowChange", "(secs: number) => void", "\u2014"],
              ["windowStyle", "'default' | 'rounded' | 'text'", "\u2014"],
            ]}
          />

          <PropsTable
            title="Tooltip"
            rows={[
              ["tooltipY", "number", "14"],
              ["tooltipOutline", "boolean", "true"],
            ]}
          />

          <PropsTable
            title="Orderbook"
            rows={[["orderbook", "OrderbookData", "\u2014"]]}
          />

          <PropsTable
            title="Advanced"
            rows={[
              ["referenceLine", "ReferenceLine", "\u2014"],
              ["formatValue", "(v: number) => string", "v.toFixed(2)"],
              ["formatTime", "(t: number) => string", "HH:MM:SS"],
              ["lerpSpeed", "number", "0.08"],
              [
                "padding",
                "Padding",
                "{ top: 12, right: 80, bottom: 28, left: 12 }",
              ],
              ["onHover", "(point: HoverPoint | null) => void", "\u2014"],
              ["cursor", "string", "'crosshair'"],
              ["className", "string", "\u2014"],
              ["style", "CSSProperties", "\u2014"],
            ]}
          />

          <Divider />

          {/* Stress testing */}
          <SectionHeading id="stress-testing">Stress testing</SectionHeading>

          <Paragraph>
            A chart that only looks good on calm data isn&apos;t much use. These
            demos throw the worst stuff I could think of at it: wild volatility,
            sharp direction changes, isolated spikes on flat lines, and irregular
            data arrival with random gaps.
          </Paragraph>

          <ChartPlaceholder height={200} />

          <Paragraph>
            Sharp reversals are the classic breaking point. The first chart
            hammers the line with frequent direction changes at 60ms. The second
            holds nearly flat, then fires massive isolated spikes. The third is
            just chaos.
          </Paragraph>

          <ChartPlaceholder height={200} />

          <Paragraph>
            Real-world data doesn&apos;t arrive at regular intervals. WebSocket
            connections drop, batch updates land all at once, mobile networks
            stall. This one simulates that: long quiet stretches of 1&ndash;3
            seconds between points, then sudden bursts at 40&ndash;80ms. The
            tick interval itself is random.
          </Paragraph>

          <ChartPlaceholder height={200} />

          <Divider />

          {/* Just a line */}
          <SectionHeading id="just-a-line">Just a line</SectionHeading>

          <Paragraph>
            Liveline can do a lot. Momentum arrows, particles, orderbooks,
            scrubbing, time windows. But at the end of the day, if you just want
            a line that moves when a number changes, it does that just fine too.
          </Paragraph>

          <ChartPlaceholder height={180} />

          <Divider />

          {/* Acknowledgements */}
          <SectionHeading id="acknowledgements">
            Acknowledgements
          </SectionHeading>

          <Paragraph>
            Built with React and HTML Canvas. Inspired by TradingView, Robinhood,
            and Polymarket chart aesthetics. The interpolation approach is
            borrowed from game development &mdash; lerp everything, snap nothing.
          </Paragraph>
        </article>
      </div>
    </div>
  );
}
