---
'playwriter': patch
---

`page.evaluate()` and `page.waitForFunction()` can now wait longer than 30 seconds. The relay cut every command at 30 s, and Playwright showed it as a misleading "Execution context was destroyed" error. Awaited evaluates now get 5 minutes, other commands 60 seconds.
