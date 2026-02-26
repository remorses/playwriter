/**
 * FFmpeg utilities for video concatenation and section-based speed manipulation.
 *
 * Both functions use a single ffmpeg filter_complex pass: trim segments from
 * the input, apply setpts for speed, normalize fps/scale, then concat.
 * No intermediate files, no multi-pass.
 */

import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Seconds of normal-speed buffer kept before and after each execution */
export const INTERACTION_BUFFER_SECONDS = 1

// ---------------------------------------------------------------------------
// Hardware encoder detection
// ---------------------------------------------------------------------------

/**
 * Preferred hardware encoders by platform, in priority order.
 * Each is tried via `ffmpeg -f lavfi -i nullsrc -t 0.01 -c:v <encoder> -f null -`
 * to confirm the encoder actually works (drivers present, GPU available, etc).
 */
const HW_ENCODER_CANDIDATES: Record<string, string[]> = {
    darwin: ['h264_videotoolbox'],
    win32: ['h264_nvenc', 'h264_qsv', 'h264_amf'],
    // h264_vaapi excluded: requires -vaapi_device and format=nv12,hwupload in the
    // filter graph, which our filter_complex pipeline doesn't set up
    linux: ['h264_nvenc', 'h264_qsv'],
}

interface EncoderInfo {
    /** Encoder name for `-c:v`, e.g. "h264_videotoolbox" or "libx264" */
    codec: string
    /** true when using a hardware encoder */
    isHardware: boolean
}

/** Cache so we only probe once per process */
let cachedEncoder: EncoderInfo | undefined

/**
 * Detect the best available H.264 encoder.
 * Tries platform-specific hardware encoders first, falls back to libx264.
 * Result is cached for the lifetime of the process.
 */
export async function detectEncoder(): Promise<EncoderInfo> {
    if (cachedEncoder) {
        return cachedEncoder
    }

    const platform = os.platform()
    const candidates = HW_ENCODER_CANDIDATES[platform] ?? []

    for (const codec of candidates) {
        const works = await testEncoder(codec)
        if (works) {
            cachedEncoder = { codec, isHardware: true }
            return cachedEncoder
        }
    }

    cachedEncoder = { codec: 'libx264', isHardware: false }
    return cachedEncoder
}

/**
 * Quick probe: can this encoder produce even a single frame?
 * Runs `ffmpeg -f lavfi -i nullsrc=s=64x64:d=0.01 -c:v <encoder> -f null -`
 * and checks exit code. Timeout 5s to avoid hanging on broken drivers.
 */
function testEncoder(codec: string): Promise<boolean> {
    return new Promise((resolve) => {
        const child = spawn('ffmpeg', [
            '-hide_banner', '-loglevel', 'error',
            '-f', 'lavfi', '-i', 'nullsrc=s=64x64:d=0.01',
            '-c:v', codec,
            '-f', 'null', '-',
        ], { stdio: 'ignore' })

        const timeout = setTimeout(() => {
            child.kill()
            resolve(false)
        }, 5000)

        child.on('close', (code) => {
            clearTimeout(timeout)
            resolve(code === 0)
        })

        child.on('error', () => {
            clearTimeout(timeout)
            resolve(false)
        })
    })
}

// ---------------------------------------------------------------------------
// Encoding quality parameters
// ---------------------------------------------------------------------------

/**
 * Build encoding args optimized for screen recordings on social media.
 *
 * Quality rationale (screen recordings = sharp text, flat colors, UI):
 * - libx264 CRF 18 = near visually lossless, prevents text compression artifacts
 * - `-preset fast` = ~4x faster than default `medium`, minimal quality loss on
 *   screen content. NOT `ultrafast` which compresses so poorly that platforms
 *   (X.com, YouTube) re-encode more aggressively, making it look worse.
 * - `-x264opts deblock=-1,-1` = less deblocking preserves sharp text edges
 * - No `-tune` flag: `animation` blurs text edges, `zerolatency` is for
 *   real-time capture only
 * - h264_videotoolbox `-q:v 80` ≈ CRF 18 equivalent for screen content
 * - `-maxrate 25M` = X.com (Twitter) max bitrate cap
 * - `-movflags +faststart` = metadata at front for web streaming
 * - `-pix_fmt yuv420p` = universal compatibility across all platforms
 */
