---
'playwriter': minor
---

Persist a fail-safe default browser for session creation.

Use `playwriter browser default <key>` once, then ordinary `playwriter session new` commands keep targeting that exact extension installation. `--browser` and `PLAYWRITER_BROWSER` remain explicit overrides. If the preferred browser is offline, Playwriter fails with the configured key instead of silently selecting a different background Chrome profile.
