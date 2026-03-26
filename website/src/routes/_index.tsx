/*
 * Playwriter editorial page — rendered from MDX via safe-mdx.
 * Content lives in website/src/content/index.mdx.
 * Components imported from website/src/components/markdown.tsx.
 */

import type { MetaFunction } from 'react-router'
import React, { type ReactNode } from 'react'
import type { Root, Heading, PhrasingContent } from 'mdast'
import { SafeMdxRenderer } from 'safe-mdx'
import { mdxParse } from 'safe-mdx/parse'
import type { MyRootContent } from 'safe-mdx'
import {
  EditorialPage,
  P,
  A,
  Code,
  Caption,
  CodeBlock,
  SectionHeading,
  ComparisonTable,
  PixelatedImage,
  Bleed,
  List,
  OL,
  Li,
  type TocItem,
  type TabItem,
  type HeaderLink,
  type HeadingLevel,
} from 'website/src/components/markdown'
import mdxContent from '../content/index.md?raw'

export const meta: MetaFunction = () => {
  const title = 'Playwriter - Chrome extension & CLI that lets agents use your real browser'
  const description =
    'Chrome extension and CLI that let your agents control your actual browser. Your logins, extensions, cookies — already there. No headless instance, no bot detection.'
  const image = 'https://playwriter.dev/og-image.png'
  return [
    { title },
    { name: 'description', content: description },
    { property: 'og:title', content: title },
    { property: 'og:description', content: description },
    { property: 'og:image', content: image },
    { property: 'og:image:width', content: '1200' },
    { property: 'og:image:height', content: '630' },
    { property: 'og:type', content: 'website' },
    { property: 'og:url', content: 'https://playwriter.dev' },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: title },
    { name: 'twitter:description', content: description },
    { name: 'twitter:image', content: image },
  ]
}

const tabItems = [
  { label: 'Intro', href: '/' },
  { label: 'GitHub', href: 'https://github.com/remorses/playwriter' },
  { label: 'Changelog', href: 'https://github.com/remorses/playwriter/releases' },
] satisfies TabItem[]

const headerLinks = [
  {
    href: 'https://github.com/nicollite/playwriter',
    label: 'GitHub',
    icon: (
      <svg width='18' height='18' viewBox='0 0 24 24' fill='currentColor'>
        <path d='M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z' />
      </svg>
    ),
  },
  {
    href: 'https://x.com/__morse',
    label: 'X',
    icon: (
      <svg width='16' height='16' viewBox='0 0 24 24' fill='currentColor'>
        <path d='M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z' />
      </svg>
    ),
  },
] satisfies HeaderLink[]

/** Slugify heading text for anchor IDs */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}

/** Extract plain text from mdast phrasing content */
function extractText(children: PhrasingContent[]): string {
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

/** Generate TOC items from mdast headings */
function generateToc(mdast: Root): TocItem[] {
  return mdast.children
    .filter((node): node is Heading => node.type === 'heading')
    .map((heading) => {
      const text = extractText(heading.children)
      const id = slugify(text)
      /* MDX ## = depth 2 → editorial level 1, ### = depth 3 → level 2, #### = depth 4 → level 3 */
      const level = (heading.depth - 1) as HeadingLevel
      return {
        label: text,
        href: `#${id}`,
        ...(level > 1 ? { level } : {}),
      }
    })
}

const mdast = mdxParse(mdxContent)
const tocItems = generateToc(mdast as Root)

export default function IndexPage() {
  return (
    <EditorialPage
      toc={tocItems}
      logo='/playwriter-logo.svg'
      tabs={tabItems}
      activeTab='/'
    >
      <SafeMdxRenderer
        markdown={mdxContent}
        mdast={mdast}
        components={{
          p: P,
          a: A,
          code: Code,
          ul: List,
          ol: OL,
          li: Li,
          Caption,
          ComparisonTable,
          PixelatedImage,
          Bleed,
        }}
        renderNode={(node, transform) => {
          /* Headings: map markdown ## (depth 2) to editorial level 1, etc.
             Render children individually to avoid wrapping in <P> component. */
          if (node.type === 'heading') {
            const heading = node as Heading
            const text = extractText(heading.children)
            const id = slugify(text)
            const level = Math.min(heading.depth - 1, 3) as HeadingLevel
            return (
              <SectionHeading key={id} id={id} level={level}>
                {heading.children.map((child, i) => {
                  return <React.Fragment key={i}>{transform(child as MyRootContent)}</React.Fragment>
                })}
              </SectionHeading>
            )
          }

          /* Code blocks: use our CodeBlock with Prism highlighting */
          if (node.type === 'code') {
            const codeNode = node as { lang?: string; value: string; meta?: string }
            const lang = codeNode.lang || 'bash'
            const isDiagram = lang === 'diagram'
            return (
              <CodeBlock
                lang={lang}
                lineHeight={isDiagram ? '1.3' : '1.85'}
                showLineNumbers={!isDiagram}
              >
                {codeNode.value}
              </CodeBlock>
            )
          }

          return undefined
        }}
      />
    </EditorialPage>
  )
}
