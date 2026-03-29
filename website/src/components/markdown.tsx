'use client'
/*
 * Editorial markdown components.
 *
 * All components use CSS variables from globals.css (no prefix).
 * Conflicting names with shadcn: --brand-primary, --brand-secondary,
 * --link-accent, --page-border.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from 'react'
import { createTocDb, searchToc, type SearchState } from './search.js'
import Prism from 'prismjs'
import 'prismjs/components/prism-jsx'
import 'prismjs/components/prism-tsx'
import 'prismjs/components/prism-bash'

/* Custom "diagram" language for ASCII/Unicode box-drawing diagrams.
   Tokenizes box-drawing chars as neutral structure, text as highlighted labels. */
Prism.languages.diagram = {
  'box-drawing': /[┌┐└┘├┤┬┴┼─│═║╔╗╚╝╠╣╦╩╬╭╮╯╰┊┈╌┄╶╴╵╷]+/,
  'line-char': /[-_|<>]+/,
  label: /[^\s┌┐└┘├┤┬┴┼─│═║╔╗╚╝╠╣╦╩╬╭╮╯╰┊┈╌┄╶╴╵╷\-_|<>]+/,
}

/* =========================================================================
   Typography primitives — reduced set after merging near-identical values.
   4 weights (regular/prose/heading/bold), 2 line-heights (heading/prose).
   Mirrors CSS variables in globals.css. Used in inline styles for type safety.
   ========================================================================= */

const WEIGHT = { regular: 400, prose: 475, heading: 560, bold: 700 } as const
const LINE_HEIGHT = { heading: 1.4, prose: 1.6 } as const
const LETTER_SPACING = { prose: '-0.09px', code: '0.01em' } as const

/** Shared prose style — body text, lists, captions. Spread and override per component. */
const proseStyle = {
  fontFamily: 'var(--font-primary)',
  fontWeight: WEIGHT.prose,
  lineHeight: LINE_HEIGHT.prose,
  letterSpacing: LETTER_SPACING.prose,
  color: 'var(--text-primary)',
  margin: 0,
} satisfies React.CSSProperties

function ChevronIcon({ expanded, style }: { expanded: boolean; style?: React.CSSProperties }) {
  return (
    <span
      style={{
        flexShrink: 0,
        alignSelf: 'center',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '4px',
        margin: '-4px',
        cursor: 'pointer',
        ...style,
      }}
    >
      <svg
        aria-hidden='true'
        viewBox='0 0 16 16'
        width='12'
        height='12'
        style={{
          transition: 'transform 0.15s ease',
          transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
        }}
      >
        <path d='M6 4l4 4-4 4' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round' />
      </svg>
    </span>
  )
}

/* =========================================================================
   TOC sidebar (fixed left)
   ========================================================================= */

export type HeadingLevel = 1 | 2 | 3

/* Multi-page TOC tree types. Pages are root nodes that contain headings or
   nested sub-pages. The recursive tree is flattened to FlatTocItem[] before
   rendering, clamping visual depth to 4 levels (0-3) so the sidebar never
   gets too wide regardless of page nesting depth. */

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

const headingTagByLevel: Record<HeadingLevel, 'h1' | 'h2' | 'h3'> = {
  1: 'h1',
  2: 'h2',
  3: 'h3',
}

const headingStyleByLevel: Record<HeadingLevel, React.CSSProperties> = {
  1: {
    fontSize: 'var(--type-heading-1-size)',
    fontWeight: WEIGHT.heading,
    lineHeight: LINE_HEIGHT.heading,
    letterSpacing: LETTER_SPACING.prose,
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    paddingTop: '24px',
    paddingBottom: '24px',
  },
  2: {
    fontSize: 'var(--type-heading-2-size)',
    fontWeight: WEIGHT.heading,
    lineHeight: LINE_HEIGHT.heading,
    letterSpacing: LETTER_SPACING.prose,
    paddingTop: '10px',
    paddingBottom: '4px',
  },
  3: {
    fontSize: 'var(--type-heading-3-size)',
    fontWeight: WEIGHT.heading,
    lineHeight: LINE_HEIGHT.heading,
    letterSpacing: LETTER_SPACING.prose,
    paddingTop: '4px',
    paddingBottom: '2px',
    color: 'var(--text-secondary)',
  },
}

/* ── flattenTocTree ──────────────────────────────────────────────────────
   Walks a recursive TocTreeNode[] and produces a flat FlatTocItem[] with
   visual levels clamped to 0-3 and ASCII tree prefixes. Handles arbitrary
   page nesting: when pages eat the depth budget, headings flatten to a
   single visual level (all become siblings at level 3). */

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
      item.prefix = lines + (isLast ? '└ ' : '├ ')
    }

    continuations[level] = !isLast
  }
}

/** Extract 0-based heading depth from type: h2 → 0, h3 → 1, h4 → 2, etc.
 *  Pages return 0. This lets ## be the root heading level (no prefix). */
