---
'playwriter': patch
---

Let users attach Playwriter's own pages (welcome, tutorial) by clicking the extension icon again.

Extension 0.0.175 blocked every `chrome-extension://` page, so the icon showed the restricted state on these pages and a click did nothing. Now a user click attaches the tab. Agents still cannot open or navigate to these pages with `Target.createTarget` or `page.goto()`, and automatic attach paths (popups, tabs dragged into a Playwriter group) still skip them.

A tab attached this way gives connected clients extension privileges, so Remote control peers cannot send commands to it.
