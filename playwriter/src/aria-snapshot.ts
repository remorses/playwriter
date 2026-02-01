import type { Page, Locator, ElementHandle } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Import sharp at module level - resolves to null if not available
const sharpPromise = import('sharp')
  .then((m) => { return m.default })
  .catch(() => { return null })

// ============================================================================
// Aria Snapshot Format Documentation
// ============================================================================
//
// This module generates accessibility snapshots using dom-accessibility-api
// running entirely in browser context. The output format is:
//
// ```
// - role "accessible name" [ref=testid-or-e1]
// - button "Submit" [ref=submit-btn]
// - link "Home" [ref=nav-home]
// - textbox "Search" [ref=e3]
// ```
//
// Refs are generated from stable test IDs when available:
// - data-testid, data-test-id, data-test, data-cy, data-pw
// - Stable id attributes (excluding auto-generated ones)
// - Fallback: e1, e2, e3...
//
// Duplicate refs get a suffix: submit-btn, submit-btn-2, submit-btn-3
// ============================================================================

// ============================================================================
// Snapshot Format Types and Processing
// ============================================================================

export type SnapshotFormat = 'raw' | 'compact' | 'interactive' | 'interactive-dedup'

export const DEFAULT_SNAPSHOT_FORMAT: SnapshotFormat = 'interactive-dedup'

/**
 * Apply a snapshot format transformation with error handling.
 * If processing fails, logs the error and returns the raw snapshot.
 */
export function formatSnapshot(
  snapshot: string,
  format: SnapshotFormat,
  logger?: { error: (...args: unknown[]) => void }
): string {
  if (format === 'raw') {
    return snapshot
  }

  try {
    switch (format) {
      case 'compact':
        return compactSnapshot(snapshot)
      case 'interactive':
        return interactiveSnapshot(snapshot)
      case 'interactive-dedup':
        return deduplicateSnapshot(interactiveSnapshot(snapshot))
      default:
        return snapshot
    }
  } catch (error) {
    logger?.error('[aria-snapshot] Failed to apply format', format, error)
    return snapshot
  }
}

// ============================================================================
// Snapshot Compression Functions
// ============================================================================

export interface CompactSnapshotOptions {
  /** Remove [cursor=pointer] hints (default: true) */
  removeCursorPointer?: boolean
  /** Remove [active] markers (default: true) */
  removeActive?: boolean
  /** Remove empty structural rows/cells (default: true) */
  removeEmptyStructural?: boolean
  /** Remove text separators like "|" (default: true) */
  removeTextSeparators?: boolean
  /** Remove /url: metadata lines (default: false) */
  removeUrls?: boolean
}

export interface InteractiveSnapshotOptions {
  /** Keep /url: metadata for links (default: false) */
  keepUrls?: boolean
  /** Keep image elements (default: true) */
  keepImages?: boolean
  /** Keep tree structure, removing only empty branches (default: true) */
  keepStructure?: boolean
  /** Keep headings for context (default: true) */
  keepHeadings?: boolean
  /** Remove unnamed generic/group wrappers (default: true) */
  removeGenericWrappers?: boolean
}

/**
 * Post-process a snapshot to make it more compact.
 * Removes noise while preserving structure.
 * Typical reduction: 15-25%
 */
