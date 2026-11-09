# Native-only screen recording, no screencast fallback (human)

- User, 2026-11-09: "should we assume all users use latest chrome and simplify?", then "proceed"
  on "native only for recording, screencast only for streaming".
- `recording.start` uses only CDP `Page.startScreenRecording` (Chrome 153+). Older Chrome gets a
  clear "update Chrome" error.
- `Page.startScreencast` + ffmpeg stays only for `stream.start` (RTMP).
- Why: about 4x less Chrome CPU, about 15x less CDP traffic, no ffmpeg for plain recordings,
  less code. Chrome auto-updates, and the user's Chrome is 157.
- Lost: recording on Chrome before 153, and recording a tab that already has a screencast
  (live view, skill recorder, stream). Those now fail with a clear error.
- User, 2026-11-09: "max should be 4k. prefer h264 mp4. add in options if possible".
- Default `maxSize` is 3840. Default output is H.264 MP4, transcoded live from Chrome's AV1 by
  ffmpeg. `codec: 'av1'` is an option that skips ffmpeg.
- Open: none.
- Lives in: `playwriter/src/screen-recording.ts`.