function headingDepthFromType(type: TocNodeType): number {
  if (type === 'page') {
    return 0
  }
  return parseInt(type.slice(1)) - 2
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

/** Single useSyncExternalStore that handles both initial hash and scroll-based
 *  active heading tracking. A ref holds the current value, the IntersectionObserver
 *  updates it and notifies React via the subscribe callback. Server snapshot
 *  returns fallbackId to avoid hydration mismatch. Hash is read inside subscribe
 *  (not during render) to keep render pure. All callbacks are stable via useCallback. */
function useActiveTocId({
  fallbackId,
  scrollLockRef,
}: {
  fallbackId: string
  scrollLockRef: React.RefObject<boolean>
}) {
  const activeRef = useRef(fallbackId)

  const subscribe = useCallback((onStoreChange: () => void) => {
    const emit = (next: string) => {
      if (activeRef.current === next) {
        return
      }
      activeRef.current = next
      onStoreChange()
    }

    // Read hash on first subscribe to fix flash on initial paint
    const hash = window.location.hash.replace(/^#/, '')
    if (hash) {
      emit(hash)
    }

    const headings = document.querySelectorAll<HTMLElement>('[data-toc-heading="true"][id]')

    const observer = new IntersectionObserver(
      (entries) => {
        /* Skip observer updates during programmatic smooth scroll to prevent
           activeId from bouncing through intermediate headings. The lock is
           set before scrollIntoView and released on scrollend. */
        if (scrollLockRef.current) {
          return
        }
        const visible: string[] = []
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.target.id) {
            visible.push(entry.target.id)
          }
        })

        if (visible.length > 0) {
          const sorted = visible.sort((a, b) => {
            const elA = document.getElementById(a)
            const elB = document.getElementById(b)
            if (!elA || !elB) {
              return 0
            }
            return elA.getBoundingClientRect().top - elB.getBoundingClientRect().top
          })
          emit(sorted[sorted.length - 1])
        }
      },
      {
        /* -80px ≈ header-row-height; accounts for sticky header covering top of viewport */
        rootMargin: '-80px 0px -75% 0px',
        threshold: 0,
      },
    )

    headings.forEach((heading) => {
      observer.observe(heading)
    })

    return () => {
      observer.disconnect()
    }
  }, [])

  const getSnapshot = useCallback(() => {
    return activeRef.current
  }, [])

  const getServerSnapshot = useCallback(() => {
    return fallbackId
  }, [fallbackId])

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

function TocLink({
  item,
  isActive,
  chevron,
  onToggle,
  dimmed,
  isHighlighted,
  linkRef,
}: {
  item: FlatTocItem
  isActive: boolean
  chevron?: { expanded: boolean }
  onToggle?: () => void
  /** Search: dim non-matching items to opacity 0.3 */
  dimmed?: boolean
  /** Search: arrow-key highlighted item */
  isHighlighted?: boolean
  linkRef?: React.Ref<HTMLAnchorElement>
}) {
  const effectiveActive = isActive && !dimmed
  const defaultColor = effectiveActive
    ? 'var(--text-primary)'
    : dimmed
      ? 'var(--text-tertiary)'
      : 'var(--text-tree-label)'
  const defaultPrefixColor = effectiveActive ? 'var(--text-secondary)' : 'var(--text-tertiary)'
  const bg = isHighlighted ? 'var(--border-subtle)' : effectiveActive ? 'var(--border-subtle)' : 'transparent'
  const fontWeight = WEIGHT.regular
  return (
    <a
      ref={linkRef}
      href={item.href}
      className='block no-underline'
      tabIndex={dimmed ? -1 : 0}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        fontSize: 'var(--type-toc-size)',
        fontWeight,
        // marginLeft: item.prefix ? '-3px' : undefined,
        letterSpacing: 'normal',
        padding: item.visualLevel > 0 ? '4px 8px' : '2px 8px',
        color: defaultColor,
        fontFamily: 'var(--font-primary)',
        transition: 'color 0.15s ease, background-color 0.15s ease, opacity 0.15s ease',
        borderRadius: '6px',
        background: bg,
        opacity: dimmed ? 0.3 : 1,
      }}
      onMouseEnter={(e) => {
        if (!effectiveActive && !dimmed) {
          e.currentTarget.style.color = 'var(--text-primary)'
          e.currentTarget.style.background = 'var(--border-subtle)'
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = defaultColor
        e.currentTarget.style.background = bg
      }}
    >
      <span aria-hidden='true' style={{ color: defaultPrefixColor, whiteSpace: 'pre', fontFamily: 'var(--font-code)', fontSize: '1.2em', display: 'inline-flex', alignItems: 'center', margin: '-2px 0 -2px -2px' }}>
        {item.prefix}
      </span>
      <span style={{ overflowWrap: 'anywhere', fontFamily: 'var(--font-primary)', flex: 1 }}>{item.label}</span>
      {chevron && (
        <span
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onToggle?.()
          }}
        >
          <ChevronIcon
            expanded={chevron.expanded}
            style={{ color: defaultPrefixColor, marginLeft: '4px' }}
          />
        </span>
      )}
    </a>
  )
}

