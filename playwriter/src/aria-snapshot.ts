import type { Page, Locator, ElementHandle } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

// Import sharp at module level - resolves to null if not available
const sharpPromise = import('sharp')
  .then((m) => { return m.default })
  .catch(() => { return null })

// ============================================================================
// Aria Snapshot Format Documentation
// ============================================================================
//
// This module processes accessibility snapshots from Playwright's _snapshotForAI() method.
// The expected format is a YAML-like tree structure:
//
// ```
// - role "accessible name" [ref=eXX] [cursor=pointer] [active]:
//   - childRole "child name" [ref=eYY]:
//     - /url: https://example.com
//     - text: "raw text content"
// ```
//
// Key format assumptions:
// - Lines start with "- " followed by a role name (e.g., link, button, row, cell)
// - Accessible names are in double quotes: "name"
// - When names contain colons, the whole entry is single-quoted: - 'role "name: with colon"':
// - Element refs are in brackets: [ref=e123]
// - Attributes like [cursor=pointer], [active] may appear after the name
// - Child elements are indented (2 spaces per level)
// - URL metadata appears as: - /url: https://...
// - Raw text appears as: - text: "content"
//
// If Playwright changes this format, the parsing functions below will need updates.
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

    const match = trimmed.match(/^-\s+(\w+)(?:\s+"[^"]*")?(?:\s+\[[^\]]+\])*\s*\[ref=(\w+)\]/)
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
      cleanedLine = cleanedLine.replace(/\s*\[ref=\w+\]/g, '')
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
  const match = trimmed.match(/^-\s+(\w+)(?:\s+"([^"]*)")?(?:\s+\[ref=(\w+)\])?/)

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
// Ref Data Types (optimized - no ElementHandles stored upfront)
// ============================================================================

/**
 * Data stored for each ref - used to construct locators lazily
 */
export interface RefData {
  role: string
  name: string
  /** Index for disambiguation when multiple elements have same role+name */
  nth?: number
}

/**
 * Map from ref (e.g., "e5") to its data
 */
export type RefMap = Map<string, RefData>

// ============================================================================
// Original Aria Snapshot Types and Functions
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
  /** Map from ref to role/name data - use this for lookups */
  refToElement: Map<string, { role: string; name: string }>
  /** 
   * Get a Playwright locator for a ref. Returns null if ref not found.
   * Uses getByRole() internally for reliable element selection.
   */
  getLocatorForRef: (ref: string) => Locator | null
  /** Get ElementHandles for multiple refs in parallel (for labeling) */
  getElementHandlesForRefs: (refs: string[]) => Promise<Array<{ ref: string; handle: ElementHandle } | null>>
  /** Find refs for locators by matching in browser context */
  getRefsForLocators: (locators: Array<Locator | ElementHandle>) => Promise<Array<AriaRef | null>>
  getRefForLocator: (locator: Locator | ElementHandle) => Promise<AriaRef | null>
  getRefStringForLocator: (locator: Locator | ElementHandle) => Promise<string | null>
}

interface ElementLike {
  tagName: string
  textContent: string | null
  getAttribute: (name: string) => string | null
  hasAttribute: (name: string) => boolean
}

interface InputElementLike extends ElementLike {
  type?: string
  placeholder?: string
}

const LABELS_CONTAINER_ID = '__playwriter_labels__'

// Roles that represent interactive elements (clickable, typeable) and media elements
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
  // Media elements - useful for visual tasks
  'img',
  'video',
  'audio',
])

