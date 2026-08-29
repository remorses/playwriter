/**
 * Per-download identity for Chrome downloads driven over CDP.
 *
 * The relay cannot make Chrome write a download where Playwright expects it. Measured
 * against the extension's own tab-scoped debugger session (see the probe results in the
 * wave-4 handoff): `Browser.setDownloadBehavior` answers `-32601 'Browser.setDownloadBehavior'
 * wasn't found`, and every variant of `Page.setDownloadBehavior` — `deny`, `default`,
 * `allow`, `allow` with a path, `allowAndName` with a path — answers
 * `-32000 Cannot not access browser-level commands`. `chrome.debugger.attach({targetId:
 * 'browser'})` answers `No target with given id browser.` So `chrome.downloads` is the only
 * place the path Chrome actually used is readable, and no download path can be reserved for
 * a tab in advance.
 *
 * Reading it back safely is a question of identity. `Page.downloadWillBegin` carries a guid
 * and a url; `chrome.downloads.DownloadItem` carries no tab, no frame and no guid — Chrome's
 * own field list is `bytesReceived, canResume, danger, endTime, exists, fileSize, filename,
 * finalUrl, id, incognito, mime, paused, referrer, startTime, state, totalBytes, url`. Chrome
 * reports *every* download in the profile to the extension, including from tabs Playwright
 * never attached to. There is no field to join on, so the only evidence is the order the two
 * streams arrive in, and that order is a measurement:
 *
 *   - `Page.downloadWillBegin` reaches the service worker before that download's
 *     `chrome.downloads.onCreated`. 13 of 13 downloads, across link downloads, navigation
 *     downloads, blob downloads, two concurrent downloads and a trickled 4 MB download.
 *   - `chrome.downloads.onCreated` reaches it before that download's completed
 *     `Page.downloadProgress`, which is also causally necessary: an item exists before it
 *     finishes, and both events reach the worker through the extension event router in order.
 *
 * Those two give a binding rule that cannot hand one guid another tab's bytes:
 *
 *   1. A creation may only bind to a guid announced before it. A creation that matches no
 *      announced download is dropped, never kept as a candidate for a later guid. This is
 *      what stops an unrelated download — finished or still running — from being adopted.
 *   2. At most one announced-and-unfinished download per URL. A second one makes both
 *      unattributable, so both are refused.
 *   3. A second creation matching an already-bound download means Chrome created a download
 *      this extension cannot tell apart from ours, so that binding is refused too.
 *
 * Rule 3 is what makes rule 1 safe rather than merely narrow: if some other tab's creation
 * wins the race and binds to our guid, our own creation arrives next, finds the guid already
 * bound, and refuses it — and by the second measurement it always arrives before the
 * completed event that reads the file. A refused download rejects `download.saveAs()`, which
 * is recoverable, where silently wrong bytes are not.
 *
 * The cost is that two downloads of the *same URL* running at the same time both fail closed
 * rather than being paired by arrival order; pairing them is exactly the guess that hands one
 * of them a stranger's file. Downloads of different URLs are unaffected, and downloading the
 * same URL again after the first finished is unaffected.
 *
 * The chrome APIs are injected so this is exercised without a browser.
 */

/** Shape of `chrome.downloads.DownloadItem` at creation time. */
export type CreatedDownloadItem = {
  id: number
  url: string
  finalUrl?: string
}

/** Shape of `chrome.downloads.DownloadItem` once it may have finished. */
export type TrackedDownloadItem = {
  id: number
  state: 'in_progress' | 'complete' | 'interrupted'
  filename?: string
  error?: string
}

/** Shape of `chrome.downloads.DownloadDelta`. */
export type DownloadChangeDelta = {
  id: number
  state?: unknown
  filename?: unknown
}

/** Where Chrome put a finished download, or why the extension could not say. */
export type FinishedDownloadFile = { filename?: string; error?: string }

