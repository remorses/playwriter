---
'playwriter': minor
---

`recording.start()` now returns a **handle** and supports a **manual clock** that keeps agent latency out of demo videos.

```js
state.video = await recording.start({ page: state.page, outputPath: '/abs/demo.mp4', clock: 'manual' })

await state.page.getByRole('button', { name: 'Open' }).click()
await state.video.wait(800)          // records the next 800ms

await state.video.setPage(otherTab)  // record another tab from now on
await state.video.stop()
```

With `clock: 'manual'` frames are written only inside `wait(ms)`. The page keeps running normally; the time the agent spends thinking between execute calls is not written, so the video has no idle time and needs no `createDemoVideo` pass. Put each action and its `wait()` in the same execute call. The default `clock: 'real'` records wall-clock time like before.

**Breaking:** `recording.stop({ page })`, `recording.isRecording({ page })` and `recording.cancel({ page })` are removed, and so are the `startRecording`, `stopRecording`, `isRecording` and `cancelRecording` sandbox aliases. Use the handle:

```js
// before
await recording.start({ page: state.page, outputPath })
await recording.stop({ page: state.page })

// after
state.video = await recording.start({ page: state.page, outputPath })
await state.video.stop() // also: state.video.cancel(), state.video.isRecording
```

This also fixes `recording.stop()` in a later execute call, which failed with "No active recording for this page" and left the recording running.

The library `startRecording()` also accepts `clock: 'manual'` and has `wait(ms)` and `setPage(page)`.
