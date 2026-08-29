/**
 * The tracker exists because a download guid carries no file path and Chrome's download
 * manager lags behind CDP. Three unsound shortcuts are what these tests exist to prevent.
 *
 * Looking the file up by URL: downloading twice from the same export endpoint is ordinary,
 * and a URL lookup during that lag hands download.saveAs() the previous file. The harness
 * below answers URL queries the way Chrome does — as a regex over all history — so an
 * implementation that reaches for one is caught rather than accidentally correct.
 *
 * Adopting a chrome.downloads.onCreated item announced before the guid: Chrome reports every
 * download in the profile, including from tabs Playwright never attached to, and DownloadItem
 * carries no tabId. Measured against the real extension, Page.downloadWillBegin always
 * reaches the service worker first, so an item that arrived earlier is provably not this
 * download's — whether it has finished or is still running.
 *
 * Pairing same-URL downloads by arrival order: an unrelated tab's creation racing into the
 * gap is absorbed by the pairing instead of showing up as an item too many, so downloads of
 * one URL that overlap are refused rather than matched up.
 */
import { describe, test, expect } from 'vitest'
import { createDownloadTracker, type DownloadChangeDelta, type TrackedDownloadItem } from './download-tracker.js'

/** Flushes every pending microtask, so a search() promise chain has settled. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function unattributable(url: string): string {
  return `Chrome reported more than one download of ${url} and its download items name no tab, so the file for this download could not be identified`
}

/** What Chrome's own downloads list would answer, including for the URL queries this
 *  implementation must never make: `DownloadQuery.url` is a regular expression matched
 *  against every item in history, which is exactly how a stale download gets returned. */
type SearchQuery = { id?: number; url?: string }

function createHarness({ timeoutMs = 5000, maxTracked }: { timeoutMs?: number; maxTracked?: number } = {}) {
  const items = new Map<number, TrackedDownloadItem & { url?: string }>()
  const listeners = new Set<(delta: DownloadChangeDelta) => void>()
  const timers = new Map<number, () => void>()
  const searchQueries: SearchQuery[] = []
  let searchFailure: Error | undefined
  let nextTimer = 1

  const search = async (query: SearchQuery): Promise<TrackedDownloadItem[]> => {
    searchQueries.push(query)
    if (searchFailure) {
      throw searchFailure
    }
    if (query.url !== undefined) {
      const pattern = new RegExp(query.url)
      return Array.from(items.values()).filter((item) => item.url !== undefined && pattern.test(item.url))
    }
    if (query.id === undefined) {
      return Array.from(items.values())
    }
    const item = items.get(query.id)
    return item ? [item] : []
  }

  const tracker = createDownloadTracker({
    search,
    addChangeListener: (listener) => {
      listeners.add(listener)
    },
    removeChangeListener: (listener) => {
      listeners.delete(listener)
    },
    setTimeout: (callback) => {
      const handle = nextTimer++
      timers.set(handle, callback)
      return handle
    },
    clearTimeout: (handle) => {
      timers.delete(handle as number)
    },
    timeoutMs,
    maxTracked,
  })

  return {
    tracker,
    searchQueries,
    /** Puts an item in Chrome's download list without announcing it. */
    setItem(item: TrackedDownloadItem & { url?: string }) {
      items.set(item.id, item)
    },
    failSearch(error: Error) {
      searchFailure = error
    },
    emitChanged(delta: DownloadChangeDelta) {
      for (const listener of Array.from(listeners)) {
        listener(delta)
      }
    },
    fireTimeouts() {
      for (const callback of Array.from(timers.values())) {
        callback()
      }
    },
    /** Listener and timer counts, which have to return to zero after every wait. */
    leaks() {
      return { listeners: listeners.size, timers: timers.size }
    },
  }
}

