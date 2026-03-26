/*
 * Editorial markdown components.
 *
 * All components use CSS variables from globals.css (no prefix).
 * Conflicting names with shadcn: --brand-primary, --brand-secondary,
 * --link-accent, --page-border.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Prism from 'prismjs'
import 'prismjs/components/prism-jsx'
import 'prismjs/components/prism-tsx'
import 'prismjs/components/prism-bash'

/* Custom "diagram" language for ASCII/Unicode box-drawing diagrams.
   Tokenizes box-drawing chars as neutral structure, text as highlighted labels. */
Prism.languages.diagram = {
  'box-drawing': /[┌┐└┘├┤┬┴┼─│═║╔╗╚╝╠╣╦╩╬╭╮╯╰┊┈╌┄╶╴╵╷]+/,
  'line-char': /[-_|<>]+/,
  'label': /[^\s┌┐└┘├┤┬┴┼─│═║╔╗╚╝╠╣╦╩╬╭╮╯╰┊┈╌┄╶╴╵╷\-_|<>]+/,
}

/* =========================================================================
   TOC sidebar (fixed left)
   ========================================================================= */

export type HeadingLevel = 1 | 2 | 3

export type TocItem = {
  label: string
  href: string
  level?: HeadingLevel
}

type PreparedTocItem = TocItem & {
  level: HeadingLevel
  prefix: string
}

const headingTagByLevel: Record<HeadingLevel, 'h1' | 'h2' | 'h3'> = {
  1: 'h1',
  2: 'h2',
  3: 'h3',
}

const headingStyleByLevel: Record<HeadingLevel, React.CSSProperties> = {
  1: {
    fontSize: 'var(--type-heading-1-size)',
    fontWeight: 560,
    lineHeight: 1.4,
    letterSpacing: '-0.09px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    paddingTop: '24px',
    paddingBottom: '24px',
  },
  2: {
    fontSize: 'var(--type-heading-2-size)',
    fontWeight: 560,
    lineHeight: 1.43,
    letterSpacing: '-0.06px',
    paddingTop: '10px',
    paddingBottom: '4px',
  },
  3: {
    fontSize: 'var(--type-heading-3-size)',
    fontWeight: 540,
    lineHeight: 1.38,
    letterSpacing: '-0.03px',
    paddingTop: '4px',
    paddingBottom: '2px',
    color: 'var(--text-secondary)',
  },
}

const tocLineHeightByLevel: Record<HeadingLevel, number> = {
  1: 1.6,
  2: 1.6,
  3: 1.6,
}

function getTocLevel({ item }: { item: TocItem }): HeadingLevel {
  return item.level ?? 1
}

function hasNextTocSibling({ items, index, level }: { items: TocItem[]; index: number; level: HeadingLevel }) {
  const nextSiblingLevel = items
    .slice(index + 1)
    .map((item) => {
      return getTocLevel({ item })
    })
    .find((nextLevel) => {
      return nextLevel <= level
    })

  return nextSiblingLevel === level
}

function prepareTocItems({ items }: { items: TocItem[] }): PreparedTocItem[] {
  const ancestorContinuations: boolean[] = []

  return items.map((item, index) => {
    const level = getTocLevel({ item })
    ancestorContinuations.length = Math.max(level - 1, 0)
    const isLast = !hasNextTocSibling({ items, index, level })

    // Root items (level 1) get no tree prefix, only nested items do
    const prefix = level === 1
      ? ''
      : `${ancestorContinuations
          .slice(1, Math.max(level - 1, 0))
          .map((shouldContinue) => {
            return shouldContinue ? '│  ' : '   '
          })
          .join('')}${isLast ? '└─ ' : '├─ '}`

    ancestorContinuations[level - 1] = !isLast

    return {
      ...item,
      level,
      prefix,
    }
  })
}

