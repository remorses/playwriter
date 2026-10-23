---
"playwriter": patch
---

Abort timed-out `execute` code so it cannot overlap the next call. On timeout, the script's next Playwright call throws and a new `signal` global (AbortSignal) is aborted. New execute calls always run at once. Pass `signal` to `fetch` or check `signal.aborted` in long loops so they stop on timeout.

Screenshots and `screenshotWithAccessibilityLabels` now always restore the hidden toolbar, scrollbars, caret and labels when capture fails.
