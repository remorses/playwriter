---
'playwriter': patch
---

Agents now use headless Chrome only when the user asks for it. The skill, CLI `--browser` help and MCP `session_new` description say this, and the skill says to never use headless on live production sites like x.com, Google or Reddit unless asked.