export function TableOfContents({ items, logo }: { items: FlatTocItem[]; logo?: string }) {
  const firstHref = items[0]?.href ?? ''
  const fallbackId = firstHref.startsWith('#') ? firstHref.slice(1) : firstHref
  const scrollLockRef = useRef(false)
  const activeId = useActiveTocId({ fallbackId, scrollLockRef })

  /* Derive which items have children (are expandable) */
  const expandableHrefs = useMemo(() => {
    return new Set(items.map((i) => { return i.parentHref }).filter(Boolean) as string[])
  }, [items])

  /* Lookup map for walking the parent chain */
  const itemByHref = useMemo(() => {
    return new Map(items.map((i) => { return [i.href, i] as const }))
  }, [items])

  // Track which items are expanded. First expandable item starts open.
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const first = items.find((i) => { return expandableHrefs.has(i.href) })
    return first ? new Set([first.href]) : new Set()
  })

  // Auto-expand the active item (if expandable) and its ancestors
  useEffect(() => {
    if (!activeId) {
      return
    }
    const activeHref = `#${activeId}`
    const toExpand: string[] = []
    // Expand the active item itself if it has children
    if (expandableHrefs.has(activeHref) && !expanded.has(activeHref)) {
      toExpand.push(activeHref)
    }
    let current = itemByHref.get(activeHref)
    while (current?.parentHref) {
      if (!expanded.has(current.parentHref)) {
        toExpand.push(current.parentHref)
      }
      current = itemByHref.get(current.parentHref)
    }
    if (toExpand.length > 0) {
      setExpanded((prev) => {
        return new Set([...prev, ...toExpand])
      })
    }
  }, [activeId, itemByHref]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (href: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(href)) {
        next.delete(href)
      } else {
        next.add(href)
      }
      return next
    })
  }

  // --- Search state ---
  // useTransition makes typing non-blocking: setQuery is urgent (input stays
  // responsive), while the TOC re-render from setSearchState is deferred and
  // interruptible — new keystrokes cancel in-progress renders automatically.
  const [query, setQuery] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const highlightedRef = useRef<HTMLAnchorElement>(null)
  const [isPending, startTransition] = useTransition()

  // Build Orama search DB once
  const db = useMemo(() => {
    return createTocDb({ items })
  }, [items])

  const [searchState, setSearchState] = useState<SearchState>({
    matchedHrefs: null,
    expandOverride: null,
    dimmedHrefs: null,
    focusableHrefs: null,
  })

  const handleQueryChange = useCallback(
    (value: string) => {
      setQuery(value)
      startTransition(() => {
        const state = searchToc({ db, query: value, items })
        setSearchState(state)
        setHighlightedIndex(0)
      })
    },
    [db, items],
  )

  // Scroll highlighted item into view (only when search is active)
  useEffect(() => {
    if (!searchState.focusableHrefs) {
      return
    }
    highlightedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [highlightedIndex, searchState.focusableHrefs])

  // Global F hotkey to focus search input
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'f' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = (e.target as HTMLElement).tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) {
          return
        }
        e.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        handleQueryChange('')
        searchInputRef.current?.blur()
        return
      }
      const focusable = searchState.focusableHrefs
      if (!focusable || focusable.length === 0) {
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlightedIndex((prev) => {
          return Math.min(prev + 1, focusable.length - 1)
        })
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlightedIndex((prev) => {
          return Math.max(prev - 1, 0)
        })
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const href = focusable[highlightedIndex]
        if (href) {
          handleQueryChange('')
          searchInputRef.current?.blur()
          window.location.hash = href
        }
      }
    },
    [searchState.focusableHrefs, highlightedIndex, handleQueryChange],
  )

  const isSearchActive = searchState.matchedHrefs !== null

  /* Merge search expand overrides into the expanded set so matched items
     inside collapsed branches become visible during search. */
  const effectiveExpanded = useMemo(() => {
    if (!isSearchActive || !searchState.expandOverride) {
      return expanded
    }
    return new Set([...expanded, ...searchState.expandOverride])
  }, [expanded, isSearchActive, searchState.expandOverride])

  /* Compute visible items: an item is visible if all its ancestors are
     effectively expanded. Since items are in document order, parents
     always come before children so a single forward pass works. */
  const visibleItems = useMemo(() => {
    const visible = new Set<string>()
    return items.filter((item) => {
      if (item.parentHref === null) {
        visible.add(item.href)
        return true
      }
      if (effectiveExpanded.has(item.parentHref) && visible.has(item.parentHref)) {
        visible.add(item.href)
        return true
      }
      return false
    })
  }, [items, effectiveExpanded])

  return (
    <aside
      style={{
        maxWidth: 'var(--grid-toc-width)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      {/* Search input with F hotkey badge — stays pinned at top */}
      <div
        style={{ paddingBottom: '12px', display: 'flex', alignItems: 'center', position: 'relative', flexShrink: 0 }}
      >
        <input
          ref={searchInputRef}
          type='text'
          value={query}
          onChange={(e) => {
            handleQueryChange(e.target.value)
          }}
          onKeyDown={handleSearchKeyDown}
          placeholder='search...'
          style={{
            width: '100%',
            padding: '2px 24px 2px 8px',
            fontSize: 'var(--type-toc-size)',
            fontFamily: 'var(--font-primary)',
            fontWeight: WEIGHT.prose,
            color: 'var(--text-primary)',
            background: 'transparent',
            border: '1px solid var(--page-border)',
            borderRadius: '6px',
            outline: 'none',
            textTransform: 'lowercase',
            letterSpacing: 'normal',
            lineHeight: LINE_HEIGHT.prose,
            transition: 'border-color 0.15s ease, opacity 0.1s ease',
            boxSizing: 'border-box',
            opacity: isPending ? 0.5 : 1,
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = 'var(--text-tertiary)'
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = 'var(--page-border)'
          }}
        />
        {/* Hotkey badge — hidden when input has text */}
        {!query && (
          <span
            aria-hidden='true'
            style={{
              position: 'absolute',
              right: '6px',
              fontFamily: 'var(--font-code)',
              fontSize: '10px',
              fontWeight: WEIGHT.regular,
              color: 'var(--text-secondary)',
              border: '1px solid var(--text-tertiary)',
              borderRadius: '4px',
              padding: '0px 4px',
              lineHeight: '16px',
              pointerEvents: 'none',
              textTransform: 'uppercase',
            }}
          >
            F
          </span>
        )}
      </div>

      <nav aria-label='Table of contents' style={{ overflowY: 'auto', minHeight: 0, paddingRight: '4px' }}>
        {visibleItems.map((item, i) => {
          const isExpandable = expandableHrefs.has(item.href)
          const isExpanded =
            expanded.has(item.href) ||
            (isSearchActive && Boolean(searchState.expandOverride?.has(item.href)))
          const isDimmed = isSearchActive && searchState.dimmedHrefs?.has(item.href)
          const highlightedHref = isSearchActive ? searchState.focusableHrefs?.[highlightedIndex] : undefined
          const isHighlighted = highlightedHref === item.href
          const fragment = item.href.includes('#') ? item.href.slice(item.href.indexOf('#')) : item.href
          return (
            <div key={item.href} style={item.visualLevel === 0 && i > 0 ? { marginTop: '6px' } : undefined}>
              <TocLink
                item={item}
                isActive={`#${activeId}` === fragment}
                chevron={isExpandable ? { expanded: isExpanded } : undefined}
                onToggle={isExpandable ? () => { toggle(item.href) } : undefined}
                dimmed={isDimmed || false}
                isHighlighted={isHighlighted}
                linkRef={isHighlighted ? highlightedRef : undefined}
              />
            </div>
          )
        })}
      </nav>
    </aside>
  )
}

/* =========================================================================
   Back button (fixed top-right)
   ========================================================================= */

export function BackButton() {
  return (
    <a
      href='/'
      className='fixed top-5 right-5 z-[100000] flex items-center justify-center w-10 h-10 rounded-full no-underline'
      style={{
        background: 'var(--btn-bg)',
        color: 'var(--text-secondary)',
        boxShadow: 'var(--btn-shadow)',
        transition: 'color 0.15s, transform 0.15s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = 'var(--text-hover)'
        e.currentTarget.style.transform = 'scale(1.05)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = 'var(--text-secondary)'
        e.currentTarget.style.transform = 'scale(1)'
      }}
      onMouseDown={(e) => {
        e.currentTarget.style.transform = 'scale(0.95)'
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = 'scale(1.05)'
      }}
    >
      <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
        <path
          d='M12.25 7H1.75M1.75 7L6.125 2.625M1.75 7L6.125 11.375'
          stroke='currentColor'
          strokeWidth='1.5'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
      </svg>
    </a>
  )
}

/* =========================================================================
   Typography
   ========================================================================= */

export function SectionHeading({
  id,
  level = 1,
  children,
}: {
  id: string
  level?: HeadingLevel
  children: React.ReactNode
}) {
  level ||= 1
  const Tag = headingTagByLevel[level] || 'h4'

  return (
    <Tag
      id={id}
      data-toc-heading='true'
      data-toc-level={level}
      style={{
        fontFamily: 'var(--font-primary)',
        color: 'var(--text-primary)',
        margin: 0,
        padding: 0,
        scrollMarginTop: 'var(--header-height)',
        ...headingStyleByLevel[level],
      }}
    >
      <span style={{ whiteSpace: level === 1 ? 'nowrap' : 'normal' }}>{children}</span>
      {level === 1 ? <span style={{ flex: 1, height: '1px', background: 'var(--divider)' }} /> : null}
    </Tag>
  )
}

export function P({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <p
      className={`editorial-prose ${className}`}
      style={{
        ...proseStyle,
        opacity: 0.82,
      }}
    >
      {children}
    </p>
  )
}

export function Caption({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        ...proseStyle,
        fontSize: 'var(--type-caption-size)',
        textAlign: 'center',
        color: 'var(--text-secondary)',
      }}
    >
      {children}
    </p>
  )
}

