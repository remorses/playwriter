/**
 * Screen recording and live RTMP streaming via CDP Page.startScreencast.
 *
 * No extension permission and no user click: it works on any tab Playwright can
 * reach, including direct CDP, cloud browsers and remote control. Same approach
 * as agent-browser (cli/src/native/recording.rs), with JPEG frames instead of
 * PNG (much cheaper to encode in Chrome) and an optional page audio tap.
 *
 *   Page.captureScreenshot (seed) ─┐
 *   Page.screencastFrame (jpeg) ───┴─> latest frame
 *                                          │  wall-clock ticker writes the latest
 *                                          ▼  frame once per output frame slot
 *   audio-tap-client.ts ── binding ──> PCM queue ── ffmpeg pipe:3 (s16le 48k)
 *                                          │
 *                                          ▼
 *              ffmpeg -f image2pipe -c:v mjpeg -i pipe:0 ──> mp4/webm file or RTMP
 *
 * Chrome only sends screencast frames when the compositor paints. The ticker
 * repeats the last frame, so static pages still get correct video duration.
 * With chrome.debugger attached, background tabs keep rendering and sending
 * frames (see screencast-background-tab.test.ts).
 *
 * Captures live in the executor process, tied to the Playwright Page. They end
 * when the page closes or the session's browser connection goes away.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import crypto from 'node:crypto'
import { once } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import util from 'node:util'
import type { Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import type { Page } from '@xmorse/playwright-core'
import { getCDPSessionForPage, type PlaywrightCDPSessionAdapter } from './cdp-session.js'
import { detectEncoder } from './ffmpeg.js'
import { mergeScreencastParams } from './relay-state.js'
import type { GhostCursorController } from './ghost-cursor-controller.js'

const AUDIO_SAMPLE_RATE = 48000
/** s16le stereo */
const AUDIO_BYTES_PER_SAMPLE = 4
/** Audio is written this far behind the wall clock so page chunks (4096
 *  samples, ~85 ms) arrive before their slot. Smaller values insert gaps. */
const AUDIO_LATENCY_MS = 150
/** If more audio than this is queued, the page clock ran ahead: drop the oldest. */
const AUDIO_MAX_QUEUE_MS = 400
/** Never buffer unbounded in this process: the encoder is too slow or stalled. */
const MAX_PIPE_BUFFERED_BYTES = 64 * 1024 * 1024
const STDERR_TAIL_SIZE = 20
const DEFAULT_ASPECT_RATIO = { width: 16, height: 9 }
const DEFAULT_MAX_DURATION_MS = 15 * 60 * 1000
const DEFAULT_MAX_SIZE = 1920
const DEFAULT_JPEG_QUALITY = 90

interface Logger {
  log(...args: unknown[]): void
  error(...args: unknown[]): void
}

// ============================================================================
// Pure helpers (snapshot tested)
// ============================================================================

/**
 * Compute the largest viewport that fits inside `current` at the target aspect ratio.
 * Never increases width or height beyond current values.
 */
export function fitToAspectRatio(
  current: { width: number; height: number },
  ratio: { width: number; height: number } = DEFAULT_ASPECT_RATIO,
): { width: number; height: number } {
  const targetRatio = ratio.width / ratio.height
  const currentRatio = current.width / current.height
  if (currentRatio > targetRatio) {
    return { width: Math.round(current.height * targetRatio), height: current.height }
  }
  return { width: current.width, height: Math.round(current.width / targetRatio) }
}

/** Output size in device pixels, longest edge capped at maxSize, even for yuv420p. */
export function computeCaptureSize(options: {
  cssWidth: number
  cssHeight: number
  devicePixelRatio: number
  maxSize: number
}): { width: number; height: number } {
  const { cssWidth, cssHeight, devicePixelRatio, maxSize } = options
  const scale = Math.min(devicePixelRatio || 1, maxSize / Math.max(cssWidth, cssHeight))
  const even = (value: number) => {
    return Math.max(2, Math.round((value * scale) / 2) * 2)
  }
  return { width: even(cssWidth), height: even(cssHeight) }
}

