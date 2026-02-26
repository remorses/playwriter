/**
 * Browser-side ghost cursor renderer.
 * Injected into the page to visualize automated mouse actions with smooth easing.
 */

import { SCREENSTUDIO_POINTER_MACOS_TAHOE_DATA_URL } from './assets/cursors/screen-studio/pointer-macos-tahoe-data-url.js'

type GhostCursorActionType = 'move' | 'down' | 'up' | 'wheel'
type GhostCursorButton = 'left' | 'right' | 'middle' | 'none'
type GhostCursorStyle = 'minimal' | 'dot' | 'screenstudio'

interface GhostCursorAction {
  type: GhostCursorActionType
  x: number
  y: number
  button: GhostCursorButton
}

export interface GhostCursorClientOptions {
  style?: GhostCursorStyle
  color?: string
  size?: number
  zIndex?: number
  easing?: string
  minDurationMs?: number
  maxDurationMs?: number
  speedPxPerMs?: number
}

interface GhostCursorRuntimeOptions {
  style: GhostCursorStyle
  color: string
  size: number
  zIndex: number
  easing: string
  minDurationMs: number
  maxDurationMs: number
  speedPxPerMs: number
}

interface GhostCursorRuntimeState {
  cursorElement: ReturnType<typeof createCursorElement> | null
  options: GhostCursorRuntimeOptions
  x: number
  y: number
  scale: number
  hasPosition: boolean
  enabled: boolean
}

interface GhostCursorApi {
  enable: (options?: GhostCursorClientOptions) => void
  disable: () => void
  applyMouseAction: (action: GhostCursorAction) => void
  isEnabled: () => boolean
}

declare global {
  var __playwriterGhostCursor: GhostCursorApi | undefined
}

const CURSOR_ID = '__playwriter_ghost_cursor__'
const SCREENSTUDIO_POINTER_ASPECT_RATIO = 618 / 958
const SCREENSTUDIO_HOTSPOT_X_RATIO = 0.14
const SCREENSTUDIO_HOTSPOT_Y_RATIO = 0.06
const MINIMAL_TRIANGLE_HOTSPOT_X_RATIO = 0.07
const MINIMAL_TRIANGLE_HOTSPOT_Y_RATIO = 0.06

const DEFAULT_OPTIONS: GhostCursorRuntimeOptions = {
  style: 'minimal',
  color: '#111827',
  size: 22,
  zIndex: 2147483647,
  easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
  minDurationMs: 24,
  maxDurationMs: 320,
  speedPxPerMs: 4,
}

const runtime: GhostCursorRuntimeState = {
  cursorElement: null,
  options: DEFAULT_OPTIONS,
  x: 0,
  y: 0,
  scale: 1,
  hasPosition: false,
  enabled: false,
}

function clamp(options: { value: number; min: number; max: number }): number {
  const { value, min, max } = options
  return Math.min(max, Math.max(min, value))
}

function mergeOptions(options?: GhostCursorClientOptions): GhostCursorRuntimeOptions {
  if (!options) {
    return DEFAULT_OPTIONS
  }

  return {
    style: options.style ?? DEFAULT_OPTIONS.style,
    color: options.color ?? DEFAULT_OPTIONS.color,
    size: options.size ?? DEFAULT_OPTIONS.size,
    zIndex: options.zIndex ?? DEFAULT_OPTIONS.zIndex,
    easing: options.easing ?? DEFAULT_OPTIONS.easing,
    minDurationMs: options.minDurationMs ?? DEFAULT_OPTIONS.minDurationMs,
    maxDurationMs: options.maxDurationMs ?? DEFAULT_OPTIONS.maxDurationMs,
    speedPxPerMs: options.speedPxPerMs ?? DEFAULT_OPTIONS.speedPxPerMs,
  }
}

function getCursorDimensions(): { width: number; height: number } {
  if (runtime.options.style === 'screenstudio') {
    const height = runtime.options.size
    const width = Math.max(10, Math.round(height * SCREENSTUDIO_POINTER_ASPECT_RATIO))
    return { width, height }
  }

  if (runtime.options.style === 'minimal') {
    const size = Math.max(12, runtime.options.size)
    return { width: size, height: size }
  }

  return { width: runtime.options.size, height: runtime.options.size }
}

