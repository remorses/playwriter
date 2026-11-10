---
'playwriter': minor
---

Each CLI session now sees only the tabs it opened (and their popups), plus tabs you enabled with the extension icon. Agents in parallel sessions no longer navigate or close each other's tabs, and a Playwright session no longer touches the tabs of a `--patchright` session. Tabs of a deleted session become shared again. SDK scripts and the MCP still see every tab. Needs the new extension; with an older one every tab stays shared.
