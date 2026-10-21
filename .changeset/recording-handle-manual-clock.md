---
'playwriter': minor
---

`recording.start()` now returns a **handle** and supports a frame-stepped **manual clock**, so agent latency no longer ends up in demo videos.

```js
state.video = await recording.start({ page: state.page, outputPath: '/abs/demo.mp4', clock: 'manual' })

await state.page.getByRole('button', { name: 'Open' }).click()
await state.video.wait(400)   // 400ms of page time, 12 frames at 30 fps
await state.video.frame()     // one more frame

await state.video.setPage(otherTab) // record another tab from now on
await state.video.stop()
```

With `clock: 'manual'` the page's time is frozen: `Date`, `performance.now`, timers, `requestAnimationFrame`, CSS animations, CSS transitions and `element.animate()`. Time moves only when you call `frame()` or `wait(ms)`. Each frame is a screenshot at an exact page time, so the video has no idle time while the agent thinks, and animations stay smooth at any frame rate. `stop()` gives the page real time back. The default `clock: 'real'` records wall-clock time like before.

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

The library `startRecording()` also accepts `clock: 'manual'` and has `frame()`, `wait(ms)` and `setPage(page)`.
