---
'playwriter': patch
---

Fix four triaged friction reports: emit a structured `extension_not_connected` error when session creation ends without a session, map `fetch failed` to an extension-reconnect hint, share accessible-name normalization between snapshot and locator, and verify occupied-port recovery before timing out the replacement relay listener.
