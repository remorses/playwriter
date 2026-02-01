/**
 * Browser-side accessibility snapshot code.
 * Bundled and injected into page context via CDP.
 * Uses dom-accessibility-api for spec-compliant accessible name computation.
 */

import { computeAccessibleName, getRole } from 'dom-accessibility-api'

// ============================================================================
// Types
// ============================================================================

export interface A11yElement {
  ref: string
  role: string
  name: string
  element: Element
}

export interface A11ySnapshotResult {
  snapshot: string
  labelCount: number
  refs: Array<{ ref: string; role: string; name: string }>
}

export interface ComputeSnapshotOptions {
  root: Element
  interactiveOnly: boolean
  renderLabels: boolean
}

// ============================================================================
// Constants
// ============================================================================

const LABELS_CONTAINER_ID = '__playwriter_labels__'
const LABELS_TIMER_KEY = '__playwriter_labels_timer__'

// Interactive roles - elements users can click, type into, or interact with
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
  // Media elements
  'img',
  'video',
  'audio',
])

// CSS selectors for interactive elements
const INTERACTIVE_SELECTORS = [
  'button',
  'a[href]',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="slider"]',
  '[role="spinbutton"]',
  '[role="combobox"]',
  '[role="searchbox"]',
  '[role="textbox"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="option"]',
  '[role="tab"]',
  '[role="treeitem"]',
  'img[alt]',
  'img[aria-label]',
  '[role="img"]',
  'video',
  'audio',
  // Contenteditable
  '[contenteditable="true"]',
  '[contenteditable=""]',
].join(', ')

// Color scheme for labels by role
const ROLE_COLORS: Record<string, [string, string, string]> = {
  link: ['#FFF785', '#FFC542', '#E3BE23'],
  button: ['#FFE0B2', '#FFCC80', '#FFB74D'],
  textbox: ['#FFCDD2', '#EF9A9A', '#E57373'],
  combobox: ['#FFCDD2', '#EF9A9A', '#E57373'],
  searchbox: ['#FFCDD2', '#EF9A9A', '#E57373'],
  spinbutton: ['#FFCDD2', '#EF9A9A', '#E57373'],
  checkbox: ['#F8BBD0', '#F48FB1', '#EC407A'],
  radio: ['#F8BBD0', '#F48FB1', '#EC407A'],
  switch: ['#F8BBD0', '#F48FB1', '#EC407A'],
  slider: ['#FFCCBC', '#FFAB91', '#FF8A65'],
  menuitem: ['#FFAB91', '#FF8A65', '#FF7043'],
  menuitemcheckbox: ['#FFAB91', '#FF8A65', '#FF7043'],
  menuitemradio: ['#FFAB91', '#FF8A65', '#FF7043'],
  tab: ['#FFE082', '#FFD54F', '#FFC107'],
  option: ['#FFE082', '#FFD54F', '#FFC107'],
  treeitem: ['#FFE082', '#FFD54F', '#FFC107'],
  img: ['#B3E5FC', '#81D4FA', '#4FC3F7'],
  video: ['#B3E5FC', '#81D4FA', '#4FC3F7'],
  audio: ['#B3E5FC', '#81D4FA', '#4FC3F7'],
}
const DEFAULT_COLORS: [string, string, string] = ['#FFF785', '#FFC542', '#E3BE23']

// ============================================================================
// Ref Generation - Prefer stable test IDs
// ============================================================================

// Test ID attributes to check, in priority order
const TEST_ID_ATTRS = [
  'data-testid',
  'data-test-id',
  'data-test',
  'data-cy', // Cypress
  'data-pw', // Playwright
]

// Patterns that indicate auto-generated/unstable IDs
const UNSTABLE_ID_PATTERNS = [
  /^:r[a-z0-9]+:$/i,  // React useId() pattern like :r0:, :r1a:
  /^radix-/i,         // Radix UI
  /^headlessui-/i,    // Headless UI
  /^react-select-/i,  // React Select
  /^rc-/i,            // Ant Design
  /^mui-/i,           // Material UI
  /^\d+$/,            // Pure numbers
  /^[a-f0-9-]{36}$/i, // UUIDs
  /^[a-f0-9]{8,}$/i,  // Long hex strings
]

function isStableId(id: string): boolean {
  if (!id || id.length < 2) {
    return false
  }
  return !UNSTABLE_ID_PATTERNS.some((pattern) => pattern.test(id))
}

function getStableRef(element: Element): string | null {
  // Check test ID attributes first
  for (const attr of TEST_ID_ATTRS) {
    const value = element.getAttribute(attr)
    if (value && value.length > 0) {
      return value
    }
  }

  // Check regular id if it looks stable
  const id = element.getAttribute('id')
  if (id && isStableId(id)) {
    return id
  }

  return null
}