function useActiveTocId({ defaultId }: { defaultId: string }) {
  const [activeId, setActiveId] = useState(defaultId)

  useEffect(() => {
    const headings = document.querySelectorAll<HTMLElement>('[data-toc-heading="true"][id]')
    if (headings.length === 0) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
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
          setActiveId(sorted[sorted.length - 1])
        }
      },
      {
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

  return activeId
}

type TocGroup = {
  parent: PreparedTocItem
  children: PreparedTocItem[]
}

function TocLink({
  item,
  isActive,
  activeId,
  chevron,
}: {
  item: PreparedTocItem
  isActive: boolean
  activeId: string
  chevron?: { expanded: boolean }
}) {
  const defaultColor = isActive ? 'var(--text-primary)' : 'var(--text-tree-label)'
  const defaultPrefixColor = isActive ? 'var(--text-secondary)' : 'var(--text-tertiary)'
  return (
    <a
      href={item.href}
      className='block no-underline'
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        fontSize: 'var(--type-toc-size)',
        fontWeight: item.level === 1 ? 560 : 470,
        lineHeight: tocLineHeightByLevel[item.level],
        letterSpacing: 'normal',
        padding: '2px 8px',
        color: defaultColor,
        fontFamily: 'var(--font-primary)',
        transition: 'color 0.15s ease, background-color 0.15s ease',
        borderRadius: '6px',
        background: isActive ? 'var(--code-bg)' : 'transparent',
        textTransform: 'lowercase',
      }}
      onMouseEnter={(e) => {
        if (!isActive) {
          e.currentTarget.style.color = 'var(--text-primary)'
          e.currentTarget.style.background = 'var(--code-bg)'
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = defaultColor
        e.currentTarget.style.background = isActive ? 'var(--code-bg)' : 'transparent'
      }}
    >
      <span
        aria-hidden='true'
        style={{ color: defaultPrefixColor, whiteSpace: 'pre', fontFamily: 'var(--font-code)' }}
      >
        {item.prefix}
      </span>
      <span style={{ overflowWrap: 'anywhere', fontFamily: 'var(--font-primary)', flex: 1 }}>{item.label}</span>

    </a>
  )
}

