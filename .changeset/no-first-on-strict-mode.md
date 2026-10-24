---
'playwriter': patch
---

Skill docs no longer tell agents to fix strict mode violations with `.first()`, `.last()` or `.nth()`. These click by position and can hit the wrong element. The Playwright error already lists every matching element with a unique locator, so agents can retry with the one they mean. The docs also warn that an empty `hasText` applies no filter.

Fixes #136
