---
'playwriter': patch
---

Stop CDP clients from opening Playwriter's own extension pages.

Before, `Target.createTarget` or `page.goto()` could open `chrome-extension://<playwriter id>/...`, and Chrome lets the extension debug its own pages. Code running there had the extension's privileges: it could debug every tab and keep control after **Stop sharing** ended a Remote control share.

Now the extension rejects these URLs, and relative URLs in `Target.createTarget` (which `chrome.tabs.create` resolved against the extension origin), with an error:

```
Protocol error (Page.navigate): Playwriter clients cannot open extension pages.
```

When a tab is attached, extension pages are removed from its back/forward history, so `history.back()` cannot load one either. Attaching a tab that is on an extension page right now fails, and a tab the user navigates to an extension page is detached.
