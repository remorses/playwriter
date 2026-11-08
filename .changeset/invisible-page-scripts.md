---
'playwriter': patch
---

Pages can no longer see Playwriter's own scripts. The ghost cursor, the bot challenge check and the screenshot cleanup now run in a private isolated world, like anomalyco/browse does. Anti-bot code on a page no longer finds a `__playwriterGhostCursor` global, a leftover `<style>` element or a class on `<html>`, and cannot catch Playwriter's DOM calls by hooking `querySelector` or `createElement`. The extension no longer injects the ghost cursor into every attached tab; the cursor shows on the first agent mouse action as before.

With human-like input on, element clicks now land a few pixels off the exact center, inside the element, instead of on the same pixel every time. `mouse.click(x, y)` and clicks with a `position` stay exact.
