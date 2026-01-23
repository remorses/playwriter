/**
 * Screen recording utility for playwriter.
 * Uses getDisplayMedia with preferCurrentTab to capture the tab at native FPS (30-60fps).
 * 
 * Note: Requires Chrome to be launched with these flags for auto-accept:
 * --auto-accept-this-tab-capture
 * --use-fake-ui-for-media-stream
 */

/// <reference lib="dom" />

import type { Page } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

export interface StartRecordingOptions {
  /** Target page to record */
  page: Page
  /** Frame rate (default: 30) */
  frameRate?: number
  /** Video bitrate in bps (default: 2500000 = 2.5 Mbps) */
  videoBitsPerSecond?: number
  /** Audio bitrate in bps (default: 128000 = 128 kbps) */
  audioBitsPerSecond?: number
  /** Include audio from tab (default: true) */
  audio?: boolean
  /** Mime type (default: 'video/webm;codecs=vp9,opus' or 'video/webm;codecs=vp9' if no audio) */
  mimeType?: string
}

export interface StopRecordingOptions {
  /** Target page that is being recorded */
  page: Page
  /** Path to save the video file */
  outputPath: string
}

export interface RecordingState {
  isRecording: boolean
  startedAt?: number
}

/**
 * Start recording the page.
 * The recording state is stored in the page's window object.
 */
export async function startRecording(options: StartRecordingOptions): Promise<RecordingState> {
  const {
    page,
    frameRate = 30,
    videoBitsPerSecond = 2500000,
    audioBitsPerSecond = 128000,
    audio = true,
    mimeType,
  } = options

  const result = await page.evaluate(async ({ frameRate, videoBitsPerSecond, audioBitsPerSecond, audio, mimeType }) => {
    // Check if already recording
    if ((window as any).__playwriterRecorder) {
      return { isRecording: true, startedAt: (window as any).__playwriterRecordingStartedAt, error: 'Already recording' }
    }

    try {
      // Request tab capture with preferCurrentTab
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: frameRate, max: 60 },
          // @ts-ignore - preferCurrentTab is a newer API
          displaySurface: 'browser',
        },
        audio: audio,
        // @ts-ignore - preferCurrentTab is Chrome-specific
        preferCurrentTab: true,
        // @ts-ignore
        selfBrowserSurface: 'include',
        // @ts-ignore
        systemAudio: audio ? 'include' : 'exclude',
      } as any)

      // Determine mime type
      const codecMimeType = mimeType || (audio ? 'video/webm;codecs=vp9,opus' : 'video/webm;codecs=vp9')
      
      // Check if codec is supported
      if (!MediaRecorder.isTypeSupported(codecMimeType)) {
        // Fall back to basic webm
        const fallbackMimeType = audio ? 'video/webm' : 'video/webm'
        if (!MediaRecorder.isTypeSupported(fallbackMimeType)) {
          stream.getTracks().forEach(t => t.stop())
          return { isRecording: false, error: 'No supported video codec found' }
        }
      }

      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported(codecMimeType) ? codecMimeType : 'video/webm',
        videoBitsPerSecond,
        audioBitsPerSecond,
      })

      const chunks: Blob[] = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data)
        }
      }

      // Store references for later
      ;(window as any).__playwriterRecorder = recorder
      ;(window as any).__playwriterStream = stream
      ;(window as any).__playwriterChunks = chunks
      ;(window as any).__playwriterRecordingStartedAt = Date.now()

      // Start recording with 1 second timeslice for regular data availability
      recorder.start(1000)

      return { isRecording: true, startedAt: Date.now() }
    } catch (err: any) {
      return { isRecording: false, error: err.message || String(err) }
    }
  }, { frameRate, videoBitsPerSecond, audioBitsPerSecond, audio, mimeType })

  if ((result as any).error) {
    throw new Error(`Failed to start recording: ${(result as any).error}`)
  }

  return result as RecordingState
}