/** ffmpeg inputs: JPEG frames on stdin, optional s16le PCM on fd 3. */
function captureInputArgs(options: { fps: number; audio: boolean }): string[] {
  const video = ['-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(options.fps), '-thread_queue_size', '512', '-i', 'pipe:0']
  if (!options.audio) {
    return video
  }
  return [
    ...video,
    '-f', 's16le', '-ar', String(AUDIO_SAMPLE_RATE), '-ac', '2', '-thread_queue_size', '512', '-i', 'pipe:3',
  ]
}

/** Frames keep their aspect ratio if the viewport changes mid-capture. */
function fitFilter(options: { width: number; height: number }): string {
  const { width, height } = options
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`
}

/** Bitrate for hardware and VP8 encoders, sized for screen content. */
function screenBitrateKbps(options: { width: number; height: number; fps: number }): number {
  const kbps = Math.round((options.width * options.height * options.fps * 0.1) / 1000)
  return Math.min(20000, Math.max(2000, kbps))
}

/**
 * ffmpeg argv for a recording file. Container from the extension:
 * .mp4/.mov/.mkv use H.264 (hardware encoder when available) + AAC,
 * .webm uses VP8 realtime + Opus.
 */
export function buildRecordingFfmpegArgs(options: {
  width: number
  height: number
  fps: number
  audio: boolean
  codec: string
  outputPath: string
}): string[] {
  const { width, height, fps, audio, codec, outputPath } = options
  const extension = path.extname(outputPath).toLowerCase()
  const kbps = screenBitrateKbps({ width, height, fps })

  const codecArgs: string[] = (() => {
    if (extension === '.webm') {
      return [
        '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', `${kbps}k`, '-crf', '10',
        ...(audio ? ['-c:a', 'libopus', '-b:a', '128k'] : []),
      ]
    }
    const video = (() => {
      if (codec === 'libx264') {
        return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20']
      }
      if (codec === 'h264_videotoolbox') {
        return ['-c:v', codec, '-b:v', `${kbps}k`, '-realtime', 'true']
      }
      return ['-c:v', codec, '-b:v', `${kbps}k`]
    })()
    const faststart = extension === '.mkv' ? [] : ['-movflags', '+faststart']
    return [...video, ...(audio ? ['-c:a', 'aac', '-b:a', '160k'] : []), ...faststart]
  })()

  return [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    ...captureInputArgs({ fps, audio }),
    '-vf', fitFilter({ width, height }),
    ...codecArgs,
    '-y', outputPath,
  ]
}

export interface StreamFfmpegOptions {
  rtmpUrls: string[]
  width: number
  height: number
  fps: number
  videoBitrateKbps: number
  audioBitrateKbps: number
  /** true = page audio tap on pipe:3; false = silent track (X Live rejects streams without audio) */
  audio: boolean
  /** x264 preset, only applied for libx264 */
  preset: string
  /** ffmpeg -c:v value, e.g. libx264 or h264_videotoolbox */
  codec: string
  /** Keyframe interval in seconds. 3 = X Live recommended (and its max), 2 = Twitch. */
  keyframeSeconds: number
}

/**
 * ffmpeg argv for live RTMP streaming.
 *
 * - GOP = keyframeSeconds * fps with scene-cut keyframes off, for platform rules
 * - `-tune zerolatency` only for libx264 (hardware encoders reject it)
 * - audio is always input 1: the page tap or an infinite anullsrc, which
 *   `-shortest` stops when the video input ends
 * - multiple destinations use the tee muxer with onfail=ignore + use_fifo, so a
 *   dead or stalled endpoint does not stop the others
 */
export function buildStreamFfmpegArgs(options: StreamFfmpegOptions): string[] {
  const { rtmpUrls, width, height, fps, videoBitrateKbps, audioBitrateKbps, audio, preset, codec, keyframeSeconds } = options

  if (rtmpUrls.length === 0) {
    throw new Error('At least one RTMP destination is required')
  }

  const gop = Math.round(fps * keyframeSeconds)
  const inputArgs = audio
    ? captureInputArgs({ fps, audio: true })
    : [...captureInputArgs({ fps, audio: false }), '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo']

  const codecArgs: string[] = (() => {
    const base = [
      '-c:v', codec,
      '-b:v', `${videoBitrateKbps}k`,
      '-maxrate', `${videoBitrateKbps}k`,
      '-bufsize', `${videoBitrateKbps * 2}k`,
      '-g', String(gop),
      '-keyint_min', String(gop),
    ]
    if (codec === 'libx264') {
      return [...base, '-preset', preset, '-tune', 'zerolatency', '-sc_threshold', '0']
    }
    if (codec === 'h264_videotoolbox') {
      return [...base, '-realtime', 'true']
    }
    return base
  })()

  const outputArgs: string[] = (() => {
    if (rtmpUrls.length === 1) {
      return ['-f', 'flv', rtmpUrls[0]]
    }
    const tee = rtmpUrls.map((url) => `[f=flv:onfail=ignore]${escapeTeeUrl(url)}`).join('|')
    return [
      '-flags', '+global_header',
      '-f', 'tee',
      '-use_fifo', '1',
      '-fifo_options', 'attempt_recovery=1:recover_any_error=1',
      tee,
    ]
  })()

  return [
    '-hide_banner',
    '-nostdin',
    ...inputArgs,
    '-map', '0:v:0',
    '-map', '1:a:0',
    ...(audio ? [] : ['-shortest']),
    '-vf', fitFilter({ width, height }),
    '-r', String(fps),
    ...codecArgs,
    '-c:a', 'aac',
    '-b:a', `${audioBitrateKbps}k`,
    '-ar', '44100',
    '-ac', '2',
    ...outputArgs,
  ]
}

/** Escape characters that are special to ffmpeg's tee muxer slave syntax. */
export function escapeTeeUrl(url: string): string {
  return url.replace(/([\\|\[\]])/g, '\\$1')
}

/**
 * Redact the stream key from an RTMP URL for logging/status.
 * File paths (used in tests) are returned as-is.
 */
export function redactStreamUrl(url: string): string {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    return url
  }
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.host}/…`
  } catch {
    return url.replace(/^([a-z][a-z0-9+.-]*:\/\/[^/]+).*$/i, '$1/…')
  }
}

/** Parse an ffmpeg progress line like:
 *  `frame=  123 fps= 30 q=28.0 size=1024KiB time=00:00:04.10 bitrate=2045.6kbits/s drop=0 speed=1x` */
export function parseFfmpegProgressLine(line: string): {
  fps?: number
  bitrateKbps?: number
  droppedFrames?: number
} | null {
  if (!line.includes('frame=')) {
    return null
  }
  const fpsMatch = line.match(/\bfps=\s*([\d.]+)/)
  const bitrateMatch = line.match(/\bbitrate=\s*([\d.]+)kbits\/s/)
  const dropMatch = line.match(/\bdrop=\s*(\d+)/)
  return {
    fps: fpsMatch ? Number(fpsMatch[1]) : undefined,
    bitrateKbps: bitrateMatch ? Number(bitrateMatch[1]) : undefined,
    droppedFrames: dropMatch ? Number(dropMatch[1]) : undefined,
  }
}

// ============================================================================
// PageCapture: screencast + audio tap + ffmpeg, paced by a wall-clock ticker
// ============================================================================

/** Captures per page. They share one CDP session, so one Page.stopScreencast
 *  would stop all of them: the last one to stop sends it. */
const capturesByPage = new Map<Page, Set<PageCapture>>()

/** Pages whose clock a manual capture controls. Two captures cannot share one clock. */
const manualClockPages = new Set<Page>()

const clientBundles = new Map<string, string>()

/** Browser IIFE built by scripts/build-client-bundles.ts */
function readClientBundle(name: 'audio-tap-client' | 'frame-clock-client'): string {
  const cached = clientBundles.get(name)
  if (cached) {
    return cached
  }
  const currentDir = path.dirname(fileURLToPath(import.meta.url))
  const code = fs.readFileSync(path.join(currentDir, '..', 'dist', `${name}.js`), 'utf-8')
  clientBundles.set(name, code)
  return code
}

/**
 * - `real`: wall-clock video from the screencast. Agent think time is in the video.
 * - `manual`: page time is frozen. Each `frame()` moves it by one frame and takes a
 *   screenshot, so the video only shows time the agent asked for.
 */