export function compactSnapshot(snapshot: string, options: CompactSnapshotOptions = {}): string {
  const {
    removeCursorPointer = true,
    removeActive = true,
    removeEmptyStructural = true,
    removeTextSeparators = true,
    removeUrls = false,
  } = options

  let lines = snapshot.split('\n')

  // Line-by-line transformations
  lines = lines.map((line) => {
    let result = line
    if (removeCursorPointer) {
      result = result.replace(/ \[cursor=pointer\]/g, '')
    }
    if (removeActive) {
      result = result.replace(/ \[active\]/g, '')
    }
    return result
  })

  // Filter out unwanted lines
  lines = lines.filter((line) => {
    const trimmed = line.trim()
    if (!trimmed) {
      return false
    }
    // Remove text separators
    if (removeTextSeparators && /^- text: ["']?[|·•–—]/.test(trimmed)) {
      return false
    }
    // Remove empty structural elements
    if (removeEmptyStructural) {
      if (/^- (row|cell|rowgroup|generic|listitem|group)\s*(\[ref=\w+\])?\s*$/.test(trimmed)) {
        return false
      }
    }
    // Remove /url: lines
    if (removeUrls && /^- \/url:/.test(trimmed)) {
      return false
    }
    return true
  })

  return lines.join('\n')
}

/**
 * Post-process a snapshot to show only interactive elements.
 * Like agent-browser's compact mode - keeps structure but only refs on interactive elements.
 * Typical reduction: 50-65% with structure, 80-90% flat
 */
export function interactiveSnapshot(snapshot: string, options: InteractiveSnapshotOptions = {}): string {
  const {
    keepUrls = false,
    keepImages = true,
    keepStructure = true,
    keepHeadings = true,
    removeGenericWrappers = true,
  } = options

  const interactiveRoles = new Set([
    'link', 'button', 'textbox', 'combobox', 'searchbox', 'checkbox', 'radio',
    'slider', 'spinbutton', 'switch', 'menuitem', 'menuitemcheckbox',
    'menuitemradio', 'option', 'tab', 'treeitem',
  ])

  if (keepImages) {
    interactiveRoles.add('img')
    interactiveRoles.add('video')
    interactiveRoles.add('audio')
  }

  const contentRoles = new Set(keepHeadings ? ['heading'] : [])

  const lines = snapshot.split('\n')

  if (!keepStructure) {
    return extractInteractiveFlat(lines, interactiveRoles, keepUrls)
  }

  let result = extractInteractiveWithStructure(lines, interactiveRoles, contentRoles, keepUrls)

  if (removeGenericWrappers) {
    result = collapseGenericWrappers(result)
  }

  return result
}

function extractInteractiveFlat(lines: string[], interactiveRoles: Set<string>, keepUrls: boolean): string {
  const result: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (!trimmed) {
      continue
    }

    // Match ref pattern - now supports any ref format (not just e123)
    const match = trimmed.match(/^-\s+(\w+)(?:\s+"[^"]*")?(?:\s+\[[^\]]+\])*\s*\[ref=([^\]]+)\]/)
    if (!match || !interactiveRoles.has(match[1])) {
      continue
    }

    let cleanLine = trimmed
      .replace(/ \[cursor=pointer\]/g, '')
      .replace(/ \[active\]/g, '')
      .replace(/:$/, '')

    result.push(cleanLine)

    if (keepUrls && match[1] === 'link' && i + 1 < lines.length) {
      const nextLine = lines[i + 1].trim()
      if (nextLine.startsWith('- /url:')) {
        result.push('  ' + nextLine)
      }
    }
  }

  return result.join('\n')
}

function extractInteractiveWithStructure(
  lines: string[],
  interactiveRoles: Set<string>,
  contentRoles: Set<string>,
  keepUrls: boolean
): string {
  const lineHasInteractive = new Array(lines.length).fill(false)
  const lineIsInteractive = new Array(lines.length).fill(false)
  const lineIndents = lines.map((l) => l.length - l.trimStart().length)
  const lineRoles = lines.map((l) => {
    const m = l.trim().match(/^-\s+(\w+)/)
    return m ? m[1] : null
  })

  // Mark interactive lines
  for (let i = 0; i < lines.length; i++) {
    const role = lineRoles[i]
    if (role && interactiveRoles.has(role)) {
      lineHasInteractive[i] = true
      lineIsInteractive[i] = true
    } else if (role && contentRoles.has(role)) {
      lineHasInteractive[i] = true
    }
  }

  // Propagate up to ancestors
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lineHasInteractive[i]) {
      continue
    }
    const myIndent = lineIndents[i]
    for (let j = i - 1; j >= 0; j--) {
      if (lineIndents[j] < myIndent && lines[j].trim()) {
        lineHasInteractive[j] = true
        break
      }
    }
  }

  // Build result
  const result: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (!trimmed || !lineHasInteractive[i]) {
      continue
    }

    // Skip /url: unless wanted
    if (trimmed.startsWith('- /url:')) {
      if (keepUrls && i > 0 && lineRoles[i - 1] === 'link') {
        result.push(cleanSnapshotLine(lines[i]))
      }
      continue
    }

    // Skip text nodes
    if (trimmed.startsWith('- text:')) {
      continue
    }

    // Clean line and strip refs from non-interactive
    let cleanedLine = cleanSnapshotLine(lines[i])
    if (!lineIsInteractive[i]) {
      cleanedLine = cleanedLine.replace(/\s*\[ref=[^\]]+\]/g, '')
    }

    result.push(cleanedLine)
  }

  return result.join('\n')
}