function buildEncodingArgs(encoder: EncoderInfo): string[] {
    const common = [
        '-pix_fmt', 'yuv420p',
        '-maxrate', '25M',
        '-bufsize', '50M',
        '-movflags', '+faststart',
    ]

    if (encoder.isHardware) {
        // Hardware encoders: use quality-based mode where supported
        // h264_videotoolbox uses -q:v (1-100, 100=best), others use -b:v
        const qualityArgs = encoder.codec === 'h264_videotoolbox'
            ? ['-q:v', '80']
            : ['-b:v', '15M'] // high bitrate for other HW encoders
        return ['-c:v', encoder.codec, ...qualityArgs, ...common]
    }

    // Software: libx264 with screen-recording-optimized settings
    return [
        '-c:v', 'libx264',
        '-crf', '18',
        '-preset', 'fast',
        '-x264opts', 'deblock=-1,-1',
        ...common,
    ]
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InputFile {
    path: string
    start?: number
    end?: number
}

export interface ConcatenateOptions {
    inputFiles: InputFile[]
    outputFile: string
    outputDimensions: { width: number; height: number }
    frameRate: number
    signal?: AbortSignal
}

export interface SpeedSection {
    /** Start time in seconds */
    start: number
    /** End time in seconds */
    end: number
    /** Speed multiplier, e.g. 2 = 2x faster, 0.5 = 2x slower */
    speed: number
}

export interface SpeedUpSectionsOptions {
    inputFile: string
    /** Defaults to inputFile with `-fast` suffix before extension */
    outputFile?: string
    sections: SpeedSection[]
    /** Defaults to input video dimensions (probed via ffprobe) */
    outputDimensions?: { width: number; height: number }
    /** Defaults to input video frame rate (probed via ffprobe) */
    frameRate?: number
    signal?: AbortSignal
}

export interface VideoInfo {
    width: number
    height: number
    frameRate: number
}

function parseFrameRate(value: string | undefined): number | null {
    if (!value) {
        return null
    }

    const [numRaw, denRaw] = value.split('/').map(Number)
    if (!Number.isFinite(numRaw) || !Number.isFinite(denRaw) || denRaw === 0) {
        return null
    }

    const frameRate = numRaw / denRaw
    if (!Number.isFinite(frameRate) || frameRate <= 0) {
        return null
    }

    return frameRate
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Probe input video for dimensions and frame rate via ffprobe. */
export async function probeVideo(filePath: string): Promise<VideoInfo> {
    const stdout = await runCommand({
        bin: 'ffprobe',
        args: [
            '-v', 'error',
            '-select_streams', 'v:0',
            '-show_entries', 'stream=width,height,r_frame_rate,avg_frame_rate',
            '-of', 'json',
            filePath,
        ],
    })

    const parsed = JSON.parse(stdout)
    const stream = parsed.streams?.[0]
    if (!stream) {
        throw new Error(`No video stream found in ${filePath}`)
    }

    // Prefer avg_frame_rate for VFR recordings. r_frame_rate can report
    // high timebase-like values (e.g. 30000/1) that are not usable output FPS.
    const avgFrameRate = parseFrameRate(stream.avg_frame_rate as string | undefined)
    const rawFrameRate = parseFrameRate(stream.r_frame_rate as string | undefined)
    const selectedFrameRate = (() => {
        if (avgFrameRate && avgFrameRate <= 120) {
            return avgFrameRate
        }
        if (rawFrameRate && rawFrameRate <= 120) {
            return rawFrameRate
        }
        if (avgFrameRate) {
            return avgFrameRate
        }
        if (rawFrameRate) {
            return rawFrameRate
        }
        return 30
    })()
    const normalizedFrameRate = Math.min(120, Math.max(1, Math.round(selectedFrameRate)))

    return {
        width: stream.width as number,
        height: stream.height as number,
        frameRate: normalizedFrameRate,
    }
}

/**
 * Run a process with argv (no shell). Returns stdout as string.
 * Avoids shell injection by never passing through a shell interpreter.
 */
function runCommand({
    bin,
    args,
    signal,
}: {
    bin: string
    args: string[]
    signal?: AbortSignal
}): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
        let stdout = ''
        let stderr = ''

        child.stdout.on('data', (data: Buffer) => {
            stdout += data.toString()
        })
        child.stderr.on('data', (data: Buffer) => {
            stderr += data.toString()
        })

        child.on('close', (code) => {
            if (code === 0) {
                resolve(stdout)
            } else {
                reject(new Error(`FFmpeg error (exit ${code}): ${stderr}`))
            }
        })

        child.on('error', (err) => {
            reject(new Error(`Failed to start ${bin}`, { cause: err }))
        })

        if (signal) {
            signal.addEventListener(
                'abort',
                () => {
                    child.kill()
                    reject(
                        signal.reason instanceof Error
                            ? signal.reason
                            : new Error('Operation aborted'),
                    )
                },
                { once: true },
            )
        }
    })
}

