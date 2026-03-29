/**
 * Pure functions for building and flattening TocTreeNode[] from mdast headings.
 * Server-safe — no 'use client', no hooks, no browser APIs.
 * Used by both the server component (index.tsx) and client component (markdown.tsx).
 */

import type { Root, Heading, PhrasingContent } from 'mdast'

/* ── TOC tree types ──────────────────────────────────────────────────── */

export type TocNodeType = 'page' | `h${1 | 2 | 3 | 4 | 5 | 6}`
export type VisualLevel = 0 | 1 | 2 | 3

/** Recursive tree node — the source-of-truth structure before flattening.
 *  Heading depth is encoded in the type field (h2, h3, h4...) so skipped
 *  markdown levels render at the correct visual depth. */
export type TocTreeNode = {
  label: string
  href: string
  type: TocNodeType
  children: TocTreeNode[]
}

/** Flat rendering item produced by flattenTocTree(). visualLevel is clamped
 *  to 0-3 so deeply nested pages still render cleanly. */
export type FlatTocItem = {
  label: string
  href: string
  type: TocNodeType
  visualLevel: VisualLevel
  prefix: string
  parentHref: string | null
  /** Nearest ancestor page's href — used for route-aware scroll tracking. */
  pageHref: string
}

/* ── Helper functions ────────────────────────────────────────────────── */

/** Slugify heading text for anchor IDs */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}

/** Extract plain text from mdast phrasing content */
export function extractText(children: PhrasingContent[]): string {
  return children
    .map((child) => {
      if (child.type === 'text') {
        return child.value
      }
      if ('children' in child) {
        return extractText(child.children as PhrasingContent[])
      }
      return ''
    })
    .join('')
}

/** Build a nested TocTreeNode[] from mdast headings. Headings at lower
 *  depth become children of headings at higher depth, forming a tree
 *  that matches the document outline (## → ### → ####). The heading
 *  level is encoded in the type field (h2, h3, h4) so skipped levels
 *  render at the correct visual depth. */
export function generateTocTree(mdast: Root): TocTreeNode[] {
  const headings = mdast.children
    .filter((node): node is Heading => {
      return node.type === 'heading'
    })
    .map((heading) => {
      const text = extractText(heading.children)
      const id = slugify(text)
      return { label: text, href: `#${id}`, depth: heading.depth }
    })

  const result: TocTreeNode[] = []
  const stack: { node: TocTreeNode; depth: number }[] = []

  for (const h of headings) {
    const node: TocTreeNode = {
      label: h.label,
      href: h.href,
      type: `h${h.depth}` as TocNodeType,
      children: [],
    }

    /* Pop stack until we find a parent with lower depth */
    while (stack.length > 0 && stack[stack.length - 1].depth >= h.depth) {
      stack.pop()
    }

    if (stack.length === 0) {
      result.push(node)
    } else {
      stack[stack.length - 1].node.children.push(node)
    }

    stack.push({ node, depth: h.depth })
  }

  return result
}

/* ── flattenTocTree ──────────────────────────────────────────────────────
   Walks a recursive TocTreeNode[] and produces a flat FlatTocItem[] with
   visual levels clamped to 0-3 and ASCII tree prefixes. Handles arbitrary
   page nesting: when pages eat the depth budget, headings flatten to a
   single visual level (all become siblings at level 3). */

/** Extract 0-based heading depth from type: h2 → 0, h3 → 1, h4 → 2, etc.
 *  Pages return 0. This lets ## be the root heading level (no prefix). */
function headingDepthFromType(type: TocNodeType): number {
  if (type === 'page') {
    return 0
  }
  return parseInt(type.slice(1)) - 2
}

function hasNextSiblingAtLevel({ items, index, level }: { items: FlatTocItem[]; index: number; level: VisualLevel }): boolean {
  for (let i = index + 1; i < items.length; i++) {
    if (items[i].visualLevel < level) {
      return false
    }
    if (items[i].visualLevel === level) {
      return true
    }
  }
  return false
}

function addPrefixes({ items }: { items: FlatTocItem[] }) {
  const continuations: boolean[] = []

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const level = item.visualLevel

    continuations.length = Math.max(level, 0)
    const isLast = !hasNextSiblingAtLevel({ items, index: i, level })

    if (level === 0) {
      item.prefix = ''
    } else {
      const lines = continuations
        .slice(1, level)
        .map((cont) => {
          return cont ? '│ ' : '  '
        })
        .join('')
      item.prefix = lines + (isLast ? '└─ ' : '├─ ')
    }

    continuations[level] = !isLast
  }
}

export function flattenTocTree({ roots }: { roots: TocTreeNode[] }): FlatTocItem[] {
  const result: FlatTocItem[] = []

  function walk({ nodes, pageDepth, parentHref, pageHref }: {
    nodes: TocTreeNode[]
    /** Number of page ancestors above this level (used as base for heading depth). */
    pageDepth: number
    parentHref: string | null
    pageHref: string
  }) {
    for (const node of nodes) {
      /* Heading depth is derived from the type field (h2 → 0, h3 → 1, etc.).
         Pages use pageDepth directly. Skipped heading levels (## → ####)
         naturally produce the correct visual gap. */
      const rawDepth = node.type === 'page'
        ? pageDepth
        : pageDepth + headingDepthFromType(node.type)
      const visualLevel = Math.min(rawDepth, 3) as VisualLevel
      const currentPageHref = node.type === 'page' ? node.href : pageHref

      result.push({
        label: node.label,
        href: node.href,
        type: node.type,
        visualLevel,
        prefix: '',
        parentHref,
        pageHref: currentPageHref,
      })

      const childPageDepth = node.type === 'page' ? pageDepth + 1 : pageDepth
      walk({
        nodes: node.children,
        pageDepth: childPageDepth,
        parentHref: node.href,
        pageHref: currentPageHref,
      })
    }
  }

  walk({ nodes: roots, pageDepth: 0, parentHref: null, pageHref: '' })
  addPrefixes({ items: result })
  return result
}
