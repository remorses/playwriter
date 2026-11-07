---
'playwriter': patch
---

Extension and remote sessions now survive relay restarts. The relay restarts on every CLI version change, and before this `-s 1` could silently run in another agent's new session 1, because ids started again at 1.

- Sessions are saved to `~/.playwriter/sessions.json` (one file per relay port, written atomically with 0600 permissions). A corrupt file is moved aside and the relay starts with no saved sessions.
- Session ids are never reused, so a stale id gives `Session N not found` instead of running in someone else's session.
- The first `execute` on a saved session after a restart creates it again and prints a warning that `state` was cleared. Its tabs stay open.
- Deleting a session with `closeCreatedTabs` (or `closeTabsOnEnd` in `connectViaExtension`) still closes tabs created before the restart, because each session now has a stable tab ownership key.
- Headless, direct CDP and cloud sessions are not saved: their browser connection dies with the relay.