function collapseGenericWrappers(snapshot: string): string {
  const lines = snapshot.split('\n')
  const result: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed) {
      continue
    }

    // Check for unnamed wrapper: - generic: or - group:
    if (/^-\s+(generic|group|region):$/.test(trimmed)) {
      const currentIndent = line.length - line.trimStart().length
      // Dedent children
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j]
        if (!nextLine.trim()) {
          continue
        }
        const nextIndent = nextLine.length - nextLine.trimStart().length
        if (nextIndent <= currentIndent) {
          break
        }
        lines[j] = nextLine.slice(0, currentIndent) + nextLine.slice(currentIndent + 2)
      }
      continue
    }

    result.push(line)
  }

  return result.join('\n')
}

function cleanSnapshotLine(line: string): string {
  return line.replace(/ \[cursor=pointer\]/g, '').replace(/ \[active\]/g, '')
}

interface SnapshotNode {
  indent: number
  role: string
  name: string | null
  ref: string | null
  rawLine: string
  children: SnapshotNode[]
}

/**
 * Remove duplicate text from parent elements when the same text appears in descendants.
 * For example, if a row's name is "upvote | story title" and it contains children with
 * those exact names, the parent's name is redundant and can be removed.
 */
export function deduplicateSnapshot(snapshot: string): string {
  const lines = snapshot.split('\n')
  const nodes: SnapshotNode[] = []
  const stack: SnapshotNode[] = []

  // Parse lines into nodes with tree structure
  for (const line of lines) {
    if (!line.trim()) {
      continue
    }

    const indent = line.length - line.trimStart().length
    const parsed = parseSnapshotLine(line)

    const node: SnapshotNode = {
      indent,
      role: parsed.role,
      name: parsed.name,
      ref: parsed.ref,
      rawLine: line,
      children: [],
    }

    // Pop stack until we find parent (lower indent)
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop()
    }

    if (stack.length > 0) {
      stack[stack.length - 1].children.push(node)
    } else {
      nodes.push(node)
    }

    stack.push(node)
  }

  // Process each root node
  for (const node of nodes) {
    deduplicateNode(node)
  }

  // Rebuild snapshot
  const result: string[] = []
  for (const node of nodes) {
    rebuildLines(node, result)
  }

  return result.join('\n')
}

function parseSnapshotLine(line: string): { role: string; name: string | null; ref: string | null } {
  let trimmed = line.trim()

  // Handle single-quote wrapped lines: - 'row "name with: colon"':
  // These occur when the name contains a colon
  if (trimmed.startsWith("- '") && trimmed.includes("':")) {
    // Extract content between - ' and ':
    const innerMatch = trimmed.match(/^-\s+'(.+)'/)
    if (innerMatch) {
      trimmed = '- ' + innerMatch[1]
    }
  }

  // Match: - role "name" [ref=xxx]: or - role [ref=xxx]: or - role "name": or - role:
  // Updated to support any ref format (not just e123)
  const match = trimmed.match(/^-\s+(\w+)(?:\s+"([^"]*)")?(?:\s+\[ref=([^\]]+)\])?/)

  if (!match) {
    return { role: '', name: null, ref: null }
  }

  return {
    role: match[1],
    name: match[2] || null,
    ref: match[3] || null,
  }
}

