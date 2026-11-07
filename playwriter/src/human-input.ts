/**
 * Human-like pointer, wheel and keyboard timing for input that Playwright sends through the relay.
 * Ported from anomalyco/browse (cli/src/execute/human-input.ts).
 *
 * Playwright teleports the mouse: one mouseMoved straight to the exact center of the target, then press and
 * release a few ms apart. Behavioral bot detection (reCAPTCHA v3, Cloudflare, DataDome, HUMAN) scores that.
 * For each Input.dispatchMouseEvent that moves the pointer, the relay first sends a curved, eased path from the
 * last pointer position: cubic Bezier with a sideways bow, minimum-jerk speed, ~60-120 Hz samples, tremor that
 * fades near the target, sometimes an overshoot and correction, and a duration that grows with distance
 * (Fitts' law). Clicks settle 45-130 ms before the press and hold 60-140 ms. Key
 * presses are spaced 30-110 ms apart. Wheel events glide in ~60 Hz bursts, and scrolling an element into view
 * happens in wheel flicks instead of a one-frame jump.
 *
 * Opt-in with PLAYWRITER_HUMAN_INPUT=1 on the relay process: it makes every action slower. Old extensions work
 * because only existing CDP commands are sent.
 */

import type { Protocol } from './cdp-types.js'

type Point = { x: number; y: number }
type MouseParams = Protocol.Input.DispatchMouseEventRequest
type Send = (method: string, params: object) => Promise<unknown>

/** The commands human input paces, as Playwright sends them. */
export type PacedInput =
  | { method: 'Input.dispatchMouseEvent'; params: MouseParams }
  | { method: 'Input.dispatchKeyEvent'; params: Protocol.Input.DispatchKeyEventRequest }
  | { method: 'DOM.scrollIntoViewIfNeeded'; params: Protocol.DOM.ScrollIntoViewIfNeededRequest }

type TabState = {
  pointer?: Point
  arrivedAt: number
  pressedAt?: number
  lastKeyAt: number
  queue: Promise<void>
}

const PACED_METHODS = new Set<string>(['Input.dispatchKeyEvent', 'Input.dispatchMouseEvent', 'DOM.scrollIntoViewIfNeeded'])

/** Narrows a CDP command by method. Playwright builds the params, so they match the method. */
export function isPacedInput(command: { method: string; params?: object }): command is PacedInput {
  return PACED_METHODS.has(command.method) && command.params !== undefined
}

/** PLAYWRITER_HUMAN_INPUT: 1, true, on or yes turns it on. Off by default. */
export function isHumanInputEnabledByEnv(value = process.env.PLAYWRITER_HUMAN_INPUT): boolean {
  return /^(1|true|on|yes)$/i.test(value?.trim() || '')
}

const sleep = (ms: number) => (ms > 0 ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : Promise.resolve())
const random = (min: number, max: number) => min + Math.random() * (max - min)
/** Normal-ish noise (sum of uniforms). */
const noise = (scale: number) => (Math.random() + Math.random() + Math.random() - 1.5) * scale
/** Minimum-jerk position profile: slow start, fast middle, slow arrival. */
const minimumJerk = (t: number) => t * t * t * (10 - 15 * t + 6 * t * t)
const round1 = (value: number) => Math.round(value * 10) / 10

function bezier(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  }
}

