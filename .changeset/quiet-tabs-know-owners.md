---
'playwriter': minor
---

Add a tab index so you can see which agent is using which tab, and warn agents before they open duplicate tabs.

- **`playwriter tabs`** lists every tab Playwriter controls with the session or agent that opened it and last drove it (navigated, clicked, typed, took a screenshot), plus when. Use `--json` for the raw index.

  ```
  #  URL                              TITLE    OPENED BY             LAST USED BY          ACTIVE
  1  play.google.com/console/app/123  Console  3 (halfhour/launch)   3 (halfhour/launch)   2m ago
  2  developers.facebook.com/apps     Apps     mcp:a1b2c3 (social)   mcp:a1b2c3 (social)   14s ago
  ```

- **Duplicate tab warnings**: when an execute call navigates to a page already open in another tab (query and hash ignored), the result includes `[WARNING] <page> is open in N tabs: used by you just now; used by 3 (halfhour/launch) 2m ago. ...`. Nothing is blocked.
- **`playwriter session list`** now shows each session's tab count and last activity, and lists MCP servers (which have no session id) as `mcp:<id>` agents. Set `PLAYWRITER_AGENT` in the MCP server's env to label it.
- **Activity log**: every execute call appends time, session, agent, cwd, duration, success and navigated URLs (never code) to `~/.playwriter/activity.jsonl`, rotated at 10 MB. `playwriter logfile` prints its path.
- The relay no longer keeps the previous page's title after a tab navigates to a new document.

All tracking lives in the relay, so no extension update is needed. Older relays ignore the new connection params, and the CLI falls back gracefully when the relay predates the index.
