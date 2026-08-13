---
'playwriter': patch
---

Fix `playwriter session new` to reserve stdout for the bare session ID, and ensure locator-scoped snapshots inspect the locator's own page instead of another open tab.
