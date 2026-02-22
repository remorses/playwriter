/**
 * Extract page content as markdown using Mozilla Readability.
 *
 * This utility injects the Readability library into the page and extracts
 * the main content, similar to Firefox Reader View.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@xmorse/playwright-core'
import { createSmartDiff } from './diff-utils.js'

export interface PageMarkdownResult {
  /** Extracted content as plain text (HTML tags stripped) */
  content: string
  /** Article title */
  title: string | null
  /** Article author/byline */
  author: string | null
  /** Article excerpt/description */
  excerpt: string | null
  /** Site name */
  siteName: string | null
  /** Content language */
  lang: string | null
  /** Published time */
  publishedTime: string | null
  /** Word count */
  wordCount: number
}

export interface GetPageMarkdownOptions {
  page: Page
  /** String or regex to filter content (returns matching lines with context) */
  search?: string | RegExp
  /** Return diff since last call for this page */
  showDiffSinceLastCall?: boolean
}

// Cache for the bundled readability code
let readabilityCode: string | null = null

function getReadabilityCode(): string {
  if (readabilityCode) {
    return readabilityCode
  }
  const currentDir = path.dirname(fileURLToPath(import.meta.url))
  const readabilityPath = path.join(currentDir, '..', 'dist', 'readability.js')
  readabilityCode = fs.readFileSync(readabilityPath, 'utf-8')
  return readabilityCode
}

// Store last snapshots per page for diffing
const lastMarkdownSnapshots: WeakMap<Page, string> = new WeakMap()

function isRegExp(value: unknown): value is RegExp {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as RegExp).test === 'function' &&
    typeof (value as RegExp).exec === 'function'
  )
}

/**
 * Extract page content as markdown using Mozilla Readability.
 *
 * Injects Readability into the page if not already present, then extracts
 * the main content. Returns plain text content (no HTML).
 */
export async function getPageMarkdown(options: GetPageMarkdownOptions): Promise<string> {
  const { page, search, showDiffSinceLastCall = true } = options

  // Check if readability is already injected
  const hasReadability = await page.evaluate(() => !!(globalThis as any).__readability)

  if (!hasReadability) {
    const code = getReadabilityCode()
    await page.evaluate(code)
  }

  // Extract content using Readability
  const result = (await page.evaluate(() => {
    const readability = (globalThis as any).__readability
    if (!readability) {
      throw new Error('Readability not loaded')
    }

    // Clone document to avoid modifying the original
    const documentClone = document.cloneNode(true)

    // Check if page is probably readable
    if (!readability.isProbablyReaderable(documentClone)) {
      return {
        content: document.body?.innerText || '',
        title: document.title || null,
        author: null,
        excerpt: null,
        siteName: null,
        lang: document.documentElement?.lang || null,
        publishedTime: null,
        wordCount: (document.body?.innerText || '').split(/\s+/).filter(Boolean).length,
        _notReadable: true,
      }
    }

    const article = new readability.Readability(documentClone).parse()

    if (!article) {
      return {
        content: document.body?.innerText || '',
        title: document.title || null,
        author: null,
        excerpt: null,
        siteName: null,
        lang: document.documentElement?.lang || null,
        publishedTime: null,
        wordCount: (document.body?.innerText || '').split(/\s+/).filter(Boolean).length,
        _notReadable: true,
      }
    }

    return {
      content: article.textContent || '',
      title: article.title || null,
      author: article.byline || null,
      excerpt: article.excerpt || null,
      siteName: article.siteName || null,
      lang: article.lang || null,
      publishedTime: article.publishedTime || null,
      wordCount: (article.textContent || '').split(/\s+/).filter(Boolean).length,
    }
  })) as PageMarkdownResult & { _notReadable?: boolean }

  // Format output
  const lines: string[] = []

  if (result.title) {
    lines.push(`# ${result.title}`)
    lines.push('')
  }

  const metadata: string[] = []
  if (result.author) {
    metadata.push(`Author: ${result.author}`)
  }
  if (result.siteName) {
    metadata.push(`Site: ${result.siteName}`)
  }
  if (result.publishedTime) {
    metadata.push(`Published: ${result.publishedTime}`)
  }
  if (metadata.length > 0) {
    lines.push(metadata.join(' | '))
    lines.push('')
  }

  if (result.excerpt && result.excerpt !== result.content.slice(0, result.excerpt.length)) {
    lines.push(`> ${result.excerpt}`)
    lines.push('')
  }

  lines.push(result.content)

  let markdown = lines.join('\n').trim()

  // Sanitize to remove unpaired surrogates that break JSON encoding
  markdown = markdown.toWellFormed?.() ?? markdown

  // Store snapshot and handle diffing
  const previousSnapshot = lastMarkdownSnapshots.get(page)
  lastMarkdownSnapshots.set(page, markdown)

  // Return diff if we have a previous snapshot and diff mode is enabled
  if (showDiffSinceLastCall && previousSnapshot) {
    const diffResult = createSmartDiff({
      oldContent: previousSnapshot,
      newContent: markdown,
      label: 'content',
    })
    if (diffResult.type === 'no-change') {
      return 'No changes since last call. Use showDiffSinceLastCall: false to see full content.'
    }
    return diffResult.content
  }

  // Handle search
  if (search) {
    const contentLines = markdown.split('\n')
    const matchIndices: number[] = []

    for (let i = 0; i < contentLines.length; i++) {
      const line = contentLines[i]
      let isMatch = false
      if (isRegExp(search)) {
        isMatch = search.test(line)
      } else {
        isMatch = line.toLowerCase().includes(search.toLowerCase())
      }

      if (isMatch) {
        matchIndices.push(i)
        if (matchIndices.length >= 10) {
          break
        }
      }
    }

    if (matchIndices.length === 0) {
      return 'No matches found'
    }

    // Collect lines with 5 lines of context above and below each match
    const CONTEXT_LINES = 5
    const includedLines = new Set<number>()
    for (const idx of matchIndices) {
      const start = Math.max(0, idx - CONTEXT_LINES)
      const end = Math.min(contentLines.length - 1, idx + CONTEXT_LINES)
      for (let i = start; i <= end; i++) {
        includedLines.add(i)
      }
    }

    // Build result with separators between non-contiguous sections
    const sortedIndices = [...includedLines].sort((a, b) => a - b)
    const resultLines: string[] = []
    for (let i = 0; i < sortedIndices.length; i++) {
      const lineIdx = sortedIndices[i]
      if (i > 0 && sortedIndices[i - 1] !== lineIdx - 1) {
        resultLines.push('---')
      }
      resultLines.push(contentLines[lineIdx])
    }

    return resultLines.join('\n')
  }

  return markdown
}
