---
'playwriter': patch
---

Execute now warns when a page stored in state crashes. Errors for crashed tabs, closed page references and failed navigations give specific recovery steps instead of recommending a whole-session reset. Actions are never retried automatically, because a failed script may already have submitted a form or changed data.
