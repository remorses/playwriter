---
'playwriter': patch
---

`route.fetch()`, `context.cookies()` and `context.addCookies()` now work. They failed with `No tab found for method Storage.getCookies`, because the extension cannot reach the browser target. The relay now runs them as Network commands on an open tab, so this works with older extensions too. `context.clearCookies()` throws a clear error instead, because in the user's browser it would delete cookies for every site.

Fixes #66
