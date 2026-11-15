# MCP Setup

> **Note:** CLI is the recommended way to use Playwriter. See [quick start](./website/src/pages/docs/quick-start.mdx) for CLI usage.

Add to your MCP client settings:

```json
{
  "mcpServers": {
    "playwriter": {
      "command": "npx",
      "args": ["-y", "playwriter@latest"]
    }
  }
}
```

Or auto-configure:

```sh
npx -y @playwriter/install-mcp playwriter@latest
```

## Using the MCP

1. Enable the extension on at least one tab (click icon → turns green)
2. MCP automatically starts the relay server
3. Use the `execute` tool to run Playwright code

The first `execute` creates a **default session** on the connected browser. Each session has its own `state` and sees only the tabs it opens, plus tabs you enabled with the extension icon.

| Tool | What it does |
|---|---|
| `execute` | Run Playwright code. Optional `session` |
| `reset` | Reconnect a session after connection errors |
| `session_list` | Active sessions and the browsers a new session can use |
| `session_new` | New session on a browser key, `headless`, `cloud`, `direct` CDP or a `remote` control id. Options: `patchright`, `tabGroup`, cloud proxy |
| `session_update` | Switch `patchright` or the tab group of a session |
| `session_delete` | Delete a session, optionally closing its tabs |

With several Chrome profiles connected, the agent calls `session_list`, then `session_new` with a browser key.

## Direct CDP (no extension needed)

Enable debugging in Chrome: open `chrome://inspect/#remote-debugging` or launch with `--remote-debugging-port=9222`. Then the agent calls `session_new` with `direct: "auto"`, or with an explicit endpoint like `ws://127.0.0.1:9222/devtools/browser/abc` or `wss://xxx.cdp.browser-use.com`.

Chrome 136+ may show an approval dialog the first time a connection is made.

## Remote Agents (Devcontainers, VMs, SSH)

Run agents in isolated environments while controlling Chrome on your host.

**On host (where Chrome runs):**

```bash
npx -y playwriter serve --token <secret>
```

**In container/VM (where agent runs):**

```json
{
  "mcpServers": {
    "playwriter": {
      "command": "npx",
      "args": ["-y", "playwriter@latest", "--host", "host.docker.internal", "--token", "<secret>"]
    }
  }
}
```

Or with environment variables:

```json
{
  "mcpServers": {
    "playwriter": {
      "command": "npx",
      "args": ["-y", "playwriter@latest"],
      "env": {
        "PLAYWRITER_HOST": "host.docker.internal",
        "PLAYWRITER_TOKEN": "<secret>"
      }
    }
  }
}
```

Use `host.docker.internal` for devcontainers, or your host's IP for VMs/SSH.
