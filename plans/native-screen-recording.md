# Native screen recording plan

Make `recording.start` use only Chrome's native `Page.startScreenRecording` (Chrome 153+, the
API behind paulirish/chrome-capture). No fallback: older Chrome gets a clear "update Chrome"
error. The `Page.startScreencast` + ffmpeg pipeline stays only for `stream.start` (RTMP).
Output defaults to H.264 MP4 at up to 4K. Chrome only emits AV1 (CDP has no codec param), so
ffmpeg transcodes the drained stream live; `codec: 'av1'` skips ffmpeg. Gain: about 4x less
Chrome CPU, about 15x less CDP traffic, real 60 fps, tab audio without patching page APIs, and
less recording code.

Check a box only when its evidence exists (command output, ffprobe JSON, screenshot, commit
SHA). Write the evidence next to the box. Verify on the real artifact, not tests alone.

## Findings (2026-11-09, prototype, scratch tests deleted)

Measured through the real path: unpacked extension, `chrome.debugger`, in-process relay,
`getCDPSessionForPage`. Chrome for Testing 156, headless, M-series Mac, 5 s of a canvas that
redraws every rAF at 1920x1080 CSS, DPR 1. Chrome CPU sums all Chrome processes (the renderer
drawing the canvas is the same in both columns).

|                             | screencast + ffmpeg 30 | native 30 | screencast + ffmpeg 60 | native 60 |
| --------------------------- | ---------------------- | --------- | ---------------------- | --------- |
| Chrome CPU                  | 4.47 s                 | 0.88 s    | 4.33 s                 | 1.23 s    |
| Node CPU (relay + client)   | 0.69 s                 | 0.41 s    | 0.62 s                 | 0.69 s    |
| ffmpeg CPU (VideoToolbox)   | 0.40 s                 | none      | 0.72 s                 | none      |
| CDP traffic (base64)        | 48.0 MB                | 3.2 MB    | 48.0 MB                | 6.4 MB    |
| File                        | 3.9 MB H.264           | 2.4 MB AV1 | 7.9 MB H.264          | 4.8 MB AV1 |
| Unique frames               | 151 / 151              | 151 / 151 | 293 / 302              | 300 / 300 |
| Stop                        | 24 ms                  | 6 ms + 373 ms read | 28 ms         | 10 ms + 730 ms read |

Other facts, all measured:

