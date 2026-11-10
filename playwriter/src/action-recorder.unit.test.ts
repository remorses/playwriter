// Unit tests for ActionRecordingManager start timeout, zombie cleanup, and max duration.
import { describe, expect, test } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { BrowserContext } from '@xmorse/playwright-core'
import {
  ActionRecordingManager,
  closestFrameFile,
  collapseRepeatedNetwork,
  formatAmbiguousRecordingsError,
  isProblemEvent,
  isTelemetryUrl,
  MAX_ACTIVE_RECORDINGS,
  parseRecording,
  pickRecorderStartSession,
  projectThinEvent,
} from './action-recorder.js'

function createFakeContext(options: {
  enable?: () => Promise<void>
  disable?: () => Promise<void>
}): BrowserContext {
  return {
    _startRecording: options.enable ?? (async () => {}),
    _stopRecording: options.disable ?? (async () => {}),
    pages: () => [],
    on: () => {},
    off: () => {},
  } as unknown as BrowserContext
}

async function withTempRecordings(fn: (dir: string) => Promise<void>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-rec-unit-'))
  const previous = process.env.PLAYWRITER_RECORDINGS_DIR
  process.env.PLAYWRITER_RECORDINGS_DIR = dir
  try {
    await fn(dir)
  } finally {
    if (previous === undefined) {
      delete process.env.PLAYWRITER_RECORDINGS_DIR
    } else {
      process.env.PLAYWRITER_RECORDINGS_DIR = previous
    }
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

describe('isTelemetryUrl', () => {
  test('drops analytics collectors and keeps site APIs', () => {
    expect(isTelemetryUrl('https://www.google-analytics.com/j/collect?v=1')).toBe(true)
    expect(isTelemetryUrl('https://region1.google-analytics.com/g/collect?v=2')).toBe(true)
    expect(isTelemetryUrl('https://uj5wyc0l7x-dsn.algolia.net/1/indexes/Item_dev/query')).toBe(false)
    expect(isTelemetryUrl('https://news.ycombinator.com/x')).toBe(false)
    expect(isTelemetryUrl('https://api.twitter.com/2/tweets')).toBe(false)
    expect(isTelemetryUrl('https://example.com/api?next=https://analytics.example')).toBe(false)
  })
})

describe('ActionRecordingManager start lifecycle', () => {
  test('start times out a hung _startRecording and leaves no active recording', async () => {
    await withTempRecordings(async () => {
      const manager = new ActionRecordingManager({
        logger: { log: () => {}, error: () => {} },
      })
      const start = manager.start({
        context: createFakeContext({
          enable: () => {
            return new Promise(() => {})
          },
        }),
        sessionId: '1',
        enableTimeoutMs: 40,
      })
      await expect(start).rejects.toThrow(/failed to start within 40ms/i)
      expect(manager.list()).toEqual([])
    })
  })

  test('stop during a hung start removes the recording so a new start can run', async () => {
    await withTempRecordings(async () => {
      const manager = new ActionRecordingManager({
        logger: { log: () => {}, error: () => {} },
      })
      const start = manager.start({
        context: createFakeContext({
          enable: () => {
            return new Promise(() => {})
          },
        }),
        sessionId: '1',
        enableTimeoutMs: 200,
      })
      await wait(10)
      expect(manager.list()).toHaveLength(1)
      const stopped = await manager.stop({})
      expect(stopped.recordingId).toBeTruthy()
      await expect(start).rejects.toThrow(/stopped before it finished starting/i)
      expect(manager.list()).toEqual([])

      const recorder = await manager.start({
        context: createFakeContext({}),
        sessionId: '1',
        enableTimeoutMs: 40,
      })
      expect(recorder.recordingId).not.toBe(stopped.recordingId)
      await manager.stop({})
    })
  })

  test('recording auto-stops after maxDurationMs', async () => {
    await withTempRecordings(async (dir) => {
      const active: boolean[] = []
      const manager = new ActionRecordingManager({
        logger: { log: () => {}, error: () => {} },
        onActiveChanged: (value) => {
          active.push(value)
        },
      })
      const recorder = await manager.start({
        context: createFakeContext({}),
        sessionId: '1',
        maxDurationMs: 40,
      })
      expect(manager.list()).toHaveLength(1)
      await wait(120)
      expect(manager.list()).toEqual([])
      expect(active).toEqual([true, false])
      const events = parseRecording(fs.readFileSync(path.join(dir, `${recorder.recordingId}.json`), 'utf-8'))
      const stopped = events.filter((event) => {
        return event.type === 'recording-stopped'
      })
      expect(stopped).toHaveLength(1)
      expect(stopped[0].reason).toBe('max-duration')
    })
  })

  test('recording auto-stops when it grows past maxBytes', async () => {
    await withTempRecordings(async (dir) => {
      const manager = new ActionRecordingManager({
        logger: { log: () => {}, error: () => {} },
      })
      // The recording-started event alone is larger than 10 bytes
      const recorder = await manager.start({
        context: createFakeContext({}),
        sessionId: '1',
        maxBytes: 10,
      })
      await wait(20)
      expect(manager.list()).toEqual([])
      const events = parseRecording(fs.readFileSync(path.join(dir, `${recorder.recordingId}.json`), 'utf-8'))
      const stopped = events.find((event) => {
        return event.type === 'recording-stopped'
      })
      expect({ reason: stopped?.reason, maxBytes: stopped?.maxBytes, overLimit: Number(stopped?.bytes) > 10 })
        .toMatchInlineSnapshot(`
          {
            "maxBytes": 10,
            "overLimit": true,
            "reason": "max-size",
          }
        `)
    })
  })

  test('notifies onActiveChanged on every successful start, not only the first', async () => {
    await withTempRecordings(async () => {
      const active: boolean[] = []
      const manager = new ActionRecordingManager({
        logger: { log: () => {}, error: () => {} },
        onActiveChanged: (value) => {
          active.push(value)
        },
      })
      await manager.start({
        context: createFakeContext({}),
        sessionId: '1',
      })
      await manager.start({
        context: createFakeContext({}),
        sessionId: '2',
      })
      expect(active).toEqual([true, true])
      const firstId = manager.list()[0].recordingId
      await manager.stop({ recordingId: firstId })
      expect(active).toEqual([true, true])
      await manager.stop({})
      expect(active).toEqual([true, true, false])
    })
  })

  test('start still fails when disable also hangs', async () => {
    await withTempRecordings(async () => {
      const manager = new ActionRecordingManager({
        logger: { log: () => {}, error: () => {} },
      })
      const start = manager.start({
        context: createFakeContext({
          enable: () => {
            return new Promise(() => {})
          },
          disable: () => {
            return new Promise(() => {})
          },
        }),
        sessionId: '1',
        enableTimeoutMs: 40,
        disableTimeoutMs: 40,
      })
      await expect(start).rejects.toThrow(/failed to start within 40ms/i)
      expect(manager.list()).toEqual([])
    })
  })

  test('stop after enable but before start finishes does not report success', async () => {
    await withTempRecordings(async () => {
      let release: (() => void) | undefined
      const hold = new Promise<void>((resolve) => {
        release = resolve
      })
      const manager = new ActionRecordingManager({
        logger: { log: () => {}, error: () => {} },
      })
      const start = manager.start({
        context: createFakeContext({}),
        sessionId: '1',
        holdAfterEnable: () => {
          return hold
        },
      })
      await wait(10)
      expect(manager.list()).toHaveLength(1)
      await manager.stop({})
      release?.()
      await expect(start).rejects.toThrow(/stopped before it finished starting/i)
      expect(manager.list()).toEqual([])
    })
  })
})

describe('pickRecorderStartSession', () => {
  test('uses an explicit session id', () => {
    expect(
      pickRecorderStartSession({
        explicitSessionId: '9',
        sessions: [
          { id: '1', extensionId: 'ext' },
          { id: '2', extensionId: 'ext' },
        ],
        busySessionIds: ['1'],
      }),
    ).toEqual({ kind: 'use', sessionId: '9' })
  })

  test('picks a free extension session when many exist', () => {
    expect(
      pickRecorderStartSession({
        sessions: [
          { id: '1', extensionId: null },
          { id: '2', extensionId: 'ext' },
          { id: '3', extensionId: 'ext' },
        ],
        busySessionIds: ['2'],
      }),
    ).toEqual({ kind: 'use', sessionId: '3' })
  })

  test('creates when every extension session is already recording', () => {
    expect(
      pickRecorderStartSession({
        sessions: [
          { id: '1', extensionId: 'ext' },
          { id: '2', extensionId: 'ext' },
        ],
        busySessionIds: ['1', '2'],
      }),
    ).toEqual({ kind: 'create' })
  })

  test('creates when only headless sessions exist', () => {
    expect(
      pickRecorderStartSession({
        sessions: [{ id: '1', extensionId: null }],
        busySessionIds: [],
      }),
    ).toEqual({ kind: 'create' })
  })

  test('never selects a remote-control session implicitly', () => {
    expect(
      pickRecorderStartSession({
        sessions: [
          { id: 'remote', extensionId: 'remote:hashed-id' },
          { id: 'local', extensionId: 'install:Chrome:local' },
        ],
        busySessionIds: [],
      }),
    ).toEqual({ kind: 'use', sessionId: 'local' })

    expect(
      pickRecorderStartSession({
        sessions: [{ id: 'remote', extensionId: 'remote:hashed-id' }],
        busySessionIds: [],
      }),
    ).toEqual({ kind: 'create' })
  })
})

describe('ActionRecordingManager active recording cap', () => {
  test('stops the oldest recording instead of failing a new start', async () => {
    await withTempRecordings(async (dir) => {
      const manager = new ActionRecordingManager({
        logger: { log: () => {}, error: () => {} },
      })
      const first = await manager.start({
        context: createFakeContext({}),
        sessionId: '1',
      })
      for (let i = 2; i <= MAX_ACTIVE_RECORDINGS; i++) {
        await manager.start({
          context: createFakeContext({}),
          sessionId: String(i),
        })
      }
      expect(manager.list()).toHaveLength(MAX_ACTIVE_RECORDINGS)

      const next = await manager.start({
        context: createFakeContext({}),
        sessionId: 'overflow',
      })
      const activeIds = manager.list().map((recording) => {
        return recording.recordingId
      })
      expect(activeIds).toHaveLength(MAX_ACTIVE_RECORDINGS)
      expect(activeIds).not.toContain(first.recordingId)
      expect(activeIds).toContain(next.recordingId)

      const stopped = parseRecording(fs.readFileSync(path.join(dir, `${first.recordingId}.json`), 'utf-8'))
      expect(stopped.some((event) => {
        return event.type === 'recording-stopped' && event.reason === 'replaced'
      })).toBe(true)
    })
  })
})

describe('ActionRecordingManager stop disambiguation', () => {
  test('stop without an id throws with page urls when two recordings are active', async () => {
    await withTempRecordings(async () => {
      const manager = new ActionRecordingManager({
        logger: { log: () => {}, error: () => {} },
      })
      const first = await manager.start({
        context: createFakeContext({}),
        sessionId: '1',
      })
      const second = await manager.start({
        context: createFakeContext({}),
        sessionId: '2',
      })
      await expect(manager.stop({})).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringContaining('Multiple active recordings'),
        recordings: [
          { recordingId: first.recordingId, sessionId: '1' },
          { recordingId: second.recordingId, sessionId: '2' },
        ],
      })
      expect(manager.list()).toHaveLength(2)
      const stopped = await manager.stop({ recordingId: first.recordingId })
      expect(stopped.recordingId).toBe(first.recordingId)
      expect(manager.list()).toHaveLength(1)
      await manager.stop({})
    })
  })

  test('formatAmbiguousRecordingsError lists current or last urls', () => {
    expect(
      formatAmbiguousRecordingsError([
        { recordingId: '3', sessionId: '1', pageUrls: ['https://app.example.com/settings'], lastUrl: '' },
        { recordingId: '5', sessionId: '2', pageUrls: [], lastUrl: 'https://github.com/remorses/playwriter' },
      ]),
    ).toMatchInlineSnapshot(`
      "Multiple active recordings. Pass a recording id.

        3  session 1  https://app.example.com/settings
        5  session 2  https://github.com/remorses/playwriter"
    `)
  })
})