function getHotspotOffsetPx(): { x: number; y: number } {
  const dimensions = getCursorDimensions()

  if (runtime.options.style === 'screenstudio') {
    return {
      x: Math.round(dimensions.width * SCREENSTUDIO_HOTSPOT_X_RATIO),
      y: Math.round(dimensions.height * SCREENSTUDIO_HOTSPOT_Y_RATIO),
    }
  }

  if (runtime.options.style === 'minimal') {
    return {
      x: Math.round(dimensions.width * MINIMAL_TRIANGLE_HOTSPOT_X_RATIO),
      y: Math.round(dimensions.height * MINIMAL_TRIANGLE_HOTSPOT_Y_RATIO),
    }
  }

  return {
    x: Math.round(dimensions.width / 2),
    y: Math.round(dimensions.height / 2),
  }
}

function getBaseOpacity(): string {
  if (runtime.options.style === 'screenstudio') {
    return '0.95'
  }

  if (runtime.options.style === 'minimal') {
    return '1'
  }

  return '0.72'
}

function applyTransform(): void {
  if (!runtime.cursorElement) {
    return
  }

  const hotspot = getHotspotOffsetPx()
  runtime.cursorElement.style.transform = `translate3d(${runtime.x - hotspot.x}px, ${runtime.y - hotspot.y}px, 0) scale(${runtime.scale})`
}

function computeDurationMs(options: { targetX: number; targetY: number }): number {
  if (!runtime.hasPosition) {
    return 0
  }

  const dx = options.targetX - runtime.x
  const dy = options.targetY - runtime.y
  const distance = Math.hypot(dx, dy)
  const rawDurationMs = distance / runtime.options.speedPxPerMs

  return clamp({
    value: rawDurationMs,
    min: runtime.options.minDurationMs,
    max: runtime.options.maxDurationMs,
  })
}

function createCursorElement() {
  const element = document.createElement('div')
  element.id = CURSOR_ID
  element.setAttribute('aria-hidden', 'true')
  element.style.position = 'fixed'
  element.style.left = '0'
  element.style.top = '0'
  element.style.pointerEvents = 'none'
  element.style.zIndex = `${runtime.options.zIndex}`
  element.style.opacity = getBaseOpacity()
  element.style.transitionProperty = 'transform, opacity'
  element.style.transitionTimingFunction = runtime.options.easing
  element.style.transitionDuration = '0ms'
  element.style.willChange = 'transform'

  runtime.cursorElement = element
  applyRuntimeVisualOptions()

  return element
}

function ensureCursorElement() {
  const existing = document.getElementById(CURSOR_ID)
  if (existing) {
    runtime.cursorElement = existing
    return existing
  }

  const element = createCursorElement()
  runtime.cursorElement = element
  const root = document.documentElement || document.body
  root.appendChild(element)
  return element
}

