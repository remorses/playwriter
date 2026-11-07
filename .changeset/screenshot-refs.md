---
'playwriter': patch
---

`refToLocator` now resolves the refs shown by the last `screenshotWithAccessibilityLabels` call. Before, it used the last `snapshot()` refs, so `e5` from a labelled screenshot could point to a different element or to nothing.
