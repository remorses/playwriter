// WebSocket proxy for CDP connections to cloud browsers.
//
// Routes:
//   wss://playwriter.dev/cdp/new?timeout=60&proxy=us   — auto-create VM + proxy
//   wss://playwriter.dev/cdp/{cloudSessionId}           — reconnect to existing VM
//
// Auth: token query param (?token=xxx) or Authorization header.
// The proxy relays CDP messages bidirectionally between the client (Playwright)
// and the Browser Use VM. All billing, quota, and VM lifecycle is handled here;
// the relay/CLI just treats it as a regular CDP endpoint.
//
// On client disconnect the BU VM stays alive (it has its own timeout).
// The existing cron job handles budget enforcement and dead session cleanup.

import * as orm from 'drizzle-orm'
import * as schema from 'db/schema'
import { getDb, getSessionWithApiKey, ensureOrg } from './db.ts'
import {
  getBrowserUse,
  validateCloudAccess,
  createCloudBrowserVM,
} from './cloud-helpers.ts'

// ── Auth helper ─────────────────────────────────────────────────────

/** Authenticate a WebSocket upgrade request.
 *  Accepts token from query param or Authorization/x-api-key headers.
 *  Returns org info on success, or a Response error to send back. */
async function authenticateWsRequest(request: Request): Promise<
  | { ok: true; orgId: string }
  | { ok: false; response: Response }
> {
  const url = new URL(request.url)
  const tokenParam = url.searchParams.get('token')

  // Build a synthetic headers object that includes the token from query param
  // so we can reuse the existing auth infrastructure (better-auth session resolution)
  const headers = new Headers(request.headers)
  if (tokenParam && !headers.has('authorization') && !headers.has('x-api-key')) {
    // Try as bearer token first; if it starts with pw_ prefix, use x-api-key
    if (tokenParam.startsWith('pw_')) {
      headers.set('x-api-key', tokenParam)
    } else {
      headers.set('authorization', `Bearer ${tokenParam}`)
    }
  }

  const session = await getSessionWithApiKey({ headers })
  if (!session) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    }
  }

  const org = await ensureOrg(session.userId, session.user.name)
  return { ok: true, orgId: org.id }
}

// ── Outbound WS to BU ──────────────────────────────────────────────

/** Open an outbound WebSocket to a Browser Use CDP URL.
 *  BU returns https:// CDP URLs; we convert to wss:// for the WebSocket. */
async function connectToBrowserUse(cdpUrl: string): Promise<
  | { ok: true; socket: WebSocket }
  | { ok: false; response: Response }
> {
  // Normalize https:// to wss://
  let wsUrl = cdpUrl
  if (wsUrl.startsWith('https://')) {
    wsUrl = 'wss://' + wsUrl.slice('https://'.length)
  } else if (wsUrl.startsWith('http://')) {
    wsUrl = 'ws://' + wsUrl.slice('http://'.length)
  }

  try {
    const buResponse = await fetch(wsUrl, {
      headers: { Upgrade: 'websocket' },
    })

    const buSocket = buResponse.webSocket
    if (!buSocket) {
      return {
        ok: false,
        response: new Response(
          JSON.stringify({ error: 'Failed to establish WebSocket to cloud browser' }),
          { status: 502, headers: { 'Content-Type': 'application/json' } },
        ),
      }
    }
    buSocket.accept()
    return { ok: true, socket: buSocket }
  } catch (cause) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ error: 'Failed to connect to cloud browser CDP endpoint' }),
        { status: 502, headers: { 'Content-Type': 'application/json' } },
      ),
    }
  }
}

// ── WebSocket relay ─────────────────────────────────────────────────

/** Wire up bidirectional message relay between server-side and BU WebSockets.
 *  `serverSocket` is the server end of the WebSocketPair (we listen on it).
 *  `clientSocket` is the client end (returned in the 101 Response to the caller).
 *  Returns the Response with status 101 to complete the upgrade. */
