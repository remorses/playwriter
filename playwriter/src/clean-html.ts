import { Page, Locator } from '@xmorse/playwright-core'
import { formatHtmlForPrompt } from './htmlrewrite.js'
import { createSmartDiff } from './diff-utils.js'

export interface GetCleanHTMLOptions {
  locator: Locator | Page
  search?: string | RegExp
  showDiffSinceLastCall?: boolean
  includeStyles?: boolean
  maxAttrLen?: number
  maxContentLen?: number
}

// Store last HTML snapshots per locator/page for diffing
const lastHtmlSnapshots: WeakMap<Page, Map<string, string>> = new WeakMap()

function isPage(obj: any): obj is Page {
  return obj && typeof obj.content === 'function' && typeof obj.goto === 'function'
}

function isRegExp(value: any): value is RegExp {
  return (
    typeof value === 'object' && value !== null && typeof value.test === 'function' && typeof value.exec === 'function'
  )
}

function getSnapshotKey(locator: Locator | Page): string {
  if (isPage(locator)) {
    return '__page__'
  }
  // For locators, use a string representation
  return (locator as any)._selector || '__locator__'
}

export async function getCleanHTML(options: GetCleanHTMLOptions): Promise<string> {
  const {
    locator,
    search,
    showDiffSinceLastCall = !search,
    includeStyles = false,
    maxAttrLen = 200,
    maxContentLen = 500,
  } = options

  // Get raw HTML
  let rawHtml: string
  let page: Page

  if (isPage(locator)) {
    page = locator
    rawHtml = await locator.content()
  } else {
    page = locator.page()
    rawHtml = await locator.innerHTML()
  }

  // Clean the HTML using formatHtmlForPrompt
  const cleanedHtml = await formatHtmlForPrompt({
    html: rawHtml,
    keepStyles: includeStyles,
    maxAttrLen,
    maxContentLen,
  })

  // Sanitize to remove unpaired surrogates that break JSON encoding
  let htmlStr = cleanedHtml.toWellFormed?.() ?? cleanedHtml

  // Store snapshot and handle diffing
  let pageSnapshots = lastHtmlSnapshots.get(page)
  if (!pageSnapshots) {
    pageSnapshots = new Map()
    lastHtmlSnapshots.set(page, pageSnapshots)
  }

  const snapshotKey = getSnapshotKey(locator)
  const previousSnapshot = pageSnapshots.get(snapshotKey)
  pageSnapshots.set(snapshotKey, htmlStr)

  // Diff defaults off when search is provided, but agent can explicitly enable both
  if (showDiffSinceLastCall && previousSnapshot) {
    const diffResult = createSmartDiff({
      oldContent: previousSnapshot,
      newContent: htmlStr,
      label: 'html',
    })
    if (diffResult.type === 'no-change') {
      return 'No changes since last call. Use showDiffSinceLastCall: false to see full content.'
    }
    return diffResult.content
  }

  // Handle search
  if (search) {
    const lines = htmlStr.split('\n')
    const matchIndices: number[] = []

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      let isMatch = false
      if (isRegExp(search)) {
        isMatch = search.test(line)
      } else {
        isMatch = line.includes(search)
      }

      if (isMatch) {
        matchIndices.push(i)
        if (matchIndices.length >= 10) break
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
      const end = Math.min(lines.length - 1, idx + CONTEXT_LINES)
      for (let i = start; i <= end; i++) {
        includedLines.add(i)
      }
    }

    // Build result with separators between non-contiguous sections
    const sortedIndices = [...includedLines].sort((a, b) => a - b)
    const result: string[] = []
    for (let i = 0; i < sortedIndices.length; i++) {
      const lineIdx = sortedIndices[i]
      if (i > 0 && sortedIndices[i - 1] !== lineIdx - 1) {
        result.push('---')
      }
      result.push(lines[lineIdx])
    }

    return result.join('\n')
  }

  return htmlStr
}