export type RecordingClock = 'real' | 'manual'

export interface CaptureStats {
  /** Frames written to ffmpeg (constant rate, repeats included) */
  videoFrames: number
  /** Frames received from Chrome's screencast */
  capturedFrames: number
  /** Non-silent audio chunks received from the page */
  audioChunks: number
  /** Encoder output fps parsed from ffmpeg progress lines */
  ffmpegFps?: number
  /** Encoder output bitrate in kbps parsed from ffmpeg progress lines */
  ffmpegBitrateKbps?: number
  /** Dropped frames parsed from ffmpeg progress lines */
  droppedFrames?: number
}

export interface CaptureResult {
  /** Media duration in ms (frames written / fps) */
  duration: number
  /** Set when ffmpeg failed, was stalled, or exited non-zero */
  error?: Error
}

interface PageCaptureOptions {
  page: Page
  fps: number
  audio: boolean
  clock?: RecordingClock
  /** Explicit output size. Default: viewport in device pixels, capped at maxSize */
  size?: { width: number; height: number }
  maxSize?: number
  quality?: number
  buildArgs: (input: { width: number; height: number; fps: number; audio: boolean }) => string[]
  /** Applied to stderr lines before they are kept (hide RTMP stream keys) */
  redact?: (line: string) => string
  logger?: Logger
}

export class PageCapture {
  readonly fps: number
  readonly audio: boolean
  readonly clock: RecordingClock
  readonly width: number
  readonly height: number
  readonly startedAt = Date.now()
  readonly stats: CaptureStats = { videoFrames: 0, capturedFrames: 0, audioChunks: 0 }
  /** Resolves once ffmpeg exited and page hooks are removed */
  readonly done: Promise<CaptureResult>

  private currentPage: Page
  private session: PlaywrightCDPSessionAdapter
  private readonly ffmpeg: ChildProcess
  private readonly videoIn: Writable
  private readonly audioIn: Writable | null
  private readonly logger?: Logger
  private readonly redact: (line: string) => string
  private readonly stderrTail: string[] = []
  private clockStart = performance.now()
  private ticker: ReturnType<typeof setInterval> | null = null
  /** Hooks on the current page, removed on setPage() and at the end */
  private pageCleanups: Array<() => Promise<unknown>> = []
  private latestFrame: Buffer = Buffer.alloc(0)
  private screencastParams: { format: 'jpeg'; quality: number; maxWidth: number; maxHeight: number; everyNthFrame: number }
  private rateWindow = { startedAt: performance.now(), frames: 0 }
  private audioQueue: Buffer[] = []
  private audioQueuedBytes = 0
  private samplesWritten = 0
  private failure: Error | null = null
  private finishing = false
  private killed = false
  private resolveDone!: (result: CaptureResult) => void

  private constructor(options: {
    opts: PageCaptureOptions
    session: PlaywrightCDPSessionAdapter
    ffmpeg: ChildProcess
    size: { width: number; height: number }
  }) {
    const { opts, session, ffmpeg, size } = options
    this.currentPage = opts.page
    this.fps = opts.fps
    this.audio = opts.audio
    this.clock = opts.clock ?? 'real'
    this.width = size.width
    this.height = size.height
    this.logger = opts.logger
    this.redact = opts.redact || ((line) => line)
    this.session = session
    this.ffmpeg = ffmpeg
    this.videoIn = ffmpeg.stdin!
    this.audioIn = opts.audio ? (ffmpeg.stdio[3] as Writable) : null
    this.screencastParams = {
      format: 'jpeg',
      quality: opts.quality ?? DEFAULT_JPEG_QUALITY,
      maxWidth: size.width,
      maxHeight: size.height,
      everyNthFrame: 1,
    }
    this.done = new Promise((resolve) => {
      this.resolveDone = resolve
    })
  }

  static async start(opts: PageCaptureOptions): Promise<PageCapture> {
    const { page, fps, audio } = opts
    if (opts.clock === 'manual' && audio) {
      throw new Error('audio cannot be recorded with clock: "manual": page audio plays in real time.')
    }
    const session = await getCDPSessionForPage({ page })

    const size = opts.size || (await (async () => {
      const viewport = await page.evaluate<{ width: number; height: number; dpr: number }>(
        '({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio })',
      )
      return computeCaptureSize({
        cssWidth: viewport.width,
        cssHeight: viewport.height,
        devicePixelRatio: viewport.dpr,
        maxSize: opts.maxSize ?? DEFAULT_MAX_SIZE,
      })
    })())

    const args = opts.buildArgs({ width: size.width, height: size.height, fps, audio })
    opts.logger?.log(`[capture] ffmpeg ${args.map(opts.redact || ((arg) => arg)).join(' ')}`)
    const ffmpeg = spawn('ffmpeg', args, {
      stdio: ['pipe', 'ignore', 'pipe', audio ? 'pipe' : 'ignore'],
      windowsHide: true,
    })
    const spawnError = await new Promise<Error | null>((resolve) => {
      ffmpeg.once('spawn', () => {
        resolve(null)
      })
      ffmpeg.once('error', (error) => {
        const missing = (error as NodeJS.ErrnoException).code === 'ENOENT'
        resolve(missing ? new Error('ffmpeg not found. Install ffmpeg to record or stream.') : error)
      })
    })
    if (spawnError) {
      throw spawnError
    }

    const capture = new PageCapture({ opts, session, ffmpeg, size })
    capture.wireProcess()
    try {
      await capture.attachPage()
      if (capture.clock === 'manual') {
        // First frame at the frozen start time, like a video's frame 0
        await capture.writeFrame(await capture.screenshot())
      } else {
        capture.startTicker()
      }
    } catch (error) {
      await capture.abort()
      throw new Error('Could not start page capture', { cause: error })
    }
    return capture
  }

  /** The page frames come from. Change it with setPage(). */
  get page(): Page {
    return this.currentPage
  }

