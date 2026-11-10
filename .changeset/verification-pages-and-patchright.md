---
'playwriter': minor
---

Agents now get told when a page shows a verification or block page. After an execute navigates a page, Playwriter checks for one. Checks that clear by themselves are waited out within the execute timeout. Otherwise execute prints a `[WARNING]` that tells the agent not to reload and to ask the user instead.

New `--patchright` session mode for production sites where the user is logged in. The session connects with Patchright (`@playwriter/patchright-core`) instead of Playwright, and its input behaves like a person: mouse moves follow curved paths, clicks get human press timing, scrolling glides in wheel flicks, and key presses are spaced 30-110 ms apart. Actions get slower. Sites like x.com, amazon and google get the same input timing in every session.

```bash
playwriter session new --tab-group shop --patchright
# switch an existing session, even after pages loaded; tabs stay open, state is cleared
playwriter session update 1 --patchright
playwriter session update 1 --patchright false
```

With Patchright, `page.evaluate` runs in an isolated world: it sees the DOM but not page globals. Pass `false` as fourth argument for the main world. Patchright keeps CDP `Runtime` off, so `page.on('console')` stays silent; `getLatestLogs` turns `Runtime` on for a few milliseconds and reads the console messages and page errors Chrome buffered. The Node API takes `connectViaExtension({ patchright: true })`. `playwriter --patchright` (MCP) now also humanizes input. `session new --patchright` used to set the driver for the whole relay only when it started the relay; it is now per session.

`@playwriter/patchright-core` is now a regular dependency instead of an optional one.
