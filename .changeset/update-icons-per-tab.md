---
'playwriter': patch
---

Stop the extension from keeping Chrome busy when pages change their title.

Every tab update, including a title change in any tab, made the extension set the icon, title and badge of every open tab again. With 20 tabs that update their title every second, Chrome used about 1.5 CPU cores and attaching a new tab could time out.

Now title changes never touch icons. Tabs that are not attached use Chrome's default icon, so a connection change only updates the tabs whose state changed, plus the default badge with the connected tab count. A navigation only sets that tab's icon again, because Chrome clears per-tab icons when a tab loads a new page. Icons, titles and badges look the same as before.
