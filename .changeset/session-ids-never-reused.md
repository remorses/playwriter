---
'playwriter': patch
---

Session ids are never reused across relay restarts. The relay restarts on every CLI version change, and before this `-s 1` could silently run in another agent's new session 1, because ids started again at 1.

- The next session id is saved to `~/.playwriter/session-counter.json` (one file per relay port).
- Sessions still end with the relay. A stale id gives `Session N ended or was lost when the relay restarted. Run 'playwriter session new' to get a new one.` instead of running in someone else's session. Its tabs stay open.