// Color categories for different role types - warm color scheme
// Format: [gradient-top, gradient-bottom, border]
const ROLE_COLORS: Record<string, [string, string, string]> = {
  // Links - yellow (Vimium-style)
  link: ['#FFF785', '#FFC542', '#E3BE23'],
  // Buttons - orange
  button: ['#FFE0B2', '#FFCC80', '#FFB74D'],
  // Text inputs - coral/red
  textbox: ['#FFCDD2', '#EF9A9A', '#E57373'],
  combobox: ['#FFCDD2', '#EF9A9A', '#E57373'],
  searchbox: ['#FFCDD2', '#EF9A9A', '#E57373'],
  spinbutton: ['#FFCDD2', '#EF9A9A', '#E57373'],
  // Checkboxes/Radios/Switches - warm pink
  checkbox: ['#F8BBD0', '#F48FB1', '#EC407A'],
  radio: ['#F8BBD0', '#F48FB1', '#EC407A'],
  switch: ['#F8BBD0', '#F48FB1', '#EC407A'],
  // Sliders - peach
  slider: ['#FFCCBC', '#FFAB91', '#FF8A65'],
  // Menu items - salmon
  menuitem: ['#FFAB91', '#FF8A65', '#FF7043'],
  menuitemcheckbox: ['#FFAB91', '#FF8A65', '#FF7043'],
  menuitemradio: ['#FFAB91', '#FF8A65', '#FF7043'],
  // Tabs/Options - amber
  tab: ['#FFE082', '#FFD54F', '#FFC107'],
  option: ['#FFE082', '#FFD54F', '#FFC107'],
  treeitem: ['#FFE082', '#FFD54F', '#FFC107'],
  // Media elements - light blue
  img: ['#B3E5FC', '#81D4FA', '#4FC3F7'],
  video: ['#B3E5FC', '#81D4FA', '#4FC3F7'],
  audio: ['#B3E5FC', '#81D4FA', '#4FC3F7'],
}

// Default yellow for unknown roles
const DEFAULT_COLORS: [string, string, string] = ['#FFF785', '#FFC542', '#E3BE23']

// Use String.raw for CSS syntax highlighting in editors
const css = String.raw

const LABEL_STYLES = css`
  .__pw_label__ {
    position: absolute;
    font: bold 12px Helvetica, Arial, sans-serif;
    padding: 1px 4px;
    border-radius: 3px;
    color: black;
    text-shadow: 0 1px 0 rgba(255, 255, 255, 0.6);
    white-space: nowrap;
  }
`

const CONTAINER_STYLES = css`
  position: absolute;
  left: 0;
  top: 0;
  z-index: 2147483647;
  pointer-events: none;
`

// ============================================================================
// Role/Name Tracking for nth disambiguation
// ============================================================================

interface RoleNameTracker {
  counts: Map<string, number>
  refsByKey: Map<string, string[]>
  getKey(role: string, name: string): string
  getNextIndex(role: string, name: string): number
  trackRef(role: string, name: string, ref: string): void
  getDuplicateKeys(): Set<string>
}

function createRoleNameTracker(): RoleNameTracker {
  const counts = new Map<string, number>()
  const refsByKey = new Map<string, string[]>()
  return {
    counts,
    refsByKey,
    getKey(role: string, name: string): string {
      return `${role}:${name}`
    },
    getNextIndex(role: string, name: string): number {
      const key = this.getKey(role, name)
      const current = counts.get(key) ?? 0
      counts.set(key, current + 1)
      return current
    },
    trackRef(role: string, name: string, ref: string): void {
      const key = this.getKey(role, name)
      const refs = refsByKey.get(key) ?? []
      refs.push(ref)
      refsByKey.set(key, refs)
    },
    getDuplicateKeys(): Set<string> {
      const duplicates = new Set<string>()
      for (const [key, refs] of refsByKey) {
        if (refs.length > 1) {
          duplicates.add(key)
        }
      }
      return duplicates
    },
  }
}

// Ref counter for generating refs (reset at start of each snapshot)
let refCounter = 0

function resetRefs(): void {
  refCounter = 0
}

function nextRef(): string {
  return `e${++refCounter}`
}

/**
 * Process ARIA snapshot: add refs to interactive elements.
 * Uses Playwright's public ariaSnapshot() API and generates our own refs.
 */
