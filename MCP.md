# MCP Setup

> **Note:** CLI is the recommended way to use Playwriter. See [README.md](./README.md) for CLI usage.

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
2. MCP automatically starts relay server and connects to enabled tabs
3. Use the `execute` tool to run Playwright code

The MCP exposes:

- `execute` tool - run Playwright code snippets
- `reset` tool - reconnect if connection issues occur

## Environment Variables

### `PLAYWRITER_AUTO_ENABLE`

Auto-create a tab when Playwright connects (no manual extension click needed).

> **Note:** CLI enables this by default. This is only needed for MCP server usage.

```json
{
  "mcpServers": {
    "playwriter": {
      "command": "npx",
      "args": ["-y", "playwriter@latest"],
      "env": {
        "PLAYWRITER_AUTO_ENABLE": "1"
      }
    }
  }
}
```

The auto-created tab starts at `about:blank`. Navigate it to any URL.

## Direct CDP (no extension needed)

Connect directly to Chrome's DevTools Protocol without the extension. Set `PLAYWRITER_DIRECT` in your MCP config:

```json
{
  "mcpServers": {
    "playwriter": {
      "command": "npx",
      "args": ["-y", "playwriter@latest"],
      "env": {
        "PLAYWRITER_DIRECT": "1"
      }
    }
  }
}
```

Enable debugging in Chrome first: open `chrome://inspect/#remote-debugging` or launch with `--remote-debugging-port=9222`.

Chrome 136+ may show an approval dialog the first time a connection is made.

You can also pass an explicit WebSocket endpoint: `PLAYWRITER_DIRECT=ws://127.0.0.1:9222/devtools/browser/abc`.

**Limitation:** screen recording is unavailable in direct mode.

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