function collectDescendantNames(node: SnapshotNode): Set<string> {
  const names = new Set<string>()

  for (const child of node.children) {
    if (child.name) {
      names.add(child.name)
    }
    // Recursively collect from grandchildren
    for (const name of collectDescendantNames(child)) {
      names.add(name)
    }
  }

  return names
}

function isNameRedundant(name: string, descendantNames: Set<string>): boolean {
  if (descendantNames.size === 0) {
    return false
  }

  // Normalize the name - remove common separators and check if all parts exist in descendants
  // Split by common separators: |, (, ), commas, and whitespace runs
  const parts = name
    .split(/[\|\(\),]+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)

  if (parts.length === 0) {
    return false
  }

  // Check if each meaningful part is found in a descendant name
  let matchedParts = 0
  for (const part of parts) {
    // Check if this part matches or is contained in any descendant name
    for (const descName of descendantNames) {
      if (descName === part || descName.includes(part) || part.includes(descName)) {
        matchedParts++
        break
      }
    }
  }

  // If most parts (>= 50%) are found in descendants, the name is redundant
  return matchedParts >= parts.length * 0.5
}

function deduplicateNode(node: SnapshotNode): void {
  // First, recursively process children
  for (const child of node.children) {
    deduplicateNode(child)
  }

  // Then check if this node's name is redundant
  if (node.name && node.children.length > 0) {
    const descendantNames = collectDescendantNames(node)
    if (isNameRedundant(node.name, descendantNames)) {
      node.name = null
    }
  }
}

function rebuildLines(node: SnapshotNode, result: string[]): void {
  // Rebuild the line with potentially stripped name
  const indent = ' '.repeat(node.indent)
  let line = `${indent}- ${node.role}`

  if (node.name) {
    // Use double quotes, escape if needed
    const escaped = node.name.replace(/"/g, '\\"')
    line += ` "${escaped}"`
  }

  if (node.ref) {
    line += ` [ref=${node.ref}]`
  }

  if (node.children.length > 0) {
    line += ':'
  }

  result.push(line)

  for (const child of node.children) {
    rebuildLines(child, result)
  }
}

// ============================================================================
// A11y Client Code Loading
// ============================================================================

let a11yClientCode: string | null = null

function getA11yClientCode(): string {
  if (a11yClientCode) {
    return a11yClientCode
  }
  const currentDir = path.dirname(fileURLToPath(import.meta.url))
  const a11yClientPath = path.join(currentDir, '..', 'dist', 'a11y-client.js')
  a11yClientCode = fs.readFileSync(a11yClientPath, 'utf-8')
  return a11yClientCode
}

async function ensureA11yClient(page: Page): Promise<void> {
  const hasA11y = await page.evaluate(() => !!(globalThis as any).__a11y)
  if (!hasA11y) {
    const code = getA11yClientCode()
    await page.evaluate(code)
  }
}

// ============================================================================
// Types
// ============================================================================

export interface AriaRef {
  role: string
  name: string
  ref: string
}

export interface ScreenshotResult {
  path: string
  base64: string
  mimeType: 'image/jpeg'
  snapshot: string
  labelCount: number
}

export interface AriaSnapshotResult {
  snapshot: string
  refToElement: Map<string, { role: string; name: string }>
  /**
   * Get a CSS selector for a ref. Use with page.locator().
   * For stable test IDs, returns [data-testid="..."] or [id="..."]
   * For fallback refs (e1, e2), returns a role-based selector.
   */
  getSelectorForRef: (ref: string) => string | null
  getRefsForLocators: (locators: Array<Locator | ElementHandle>) => Promise<Array<AriaRef | null>>
  getRefForLocator: (locator: Locator | ElementHandle) => Promise<AriaRef | null>
  getRefStringForLocator: (locator: Locator | ElementHandle) => Promise<string | null>
}

// Roles that represent interactive elements
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'combobox',
  'searchbox',
  'checkbox',
  'radio',
  'slider',
  'spinbutton',
  'switch',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'tab',
  'treeitem',
  'img',
  'video',
  'audio',
])

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Get an accessibility snapshot with utilities to look up refs for elements.
 * Uses dom-accessibility-api running entirely in browser context.
 * 
 * Refs are generated from stable test IDs when available (data-testid, data-test-id, etc.)
 * or fall back to e1, e2, e3...
 *
 * @param page - Playwright page
 * @param locator - Optional locator to scope the snapshot to a subtree
 * @param refFilter - Optional filter for which elements get refs
 *
 * @example
 * ```ts
 * const { snapshot, getSelectorForRef } = await getAriaSnapshot({ page })
 * // Snapshot shows refs like [ref=submit-btn] or [ref=e5]
 * const selector = getSelectorForRef('submit-btn')
 * await page.locator(selector).click()
 * ```
 */
