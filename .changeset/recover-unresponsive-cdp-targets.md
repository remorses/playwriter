---
'playwriter': patch
---

Recover Chrome tabs that remain falsely connected after a CDP command times out by replacing the stale debugger attachment once. The timed-out command is never retried, so actions that may already have taken effect are not duplicated; callers are told to verify page state before continuing.

Relates to #40 and #74.
