/**
 * Chrome instance discovery for direct CDP connections.
 *
 * Probes the default CDP port (9222) via GET /json/version.
 * If Chrome responds with a valid webSocketDebuggerUrl, the instance is usable.
 * Otherwise nothing is returned — the user should pass an explicit endpoint.
 *
 * For non-default ports or remote hosts, pass an explicit endpoint with
 * --direct host:port or --direct ws://....
 */

export interface DiscoveredInstance {
  browser: string
  port: number
  wsUrl: string
  profiles: Array<{ name: string; email: string }>
  dataDir: string | null
}

export interface ParsedActivePort {
  port: number
  wsPath: string
}

/**
 * Parse the contents of a DevToolsActivePort file.
 * Format: line 1 = port number, line 2 = /devtools/browser/{guid}
 */
export function parseDevToolsActivePort(contents: string): ParsedActivePort | null {
  const lines = contents.trim().split('\n')
  if (lines.length < 2) {
    return null
  }
  const port = parseInt(lines[0].trim(), 10)
  if (isNaN(port) || port <= 0 || port > 65535) {
    return null
  }
  const wsPath = lines[1].trim()
  if (!wsPath.startsWith('/devtools/browser/')) {
    return null
  }
  return { port, wsPath }
}

interface JsonVersionResponse {
  Browser?: string
  webSocketDebuggerUrl?: string
  'Protocol-Version'?: string
}

type PortProbeStatus =
  | { type: 'live'; wsUrl: string; browser: string }
  /** HTTP response received but no CDP data (e.g. Chrome 136+ default profile returns 404) */
  | { type: 'blocked' }
  /** ECONNREFUSED or timeout — nothing is listening */
  | { type: 'dead' }

/**
 * Probe a port via GET /json/version.
 *
 * Returns:
 * - 'live'    — Chrome responded with valid CDP JSON containing webSocketDebuggerUrl
 * - 'blocked' — HTTP response received but no CDP info (Chrome 136+ default profile)
 * - 'dead'    — connection refused or timeout (nothing listening)
 */
async function probePortStatus(port: number, hostname = '127.0.0.1'): Promise<PortProbeStatus> {
  try {
    const response = await fetch(`http://${hostname}:${port}/json/version`, {
      signal: AbortSignal.timeout(1000),
    })
    if (!response.ok) {
      await response.text() // consume body
      return { type: 'blocked' }
    }
    const data = (await response.json()) as JsonVersionResponse
    if (data.webSocketDebuggerUrl) {
      return { type: 'live', wsUrl: data.webSocketDebuggerUrl, browser: data.Browser || 'Unknown' }
    }
    return { type: 'blocked' }
  } catch {
    return { type: 'dead' }
  }
}

/**
 * Probe a port via GET /json/version.
 * Returns the webSocketDebuggerUrl and browser name, or null.
 */
export async function probePort(port: number, hostname = '127.0.0.1'): Promise<{ wsUrl: string; browser: string } | null> {
  const status = await probePortStatus(port, hostname)
  if (status.type === 'live') {
    return { wsUrl: status.wsUrl, browser: status.browser }
  }
  return null
}

/**
 * Discover Chrome on the default CDP port (9222).
 *
 * Probes /json/version. Returns one instance if Chrome responds with a valid
 * webSocketDebuggerUrl, otherwise returns an empty array.
 */
export async function discoverChromeInstances(): Promise<DiscoveredInstance[]> {
  const status = await probePortStatus(9222)

  if (status.type === 'live') {
    return [
      {
        browser: parseBrowserVersion(status.browser),
        port: 9222,
        wsUrl: status.wsUrl,
        profiles: [],
        dataDir: null,
      },
    ]
  }

  return []
}

/**
 * Resolve a --direct input value to a WebSocket URL.
 *
 * Accepts:
 * - ws:// or wss:// URL — returned as-is
 * - host:port — probes /json/version to get the webSocketDebuggerUrl
 *
 * Throws with a clear message if the endpoint can't be resolved.
 */
export async function resolveDirectInput(input: string): Promise<string> {
  if (input.startsWith('ws://') || input.startsWith('wss://')) {
    return input
  }

  const match = input.match(/^([^:]+):(\d+)$/)
  if (!match) {
    throw new Error(
      `Invalid --direct value: expected a ws:// URL or host:port (e.g. localhost:9222), got: ${input}`,
    )
  }

  const [, hostname, portStr] = match
  const port = parseInt(portStr, 10)
  const status = await probePortStatus(port, hostname)

  if (status.type === 'live') {
    return status.wsUrl
  }

  if (status.type === 'blocked') {
    throw new Error(
      `Chrome is listening on ${hostname}:${port} but /json/version is blocked. ` +
        `Pass the full WebSocket URL instead: --direct ws://${hostname}:${port}/devtools/browser/<guid>`,
    )
  }

  throw new Error(
    `Nothing found on ${hostname}:${port}. Is Chrome running with remote debugging enabled? ` +
      `Try: chrome://inspect/#remote-debugging`,
  )
}

function parseBrowserVersion(browserString: string): string {
  if (browserString.startsWith('HeadlessChrome/')) {
    return 'Chrome (Headless)'
  }
  if (browserString.startsWith('Chrome/')) {
    return 'Chrome'
  }
  const slashIndex = browserString.indexOf('/')
  if (slashIndex > 0) {
    return browserString.slice(0, slashIndex)
  }
  return browserString
}
