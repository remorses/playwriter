---
'playwriter': patch
---

Fix `download.saveAs()` in extension mode.

The extension owns a tab-scoped debugger session, and Chrome answers `Browser.setDownloadBehavior` there with `'Browser.setDownloadBehavior' wasn't found` and every variant of `Page.setDownloadBehavior` with `Cannot not access browser-level commands`, so the relay can never redirect a download into Playwright's artifact directory. It no longer forwards the call at all. Chrome wrote the file to its own download location while Playwright looked for `<downloadPath>/<guid>`, and `download.saveAs()` failed with `ENOENT` even though the download had succeeded:

```
download.saveAs: ENOENT: no such file or directory, copyfile
  '/var/folders/.../playwright-artifacts-Nzbxy2/ff93e6c9-367f-480c-9587-bd00c16bca6c' -> '/tmp/out.txt'
```

The extension now binds each download guid to the one `chrome.downloads` item Chrome created for it, reads that item's real path with a bounded wait, and reports it to the relay, which copies the file to `<downloadPath>/<guid>` before Playwright is told the download completed:

```ts
const download = await page.waitForEvent('download')
await download.saveAs('/tmp/export.json') // saves the exact bytes Chrome downloaded
```

Chrome keeps its own copy, so the file is still in the browser's download folder. Downloading twice from the same URL is safe: the guid decides which download is read, never the URL, so a repeated export never resolves to the previous file.

Chrome reports every download in the profile to the extension, including from tabs Playwright never attached to, and a `DownloadItem` names no tab, frame or guid. Identity therefore comes from event order, which the extension measured rather than assumed: `Page.downloadWillBegin` always reaches it before that download's `chrome.downloads.onCreated`. So a download item that arrived before the guid was announced is somebody else's and is dropped, whether it has finished or is still running, and a second item for a guid that already has one makes that download unattributable and rejects it. Two downloads of the *same URL* running at the same time now both fail closed for the same reason: pairing them by arrival order is what lets an unrelated download's bytes reach `saveAs()`. Downloads of different URLs, and the same URL downloaded again after the first finished, are unaffected.

When the path cannot be resolved or copied, the relay logs the reason and reports the download as canceled, so `download.saveAs()` rejects immediately instead of failing on a missing file later.

Every connected Playwright client now gets the finished file in its own artifact directory, so a download started by one client no longer breaks when a second client connects. That includes a client whose `Browser.setDownloadBehavior` arrives while the copy for another client is already running: the relay keeps copying until the set of artifact directories stops growing, so no client is told the download completed before the file is at its own `<downloadPath>/<guid>`.

The extension needs the new `downloads` permission for this, and extensions older than 0.0.120 keep working unchanged against the new relay.
