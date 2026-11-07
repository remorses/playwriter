---
'playwriter': patch
---

`playwriter -e` no longer cuts long error output at 64 KiB when stdout or stderr is a pipe, as it is for agents. The CLI now sets the exit code and lets the output flush instead of calling `process.exit(1)` right after printing.