function createRelay({
  clientSocket,
  serverSocket,
  buSocket,
}: {
  clientSocket: WebSocket
  serverSocket: WebSocket
  buSocket: WebSocket
}): Response {
  // Client (via serverSocket) → BU
  serverSocket.addEventListener('message', (event) => {
    try {
      buSocket.send(event.data)
    } catch {
      try { serverSocket.close(1001, 'upstream closed') } catch { /* already closed */ }
    }
  })

  // BU → Client (via serverSocket)
  buSocket.addEventListener('message', (event) => {
    try {
      serverSocket.send(event.data)
    } catch {
      try { buSocket.close(1001, 'client closed') } catch { /* already closed */ }
    }
  })

  // Handle close propagation
  serverSocket.addEventListener('close', () => {
    try { buSocket.close(1000, 'client disconnected') } catch { /* already closed */ }
  })
  buSocket.addEventListener('close', () => {
    try { serverSocket.close(1000, 'upstream disconnected') } catch { /* already closed */ }
  })

  // Handle errors
  serverSocket.addEventListener('error', () => {
    try { buSocket.close(1011, 'client error') } catch { /* already closed */ }
  })
  buSocket.addEventListener('error', () => {
    try { serverSocket.close(1011, 'upstream error') } catch { /* already closed */ }
  })

  // Return the client end to the HTTP response — this is what the caller receives
  return new Response(null, { status: 101, webSocket: clientSocket })
}

// ── Route handlers ──────────────────────────────────────────────────

/** Handle wss://playwriter.dev/cdp/new — auto-create a BU VM and proxy CDP. */
async function handleCdpNew(request: Request): Promise<Response> {
  const auth = await authenticateWsRequest(request)
  if (!auth.ok) return auth.response

  const url = new URL(request.url)
  const timeout = (() => {
    const raw = url.searchParams.get('timeout')
    if (!raw) return undefined
    const n = parseInt(raw, 10)
    if (Number.isNaN(n) || n < 1 || n > 240) return undefined
    return n
  })()
  const proxyRegion = url.searchParams.get('proxy') || undefined

  // Validate subscription, quota, budget (throws Response on failure)
  const { maxSessions } = await validateCloudAccess({ orgId: auth.orgId })

  // Create BU VM (claims slot, creates VM, updates D1)
  const vm = await createCloudBrowserVM({
    orgId: auth.orgId,
    maxSessions,
    proxyRegion,
    timeout,
  })

  // Connect outbound to BU's CDP URL
  const buConn = await connectToBrowserUse(vm.cdpUrl)
  if (!buConn.ok) return buConn.response

  // Create client WebSocket pair
  const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket]
  server.accept()

  return createRelay({ clientSocket: client, serverSocket: server, buSocket: buConn.socket })
}

/** Handle wss://playwriter.dev/cdp/{cloudSessionId} — reconnect to existing VM. */
async function handleCdpReconnect(request: Request, cloudSessionId: string): Promise<Response> {
  const auth = await authenticateWsRequest(request)
  if (!auth.ok) return auth.response

  const db = getDb()
  const bu = getBrowserUse()

  // Look up the session and verify ownership
  const cloudSession = await db.query.cloudSession.findFirst({
    where: { id: cloudSessionId, orgId: auth.orgId },
  })
  if (!cloudSession) {
    return new Response(
      JSON.stringify({ error: 'Cloud session not found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // Get live CDP URL from BU API
  const vm = await bu.getBrowser(cloudSession.browserUseSessionId)
  if (vm.status !== 'active' || !vm.cdpUrl) {
    return new Response(
      JSON.stringify({ error: 'Cloud browser is no longer active' }),
      { status: 410, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // Connect outbound to BU's CDP URL
  const buConn = await connectToBrowserUse(vm.cdpUrl)
  if (!buConn.ok) return buConn.response

  // Create client WebSocket pair
  const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket]
  server.accept()

  return createRelay({ clientSocket: client, serverSocket: server, buSocket: buConn.socket })
}

// ── Main handler ────────────────────────────────────────────────────

/** Handle CDP proxy WebSocket requests.
 *  Called from the main fetch handler before Spiceflow routing. */
export async function handleCdpProxy(request: Request): Promise<Response | null> {
  const url = new URL(request.url)
  const pathname = url.pathname

  // Only handle /cdp/* paths with WebSocket upgrade
  if (!pathname.startsWith('/cdp/')) return null
  if (request.headers.get('Upgrade') !== 'websocket') {
    return new Response('Expected WebSocket upgrade', { status: 426 })
  }

  if (pathname === '/cdp/new') {
    return handleCdpNew(request)
  }

  // /cdp/{cloudSessionId}
  const cloudSessionId = pathname.slice('/cdp/'.length)
  if (!cloudSessionId) {
    return new Response(
      JSON.stringify({ error: 'Missing cloud session ID' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }

  return handleCdpReconnect(request, cloudSessionId)
}
