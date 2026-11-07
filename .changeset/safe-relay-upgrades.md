---
'playwriter': patch
---

Upgrading the CLI no longer kills scripts other agents are running. A newer CLI used to kill the older relay right away, even in the middle of another agent's `execute`.

- The CLI now asks the old relay to drain: it refuses new executes with a clear "relay is restarting" error, waits up to 30 seconds for running ones, then exits. Relays from older versions are still replaced the old way.
- Only the probed relay process is killed, and only if it is a Playwriter relay. Two CLIs starting at the same time no longer kill each other's new relay.
- When another program holds the relay port, the CLI prints a port conflict error instead of killing it.
- `playwriter serve restart` refuses while executes are running. Pass `--force` to restart anyway.
- Ctrl-C or an agent bash timeout on `playwriter -e` now aborts the running script, so the session is free for the next command instead of locked until the execute timeout.
- `/version` also returns `pid`, `instanceId` and `activeExecutes`.
