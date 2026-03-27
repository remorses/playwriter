'use client'
/*
 * Playwriter editorial page — rendered from MDX via safe-mdx.
 * Content lives in website/src/content/index.md.
 * Components imported from website/src/components/markdown.tsx.
 *
 * Section-based rendering: the mdast tree is split at ## headings into
 * sections. Each section becomes a CSS subgrid row. <Aside> components
 * are extracted from sections and rendered in the right sidebar column
 * (sticky). On mobile, asides render inline in normal flow.
 */

import React, { type ReactNode } from 'react'
import type { Root, Heading, PhrasingContent, RootContent } from 'mdast'
import { SafeMdxRenderer } from 'safe-mdx'
import { mdxParse } from 'safe-mdx/parse'
import type { MyRootContent } from 'safe-mdx'
import {
  EditorialPage,
  Aside,
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
  type EditorialSection,
} from '../components/markdown.js'
import mdxContent from '../content/index.md?raw'

const tabItems = [
  { label: 'Intro', href: '/' },
  { label: 'GitHub', href: 'https://github.com/remorses/playwriter' },
  { label: 'Changelog', href: 'https://github.com/remorses/playwriter/releases' },
] satisfies TabItem[]

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

function isAsideNode(node: RootContent): boolean {
  return (
    node.type === 'mdxJsxFlowElement' &&
    'name' in node &&
    (node as { name?: string }).name === 'Aside'
  )
}

type MdastSection = {
  /** All nodes in this section (heading + body), excluding <Aside> nodes */
  contentNodes: RootContent[]
  /** <Aside> nodes extracted from this section */
  asideNodes: RootContent[]
}

/** Split mdast root children into sections at ## (depth 2) headings.
 *  Content before the first ## heading becomes the first section.
 *  <Aside> JSX elements are extracted from each section. */
function groupBySections(root: Root): MdastSection[] {
  const sections: MdastSection[] = []
  let current: MdastSection = { contentNodes: [], asideNodes: [] }

  for (const node of root.children) {
    /* Start a new section at each ## heading (depth 2) */
    if (node.type === 'heading' && (node as Heading).depth === 2) {
      if (current.contentNodes.length > 0 || current.asideNodes.length > 0) {
        sections.push(current)
      }
      current = { contentNodes: [node], asideNodes: [] }
    } else if (isAsideNode(node)) {
      current.asideNodes.push(node)
    } else {
      current.contentNodes.push(node)
    }
  }

  /* Push the last section */
  if (current.contentNodes.length > 0 || current.asideNodes.length > 0) {
    sections.push(current)
  }

  return sections
}

const mdast = mdxParse(mdxContent)
const tocItems = generateToc(mdast as Root)
const mdastSections = groupBySections(mdast as Root)

const mdxComponents = {
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
  Aside,
}

function renderNode(node: MyRootContent, transform: (node: MyRootContent) => ReactNode): ReactNode | undefined {
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
}

/** Render a list of mdast nodes into a React fragment using SafeMdxRenderer.
 *  Wraps the nodes in a synthetic root so safe-mdx can process them. */
function RenderNodes({ nodes }: { nodes: RootContent[] }) {
  const syntheticRoot: Root = { type: 'root', children: nodes }
  return (
    <SafeMdxRenderer
      markdown={mdxContent}
      mdast={syntheticRoot as MyRootContent}
      components={mdxComponents}
      renderNode={renderNode}
    />
  )
}

export function IndexPage() {
  const sections: EditorialSection[] = mdastSections.map((section) => {
    const aside = section.asideNodes.length > 0
      ? <RenderNodes nodes={section.asideNodes} />
      : undefined
    return {
      content: <RenderNodes nodes={section.contentNodes} />,
      aside,
    }
  })

  return (
    <EditorialPage
      toc={tocItems}
      logo='/playwriter-logo.svg'
      tabs={tabItems}
      activeTab='/'
      sections={sections}
    />
  )
}
