---
'playwriter': patch
'@xmorse/playwright-core': patch
---

Existing web workers now appear after reconnecting a session or switching drivers. Workers follow their parent tab's ownership, and commands using another session's child-session ID are rejected. Tab detach and crash notifications are filtered before ownership is removed. CLI focus cleanup preserves focus emulation requested by SDK or MCP clients on shared tabs.
