---
"playwriter": patch
---

<!-- depends-on: @xmorse/playwright-core (needs browserType.runWithAbortSignal). Publish it first. -->

Abort timed-out `execute` code so it cannot overlap the next call. On timeout, the script's running Playwright action is cancelled, its later calls throw, and a new `signal` global (AbortSignal) is aborted. New execute calls always run at once. Pass `signal` to `fetch` or check `signal.aborted` in long loops so they stop on timeout.

Screenshots and `screenshotWithAccessibilityLabels` now always restore the hidden toolbar, scrollbars, caret and labels when capture fails.
