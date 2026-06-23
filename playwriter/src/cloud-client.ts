// HTTP client for CLI to call the website's /api/cloud/* routes.
// Auth: three methods, checked in priority order:
//   1. PLAYWRITER_API_KEY env var → sent as x-api-key header (for CI/VPS/headless)
//   2. PLAYWRITER_CLOUD_TOKEN env var → sent as Authorization: Bearer (for CI with session tokens)
//   3. ~/.playwriter/auth.json file → saved by `cloud login` device flow

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DEFAULT_BASE_URL = 'https://playwriter.dev'
const AUTH_FILE = path.join(os.homedir(), '.playwriter', 'auth.json')

// ── Auth persistence ────────────────────────────────────────────────

export interface CloudAuth {
  token: string
  baseUrl: string
  /** When true, token is an API key sent via x-api-key header instead of Bearer */
  isApiKey?: boolean
}

export function loadCloudAuth(): CloudAuth | null {
  // API key takes highest priority (simplest for CI/VPS/headless)
  const apiKey = process.env.PLAYWRITER_API_KEY
  if (apiKey) {
    return { token: apiKey, baseUrl: process.env.PLAYWRITER_CLOUD_URL || DEFAULT_BASE_URL, isApiKey: true }
  }
  // Session token env var (for CI with device flow tokens)
  const envToken = process.env.PLAYWRITER_CLOUD_TOKEN
  if (envToken) {
    return { token: envToken, baseUrl: process.env.PLAYWRITER_CLOUD_URL || DEFAULT_BASE_URL }
  }
  try {
    const data = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'))
    if (data.token) {
      return { token: data.token, baseUrl: data.baseUrl || DEFAULT_BASE_URL }
    }
  } catch {
    // No auth file
  }
  return null
}

export function saveCloudAuth(auth: CloudAuth): void {
  const dir = path.dirname(AUTH_FILE)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { encoding: 'utf-8', mode: 0o600 })
}

// ── Cloud session status types ───────────────────────────────────────

export interface CloudSessionStatus {
  cloudSessionId: string
  browserUseSessionId: string
  index: number
  createdAt: number
  status: 'active' | 'stopped'
  cdpUrl: string | null
  liveUrl: string | null
  timeoutAt: string
}

export interface ConnectResult {
  cloudSessionId: string
  cdpUrl: string | null
  liveUrl: string | null
  /** BU VM hard timeout (ISO string from server) */
  timeoutAt?: string
}

// ── Client ──────────────────────────────────────────────────────────

export class CloudClient {
  private baseUrl: string
  private token: string
  private isApiKey: boolean

  constructor(auth: CloudAuth) {
    this.baseUrl = auth.baseUrl
    this.token = auth.token
    this.isApiKey = auth.isApiKey ?? false
  }

  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const url = new URL(path, this.baseUrl).toString()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    // API keys use x-api-key header; session tokens use Authorization: Bearer
    if (this.isApiKey) {
      headers['x-api-key'] = this.token
    } else {
      headers['Authorization'] = `Bearer ${this.token}`
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })

    if (response.status === 401) {
      throw new Error('Cloud auth expired or invalid. Run `playwriter cloud login` or set PLAYWRITER_API_KEY.')
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      let detail = text
      try {
        const json = JSON.parse(text)
        detail = json.error || json.message || text
      } catch {
        // use raw text
      }
      throw new Error(`Cloud API error: ${response.status} — ${detail}`)
    }

    return response.json() as Promise<T>
  }

  async getStatus(): Promise<{ sessions: CloudSessionStatus[] }> {
    return this.request('GET', '/api/cloud/status')
  }

  async connect(options: {
    proxyRegion?: string
    customProxy?: { host: string; port: number; username?: string; password?: string }
    /** Cloud browser timeout in minutes (1-240, default 60) */
    timeout?: number
  }): Promise<ConnectResult> {
    return this.request('POST', '/api/cloud/connect', {
      proxyRegion: options.proxyRegion,
      customProxy: options.customProxy,
      ...(options.timeout ? { timeout: options.timeout } : {}),
    })
  }

  async disconnect(cloudSessionId: string): Promise<void> {
    await this.request('POST', '/api/cloud/disconnect', { cloudSessionId })
  }

  /** Get a single session's status by cloudSessionId (from the status list). */
  async getSessionStatus(cloudSessionId: string): Promise<CloudSessionStatus | null> {
    const { sessions } = await this.getStatus()
    return sessions.find((s) => {
      return s.cloudSessionId === cloudSessionId
    }) ?? null
  }

  /** Build a CDP proxy WebSocket URL for auto-creating a new cloud browser.
   *  The URL includes auth token so the proxy can authenticate the upgrade.
   *  No HTTP call is made; the VM is created lazily on WebSocket connect. */
  getCdpProxyUrl(options?: {
    proxyRegion?: string
    timeout?: number
  }): string {
    const url = new URL('/cdp/new', this.baseUrl)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.searchParams.set('token', this.token)
    if (options?.timeout) {
      url.searchParams.set('timeout', String(options.timeout))
    }
    if (options?.proxyRegion) {
      url.searchParams.set('proxy', options.proxyRegion)
    }
    return url.toString()
  }

  /** Build a CDP proxy WebSocket URL for reconnecting to an existing session.
   *  No HTTP call is made; the proxy resolves the BU cdpUrl on connect. */
  getCdpReconnectUrl(cloudSessionId: string): string {
    const url = new URL(`/cdp/${cloudSessionId}`, this.baseUrl)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.searchParams.set('token', this.token)
    return url.toString()
  }
}

/** Create a CloudClient from saved auth, or null if not logged in. */
export function getCloudClient(): CloudClient | null {
  const auth = loadCloudAuth()
  if (!auth) return null
  return new CloudClient(auth)
}
