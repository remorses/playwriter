---
'playwriter': patch
---

The relay keeps writing `cdp.jsonl` after a failed write, for example when the log folder was deleted. Before, one failed write stopped CDP logging and raised an unhandled rejection.
