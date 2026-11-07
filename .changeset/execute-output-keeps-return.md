---
'playwriter': patch
---

Long `console.log` output no longer hides the return value of `execute`. Output was cut at 10,000 characters from the start, so a loop that logged a lot and then returned a summary lost the summary.

- The return value (or the error) is always shown. Logs keep their start and end, with a note of how many characters were left out.
- Identical log lines in a row are shown once with a count, like `[log] retrying (x37)`.
- Output is truncated once. The MCP no longer cuts the executor output again; only screenshot snapshots it appends are bounded.
- Errors with long logs are now bounded too.