// ============================================================================
// Role Computation
// ============================================================================

function computeRole(element: Element): string {
  // First try dom-accessibility-api
  const computedRole = getRole(element)
  if (computedRole) {
    return computedRole
  }

  // Fallback for common elements
  const tagName = element.tagName.toLowerCase()
  const type = (element as HTMLInputElement).type?.toLowerCase() || ''

  const roleMap: Record<string, string | Record<string, string>> = {
    a: (element as HTMLAnchorElement).href ? 'link' : 'generic',
    button: 'button',
    input: {
      button: 'button',
      submit: 'button',
      reset: 'button',
      checkbox: 'checkbox',
      radio: 'radio',
      text: 'textbox',
      email: 'textbox',
      password: 'textbox',
      search: 'searchbox',
      tel: 'textbox',
      url: 'textbox',
      number: 'spinbutton',
      range: 'slider',
    },
    select: 'combobox',
    textarea: 'textbox',
    img: 'img',
    video: 'video',
    audio: 'audio',
  }

  const mapping = roleMap[tagName]
  if (typeof mapping === 'string') {
    return mapping
  }
  if (typeof mapping === 'object' && type in mapping) {
    return mapping[type]
  }
  if (tagName === 'input') {
    return 'textbox'
  }

  return 'generic'
}

// ============================================================================
// Visibility Checks
// ============================================================================

function isElementVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect()

  // Skip elements with no size
  if (rect.width === 0 || rect.height === 0) {
    return false
  }

  // Skip elements outside viewport
  if (rect.bottom < 0 || rect.top > window.innerHeight) {
    return false
  }
  if (rect.right < 0 || rect.left > window.innerWidth) {
    return false
  }

  // Check computed style
  const style = window.getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false
  }

  return true
}

function isElementCovered(element: Element, rect: DOMRect): boolean {
  const centerX = rect.left + rect.width / 2
  const centerY = rect.top + rect.height / 2

  const stack = document.elementsFromPoint(centerX, centerY)

  // Find our element in the stack
  let targetIndex = -1
  for (let i = 0; i < stack.length; i++) {
    if (element.contains(stack[i]) || stack[i].contains(element) || stack[i] === element) {
      targetIndex = i
      break
    }
  }

  if (targetIndex === -1) {
    return true // Not found = covered
  }

  // Check if any opaque element is above our target
  for (let i = 0; i < targetIndex; i++) {
    const el = stack[i]
    if ((el as HTMLElement).id === LABELS_CONTAINER_ID) {
      continue
    }
    const elStyle = window.getComputedStyle(el)
    if (elStyle.pointerEvents === 'none') {
      continue
    }
    // Check if element has opaque background
    const bgAlpha = parseColorAlpha(elStyle.backgroundColor)
    if (bgAlpha > 0.1) {
      return true
    }
    if (elStyle.backgroundImage !== 'none') {
      return true
    }
  }

  return false
}

function parseColorAlpha(color: string): number {
  if (color === 'transparent') {
    return 0
  }
  const match = color.match(/rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*([\d.]+)\s*)?\)/)
  if (match) {
    return match[1] !== undefined ? parseFloat(match[1]) : 1
  }
  return 1
}

// ============================================================================
// Label Rendering
// ============================================================================