  /**
   * Take frames from another page from now on. The output size stays the same;
   * frames are scaled and padded to fit. In manual clock mode the old page gets
   * real time back and the new page is frozen.
   */
  async setPage(page: Page): Promise<void> {
    if (this.finishing) {
      throw new Error('Capture already stopped')
    }
    if (page === this.currentPage) {
      return
    }
    await this.detachPage()
    this.currentPage = page
    try {
      this.session = await getCDPSessionForPage({ page })
      await this.attachPage()
    } catch (error) {
      await this.stop()
      throw new Error('Could not move the capture to the new page. The capture was stopped.', { cause: error })
    }
    // stop() ran while attaching: its cleanup missed the new hooks
    if (this.finishing) {
      await this.detachPage()
    }
  }

  /**
   * Manual clock only. Move page time by one frame (1000 / fps ms), take a
   * screenshot and write it as the next video frame.
   */
  async frame(): Promise<void> {
    if (this.clock !== 'manual') {
      throw new Error('frame() needs a recording started with clock: "manual"')
    }
    if (this.finishing || this.failure) {
      throw this.failure || new Error('Capture already stopped')
    }
    // Integer steps that add up exactly, so 30 fps does not drift by rounding
    const index = this.stats.videoFrames
    const stepMs = Math.round((index * 1000) / this.fps) - Math.round(((index - 1) * 1000) / this.fps)
    await this.evaluate(`globalThis.__playwriterFrameClock?.advance(${stepMs})`).catch((error: unknown) => {
      // Usually a navigation: the new document is frozen by the init script.
      this.logger?.error('[capture] could not advance page clock:', error instanceof Error ? error.message : error)
    })
    await this.writeFrame(await this.screenshot())
  }

  /** Stop capturing, flush, and wait for ffmpeg to finish the output. */
  stop(): Promise<CaptureResult> {
    if (!this.finishing) {
      this.finishing = true
      this.stopTicker()
      if (this.clock === 'real') {
        this.tick({ final: true })
      }
      void this.detach().finally(() => {
        this.videoIn.end()
        this.audioIn?.end()
        this.killAfter(30_000)
      })
    }
    return this.done
  }

  /** Stop without finishing the output. */
  abort(): Promise<CaptureResult> {
    if (!this.finishing) {
      this.finishing = true
      this.stopTicker()
      void this.detach()
    }
    this.killed = true
    this.failure ||= new Error('Capture was cancelled')
    this.ffmpeg.kill('SIGKILL')
    return this.done
  }

  get error(): Error | null {
    return this.failure
  }

  get stderr(): string[] {
    return [...this.stderrTail]
  }

  private wireProcess(): void {
    this.ffmpeg.stdin?.on('error', () => {})
    this.audioIn?.on('error', () => {})
    this.wireStderr()
    this.ffmpeg.once('close', (code, signal) => {
      this.stopTicker()
      const error = (() => {
        if (this.failure) {
          return this.failure
        }
        if (this.killed) {
          return undefined
        }
        if (code === 0) {
          return this.finishing ? undefined : new Error('ffmpeg exited before the capture was stopped')
        }
        const tail = this.stderrTail.slice(-5).join('\n')
        return new Error(`ffmpeg exited with ${signal || `code ${code}`}${tail ? `:\n${tail}` : ''}`)
      })()
      if (error) {
        this.failure = error
      }
      if (error && !this.killed) {
        this.logger?.error('[capture] failed:', error.message)
      }
      void this.detach().finally(() => {
        this.resolveDone({ duration: Math.round((this.stats.videoFrames * 1000) / this.fps), error })
      })
    })
  }

  private startTicker(): void {
    this.clockStart = performance.now()
    this.ticker = setInterval(() => {
      this.tick({ final: false })
    }, 1000 / this.fps)
  }

  private stopTicker(): void {
    if (this.ticker) {
      clearInterval(this.ticker)
      this.ticker = null
    }
  }

  /** Hook the current page: frame source, close listeners, audio tap. */
  private async attachPage(): Promise<void> {
    const page = this.currentPage

    const onClose = () => {
      void this.stop()
    }
    page.once('close', onClose)
    const browser = page.context().browser()
    browser?.once('disconnected', onClose)
    this.pageCleanups.push(async () => {
      page.off('close', onClose)
      browser?.off('disconnected', onClose)
    })

    if (this.clock === 'manual') {
      await this.freezePage()
      return
    }

    // Static pages never paint, so Chrome sends no screencast frame. Seed one.
    this.latestFrame = await this.screenshot()
    await this.attachScreencast()
    if (this.audio) {
      await this.attachAudio()
    }
  }

  private async attachScreencast(): Promise<void> {
    const { session } = this
    const page = this.currentPage
    const onFrame = (event: { data: string }) => {
      this.latestFrame = Buffer.from(event.data, 'base64')
      this.stats.capturedFrames += 1
      this.rateWindow.frames += 1
    }
    session.on('Page.screencastFrame', onFrame)
    const siblings = capturesByPage.get(page) || new Set<PageCapture>()
    siblings.add(this)
    capturesByPage.set(page, siblings)
    this.pageCleanups.push(async () => {
      session.off('Page.screencastFrame', onFrame)
      siblings.delete(this)
      if (siblings.size > 0) {
        await this.sendScreencast({ page, session })
        return
      }
      capturesByPage.delete(page)
      await session.send('Page.stopScreencast')
    })
    await this.sendScreencast({ page, session })
  }

