---
'playwriter': minor
---

The MCP now has the same session features as the CLI. It runs code in relay sessions, so MCP tabs are owned by their session, survive relay upgrades, show in `playwriter session list`, and an execute stops when the client cancels it.

New MCP tools:

- `session_list`: active sessions and the browsers a new session can use
- `session_new`: pick a browser key, `headless`, `cloud` (with proxy options), `direct` CDP or a `remote` control id, plus `patchright` and `tabGroup`
- `session_update`: switch `patchright` or the tab group
- `session_delete`: delete a session, optionally closing its tabs

`execute` and `reset` take an optional `session`. Without it they use a default session, created on first use when one browser is connected.

Breaking: the MCP no longer reads `PLAYWRITER_DIRECT` and `playwriter --patchright` is gone. Use `session_new` with `direct` or `patchright` instead.