function renderLabels(elements: A11yElement[]): number {
  const doc = document
  const win = window as any

  // Cancel any pending auto-hide timer
  if (win[LABELS_TIMER_KEY]) {
    win.clearTimeout(win[LABELS_TIMER_KEY])
    win[LABELS_TIMER_KEY] = null
  }

  // Remove existing labels
  doc.getElementById(LABELS_CONTAINER_ID)?.remove()

  // Create container
  const container = doc.createElement('div')
  container.id = LABELS_CONTAINER_ID
  container.style.cssText = 'position:absolute;left:0;top:0;z-index:2147483647;pointer-events:none;'

  // Inject styles
  const style = doc.createElement('style')
  style.textContent = `
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
  container.appendChild(style)

  // Create SVG for connector lines
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;overflow:visible;'
  svg.setAttribute('width', `${doc.documentElement.scrollWidth}`)
  svg.setAttribute('height', `${doc.documentElement.scrollHeight}`)

  // Arrow markers
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

  // Track placed labels for overlap detection
  const placedLabels: Array<{ left: number; top: number; right: number; bottom: number }> = []
  const LABEL_HEIGHT = 17
  const LABEL_CHAR_WIDTH = 7

  let count = 0
  for (const { ref, role, element } of elements) {
    const rect = element.getBoundingClientRect()

    // Skip if covered
    if (isElementCovered(element, rect)) {
      continue
    }

    // Calculate label position
    const labelWidth = ref.length * LABEL_CHAR_WIDTH + 8
    const labelLeft = rect.left
    const labelTop = Math.max(0, rect.top - LABEL_HEIGHT)
    const labelRect = {
      left: labelLeft,
      top: labelTop,
      right: labelLeft + labelWidth,
      bottom: labelTop + LABEL_HEIGHT,
    }

    // Check overlap
    let overlaps = false
    for (const placed of placedLabels) {
      if (
        labelRect.left < placed.right &&
        labelRect.right > placed.left &&
        labelRect.top < placed.bottom &&
        labelRect.bottom > placed.top
      ) {
        overlaps = true
        break
      }
    }
    if (overlaps) {
      continue
    }

    // Get colors
    const [gradTop, gradBottom, border] = ROLE_COLORS[role] || DEFAULT_COLORS

    // Create label
    const label = doc.createElement('div')
    label.className = '__pw_label__'
    label.textContent = ref
    label.style.background = `linear-gradient(to bottom, ${gradTop} 0%, ${gradBottom} 100%)`
    label.style.border = `1px solid ${border}`
    label.style.left = `${win.scrollX + labelLeft}px`
    label.style.top = `${win.scrollY + labelTop}px`
    container.appendChild(label)

    // Draw connector line
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

  // Auto-hide after 30 seconds
  win[LABELS_TIMER_KEY] = win.setTimeout(() => {
    doc.getElementById(LABELS_CONTAINER_ID)?.remove()
    win[LABELS_TIMER_KEY] = null
  }, 30000)

  return count
}

// ============================================================================
// Snapshot Generation
// ============================================================================

function buildSnapshotLine(role: string, name: string, ref: string, indent: number): string {
  const prefix = '  '.repeat(indent)
  let line = `${prefix}- ${role}`
  if (name) {
    // Escape quotes in name
    const escapedName = name.replace(/"/g, '\\"')
    line += ` "${escapedName}"`
  }
  line += ` [ref=${ref}]`
  return line
}

// ============================================================================
// Main Entry Point
// ============================================================================

export function computeA11ySnapshot(options: ComputeSnapshotOptions): A11ySnapshotResult {
  const { root, interactiveOnly, renderLabels: shouldRenderLabels } = options

  // Query all interactive elements within root
  const elements = root.querySelectorAll(INTERACTIVE_SELECTORS)

  // Track refs for deduplication
  const refCounts = new Map<string, number>()
  const a11yElements: A11yElement[] = []
  let fallbackCounter = 0

  for (const element of elements) {
    // Skip invisible elements
    if (!isElementVisible(element)) {
      continue
    }

    // Compute role
    const role = computeRole(element)

    // Filter to interactive only if requested
    if (interactiveOnly && !INTERACTIVE_ROLES.has(role)) {
      continue
    }

    // Compute accessible name
    let name = ''
    try {
      name = computeAccessibleName(element) || ''
    } catch {
      // Fallback to basic name computation
      name =
        element.getAttribute('aria-label') ||
        element.getAttribute('alt') ||
        element.getAttribute('title') ||
        (element.textContent || '').trim().slice(0, 100) ||
        ''
    }

    // Generate ref - prefer stable test IDs
    let baseRef = getStableRef(element)
    if (!baseRef) {
      fallbackCounter++
      baseRef = `e${fallbackCounter}`
    }

    // Handle duplicates by appending count
    const count = refCounts.get(baseRef) || 0
    refCounts.set(baseRef, count + 1)
    const ref = count === 0 ? baseRef : `${baseRef}-${count + 1}`

    a11yElements.push({ ref, role, name, element })
  }

  // Build snapshot string
  const snapshotLines = a11yElements.map(({ ref, role, name }) => {
    return buildSnapshotLine(role, name, ref, 0)
  })
  const snapshot = snapshotLines.join('\n')

  // Render labels if requested
  let labelCount = 0
  if (shouldRenderLabels) {
    labelCount = renderLabels(a11yElements)
  }

  // Return refs without element references (can't serialize DOM elements)
  const refs = a11yElements.map(({ ref, role, name }) => ({ ref, role, name }))

  return { snapshot, labelCount, refs }
}

// ============================================================================
// Hide Labels
// ============================================================================

export function hideA11yLabels(): void {
  const win = window as any
  if (win[LABELS_TIMER_KEY]) {
    win.clearTimeout(win[LABELS_TIMER_KEY])
    win[LABELS_TIMER_KEY] = null
  }
  document.getElementById(LABELS_CONTAINER_ID)?.remove()
}

// ============================================================================
// Expose on globalThis for injection
// ============================================================================

;(globalThis as any).__a11y = {
  computeA11ySnapshot,
  hideA11yLabels,
}