/** Build default output path: `/dir/name-fast.ext` */
function defaultOutputPath(inputFile: string): string {
    const ext = path.extname(inputFile)
    const base = path.basename(inputFile, ext)
    const dir = path.dirname(inputFile)
    return path.join(dir, `${base}-fast${ext}`)
}

// ---------------------------------------------------------------------------
// Internal segment types
// ---------------------------------------------------------------------------

interface Segment {
    start: number
    /** undefined = until end of video */
    end: number | undefined
    /** 1 = normal speed */
    speed: number
}

/**
 * Given sorted, non-overlapping SpeedSections, fill gaps with normal-speed
 * segments so the entire video is covered.
 */
function buildSegments(sections: SpeedSection[]): Segment[] {
    const sorted = [...sections].sort((a, b) => {
        return a.start - b.start
    })

    // Validate: no overlaps
    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].start < sorted[i - 1].end) {
            throw new Error(
                `Sections overlap: [${sorted[i - 1].start}-${sorted[i - 1].end}] and [${sorted[i].start}-${sorted[i].end}]`,
            )
        }
    }

    const segments: Segment[] = []
    let cursor = 0

    for (const section of sorted) {
        // Gap before this section → normal speed
        if (section.start > cursor) {
            segments.push({ start: cursor, end: section.start, speed: 1 })
        }
        // The speed section itself
        segments.push({
            start: section.start,
            end: section.end,
            speed: section.speed,
        })
        cursor = section.end
    }

    // Trailing normal-speed segment (no end bound → until EOF)
    segments.push({ start: cursor, end: undefined, speed: 1 })

    return segments
}

/**
 * Build the filter string for a single segment.
 *
 * For sped-up segments: `[0:v]trim=...,setpts=...,fps=...,scale=...[vN]`
 * For normal-speed segments where dimensions/fps match input: just
 * `[0:v]trim=...,setpts=PTS-STARTPTS[vN]` — skips fps and scale filters
 * to avoid unnecessary pixel processing and frame-rate checking.
 */