  /** Install the frame clock (frame-clock-client.ts) now and on every new document. */
  private async freezePage(): Promise<void> {
    const { session } = this
    const page = this.currentPage
    if (manualClockPages.has(page)) {
      throw new Error('Another clock: "manual" recording already controls this page. Stop it first.')
    }
    manualClockPages.add(page)
    this.pageCleanups.push(async () => {
      manualClockPages.delete(page)
    })
    const source = `${readClientBundle('frame-clock-client')}\n;globalThis.__playwriterFrameClock?.freeze()`
    const { identifier } = await session.send('Page.addScriptToEvaluateOnNewDocument', { source })
    this.pageCleanups.push(async () => {
      await Promise.allSettled([
        session.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }),
        this.evaluate('globalThis.__playwriterFrameClock?.release()', session),
      ])
    })
    await this.evaluate(source, session)
  }

  private async attachAudio(): Promise<void> {
    const { session } = this
    const bindingName = `__playwriterAudio_${crypto.randomUUID().replace(/-/g, '')}`
    const source = `${readClientBundle('audio-tap-client')}\n;globalThis.__playwriterAudioTap(${JSON.stringify(bindingName)})`

    const onBinding = (event: { name: string; payload: string }) => {
      if (event.name !== bindingName) {
        return
      }
      const pcm = (() => {
        try {
          return (JSON.parse(event.payload) as { pcm?: string }).pcm
        } catch {
          return undefined
        }
      })()
      if (!pcm || this.finishing) {
        return
      }
      const chunk = Buffer.from(pcm, 'base64')
      this.audioQueue.push(chunk)
      this.audioQueuedBytes += chunk.length
      this.stats.audioChunks += 1
    }
    session.on('Runtime.bindingCalled', onBinding)
    await session.send('Runtime.addBinding', { name: bindingName })
    const { identifier } = await session.send('Page.addScriptToEvaluateOnNewDocument', { source })
    this.pageCleanups.push(async () => {
      session.off('Runtime.bindingCalled', onBinding)
      await Promise.allSettled([
        session.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }),
        session.send('Runtime.evaluate', { expression: `globalThis.__playwriterAudioTapStop?.(${JSON.stringify(bindingName)})` }),
        session.send('Runtime.removeBinding', { name: bindingName }),
      ])
    })
    await session.send('Runtime.evaluate', { expression: source })
  }

  /** Main-world evaluate in the top frame. Awaits promises, throws page exceptions. */
  private async evaluate(expression: string, session = this.session): Promise<void> {
    const result = await session.send('Runtime.evaluate', { expression, awaitPromise: true })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    }
  }

  private async screenshot(): Promise<Buffer> {
    const { data } = await this.session.send('Page.captureScreenshot', {
      format: 'jpeg',
      quality: this.screencastParams.quality,
      optimizeForSpeed: true,
    })
    return Buffer.from(data, 'base64')
  }

  /** Manual clock: write one frame, waiting for ffmpeg when its pipe is full. */
  private async writeFrame(frame: Buffer): Promise<void> {
    this.stats.videoFrames += 1
    if (this.videoIn.write(frame)) {
      return
    }
    await Promise.race([once(this.videoIn, 'drain'), this.done])
  }

  /**
   * Captures of one page share one CDP session, so the relay sees one client:
   * merge their params here. The relay merges across clients (skill recorder,
   * other sessions), so neither ever stops the other's frames.
   */
  private sendScreencast(target: { page: Page; session: PlaywrightCDPSessionAdapter } = { page: this.currentPage, session: this.session }): Promise<unknown> {
    const siblings = [...(capturesByPage.get(target.page) || [])]
    return target.session.send('Page.startScreencast', mergeScreencastParams(siblings.map((capture) => {
      return capture.screencastParams
    })))
  }

  private detachPromise: Promise<void> | null = null

  /** Final cleanup. Runs once. */
  private detach(): Promise<void> {
    this.detachPromise ||= this.detachPage()
    return this.detachPromise
  }

  private async detachPage(): Promise<void> {
    const cleanups = this.pageCleanups.splice(0).reverse()
    for (const cleanup of cleanups) {
      await cleanup().catch(() => {})
    }
  }

  private killAfter(ms: number): void {
    const timer = setTimeout(() => {
      this.failure ||= new Error('Timeout waiting for ffmpeg to finish')
      this.ffmpeg.kill('SIGKILL')
    }, ms)
    void this.done.finally(() => {
      clearTimeout(timer)
    })
  }

  private wireStderr(): void {
    let remainder = ''
    this.ffmpeg.stderr?.on('data', (data: Buffer) => {
      remainder += data.toString()
      // progress lines end with \r, errors with \n
      const lines = remainder.split(/[\r\n]+/)
      remainder = lines.pop() || ''
      lines.forEach((raw) => {
        const line = this.redact(raw.trim())
        if (!line) {
          return
        }
        const progress = parseFfmpegProgressLine(line)
        if (progress) {
          this.stats.ffmpegFps = progress.fps ?? this.stats.ffmpegFps
          this.stats.ffmpegBitrateKbps = progress.bitrateKbps ?? this.stats.ffmpegBitrateKbps
          this.stats.droppedFrames = progress.droppedFrames ?? this.stats.droppedFrames
          return
        }
        this.stderrTail.push(line)
        if (this.stderrTail.length > STDERR_TAIL_SIZE) {
          this.stderrTail.shift()
        }
      })
    })
  }

  /** Write every output frame slot and audio sample due up to now. */
  private tick({ final }: { final: boolean }): void {
    if (this.failure) {
      return
    }
    const elapsedMs = performance.now() - this.clockStart
    const frameTarget = Math.floor((elapsedMs * this.fps) / 1000)
    while (this.stats.videoFrames < frameTarget) {
      this.videoIn.write(this.latestFrame)
      this.stats.videoFrames += 1
    }
    this.adaptFrameRate()
    if (this.audioIn) {
      const audioMs = final ? elapsedMs : elapsedMs - AUDIO_LATENCY_MS
      this.writeAudio(Math.floor((audioMs * AUDIO_SAMPLE_RATE) / 1000))
    }
    const buffered = this.videoIn.writableLength + (this.audioIn?.writableLength || 0)
    if (buffered > MAX_PIPE_BUFFERED_BYTES) {
      this.failure = new Error(`ffmpeg is too slow: ${buffered} bytes buffered. Lower fps or maxSize.`)
      this.logger?.error('[capture]', this.failure.message)
      this.ffmpeg.kill('SIGKILL')
    }
  }

  /**
   * Chrome sends a frame per compositor frame: 120-144 per second on ProMotion
   * and gaming displays, each a JPEG encode. Above 1.5x the output fps, ask for
   * every Nth frame only. Adapts once: other clients can change the delivered
   * rate, and static moments undercount.
   */
  private adaptFrameRate(): void {
    const windowMs = performance.now() - this.rateWindow.startedAt
    if (this.screencastParams.everyNthFrame > 1 || windowMs < 1000) {
      return
    }
    const deliveredRate = (this.rateWindow.frames * 1000) / windowMs
    this.rateWindow = { startedAt: performance.now(), frames: 0 }
    if (deliveredRate < this.fps * 1.5) {
      return
    }
    this.screencastParams = { ...this.screencastParams, everyNthFrame: Math.floor(deliveredRate / this.fps) }
    this.sendScreencast().catch(() => {})
  }

  /** Write queued page audio up to targetSamples, filling gaps with silence. */
  private writeAudio(targetSamples: number): void {
    const audioIn = this.audioIn
    if (!audioIn) {
      return
    }
    const maxQueued = ((AUDIO_MAX_QUEUE_MS * AUDIO_SAMPLE_RATE) / 1000) * AUDIO_BYTES_PER_SAMPLE
    while (this.audioQueuedBytes > maxQueued && this.audioQueue.length > 1) {
      this.audioQueuedBytes -= this.audioQueue.shift()!.length
    }
    let needed = (targetSamples - this.samplesWritten) * AUDIO_BYTES_PER_SAMPLE
    while (needed > 0) {
      const chunk = this.audioQueue[0]
      const bytes = chunk ? Math.min(chunk.length, needed) : needed
      audioIn.write(chunk ? chunk.subarray(0, bytes) : Buffer.alloc(bytes))
      if (chunk && bytes === chunk.length) {
        this.audioQueue.shift()
      } else if (chunk) {
        this.audioQueue[0] = chunk.subarray(bytes)
      }
      if (chunk) {
        this.audioQueuedBytes -= bytes
      }
      this.samplesWritten += bytes / AUDIO_BYTES_PER_SAMPLE
      needed -= bytes
    }
  }
}

