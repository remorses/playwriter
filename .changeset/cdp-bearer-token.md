---
'playwriter': patch
---

Accept `Authorization: Bearer <token>` on the `/cdp` WebSocket.

With `playwriter serve --token`, the `/cdp` WebSocket only read the token from `?token=`, so clients had to keep it in the URL, where other local users can read it with `ps`. The relay now also accepts the header, like the HTTP routes do:

```ts
const browser = await chromium.connectOverCDP('ws://127.0.0.1:19988/cdp/session1', {
  headers: { Authorization: `Bearer ${process.env.PLAYWRITER_TOKEN}` },
})
```

`?token=` keeps working.

Fixes #144