function applyRuntimeVisualOptions(): void {
  if (!runtime.cursorElement) {
    return
  }

  const dimensions = getCursorDimensions()
  runtime.cursorElement.style.width = `${dimensions.width}px`
  runtime.cursorElement.style.height = `${dimensions.height}px`
  runtime.cursorElement.style.zIndex = `${runtime.options.zIndex}`
  runtime.cursorElement.style.transitionTimingFunction = runtime.options.easing

  if (runtime.options.style === 'screenstudio') {
    runtime.cursorElement.style.borderRadius = '0'
    runtime.cursorElement.style.border = 'none'
    runtime.cursorElement.style.backgroundColor = 'transparent'
    runtime.cursorElement.style.backgroundImage = `url("${SCREENSTUDIO_POINTER_MACOS_TAHOE_DATA_URL}")`
    runtime.cursorElement.style.backgroundRepeat = 'no-repeat'
    runtime.cursorElement.style.backgroundPosition = 'left top'
    runtime.cursorElement.style.backgroundSize = 'contain'
    runtime.cursorElement.style.backdropFilter = 'none'
    runtime.cursorElement.style.filter = 'none'
    runtime.cursorElement.style.boxShadow = 'none'
    runtime.cursorElement.style.opacity = getBaseOpacity()
    return
  }

  if (runtime.options.style === 'minimal') {
    const triangleSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><path fill="${runtime.options.color}" d="m23.284 19.124l-6.866-6.895a.4.4 0 0 1-.118-.296a.43.43 0 0 1 .163-.282l4.439-3.077a1.48 1.48 0 0 0 .621-1.48a1.48 1.48 0 0 0-1.036-1.198L1.623.302a1.14 1.14 0 0 0-1.11.282A1.13 1.13 0 0 0 .29 1.649L5.928 20.44a1.48 1.48 0 0 0 1.183 1.035a1.48 1.48 0 0 0 1.48-.621l3.078-4.44a.37.37 0 0 1 .31-.118a.43.43 0 0 1 .296.104l6.91 6.91a1.48 1.48 0 0 0 2.087 0l2.086-2.086a1.48 1.48 0 0 0-.074-2.101"/></svg>`
    const triangleDataUrl = `url("data:image/svg+xml,${encodeURIComponent(triangleSvg)}")`
    runtime.cursorElement.style.borderRadius = '0'
    runtime.cursorElement.style.border = 'none'
    runtime.cursorElement.style.backgroundColor = 'transparent'
    runtime.cursorElement.style.backgroundImage = triangleDataUrl
    runtime.cursorElement.style.backgroundRepeat = 'no-repeat'
    runtime.cursorElement.style.backgroundSize = 'contain'
    runtime.cursorElement.style.backgroundPosition = 'left top'
    runtime.cursorElement.style.backdropFilter = 'none'
    runtime.cursorElement.style.boxShadow = 'none'
    runtime.cursorElement.style.filter = 'drop-shadow(0 1px 1px rgba(0, 0, 0, 0.3))'
    runtime.cursorElement.style.opacity = getBaseOpacity()
    return
  }

  runtime.cursorElement.style.borderRadius = '999px'
  runtime.cursorElement.style.border = 'none'
  runtime.cursorElement.style.backgroundColor = runtime.options.color
  runtime.cursorElement.style.backgroundImage = 'none'
  runtime.cursorElement.style.backdropFilter = 'none'
  runtime.cursorElement.style.filter = 'none'
  runtime.cursorElement.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.18), inset 0 0 0 2px rgba(255, 255, 255, 0.55)'
  runtime.cursorElement.style.opacity = getBaseOpacity()
}

function moveCursor(options: { x: number; y: number }): void {
  if (!runtime.enabled) {
    return
  }

  const element = ensureCursorElement()
  const durationMs = computeDurationMs({ targetX: options.x, targetY: options.y })
  element.style.transitionDuration = `${Math.round(durationMs)}ms`

  runtime.x = options.x
  runtime.y = options.y
  runtime.hasPosition = true
  applyTransform()
}

function setPressed(options: { pressed: boolean }): void {
  if (!runtime.enabled) {
    return
  }

  const element = ensureCursorElement()
  runtime.scale = options.pressed
    ? runtime.options.style === 'screenstudio'
      ? 0.94
      : runtime.options.style === 'minimal'
        ? 0.93
      : 0.82
    : 1
  element.style.opacity = options.pressed ? '1' : getBaseOpacity()
  applyTransform()
}

function enable(options?: GhostCursorClientOptions): void {
  runtime.options = mergeOptions(options)
  runtime.enabled = true
  ensureCursorElement()
  applyRuntimeVisualOptions()

  if (!runtime.hasPosition) {
    runtime.x = Math.round(window.innerWidth / 2)
    runtime.y = Math.round(window.innerHeight / 2)
    runtime.scale = 1
    runtime.hasPosition = true
  }

  applyTransform()
}

function disable(): void {
  runtime.enabled = false
  runtime.scale = 1
  runtime.hasPosition = false

  if (runtime.cursorElement) {
    runtime.cursorElement.remove()
    runtime.cursorElement = null
  }
}

function applyMouseAction(action: GhostCursorAction): void {
  if (!runtime.enabled) {
    return
  }

  if (action.type === 'move' || action.type === 'wheel') {
    moveCursor({ x: action.x, y: action.y })
    return
  }

  if (action.type === 'down') {
    moveCursor({ x: action.x, y: action.y })
    setPressed({ pressed: true })
    return
  }

  if (action.type === 'up') {
    moveCursor({ x: action.x, y: action.y })
    setPressed({ pressed: false })
  }
}

const api: GhostCursorApi = {
  enable,
  disable,
  applyMouseAction,
  isEnabled: () => {
    return runtime.enabled
  },
}

globalThis.__playwriterGhostCursor = api

export {}