function processAriaTreeWithRefs(
  ariaTree: string,
  refMap: RefMap,
  refFilter?: (info: { role: string; name: string }) => boolean
): string {
  const lines = ariaTree.split('\n')
  const result: string[] = []
  const tracker = createRoleNameTracker()

  for (const line of lines) {
    if (!line.trim()) {
      result.push(line) // Preserve empty lines for structure
      continue
    }

    // Handle single-quote wrapped lines: - 'role "name with: colon"':
    // These occur when the name contains a colon
    let processedLine = line.trim()
    if (processedLine.startsWith("- '") && processedLine.includes("':")) {
      const innerMatch = processedLine.match(/^-\s+'(.+)'/)
      if (innerMatch) {
        processedLine = '- ' + innerMatch[1]
      }
    }

    // Match lines like: "  - button "Submit"" or "  - heading "Title" [level=1]"
    const match = processedLine.match(/^-\s*(\w+)(?:\s+"([^"]*)")?(.*)$/)
    if (!match) {
      // Keep metadata lines (like /url:) or text content as-is
      result.push(line)
      continue
    }

    const [, role, name, suffix] = match
    const prefix = line.slice(0, line.indexOf('-') + 2) // Preserve original indentation
    const roleLower = role.toLowerCase()
    const nameStr = name ?? ''

    // Check if this element should get a ref
    const isInteractive = INTERACTIVE_ROLES.has(roleLower)
    const shouldHaveRef = isInteractive && (!refFilter || refFilter({ role: roleLower, name: nameStr }))

    if (shouldHaveRef) {
      const ref = nextRef()
      const nth = tracker.getNextIndex(roleLower, nameStr)
      tracker.trackRef(roleLower, nameStr, ref)

      refMap.set(ref, {
        role: roleLower,
        name: nameStr,
        nth, // Always store nth, we'll clean up non-duplicates later
      })

      // Build enhanced line with ref
      let enhanced = `${prefix}${role}`
      if (name) {
        enhanced += ` "${name}"`
      }
      enhanced += ` [ref=${ref}]`
      if (suffix) {
        enhanced += suffix
      }
      result.push(enhanced)
    } else {
      // Keep line as-is (no ref)
      result.push(line)
    }
  }

  // Post-process: remove nth from refs that don't have duplicates
  const duplicateKeys = tracker.getDuplicateKeys()
  for (const [ref, data] of refMap) {
    const key = tracker.getKey(data.role, data.name)
    if (!duplicateKeys.has(key)) {
      // Use spread to create new object without nth (cleaner than delete)
      const { nth, ...rest } = data
      refMap.set(ref, rest as RefData)
    }
  }

  return result.join('\n')
}

/**
 * Get an accessibility snapshot with utilities to look up aria refs for elements.
 * 
 * Uses Playwright's public ariaSnapshot() API and generates our own refs.
 * This avoids dependency on internal _snapshotForAI() method.
 * Locators are constructed lazily using getByRole().
 *
 * @example
 * ```ts
 * const { snapshot, getLocatorForRef } = await getAriaSnapshot({ page })
 * // Get a locator for ref e5
 * const locator = getLocatorForRef('e5')
 * if (locator) await locator.click()
 * ```
 */