export async function getAriaSnapshot({ page, locator, refFilter }: {
  page: Page
  locator?: Locator
  refFilter?: (info: { role: string; name: string }) => boolean
}): Promise<AriaSnapshotResult> {
  await ensureA11yClient(page)

  // Determine root element
  const rootHandle = locator ? await locator.elementHandle() : null

  const result = await page.evaluate(
    ({ root, interactiveOnly }) => {
      const a11y = (globalThis as any).__a11y
      if (!a11y) {
        throw new Error('a11y client not loaded')
      }
      const rootElement = root || document.body
      return a11y.computeA11ySnapshot({
        root: rootElement,
        interactiveOnly,
        renderLabels: false,
      })
    },
    {
      root: rootHandle,
      interactiveOnly: !!refFilter,
    }
  )

  // Build refToElement map
  const refToElement = new Map<string, { role: string; name: string }>()
  for (const { ref, role, name } of result.refs) {
    if (!refFilter || refFilter({ role, name })) {
      refToElement.set(ref, { role, name })
    }
  }

  // Filter snapshot if refFilter provided
  let snapshot = result.snapshot
  if (refFilter) {
    const lines = snapshot.split('\n').filter((line) => {
      const match = line.match(/\[ref=([^\]]+)\]/)
      if (!match) {
        return true
      }
      const ref = match[1]
      return refToElement.has(ref)
    })
    snapshot = lines.join('\n')
  }

  /**
   * Get a CSS selector for a ref.
   * For stable test IDs: [data-testid="value"] or [id="value"]
   * For fallback refs: uses role + name matching
   */
  const getSelectorForRef = (ref: string): string | null => {
    const info = refToElement.get(ref)
    if (!info) {
      return null
    }

    // Check if ref looks like a stable test ID (not e1, e2, etc.)
    if (!/^e\d+$/.test(ref)) {
      // Try common test ID attributes
      return `[data-testid="${ref}"], [data-test-id="${ref}"], [data-test="${ref}"], [data-cy="${ref}"], [data-pw="${ref}"], [id="${ref}"]`
    }

    // For fallback refs, use role-based selector
    // This is less reliable but works for simple cases
    const escapedName = info.name.replace(/"/g, '\\"')
    return `[role="${info.role}"][aria-label="${escapedName}"], ${info.role}:has-text("${escapedName}")`
  }

  /**
   * Find refs for locators by matching in browser context.
   */
  const getRefsForLocators = async (locators: Array<Locator | ElementHandle>): Promise<Array<AriaRef | null>> => {
    if (locators.length === 0) {
      return []
    }

    // Get handles for target locators
    const targetHandles = await Promise.all(
      locators.map(async (loc) => {
        try {
          return 'elementHandle' in loc
            ? await (loc as Locator).elementHandle({ timeout: 1000 })
            : (loc as ElementHandle)
        } catch {
          return null
        }
      })
    )

    // Match in browser context
    const matchingRefs = await page.evaluate(
      ({ targets, refData }) => {
        return targets.map((target) => {
          if (!target) {
            return null
          }

          // Try to find this element's ref by checking test ID attributes
          const testIdAttrs = ['data-testid', 'data-test-id', 'data-test', 'data-cy', 'data-pw']
          for (const attr of testIdAttrs) {
            const value = (target as any).getAttribute(attr)
            if (value && refData.some((r: any) => r.ref === value || r.ref.startsWith(value))) {
              const match = refData.find((r: any) => r.ref === value || r.ref.startsWith(value))
              return match ? match.ref : null
            }
          }

          // Check id attribute
          const id = (target as any).getAttribute('id')
          if (id) {
            const match = refData.find((r: any) => r.ref === id || r.ref.startsWith(id))
            if (match) {
              return match.ref
            }
          }

          return null
        })
      },
      {
        targets: targetHandles,
        refData: result.refs,
      }
    )

    return matchingRefs.map((ref) => {
      if (!ref) {
        return null
      }
      const info = refToElement.get(ref)
      return info ? { ...info, ref } : null
    })
  }

  return {
    snapshot,
    refToElement,
    getSelectorForRef,
    getRefsForLocators,
    getRefForLocator: async (loc) => (await getRefsForLocators([loc]))[0],
    getRefStringForLocator: async (loc) => (await getRefsForLocators([loc]))[0]?.ref ?? null,
  }
}