export type DownloadTrackerDeps = {
  /** `chrome.downloads.search`, only ever called with an exact id. */
  search: (query: { id: number }) => Promise<TrackedDownloadItem[]>
  addChangeListener: (listener: (delta: DownloadChangeDelta) => void) => void
  removeChangeListener: (listener: (delta: DownloadChangeDelta) => void) => void
  setTimeout: (callback: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
  /** How long to wait for the download manager to catch up. */
  timeoutMs?: number
  /** How many announced downloads to remember. */
  maxTracked?: number
}

export const DOWNLOAD_COMPLETION_TIMEOUT_MS = 5000

/** Downloads that never reach a terminal state would otherwise be remembered forever. */
export const MAX_TRACKED_DOWNLOADS = 100

type StartedDownload = {
  /** URL from `Page.downloadWillBegin`, used to recognise this download's own creation. */
  url: string
  /** Tab the guid was announced on, so a detaching tab can drop its downloads. */
  tabId?: number
  /** The `chrome.downloads` item this guid owns, once it has one. */
  downloadId?: number
  /** Set once this download can no longer be told apart from another one. */
  unattributable?: boolean
  /** Set while a completion wait is in flight, so a late binding or refusal is seen at once. */
  onUpdate?: () => void
}

/**
 * `finalUrl` covers a download redirected after `Page.downloadWillBegin` announced its url;
 * `url` covers the reverse, where Chrome recorded the pre-redirect request. A URL match says
 * a creation *could* be this download's, never that it is, and it is never used to look
 * anything up in Chrome.
 */
function itemMatchesUrl({ item, url }: { item: CreatedDownloadItem; url: string }): boolean {
  return item.url === url || item.finalUrl === url
}

function unattributableError(url: string): string {
  return `Chrome reported more than one download of ${url} and its download items name no tab, so the file for this download could not be identified`
}

export type DownloadTracker = ReturnType<typeof createDownloadTracker>

export function createDownloadTracker({
  search,
  addChangeListener,
  removeChangeListener,
  setTimeout: schedule,
  clearTimeout: cancel,
  timeoutMs = DOWNLOAD_COMPLETION_TIMEOUT_MS,
  maxTracked = MAX_TRACKED_DOWNLOADS,
}: DownloadTrackerDeps) {
  /** Guids announced by `Page.downloadWillBegin` that have not been released yet. */
  const started = new Map<string, StartedDownload>()

  function refuse(entry: StartedDownload): void {
    entry.unattributable = true
    entry.onUpdate?.()
  }

  return {
    /** Record a guid from `Page.downloadWillBegin`. */
    trackStarted({ guid, url, tabId }: { guid: string; url: string; tabId?: number }): void {
      const entry: StartedDownload = { url, tabId }

      // Two downloads of one URL in flight at once cannot be told apart: whichever creation
      // arrives first could belong to either, and an unrelated tab's creation slipping in
      // between would be absorbed by the second guid instead of showing up as the extra
      // item that rule 3 refuses. Both are refused rather than paired by arrival order.
      for (const other of started.values()) {
        if (other.url === url) {
          refuse(other)
          entry.unattributable = true
        }
      }

      started.set(guid, entry)
      // Evicting the oldest can strand a download still waiting to bind, failing it closed.
      // That needs more downloads in flight at once than maxTracked, and the alternative —
      // keeping every guid forever — leaks on any download that never reaches a terminal
      // state, which is the failure that actually happens.
      while (started.size > maxTracked) {
        const oldest = started.keys().next()
        if (oldest.done) {
          break
        }
        started.delete(oldest.value)
      }
    },

    /**
     * Bind a `chrome.downloads.onCreated` item to the download that was already waiting for
     * it. An item that no announced download is waiting for is not ours; an item that a
     * download already bound to something else could also be is a download we can no longer
     * identify.
     */
    noteCreated(item: CreatedDownloadItem): void {
      const matching: StartedDownload[] = []
      for (const entry of started.values()) {
        if (!entry.unattributable && itemMatchesUrl({ item, url: entry.url })) {
          matching.push(entry)
        }
      }

      // Chrome reports every download in the profile. One that matches nothing this
      // extension announced belongs to a tab it does not drive, so it is dropped here and
      // can never be handed to a guid announced later.
      if (matching.length === 0) {
        return
      }

      // Two announced downloads could own this creation — a redirect can make one item
      // match two different announced URLs — so neither may take it.
      if (matching.length > 1) {
        for (const entry of matching) {
          refuse(entry)
        }
        return
      }

      const entry = matching[0]
      if (entry.downloadId === undefined) {
        entry.downloadId = item.id
        entry.onUpdate?.()
        return
      }

      // A second item Chrome created for this URL while this download was still running.
      // One of the two is ours and nothing on either protocol says which.
      refuse(entry)
    },

    /** Forget a guid that will never finish (cancelled, or its tab detached). */
    releaseStarted(guid: string): void {
      started.delete(guid)
    },

    /** Forget every download announced on a tab whose debugger session is gone. */
    releaseTab(tabId: number): void {
      for (const [guid, entry] of started) {
        if (entry.tabId === tabId) {
          started.delete(guid)
        }
      }
    },

    /**
     * Read back the path Chrome wrote this guid's download to. Resolves as soon as the bound
     * item reaches a terminal state, and always within `timeoutMs`; never resolves from an
     * item this guid does not own.
     */
    async resolveFinishedFile({ guid }: { guid: string }): Promise<FinishedDownloadFile> {
      const entry = started.get(guid)
      if (!entry) {
        return { error: 'the extension never saw Page.downloadWillBegin for this download' }
      }

      return await new Promise<FinishedDownloadFile>((resolve) => {
        let settled = false
        let timeout: unknown

        const finish = (result: FinishedDownloadFile): void => {
          if (settled) {
            return
          }
          settled = true
          removeChangeListener(onChanged)
          if (entry.onUpdate === readBoundItem) {
            entry.onUpdate = undefined
          }
          cancel(timeout)
          resolve(result)
        }

        const inspect = (items: TrackedDownloadItem[]): void => {
          // A refusal that landed while this read was in flight still refuses.
          if (entry.unattributable) {
            finish({ error: unattributableError(entry.url) })
            return
          }
          const item = items.find((candidate) => candidate.id === entry.downloadId)
          if (!item) {
            return
          }
          if (item.state === 'interrupted') {
            finish({ error: `Chrome interrupted the download (${item.error || 'unknown reason'})` })
            return
          }
          if (item.state === 'complete' && item.filename) {
            finish({ filename: item.filename })
          }
        }

        const readBoundItem = (): void => {
          if (settled) {
            return
          }
          if (entry.unattributable) {
            finish({ error: unattributableError(entry.url) })
            return
          }
          if (entry.downloadId === undefined) {
            return
          }
          void search({ id: entry.downloadId }).then(inspect, (error: unknown) => {
            finish({
              error: `chrome.downloads.search failed: ${error instanceof Error ? error.message : String(error)}`,
            })
          })
        }

        const onChanged = (delta: DownloadChangeDelta): void => {
          if (delta.id !== entry.downloadId) {
            return
          }
          if (delta.state === undefined && delta.filename === undefined) {
            return
          }
          readBoundItem()
        }

        timeout = schedule(() => {
          finish({
            error:
              entry.downloadId === undefined
                ? `no chrome.downloads item could be matched to ${entry.url} within ${timeoutMs}ms`
                : `Chrome did not report download ${entry.downloadId} finished within ${timeoutMs}ms`,
          })
        }, timeoutMs)

        // Listen before reading so an item that finishes between the two is not missed, and
        // accept a binding or a refusal that only arrives while this wait is already running.
        addChangeListener(onChanged)
        entry.onUpdate = readBoundItem
        readBoundItem()
      })
    },

    /** Counts used by tests and by the extension's teardown assertions. */
    stats(): { started: number; unbound: number; unattributable: number } {
      let unbound = 0
      let unattributable = 0
      for (const entry of started.values()) {
        if (entry.downloadId === undefined) {
          unbound++
        }
        if (entry.unattributable) {
          unattributable++
        }
      }
      return { started: started.size, unbound, unattributable }
    },
  }
}