// ============================================================================
// Recording to a file
// ============================================================================

const RECORDING_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.webm'])

export interface StartRecordingOptions {
  page: Page
  /** Output file. Container from the extension: .mp4 (default choice), .mov, .mkv, .webm */
  outputPath: string
  /** Output frame rate (default 30, max 60) */
  frameRate?: number
  /** Record page audio with a Web Audio tap (default false). Patches page audio APIs while recording. */
  audio?: boolean
  /** Longest output edge in pixels (default 1920). Output is the viewport in device pixels, capped. */
  maxSize?: number
  /** JPEG quality of captured frames, 0-100 (default 90) */
  quality?: number
  /** `real` (default) records wall-clock time. `manual` freezes the page; `frame()` and `wait()` add frames. */
  clock?: RecordingClock
  logger?: Logger
}

export interface RecordingResult {
  path: string
  /** Duration in ms */
  duration: number
  /** File size in bytes */
  size: number
}

/** A screen recording of one page, written atomically to outputPath on stop. */
export class ScreenRecording {
  readonly outputPath: string
  readonly capture: PageCapture
  /** Settles once the file is finished, also when the page closed on its own */
  readonly result: Promise<RecordingResult>
  private readonly temporaryPath: string

  private constructor(options: { outputPath: string; temporaryPath: string; capture: PageCapture }) {
    this.outputPath = options.outputPath
    this.temporaryPath = options.temporaryPath
    this.capture = options.capture
    this.result = this.capture.done.then((capture) => {
      return this.finish(capture)
    })
    // stop() and cancel() surface errors; avoid unhandled rejections otherwise
    this.result.catch(() => {})
  }

  static async start(options: StartRecordingOptions): Promise<ScreenRecording> {
    const outputPath = path.resolve(options.outputPath)
    const extension = path.extname(outputPath).toLowerCase()
    if (!RECORDING_EXTENSIONS.has(extension)) {
      throw new Error(`Unsupported recording extension "${extension}". Use .mp4, .mov, .mkv or .webm.`)
    }
    const fps = Math.min(60, Math.max(1, Math.round(options.frameRate ?? 30)))
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    const temporaryPath = path.join(
      path.dirname(outputPath),
      `.${path.basename(outputPath, extension)}.${crypto.randomUUID()}${extension}`,
    )
    const codec = extension === '.webm' ? 'libvpx' : (await detectEncoder()).codec
    const capture = await PageCapture.start({
      page: options.page,
      fps,
      audio: options.audio ?? false,
      clock: options.clock,
      maxSize: options.maxSize,
      quality: options.quality,
      logger: options.logger,
      buildArgs: (input) => {
        return buildRecordingFfmpegArgs({ ...input, codec, outputPath: temporaryPath })
      },
    })
    return new ScreenRecording({ outputPath, temporaryPath, capture })
  }

  get startedAt(): number {
    return this.capture.startedAt
  }

  get page(): Page {
    return this.capture.page
  }

  /** Record another page from now on. See PageCapture.setPage(). */
  setPage(page: Page): Promise<void> {
    return this.capture.setPage(page)
  }

  /** Manual clock only: move page time by one frame and capture it. */
  frame(): Promise<void> {
    return this.capture.frame()
  }

  /** Manual clock only: capture `ms` of page time, one frame per 1000 / fps ms. */
  async wait(ms: number): Promise<void> {
    const count = Math.round((ms * this.capture.fps) / 1000)
    for (let index = 0; index < count; index += 1) {
      await this.capture.frame()
    }
  }

  get isRecording(): boolean {
    return !this.capture.error && !this.settled
  }

  private settled = false

  async stop(): Promise<RecordingResult> {
    await this.capture.stop()
    return this.result
  }

  async cancel(): Promise<void> {
    await this.capture.abort()
    await this.result.catch(() => {})
  }

  private finish(capture: CaptureResult): RecordingResult {
    this.settled = true
    if (capture.error || !fs.existsSync(this.temporaryPath)) {
      fs.rmSync(this.temporaryPath, { force: true })
      throw capture.error || new Error('Recording was cancelled')
    }
    fs.renameSync(this.temporaryPath, this.outputPath)
    return { path: this.outputPath, duration: capture.duration, size: fs.statSync(this.outputPath).size }
  }
}

/** Start recording a page to a video file. Call `stop()` on the result to save it. */
export function startRecording(options: StartRecordingOptions): Promise<ScreenRecording> {
  return ScreenRecording.start(options)
}

// ============================================================================
// Live RTMP streaming
// ============================================================================

