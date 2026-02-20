/*
 * Editorial markdown components for the liveline-style pages.
 * Extracted from liveline.tsx so page files are content-only.
 *
 * All components use CSS variables from liveline.css (--ll-*).
 * Import liveline.css and liveline-prism.css in the page file.
 */

import { useEffect, useRef, useState } from "react";
import Prism from "prismjs";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-bash";

/* =========================================================================
   TOC sidebar (fixed left)
   ========================================================================= */

function useActiveTocId() {
  const [activeId, setActiveId] = useState("");

  useEffect(() => {
    const headings = document.querySelectorAll<HTMLElement>("h1[id]");
    if (headings.length === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible: string[] = [];
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.target.id) {
            visible.push(entry.target.id);
          }
        });

        if (visible.length > 0) {
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

export function TableOfContents({
  items,
  logo,
}: {
  items: Array<{ label: string; href: string }>;
  logo?: string;
}) {
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
          {logo ?? "index"}
        </a>
        {items.map((item) => {
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
                padding: "5px 0",
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

export function BackButton() {
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
   Typography
   ========================================================================= */

export function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
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
        display: "flex",
        alignItems: "center",
        gap: "12px",
        paddingTop: "24px",
        paddingBottom: "24px",
      }}
    >
      <span style={{ whiteSpace: "nowrap" }}>{children}</span>
      <span style={{ flex: 1, height: "1px", background: "var(--ll-divider)" }} />
    </h1>
  );
}

export function P({ children, className = "" }: { children: React.ReactNode; className?: string }) {
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

export function Caption({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontFamily: "var(--ll-font-primary)",
        fontSize: "12px",
        fontWeight: 475,
        textAlign: "center",
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

export function A({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        color: "var(--ll-accent, #0969da)",
        fontWeight: 600,
        textDecoration: "none",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.textDecoration = "underline";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.textDecoration = "none";
      }}
    >
      {children}
    </a>
  );
}

export function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="ll-inline-code">
      {children}
    </code>
  );
}

/* =========================================================================
   Layout
   ========================================================================= */

export function Divider() {
  return (
    <div style={{ padding: "24px 0", display: "flex", alignItems: "center" }}>
      <div style={{ height: "1px", background: "var(--ll-divider)", flex: 1 }} />
    </div>
  );
}

export function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <>
      <SectionHeading id={id}>{title}</SectionHeading>
      {children}
    </>
  );
}

export function OL({ children }: { children: React.ReactNode }) {
  return (
    <ol
      className="m-0 pl-5"
      style={{
        fontFamily: "var(--ll-font-primary)",
        fontSize: "14px",
        fontWeight: 475,
        lineHeight: "20px",
        letterSpacing: "-0.09px",
        color: "var(--ll-text-primary)",
        listStyleType: "decimal",
      }}
    >
      {children}
    </ol>
  );
}

export function List({ children }: { children: React.ReactNode }) {
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

export function Li({ children }: { children: React.ReactNode }) {
  return <li style={{ padding: "0 0 8px 12px" }}>{children}</li>;
}

/* =========================================================================
   Code block with Prism syntax highlighting and line numbers
   ========================================================================= */

export function CodeBlock({ children, lang = "jsx" }: { children: string; lang?: string }) {
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

/* =========================================================================
   Chart placeholder (dark box with animated line)
   ========================================================================= */

export function ChartPlaceholder({ height = 200, label }: { height?: number; label?: string }) {
  return (
    <div className="ll-bleed">
      <div
        className="w-full overflow-hidden relative"
        style={{
          height: `${height}px`,
          background: "rgb(17, 17, 17)",
        }}
      >
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
          <circle cx="550" cy="60" r="4" fill="#3b82f6">
            <animate attributeName="r" values="4;6;4" dur="2s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="1;0.6;1" dur="2s" repeatCount="indefinite" />
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

/* =========================================================================
   Comparison table
   ========================================================================= */

export function PropsTable({
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
   Page shell — wraps content with layout, TOC, back button, animations
   ========================================================================= */

export function EditorialPage({
  toc,
  logo,
  children,
}: {
  toc: Array<{ label: string; href: string }>;
  logo?: string;
  children: React.ReactNode;
}) {
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
      <TableOfContents items={toc} logo={logo} />

      <div
        className="mx-auto"
        style={{ width: "550px", maxWidth: "calc(100% - 2rem)", padding: "0 1rem 6rem" }}
      >
        <div style={{ height: "80px" }} />

        <article className="liveline-article flex flex-col gap-[32px]">
          {children}
        </article>
      </div>
    </div>
  );
}
