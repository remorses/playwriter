---
'playwriter': patch
---

Delete headless sessions after 30 minutes with no execute. The shared headless Chrome now exits when its last session goes away, instead of running for days when agents forget `playwriter session delete`.
