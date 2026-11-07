---
'playwriter': patch
---

The relay and MCP no longer crash when agent code forgets an `await` or a timer callback throws. Before, `page.click('#missing')` without `await`, or `setTimeout(() => { throw new Error() })`, killed the relay and every session within seconds.

- An unhandled promise rejection is logged and ignored. When it comes from an `execute` call, the session gets a `[WARNING] Unhandled promise rejection in your code (missing await?)` line in its next output.
- `setTimeout` and `setInterval` in the sandbox are tracked per session. A throwing callback becomes a warning, and `reset` or `session delete` clears pending timers.
- Uncaught exceptions still stop the process, unless they come from sandbox code or Playwright.
- The crash line now reaches `relay-server.log` before the process exits. On start, the previous log moves to `relay-server.log.1` instead of being erased, and the log rotates when it reaches 20 MB.
- The relay that the CLI or MCP starts in the background now uses `PLAYWRITER_PORT` instead of always 19988.
