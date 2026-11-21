/**
 * Remote control: share the browser through Playwriter's Cloudflare tunnel.
 *
 * The extension acts as the "upstream" client (the thing being exposed).
 * A client dials wss://playwriter.dev/tunnel/{tunnelId}/extension. That is a
 * Playwriter-owned Durable Object which forwards the connection to the extension.
 * The extension treats it as a normal relay connection speaking the exact same
 * extension WS protocol. The tunnel id lives in the URL path, so it is covered
 * by TLS and never leaks through DNS queries or TLS SNI the way a subdomain
 * would.
 *
 * Agents connect with the tunnel id, not a viewer URL:
 *
 *     playwriter session new --remote {tunnelId}
 *
 * The viewer page still exists (hash carries the id) but is not advertised: playback
 * is too slow. parseRemoteControlUrl accepts a bare id or a leftover viewer/tunnel URL.
 *
 * This module is shared between the extension (browser), the relay (node), and the
 * website viewer: keep it dependency-free and runtime-agnostic.
 */
import dedent from 'string-dedent'

export const REMOTE_TUNNEL_BASE_DOMAIN = 'playwriter.dev'
export const REMOTE_VIEWER_BASE_URL = 'https://playwriter.dev'
export const REMOTE_VIEWER_PATH = '/remote-control'
export const REMOTE_TUNNEL_MAX_BUFFERED_BYTES = 2 * 1024 * 1024

export function shouldDropRemoteTunnelFrame({
  bufferedAmount,
  isScreencastFrame,
}: {
  bufferedAmount: number
  isScreencastFrame: boolean
}): boolean {
  return isScreencastFrame && bufferedAmount >= REMOTE_TUNNEL_MAX_BUFFERED_BYTES
}

// ---------------------------------------------------------------------------
// Remote tunnel protocol (JSON over one WebSocket). This is the small Trafóro wire
// subset retained for extension compatibility; the worker lives in website/src.
// ---------------------------------------------------------------------------

export type TraforoHttpRequestMessage = {
  type: 'http_request'
  id: string
  method: string
  path: string
  headers: Record<string, string>
  body: string | null
}

export type TraforoWsOpenMessage = {
  type: 'ws_open'
  connId: string
  path: string
  headers: Record<string, string>
}

export type TraforoWsFrameMessage = {
  type: 'ws_frame'
  connId: string
  data: string
  binary: boolean
}

export type TraforoWsCloseMessage = {
  type: 'ws_close'
  connId: string
  code: number
  reason: string
}

/** Messages the tunnel DO sends to the upstream client (the extension). */
export type TraforoUpstreamMessage =
  | TraforoHttpRequestMessage
  | TraforoWsOpenMessage
  | TraforoWsFrameMessage
  | TraforoWsCloseMessage
  | { type: 'upstream_accepted' }

/** Messages the upstream client (the extension) sends back to the tunnel DO. */
export type TraforoDownstreamMessage =
  | { type: 'http_response'; id: string; status: number; headers: Record<string, string>; body: string | null }
  | { type: 'ws_opened'; connId: string }
  | { type: 'ws_frame'; connId: string; data: string; binary: boolean }
  | { type: 'ws_closed'; connId: string; code: number; reason: string }
  | { type: 'ws_error'; connId: string; error: string }
  /** Same string as the relay JSON ping, so one DO auto-response answers both. */
  | { method: 'ping' }

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

/** 128 bits of entropy, 32 hex chars. Fits the tunnel host id charset. */
export function generateTunnelId(): string {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => {
      return b.toString(16).padStart(2, '0')
    })
    .join('')
}

/** The link the user shares. Anyone holding it can drive the shared browser. */
export function buildRemoteControlUrl({
  tunnelId,
  baseUrl = REMOTE_VIEWER_BASE_URL,
}: {
  tunnelId: string
  baseUrl?: string
}): string {
  return `${baseUrl}${REMOTE_VIEWER_PATH}#${tunnelId}`
}

