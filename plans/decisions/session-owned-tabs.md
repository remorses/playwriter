# Sessions own the tabs they create (human asked)

- User, 2026-11-10: "i would want to make pages created by agents via page new owned by the agent".
- A tab a CLI session opens with `context.newPage()`, and every popup opened from it, belongs to that session while the session exists. Only that session's Playwright clients see it: attach events, target lists, replays on connect, commands.
- (agent) Shared with every session: tabs the user toggled with the extension icon, tabs of deleted sessions or of an older relay start, tabs of SDK sessions (`createRelaySession`, scripts in several processes share one tab).
- (agent) Clients without a session (the MCP) see every tab, like before.
- (agent) The extension sends the tab's `groupKey` as `ownerKey` on `Target.attachedToTarget`. It equals the relay's `ownershipKey(sessionId)`. Old extensions send none, so every tab stays shared with them.
- (agent) OOPIF iframes follow the owner of their parent tab. Worker events go to everyone; clients that never attached the parent ignore them.
- Why: agents in parallel sessions stop navigating or closing each other's tabs. A Playwright session no longer sends `Runtime.enable` to a Patchright session's tabs, which broke Patchright stealth.
- Lost: one CLI session cannot pick up a tab another live CLI session opened.
- Open: whether a session can adopt a shared tab so others stop seeing it.
- Lives in: `playwriter/src/cdp-relay.ts` (`canClientSeeTarget`), `playwriter/src/relay-state.ts`, `extension/src/background.ts` (`ownerKey`).
