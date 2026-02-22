<!--
title: Remote Browser Control with Playwriter
description: |
  How to control a Chrome browser on a remote machine over
  the internet using playwriter serve and traforo tunnels.
prompt: |
  Create a guide on how to use playwriter to remotely control
  a Chrome instance on another machine. Cover the architecture
  (playwriter serve + traforo tunnel), step-by-step setup for
  both host and remote machines, MCP configuration, use cases
  (remote Mac mini, user support, multi-machine control), and
  security model. Source files:
  @playwriter/src/cli.ts (serve command, getServerUrl)
  @playwriter/src/utils.ts (parseRelayHost, getCdpUrl)
  @playwriter/src/mcp.ts (remote config, PLAYWRITER_HOST)
  @playwriter/src/executor.ts (checkExtensionStatus)
  @opensrc/repos/github.com/remorses/traforo/src/client.ts
  @opensrc/repos/github.com/remorses/traforo/src/tunnel.ts
  @https://traforo.dev
-->

# Remote Browser Control with Playwriter

Control a Chrome browser on any machine from anywhere over the internet. No VPN, no firewall rules, no port forwarding.

## How it works

Playwriter's relay server runs on the host machine alongside Chrome. A [traforo](https://traforo.dev) tunnel exposes it to the internet through Cloudflare, giving you a secure public URL. The remote machine connects through this URL to control Chrome.

```
┌─────────────────────────────────────────────────────────────┐
│  HOST MACHINE (has Chrome)                                  │
│                                                             │
│  Chrome + Extension ◄──── local WS ────► Relay Server       │
│                                          :19988             │
│                                            ▲                │
│                                            │ local          │
│                                            ▼                │
│                                         Traforo Client      │
│                                            │                │
└────────────────────────────────────────────┼────────────────┘
                                             │ outbound WS
                                             ▼
                                    ┌─────────────────┐
                                    │   Cloudflare     │
                                    │   Durable Object │
                                    │                  │
                                    │   https://{id}-  │
                                    │   tunnel.        │
                                    │   traforo.dev    │
                                    └────────┬────────┘
                                             │
                                             ▼
┌────────────────────────────────────────────────────────────┐
│  REMOTE MACHINE (CLI or MCP)                               │
│                                                            │
│  playwriter -s 1 -e "await page.goto('https://...')"      │
│                                                            │
│  PLAYWRITER_HOST=https://{id}-tunnel.traforo.dev           │
│  PLAYWRITER_TOKEN=<secret>                                 │
└────────────────────────────────────────────────────────────┘
```

Traforo proxies both HTTP and WebSocket connections, which is critical because playwriter uses WebSockets for real-time CDP communication.

## 1. Host machine setup

The host machine runs Chrome with the playwriter extension installed.

