---
'playwriter': patch
---

Raw CDP clients connected to the relay now get `Target.targetInfoChanged` when a tab navigates, like with a normal Chrome. browser-use and other clients that track page URLs from this event used to see every page as blank.
