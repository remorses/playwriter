---
'playwriter': minor
---

`recording.start` now uses Chrome's native screen recorder (CDP `Page.startScreenRecording`, Chrome 153+) instead of screencast JPEG frames piped to ffmpeg. Chrome encodes the video out of process, so a 1080p recording costs about 4x less Chrome CPU and 15x less CDP traffic.

- Defaults are now 60 fps (max 120) and a 3840 px longest edge, so a Retina viewport records in 4K. Pass `maxSize: 1920` for X uploads.
- Output is H.264 MP4 by default, transcoded live by ffmpeg, so stop takes under a second. `codec: 'av1'` keeps Chrome's own output and needs no ffmpeg.
- `audio: true` records tab audio, cross-origin iframes included, without patching page audio APIs.
- Auto-stop default is 60 minutes instead of 15, and it saves the file. A closed page also keeps what was recorded. Both add a warning to the next execute output, and `stop()` returns `endReason`.
- The video grows in `<name>.<id>.partial.mp4` while recording, so a crash leaves a playable file.
- `recording.stop({ page })` recovers a lost handle. A second `recording.start` on the same page fails with a clear error.
- Relative `outputPath` resolves against the session cwd.
- The relay stops native recordings of a disconnected client, so an executor reset never leaves a tab stuck.
- The `quality` option is removed. Older Chrome fails with an "update Chrome" error. `stream.start` keeps the screencast pipeline.