export function A({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target='_blank'
      rel='noopener noreferrer'
      style={{
        color: 'var(--link-accent, #0969da)',
        fontWeight: WEIGHT.heading,
        textDecoration: 'none',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.textDecoration = 'underline'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.textDecoration = 'none'
      }}
    >
      {children}
    </a>
  )
}

export function Code({ children }: { children: React.ReactNode }) {
  return <code className='inline-code'>{children}</code>
}

/* =========================================================================
   Layout
   ========================================================================= */

export function Bleed({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginLeft: 'calc(-1 * var(--bleed-image))',
        marginRight: 'calc(-1 * var(--bleed-image))',
        display: 'flex',
        justifyContent: 'center',
        maxWidth: 'calc(100% + 2 * var(--bleed-image))',
        overflow: 'hidden',
      }}
    >
      {children}
    </div>
  )
}

export function Divider() {
  return (
    <div style={{ padding: '24px 0', display: 'flex', alignItems: 'center' }}>
      <div style={{ height: '1px', background: 'var(--divider)', flex: 1 }} />
    </div>
  )
}

export function Section({
  id,
  title,
  level = 1,
  children,
}: {
  id: string
  title: string
  level?: HeadingLevel
  children: React.ReactNode
}) {
  return (
    <>
      <SectionHeading id={id} level={level}>
        {title}
      </SectionHeading>
      {children}
    </>
  )
}

export function OL({ children }: { children: React.ReactNode }) {
  return (
    <ol
      className='m-0 pl-5'
      style={{
        ...proseStyle,
        listStyleType: 'decimal',
      }}
    >
      {children}
    </ol>
  )
}

export function List({ children }: { children: React.ReactNode }) {
  return (
    <ul
      className='m-0 pl-5'
      style={{
        ...proseStyle,
        listStyleType: 'disc',
      }}
    >
      {children}
    </ul>
  )
}

export function Li({ children }: { children: React.ReactNode }) {
  return <li style={{ padding: '0 0 8px 12px' }}>{children}</li>
}

/* =========================================================================
   Code block with Prism syntax highlighting and line numbers
   ========================================================================= */