/** Points with delays for one human-looking movement. Excludes `to`: the caller's own event lands there. */
export function trajectory(from: Point, to: Point): { point: Point; delay: number }[] {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const distance = Math.hypot(dx, dy)
  if (distance < 2) return []
  // Fitts' law with a ~40px target, plus personal variation.
  const duration = Math.min(1100, (90 + 110 * Math.log2(distance / 40 + 1)) * random(0.85, 1.25))
  // Bow the path to one side, more for longer moves, never past ~18% of the distance.
  const normal = { x: -dy / distance, y: dx / distance }
  const bow = (Math.random() < 0.5 ? -1 : 1) * random(0.04, 0.18) * distance
  const c1 = {
    x: from.x + dx * random(0.2, 0.35) + normal.x * bow,
    y: from.y + dy * random(0.2, 0.35) + normal.y * bow,
  }
  const c2 = {
    x: from.x + dx * random(0.65, 0.8) + normal.x * bow * 0.6,
    y: from.y + dy * random(0.65, 0.8) + normal.y * bow * 0.6,
  }
  // Long moves sometimes overshoot slightly and come back.
  const overshoot = distance > 250 && Math.random() < 0.25
  const end = overshoot
    ? { x: to.x + (dx / distance) * random(4, 12), y: to.y + (dy / distance) * random(4, 12) }
    : to
  const points: { point: Point; delay: number }[] = []
  let elapsed = 0
  while (elapsed < duration) {
    const step = random(8, 17)
    elapsed = Math.min(duration, elapsed + step)
    const s = minimumJerk(elapsed / duration)
    const p = bezier(from, c1, c2, end, s)
    // Tremor fades out as the hand settles on the target.
    const tremor = (1 - s) * 0.9
    points.push({ point: { x: p.x + noise(tremor), y: p.y + noise(tremor) }, delay: step })
  }
  if (overshoot) {
    const back = Math.max(3, Math.round(random(4, 7)))
    for (let i = 1; i <= back; i++) {
      const s = minimumJerk(i / back)
      points.push({
        point: { x: end.x + (to.x - end.x) * s, y: end.y + (to.y - end.y) * s },
        delay: random(10, 18),
      })
    }
  }
  points.pop()
  return points.map(({ point, delay }) => ({ point: { x: round1(point.x), y: round1(point.y) }, delay }))
}

/** Keeps a pointer position on screen: never negative, and inside the viewport when it is known. */
export function clampPoint(point: Point, bounds?: { width: number; height: number }): Point {
  const clamp = (value: number, max: number | undefined) => {
    return Math.min(Math.max(value, 0), max === undefined ? Infinity : Math.max(0, max - 1))
  }
  return { x: clamp(point.x, bounds?.width), y: clamp(point.y, bounds?.height) }
}

/** Per-frame wheel deltas for one scroll gesture: a quick start that eases out, at ~60 Hz. */
function glide(dx: number, dy: number): Point[] {
  const distance = Math.hypot(dx, dy)
  if (distance < 40) return [{ x: dx, y: dy }]
  const frames = Math.max(4, Math.round((Math.min(650, 140 + distance * 0.45) * random(0.85, 1.15)) / 16.7))
  const ease = (t: number) => 1 - (1 - t) ** 3
  return Array.from({ length: frames }, (_, i) => {
    const step = ease((i + 1) / frames) - ease(i / frames)
    return { x: dx * step, y: dy * step }
  })
}

/**
 * Sends one sample of a gesture and waits until the next is due: for the sample to land, but never past its gap.
 * Chrome can hold the reply to a pointer event for a background tab until its next frame, about a second, which
 * would turn a 30-sample move into a 30 s one. Chrome still delivers the samples in order.
 */
async function pace(gap: number, sendSample: () => Promise<unknown>) {
  const sent = Date.now()
  await Promise.race([sendSample().catch(() => undefined), sleep(gap)])
  await sleep(gap - (Date.now() - sent))
}

async function sendFrames(frames: Point[], send: (frame: Point) => Promise<unknown>) {
  for (const frame of frames) {
    await pace(random(15.5, 18), () => {
      return send({ x: Math.round(frame.x * 100) / 100, y: Math.round(frame.y * 100) / 100 })
    })
  }
}

/** The page viewport in CSS pixels, when Chrome reports it. */
async function viewportSize(send: Send): Promise<{ width: number; height: number } | undefined> {
  const metrics = (await send('Page.getLayoutMetrics', {}).catch(() => undefined)) as
    | { cssLayoutViewport?: { clientWidth?: number; clientHeight?: number } }
    | undefined
  const width = metrics?.cssLayoutViewport?.clientWidth
  const height = metrics?.cssLayoutViewport?.clientHeight
  if (typeof width !== 'number' || typeof height !== 'number' || width <= 0 || height <= 0) return undefined
  return { width, height }
}