/**
 * Stop recording and save to file.
 * Returns the path to the saved video file.
 */
export async function stopRecording(options: StopRecordingOptions): Promise<{ path: string; duration: number; size: number }> {
  const { page, outputPath } = options

  // Ensure output directory exists
  const dir = path.dirname(outputPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const result = await page.evaluate(async () => {
    const recorder = (window as any).__playwriterRecorder as MediaRecorder | undefined
    const stream = (window as any).__playwriterStream as MediaStream | undefined
    const chunks = (window as any).__playwriterChunks as Blob[] | undefined
    const startedAt = (window as any).__playwriterRecordingStartedAt as number | undefined

    if (!recorder || !stream || !chunks) {
      return { error: 'No active recording found' }
    }

    // Stop recording and wait for final data
    return new Promise<{ base64: string; duration: number; mimeType: string } | { error: string }>((resolve) => {
      recorder.onstop = async () => {
        try {
          // Stop all tracks
          stream.getTracks().forEach(t => t.stop())

          // Create blob from chunks
          const blob = new Blob(chunks, { type: recorder.mimeType })
          
          // Convert to base64
          const reader = new FileReader()
          reader.onloadend = () => {
            const base64 = (reader.result as string).split(',')[1]
            
            // Clean up
            delete (window as any).__playwriterRecorder
            delete (window as any).__playwriterStream
            delete (window as any).__playwriterChunks
            delete (window as any).__playwriterRecordingStartedAt

            resolve({
              base64,
              duration: startedAt ? Date.now() - startedAt : 0,
              mimeType: recorder.mimeType,
            })
          }
          reader.onerror = () => {
            resolve({ error: 'Failed to read recording data' })
          }
          reader.readAsDataURL(blob)
        } catch (err: any) {
          resolve({ error: err.message || String(err) })
        }
      }

      recorder.onerror = (e: any) => {
        resolve({ error: e.error?.message || 'Recording error' })
      }

      // Request final data and stop
      if (recorder.state !== 'inactive') {
        recorder.stop()
      } else {
        // Already stopped, process existing chunks
        recorder.onstop?.(new Event('stop') as any)
      }
    })
  })

  if ((result as any).error) {
    throw new Error(`Failed to stop recording: ${(result as any).error}`)
  }

  const { base64, duration, mimeType } = result as { base64: string; duration: number; mimeType: string }

  // Determine file extension from mime type
  let finalPath = outputPath
  if (!path.extname(outputPath)) {
    const ext = mimeType.includes('mp4') ? '.mp4' : '.webm'
    finalPath = outputPath + ext
  }

  // Write to file
  const buffer = Buffer.from(base64, 'base64')
  fs.writeFileSync(finalPath, buffer)

  return {
    path: finalPath,
    duration,
    size: buffer.length,
  }
}

/**
 * Check if recording is currently active on a page.
 */
export async function isRecording(options: { page: Page }): Promise<RecordingState> {
  const { page } = options

  const result = await page.evaluate(() => {
    const recorder = (window as any).__playwriterRecorder as MediaRecorder | undefined
    const startedAt = (window as any).__playwriterRecordingStartedAt as number | undefined
    
    return {
      isRecording: !!recorder && recorder.state === 'recording',
      startedAt,
    }
  })

  return result
}

/**
 * Cancel recording without saving.
 */
export async function cancelRecording(options: { page: Page }): Promise<void> {
  const { page } = options

  await page.evaluate(() => {
    const recorder = (window as any).__playwriterRecorder as MediaRecorder | undefined
    const stream = (window as any).__playwriterStream as MediaStream | undefined

    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
    }
    
    if (stream) {
      stream.getTracks().forEach(t => t.stop())
    }

    // Clean up
    delete (window as any).__playwriterRecorder
    delete (window as any).__playwriterStream
    delete (window as any).__playwriterChunks
    delete (window as any).__playwriterRecordingStartedAt
  })
}
