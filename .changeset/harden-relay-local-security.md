---
'playwriter': patch
---

Harden the local relay and CLI against websites and other users on the same machine.

- **Recorder routes:** websites could start and stop a skill recording with a no-preflight `POST` (`Content-Type: text/plain;x=application/json`) to `/recorder/start`. Cross-origin calls to `/recorder/*` now need the Playwriter extension `Origin`, and every privileged route checks the exact `application/json` media type instead of a substring.
- **`playwriter serve --host`:** any non-loopback address (for example a LAN IP) now requires `--token`. Before, only `0.0.0.0` and `::` did, and a LAN client could reach `/cli/execute` by sending `Host: localhost`.
- **Private logs:** `~/.playwriter` is now `0700`, and `relay-server.log` and `cdp.jsonl` are `0600`. Other OS users could read them before. `cdp.jsonl` also redacts `Cookie`, `Set-Cookie`, `Authorization` and cookie results.
- **Token check:** relay tokens are compared in constant time.
- **Chrome for Testing install:** the zip downloads to a private random temp folder, not a fixed `/tmp` path.