/** One relay's human input state: pointer position and pacing per tab session. */
export function createHumanInput({ log }: { log?: (message: string) => void } = {}) {
  const extensions = new Map<string, Map<string, TabState>>()

  function tabState({ extensionId, sessionId }: { extensionId: string; sessionId: string }): TabState {
    let tabs = extensions.get(extensionId)
    if (!tabs) {
      tabs = new Map()
      extensions.set(extensionId, tabs)
    }
    let tab = tabs.get(sessionId)
    if (!tab) {
      tab = { arrivedAt: 0, lastKeyAt: 0, queue: Promise.resolve() }
      tabs.set(sessionId, tab)
    }
    return tab
  }

  /** Sends the curved movement from the last pointer position to `to`, ending just short of it. */
  async function travel({ tab, to, params, send, root }: { tab: TabState; to: Point; params: MouseParams; send: Send; root: boolean }) {
    // The first move on a page starts somewhere plausible inside the viewport, not the corner or off screen.
    const bounds = root && !tab.pointer ? await viewportSize(send) : undefined
    const from = clampPoint(tab.pointer ?? { x: to.x + random(-260, 260), y: to.y + random(-180, 180) }, bounds)
    // The bow, tremor and overshoot can swing past an edge too.
    const path = trajectory(from, to).map((step) => ({ ...step, point: clampPoint(step.point, bounds) }))
    const started = Date.now()
    for (const { point, delay } of path) {
      await pace(delay, () => {
        return send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: point.x,
          y: point.y,
          ...(params.button !== undefined && params.type === 'mouseMoved' ? { button: params.button } : {}),
          ...(params.buttons !== undefined ? { buttons: params.buttons } : {}),
          ...(params.modifiers !== undefined ? { modifiers: params.modifiers } : {}),
        })
      })
    }
    tab.arrivedAt = Date.now()
    if (path.length) {
      log?.(`[HumanInput] ${params.type} move: ${path.length} points in ${tab.arrivedAt - started}ms`)
    }
  }

  async function paceMouse({ tab, params, send, root }: { tab: TabState; params: MouseParams; send: Send; root: boolean }) {
    const type = params.type
    // params is the object the relay forwards, so changes here are what Chrome receives.
    if (type === 'mouseWheel') {
      // One wheel event jumps the page; a hand scrolls in a burst that slows to a stop.
      const frames = glide(params.deltaX ?? 0, params.deltaY ?? 0)
      const last = frames.pop()
      await sendFrames(frames, (frame) => {
        return send('Input.dispatchMouseEvent', { ...params, deltaX: frame.x, deltaY: frame.y })
      })
      if (last) {
        params.deltaX = last.x
        params.deltaY = last.y
      }
      return
    }
    // Lands on the exact requested point: the relay cannot see element bounds, and canvas apps, drag handles and
    // mouse.click(x, y) need exact coordinates. browse adds a few px of offset here.
    const target = { x: params.x, y: params.y }
    const pressOrRelease = type === 'mousePressed' || type === 'mouseReleased'
    const awayFromTarget = tab.pointer && Math.hypot(tab.pointer.x - target.x, tab.pointer.y - target.y) >= 2
    if (type === 'mouseMoved' || (pressOrRelease && awayFromTarget)) {
      await travel({ tab, to: target, params, send, root })
    }
    if (type === 'mousePressed') {
      // People settle on a target for a moment before pressing.
      await sleep(random(45, 130) - (Date.now() - tab.arrivedAt))
      tab.pressedAt = Date.now()
    }
    if (type === 'mouseReleased' && tab.pressedAt !== undefined) {
      await sleep(random(60, 140) - (Date.now() - tab.pressedAt))
      tab.pressedAt = undefined
    }
    tab.pointer = target
  }

  /**
   * Playwright scrolls an element into view in one frame before acting on it. When the element is off screen,
   * scroll toward it with wheel flicks first; the command itself then only fine-tunes.
   */
  async function scrollToward({
    tab,
    params,
    send,
  }: {
    tab: TabState
    params: Protocol.DOM.ScrollIntoViewIfNeededRequest
    send: Send
  }) {
    const node: Protocol.DOM.GetContentQuadsRequest = {
      objectId: params.objectId,
      nodeId: params.nodeId,
      backendNodeId: params.backendNodeId,
    }
    const metrics = (await send('Page.getLayoutMetrics', {})) as Partial<Protocol.Page.GetLayoutMetricsResponse>
    const viewport = metrics.cssVisualViewport
    if (!viewport) return
    const started = Date.now()
    const offset = async () => {
      const result = (await send('DOM.getContentQuads', node)) as Partial<Protocol.DOM.GetContentQuadsResponse>
      const quad = result.quads?.[0]
      if (!quad) return undefined
      const ys = [quad[1], quad[3], quad[5], quad[7]]
      if (Math.min(...ys) >= 0 && Math.max(...ys) <= viewport.clientHeight) return 0
      return (Math.min(...ys) + Math.max(...ys)) / 2 - viewport.clientHeight * random(0.35, 0.5)
    }
    const first = await offset()
    if (!first) return
    // The wheel scrolls whatever is under the pointer, so it rests over the page first.
    if (!tab.pointer) {
      const rest = { x: viewport.clientWidth * random(0.35, 0.65), y: viewport.clientHeight * random(0.35, 0.65) }
      await travel({ tab, to: rest, params: { type: 'mouseMoved', ...rest }, send, root: true })
      tab.pointer = rest
    }
    const pointer = tab.pointer
    let remaining = first
    let scrolled = 0
    for (let flick = 0; flick < 12 && Math.abs(remaining) > 2; flick++) {
      const amount = Math.sign(remaining) * Math.min(Math.abs(remaining), random(450, 900))
      await sendFrames(glide(0, amount), (frame) => {
        return send('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x: pointer.x,
          y: pointer.y,
          deltaX: frame.x,
          deltaY: frame.y,
        })
      })
      scrolled += amount
      const next = await offset()
      // Stop when the wheel did not move the element (page cannot scroll further, or something else holds it).
      if (next === undefined || Math.abs(next - remaining) < 1) break
      remaining = next
      if (Math.abs(remaining) > 2) await sleep(random(90, 240))
    }
    log?.(`[HumanInput] scroll: ${Math.round(first)}px, wheel ${Math.round(scrolled)}px in ${Date.now() - started}ms`)
  }

  async function paceKey({ tab, params }: { tab: TabState; params: Protocol.Input.DispatchKeyEventRequest }) {
    if (params.type !== 'keyDown' && params.type !== 'rawKeyDown') return
    const sinceLastKey = Date.now() - tab.lastKeyAt
    const gap = random(30, 110) - sinceLastKey
    if (gap > 0 && tab.lastKeyAt > 0 && sinceLastKey < 1000) await sleep(gap)
    tab.lastKeyAt = Date.now()
  }

  return {
    /**
     * Runs before an input or scroll command is forwarded: sends the movement or scrolling that leads up to it
     * and paces it. Only a mouse event's x/y and a wheel's remaining delta are changed in `params`, so
     * Playwright's own semantics (buttons, modifiers, frames) stay. `root` is false for a child frame session,
     * whose coordinates are not the page's.
     */
    beforeInput({
      extensionId,
      sessionId,
      input,
      root,
      send,
    }: {
      extensionId: string
      sessionId: string
      input: PacedInput
      root: boolean
      send: Send
    }): Promise<void> {
      if (input.method === 'DOM.scrollIntoViewIfNeeded' && !root) {
        return Promise.resolve()
      }
      // Playwright does not always wait for a move before pressing, so one tab's input runs in order.
      const tab = tabState({ extensionId, sessionId })
      const run = tab.queue.then(() => {
        if (input.method === 'Input.dispatchKeyEvent') return paceKey({ tab, params: input.params })
        if (input.method === 'DOM.scrollIntoViewIfNeeded') return scrollToward({ tab, params: input.params, send })
        return paceMouse({ tab, params: input.params, send, root })
      })
      tab.queue = run.catch(() => undefined)
      return run
    },

    /** Drops state of one tab session, or of every tab of an extension connection. */
    forget({ extensionId, sessionId }: { extensionId: string; sessionId?: string }) {
      if (sessionId === undefined) {
        extensions.delete(extensionId)
        return
      }
      extensions.get(extensionId)?.delete(sessionId)
    },
  }
}

export type HumanInput = ReturnType<typeof createHumanInput>
