---
'playwriter': patch
---

Attach tabs reliably when another extension's iframe is still loading.

Pages with iframes from extensions like LastPass or 1Password could fail to attach with "Cannot access a chrome-extension:// URL of different extension". This happened when the iframe finished loading right after the debugger attached. The extension now removes these iframes before every attach attempt, not only after a failed attach.
