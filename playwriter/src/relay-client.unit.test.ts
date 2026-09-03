import { describe, expect, it } from 'vitest'
import {
  describeExtensionDisconnect,
  formatNoExtensionError,
  waitForPortFree,
} from './relay-client.js'

describe('relay-client frog fixes', () => {
  it('formats a structured nonzero-exit error when no extension connects (20260830090829)', () => {
    const message = formatNoExtensionError({ timeoutMs: 12000 })
    expect(message).toContain('code=extension_not_connected')
    expect(message).toContain('12000ms')
    expect(message).toContain('playwriter browser list')
  })

  it('maps fetch failed to a reconnect hint without a new browser gesture (20260902073850)', () => {
    const message = describeExtensionDisconnect({ error: 'Error: fetch failed', when: 'session creation' })
    expect(message).toContain('code=extension_connection_lost')
    expect(message).toContain('fetch failed')
    expect(message).toContain('playwriter browser list')
  })

  it('reports the port free once the owner exits (20260902000436)', async () => {
    const calls: number[] = []
    const free = await waitForPortFree({
      port: 19988,
      timeoutMs: 500,
      pollIntervalMs: 10,
      listPids: async () => {
        calls.push(1)
        return calls.length < 3 ? [10456] : []
      },
    })
    expect(free).toBe(true)
    expect(calls.length).toBeGreaterThanOrEqual(3)
  })

  it('times out while the port stays occupied (20260902000436)', async () => {
    const free = await waitForPortFree({
      port: 19988,
      timeoutMs: 60,
      pollIntervalMs: 10,
      listPids: async () => {
        return [10456]
      },
    })
    expect(free).toBe(false)
  })
})