/**
 * Show Vimium-style labels on interactive elements.
 * Labels are colored badges positioned above each element showing the ref.
 * Use with screenshots so agents can see which elements are interactive.
 *
 * Labels auto-hide after 30 seconds to prevent stale labels.
 * Call this function again if the page HTML changes to get fresh labels.
 *
 * @param page - Playwright page
 * @param locator - Optional locator to scope labels to a subtree
 * @param interactiveOnly - Only show labels for interactive elements (default: true)
 *
 * @example
 * ```ts
 * const { snapshot, labelCount } = await showAriaRefLabels({ page })
 * await page.screenshot({ path: '/tmp/screenshot.png' })
 * // Agent sees [submit-btn] label on "Submit" button
 * await page.locator('[data-testid="submit-btn"]').click()
 * ```
 */
export async function showAriaRefLabels({ page, locator, interactiveOnly = true, logger }: {
  page: Page
  locator?: Locator
  interactiveOnly?: boolean
  logger?: { info?: (...args: unknown[]) => void; error?: (...args: unknown[]) => void }
}): Promise<{
  snapshot: string
  labelCount: number
}> {
  const startTime = Date.now()
  await ensureA11yClient(page)

  const log = logger?.info ?? logger?.error
  if (log) {
    log(`ensureA11yClient: ${Date.now() - startTime}ms`)
  }

  // Determine root element
  const rootHandle = locator ? await locator.elementHandle() : null

  const computeStart = Date.now()
  const result = await page.evaluate(
    ({ root, interactiveOnly: intOnly }) => {
      const a11y = (globalThis as any).__a11y
      if (!a11y) {
        throw new Error('a11y client not loaded')
      }
      const rootElement = root || document.body
      return a11y.computeA11ySnapshot({
        root: rootElement,
        interactiveOnly: intOnly,
        renderLabels: true,
      })
    },
    {
      root: rootHandle,
      interactiveOnly,
    }
  )

  if (log) {
    log(`computeA11ySnapshot: ${Date.now() - computeStart}ms (${result.labelCount} labels)`)
  }

  return {
    snapshot: result.snapshot,
    labelCount: result.labelCount,
  }
}

/**
 * Remove all aria ref labels from the page.
 */
export async function hideAriaRefLabels({ page }: { page: Page }): Promise<void> {
  await page.evaluate(() => {
    const a11y = (globalThis as any).__a11y
    if (a11y) {
      a11y.hideA11yLabels()
    } else {
      // Fallback if client not loaded
      const doc = document
      const win = window as any
      const timerKey = '__playwriter_labels_timer__'
      if (win[timerKey]) {
        win.clearTimeout(win[timerKey])
        win[timerKey] = null
      }
      doc.getElementById('__playwriter_labels__')?.remove()
    }
  })
}