/** Origin Playwriter serves this tunnel from. */
export function buildTunnelOrigin({
  baseDomain = REMOTE_TUNNEL_BASE_DOMAIN,
}: {
  tunnelId?: string
  baseDomain?: string
}): string {
  return `https://${baseDomain}`
}

/** WebSocket URL the extension dials to register itself as the tunnel upstream. */
export function buildRemoteUpstreamWsUrl({
  tunnelId,
  baseDomain = REMOTE_TUNNEL_BASE_DOMAIN,
}: {
  tunnelId: string
  baseDomain?: string
}): string {
  return `wss://${baseDomain}/tunnel/${encodeURIComponent(tunnelId)}/upstream`
}

/** Tunnel id carried in the hash of a viewer link, or null for any other URL. */
export function extractViewerTunnelId(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.pathname.replace(/\/$/, '') !== REMOTE_VIEWER_PATH) {
    return null
  }
  const id = parsed.hash.slice(1)
  return /^[a-z0-9-]{1,63}$/.test(id) ? id : null
}

/**
 * Normalize a tunnel id or leftover remote-control URL to the /extension
 * WebSocket URL a client must dial. The returned wsUrl is unique per tunnel id
 * in every accepted input form, so relays can key dials by it.
 *
 * Accepted inputs:
 *   {tunnelId}                                          current (what the prompt copies)
 *   wss://playwriter.dev/tunnel/{id}/extension          path-form tunnel URL
 *   leftover viewer or tunnel-host URLs from older prompts
 *
 * The tunnel host form keeps using the host verbatim, so older and self-hosted
 * tunnel domains still work; a bare id or viewer form derives a host from the id.
 */
export function parseRemoteControlUrl(url: string): { wsUrl: string; host: string } {
  const trimmed = url.trim()
  const resolved = /^[a-z0-9-]{1,63}$/.test(trimmed)
    ? buildRemoteControlUrl({ tunnelId: trimmed })
    : trimmed
  let parsed: URL
  try {
    parsed = new URL(resolved)
  } catch {
    throw new Error(`Invalid remote control id: ${url}`)
  }
  const isSecure = parsed.protocol === 'https:' || parsed.protocol === 'wss:'
  const isKnown = isSecure || parsed.protocol === 'http:' || parsed.protocol === 'ws:'
  if (!isKnown) {
    throw new Error(`Invalid remote control URL protocol: ${parsed.protocol} (expected https:// or wss://)`)
  }

  if (parsed.pathname.replace(/\/$/, '') === REMOTE_VIEWER_PATH && !parsed.hash) {
    throw new Error(
      `Remote control id is missing. Pass the id from the copied prompt, for example:\n  playwriter session new --remote your-id`,
    )
  }

  const viewerTunnelId = extractViewerTunnelId(resolved)
  if (viewerTunnelId) {
    return resolvePathFormTunnel(viewerTunnelId)
  }

  // A pasted path-form tunnel URL round-trips instead of losing the id.
  const pathMatch = parsed.pathname.match(/^\/tunnel\/([a-z0-9-]{1,63})\/(?:upstream|extension)\/?$/)
  if (pathMatch) {
    return resolvePathFormTunnel(pathMatch[1], { host: parsed.host, isSecure })
  }

  const wsProtocol = isSecure ? 'wss:' : 'ws:'
  return {
    wsUrl: `${wsProtocol}//${parsed.host}/extension`,
    host: parsed.host,
  }
}

/** Path-form resolution: the id travels in the URL path, never in DNS or TLS SNI. */
function resolvePathFormTunnel(
  tunnelId: string,
  { host = REMOTE_TUNNEL_BASE_DOMAIN, isSecure = true }: { host?: string; isSecure?: boolean } = {},
): { wsUrl: string; host: string } {
  const wsProtocol = isSecure ? 'wss:' : 'ws:'
  return {
    wsUrl: `${wsProtocol}//${host}/tunnel/${tunnelId}/extension`,
    host,
  }
}