export function TableOfContents({ items, logo }: { items: TocItem[]; logo?: string }) {
  // Default active to first item
  const firstHref = items[0]?.href ?? ''
  const defaultId = firstHref.startsWith('#') ? firstHref.slice(1) : firstHref
  const activeId = useActiveTocId({ defaultId })

  const preparedItems = useMemo(() => {
    return prepareTocItems({ items })
  }, [items])

  // Group items into { parent, children }[] for structured rendering
  const groups = useMemo(() => {
    const result: TocGroup[] = []
    for (const item of preparedItems) {
      if (item.level === 1) {
        result.push({ parent: item, children: [] })
      } else if (result.length > 0) {
        result[result.length - 1].children.push(item)
      }
    }
    return result
  }, [preparedItems])

  // Track which sections are expanded. First section with children starts open.
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => {
    const first = groups.find((g) => {
      return g.children.length > 0
    })
    return first ? new Set([first.parent.href]) : new Set()
  })

  // Auto-expand the section containing the active heading on scroll
  useEffect(() => {
    if (!activeId) {
      return
    }
    const activeHref = `#${activeId}`
    let currentParent: string | null = null
    for (const item of preparedItems) {
      if (item.level === 1) {
        currentParent = item.href
      }
      if (item.href === activeHref && currentParent && !expandedSections.has(currentParent)) {
        setExpandedSections((prev) => {
          return new Set([...prev, currentParent!])
        })
        break
      }
    }
  }, [activeId, preparedItems]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleSection = (href: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(href)) {
        next.delete(href)
      } else {
        next.add(href)
      }
      return next
    })
  }

  return (
    <aside style={{ width: 'fit-content', maxWidth: '210px' }}>

      <nav aria-label='Table of contents'>
        {groups.map((group, groupIndex) => {
          const isExpanded = expandedSections.has(group.parent.href)
          const hasChildren = group.children.length > 0
          return (
            <div key={group.parent.href}>
              <div
                onClick={hasChildren ? () => { toggleSection(group.parent.href) } : undefined}
                style={{ cursor: hasChildren ? 'pointer' : undefined }}
              >
                <TocLink
                  item={group.parent}
                  isActive={`#${activeId}` === group.parent.href}
                  activeId={activeId}
                  chevron={hasChildren ? { expanded: isExpanded } : undefined}
                />
              </div>
              {hasChildren && isExpanded && (
                <div
                  className='toc-children-container'
                  style={{
                    viewTransitionName: `toc-section-${groupIndex}`,
                  }}
                >
                  {group.children.map((child) => {
                    return (
                      <TocLink
                        key={child.href}
                        item={child}
                        isActive={`#${activeId}` === child.href}
                        activeId={activeId}
                      />
                    )
                  })}
                </div>
              )}
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
  const Tag = headingTagByLevel[level]

  return (
    <Tag
      id={id}
      data-toc-heading='true'
      data-toc-level={level}
      className='scroll-mt-[5.25rem]'
      style={{
        fontFamily: 'var(--font-primary)',
        color: 'var(--text-primary)',
        margin: 0,
        padding: 0,
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
        fontFamily: 'var(--font-primary)',
        fontSize: 'var(--type-body-size)',
        fontWeight: 475,
        lineHeight: 1.6,
        letterSpacing: '-0.09px',
        color: 'var(--text-primary)',
        opacity: 0.82,
        margin: 0,
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
        fontFamily: 'var(--font-primary)',
        fontSize: 'var(--type-caption-size)',
        fontWeight: 475,
        textAlign: 'center',
        lineHeight: 1.6,
        letterSpacing: '-0.09px',
        color: 'var(--text-secondary)',
        margin: 0,
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
        fontWeight: 600,
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
        fontFamily: 'var(--font-primary)',
        fontSize: 'var(--type-body-size)',
        fontWeight: 475,
        lineHeight: 1.6,
        letterSpacing: '-0.09px',
        color: 'var(--text-primary)',
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
        fontFamily: 'var(--font-primary)',
        fontSize: 'var(--type-body-size)',
        fontWeight: 475,
        lineHeight: 1.6,
        letterSpacing: '-0.09px',
        color: 'var(--text-primary)',
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
            borderRadius: '8px',
            margin: 0,
            padding: 0,
          }}
        >
          <div
            className='flex'
            style={{
              padding: '12px 8px 8px',
              fontFamily: 'var(--font-code)',
              fontSize: '12px',
              fontWeight: 400,
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
          opacity: (!placeholder || loaded) ? 1 : 0,
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
              fontWeight: 475,
              fontSize: '11px',
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
            fontSize: '11px',
            fontWeight: 400,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.02em',
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
                    padding: '4.8px 12px 4.8px 0',
                    fontSize: '11px',
                    fontWeight: 400,
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
                    padding: '4.8px 12px 4.8px 0',
                    fontSize: '11px',
                    fontWeight: 500,
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
                    padding: '4.8px 12px 4.8px 0',
                    fontSize: '11px',
                    fontWeight: 500,
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
                    padding: '4.8px 12px 4.8px 0',
                    fontSize: '11px',
                    fontWeight: 500,
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
 *  by the section grouping logic and rendered in the sidebar column via SectionRow
 *  (which adds .editorial-section-aside). On mobile, SectionRow renders it inline.
 *  The component itself is just a transparent pass-through. */
export function Aside({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

/* =========================================================================
   SectionRow — renders one content section as a grid row.
   Content goes in column 3, aside in column 5 (sticky).
   ========================================================================= */

export function SectionRow({
  content,
  aside,
}: {
  content: React.ReactNode
  aside?: React.ReactNode
}) {
  return (
    <div className='editorial-section-row'>
      <div className='editorial-section-content'>{content}</div>
      {aside && <div className='editorial-section-aside'>{aside}</div>}
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
        backgroundColor: 'var(--code-bg)',
        borderRadius: '10px',
        padding: '10px',
        fontSize: '13px',
        fontWeight: 450,
        lineHeight: 1.45,
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
          borderRadius: '8px',
          fontSize: '13px',
          fontWeight: 500,
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
      className='no-underline'
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        fontSize: '13px',
        fontWeight: 500,
        fontFamily: 'var(--font-primary)',
        color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
        textShadow: isActive ? '-0.2px 0 0 currentColor, 0.2px 0 0 currentColor' : 'none',
        textDecoration: 'none',
        textTransform: 'lowercase',
        transition: 'color 0.15s ease',
        whiteSpace: 'nowrap',
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
}: {
  toc: TocItem[]
  logo?: string
  tabs?: TabItem[]
  activeTab?: string
  sidebar?: React.ReactNode
  headerLinks?: HeaderLink[]
  children?: React.ReactNode
  /** When provided, renders section rows with aside support instead of flat children */
  sections?: EditorialSection[]
}) {
  const hasTabBar = tabs && tabs.length > 0

  return (
    <div
      className='editorial-page'
      style={{
        background: 'var(--bg)',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-primary)',
        WebkitFontSmoothing: 'antialiased',
        textRendering: 'optimizeLegibility',
        minHeight: '100vh',
      }}
    >
      {/* Header + Tab bar: full-width, sticky at top */}
      <div
        className='editorial-header'
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 100,
          background: 'var(--bg)',
        }}
      >
        {/* Top row: logo + right links */}
        <div className='editorial-header-inner' style={{ paddingTop: '16px', paddingBottom: '16px' }}>

          <a
            href='/'
            className='no-underline'
            style={{
              color: 'var(--text-primary)',
              textDecoration: 'none',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            {logo ? (
              <div
                role='img'
                aria-label='playwriter'
                style={{
                  height: '30px',
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
              <span style={{
                fontSize: '15px',
                fontWeight: 700,
                fontFamily: 'var(--font-code)',
                textTransform: 'lowercase',
                letterSpacing: '-0.01em',
              }}>
                index
              </span>
            )}
          </a>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            {/* Icon links */}
          {headerLinks && headerLinks.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {headerLinks.map((link) => {
                return (
                  <a
                    key={link.href}
                    href={link.href}
                    target='_blank'
                    rel='noopener noreferrer'
                    aria-label={link.label}
                    className='no-underline'
                    style={{
                      color: 'var(--text-secondary)',
                      transition: 'color 0.15s ease',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = 'var(--text-primary)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = 'var(--text-secondary)'
                    }}
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
          <div
            className='editorial-tab-bar'
            style={{ borderBottom: '1px solid var(--page-border)' }}
          >
            <div className='editorial-tab-inner'>
              {tabs.map((tab) => {
                return <TabLink key={tab.href} tab={tab} isActive={tab.href === (activeTab ?? tabs[0].href)} />
              })}
            </div>
          </div>
        )}
      </div>

      <div className='editorial-grid'>
        {/* TOC sidebar: sticky within its grid cell */}
        <div className='editorial-grid-toc' style={{ paddingTop: '80px' }}>
          <div
            style={{
              position: 'sticky',
              top: hasTabBar ? 'var(--sticky-top)' : '0px',
            }}
          >
            <TableOfContents items={toc} logo={logo} />
          </div>
        </div>

        {sections ? (
          <>
            {/* Section-based layout: each section is a subgrid row with
                content in column 3 and optional aside in column 5 (sticky). */}
            {/* Top spacer row — mirrors the 80px spacer from flat layout */}
            <div className='editorial-section-row'>
              <div className='editorial-section-content'>
                <div style={{ height: '80px' }} />
              </div>
            </div>
            {sections.map((section, i) => {
              return <SectionRow key={i} content={section.content} aside={section.aside} />
            })}
          </>
        ) : (
          <>
            {/* Flat layout: single article column + optional static sidebar */}
            <div className='editorial-grid-content'>
              <div style={{ height: '80px' }} />
              <article className='editorial-article flex flex-col gap-[20px]'>{children}</article>
            </div>

            <div className='editorial-grid-sidebar'>
              <div
                style={{
                  position: 'sticky',
                  top: hasTabBar ? '56px' : '12px',
                  paddingTop: '68px',
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