export interface StartStreamOptions {
  page: Page
  /** RTMP destination URLs (or any ffmpeg-writable flv target, e.g. a file path for testing) */
  rtmpUrls: string[]
  /** Output resolution as WxH (default 1920x1080, X Live recommended) */
  resolution?: string
  /** Output frame rate (default 30) */
  fps?: number
  /** Video bitrate in kbps (default 9000, X Live recommended) */
  videoBitrateKbps?: number
  /** Audio bitrate in kbps (default 128) */
  audioBitrateKbps?: number
  /** Keyframe interval in seconds (default 3, X Live recommended and its max; Twitch recommends 2) */
  keyframeSeconds?: number
  /** Stream page audio (default true). When false a silent track is sent, because X Live rejects streams without audio. */
  audio?: boolean
  /** x264 preset (default veryfast). Only applies to libx264. */
  preset?: string
  /** Video codec for ffmpeg -c:v (default: hardware encoder when available, else libx264) */
  codec?: string
  logger?: Logger
}

export interface StreamStatus {
  streaming: boolean
  startedAt?: number
  /** Destinations with stream keys redacted */
  destinations?: string[]
  stats?: CaptureStats
  /** Why the last stream ended unexpectedly (ffmpeg crash, RTMP failure) */
  error?: string
}

/** A live stream of one page to RTMP destinations. Runs until stop() or the page closes. */
export class ScreenStream {
  readonly destinations: string[]
  readonly capture: PageCapture

  private constructor(options: { destinations: string[]; capture: PageCapture }) {
    this.destinations = options.destinations
    this.capture = options.capture
  }

  static async start(options: StartStreamOptions): Promise<ScreenStream> {
    if (!options.rtmpUrls || options.rtmpUrls.length === 0) {
      throw new Error('rtmpUrls is required')
    }
    const resolution = options.resolution || '1920x1080'
    const resolutionMatch = resolution.match(/^(\d+)x(\d+)$/)
    if (!resolutionMatch) {
      throw new Error(`Invalid resolution "${resolution}", expected WxH like 1920x1080`)
    }
    const rawUrls = options.rtmpUrls
    const redact = (line: string) => {
      return rawUrls.reduce((acc, url) => {
        return acc.replaceAll(url, redactStreamUrl(url))
      }, line)
    }
    const codec = options.codec || (await detectEncoder()).codec
    const capture = await PageCapture.start({
      page: options.page,
      fps: options.fps || 30,
      audio: options.audio !== false,
      size: { width: Number(resolutionMatch[1]), height: Number(resolutionMatch[2]) },
      redact,
      logger: options.logger,
      buildArgs: (input) => {
        return buildStreamFfmpegArgs({
          rtmpUrls: rawUrls,
          width: input.width,
          height: input.height,
          fps: input.fps,
          audio: input.audio,
          videoBitrateKbps: options.videoBitrateKbps || 9000,
          audioBitrateKbps: options.audioBitrateKbps || 128,
          preset: options.preset || 'veryfast',
          codec,
          keyframeSeconds: options.keyframeSeconds || 3,
        })
      },
    })
    return new ScreenStream({ destinations: rawUrls.map(redactStreamUrl), capture })
  }

  async stop(): Promise<{ duration: number; frames: number }> {
    const result = await this.capture.stop()
    if (result.error) {
      throw result.error
    }
    return { duration: result.duration, frames: this.capture.stats.videoFrames }
  }

  status(): StreamStatus {
    const error = this.capture.error
    if (error) {
      return { streaming: false, error: error.message }
    }
    return {
      streaming: true,
      startedAt: this.capture.startedAt,
      destinations: this.destinations,
      stats: { ...this.capture.stats },
    }
  }
}

// ============================================================================
// Executor sandbox APIs: `recording.*` and `stream.*`
// ============================================================================

export interface ExecutionTimestamp {
  start: number
  end: number
}

interface RecordingTargetOptions {
  page?: Page
}

const RECORDING_TARGET_REQUIRED =
  'requires an explicit target tab, e.g. ({ page: state.page }). There is no default page; create one with `state.page = await context.newPage()`.'

function requirePage(helper: string, target?: RecordingTargetOptions): Page {
  if (!target?.page) {
    throw new Error(`${helper} ${RECORDING_TARGET_REQUIRED}`)
  }
  return target.page
}

export interface SandboxStartRecordingOptions extends Omit<StartRecordingOptions, 'page' | 'logger'> {
  page: Page
  /** Fit the viewport to this aspect ratio first (default 16:9, only shrinks). null skips resizing. */
  aspectRatio?: { width: number; height: number } | null
  /** Auto-stop after this many ms of wall time (default 15 min). 0 or Infinity disables it. */
  maxDurationMs?: number
}

export type RecordingHandleResult = RecordingResult & { executionTimestamps: ExecutionTimestamp[] }

type AspectRatio = { width: number; height: number } | null

/** Shrink the viewport to the aspect ratio. Returns a function that restores it. */
async function fitViewport(options: { page: Page; aspectRatio: AspectRatio }): Promise<() => Promise<void>> {
  const { page, aspectRatio } = options
  const current = page.viewportSize()
  if (!aspectRatio || !current) {
    return async () => {}
  }
  const fitted = fitToAspectRatio(current, aspectRatio)
  if (fitted.width === current.width && fitted.height === current.height) {
    return async () => {}
  }
  await page.setViewportSize(fitted)
  return async () => {
    if (!page.isClosed()) {
      await page.setViewportSize(current).catch(() => {})
    }
  }
}

/**
 * Returned by `recording.start()` in the sandbox. Keep it in `state` to stop
 * it, add frames or switch tabs in later execute calls.
 */
export class RecordingHandle {
  private readonly recording: ScreenRecording
  private readonly aspectRatio: AspectRatio
  private readonly ghostCursorController: GhostCursorController
  /** Settles when the recording ends for any reason: stop, max duration, page closed, ffmpeg failure */
  private readonly settled: Promise<{ result?: RecordingResult; error?: unknown; executionTimestamps: ExecutionTimestamp[] }>
  private restoreViewport: () => Promise<void>
  private completed = false