// ---------------------------------------------------------------------------
// Extension CDP transport codec
// ---------------------------------------------------------------------------
// The tunnel speaks the extension WS protocol, not raw CDP. Commands are wrapped
// in `forwardCDPCommand`, events arrive as `forwardCDPEvent`, and errors come back
// as a plain string instead of the raw-CDP `{ message }` object. The viewer page
// on playwriter.dev uses these helpers so it can drive the shared tab with the same
// screencast code it uses for raw-CDP cloud browsers.

export function encodeExtensionCdpCommand({
  id,
  method,
  params,
  sessionId,
}: {
  id: number
  method: string
  params?: Record<string, unknown>
  sessionId?: string
}): string {
  return JSON.stringify({
    id,
    method: 'forwardCDPCommand',
    params: { method, sessionId, params: params || {} },
  })
}

export type DecodedExtensionMessage =
  | { kind: 'response'; id: number; result?: unknown; error?: string }
  | { kind: 'event'; method: string; sessionId: string; params: unknown }
  | { kind: 'hello'; browser?: string; version?: string }
  | { kind: 'ping' }
  | { kind: 'ignored' }

export function decodeExtensionCdpMessage(raw: string): DecodedExtensionMessage {
  let msg: object
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') {
      return { kind: 'ignored' }
    }
    msg = parsed
  } catch {
    return { kind: 'ignored' }
  }
  const id = Reflect.get(msg, 'id')
  const method = Reflect.get(msg, 'method')
  const params = Reflect.get(msg, 'params')
  if (typeof id === 'number' && method === undefined) {
    const error = Reflect.get(msg, 'error')
    return {
      kind: 'response',
      id,
      result: Reflect.get(msg, 'result'),
      error: typeof error === 'string' ? error : undefined,
    }
  }
  if (method === 'forwardCDPEvent' && params && typeof params === 'object') {
    const eventMethod = Reflect.get(params, 'method')
    if (typeof eventMethod !== 'string') {
      return { kind: 'ignored' }
    }
    const sessionId = Reflect.get(params, 'sessionId')
    return {
      kind: 'event',
      method: eventMethod,
      sessionId: typeof sessionId === 'string' ? sessionId : '',
      params: Reflect.get(params, 'params'),
    }
  }
  if (method === 'hello') {
    const browser = params && typeof params === 'object' ? Reflect.get(params, 'browser') : undefined
    const version = params && typeof params === 'object' ? Reflect.get(params, 'version') : undefined
    return {
      kind: 'hello',
      browser: typeof browser === 'string' ? browser : undefined,
      version: typeof version === 'string' ? version : undefined,
    }
  }
  if (method === 'ping') {
    return { kind: 'ping' }
  }
  return { kind: 'ignored' }
}

/**
 * Session id of an announced tab, taken from a `Target.attachedToTarget` event.
 * The extension announces the tab where sharing started first, right after `hello`.
 */
export function readAttachedTargetSession(
  message: DecodedExtensionMessage,
): { sessionId: string; url: string } | null {
  if (message.kind !== 'event' || message.method !== 'Target.attachedToTarget') {
    return null
  }
  const params = message.params as
    | { sessionId?: string; targetInfo?: { url?: string; type?: string } }
    | undefined
  if (!params?.sessionId) {
    return null
  }
  return { sessionId: params.sessionId, url: params.targetInfo?.url || '' }
}

// ---------------------------------------------------------------------------
// Remote control command guards
// ---------------------------------------------------------------------------
// Remote control gives the same browser access as a local relay: every attached
// tab, plus new tabs. It is not a sandbox; only block obvious profile-wide accidents.

const REMOTE_BLOCKED_CDP_COMMANDS = new Map<string, string>([
  ['Network.clearBrowserCookies', 'clears cookies for EVERY site in the user profile'],
  ['Network.clearBrowserCache', 'clears the browser cache for the whole user profile'],
  ['Network.getAllCookies', 'reads cookies for EVERY site in the user profile'],
  ['Storage.clearCookies', 'clears cookies for EVERY site in the user profile'],
  ['Storage.getCookies', 'reads cookies for EVERY site in the user profile'],
  ['Storage.setCookies', 'changes cookies for any site in the user profile'],
])