/**
 * Take a screenshot with accessibility labels overlaid on interactive elements.
 * Shows Vimium-style labels, captures the screenshot, then removes the labels.
 * The screenshot is automatically included in the MCP response.
 *
 * @param page - Playwright page
 * @param locator - Optional locator to scope labels to a subtree
 * @param collector - Array to collect screenshots (passed by MCP execute tool)
 *
 * @example
 * ```ts
 * await screenshotWithAccessibilityLabels({ page })
 * // Screenshot is automatically included in the MCP response
 * // Use ref from the snapshot to interact with elements
 * await page.locator('[data-testid="submit-btn"]').click()
 * ```
 */
export async function screenshotWithAccessibilityLabels({ page, locator, interactiveOnly = true, collector, logger }: {
  page: Page
  locator?: Locator
  interactiveOnly?: boolean
  collector: ScreenshotResult[]
  logger?: { info?: (...args: unknown[]) => void; error?: (...args: unknown[]) => void }
}): Promise<void> {
  const showLabelsStart = Date.now()
  const { snapshot, labelCount } = await showAriaRefLabels({ page, locator, interactiveOnly, logger })
  const log = logger?.info ?? logger?.error
  if (log) {
    log(`showAriaRefLabels: ${Date.now() - showLabelsStart}ms`)
  }

  // Generate unique filename with timestamp
  const timestamp = Date.now()
  const random = Math.random().toString(36).slice(2, 6)
  const filename = `playwriter-screenshot-${timestamp}-${random}.jpg`

  // Use ./tmp folder (gitignored) instead of system temp
  const tmpDir = path.join(process.cwd(), 'tmp')
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true })
  }
  const screenshotPath = path.join(tmpDir, filename)

  // Get viewport size to clip screenshot to visible area
  const viewport = await page.evaluate('({ width: window.innerWidth, height: window.innerHeight })') as { width: number; height: number }

  // Max 1568px on any edge (larger gets auto-resized by Claude, adding latency)
  // Token formula: tokens = (width * height) / 750
  const MAX_DIMENSION = 1568

  // Check if sharp is available for resizing
  const sharp = await sharpPromise

  // Clip dimensions: if sharp unavailable, limit capture area to MAX_DIMENSION
  const clipWidth = sharp ? viewport.width : Math.min(viewport.width, MAX_DIMENSION)
  const clipHeight = sharp ? viewport.height : Math.min(viewport.height, MAX_DIMENSION)

  // Take viewport screenshot with scale: 'css' to ignore device pixel ratio
  const rawBuffer = await page.screenshot({
    type: 'jpeg',
    quality: 80,
    scale: 'css',
    clip: { x: 0, y: 0, width: clipWidth, height: clipHeight },
  })

  // Resize with sharp if available, otherwise use clipped raw buffer
  const buffer = await (async () => {
    if (!sharp) {
      logger?.error?.('[playwriter] sharp not available, using clipped screenshot (max', MAX_DIMENSION, 'px)')
      return rawBuffer
    }
    try {
      return await sharp(rawBuffer)
        .resize({
          width: MAX_DIMENSION,
          height: MAX_DIMENSION,
          fit: 'inside', // Scale down to fit, preserving aspect ratio
          withoutEnlargement: true, // Don't upscale small images
        })
        .jpeg({ quality: 80 })
        .toBuffer()
    } catch (err) {
      logger?.error?.('[playwriter] sharp resize failed, using raw buffer:', err)
      return rawBuffer
    }
  })()

  // Save to file
  fs.writeFileSync(screenshotPath, buffer)

  // Convert to base64
  const base64 = buffer.toString('base64')

  // Hide labels
  await hideAriaRefLabels({ page })

  // Add to collector array
  collector.push({
    path: screenshotPath,
    base64,
    mimeType: 'image/jpeg',
    snapshot,
    labelCount,
  })
}

// Re-export for backward compatibility
export { getAriaSnapshot as getAriaSnapshotWithRefs }
