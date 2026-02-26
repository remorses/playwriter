/**
 * Unit tests for relay state transitions.
 * Data-in / data-out transitions for the unified extension map.
 */
import { describe, test, expect } from 'vitest'
import type { WSContext } from 'hono/ws'
import type { Protocol } from './cdp-types.js'
import * as relayState from './relay-state.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyState(): relayState.RelayState {
  return {
    extensions: new Map(),
    playwrightClients: new Map(),
  }
}

function fakeWs(): WSContext {
  return {} as WSContext
}

function makeTargetInfo(overrides: Partial<Protocol.Target.TargetInfo> = {}): Protocol.Target.TargetInfo {
  return {
    targetId: 'target-1',
    type: 'page',
    title: 'Test Page',
    url: 'https://example.com',
    attached: true,
    canAccessOpener: false,
    ...overrides,
  }
}

function stateWithExtension(
  extensionId = 'ext-1',
  info: relayState.ExtensionInfo = { browser: 'Chrome' },
  stableKey = 'profile:chrome-1',
): relayState.RelayState {
  return relayState.addExtension(emptyState(), { id: extensionId, info, stableKey, ws: fakeWs() })
}

// ---------------------------------------------------------------------------
// createRelayStore
// ---------------------------------------------------------------------------

describe('createRelayStore', () => {
  test('creates store with empty maps', () => {
    const store = relayState.createRelayStore()
    const state = store.getState()
    expect(state.extensions.size).toBe(0)
    expect(state.playwrightClients.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// addExtension / removeExtension
// ---------------------------------------------------------------------------

describe('addExtension', () => {
  test('adds extension to empty state', () => {
    const before = emptyState()
    const after = relayState.addExtension(before, {
      id: 'ext-1',
      info: { browser: 'Chrome' },
      stableKey: 'profile:chrome-1',
      ws: fakeWs(),
    })

    expect(after.extensions.size).toBe(1)
    const ext = after.extensions.get('ext-1')!
    expect(ext.stableKey).toBe('profile:chrome-1')
    expect(ext.connectedTargets.size).toBe(0)
    expect(ext.ws).toBeTruthy()
    expect(ext.messageId).toBe(0)
    expect(ext.pendingRequests.size).toBe(0)
    expect(ext.pingInterval).toBeNull()
    // Original unchanged (immutable)
    expect(before.extensions.size).toBe(0)
  })

  test('adding extension with same stableKey keeps old entry (removed on socket close)', () => {
    const s1 = relayState.addExtension(emptyState(), {
      id: 'ext-old',
      info: { browser: 'Chrome' },
      stableKey: 'profile:chrome-1',
      ws: fakeWs(),
    })
    const s2 = relayState.addExtension(s1, {
      id: 'ext-new',
      info: { browser: 'Chrome', email: 'test@example.com' },
      stableKey: 'profile:chrome-1',
      ws: fakeWs(),
    })

    // Both coexist — old stays routable until its socket closes
    expect(s2.extensions.size).toBe(2)
    expect(s2.extensions.has('ext-old')).toBe(true)
    expect(s2.extensions.has('ext-new')).toBe(true)
    // findExtensionByStableKey returns newest
    expect(relayState.findExtensionByStableKey(s2, 'profile:chrome-1')?.id).toBe('ext-new')
    // Original unchanged
    expect(s1.extensions.size).toBe(1)
  })

  test('allows multiple extensions with different stableKeys', () => {
    let state = emptyState()
    state = relayState.addExtension(state, { id: 'ext-1', info: { browser: 'Chrome' }, stableKey: 'profile:a', ws: fakeWs() })
    state = relayState.addExtension(state, { id: 'ext-2', info: { browser: 'Firefox' }, stableKey: 'profile:b', ws: fakeWs() })

    expect(state.extensions.size).toBe(2)
  })
})

describe('removeExtension', () => {
  test('removes existing extension', () => {
    const before = stateWithExtension('ext-1')
    const after = relayState.removeExtension(before, { extensionId: 'ext-1' })

    expect(after.extensions.size).toBe(0)
    // Original unchanged
    expect(before.extensions.size).toBe(1)
  })

  test('no-op for nonexistent extension', () => {
    const before = stateWithExtension('ext-1')
    const after = relayState.removeExtension(before, { extensionId: 'ext-999' })

    expect(after).toBe(before) // Same reference — no allocation
  })
})

// ---------------------------------------------------------------------------
// addPlaywrightClient / removePlaywrightClient
// ---------------------------------------------------------------------------

describe('addPlaywrightClient', () => {
  test('adds client with ws handle', () => {
    const before = emptyState()
    const ws = fakeWs()
    const after = relayState.addPlaywrightClient(before, { id: 'client-1', extensionId: 'ext-1', ws })

    expect(after.playwrightClients.size).toBe(1)
    const client = after.playwrightClients.get('client-1')!
    expect(client.extensionId).toBe('ext-1')
    expect(client.ws).toBe(ws)
    expect(before.playwrightClients.size).toBe(0)
  })
})

describe('removePlaywrightClient', () => {
  test('removes client', () => {
    const before = relayState.addPlaywrightClient(emptyState(), { id: 'c1', extensionId: null, ws: fakeWs() })
    const after = relayState.removePlaywrightClient(before, { clientId: 'c1' })

    expect(after.playwrightClients.size).toBe(0)
    expect(before.playwrightClients.size).toBe(1)
  })

  test('no-op for nonexistent client', () => {
    const before = emptyState()
    const after = relayState.removePlaywrightClient(before, { clientId: 'nope' })

    expect(after).toBe(before)
  })
})

describe('extension I/O fields', () => {
  test('increments extension message id without mutating old state', () => {
    const state = stateWithExtension('ext-1')
    expect(state.extensions.get('ext-1')?.messageId).toBe(0)

    const after = relayState.incrementExtensionMessageId(state, { extensionId: 'ext-1' })
    expect(after.extensions.get('ext-1')?.messageId).toBe(1)
    expect(state.extensions.get('ext-1')?.messageId).toBe(0)
  })

  test('adds and removes pending extension requests', () => {
    let state = stateWithExtension('ext-1')

    const pending = {
      resolve: (_result: unknown) => {
        return
      },
      reject: (_error: Error) => {
        return
      },
    }

    state = relayState.addExtensionPendingRequest(state, {
      extensionId: 'ext-1',
      requestId: 7,
      pendingRequest: pending,
    })
    expect(state.extensions.get('ext-1')?.pendingRequests.get(7)).toBe(pending)

    state = relayState.removeExtensionPendingRequest(state, { extensionId: 'ext-1', requestId: 7 })
    expect(state.extensions.get('ext-1')?.pendingRequests.has(7)).toBe(false)
  })

  test('clears all pending extension requests', () => {
    let state = emptyState()
    state = relayState.addExtension(state, {
      id: 'ext-1',
      info: { browser: 'Chrome' },
      stableKey: 'profile:chrome-1',
      ws: fakeWs(),
    })
    // Manually add a pending request
    state = relayState.addExtensionPendingRequest(state, {
      extensionId: 'ext-1',
      requestId: 1,
      pendingRequest: {
        resolve: (_result: unknown) => {
          return
        },
        reject: (_error: Error) => {
          return
        },
      },
    })

    state = relayState.clearExtensionPendingRequests(state, { extensionId: 'ext-1' })
    expect(state.extensions.get('ext-1')?.pendingRequests.size).toBe(0)
  })

  test('updateExtensionIO updates ws and pingInterval', () => {
    let state = stateWithExtension('ext-1')
    expect(state.extensions.get('ext-1')?.pingInterval).toBeNull()

    const interval = setInterval(() => {}, 99999)
    try {
      state = relayState.updateExtensionIO(state, { extensionId: 'ext-1', pingInterval: interval })
      expect(state.extensions.get('ext-1')?.pingInterval).toBe(interval)

      state = relayState.updateExtensionIO(state, { extensionId: 'ext-1', pingInterval: null })
      expect(state.extensions.get('ext-1')?.pingInterval).toBeNull()
    } finally {
      clearInterval(interval)
    }
  })

  test('playwright client ws handle is co-located with state', () => {
    let state = emptyState()
    const ws = fakeWs()
    state = relayState.addPlaywrightClient(state, { id: 'c1', extensionId: null, ws })
    expect(state.playwrightClients.get('c1')?.ws).toBe(ws)

    state = relayState.removePlaywrightClient(state, { clientId: 'c1' })
    expect(state.playwrightClients.size).toBe(0)
  })
})

describe('rebindClientsToExtension', () => {
  test('rebinds all clients from old extension to successor extension', () => {
    let state = stateWithExtension('ext-old')
    state = relayState.addExtension(state, {
      id: 'ext-new',
      info: { browser: 'Chrome' },
      stableKey: 'profile:chrome-1',
      ws: fakeWs(),
    })
    state = relayState.addPlaywrightClient(state, { id: 'c1', extensionId: 'ext-old', ws: fakeWs() })
    state = relayState.addPlaywrightClient(state, { id: 'c2', extensionId: 'ext-old', ws: fakeWs() })
    state = relayState.addPlaywrightClient(state, { id: 'c3', extensionId: 'ext-new', ws: fakeWs() })

    const after = relayState.rebindClientsToExtension(state, {
      fromExtensionId: 'ext-old',
      toExtensionId: 'ext-new',
    })

    expect(after.playwrightClients.get('c1')?.extensionId).toBe('ext-new')
    expect(after.playwrightClients.get('c2')?.extensionId).toBe('ext-new')
    expect(after.playwrightClients.get('c3')?.extensionId).toBe('ext-new')
  })
})

// ---------------------------------------------------------------------------
// addTarget / removeTarget / removeTargetByCrash
// ---------------------------------------------------------------------------

describe('addTarget', () => {
  test('adds target to extension', () => {
    const before = stateWithExtension('ext-1')
    const targetInfo = makeTargetInfo()
    const after = relayState.addTarget(before, {
      extensionId: 'ext-1',
      sessionId: 'pw-tab-1',
      targetId: 'target-1',
      targetInfo,
    })

    const ext = after.extensions.get('ext-1')!
    expect(ext.connectedTargets.size).toBe(1)
    expect(ext.connectedTargets.get('pw-tab-1')?.targetId).toBe('target-1')
    // Original unchanged
    expect(before.extensions.get('ext-1')!.connectedTargets.size).toBe(0)
  })

  test('no-op if extension does not exist', () => {
    const before = emptyState()
    const after = relayState.addTarget(before, {
      extensionId: 'ext-nope',
      sessionId: 'pw-tab-1',
      targetId: 'target-1',
      targetInfo: makeTargetInfo(),
    })

    expect(after).toBe(before)
  })

  test('preserves existing frameIds on update', () => {
    let state = stateWithExtension('ext-1')
    state = relayState.addTarget(state, {
      extensionId: 'ext-1',
      sessionId: 'pw-tab-1',
      targetId: 'target-1',
      targetInfo: makeTargetInfo(),
      existingFrameIds: new Set(['frame-A']),
    })

    // Update the same target with new targetInfo but no explicit frameIds
    state = relayState.addTarget(state, {
      extensionId: 'ext-1',
      sessionId: 'pw-tab-1',
      targetId: 'target-1',
      targetInfo: makeTargetInfo({ url: 'https://updated.com' }),
    })

    const target = state.extensions.get('ext-1')!.connectedTargets.get('pw-tab-1')!
    expect(target.targetInfo.url).toBe('https://updated.com')
    expect(target.frameIds.has('frame-A')).toBe(true)
  })
})

describe('removeTarget', () => {
  test('removes target by sessionId', () => {
    let state = stateWithExtension('ext-1')
    state = relayState.addTarget(state, {
      extensionId: 'ext-1',
      sessionId: 'pw-tab-1',
      targetId: 'target-1',
      targetInfo: makeTargetInfo(),
    })
    const after = relayState.removeTarget(state, { extensionId: 'ext-1', sessionId: 'pw-tab-1' })

    expect(after.extensions.get('ext-1')!.connectedTargets.size).toBe(0)
  })

  test('no-op if target does not exist', () => {
    const before = stateWithExtension('ext-1')
    const after = relayState.removeTarget(before, { extensionId: 'ext-1', sessionId: 'pw-tab-nope' })

    expect(after).toBe(before)
  })
})

describe('removeTargetByCrash', () => {
  test('removes target by targetId', () => {
    let state = stateWithExtension('ext-1')
    state = relayState.addTarget(state, {
      extensionId: 'ext-1',
      sessionId: 'pw-tab-1',
      targetId: 'target-1',
      targetInfo: makeTargetInfo(),
    })
    const after = relayState.removeTargetByCrash(state, { extensionId: 'ext-1', targetId: 'target-1' })

    expect(after.extensions.get('ext-1')!.connectedTargets.size).toBe(0)
  })

  test('no-op if targetId not found', () => {
    const before = stateWithExtension('ext-1')
    const after = relayState.removeTargetByCrash(before, { extensionId: 'ext-1', targetId: 'nope' })

    expect(after).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// updateTargetInfo
// ---------------------------------------------------------------------------

describe('updateTargetInfo', () => {
  test('updates targetInfo matched by targetId', () => {
    let state = stateWithExtension('ext-1')
    state = relayState.addTarget(state, {
      extensionId: 'ext-1',
      sessionId: 'pw-tab-1',
      targetId: 'target-1',
      targetInfo: makeTargetInfo({ title: 'Old Title' }),
    })

    const newInfo = makeTargetInfo({ title: 'New Title' })
    const after = relayState.updateTargetInfo(state, { extensionId: 'ext-1', targetInfo: newInfo })

    expect(after.extensions.get('ext-1')!.connectedTargets.get('pw-tab-1')!.targetInfo.title).toBe('New Title')
    // Original unchanged
    expect(state.extensions.get('ext-1')!.connectedTargets.get('pw-tab-1')!.targetInfo.title).toBe('Old Title')
  })
})

// ---------------------------------------------------------------------------
// addFrameId / removeFrameId
// ---------------------------------------------------------------------------

describe('addFrameId', () => {
  test('adds frameId to target', () => {
    let state = stateWithExtension('ext-1')
    state = relayState.addTarget(state, {
      extensionId: 'ext-1',
      sessionId: 'pw-tab-1',
      targetId: 'target-1',
      targetInfo: makeTargetInfo(),
    })
    const after = relayState.addFrameId(state, { extensionId: 'ext-1', sessionId: 'pw-tab-1', frameId: 'frame-1' })

    expect(after.extensions.get('ext-1')!.connectedTargets.get('pw-tab-1')!.frameIds.has('frame-1')).toBe(true)
  })

  test('no-op if frameId already present', () => {
    let state = stateWithExtension('ext-1')
    state = relayState.addTarget(state, {
      extensionId: 'ext-1',
      sessionId: 'pw-tab-1',
      targetId: 'target-1',
      targetInfo: makeTargetInfo(),
    })
    state = relayState.addFrameId(state, { extensionId: 'ext-1', sessionId: 'pw-tab-1', frameId: 'frame-1' })
    const after = relayState.addFrameId(state, { extensionId: 'ext-1', sessionId: 'pw-tab-1', frameId: 'frame-1' })

    expect(after).toBe(state) // Same reference
  })
})

describe('removeFrameId', () => {
  test('removes frameId from owning target', () => {
    let state = stateWithExtension('ext-1')
    state = relayState.addTarget(state, {
      extensionId: 'ext-1',
      sessionId: 'pw-tab-1',
      targetId: 'target-1',
      targetInfo: makeTargetInfo(),
    })
    state = relayState.addFrameId(state, { extensionId: 'ext-1', sessionId: 'pw-tab-1', frameId: 'frame-1' })
    const after = relayState.removeFrameId(state, { extensionId: 'ext-1', frameId: 'frame-1' })

    expect(after.extensions.get('ext-1')!.connectedTargets.get('pw-tab-1')!.frameIds.has('frame-1')).toBe(false)
  })

  test('no-op if frameId not found', () => {
    const before = stateWithExtension('ext-1')
    const after = relayState.removeFrameId(before, { extensionId: 'ext-1', frameId: 'nope' })

    expect(after).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// updateTargetUrl
// ---------------------------------------------------------------------------

describe('updateTargetUrl', () => {
  test('frameNavigated on top-level frame updates URL and title', () => {
    let state = stateWithExtension('ext-1')
    state = relayState.addTarget(state, {
      extensionId: 'ext-1',
      sessionId: 'pw-tab-1',
      targetId: 'target-1',
      targetInfo: makeTargetInfo({ url: 'https://old.com', title: 'Old' }),
    })

    const after = relayState.updateTargetUrl(state, {
      extensionId: 'ext-1',
      sessionId: 'pw-tab-1',
      url: 'https://new.com',
      title: 'New Page',
    })

    const target = after.extensions.get('ext-1')!.connectedTargets.get('pw-tab-1')!
    expect(target.targetInfo.url).toBe('https://new.com')
    expect(target.targetInfo.title).toBe('New Page')
  })

  test('navigatedWithinDocument updates URL only (no title)', () => {
    let state = stateWithExtension('ext-1')
    state = relayState.addTarget(state, {
      extensionId: 'ext-1',
      sessionId: 'pw-tab-1',
      targetId: 'target-1',
      targetInfo: makeTargetInfo({ url: 'https://example.com', title: 'Keep This' }),
    })

    const after = relayState.updateTargetUrl(state, {
      extensionId: 'ext-1',
      sessionId: 'pw-tab-1',
      url: 'https://example.com/new-path',
    })

    const target = after.extensions.get('ext-1')!.connectedTargets.get('pw-tab-1')!
    expect(target.targetInfo.url).toBe('https://example.com/new-path')
    expect(target.targetInfo.title).toBe('Keep This')
  })

  test('no-op if target does not exist', () => {
    const before = stateWithExtension('ext-1')
    const after = relayState.updateTargetUrl(before, {
      extensionId: 'ext-1',
      sessionId: 'pw-tab-nope',
      url: 'https://example.com',
    })

    expect(after).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// removeClientsForExtension
// ---------------------------------------------------------------------------

describe('removeClientsForExtension', () => {
  test('removes all clients bound to extension', () => {
    let state = stateWithExtension('ext-1')
    state = relayState.addPlaywrightClient(state, { id: 'c1', extensionId: 'ext-1', ws: fakeWs() })
    state = relayState.addPlaywrightClient(state, { id: 'c2', extensionId: 'ext-1', ws: fakeWs() })
    state = relayState.addPlaywrightClient(state, { id: 'c3', extensionId: 'ext-2', ws: fakeWs() })

    const after = relayState.removeClientsForExtension(state, { extensionId: 'ext-1' })

    expect(after.playwrightClients.size).toBe(1)
    expect(after.playwrightClients.has('c3')).toBe(true)
  })

  test('no-op if no clients bound', () => {
    const before = stateWithExtension('ext-1')
    const after = relayState.removeClientsForExtension(before, { extensionId: 'ext-1' })

    expect(after).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// Derivation helpers
// ---------------------------------------------------------------------------

describe('findExtensionByStableKey', () => {
  test('finds extension by stableKey', () => {
    const state = stateWithExtension('ext-1', { browser: 'Chrome' }, 'profile:chrome-1')

    const found = relayState.findExtensionByStableKey(state, 'profile:chrome-1')
    expect(found?.id).toBe('ext-1')
  })

  test('returns undefined if not found', () => {
    const state = emptyState()
    expect(relayState.findExtensionByStableKey(state, 'profile:nope')).toBeUndefined()
  })
})

describe('findExtensionIdByCdpSession', () => {
  test('finds extension owning a CDP sessionId', () => {
    let state = stateWithExtension('ext-1')
    state = relayState.addTarget(state, {
      extensionId: 'ext-1',
      sessionId: 'pw-tab-1',
      targetId: 'target-1',
      targetInfo: makeTargetInfo(),
    })

    expect(relayState.findExtensionIdByCdpSession(state, 'pw-tab-1')).toBe('ext-1')
  })

  test('returns null if session not found', () => {
    const state = stateWithExtension('ext-1')
    expect(relayState.findExtensionIdByCdpSession(state, 'pw-tab-nope')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Zustand store integration
// ---------------------------------------------------------------------------

describe('store.setState with transitions', () => {
  test('setState updates store atomically', () => {
    const store = relayState.createRelayStore()

    store.setState((s) => {
      return relayState.addExtension(s, { id: 'ext-1', info: { browser: 'Chrome' }, stableKey: 'profile:1', ws: fakeWs() })
    })

    expect(store.getState().extensions.size).toBe(1)
  })

  test('chained transitions compose correctly', () => {
    const store = relayState.createRelayStore()

    store.setState((s) => {
      let next = relayState.addExtension(s, { id: 'ext-1', info: {}, stableKey: 'k1', ws: fakeWs() })
      next = relayState.addTarget(next, {
        extensionId: 'ext-1',
        sessionId: 'pw-tab-1',
        targetId: 'target-1',
        targetInfo: makeTargetInfo(),
      })
      next = relayState.addPlaywrightClient(next, { id: 'c1', extensionId: 'ext-1', ws: fakeWs() })
      return next
    })

    const state = store.getState()
    expect(state.extensions.get('ext-1')!.connectedTargets.size).toBe(1)
    expect(state.playwrightClients.size).toBe(1)
  })
})
