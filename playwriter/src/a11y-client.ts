/**
 * Browser-side accessibility label renderer.
 * Bundled and injected into page context via CDP.
 */

export interface LabelBox {
  x: number
  y: number
  width: number
  height: number
}

export interface A11yLabel {
  ref: string
  role: string
  box: LabelBox
}

// ============================================================================
// Constants
// ============================================================================

const LABELS_CONTAINER_ID = '__playwriter_labels__'
const LABELS_TIMER_KEY = '__playwriter_labels_timer__'

// Color scheme for labels by role
const ROLE_COLORS: Record<string, [string, string, string]> = {
  link: ['#FFF785', '#FFC542', '#E3BE23'],
  button: ['#FFE0B2', '#FFCC80', '#FFB74D'],
  textbox: ['#FFCDD2', '#EF9A9A', '#E57373'],
  combobox: ['#F8BBD0', '#F48FB1', '#F06292'],
  searchbox: ['#F8BBD0', '#F48FB1', '#F06292'],
  checkbox: ['#C8E6C9', '#A5D6A7', '#81C784'],
  radio: ['#C8E6C9', '#A5D6A7', '#81C784'],
  slider: ['#BBDEFB', '#90CAF9', '#64B5F6'],
  spinbutton: ['#BBDEFB', '#90CAF9', '#64B5F6'],
  switch: ['#D1C4E9', '#B39DDB', '#9575CD'],
  menuitem: ['#FFE0B2', '#FFCC80', '#FFB74D'],
  menuitemcheckbox: ['#FFE0B2', '#FFCC80', '#FFB74D'],
  menuitemradio: ['#FFE0B2', '#FFCC80', '#FFB74D'],
  option: ['#FFE0B2', '#FFCC80', '#FFB74D'],
  tab: ['#FFE0B2', '#FFCC80', '#FFB74D'],
  treeitem: ['#FFE0B2', '#FFCC80', '#FFB74D'],
  img: ['#B3E5FC', '#81D4FA', '#4FC3F7'],
  video: ['#B3E5FC', '#81D4FA', '#4FC3F7'],
  audio: ['#B3E5FC', '#81D4FA', '#4FC3F7'],
}

const DEFAULT_COLORS: [string, string, string] = ['#FFF9C4', '#FFF59D', '#FFEB3B']

// ============================================================================
// Label Rendering
// ============================================================================

function renderA11yLabels(labels: A11yLabel[]): number {
  const doc = document
  const win = window as typeof window & { [LABELS_TIMER_KEY]?: number | null }

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

  const viewportLeft = win.scrollX
  const viewportTop = win.scrollY
  const viewportRight = viewportLeft + win.innerWidth
  const viewportBottom = viewportTop + win.innerHeight

  let count = 0
  for (const { ref, role, box } of labels) {
    const rectLeft = box.x
    const rectTop = box.y
    const rectRight = rectLeft + box.width
    const rectBottom = rectTop + box.height

    if (box.width <= 0 || box.height <= 0) {
      continue
    }

    // Skip if outside viewport
    if (rectRight < viewportLeft || rectLeft > viewportRight || rectBottom < viewportTop || rectTop > viewportBottom) {
      continue
    }

    // Calculate label position
    const labelWidth = ref.length * LABEL_CHAR_WIDTH + 8
    const labelLeft = rectLeft
    const labelTop = Math.max(0, rectTop - LABEL_HEIGHT)
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
    label.style.left = `${labelLeft}px`
    label.style.top = `${labelTop}px`
    container.appendChild(label)

    // Draw connector line
    const line = doc.createElementNS('http://www.w3.org/2000/svg', 'line')
    const labelCenterX = labelLeft + labelWidth / 2
    const labelBottomY = labelTop + LABEL_HEIGHT
    const elementCenterX = rectLeft + box.width / 2
    const elementCenterY = rectTop + box.height / 2
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
// Hide Labels
// ============================================================================

export function hideA11yLabels(): void {
  const win = window as typeof window & { [LABELS_TIMER_KEY]?: number | null }
  if (win[LABELS_TIMER_KEY]) {
    win.clearTimeout(win[LABELS_TIMER_KEY])
    win[LABELS_TIMER_KEY] = null
  }
  document.getElementById(LABELS_CONTAINER_ID)?.remove()
}

// ============================================================================
// Expose on globalThis for injection
// ============================================================================

;(globalThis as { __a11y?: { renderA11yLabels: (labels: A11yLabel[]) => number; hideA11yLabels: () => void } }).__a11y = {
  renderA11yLabels,
  hideA11yLabels,
}