  constructor(options: {
    recording: ScreenRecording
    aspectRatio: AspectRatio
    restoreViewport: () => Promise<void>
    ghostCursorController: GhostCursorController
    maxDurationMs: number
    onFinish: () => void
    getExecutionTimestamps: () => ExecutionTimestamp[]
  }) {
    const { recording, maxDurationMs, onFinish, getExecutionTimestamps } = options
    this.recording = recording
    this.aspectRatio = options.aspectRatio
    this.restoreViewport = options.restoreViewport
    this.ghostCursorController = options.ghostCursorController

    const maxDurationTimer = maxDurationMs > 0 && maxDurationMs < Infinity
      ? setTimeout(() => {
          void recording.capture.stop()
        }, maxDurationMs)
      : null

    this.settled = recording.result
      .then(
        (result) => {
          return { result }
        },
        (error: unknown) => {
          return { error }
        },
      )
      .then(async (outcome) => {
        // Idle detection for createDemoVideo only makes sense on wall-clock video
        const executionTimestamps = this.clock === 'real' ? [...getExecutionTimestamps()] : []
        this.completed = true
        if (maxDurationTimer) {
          clearTimeout(maxDurationTimer)
        }
        onFinish()
        await this.restoreViewport()
        return { ...outcome, executionTimestamps }
      })
  }

  get page(): Page {
    return this.recording.page
  }

  get clock(): RecordingClock {
    return this.recording.capture.clock
  }

  get outputPath(): string {
    return this.recording.outputPath
  }

  get startedAt(): number {
    return this.recording.startedAt
  }

  get isRecording(): boolean {
    return !this.completed
  }

  /** Record another tab from now on. Viewport fit and ghost cursor move with it. */
  async setPage(page: Page): Promise<void> {
    if (this.completed) {
      throw new Error('Recording already stopped')
    }
    if (page === this.page) {
      return
    }
    this.ghostCursorController.attachToPage({ page })
    const restoreNewViewport = await fitViewport({ page, aspectRatio: this.aspectRatio })
    try {
      await this.recording.setPage(page)
    } catch (error) {
      await restoreNewViewport()
      throw error
    }
    await this.restoreViewport()
    this.restoreViewport = restoreNewViewport
    // Ended while switching: the final cleanup already ran with the old restore
    if (this.completed) {
      await restoreNewViewport()
    }
  }

  /** clock: 'manual' only. Move page time by one frame and capture it. */
  frame(): Promise<void> {
    return this.recording.frame()
  }

  /** clock: 'manual' only. Capture `ms` of page time. */
  wait(ms: number): Promise<void> {
    return this.recording.wait(ms)
  }

  /** Finish the file. Also returns the file if the recording already ended on its own. */
  async stop(): Promise<RecordingHandleResult> {
    await this.recording.capture.stop()
    const outcome = await this.settled
    if (!outcome.result) {
      throw outcome.error
    }
    return { ...outcome.result, executionTimestamps: outcome.executionTimestamps }
  }

  /** Stop without saving the file. */
  async cancel(): Promise<void> {
    await this.recording.cancel()
    await this.settled
  }

  /** Short summary when an agent logs or returns the handle */
  [util.inspect.custom](): object {
    return {
      outputPath: this.outputPath,
      clock: this.clock,
      isRecording: this.isRecording,
      page: this.page.isClosed() ? '(closed)' : this.page.url(),
    }
  }
}

export function createRecordingApi(options: {
  ghostCursorController: GhostCursorController
  logger: Logger
  onStart: () => void
  onFinish: () => void
  getExecutionTimestamps: () => ExecutionTimestamp[]
}): {
  start: (opts: SandboxStartRecordingOptions) => Promise<RecordingHandle>
} {
  const { ghostCursorController, logger, onStart, onFinish, getExecutionTimestamps } = options

  return {
    start: async (opts) => {
      const page = requirePage('recording.start', opts)
      ghostCursorController.attachToPage({ page })
      const aspectRatio = opts.aspectRatio === undefined ? DEFAULT_ASPECT_RATIO : opts.aspectRatio
      const restoreViewport = await fitViewport({ page, aspectRatio })
      const recording = await ScreenRecording.start({ ...opts, page, logger }).catch(async (error: unknown) => {
        await restoreViewport()
        throw error
      })
      const realClock = recording.capture.clock === 'real'
      if (realClock) {
        onStart()
      }
      return new RecordingHandle({
        recording,
        aspectRatio,
        restoreViewport,
        ghostCursorController,
        maxDurationMs: opts.maxDurationMs ?? DEFAULT_MAX_DURATION_MS,
        onFinish: realClock ? onFinish : () => {},
        getExecutionTimestamps,
      })
    },
  }
}

/**
 * `stream.*` in the executor sandbox. Streams run until stopped or until the page
 * closes. stop/status work without a target when exactly one stream is active.
 */
export function createStreamApi(options: { logger: Logger }): {
  start: (opts: Omit<StartStreamOptions, 'logger'>) => Promise<{ startedAt: number; destinations: string[] }>
  stop: (opts?: RecordingTargetOptions) => Promise<{ duration: number; frames: number }>
  status: (opts?: RecordingTargetOptions) => Promise<StreamStatus>
} {
  const { logger } = options
  const active = new Map<Page, ScreenStream>()
  let lastError: string | undefined

  const find = (helper: string, target?: RecordingTargetOptions): ScreenStream | undefined => {
    if (target?.page) {
      return active.get(target.page)
    }
    const streams = [...active.values()]
    if (streams.length > 1) {
      throw new Error(`${helper}: several streams are active. Pass { page } to pick one.`)
    }
    return streams[0]
  }

  return {
    start: async (opts) => {
      const page = requirePage('stream.start', opts)
      if (active.has(page)) {
        throw new Error('A stream is already running for this page. Call stream.stop({ page }) first.')
      }
      const stream = await ScreenStream.start({ ...opts, page, logger })
      active.set(page, stream)
      lastError = undefined
      void stream.capture.done.then((result) => {
        if (active.get(page) === stream) {
          active.delete(page)
        }
        if (result.error) {
          lastError = result.error.message
        }
      })
      return { startedAt: stream.capture.startedAt, destinations: stream.destinations }
    },

    stop: async (opts) => {
      const stream = find('stream.stop', opts)
      if (!stream) {
        throw new Error(lastError ? `No active stream. Last stream failed: ${lastError}` : 'No active stream')
      }
      return stream.stop()
    },

    status: async (opts) => {
      const stream = find('stream.status', opts)
      if (!stream) {
        return { streaming: false, error: lastError }
      }
      return stream.status()
    },
  }
}