function buildSegmentFilter({
    segment,
    index,
    frameRate,
    width,
    height,
    inputWidth,
    inputHeight,
    inputFrameRate,
}: {
    segment: Segment
    index: number
    frameRate: number
    width: number
    height: number
    /** Original input dimensions — when they match output, scale is skipped on passthrough */
    inputWidth?: number
    inputHeight?: number
    /** Original input fps — when it matches output, fps filter is skipped on passthrough */
    inputFrameRate?: number
}): string {
    const trimParts = [`start=${segment.start}`]
    if (segment.end !== undefined) {
        trimParts.push(`end=${segment.end}`)
    }
    const trim = `trim=${trimParts.join(':')}`

    // setpts=PTS-STARTPTS resets timestamps after trim.
    // Dividing by speed makes it faster (speed>1) or slower (speed<1).
    const setpts =
        segment.speed === 1
            ? 'setpts=PTS-STARTPTS'
            : `setpts=(PTS-STARTPTS)/${segment.speed}`

    // For normal-speed segments where output matches input: skip fps/scale
    // to avoid unnecessary pixel processing and frame-rate filtering
    const isPassthrough = segment.speed === 1
        && inputWidth === width
        && inputHeight === height
        && inputFrameRate === frameRate

    if (isPassthrough) {
        return `[0:v]${trim},${setpts}[v${index}]`
    }

    // Cap output FPS to the probed source FPS. This prevents sped-up sections
    // from producing excessive frame rates when timestamps are compressed.
    const fps = `fps=fps=${frameRate}:round=down`

    return `[0:v]${trim},${setpts},${fps},scale=${width}:${height}[v${index}]`
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function concatenateVideos(
    options: ConcatenateOptions,
): Promise<void> {
    const { outputDimensions, frameRate, inputFiles, outputFile, signal } =
        options

    if (!outputDimensions || !frameRate || !inputFiles || !outputFile) {
        throw new Error('Missing required parameters')
    }

    const timerId = `concat-${inputFiles.length}-videos-${path.basename(outputFile)}`
    console.time(timerId)

    const encoder = await detectEncoder()
    const encodingArgs = buildEncodingArgs(encoder)

    // Build argv: -i file1 -i file2 ... -filter_complex "..." -map "[v_out]" output
    const inputArgs = inputFiles.flatMap((file) => {
        return ['-i', file.path]
    })

    const filterComplexParts: string[] = []
    const videoStreamParts: string[] = []

    inputFiles.forEach((file, index) => {
        const videoStream = `[${index}:v:0]`
        let trimmedVideo = videoStream

        if (file.start !== undefined || file.end !== undefined) {
            const start = file.start ?? 0
            const end = file.end ? `end=${file.end}` : ''
            trimmedVideo = `${videoStream}trim=start=${start}:${end},setpts=PTS-STARTPTS`
        }

        filterComplexParts.push(
            `${trimmedVideo},fps=${frameRate},scale=${outputDimensions.width}:${outputDimensions.height}[v${index}]`,
        )
        videoStreamParts.push(`[v${index}]`)
    })

    filterComplexParts.push(
        `${videoStreamParts.join('')}concat=n=${inputFiles.length}:v=1:a=0[v_out]`,
    )

    const filterComplex = filterComplexParts.join('; ')
    const args = [
        ...inputArgs,
        '-filter_complex', filterComplex,
        '-map', '[v_out]',
        ...encodingArgs,
        outputFile,
    ]

    console.log('Running FFmpeg concat:', args.join(' '))

    try {
        await runCommand({ bin: 'ffmpeg', args, signal })
    } finally {
        console.timeEnd(timerId)
    }
}

/**
 * Speed up (or slow down) sections of a video by timestamp ranges.
 *
 * Sections not covered by any SpeedSection play at normal speed.
 * Uses a single ffmpeg filter_complex: trim each segment, apply setpts
 * speed, normalize fps/scale, then concat — no intermediate files.
 *
 * @example
 * ```ts
 * await speedUpSections({
 *   inputFile: 'recording.mp4',
 *   sections: [
 *     { start: 10, end: 20, speed: 4 },  // 4x between 10s-20s
 *     { start: 30, end: 40, speed: 2 },  // 2x between 30s-40s
 *   ],
 * })
 * // → outputs recording-fast.mp4
 * ```
 */
export async function speedUpSections(
    options: SpeedUpSectionsOptions,
): Promise<string> {
    const { inputFile, sections, signal } = options

    if (sections.length === 0) {
        throw new Error('At least one speed section is required')
    }
    for (const s of sections) {
        if (s.speed <= 0) {
            throw new Error(`Speed must be > 0, got ${s.speed}`)
        }
        if (s.end <= s.start) {
            throw new Error(
                `Section end (${s.end}) must be greater than start (${s.start})`,
            )
        }
    }

    const outputFile = options.outputFile ?? defaultOutputPath(inputFile)

    // Probe input when needed for defaults or for passthrough optimization
    const dims = options.outputDimensions
    const fps = options.frameRate
    const probed = (!dims || !fps) ? await probeVideo(inputFile) : undefined

    const width = dims?.width ?? probed!.width
    const height = dims?.height ?? probed!.height
    const frameRate = fps ?? probed!.frameRate

    const encoder = await detectEncoder()
    const encodingArgs = buildEncodingArgs(encoder)

    const timerId = `speedup-${sections.length}-sections-${path.basename(outputFile)}`
    console.time(timerId)

    const segments = buildSegments(sections)

    const filterParts = segments.map((segment, index) => {
        return buildSegmentFilter({
            segment,
            index,
            frameRate,
            width,
            height,
            inputWidth: probed?.width,
            inputHeight: probed?.height,
            inputFrameRate: probed?.frameRate,
        })
    })

    const streamLabels = segments.map((_, i) => {
        return `[v${i}]`
    }).join('')

    filterParts.push(
        `${streamLabels}concat=n=${segments.length}:v=1:a=0[v_out]`,
    )

    const filterComplex = filterParts.join('; ')
    const args = [
        '-i', inputFile,
        '-filter_complex', filterComplex,
        '-map', '[v_out]',
        '-r', String(frameRate),
        ...encodingArgs,
        outputFile,
    ]

    console.log('Running FFmpeg speedup:', args.join(' '))

    try {
        await runCommand({ bin: 'ffmpeg', args, signal })
    } finally {
        console.timeEnd(timerId)
    }

    return outputFile
}

// ---------------------------------------------------------------------------
// Idle section computation
// ---------------------------------------------------------------------------

export interface ExecutionTimestamp {
    /** Start time in seconds relative to recording start */
    start: number
    /** End time in seconds relative to recording start */
    end: number
}

/**
 * Compute which parts of a recording are "idle" (no execute() calls)
 * and return them as SpeedSections that can be passed to speedUpSections().
 *
 * A buffer of INTERACTION_BUFFER_SECONDS is kept around each execution
 * at normal speed so the viewer sees context before/after each action.
 *
 * @example
 * ```ts
 * const { executionTimestamps, duration } = await stopRecording()
 * const idleSections = computeIdleSections({
 *   executionTimestamps,
 *   totalDurationMs: duration,
 * })
 * await speedUpSections({
 *   inputFile: recordingPath,
 *   sections: idleSections,
 * })
 * ```
 */
export function computeIdleSections({
    executionTimestamps,
    totalDurationMs,
    speed = 5,
    bufferSeconds = INTERACTION_BUFFER_SECONDS,
}: {
    executionTimestamps: ExecutionTimestamp[]
    /** Total recording duration in milliseconds (from stopRecording result) */
    totalDurationMs: number
    /** Speed multiplier for idle sections (default 5) */
    speed?: number
    /** Override the default buffer around each execution (seconds) */
    bufferSeconds?: number
}): SpeedSection[] {
    const totalDuration = totalDurationMs / 1000

    if (executionTimestamps.length === 0) {
        // No execute() boundaries were captured. This commonly happens when
        // recording starts and stops inside a single execute() call.
        // In this case we cannot infer idle gaps safely, so keep original speed.
        return []
    }

    // Apply buffer: expand each execution range by bufferSeconds on each side,
    // clamp to video bounds, then filter out any ranges that become invalid
    // (e.g. timestamps that exceed the video duration).
    const buffered = executionTimestamps
        .map((t) => ({
            start: Math.max(0, t.start - bufferSeconds),
            end: Math.min(totalDuration, t.end + bufferSeconds),
        }))
        .filter((r) => {
            return Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start
        })
        .sort((a, b) => {
            return a.start - b.start
        })

    // Merge overlapping/adjacent buffered ranges
    const merged: Array<{ start: number; end: number }> = []
    for (const range of buffered) {
        const last = merged[merged.length - 1]
        if (last && range.start <= last.end) {
            last.end = Math.max(last.end, range.end)
        } else {
            merged.push({ ...range })
        }
    }

    // Gaps between merged active ranges are idle sections to speed up
    const idle: SpeedSection[] = []
    let cursor = 0

    for (const active of merged) {
        if (active.start > cursor) {
            idle.push({ start: cursor, end: active.start, speed })
        }
        cursor = active.end
    }

    // Trailing idle after last execution
    if (cursor < totalDuration) {
        idle.push({ start: cursor, end: totalDuration, speed })
    }

    return idle
}

// ---------------------------------------------------------------------------
// High-level demo video creation
// ---------------------------------------------------------------------------

export interface CreateDemoVideoOptions {
    /** Path to the raw recording file */
    recordingPath: string
    /** Total recording duration in milliseconds (from stopRecording result) */
    durationMs: number
    /** Execution timestamps (from stopRecording result) */
    executionTimestamps: ExecutionTimestamp[]
    /** Speed multiplier for idle sections (default 5) */
    speed?: number
    /** Output file path (defaults to recordingPath with `-demo` suffix) */
    outputFile?: string
    signal?: AbortSignal
}

/**
 * Create a demo video from a recording by speeding up idle sections
 * (gaps between execute() calls) while keeping interactions at normal speed.
 *
 * A 1-second buffer (INTERACTION_BUFFER_SECONDS) is preserved around each
 * interaction so viewers see context before and after each action.
 *
 * Requires `ffmpeg` and `ffprobe` installed on the system.
 *
 * @returns The output file path
 */
export async function createDemoVideo(
    options: CreateDemoVideoOptions,
): Promise<string> {
    const {
        recordingPath,
        durationMs,
        executionTimestamps,
        speed = 5,
        signal,
    } = options

    const outputFile = options.outputFile ?? (() => {
        const ext = path.extname(recordingPath)
        const base = path.basename(recordingPath, ext)
        const dir = path.dirname(recordingPath)
        return path.join(dir, `${base}-demo${ext}`)
    })()

    const idleSections = computeIdleSections({
        executionTimestamps,
        totalDurationMs: durationMs,
        speed,
    })

    if (idleSections.length === 0) {
        // No idle sections, nothing to speed up — copy as-is
        const { copyFile } = await import('node:fs/promises')
        await copyFile(recordingPath, outputFile)
        return outputFile
    }

    return speedUpSections({
        inputFile: recordingPath,
        outputFile,
        sections: idleSections,
        signal,
    })
}
