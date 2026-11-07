---
'playwriter': patch
---

`snapshot({ search })` fixes:

- A regex with the `g` flag no longer skips every other match.
- String search is now case-insensitive.
- The result starts with the match count, like `12 matches (showing 10)`, so you know when results were cut.