export function CodeBlock({
  children,
  lang = 'jsx',
  lineHeight = '1.85',
  showLineNumbers = true,
}: {
  children: string
  lang?: string
  lineHeight?: string
  showLineNumbers?: boolean
}) {
  const lines = children.split('\n')

  /* Use Prism.highlight() to get highlighted HTML as a string. Works on both
     server and client (no DOM dependency), avoiding hydration mismatch issues
     that occur with useEffect + highlightElement. */
  const highlightedHtml = useMemo(() => {
    const grammar = lang ? Prism.languages[lang] : undefined
    if (!grammar) {
      return undefined
    }
    return Prism.highlight(children, grammar, lang)
  }, [children, lang])

  return (
    <figure className='m-0 bleed'>
      <div className='relative'>
        <pre
          className='overflow-x-auto'
          style={{
            borderRadius: 'var(--border-radius-md)',
            margin: 0,
            padding: 0,
          }}
        >
          <div
            className='flex'
            style={{
              padding: '12px 8px 8px',
              fontFamily: 'var(--font-code)',
              fontSize: 'var(--type-code-size)',
              fontWeight: WEIGHT.regular,
              lineHeight,
              letterSpacing: 'normal',
              color: 'var(--text-primary)',
              tabSize: 2,
            }}
          >
            {showLineNumbers && (
              <span
                className='select-none shrink-0'
                aria-hidden='true'
                style={{
                  color: 'var(--code-line-nr)',
                  textAlign: 'right',
                  paddingRight: '20px',
                  width: '36px',
                  userSelect: 'none',
                }}
              >
                {lines.map((_, i) => {
                  return (
                    <span key={i} className='block'>
                      {i + 1}
                    </span>
                  )
                })}
              </span>
            )}
            {highlightedHtml ? (
              <code
                className={lang ? `language-${lang}` : undefined}
                style={{ whiteSpace: 'pre', background: 'none', padding: 0, lineHeight }}
                dangerouslySetInnerHTML={{ __html: highlightedHtml }}
              />
            ) : (
              <code
                className={lang ? `language-${lang}` : undefined}
                style={{ whiteSpace: 'pre', background: 'none', padding: 0, lineHeight }}
              >
                {children}
              </code>
            )}
          </div>
        </pre>
      </div>
    </figure>
  )
}

/* =========================================================================
   Pixelated placeholder image
   Uses a tiny pre-generated image with CSS image-rendering: pixelated
   (nearest-neighbor / point sampling in GPU terms) for a crisp mosaic
   effect. The real image fades in on top once loaded — no flash because
   the placeholder stays underneath and the real image starts at opacity 0.
   ========================================================================= */

export function PixelatedImage({
  src,
  placeholder,
  alt,
  width,
  height,
  className = '',
  style,
}: {
  src: string
  /**
   * URL of the tiny pixelated placeholder image. Use a static import so Vite
   * inlines it as a base64 data URI (all placeholders are < 4KB, well under
   * Vite's default assetsInlineLimit of 4096 bytes). This makes the
   * placeholder available synchronously on first render with zero HTTP
   * requests. Do NOT use dynamic imports or public/ paths — dynamic imports
   * add a microtask delay, and public/ files bypass Vite's asset pipeline.
   *
   * @example
   * ```tsx
   * import placeholderScreenshot from "../assets/placeholders/placeholder-screenshot@2x.png";
   * <PixelatedImage placeholder={placeholderScreenshot} src="/screenshot@2x.png" ... />
   * ```
   */
  placeholder?: string
  alt: string
  width: number
  height: number
  className?: string
  style?: React.CSSProperties
}) {
  const [loaded, setLoaded] = useState(false)

  // Handles both the normal onLoad event and the case where the image is
  // already cached (img.complete is true before React mounts the handler).
  const imgRef = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth > 0) {
      setLoaded(true)
    }
  }, [])

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: `min(${width}px, 100%)`,
        aspectRatio: `${width} / ${height}`,
        overflow: 'hidden',
        ...style,
      }}
    >
      {/* Placeholder: tiny image rendered with nearest-neighbor sampling */}
      {placeholder && (
        <img
          src={placeholder}
          alt=''
          aria-hidden
          width={width}
          height={height}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            imageRendering: 'pixelated',
            zIndex: 0,
          }}
        />
      )}
      {/* Real image: starts invisible, fades in over the placeholder */}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        width={width}
        height={height}
        onLoad={() => {
          setLoaded(true)
        }}
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          opacity: !placeholder || loaded ? 1 : 0,
          transition: 'opacity 0.4s ease',
          zIndex: 1,
        }}
      />
    </div>
  )
}

/* =========================================================================
   Lazy video with pixelated poster placeholder
   Same visual pattern as PixelatedImage but for <video> elements.
   Poster layers (pixelated → real) show through the transparent video element.
   Video uses native loading="lazy" + preload="none" so zero bytes are
   downloaded until the element is near the viewport and the user clicks play.
   No custom IntersectionObserver needed — all native HTML attributes.
   ========================================================================= */

