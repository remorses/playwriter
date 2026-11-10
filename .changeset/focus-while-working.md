---
'playwriter': patch
---

Tabs of a CLI session report focus (`document.hasFocus()`, `focus` and `blur` events) only while an execute of that session uses them. Before, every attached tab claimed focus all the time, so pages could tell two tabs were focused at once, and chat apps marked messages as read in tabs nobody looked at. MCP and SDK connections keep the old always-focused behavior.
