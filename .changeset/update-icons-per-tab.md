---
'playwriter': patch
---

Stop the extension from keeping Chrome busy when pages change their title.

Every tab update, including a title change in any tab, made the extension set the icon, title and badge of every open tab again. With 20 tabs that update their title every second, Chrome used about 1.5 CPU cores and attaching a new tab could time out.

Now a tab update only touches that tab's icon, and only when it changed (connection state, restricted URL, or a new document, which resets Chrome's per-tab icon). Connection changes update each tab at most once per change. Icons, titles and badges look the same as before.
