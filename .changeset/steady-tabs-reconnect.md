---
'playwriter': patch
---

Keep agents on their tabs when the connection to Chrome drops.

When the relay restarted or the extension's socket reconnected, the extension re-attached the same tabs, but agents were told `Page closed ... e.g. state.page = await context.newPage()`. They abandoned tabs that were still open and opened duplicates.

- After a reconnect, pages stored in `state` are re-bound to the same tabs (matched by targetId) at the start of the next call, and the agent is told:

  ```
  [WARNING] The connection to the tab behind state.page (https://...) dropped and was restored. state.page points at the same tab again, keep using it.
  ```

- The next call waits up to 10 seconds for the extension and its tabs to come back instead of failing with "extension is not connected".
- A call that fails because the connection dropped mid-call says so and asks the agent to retry, instead of suggesting `reset` (which clears `state`).
- A page that stays gone gets a neutral message (closed, or lost its connection while still open) that tells the agent to look for the tab before opening a duplicate. If the tab is re-enabled later, `state.page` is re-bound to it.
- When the extension reconnects before its old socket closes, rebound clients now get the old tabs detached and the re-attached tabs announced, instead of keeping pages whose CDP sessions no longer exist.
- When a tab is re-attached under a new session while its old session is still registered, the relay retires the old session first. Previously Playwright received the same targetId twice, threw `Duplicate target`, and the MCP server process crashed.
- A single page that dropped between calls (not a full disconnect) is also waited for, up to 5 seconds, so a tab the extension is re-attaching is re-bound instead of reported as gone.
- `PLAYWRITER_LOG_TIMESTAMPS=1` prefixes relay log lines with an ISO timestamp, to line them up with `cdp.jsonl` when diagnosing slow or dropped connections.