export async function getAriaSnapshot({ page, refFilter }: {
  page: Page
  refFilter?: (info: { role: string; name: string }) => boolean
}): Promise<AriaSnapshotResult> {
  // Reset ref counter for deterministic refs
  resetRefs()

  // Use public ariaSnapshot() API instead of internal _snapshotForAI()
  const rawSnapshot = await page.locator(':root').ariaSnapshot()
  
  // Sanitize to remove unpaired surrogates that break JSON encoding for Claude API
  const cleanSnapshot = rawSnapshot.toWellFormed?.() ?? rawSnapshot

  // Process the ARIA tree and generate refs for interactive elements
  const refData: RefMap = new Map()
  const snapshotWithRefs = processAriaTreeWithRefs(cleanSnapshot, refData, refFilter)

  // Build refToElement map for backward compatibility
  const refToElement = new Map<string, { role: string; name: string }>()
  for (const [ref, data] of refData) {
    refToElement.set(ref, { role: data.role, name: data.name })
  }

  /**
   * Get a Playwright locator for a ref using getByRole().
   * This is lazy - no async calls until the locator is used.
   */
  const getLocatorForRef = (ref: string): Locator | null => {
    const data = refData.get(ref)
    if (!data) {
      return null
    }

    // Build locator using getByRole with exact matching
    // For unnamed elements, use { name: '', exact: true } to match only elements
    // with empty accessible names, so nth disambiguation works correctly
    let locator = page.getByRole(data.role as any, { name: data.name, exact: true })

    // Apply nth if needed for disambiguation (multiple elements with same role+name)
    if (data.nth !== undefined) {
      locator = locator.nth(data.nth)
    }

    return locator
  }

  /**
   * Get ElementHandles for multiple refs in batches.
   * Used by showAriaRefLabels for batched bounding box fetching.
   * Processes in batches of 20 to avoid overwhelming the browser.
   */
  const getElementHandlesForRefs = async (refs: string[]): Promise<Array<{ ref: string; handle: ElementHandle } | null>> => {
    const BATCH_SIZE = 20
    const results: Array<{ ref: string; handle: ElementHandle } | null> = []

    for (let i = 0; i < refs.length; i += BATCH_SIZE) {
      const batch = refs.slice(i, i + BATCH_SIZE)
      const batchResults = await Promise.all(
        batch.map(async (ref) => {
          const locator = getLocatorForRef(ref)
          if (!locator) {
            return null
          }
          try {
            const handle = await locator.elementHandle({ timeout: 2000 })
            if (!handle) {
              return null
            }
            return { ref, handle }
          } catch {
            return null
          }
        })
      )
      results.push(...batchResults)
    }

    return results
  }

  /**
   * Find refs for multiple locators by matching elements in browser context.
   * This requires a single evaluate call to compare elements.
   */
  const getRefsForLocators = async (locators: Array<Locator | ElementHandle>): Promise<Array<AriaRef | null>> => {
    if (locators.length === 0 || refData.size === 0) {
      return locators.map(() => null)
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

    // Get handles for all refs
    const refList = [...refData.keys()]
    const refHandleResults = await getElementHandlesForRefs(refList)
    const validRefHandles = refHandleResults
      .filter((r): r is { ref: string; handle: ElementHandle } => r !== null)

    if (validRefHandles.length === 0) {
      return locators.map(() => null)
    }

    // Compare in browser context
    const matchingRefs = await page.evaluate(
      ({ targets, candidates }) => targets.map((target) => {
        if (!target) return null
        return candidates.find(({ element }) => element === target)?.ref ?? null
      }),
      {
        targets: targetHandles,
        candidates: validRefHandles.map(({ ref, handle }) => ({ ref, element: handle })),
      }
    )

    return matchingRefs.map((ref) => {
      if (!ref) return null
      const info = refToElement.get(ref)
      return info ? { ...info, ref } : null
    })
  }

  return {
    snapshot: snapshotWithRefs,
    refToElement,
    getLocatorForRef,
    getElementHandlesForRefs,
    getRefsForLocators,
    getRefForLocator: async (loc) => (await getRefsForLocators([loc]))[0],
    getRefStringForLocator: async (loc) => (await getRefsForLocators([loc]))[0]?.ref ?? null,
  }
}

/**
 * Show Vimium-style labels on interactive elements.
 * Labels are yellow badges positioned above each element showing the aria ref (e.g., "e1", "e2").
 * Use with screenshots so agents can see which elements are interactive.
 *
 * Labels auto-hide after 30 seconds to prevent stale labels remaining on the page.
 * Call this function again if the page HTML changes to get fresh labels.
 *
 * By default, only shows labels for truly interactive roles (button, link, textbox, etc.)
 * to reduce visual clutter. Set `interactiveOnly: false` to show all elements with refs.
 *
 * @example
 * ```ts
 * const { snapshot, labelCount } = await showAriaRefLabels({ page })
 * await page.screenshot({ path: '/tmp/screenshot.png' })
 * // Agent sees [e5] label on "Submit" button
 * await page.locator('aria-ref=e5').click()
 * // Labels auto-hide after 30 seconds, or call hideAriaRefLabels() manually
 * ```
 */
export async function showAriaRefLabels({ page, interactiveOnly = true, logger }: {
  page: Page
  interactiveOnly?: boolean
  logger?: { info?: (...args: unknown[]) => void; error?: (...args: unknown[]) => void }
}): Promise<{
  snapshot: string
  labelCount: number
}> {
  const getSnapshotStart = Date.now()
  const { snapshot, refToElement, getElementHandlesForRefs } = await getAriaSnapshot({
    page,
    refFilter: interactiveOnly ? (info) => { return INTERACTIVE_ROLES.has(info.role) } : undefined,
  })
  const log = logger?.info ?? logger?.error
  if (log) {
    log(`getAriaSnapshot: ${Date.now() - getSnapshotStart}ms`)
  }

  // Get element handles in parallel for all refs
  const getHandlesStart = Date.now()
  const refs = [...refToElement.keys()]
  const handleResults = await getElementHandlesForRefs(refs)
  const validHandles = handleResults
    .filter((r): r is { ref: string; handle: ElementHandle } => r !== null)
  if (log) {
    log(`getElementHandlesForRefs: ${Date.now() - getHandlesStart}ms (${validHandles.length}/${refs.length} refs)`)
  }

  // Build refs with role info for color coding
  const refsWithRoles = validHandles.map(({ ref, handle }) => ({
    ref,
    element: handle,
    role: refToElement.get(ref)?.role || 'generic',
  }))

  // Single evaluate call: create container, styles, and all labels
  // ElementHandles get unwrapped to DOM elements in browser context
  const labelCount = await page.evaluate(
    // Using 'any' for browser types since this runs in browser context
    function ({ refs, containerId, containerStyles, labelStyles, roleColors, defaultColors }: {
      refs: Array<{
        ref: string
        role: string
        element: any // Element in browser context
      }>
      containerId: string
      containerStyles: string
      labelStyles: string
      roleColors: Record<string, [string, string, string]>
      defaultColors: [string, string, string]
    }) {
      // Polyfill esbuild's __name helper which gets injected by vite-node but doesn't exist in browser
      ;(globalThis as any).__name ||= (fn: any) => fn
      const doc = (globalThis as any).document
      const win = globalThis as any

      // Cancel any pending auto-hide timer from previous call
      const timerKey = '__playwriter_labels_timer__'
      if (win[timerKey]) {
        win.clearTimeout(win[timerKey])
        win[timerKey] = null
      }

      // Remove existing labels if present (idempotent)
      doc.getElementById(containerId)?.remove()

      // Create container - absolute positioned, max z-index, no pointer events
      const container = doc.createElement('div')
      container.id = containerId
      container.style.cssText = containerStyles

      // Inject base label CSS
      const style = doc.createElement('style')
      style.textContent = labelStyles
      container.appendChild(style)

      // Track placed label rectangles for overlap detection
      // Each rect is { left, top, right, bottom } in viewport coordinates
      const placedLabels: Array<{ left: number; top: number; right: number; bottom: number }> = []

      // Estimate label dimensions (12px font + padding)
      const LABEL_HEIGHT = 17
      const LABEL_CHAR_WIDTH = 7 // approximate width per character

      // Parse alpha from rgb/rgba color string (getComputedStyle always returns these formats)
      function getColorAlpha(color: string): number {
        if (color === 'transparent') {
          return 0
        }
        // Match rgba(r, g, b, a) or rgb(r, g, b)
        const match = color.match(/rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*([\d.]+)\s*)?\)/)
        if (match) {
          return match[1] !== undefined ? parseFloat(match[1]) : 1
        }
        return 1 // Default to opaque for unrecognized formats
      }

      // Check if an element has an opaque background that would block elements behind it
      function isOpaqueElement(el: any): boolean {
        const style = win.getComputedStyle(el)

        // Check element opacity
        const opacity = parseFloat(style.opacity)
        if (opacity < 0.1) {
          return false
        }

        // Check background-color alpha
        const bgAlpha = getColorAlpha(style.backgroundColor)
        if (bgAlpha > 0.1) {
          return true
        }

        // Check if has background-image (usually opaque)
        if (style.backgroundImage !== 'none') {
          return true
        }

        return false
      }

      // Check if element is visible (not covered by opaque overlay)
      function isElementVisible(element: any, rect: any): boolean {
        const centerX = rect.left + rect.width / 2
        const centerY = rect.top + rect.height / 2

        // Get all elements at this point, from top to bottom
        const stack = doc.elementsFromPoint(centerX, centerY) as any[]

        // Find our target element in the stack
        let targetIndex = -1
        for (let i = 0; i < stack.length; i++) {
          if (element.contains(stack[i]) || stack[i].contains(element)) {
            targetIndex = i
            break
          }
        }

        // Element not in stack at all - not visible
        if (targetIndex === -1) {
          return false
        }

        // Check if any opaque element is above our target
        for (let i = 0; i < targetIndex; i++) {
          const el = stack[i]
          // Skip our own overlay container
          if (el.id === containerId) {
            continue
          }
          // Skip pointer-events: none elements (decorative overlays)
          if (win.getComputedStyle(el).pointerEvents === 'none') {
            continue
          }
          // If this element is opaque, our target is blocked
          if (isOpaqueElement(el)) {
            return false
          }
        }

        return true
      }

      // Check if two rectangles overlap
      function rectsOverlap(
        a: { left: number; top: number; right: number; bottom: number },
        b: { left: number; top: number; right: number; bottom: number }
      ) {
        return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
      }

      // Create SVG for connector lines
      const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;overflow:visible;'
      svg.setAttribute('width', `${doc.documentElement.scrollWidth}`)
      svg.setAttribute('height', `${doc.documentElement.scrollHeight}`)

      // Create defs for arrow markers (one per color)
      const defs = doc.createElementNS('http://www.w3.org/2000/svg', 'defs')
      svg.appendChild(defs)
      const markerCache: Record<string, string> = {}

      function getArrowMarkerId(color: string): string {
        if (markerCache[color]) {
          return markerCache[color]
        }
        const markerId = `arrow-${color.replace('#', '')}`
        const marker = doc.createElementNS('http://www.w3.org/2000/svg', 'marker')
        marker.setAttribute('id', markerId)
        marker.setAttribute('viewBox', '0 0 10 10')
        marker.setAttribute('refX', '9')
        marker.setAttribute('refY', '5')
        marker.setAttribute('markerWidth', '6')
        marker.setAttribute('markerHeight', '6')
        marker.setAttribute('orient', 'auto-start-reverse')
        const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path')
        path.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z')
        path.setAttribute('fill', color)
        marker.appendChild(path)
        defs.appendChild(marker)
        markerCache[color] = markerId
        return markerId
      }

      container.appendChild(svg)

      // Create label for each interactive element
      let count = 0
      for (const { ref, role, element } of refs) {
        const rect = element.getBoundingClientRect()

        // Skip elements with no size (hidden)
        if (rect.width === 0 || rect.height === 0) {
          continue
        }

        // Skip elements that are covered by opaque overlays
        if (!isElementVisible(element, rect)) {
          continue
        }

        // Calculate label position and dimensions
        const labelWidth = ref.length * LABEL_CHAR_WIDTH + 8 // +8 for padding
        const labelLeft = rect.left
        const labelTop = Math.max(0, rect.top - LABEL_HEIGHT)
        const labelRect = {
          left: labelLeft,
          top: labelTop,
          right: labelLeft + labelWidth,
          bottom: labelTop + LABEL_HEIGHT,
        }

        // Skip if this label would overlap with any already-placed label
        let overlaps = false
        for (const placed of placedLabels) {
          if (rectsOverlap(labelRect, placed)) {
            overlaps = true
            break
          }
        }
        if (overlaps) {
          continue
        }

        // Get colors for this role
        const [gradTop, gradBottom, border] = roleColors[role] || defaultColors

        // Place the label
        const label = doc.createElement('div')
        label.className = '__pw_label__'
        label.textContent = ref
        label.style.background = `linear-gradient(to bottom, ${gradTop} 0%, ${gradBottom} 100%)`
        label.style.border = `1px solid ${border}`

        // Position above element, accounting for scroll
        label.style.left = `${win.scrollX + labelLeft}px`
        label.style.top = `${win.scrollY + labelTop}px`

        container.appendChild(label)

        // Draw connector line from label bottom-center to element center with arrow
        const line = doc.createElementNS('http://www.w3.org/2000/svg', 'line')
        const labelCenterX = win.scrollX + labelLeft + labelWidth / 2
        const labelBottomY = win.scrollY + labelTop + LABEL_HEIGHT
        const elementCenterX = win.scrollX + rect.left + rect.width / 2
        const elementCenterY = win.scrollY + rect.top + rect.height / 2
        line.setAttribute('x1', `${labelCenterX}`)
        line.setAttribute('y1', `${labelBottomY}`)
        line.setAttribute('x2', `${elementCenterX}`)
        line.setAttribute('y2', `${elementCenterY}`)
        line.setAttribute('stroke', border)
        line.setAttribute('stroke-width', '1.5')
        line.setAttribute('marker-end', `url(#${getArrowMarkerId(border)})`)
        svg.appendChild(line)

        placedLabels.push(labelRect)
        count++
      }

      doc.documentElement.appendChild(container)

      // Auto-hide labels after 30 seconds to prevent stale labels
      // Store timer ID so it can be cancelled if showAriaRefLabels is called again
      win[timerKey] = win.setTimeout(function() {
        doc.getElementById(containerId)?.remove()
        win[timerKey] = null
      }, 30000)

      return count
    },
    {
      refs: refsWithRoles.map(({ ref, role, element }) => ({ ref, role, element })),
      containerId: LABELS_CONTAINER_ID,
      containerStyles: CONTAINER_STYLES,
      labelStyles: LABEL_STYLES,
      roleColors: ROLE_COLORS,
      defaultColors: DEFAULT_COLORS,
    }
  )

  return { snapshot, labelCount }
}

