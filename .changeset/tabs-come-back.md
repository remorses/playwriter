---
'playwriter': patch
---

Re-attach tabs the extension lost while they were still open.

- **Debugger dropped by Chrome:** Chrome detaches the debugger from a tab that stays open, for example when it navigates to a `chrome://` page or on some navigations (`reason=target_closed`). The extension now re-attaches the tab, immediately or as soon as it reaches a page extensions can debug. Agents keep using `state.page`. Automatic re-attaches are capped at 3 per tab per minute.
- **Tab replaced:** when prerendering or instant navigation swaps a tab for a new tab id (`chrome.tabs.onReplaced`), the replacement is attached in the same tab group.
- **Service worker restarts:** when Chrome stops the extension's service worker (WebSocket close code 1001), attached tabs are restored from `chrome.storage.session` and re-attached when the worker starts again. Previously every tab was detached and removed from its group. Session storage is cleared on browser restart, which matches tab id lifetime.
- **Short outages keep tab groups:** tabs waiting to re-attach stay in their group for 60 seconds after the relay drops or the worker restarts, instead of being ungrouped immediately.
