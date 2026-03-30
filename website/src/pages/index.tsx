/*
 * Playwriter editorial page — rendered from MDX via safe-mdx.
 * Content lives in website/src/content/index.mdx.
 * Components imported from website/src/components/markdown.tsx.
 *
 * This is a SERVER component (no 'use client'). MDX parsing and image
 * processing happen on the server so we can access the filesystem to
 * auto-detect image dimensions and generate pixelated placeholders.
 *
 * Section-based rendering: the mdast tree is split at ## headings into
 * sections. Each section becomes a CSS subgrid row. <Aside> components
 * are extracted from sections and rendered in the right sidebar column
 * (sticky). On mobile, asides render inline in normal flow.
 */

import React, { type ReactNode, Fragment } from 'react'
import type { Root, Heading, RootContent, Image } from 'mdast'
import { SafeMdxRenderer } from 'safe-mdx'
import { mdxParse } from 'safe-mdx/parse'
import type { MyRootContent } from 'safe-mdx'
import path from 'node:path'
import { publicDir, distDir } from 'spiceflow'
import {
  EditorialPage,
  Aside,
  FullWidth,
  Hero,
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
  type TabItem,
  type HeaderLink,
  type HeadingLevel,
  type EditorialSection,
} from '../components/markdown.js'
import { slugify, extractText, generateTocTree, flattenTocTree } from '../components/toc-tree.js'
import { buildImageManifest } from '../lib/image-cache.js'
import mdxContent from '../content/index.mdx?raw'

const tabItems = [
  { label: 'Intro', href: '/' },
  { label: 'GitHub', href: 'https://github.com/remorses/playwriter' },
  { label: 'Changelog', href: 'https://github.com/remorses/playwriter/releases' },
] satisfies TabItem[]

/* slugify, extractText, generateTocTree imported from ../components/toc-tree.js */

function isAsideNode(node: RootContent): boolean {
  return node.type === 'mdxJsxFlowElement' && 'name' in node && (node as { name?: string }).name === 'Aside'
}

function isFullWidthNode(node: RootContent): boolean {
  return node.type === 'mdxJsxFlowElement' && 'name' in node && (node as { name?: string }).name === 'FullWidth'
}

function isHeroNode(node: RootContent): boolean {
  return node.type === 'mdxJsxFlowElement' && 'name' in node && (node as { name?: string }).name === 'Hero'
}

type MdastSection = {
  /** All nodes in this section (heading + body), excluding <Aside> nodes */
  contentNodes: RootContent[]
  /** <Aside> nodes extracted from this section */
  asideNodes: RootContent[]
  /** Section spans both content and aside columns */
  fullWidth?: boolean
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
    } else if (isFullWidthNode(node)) {
      /* Push current section, then push a fullWidth section with the
         FullWidth wrapper's children as content nodes */
      if (current.contentNodes.length > 0 || current.asideNodes.length > 0) {
        sections.push(current)
      }
      const children = 'children' in node ? (node as { children: RootContent[] }).children : []
      sections.push({ contentNodes: children, asideNodes: [], fullWidth: true })
      current = { contentNodes: [], asideNodes: [] }
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

/* Parse MDX at module level (sync, no fs needed) */
const mdast = mdxParse(mdxContent)

/* publicDir/distDir injected by spiceflow at build time via virtual:spiceflow-dirs.
 * publicDir: dev → website/public/, Vercel → function's client/ dir.
 * cacheDir: inside distDir so it's writable locally, gracefully fails on Vercel. */
const cacheDir = path.resolve(distDir, '.cache/images')

export async function IndexPage() {
  /* Build image manifest — reads/generates cached placeholders + dimensions */
  const imageManifest = await buildImageManifest({
    mdast: mdast as Root,
    publicDir,
    cacheDir,
  })

  /* Extract <Hero> nodes from the mdast before TOC/section processing.
     Hero nodes are rendered above the 3-column grid in EditorialPage. */
  const heroNodes = (mdast as Root).children.filter(isHeroNode)
  const contentChildren = (mdast as Root).children.filter((node) => {
    return !isHeroNode(node)
  })
  const contentMdast: Root = { type: 'root', children: contentChildren }

  const tocTree = generateTocTree(contentMdast)
  const tocItems = flattenTocTree({ roots: tocTree })
  const mdastSections = groupBySections(contentMdast)

  /** Wrapper that injects placeholder + dimensions from the image manifest.
   *  Safe-mdx calls this with the props extracted from the MDX JSX attributes. */
  function PixelatedImageWithPlaceholder(props: { src: string; alt: string; width?: number; height?: number; className?: string }) {
    const data = imageManifest[props.src]
    return (
      <PixelatedImage
        src={props.src}
        alt={props.alt}
        width={data?.width ?? (props.width || 0)}
        height={data?.height ?? (props.height || 0)}
        placeholder={data?.placeholder}
        className={props.className || ''}
      />
    )
  }

  const mdxComponents = {
    p: P,
    a: A,
    code: Code,
    ul: List,
    ol: OL,
    li: Li,
    Caption,
    ComparisonTable,
    PixelatedImage: PixelatedImageWithPlaceholder,
    Bleed,
    Aside,
    FullWidth,
    Hero,
  }

  function renderNode(node: MyRootContent, transform: (node: MyRootContent) => ReactNode): ReactNode | undefined {
    /* Markdown images ![alt](url): convert to PixelatedImage with placeholder */
    if (node.type === 'image') {
      const imgNode = node as Image
      return (
        <PixelatedImageWithPlaceholder
          src={imgNode.url}
          alt={imgNode.alt || ''}
        />
      )
    }

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
            return <Fragment key={i}>{transform(child as MyRootContent)}</Fragment>
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
        <CodeBlock lang={lang} lineHeight={isDiagram ? '1.3' : '1.85'} showLineNumbers={!isDiagram}>
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

  const sections: EditorialSection[] = mdastSections.map((section) => {
    const aside = section.asideNodes.length > 0 ? <RenderNodes nodes={section.asideNodes} /> : undefined
    return {
      content: <RenderNodes nodes={section.contentNodes} />,
      aside,
      fullWidth: section.fullWidth,
    }
  })

  const heroContent = heroNodes.length > 0 ? <RenderNodes nodes={heroNodes} /> : undefined

  return (
    <EditorialPage
      toc={tocItems}
      logo='/playwriter-logo.svg'
      tabs={tabItems}
      activeTab='/'
      sections={sections}
      hero={heroContent}
    />
  )
}
