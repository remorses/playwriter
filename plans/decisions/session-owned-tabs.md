# Sessions own the tabs they create (human asked)

- User, 2026-11-10: "i would want to make pages created by agents via page new owned by the agent".
- A tab a session opens with `context.newPage()`, and every popup opened from it, belongs to that session. Only that session's Playwright clients see it: attach events, target lists, replays on connect.
- (agent) Tabs nobody created (the user toggled them with the extension icon, or an older relay created them) stay shared: every session sees them, like today.
- (agent) Ownership is the relay's `ownershipKey(sessionId)`, the same key the extension stores as `groupKey`. It includes the relay start, so a relay restart makes old tabs shared.
- (agent) Child targets (OOPIF iframes, dedicated workers) follow the owner of their parent tab.
- Why: agents in parallel sessions stop navigating or closing each other's tabs. A Playwright session no longer sends `Runtime.enable` to a Patchright session's tabs, which broke Patchright stealth.
- Lost: one session cannot pick up a tab another session opened. Sharing needs the user to toggle a tab, or a future explicit API.
- Open: whether MCP clients (no CLI session) own their tabs; whether a session can adopt a shared tab.
- Lives in: `playwriter/src/cdp-relay.ts`, `playwriter/src/relay-state.ts`.