export function LazyVideo({
  src,
  poster,
  placeholderPoster,
  width,
  height,
  type = 'video/mp4',
  className = '',
  style,
}: {
  src: string
  poster: string
  /**
   * URL of the tiny pixelated poster placeholder. Use a static import so Vite
   * inlines it as a base64 data URI (all placeholders are < 4KB, well under
   * Vite's default assetsInlineLimit of 4096 bytes). This makes the
   * placeholder available synchronously on first render with zero HTTP
   * requests. Do NOT use dynamic imports or public/ paths — dynamic imports
   * add a microtask delay, and public/ files bypass Vite's asset pipeline.
   *
   * @example
   * ```tsx
   * import placeholderPoster from "../assets/placeholders/placeholder-demo-poster.png";
   * <LazyVideo placeholderPoster={placeholderPoster} poster="/demo-poster.png" ... />
   * ```
   */
  placeholderPoster: string
  width: number
  height: number
  type?: string
  className?: string
  style?: React.CSSProperties
}) {
  const [posterLoaded, setPosterLoaded] = useState(false)

  // Handles cached poster images (same pattern as PixelatedImage)
  const posterRef = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth > 0) {
      setPosterLoaded(true)
    }
  }, [])

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: `${width}px`,
        aspectRatio: `${width} / ${height}`,
        overflow: 'hidden',
        ...style,
      }}
    >
      {/* Pixelated poster placeholder: loads instantly (~500 bytes) */}
      <img
        src={placeholderPoster}
        alt=''
        aria-hidden
        width={width}
        height={height}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          imageRendering: 'pixelated',
          zIndex: 0,
        }}
      />
      {/* Real poster: fades in over the pixelated placeholder */}
      <img
        ref={posterRef}
        src={poster}
        alt=''
        aria-hidden
        width={width}
        height={height}
        onLoad={() => {
          setPosterLoaded(true)
        }}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          opacity: posterLoaded ? 1 : 0,
          transition: 'opacity 0.4s ease',
          zIndex: 1,
        }}
      />
      {/* Video: transparent until playing, native lazy + no preload.
          Controls float on top of poster layers. No poster attr needed
          because the img layers handle the visual placeholder.
          loading="lazy" is a newer HTML attr not yet in React's TS types. */}
      <video
        controls
        preload='none'
        {...({ loading: 'lazy' } as React.VideoHTMLAttributes<HTMLVideoElement>)}
        width={width}
        height={height}
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          zIndex: 2,
          background: 'transparent',
        }}
      >
        <source src={src} type={type} />
      </video>
    </div>
  )
}

/* =========================================================================
   Chart placeholder (dark box with animated line)
   ========================================================================= */

export function ChartPlaceholder({ height = 200, label }: { height?: number; label?: string }) {
  return (
    <div className='bleed'>
      <div
        className='w-full overflow-hidden relative'
        style={{
          height: `${height}px`,
          background: 'rgb(17, 17, 17)',
        }}
      >
        <svg viewBox='0 0 550 200' className='absolute inset-0 w-full h-full' preserveAspectRatio='none'>
          <defs>
            <linearGradient id='chartFill' x1='0' y1='0' x2='0' y2='1'>
              <stop offset='0%' stopColor='#3b82f6' stopOpacity='0.3' />
              <stop offset='100%' stopColor='#3b82f6' stopOpacity='0' />
            </linearGradient>
          </defs>
          <path
            d='M0,140 C30,135 60,120 90,125 C120,130 150,100 180,95 C210,90 240,110 270,105 C300,100 330,80 360,85 C390,90 420,70 450,65 C480,60 510,75 550,60'
            fill='none'
            stroke='#3b82f6'
            strokeWidth='2'
          />
          <path
            d='M0,140 C30,135 60,120 90,125 C120,130 150,100 180,95 C210,90 240,110 270,105 C300,100 330,80 360,85 C390,90 420,70 450,65 C480,60 510,75 550,60 L550,200 L0,200 Z'
            fill='url(#chartFill)'
          />
          <circle cx='550' cy='60' r='4' fill='#3b82f6'>
            <animate attributeName='r' values='4;6;4' dur='2s' repeatCount='indefinite' />
            <animate attributeName='opacity' values='1;0.6;1' dur='2s' repeatCount='indefinite' />
          </circle>
        </svg>
        {label && (
          <div
            className='absolute top-3 right-3 px-2 py-1 rounded text-xs'
            style={{
              background: 'rgba(59, 130, 246, 0.15)',
              color: '#3b82f6',
              fontFamily: 'var(--font-code)',
              fontWeight: WEIGHT.prose,
              fontSize: 'var(--type-table-size)',
            }}
          >
            {label}
          </div>
        )}
      </div>
    </div>
  )
}

/* =========================================================================
   Comparison table
   ========================================================================= */