1. Install [Playwriter from the Chrome Web Store](https://chromewebstore.google.com/detail/playwriter/jfeammnjpkecdekppnclgkkffahnhfhe)
2. Click the extension icon on any tab you want to make controllable
3. Start the relay server with a tunnel:

```bash
npx -y traforo -p 19988 -t my-machine -- npx -y playwriter serve --token MY_SECRET_TOKEN
```

This starts `playwriter serve` on port 19988 with token auth, and creates a traforo tunnel at `https://my-machine-tunnel.traforo.dev`. Keep this terminal running, or use tmux for persistent operation:

```bash
tmux new-session -d -s playwriter-remote
tmux send-keys -t playwriter-remote \
  "npx -y traforo -p 19988 -t my-machine -- npx -y playwriter serve --token MY_SECRET_TOKEN" Enter
```

**About the `-t` flag:** It sets the tunnel ID, which becomes the URL subdomain. If omitted, a random 8-char UUID is generated. Tunnel IDs are **not reserved** - if someone else connects with the same ID, they replace your connection (close code 4009). This is fine because the relay still requires the `--token`, but avoid predictable IDs like `test` or `demo`.

## 2. Remote machine setup

Set the two environment variables and use playwriter normally:

```bash
export PLAYWRITER_HOST=https://my-machine-tunnel.traforo.dev
export PLAYWRITER_TOKEN=MY_SECRET_TOKEN
```

The **CLI with the skill** is the recommended approach. The skill file (`playwriter skill`) documents all available APIs. Use playwriter exactly as you would locally:

```bash
playwriter session new          # outputs: 1
playwriter -s 1 -e "await page.goto('https://example.com')"
playwriter -s 1 -e "console.log(await snapshot({ page }))"
```

Alternatively, pass host and token as flags instead of env vars:

```bash
playwriter --host https://my-machine-tunnel.traforo.dev --token MY_SECRET_TOKEN -s 1 -e "..."
```

### MCP configuration (optional)

If you prefer using the MCP server over the CLI (e.g. for AI assistants that don't support the skill), set the env vars in your MCP client config:

```json
{
  "mcpServers": {
    "playwriter": {
      "command": "npx",
      "args": ["-y", "playwriter@latest"],
      "env": {
        "PLAYWRITER_HOST": "https://my-machine-tunnel.traforo.dev",
        "PLAYWRITER_TOKEN": "MY_SECRET_TOKEN"
      }
    }
  }
}
```

The env vars tell the MCP to skip starting a local relay and connect to the remote one instead.

### Playwright API (programmatic)

```typescript
import { chromium } from 'playwright-core'

const browser = await chromium.connectOverCDP('wss://my-machine-tunnel.traforo.dev/cdp/session1?token=MY_SECRET_TOKEN')
const page = browser.contexts()[0].pages()[0]
await page.goto('https://example.com')
// Don't call browser.close() - it would close the user's Chrome
```

## Use cases

**Control a remote Mac mini** - Run Chrome on a headless machine and control it from your laptop. The Mac mini runs the tunnel persistently via tmux. Automate browser tasks, run tests against real Chrome, or manage web apps from anywhere.

**Fix issues for a user remotely** - The user starts the tunnel, shares the URL + token with you, and you can see exactly what they see: navigate their tabs, inspect elements, take screenshots. The user sees Chrome's automation banner so they always know when their browser is being controlled, and can revoke access instantly by closing the terminal.

**Control many machines at once** - Each machine runs its own tunnel with a unique `-t` ID and the same token. From a control machine, loop over the tunnel URLs to run commands across the fleet:

```bash
for machine in machine-a machine-b machine-c; do
  PLAYWRITER_HOST="https://${machine}-tunnel.traforo.dev" \
  PLAYWRITER_TOKEN=shared-secret \
  playwriter -s 1 -e "console.log(await page.title())"
done
```

**Development from a VM or devcontainer** - Your code runs in a VM or devcontainer but Chrome runs on the host. The tunnel bridges the gap without needing host networking or port forwarding.

## Security

**Traforo URLs are non-guessable.** Each tunnel gets a unique ID (random UUID by default). Nobody can discover your tunnel by scanning.

**Token authentication is required.** When `playwriter serve` binds to `0.0.0.0`, it refuses to start without a `--token`. Every privileged HTTP request (`/cli/*`, `/recording/*`) needs `Authorization: Bearer <token>` or `?token=<token>`, and every `/cdp` WebSocket connection needs `?token=<token>`. Without the correct token, the relay returns 401.

**Extension endpoint is localhost-only.** The `/extension` WebSocket endpoint only accepts connections from `127.0.0.1` or `::1`. A remote attacker cannot impersonate the extension even with the token.

**No open ports.** Traforo uses an outbound WebSocket to Cloudflare. The host machine needs no inbound ports open. Works behind NATs, firewalls, and corporate networks.

**Visible automation.** Chrome shows an automation banner on controlled tabs.

**Instant revocation.** Closing the terminal immediately disconnects the tunnel.

### Environment variables

| Variable           | Description                                                                        |
| ------------------ | ---------------------------------------------------------------------------------- |
| `PLAYWRITER_HOST`  | Remote relay URL (e.g. `https://x-tunnel.traforo.dev`) or IP (e.g. `192.168.1.10`) |
| `PLAYWRITER_TOKEN` | Authentication token for the relay server                                          |
| `PLAYWRITER_PORT`  | Override relay port (default: `19988`, not needed with traforo)                    |

### Recommendations

- Generate a strong random token: `openssl rand -hex 16`
- Omit `-t` in traforo to get a random tunnel ID for maximum security
- Don't share tunnel URLs in public channels
- Kill the tunnel when you're done

## Without traforo (LAN only)

If both machines are on the same network, skip traforo and connect directly:

```bash
# Host
npx -y playwriter serve --token MY_SECRET_TOKEN

# Remote (same LAN)
export PLAYWRITER_HOST=192.168.1.10
export PLAYWRITER_TOKEN=MY_SECRET_TOKEN
playwriter session new
```