describe('createDownloadTracker', () => {
  test('resolves the file Chrome wrote for the download this guid owns', async () => {
    const h = createHarness()
    h.tracker.trackStarted({ guid: 'guid-a', url: 'https://app.test/export.csv' })
    h.setItem({ id: 7, state: 'complete', filename: '/Users/me/Downloads/export.csv' })
    h.tracker.noteCreated({ id: 7, url: 'https://app.test/export.csv' })

    await expect(h.tracker.resolveFinishedFile({ guid: 'guid-a' })).resolves.toEqual({
      filename: '/Users/me/Downloads/export.csv',
    })
    expect(h.leaks()).toEqual({ listeners: 0, timers: 0 })
  })

  test('never returns an earlier download of the same URL while the new one is still running', async () => {
    const h = createHarness()
    const url = 'https://app.test/export.csv'

    // First download of the endpoint completes and stays in Chrome's list forever.
    h.tracker.trackStarted({ guid: 'guid-first', url })
    h.setItem({ id: 11, state: 'complete', filename: '/Users/me/Downloads/export.csv' })
    h.tracker.noteCreated({ id: 11, url })
    await expect(h.tracker.resolveFinishedFile({ guid: 'guid-first' })).resolves.toEqual({
      filename: '/Users/me/Downloads/export.csv',
    })
    h.tracker.releaseStarted('guid-first')

    // Second download of the same URL: Chrome created it but has not written the file yet.
    h.tracker.trackStarted({ guid: 'guid-second', url })
    h.setItem({ id: 12, state: 'in_progress' })
    h.tracker.noteCreated({ id: 12, url })

    const queriesBefore = h.searchQueries.length
    const pending = h.tracker.resolveFinishedFile({ guid: 'guid-second' })
    await flush()

    // The download manager catches up only now. A URL lookup would already have answered
    // with export.csv from item 11 and handed saveAs() the previous export.
    h.setItem({ id: 12, state: 'complete', filename: '/Users/me/Downloads/export (1).csv' })
    h.emitChanged({ id: 12, state: 'complete' })

    await expect(pending).resolves.toEqual({ filename: '/Users/me/Downloads/export (1).csv' })
    // Only the second download's own item was ever looked at, and only by id: the URL
    // never reaches chrome.downloads, so it cannot select item 11 or be read as a regex.
    const secondDownloadQueries = h.searchQueries.slice(queriesBefore)
    expect(secondDownloadQueries.length).toBeGreaterThan(0)
    expect(secondDownloadQueries.every((query) => query.id === 12)).toBe(true)
    expect(h.leaks()).toEqual({ listeners: 0, timers: 0 })
  })

  test('waits rather than answering with a finished download of the same URL it does not own', async () => {
    const h = createHarness()
    const url = 'https://app.test/report.csv'
    // Yesterday's download of the same endpoint, still in Chrome's list and complete. A
    // lookup by URL finds it; only an id binding refuses to.
    h.setItem({ id: 1, state: 'complete', filename: '/d/report.csv', url })

    h.tracker.trackStarted({ guid: 'guid-today', url })
    const pending = h.tracker.resolveFinishedFile({ guid: 'guid-today' })
    await flush()
    h.fireTimeouts()

    await expect(pending).resolves.toEqual({
      error: `no chrome.downloads item could be matched to ${url} within 5000ms`,
    })
    expect(h.searchQueries.some((query) => query.url !== undefined)).toBe(false)
  })

  test('refuses an unrelated download of the same URL that is still running when this one starts', async () => {
    const h = createHarness()
    const url = 'https://app.test/export.csv'

    // A user, or an unattached tab, starts a large download of the same stable export URL.
    // Chrome announces it to the extension like every other download in the profile, and it
    // is still in_progress — the freshness that a state check would mistake for ownership.
    h.setItem({ id: 5, state: 'in_progress' })
    h.tracker.noteCreated({ id: 5, url })
    // It is not kept as a candidate at all: nothing had been announced, so it is not ours.
    expect(h.tracker.stats()).toEqual({ started: 0, unbound: 0, unattributable: 0 })

    // Only now does the attached page download that URL.
    h.tracker.trackStarted({ guid: 'guid-attached', url })
    expect(h.tracker.stats()).toEqual({ started: 1, unbound: 1, unattributable: 0 })

    // This download's own item, which by the measured ordering always arrives after the
    // announcement, is the one it binds to.
    h.setItem({ id: 6, state: 'complete', filename: '/Users/me/Downloads/export (1).csv' })
    h.tracker.noteCreated({ id: 6, url })

    await expect(h.tracker.resolveFinishedFile({ guid: 'guid-attached' })).resolves.toEqual({
      filename: '/Users/me/Downloads/export (1).csv',
    })
    // The stranger's item was never even read, let alone returned.
    expect(h.searchQueries).toEqual([{ id: 6 }])
    expect(h.leaks()).toEqual({ listeners: 0, timers: 0 })
  })

  test('refuses the download when a second item for its URL appears while it is bound', async () => {
    const h = createHarness()
    const url = 'https://app.test/export.csv'

    h.tracker.trackStarted({ guid: 'guid-mine', url })

    // An unattached tab's download of the same URL wins the race to be created and is bound,
    // because nothing on either protocol tells the two apart at this point.
    h.setItem({ id: 5, state: 'complete', filename: '/Users/me/Downloads/somebody-elses.csv' })
    h.tracker.noteCreated({ id: 5, url })
    expect(h.tracker.stats()).toEqual({ started: 1, unbound: 0, unattributable: 0 })

    // This download's own creation then arrives. Chrome made two items for this URL while
    // one download was announced, so which one belongs to the guid is unknowable.
    h.setItem({ id: 6, state: 'complete', filename: '/Users/me/Downloads/export (1).csv' })
    h.tracker.noteCreated({ id: 6, url })
    expect(h.tracker.stats()).toEqual({ started: 1, unbound: 0, unattributable: 1 })

    await expect(h.tracker.resolveFinishedFile({ guid: 'guid-mine' })).resolves.toEqual({
      error: unattributable(url),
    })
    // Refused before reading anything, so neither file can leak out of a search result.
    expect(h.searchQueries).toEqual([])
    expect(h.leaks()).toEqual({ listeners: 0, timers: 0 })
  })

  test('refuses a wait already running when the second item for its URL appears', async () => {
    const h = createHarness()
    const url = 'https://app.test/export.csv'

    h.tracker.trackStarted({ guid: 'guid-mine', url })
    h.setItem({ id: 5, state: 'in_progress' })
    h.tracker.noteCreated({ id: 5, url })

    const pending = h.tracker.resolveFinishedFile({ guid: 'guid-mine' })
    await flush()

    h.setItem({ id: 6, state: 'complete', filename: '/Users/me/Downloads/export (1).csv' })
    h.tracker.noteCreated({ id: 6, url })

    // Answered at once rather than at the deadline, and never with a file.
    await expect(pending).resolves.toEqual({ error: unattributable(url) })
    expect(h.leaks()).toEqual({ listeners: 0, timers: 0 })
  })

  test('refuses both downloads of one URL that are announced while the other is unfinished', async () => {
    const h = createHarness()
    const url = 'https://app.test/report.pdf'

    h.tracker.trackStarted({ guid: 'guid-1', url })
    h.tracker.trackStarted({ guid: 'guid-2', url })
    expect(h.tracker.stats()).toEqual({ started: 2, unbound: 2, unattributable: 2 })

    // Pairing these in creation order is the guess that hands one of them a stranger's file
    // when an unrelated creation slips into the gap, so neither takes an item at all.
    h.setItem({ id: 21, state: 'complete', filename: '/d/report.pdf' })
    h.setItem({ id: 22, state: 'complete', filename: '/d/report (1).pdf' })
    h.tracker.noteCreated({ id: 21, url })
    h.tracker.noteCreated({ id: 22, url })

    await expect(h.tracker.resolveFinishedFile({ guid: 'guid-1' })).resolves.toEqual({ error: unattributable(url) })
    await expect(h.tracker.resolveFinishedFile({ guid: 'guid-2' })).resolves.toEqual({ error: unattributable(url) })
    expect(h.searchQueries).toEqual([])
    expect(h.leaks()).toEqual({ listeners: 0, timers: 0 })
  })

  test('refuses an item that two announced downloads could both own', async () => {
    const h = createHarness()
    // A redirect makes one item match both the URL CDP announced for one download and the
    // URL it announced for another.
    h.tracker.trackStarted({ guid: 'guid-request', url: 'https://app.test/download' })
    h.tracker.trackStarted({ guid: 'guid-final', url: 'https://cdn.test/file.bin' })

    h.setItem({ id: 31, state: 'complete', filename: '/d/file.bin' })
    h.tracker.noteCreated({ id: 31, url: 'https://app.test/download', finalUrl: 'https://cdn.test/file.bin' })

    await expect(h.tracker.resolveFinishedFile({ guid: 'guid-request' })).resolves.toEqual({
      error: unattributable('https://app.test/download'),
    })
    await expect(h.tracker.resolveFinishedFile({ guid: 'guid-final' })).resolves.toEqual({
      error: unattributable('https://cdn.test/file.bin'),
    })
    expect(h.leaks()).toEqual({ listeners: 0, timers: 0 })
  })

  test('takes the next download of a URL once the previous one has been released', async () => {
    const h = createHarness()
    const url = 'https://app.test/export.csv'

    h.tracker.trackStarted({ guid: 'guid-1', url })
    h.setItem({ id: 41, state: 'complete', filename: '/d/export.csv' })
    h.tracker.noteCreated({ id: 41, url })
    await expect(h.tracker.resolveFinishedFile({ guid: 'guid-1' })).resolves.toEqual({ filename: '/d/export.csv' })
    h.tracker.releaseStarted('guid-1')

    h.tracker.trackStarted({ guid: 'guid-2', url })
    expect(h.tracker.stats()).toEqual({ started: 1, unbound: 1, unattributable: 0 })
    h.setItem({ id: 42, state: 'complete', filename: '/d/export (1).csv' })
    h.tracker.noteCreated({ id: 42, url })

    await expect(h.tracker.resolveFinishedFile({ guid: 'guid-2' })).resolves.toEqual({
      filename: '/d/export (1).csv',
    })
  })

  test('never adopts a creation that arrived before anything was announced', async () => {
    const h = createHarness()
    h.setItem({ id: 51, state: 'in_progress' })
    h.tracker.noteCreated({ id: 51, url: 'https://app.test/a.zip' })
    h.tracker.trackStarted({ guid: 'guid-late', url: 'https://app.test/a.zip' })

    const pending = h.tracker.resolveFinishedFile({ guid: 'guid-late' })
    await flush()
    // Chrome finishing the stranger's download does not make it this download's file.
    h.setItem({ id: 51, state: 'complete', filename: '/d/a.zip' })
    h.emitChanged({ id: 51, state: 'complete' })
    await flush()
    h.fireTimeouts()

    await expect(pending).resolves.toEqual({
      error: 'no chrome.downloads item could be matched to https://app.test/a.zip within 5000ms',
    })
    expect(h.searchQueries).toEqual([])
    expect(h.leaks()).toEqual({ listeners: 0, timers: 0 })
  })

  test('binds an item that arrives while the completion wait is already running', async () => {
    const h = createHarness()
    h.tracker.trackStarted({ guid: 'guid-wait', url: 'https://app.test/slow.bin' })

    const pending = h.tracker.resolveFinishedFile({ guid: 'guid-wait' })
    await flush()

    h.setItem({ id: 61, state: 'complete', filename: '/d/slow.bin' })
    h.tracker.noteCreated({ id: 61, url: 'https://app.test/slow.bin' })

    await expect(pending).resolves.toEqual({ filename: '/d/slow.bin' })
    expect(h.leaks()).toEqual({ listeners: 0, timers: 0 })
  })

  test('matches a download redirected after CDP announced its URL', async () => {
    const h = createHarness()
    h.tracker.trackStarted({ guid: 'guid-r1', url: 'https://app.test/download' })
    h.setItem({ id: 71, state: 'complete', filename: '/d/file.bin' })
    h.tracker.noteCreated({ id: 71, url: 'https://app.test/download', finalUrl: 'https://cdn.test/file.bin' })

    await expect(h.tracker.resolveFinishedFile({ guid: 'guid-r1' })).resolves.toEqual({ filename: '/d/file.bin' })
  })

  test('matches when CDP reported the post-redirect URL Chrome recorded as final', async () => {
    const h = createHarness()
    h.tracker.trackStarted({ guid: 'guid-r2', url: 'https://cdn.test/file.bin' })
    h.setItem({ id: 72, state: 'complete', filename: '/d/file.bin' })
    h.tracker.noteCreated({ id: 72, url: 'https://app.test/download', finalUrl: 'https://cdn.test/file.bin' })

    await expect(h.tracker.resolveFinishedFile({ guid: 'guid-r2' })).resolves.toEqual({ filename: '/d/file.bin' })
  })

  test('never matches a different URL, even with no other candidate', async () => {
    const h = createHarness()
    h.tracker.trackStarted({ guid: 'guid-x', url: 'https://app.test/wanted.csv' })
    h.setItem({ id: 81, state: 'complete', filename: '/d/unrelated.csv' })
    h.tracker.noteCreated({ id: 81, url: 'https://other.test/unrelated.csv' })

    const pending = h.tracker.resolveFinishedFile({ guid: 'guid-x' })
    await flush()
    h.fireTimeouts()

    await expect(pending).resolves.toEqual({
      error: 'no chrome.downloads item could be matched to https://app.test/wanted.csv within 5000ms',
    })
  })

  test('reports an interrupted download instead of a file', async () => {
    const h = createHarness()
    h.tracker.trackStarted({ guid: 'guid-i', url: 'https://app.test/big.iso' })
    h.setItem({ id: 91, state: 'in_progress' })
    h.tracker.noteCreated({ id: 91, url: 'https://app.test/big.iso' })

    const pending = h.tracker.resolveFinishedFile({ guid: 'guid-i' })
    await flush()
    h.setItem({ id: 91, state: 'interrupted', error: 'NETWORK_FAILED' })
    h.emitChanged({ id: 91, state: 'interrupted' })

    await expect(pending).resolves.toEqual({ error: 'Chrome interrupted the download (NETWORK_FAILED)' })
    expect(h.leaks()).toEqual({ listeners: 0, timers: 0 })
  })

  test('times out naming the download when Chrome created it but never finished it', async () => {
    const h = createHarness()
    h.tracker.trackStarted({ guid: 'guid-t', url: 'https://app.test/stuck.bin' })
    h.setItem({ id: 101, state: 'in_progress' })
    h.tracker.noteCreated({ id: 101, url: 'https://app.test/stuck.bin' })

    const pending = h.tracker.resolveFinishedFile({ guid: 'guid-t' })
    await flush()
    h.fireTimeouts()

    await expect(pending).resolves.toEqual({ error: 'Chrome did not report download 101 finished within 5000ms' })
    expect(h.leaks()).toEqual({ listeners: 0, timers: 0 })
  })

  test('ignores deltas for other downloads', async () => {
    const h = createHarness()
    h.tracker.trackStarted({ guid: 'guid-n', url: 'https://app.test/mine.bin' })
    h.setItem({ id: 111, state: 'in_progress' })
    h.tracker.noteCreated({ id: 111, url: 'https://app.test/mine.bin' })

    const pending = h.tracker.resolveFinishedFile({ guid: 'guid-n' })
    await flush()
    const before = h.searchQueries.length
    h.setItem({ id: 112, state: 'complete', filename: '/d/someone-else.bin' })
    h.emitChanged({ id: 112, state: 'complete' })
    await flush()
    expect(h.searchQueries.length).toBe(before)

    h.setItem({ id: 111, state: 'complete', filename: '/d/mine.bin' })
    h.emitChanged({ id: 111, state: 'complete' })
    await expect(pending).resolves.toEqual({ filename: '/d/mine.bin' })
  })

  test('reports a failing chrome.downloads.search rather than hanging', async () => {
    const h = createHarness()
    h.tracker.trackStarted({ guid: 'guid-f', url: 'https://app.test/f.bin' })
    h.tracker.noteCreated({ id: 121, url: 'https://app.test/f.bin' })
    h.failSearch(new Error('extension context invalidated'))

    await expect(h.tracker.resolveFinishedFile({ guid: 'guid-f' })).resolves.toEqual({
      error: 'chrome.downloads.search failed: extension context invalidated',
    })
    expect(h.leaks()).toEqual({ listeners: 0, timers: 0 })
  })

  test('reports a guid it never saw begin instead of guessing a file', async () => {
    const h = createHarness()
    await expect(h.tracker.resolveFinishedFile({ guid: 'guid-unknown' })).resolves.toEqual({
      error: 'the extension never saw Page.downloadWillBegin for this download',
    })
    expect(h.leaks()).toEqual({ listeners: 0, timers: 0 })
  })

  test('forgets a cancelled download so its item is never claimed later', async () => {
    const h = createHarness()
    h.tracker.trackStarted({ guid: 'guid-c', url: 'https://app.test/c.bin' })
    expect(h.tracker.stats().started).toBe(1)
    h.tracker.releaseStarted('guid-c')
    expect(h.tracker.stats().started).toBe(0)

    await expect(h.tracker.resolveFinishedFile({ guid: 'guid-c' })).resolves.toEqual({
      error: 'the extension never saw Page.downloadWillBegin for this download',
    })
  })

  test('forgets the downloads of a tab whose debugger session detached', async () => {
    const h = createHarness()
    // A tab Chrome detaches from mid-download never reports the download completed, and an
    // outstanding download of a URL is what refuses the next download of that URL.
    h.tracker.trackStarted({ guid: 'guid-gone', url: 'https://app.test/x.bin', tabId: 7 })
    h.tracker.trackStarted({ guid: 'guid-other-tab', url: 'https://app.test/y.bin', tabId: 8 })
    h.tracker.releaseTab(7)
    expect(h.tracker.stats()).toEqual({ started: 1, unbound: 1, unattributable: 0 })

    h.tracker.trackStarted({ guid: 'guid-next', url: 'https://app.test/x.bin', tabId: 9 })
    h.setItem({ id: 131, state: 'complete', filename: '/d/x.bin' })
    h.tracker.noteCreated({ id: 131, url: 'https://app.test/x.bin' })

    await expect(h.tracker.resolveFinishedFile({ guid: 'guid-next' })).resolves.toEqual({ filename: '/d/x.bin' })
  })

  test('bounds the downloads it remembers', () => {
    const h = createHarness({ maxTracked: 3 })
    for (let index = 0; index < 10; index++) {
      h.tracker.trackStarted({ guid: `guid-${index}`, url: `https://app.test/${index}.bin` })
      h.tracker.noteCreated({ id: 200 + index, url: 'https://unmatched.test/x.bin' })
    }
    // Downloads that never finish are how this could grow forever inside a service worker
    // that outlives every page; creations nothing announced are dropped as they arrive.
    expect(h.tracker.stats()).toEqual({ started: 3, unbound: 3, unattributable: 0 })
  })
})
