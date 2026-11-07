---
'playwriter': patch
---

`screenshotWithAccessibilityLabels` now draws labels in the right place after the page is scrolled. Labels were offset by the scroll position, so on a scrolled page they were missing or pointed at the wrong elements. The label script is also injected again on every call, so tabs that kept an old version get the fix.
