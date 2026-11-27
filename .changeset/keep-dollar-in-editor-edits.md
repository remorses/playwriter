---
'playwriter': patch
---

`editor.edit()` writes `newString` as is when it contains `$$`, `$&`, `` $` `` or `$'`. Before, `$$('a')` became `$('a')` and `$&` became the replaced text.