export function ComparisonTable({
  title,
  headers,
  rows,
}: {
  title?: string
  headers: [string, string, string]
  rows: Array<[string, string, string]>
}) {
  return (
    <div className='w-full max-w-full overflow-x-auto' style={{ padding: '8px 0' }}>
      {title && (
        <div
          style={{
            fontFamily: 'var(--font-primary)',
            fontSize: 'var(--type-table-size)',
            fontWeight: WEIGHT.regular,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: LETTER_SPACING.code,
            padding: '0 0 6px',
          }}
        >
          {title}
        </div>
      )}
      <table
        className='w-full'
        style={{
          borderSpacing: 0,
          borderCollapse: 'collapse',
        }}
      >
        <thead>
          <tr>
            {headers.map((header) => {
              return (
                <th
                  key={header}
                  className='text-left'
                  style={{
                    padding: '4px 12px 4px 0',
                    fontSize: 'var(--type-table-size)',
                    fontWeight: WEIGHT.regular,
                    fontFamily: 'var(--font-primary)',
                    color: 'var(--text-muted)',
                    borderBottom: '1px solid var(--page-border)',
                  }}
                >
                  {header}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map(([feature, them, us]) => {
            return (
              <tr key={feature}>
                <td
                  style={{
                    padding: '4px 12px 4px 0',
                    fontSize: 'var(--type-table-size)',
                    fontWeight: WEIGHT.prose,
                    fontFamily: 'var(--font-code)',
                    color: 'var(--text-primary)',
                    borderBottom: '1px solid var(--page-border)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {feature}
                </td>
                <td
                  style={{
                    padding: '4px 12px 4px 0',
                    fontSize: 'var(--type-table-size)',
                    fontWeight: WEIGHT.prose,
                    fontFamily: 'var(--font-code)',
                    color: 'var(--text-primary)',
                    borderBottom: '1px solid var(--page-border)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {them}
                </td>
                <td
                  style={{
                    padding: '4px 12px 4px 0',
                    fontSize: 'var(--type-table-size)',
                    fontWeight: WEIGHT.prose,
                    fontFamily: 'var(--font-code)',
                    color: 'var(--text-primary)',
                    borderBottom: '1px solid var(--page-border)',
                  }}
                >
                  {us}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* =========================================================================
   Tab bar — Mintlify/Notion-style top navigation tabs
   Active tab has 1.5px bottom indicator + faux bold via text-shadow.
   ========================================================================= */

export type TabItem = {
  label: string
  href: string
}

/* =========================================================================
   Aside — MDX component for right-sidebar content.
   On desktop, extracted from content flow and rendered in grid column 5
   via SectionRow. On mobile, renders inline as a styled callout.
   ========================================================================= */

/** Aside is a marker component for MDX. On desktop, its children are extracted
 *  by the section grouping logic and rendered in the right sidebar slot.
 *  On mobile, SectionRow renders it inline. The component itself is a pass-through. */
export function Aside({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

/** FullWidth is a marker component for MDX. Its children become a section that
 *  spans both the content and aside columns in the grid layout. */
export function FullWidth({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

/* =========================================================================
   Hero — MDX component for page-level hero content (logo, heading, etc.).
   Extracted at parse time (like <Aside>) and rendered above the 3-column
   grid, aligned with the center content column. Shifts sidebars and main
   content below it. Accepts arbitrary props from MDX for future extensibility.
   ========================================================================= */

export function Hero({ children, ...props }: { children: React.ReactNode } & React.ComponentPropsWithoutRef<'div'>) {
  return <div {...props}>{children}</div>
}

/* =========================================================================
   SectionRow — renders one content section as a grid row.
   Content goes in column 3, aside in column 5 (sticky).
   ========================================================================= */

export function SectionRow({ content, aside }: { content: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className='contents lg:grid lg:grid-cols-subgrid lg:col-[2/-1]'>
      <div className='slot-main flex flex-col gap-5 lg:col-[1] lg:overflow-visible text-(length:--type-body-size)'>{content}</div>
      {aside && (
        <div className='flex flex-col gap-3 my-2 p-3 rounded-(--border-radius-md) border border-(--border-subtle) text-(length:--type-toc-size) leading-[1.5] text-(color:--text-tree-label) lg:col-[2] lg:sticky lg:top-(--sticky-top) lg:self-start lg:max-h-[calc(100vh-var(--header-height))] lg:overflow-y-auto lg:my-0'>
          {aside}
        </div>
      )}
    </div>
  )
}

/* =========================================================================
   Sidebar banner — Seline-style CTA card for the right gutter.
   Tinted background, short text, full-width button, optional corner image.
   ========================================================================= */

export function SidebarBanner({
  text,
  buttonLabel,
  buttonHref,
  imageUrl,
}: {
  text: React.ReactNode
  buttonLabel: string
  buttonHref: string
  imageUrl?: string
}) {
  return (
    <div
      style={{
        position: 'relative',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--border-radius-md)',
        padding: '10px',
        fontSize: 'var(--type-toc-size)',
        fontWeight: WEIGHT.prose,
        lineHeight: LINE_HEIGHT.heading,
        color: 'var(--text-tree-label)',
        overflow: 'visible',
      }}
    >
      {text}
      <a
        href={buttonHref}
        className='no-underline'
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '32px',
          marginTop: '8px',
          borderRadius: 'var(--border-radius-md)',
          fontSize: 'var(--type-toc-size)',
          fontWeight: WEIGHT.prose,
          backgroundColor: 'var(--text-primary)',
          color: 'var(--bg)',
          textDecoration: 'none',
          position: 'relative',
          zIndex: 2,
          transition: 'opacity 0.15s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.opacity = '0.85'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.opacity = '1'
        }}
      >
        {buttonLabel}
      </a>
      {imageUrl && (
        <img
          src={imageUrl}
          alt=''
          width={144}
          height={144}
          style={{
            position: 'absolute',
            zIndex: 1,
            top: '-32px',
            right: '-32px',
            height: '120px',
            width: 'auto',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  )
}

function TabLink({ tab, isActive }: { tab: TabItem; isActive: boolean }) {
  const isExternal = tab.href.startsWith('http')
  return (
    <a
      href={tab.href}
      {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className='slot-tab no-underline text-(length:--type-toc-size) font-[475] [font-family:var(--font-primary)] lowercase transition-colors duration-150'
      style={{
        color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
        textShadow: isActive ? '-0.2px 0 0 currentColor, 0.2px 0 0 currentColor' : 'none',
      }}
      onMouseEnter={(e) => {
        if (!isActive) {
          e.currentTarget.style.color = 'var(--text-primary)'
          const indicator = e.currentTarget.querySelector<HTMLElement>('[data-tab-indicator]')
          if (indicator) {
            indicator.style.backgroundColor = 'var(--text-tertiary)'
          }
        }
      }}
      onMouseLeave={(e) => {
        if (!isActive) {
          e.currentTarget.style.color = 'var(--text-secondary)'
          const indicator = e.currentTarget.querySelector<HTMLElement>('[data-tab-indicator]')
          if (indicator) {
            indicator.style.backgroundColor = 'transparent'
          }
        }
      }}
    >
      {tab.label}
      <div
        data-tab-indicator
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: '100%',
          height: '1.5px',
          backgroundColor: isActive ? 'var(--text-primary)' : 'transparent',
          borderRadius: '1px',
          transition: 'background-color 0.15s ease',
        }}
      />
    </a>
  )
}

/* =========================================================================
   Page shell — CSS grid layout with named areas.

   Desktop (lg+):
     "tabs    tabs   ."
     "toc     content ."

   Mobile:
     "tabs"
     "content"

   The grid centers the content column. The TOC column is sticky.
   ========================================================================= */

export type HeaderLink = {
  href: string
  label: string
  icon: React.ReactNode
}

export type EditorialSection = {
  content: React.ReactNode
  aside?: React.ReactNode
  fullWidth?: boolean
}

export function EditorialPage({
  toc,
  logo,
  tabs,
  activeTab,
  sidebar,
  headerLinks,
  children,
  sections,
  hero,
}: {
  toc: FlatTocItem[]
  logo?: string
  tabs?: TabItem[]
  activeTab?: string
  sidebar?: React.ReactNode
  headerLinks?: HeaderLink[]
  children?: React.ReactNode
  /** When provided, renders section rows with aside support instead of flat children */
  sections?: EditorialSection[]
  /** Page-level hero content rendered above the 3-column grid, aligned with center column. */
  hero?: React.ReactNode
}) {
  const hasTabBar = tabs && tabs.length > 0

  return (
    <div
      className='slot-page flex flex-col gap-(--layout-gap) min-h-screen bg-(--bg) text-(color:--text-primary) [font-family:var(--font-primary)] antialiased [text-rendering:optimizeLegibility]'
      style={{
        WebkitFontSmoothing: 'antialiased',
      }}
    >
      {/* Header + Tab bar: full-width, sticky at top */}
      <div className='slot-navbar'>
        {/* Top row: logo + right links */}
        <div className='mx-auto flex items-center justify-between px-(--mobile-padding) py-(--header-padding-y) lg:max-w-(--grid-max-width) lg:px-0'>
          <a href='/' className='slot-logo no-underline flex items-center'>
            {logo ? (
              <div
                role='img'
                aria-label='playwriter'
                style={{
                  height: 'var(--logo-height)',
                  /* aspect ratio from SVG viewBox: 730/201 ≈ 3.63 */
                  aspectRatio: '730 / 201',
                  backgroundColor: 'var(--logo-color)',
                  maskImage: `url(${logo})`,
                  maskSize: 'contain',
                  maskRepeat: 'no-repeat',
                  WebkitMaskImage: `url(${logo})`,
                  WebkitMaskSize: 'contain',
                  WebkitMaskRepeat: 'no-repeat',
                }}
              />
            ) : (
              <span className='text-[15px] font-bold [font-family:var(--font-code)] lowercase tracking-[-0.01em]'>
                index
              </span>
            )}
          </a>
          <div className='flex items-center gap-4'>
            {/* Icon links */}
            {headerLinks && headerLinks.length > 0 && (
              <div className='flex items-center gap-3'>
                {headerLinks.map((link) => {
                  return (
                    <a
                      key={link.href}
                      href={link.href}
                      target='_blank'
                      rel='noopener noreferrer'
                      aria-label={link.label}
                      className='no-underline flex items-center text-(color:--text-secondary) transition-colors duration-150 hover:text-(color:--text-primary)'
                    >
                      {link.icon}
                    </a>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Tab row */}
        {hasTabBar && (
          <div className='slot-tabbar'>
            <div className='mx-auto flex h-(--tab-bar-height) max-w-full items-stretch gap-6 overflow-x-auto px-(--mobile-padding) lg:max-w-(--grid-max-width) lg:px-0'>
              {tabs.map((tab) => {
                return <TabLink key={tab.href} tab={tab} isActive={tab.href === (activeTab ?? tabs[0].href)} />
              })}
            </div>
          </div>
        )}
      </div>

      {/* Hero: rendered above the 3-column grid, using the same column widths
          so hero content aligns with the center content column (col 2). */}
      {hero && (
        <div className='mx-auto max-w-full px-(--mobile-padding) lg:grid lg:grid-cols-[var(--grid-toc-width)_var(--grid-content-width)_var(--grid-sidebar-width)] lg:gap-x-(--grid-gap) lg:max-w-(--grid-max-width) lg:px-0'>
          <div className='lg:col-start-2'>{hero}</div>
        </div>
      )}

      <div className='grid grid-cols-1 max-w-full mx-auto px-(--mobile-padding) lg:grid-cols-[var(--grid-toc-width)_var(--grid-content-width)_var(--grid-sidebar-width)] lg:gap-x-(--grid-gap) lg:max-w-(--grid-max-width) lg:px-0'>
        {/* TOC sidebar: sticky within its grid cell */}
        <div className='slot-sidebar-left'>
          <div
            style={{
              position: 'sticky',
              top: hasTabBar ? 'var(--sticky-top)' : '0px',
              maxHeight: hasTabBar ? 'calc(100vh - var(--sticky-top))' : '100vh',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <TableOfContents items={toc} logo={logo} />
          </div>
        </div>

        {sections ? (
          <>
            {/* Section-based layout: each section is a subgrid row with
                content in column 3 and optional aside in column 5 (sticky). */}
            <div className='contents lg:grid lg:grid-cols-subgrid lg:col-[2/-1]'>
              <div className='slot-main flex flex-col gap-5 lg:col-[1] lg:overflow-visible text-(length:--type-body-size)'></div>
            </div>
            {sections.map((section, i) => {
              if (section.fullWidth) {
                return (
                  <div key={i} className='lg:col-[2/-1] text-(length:--type-body-size) my-5'>
                    <div className='flex flex-col gap-5'>{section.content}</div>
                  </div>
                )
              }
              return <SectionRow key={i} content={section.content} aside={section.aside} />
            })}
          </>
        ) : (
          <>
            {/* Flat layout: single article column + optional static sidebar */}
            <div className='slot-main pb-24 lg:col-[2] text-(length:--type-body-size)'>
              <article className='flex flex-col gap-[20px]'>{children}</article>
            </div>

            <div className='slot-sidebar-right'>
              <div
                style={{
                  position: 'sticky',
                  top: hasTabBar ? 'var(--sticky-top)' : '12px',
                  paddingTop: '4px',
                }}
              >
                {sidebar}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