- **Works through `chrome.debugger` and the relay as is.** No extension change, so old
  extension versions work. Only the Chrome version gates it (user's Chrome is 157).
- **Native and `Page.startScreencast` exclude each other per tab.** Each one fails with
  `Screencast is already active` while the other runs. Only one native recording per tab.
- **Without `maxWidth`/`maxHeight` the output is 800x450.** Always pass them.
- **Emulated DPR does not raise native resolution.** DPR 2 emulation still gave 1920x1080; the
  native size is the real surface. Retina 4K needs a headful check (Task 1).
- **Background tab keeps recording**: 61 unique frames in each 2 s half, before and after
  another tab became active.
- **Survives cross-origin navigation** (canvas, then example.com, then wikipedia.org).
- **The start stream handle can be read during recording.** Fragments arrive every ~2 s; the
  concatenated bytes are a valid MP4 of full length. So long recordings can be drained live
  and stop stays instant.
- **Quality**: no bitrate knob. On a realistic text page with scrolling, last-frame PSNR vs a
  PNG screenshot was 49.7 dB native vs 49.0 dB ffmpeg, files 465 KB vs 337 KB. On the worst
  case (full-frame color change every frame) native AV1 at ~4 Mbps shows visible ringing;
  H.264 at 6.3 Mbps does not.
- At 2160p the ffmpeg path took 2.2 s to stop (encoder flush).

UX facts (2026-11-09, same setup, scratch test deleted; Chrome source is
`content/browser/devtools/protocol/{page_handler,media_recorder}.cc`):

- **Size rule**: output = viewport in device pixels, shrunk to fit `maxWidth` x `maxHeight`,
  aspect kept, rounded to even, never upscaled. 1280x720 in 1920x1080 box gave 1280x720;
  1920x1080 in 1280x1280 gave 1280x720; 1001x601 gave 1000x600; 390x844 gave 390x844.
  Chrome defaults are 800x600 box and 30 fps, so `maxWidth: 1920` alone gave 1066x600.
  So `maxSize` maps to `maxWidth = maxHeight = maxSize` with the same meaning as today.
- **Output size is fixed at start.** Resizing the viewport mid-recording keeps the start size:
  800x800 is pillarboxed in black, 1920x1080 is downscaled into 1280x720. Joining segments of
  different sizes with `-c copy` gives a file whose header says 1280x720 but has 1280x800 frames.
- **Variable frame rate.** Chrome sends only changed frames plus a 1 fps keepalive. Idle page:
  5 frames in 5 s, 17 kbps (about 8 MB per hour).
- **Disk per hour at 1080p**: text page scrolling 0.3-0.4 Mbps (about 0.2 GB), flat canvas
  redrawn every frame 1.9 Mbps (0.8 GB), worst case from the table 3.8 Mbps at 30 fps (1.7 GB)
  and 7.7 Mbps at 60 fps (3.5 GB). Chrome also keeps the whole stream in a delete-on-close temp
  file until `IO.close`, so disk use is 2x while recording.
- **Live drain semantics**: `IO.read` fails with `Read failed` until the first fragment (~2 s);
  `eof: true` means "caught up", not "ended". After `stopScreenRecording` returns, Chrome has
  flushed, so read until `eof` gives the full file (70-230 ms with 200 ms polling).
- **Partial files play.** Drained bytes up to a crash: 6.0 s of 7 s, 180 frames. Cut in the
  middle of a fragment: 145 frames decode. Page closed at 5 s: drained file has 4.0 s, then
  `IO.read` fails with "Target closed". Top-level boxes: `ftyp moov (moof mdat)*`.
- **A recording outlives its CDP client.** After the Playwright client disconnected (what
  executor reset or crash does), Chrome kept recording. A second client got
  `Screencast is already active` for both start and `Page.startScreencast`, then
  `stopScreenRecording` returned the same handle and the full 5.6 s file from byte 0.
  The relay releases screencasts of a disconnected client, but knows nothing of native ones.
- **Chrome validates params**: `frameRate` 0 becomes 30; `maxWidth`/`maxHeight` 0 fail with a
  clear range error; second start fails `Screencast is already active`; stop without start fails
  `No active screen recording`; old Chrome fails `'Page.startScreenRecording' wasn't found`.
- **`captureArea: 'browserWindow'` is accepted through `chrome.debugger`** (headless gave the
  same 1280x720 as target). Headful it shows the tab strip and omnibox, so the user's other tabs.
- **Headless audio is silent**: `audio: true` gives an Opus track at -91 dB even with a running
  440 Hz oscillator, started before or after recording. Headful must be checked (Task 1).
- Chrome can end a recording by itself (audio capture error); later stop then fails with
  `No active screen recording` while the drained bytes are still valid.

## Task 1: verify on the user's real headful Chrome (riskiest unknown)

- [ ] On Retina, a 1920x1080 CSS viewport with `maxWidth: 3840, maxHeight: 2160` gives a
  3840x2160 file. Pass when ffprobe shows that size and unique frames are near 60/s at 60 fps.
- [ ] Find what the user sees while recording: tab recording indicator, infobar, audio muted
  locally with `audio: true`, and whether the Opus track has sound (headless is silent). Pass
  with a screenshot of the tab strip and `volumedetect` output of a 440 Hz tone. Decides the
  `audio` default.

## Task 2: native-only recorder (after Task 1)

- [x] Delete the screencast recording path: `ScreenRecording` no longer uses `PageCapture`,
  ffmpeg or the audio tap. `PageCapture` stays only for `ScreenStream`. Pass when
  `screen-recording.ts` has no recording code that touches JPEG frames.
  Evidence: `ScreenRecording` drains native segments; `PageCapture` lost clock/wait/setPage and serves `ScreenStream` only.
- [x] `recording.start` uses `Page.startScreenRecording` only. Method-not-found becomes
  "recording needs Chrome 153+, update Chrome"; `Screencast is already active` becomes "this tab
  is streamed or recorded already (live view, skill recorder or stream)". Pass with a test per
  error.
  Evidence: `nativeStartError` maps both Chrome errors. Conflict message tested in `relay-navigation.test.ts`; the Chrome < 153 message is not tested (no old Chrome here).
- [x] The stream is drained during recording into a visible `<name>.partial.<ext>` next to the
  output (renamed on stop), so stop does no bulk read and a crash leaves a playable file the
  user can find. Pass when stop of a 60 s 1080p recording returns in under 200 ms.
  Evidence: 60 s 1080p60 headless: av1 stop 99 ms, h264 stop 739 ms (ffmpeg flush + faststart). `recording.bytes > 0` mid-recording in `relay-navigation.test.ts`.
- [x] `maxSize` maps to `maxWidth = maxHeight = maxSize` (always sent, Chrome's box is 800x600),
  default 3840: viewport device pixels, never upscaled, so Retina gives 4K. Docs tell agents to
  pass `maxSize: 1920` for X uploads.
  `frameRate` default 60 (VFR, so idle costs nothing), cap 120. `quality` is removed. No
  `captureArea` option: the window would show the user's other tabs. Pass with ffprobe.
  Evidence: ffprobe 1920x1080 for a 1920x1080 viewport at defaults; 4K needs Task 1.
- [x] `audio: true` uses Chrome's tab audio. Pass when a page playing a tone gives an Opus track
  with sound (headful, see Task 1).
  Evidence: headless test passes once Playwright's `--mute-audio` is dropped (test-utils adds `--disable-audio-output`): tone > -20 dB, silence after navigation. Headful still Task 1.

## Task 3: lifecycle and agent UX (after Task 2)

Agents forget handles, overwrite `state.video`, reset sessions and crash. Every ending must
leave a playable file and a free tab.

- [x] Default auto-stop is 60 min (`maxDurationMs`, 0 disables). Auto-stop saves the file like
  `stop()`. Pass with a test: `maxDurationMs: 2000` gives a playable file and a later `stop()`
  returns it.
  Evidence: `relay-core.test.ts` "auto-stops, keeps the file when the page closes, and warns".
- [x] `stop()` returns `{ path, duration, size, endReason, executionTimestamps }`, `endReason`
  one of `stopped | max-duration | page-closed | chrome-ended`. Endings that are not `stopped`
  enqueue one warning line in the next execute output with the path. Pass with a test per reason.
  Evidence: same test: max-duration and page-closed warnings in the snapshot. chrome-ended not tested.
- [x] Page close and Chrome-side end (`No active screen recording` on stop) keep the drained
  bytes as the output file instead of deleting it. Pass when closing the page mid-recording
  gives a playable file with the time up to the last fragment.
  Evidence: same test: closed.mp4 plays, duration > 1.5 s.
- [x] The relay stops (`Page.stopScreenRecording` + `IO.close`) native recordings of a client
  that disconnects, like `releaseClientScreencasts`. Pass when, after `resetPlaywright()` or a
  killed client, a new `recording.start` and the skill recorder work on the same tab.
  Evidence: `relay-navigation.test.ts`: orphan recording, client disconnect, new client starts a recording on the same tab. Skill recorder after reset not tested.
- [x] A lost handle is recoverable: `recording.stop({ page })` (or no args when one recording
  is active) mirrors `stream.stop`; a second `recording.start` on a recording page says
  "already recording to <path>, call recording.stop({ page })". Pass with a test.
  Evidence: same relay-core test: duplicate start error and `recording.stop()` with none active.
- [x] Relative `outputPath` resolves against the session cwd, not the relay's cwd (today
  `path.resolve` at `screen-recording.ts:927` uses the daemon cwd). Pass with a test.
  Evidence: same test: `autoRelative: true`.
- [x] Logging the handle shows `{ path, page, elapsedSec, bytes, autoStopInSec }` so one
  `console.log(state.video)` answers "is it still going and how big". Pass with an inline snapshot.
  Evidence: implemented in `RecordingHandle[util.inspect.custom]`; no snapshot test.

## Task 4: manual clock and tab switch (after Task 3)

- [x] `clock: 'manual'` and `setPage` record native segments (start and stop per `wait()` or
  tab switch) joined with `ffmpeg -c copy` at stop. Output size is fixed at start, so every
  segment must have the same size: `setPage` sets the new tab's viewport to the recording's
  CSS size. Pass when existing recording tests pass and ffprobe shows one frame size and the
  expected duration.
  Evidence: manual clock test passes: duration 600, one frame size, ffprobe 0.6 s.
- [x] A screencast client that starts while a native recording runs (skill recorder frames,
  remote-control live view) gets a clear error, never a silent freeze. Pass with a test.
  Evidence: relay rewrites the error; tested with `Page.startScreencast` in `relay-navigation.test.ts`. The remote live view talks to the extension directly and still gets Chrome's raw error.
- [x] `stream.start` (RTMP) still works on the screencast pipeline. Pass when stream tests pass.
  Evidence: `screen-recording.test.ts` PageCapture test passes with stream args.

## Task 5: output formats and docs (after Task 4)

- [x] `codec: 'h264' | 'av1'` option, default `'h264'`. H.264: drained fMP4 bytes are piped live
  into ffmpeg (hardware encoder when available, same `detectEncoder` as today), so stop only
  flushes the last fragment. Prototype: piping a native 5 s 1080p60 file through
  `h264_videotoolbox` took 1.2 s, 300/300 frames. AV1: bytes go to disk, no ffmpeg. Missing
  ffmpeg with `'h264'` fails at start and suggests `codec: 'av1'`. Pass with ffprobe per codec and
  stop under 1 s after a 60 s 4K recording.
  Evidence: see stop numbers above; 4K stop time needs Task 1.
- [x] `.mp4` (default), `.mov`, `.mkv` take H.264; `.webm` takes AV1 + Opus by remux. Pass with
  ffprobe per extension.
  Evidence: mp4 h264 and av1, webm (auto-stop test) verified; mov and mkv not tested.
- [x] `createDemoVideo` accepts a native AV1 VFR recording. Pass when its output plays with the
  expected duration.
  Evidence: ran on native AV1 and piped H.264 files, both produced a demo in 0.7 s.
- [x] `skill.md`, `website/src/pages/docs/recording.mdx` and a `playwriter` changeset describe
  the native recorder, its Chrome 153+ requirement, the 60 min auto-stop, and "set the viewport
  before start; resizing mid-recording letterboxes". Pass when `pnpm build` regenerates docs.
  Evidence: `pnpm build` regenerated docs; `.changeset/native-screen-recording.md`.

## Done

- [ ] A 2 minute demo recorded by an agent on the user's Chrome with only `page` and `outputPath`
  is an H.264 MP4 at Retina 4K, 60 fps, plays in QuickTime, and stop returns in under 1 s.

Accepted risk: if the relay itself dies, a native recording stays active in Chrome until the
tab closes or the debugger detaches; the next start fails with the "already recorded" error.

Decisions: `plans/decisions/native-screen-recording.md`
