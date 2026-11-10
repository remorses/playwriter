---
'playwriter': patch
---

`page.on('worker')` and `page.workers()` now work. The relay used to drop dedicated web worker targets, so `worker.evaluate()` was not possible. This works in Playwright and Patchright sessions.