describe('projectThinEvent', () => {
  test('keeps a truncated page-error message', () => {
    const thin = projectThinEvent({
      t: 1,
      type: 'page-error',
      message: 'x'.repeat(250),
    })
    expect(typeof thin.message).toBe('string')
    expect(String(thin.message).startsWith('x')).toBe(true)
    expect(String(thin.message).length).toBeLessThan(250)
    expect(String(thin.message)).toContain('more chars')
  })
})

describe('reading a recording', () => {
  test('collapses repeated requests, filters problems and finds frames', () => {
    const events = [
      { id: 1, t: 0, ms: 0, type: 'action', code: 'click' },
      { id: 2, t: 0.1, ms: 100, type: 'network', method: 'POST', url: 'https://a.com/list', status: 200 },
      { id: 3, t: 0.1, ms: 110, type: 'network', method: 'POST', url: 'https://a.com/list', status: 200 },
      { id: 4, t: 0.1, ms: 120, type: 'network', method: 'POST', url: 'https://a.com/list', status: 200 },
      { id: 5, t: 0.2, ms: 200, type: 'network', method: 'POST', url: 'https://a.com/generate', status: 403 },
      { id: 6, t: 0.3, ms: 300, type: 'toast', role: 'status', text: 'Concurrent limit reached' },
      { id: 7, t: 0.4, ms: 400, type: 'network', method: 'POST', url: 'https://a.com/list', status: 200 },
    ]
    expect(
      collapseRepeatedNetwork(events).map((event) => {
        return [event.id, event.repeat, event.lastId]
      }),
    ).toMatchInlineSnapshot(`
      [
        [
          1,
          undefined,
          undefined,
        ],
        [
          2,
          3,
          4,
        ],
        [
          5,
          undefined,
          undefined,
        ],
        [
          6,
          undefined,
          undefined,
        ],
        [
          7,
          undefined,
          undefined,
        ],
      ]
    `)
    expect(events.filter(isProblemEvent).map((event) => event.id)).toEqual([5, 6])
    const frameFiles = ['900.jpg', '100.jpg', '100-2.jpg', '450.jpg', 'notes.txt']
    expect(closestFrameFile({ frameFiles, ms: 50 })).toBe('100.jpg')
    expect(closestFrameFile({ frameFiles, ms: 449 })).toBe('100-2.jpg')
    expect(closestFrameFile({ frameFiles, ms: 5000 })).toBe('900.jpg')
    expect(closestFrameFile({ frameFiles: [], ms: 0 })).toBe(null)
  })
})