/**
 * Remove all aria ref labels from the page.
 */
export async function hideAriaRefLabels({ page }: { page: Page }): Promise<void> {
  await page.evaluate((id) => {
    const doc = (globalThis as any).document
    const win = globalThis as any

    // Cancel any pending auto-hide timer
    const timerKey = '__playwriter_labels_timer__'
    if (win[timerKey]) {
      win.clearTimeout(win[timerKey])
      win[timerKey] = null
    }

    doc.getElementById(id)?.remove()
  }, LABELS_CONTAINER_ID)
}

/**
 * Take a screenshot with accessibility labels overlaid on interactive elements.
 * Shows Vimium-style labels, captures the screenshot, then removes the labels.
 * The screenshot is automatically included in the MCP response.
 *
 * @param collector - Array to collect screenshots (passed by MCP execute tool)
 *
 * @example
 * ```ts
 * await screenshotWithAccessibilityLabels({ page })
 * // Screenshot is automatically included in the MCP response
 * // Use aria-ref from the snapshot to interact with elements
 * await page.locator('aria-ref=e5').click()
 * ```
 */
export async function screenshotWithAccessibilityLabels({ page, interactiveOnly = true, collector, logger }: {
  page: Page
  interactiveOnly?: boolean
  collector: ScreenshotResult[]
  logger?: { info?: (...args: unknown[]) => void; error?: (...args: unknown[]) => void }
}): Promise<void> {
  const showLabelsStart = Date.now()
  const { snapshot, labelCount } = await showAriaRefLabels({ page, interactiveOnly, logger })
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
