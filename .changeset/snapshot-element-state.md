---
'playwriter': patch
---

`snapshot()` lines now show element state, in Playwright aria snapshot syntax: `[checked]`, `[checked=mixed]`, `[disabled]`, `[expanded]`, `[level=2]` (headings and tree items), `[pressed]` and `[selected]`. Agents can see if a checkbox is ticked, a button is disabled or a menu is open without an extra `page.evaluate`. The state comes before the locator, so the locator can still be copied as is:

```
- heading "Settings" [level=2]
- checkbox "Alerts" [checked] [id="alerts"]
- [expanded] role=button[name="Menu"i]
```
