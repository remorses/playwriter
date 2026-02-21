declare const process: { env: { PLAYWRITER_PORT?: string } }

export type RelayConfig = {
  host: string
  port: number
  token?: string
}

export const RELAY_CONFIG_STORAGE_KEY = 'relayConfig'
export const DEFAULT_RELAY_HOST = '127.0.0.1'
export const DEFAULT_RELAY_PORT = Number(process.env.PLAYWRITER_PORT) || 19988

function normalizeHost(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_RELAY_HOST
  const host = value.trim()
  return host || DEFAULT_RELAY_HOST
}

function normalizePort(value: unknown): number {
  if (typeof value !== 'string' && typeof value !== 'number') return DEFAULT_RELAY_PORT
  const port = Number(value)
  if (!Number.isInteger(port)) return DEFAULT_RELAY_PORT
  if (port < 1 || port > 65535) return DEFAULT_RELAY_PORT
  return port
}

function normalizeToken(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const token = value.trim()
  return token || undefined
}

export function normalizeRelayConfig(value: unknown): RelayConfig {
  if (!value || typeof value !== 'object') {
    return { host: DEFAULT_RELAY_HOST, port: DEFAULT_RELAY_PORT }
  }

  const record = value as { host?: unknown; port?: unknown; token?: unknown }
  return {
    host: normalizeHost(record.host),
    port: normalizePort(record.port),
    token: normalizeToken(record.token),
  }
}

export async function getRelayConfig(): Promise<RelayConfig> {
  const stored = await chrome.storage.local.get(RELAY_CONFIG_STORAGE_KEY)
  return normalizeRelayConfig(stored[RELAY_CONFIG_STORAGE_KEY])
}

export async function setRelayConfig(config: RelayConfig): Promise<void> {
  await chrome.storage.local.set({
    [RELAY_CONFIG_STORAGE_KEY]: normalizeRelayConfig(config),
  })
}