/**
 * Returns a helpful error string when a CDP command must be rejected on a
 * remote control connection, or null when the command is allowed.
 */
export function getRemoteCdpCommandRejection(method: string): string | null {
  const blockedReason = REMOTE_BLOCKED_CDP_COMMANDS.get(method)
  if (blockedReason) {
    return `${method} is not allowed over Remote control: it ${blockedReason}.`
  }
  return null
}

/**
 * Returns a helpful error string when an extension protocol message (non-CDP)
 * must be rejected on a remote control connection, or null when allowed.
 */
export function getRemoteExtensionMethodRejection(method: string): string | null {
  // Remote peers must never close tabs by ownership key: the handler scans every local tab
  if (method === 'closeTabsForKey') {
    return 'Closing session tabs is not available over Remote control.'
  }
  // The handler finds the tab by targetId among every local tab
  if (method === 'releaseTab') {
    return 'releasePage() is not available over Remote control.'
  }
  if (method === 'ghost-browser') {
    return 'Ghost Browser APIs are not available over Remote control.'
  }
  return null
}

/**
 * Tab group keys are relay session ids ("1", "2", ...). A remote relay counts
 * its own sessions, so its keys are namespaced to never match local sessions.
 */
export function namespaceRemoteTabGroupKey(key: string | undefined): string | undefined {
  return key ? `remote:${key}` : undefined
}

/** No upstream connected. Node `ws` still fires `open` (HTTP 101) first. */
export const TRAFORO_TUNNEL_OFFLINE_CLOSE_CODE = 4008

/** Matches extension/src/remote-tunnel.ts RECONNECT_DELAY_MS. */
const REMOTE_UPSTREAM_RECONNECT_MS = 3_000

const REMOTE_DIAL_MAX_RETRY_MS = 60_000

/** Stop background redials after the tunnel stayed unreachable this long. Using the session dials again. */
export const REMOTE_DIAL_GIVE_UP_MS = 10 * 60_000

/**
 * 4008 (offline): base 1s. Other drops: wait past the extension's 3s upstream
 * reconnect. Each dial that fails before any message doubles the delay, so an
 * id whose user stopped sharing is not redialed every few seconds forever.
 */
export function getRemoteDialRetryMs({ closeCode, failedAttempts }: { closeCode: number; failedAttempts: number }): number {
  const baseMs = closeCode === TRAFORO_TUNNEL_OFFLINE_CLOSE_CODE ? 1_000 : REMOTE_UPSTREAM_RECONNECT_MS + 1_000
  return Math.min(baseMs * 2 ** Math.max(0, failedAttempts - 1), REMOTE_DIAL_MAX_RETRY_MS)
}

export const REMOTE_EXTENSION_NOT_CONNECTED_ERROR = dedent`
  Could not reach the remote-control browser. The tunnel dropped. Ask the user to confirm Remote control is still on, then retry. If they clicked Stop sharing, they need to share a fresh id.
`

// ---------------------------------------------------------------------------
// Prompt copied to the clipboard when the user enables remote control
// ---------------------------------------------------------------------------

export function buildRemoteControlPrompt({ id }: { id: string }): string {
  return dedent`
    Connect to my Chrome browser:

    npx -y playwriter@latest session new --remote ${id}

    Then use the printed session id. Read https://playwriter.dev/SKILL.md. NEVER share this id.
  `
}

/** Handshake accepted from current and older extension versions. */
export type RemoteHelloMessage = {
  method: 'hello'
  id?: undefined
  params: {
    browser?: string
    email?: string
    id?: string
    installId?: string
    version?: string
    remote?: boolean
  }
}

export function buildRemoteHelloMessage({
  browser,
  version,
}: {
  browser?: string
  version?: string
}): RemoteHelloMessage {
  return {
    method: 'hello',
    params: {
      browser,
      version,
      remote: true,
    },
  }
}
