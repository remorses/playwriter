---
'playwriter': minor
---

Add support for connecting cloud browser sessions through the Playwriter CDP WebSocket proxy.

Cloud sessions can now use a `wss://playwriter.dev/cdp/...` endpoint so the Browser Use CDP URL stays behind the Playwriter website worker. The CLI builds proxy URLs for new cloud browsers and for reconnecting to existing cloud sessions, while the local relay treats them like normal direct CDP endpoints.

```bash
playwriter session new --browser cloud
playwriter session new --browser cloud --proxy us
```

The existing `/api/cloud/connect` and direct Browser Use connection path remain available, including the fallback path used for custom proxy configuration.
