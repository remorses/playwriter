---
'playwriter': patch
---

A new session or CDP client on a tab no longer breaks the other sessions on that tab. Before, a running `page.evaluate()` failed with "Execution context was destroyed" and element handles stopped working when another client connected. The relay now enables `Runtime` once per tab and sends the known execution contexts only to the new client.
