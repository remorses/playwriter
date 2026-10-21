/**
 * Frame clock for `recording.start({ clock: 'manual' })`. Bundled as an IIFE
 * (dist/frame-clock-client.js) and injected into the MAIN world of the top
 * frame, also on every new document via Page.addScriptToEvaluateOnNewDocument.
 *
 * It freezes page time, so agent latency between frames never shows in the
 * video. Time only moves when Node calls advance(ms) before each screenshot:
 *
 *   JS time:  Playwright's fake clock (Date, performance.now, timers, rAF,
 *             requestIdleCallback), driven with runFor(ms)
 *   CSS time: every Web Animation (CSS animations, transitions, element.animate)
 *             is paused when it is created and seeked to the frame time
 *
 * chrome.debugger does not expose the CDP Animation domain, and
 * Emulation.setVirtualTimePolicy does not stop rAF or CSS animations in headful
 * Chrome, so both clocks live in the page.
 *
 * release() resumes real time. The fake timers stay installed (pending timers
 * live in them) and follow real time until the page reloads.
 *
 * Limits: <video>/<audio> playback, smooth scrolling, GIFs, workers and iframes
 * still run in real time.
 */

import { install, type ClockController } from '../../playwright/packages/injected/src/clock.ts'

interface TrackedAnimation {
  /** Frame time when the animation was adopted */
  adoptedAtMs: number
  /** Animation currentTime at adoption */
  startCurrentTime: number
}

interface FrozenState {
  tracked: Map<Animation, TrackedAnimation>
  frameMs: number
  dispose: () => void
}

const ANIMATION_EVENTS = ['transitionrun', 'animationstart'] as const
// Captured before the fake timers replace them
const realDateNow = Date.now
const realPerformance = globalThis.performance

let clock: ClockController | null = null
let frozen: FrozenState | null = null

/** Installs Playwright's fake timers once per document. They start paused. */
function getClock(): ClockController {
  if (clock) {
    return clock
  }
  const installed = install(globalThis).clock
  // Continue from real time, so timestamps that the page stored before the
  // freeze stay valid. Playwright starts ticks at 0 when installed mid-page.
  installed._now.origin = Math.round(realPerformance.timeOrigin) as typeof installed._now.origin
  installed._now.ticks = Math.ceil(realPerformance.now()) as typeof installed._now.ticks
  installed.install(realDateNow())
  clock = installed
  return installed
}

function adopt(state: FrozenState, animation: Animation, fresh: boolean): void {
  // Only running animations: finished ones would restart, and ones the app
  // paused must stay where the app left them.
  if (state.tracked.has(animation) || animation.timeline !== document.timeline || animation.playState !== 'running') {
    return
  }
  // A fresh animation was created while the clock was frozen: start it at 0,
  // even if real time already moved it while the agent was thinking.
  const current = Number(animation.currentTime) || 0
  const startCurrentTime = fresh && animation.playbackRate >= 0 ? 0 : current
  animation.pause()
  animation.currentTime = startCurrentTime
  state.tracked.set(animation, { adoptedAtMs: state.frameMs, startCurrentTime })
}

function adoptAll(state: FrozenState, fresh: boolean): void {
  for (const animation of document.getAnimations()) {
    adopt(state, animation, fresh)
  }
}

async function freeze(): Promise<void> {
  if (frozen) {
    return
  }
  const pageClock = getClock()
  // No-op on a fresh install; stops real-time flow after an earlier release().
  await pageClock.pauseAt(pageClock.now())

  const realAnimate = Element.prototype.animate
  const state: FrozenState = { tracked: new Map(), frameMs: 0, dispose: () => {} }
  // CSS transitions and animations announce themselves one frame after they
  // are created, before they move much. element.animate() is caught at once.
  const onAnimationEvent = () => {
    adoptAll(state, true)
  }
  for (const type of ANIMATION_EVENTS) {
    document.addEventListener(type, onAnimationEvent, true)
  }
  Element.prototype.animate = function (this: Element, ...args: Parameters<Element['animate']>) {
    const animation = realAnimate.apply(this, args)
    adopt(state, animation, true)
    return animation
  }
  state.dispose = () => {
    for (const type of ANIMATION_EVENTS) {
      document.removeEventListener(type, onAnimationEvent, true)
    }
    Element.prototype.animate = realAnimate
  }
  adoptAll(state, false)
  frozen = state
}

async function advance(ms: number): Promise<void> {
  const state = frozen
  if (!state || !clock) {
    return
  }
  await clock.runFor(ms).catch((error: unknown) => {
    // A page timer threw. Report it like the browser does and keep recording.
    globalThis.reportError?.(error)
  })
  adoptAll(state, true)
  state.frameMs += ms
  for (const [animation, entry] of state.tracked) {
    if (animation.playState === 'idle') {
      state.tracked.delete(animation)
      continue
    }
    const target = entry.startCurrentTime + (state.frameMs - entry.adoptedAtMs) * animation.playbackRate
    const endTime = Number(animation.effect?.getComputedTiming().endTime ?? Infinity)
    const ended = animation.playbackRate >= 0 ? target >= endTime : target <= 0
    if (ended) {
      // finish() fires finish, transitionend and animationend, which a paused
      // animation never would. Apps wait on them to unmount elements.
      state.tracked.delete(animation)
      animation.finish()
      continue
    }
    animation.currentTime = target
  }
}

function release(): void {
  const state = frozen
  if (!state || !clock) {
    return
  }
  frozen = null
  state.dispose()
  for (const animation of state.tracked.keys()) {
    if (animation.playState === 'paused') {
      animation.play()
    }
  }
  // Catch up with the wall clock; timers keep their remaining delays.
  clock.setSystemTime(realDateNow())
  clock.resume()
}

declare global {
  // eslint-disable-next-line no-var
  var __playwriterFrameClock: { freeze: () => Promise<void>; advance: (ms: number) => Promise<void>; release: () => void } | undefined
}

// Only the top frame is frozen: Node advances that frame only.
if (!globalThis.__playwriterFrameClock && window.top === window) {
  globalThis.__playwriterFrameClock = { freeze, advance, release }
}
