---
"@xmorse/playwright-core": minor
---

Add `browserType.runWithAbortSignal(signal, callback)`. Every Playwright call made inside `callback`, including calls from awaits and timers it starts, is rejected with an `AbortError` once `signal` aborts. Calls and event waits already running are rejected too, and with an in-process browser the server operation is cancelled, so a pending click does not happen later. Route handlers registered inside `callback` are not affected.
