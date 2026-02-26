---
title: Centralize CDP Relay State with Zustand
description: >
  Plan to refactor cdp-relay.ts from scattered mutable Maps to a single Zustand
  vanilla store with pure state transitions and centralized side effects.
  Follows the centralized-state skill pattern.
---

# Centralize CDP Relay State with Zustand

Applies the **centralized-state** skill
(`discord/skills/centralized-state/SKILL.md` in the kimakivoice repo) to the CDP
relay server. The skill defines the pattern: one immutable state atom, functional
`setState()` transitions, and a single `subscribe()` for all reactive side effects.

## Current state of the code

`src/cdp-relay.ts` (1,846 lines) has **4 independent mutable Maps** floating in
the `startPlayWriterCDPRelayServer` closure:

```
extensionConnections   Map<string, ExtensionConnection>
extensionKeyIndex      Map<string, string>
playwrightClients      Map<string, PlaywrightClient>
recordingRelays        Map<string, RecordingRelay>
```

Each `ExtensionConnection` has nested mutable state:

```
connectedTargets       Map<string, ConnectedTarget>   ← mutated in ~10 places
pendingRequests        Map<number, { resolve, reject }>
messageId              number
pingInterval           ReturnType<typeof setInterval> | null
```

State mutations are scattered across ~50 locations in WebSocket handlers, mixed
with I/O (message forwarding, logging, WebSocket sends). There are no unit tests
for state transitions -- the only test file (`relay-core.test.ts`) is a full
integration test that launches a real browser.

## Approach

One Zustand vanilla store, functional `setState()` transitions, one `subscribe()`
for reactive side effects. Message routing stays explicit in handlers (it needs
event data, not just state diffs).

This is a **refactor-only change**. No behavior changes. The public API
(`startPlayWriterCDPRelayServer` return type, HTTP endpoints, WebSocket protocol)
stays identical. Existing integration tests must still pass.

---

## Step 1 -- Define `RelayState` type and create the store

**File:** `src/cdp-relay.ts`

Create a `RelayState` interface consolidating all scattered Maps into one typed
state object. Create the store with `createStore()` from `zustand/vanilla` at the
top of the `startPlayWriterCDPRelayServer` closure, replacing the separate
`new Map()` declarations.

```ts
type RelayState = {
  extensions: Map<string, ExtensionConnection>
  playwrightClients: Map<string, PlaywrightClient>
  // extensionKeyIndex is REMOVED -- derived from extensions
  // recordingRelays kept outside store (holds I/O objects, not pure state)
}
```

**Key decisions:**

- **Kill `extensionKeyIndex`** -- it's a reverse index of `extensions` that can
  get out of sync. Replace with a `findExtensionByStableKey()` derivation function
  that scans `extensions`. With <10 extensions, linear scan is free. This follows
  the skill's "derive instead of cache" principle.
- **Keep `recordingRelays` outside the store** -- `RecordingRelay` holds I/O
  objects (WebSocket send functions, active recording buffers). It's not pure state,
  it's a resource manager. Keep it as a standalone Map managed in subscribe for
  lifecycle.
- **Keep `pendingRequests` inside `ExtensionConnection`** -- these are promise
  resolve/reject callbacks (I/O), not serializable state. They stay as a mutable
  Map on the connection object.
- **Keep `WSContext` references on connection objects** -- WebSockets are I/O
  handles, not state. They live alongside the state but aren't part of the immutable
  transitions.

## Step 2 -- Extract pure state transition functions

**File:** `src/relay-state.ts` (new file)

Extract all state mutations as pure functions: `(state, event) -> newState`. These
are the functions currently scattered as inline mutations inside WebSocket handlers.

| Function | Currently at | What it does |
|---|---|---|
| `addExtension` | extension `onOpen` (~line 1163) | Adds new connection to `extensions` |
| `removeExtension` | extension `onClose` (~line 1500-1516) | Removes connection, cleans up |
| `addPlaywrightClient` | cdp `onOpen` (~line 911) | Adds client to `playwrightClients` |
| `removePlaywrightClient` | cdp `onClose` (~line 1090) | Removes client |
| `addTarget` | `Target.attachedToTarget` (~line 1311) | Adds target to connection's `connectedTargets` |
| `removeTarget` | `Target.detachedFromTarget` (~line 1338) | Removes target by sessionId |
| `removeTargetByCrash` | `Target.targetCrashed` (~line 1350) | Finds and removes crashed target by targetId |
| `updateTargetInfo` | `Target.targetInfoChanged` (~line 1368) | Updates `targetInfo` on target |
| `addFrameId` | `Page.frameAttached`/`frameNavigated` (~line 1387, 1419) | Adds frameId to target's `frameIds` |
| `removeFrameId` | `Page.frameDetached` (~line 1403) | Removes frameId from owning target |
| `updateTargetUrl` | `Page.frameNavigated`/`navigatedWithinDocument` (~line 1425, 1452) | Updates URL/title on target |
| `removeClientsForExtension` | extension `onClose` (~line 1518) | Removes all clients bound to a disconnected extension |

Each function takes `RelayState` + event params and returns a new `RelayState`.
No I/O, no side effects. Per the skill: "setState() callbacks pure -- no I/O, no
side effects, only compute new state from current state + event data."

## Step 3 -- Add unit tests for state transitions

**File:** `src/relay-state.test.ts` (new file)

Write pure data-in/data-out tests for every transition function. No WebSockets, no
mocks. Per the skill: "State transitions are pure functions, so testing requires no
mocks, no WebSockets, no I/O setup."

Test cases:

- Adding an extension creates the right entry in `extensions`
- Adding a duplicate stable key replaces the existing entry
- Removing an extension also removes its targets
- Adding a target to a nonexistent extension is a no-op (returns state unchanged)
- Target crash removes the right target by `targetId`
- `frameNavigated` on top-level frame updates URL and title
- `frameNavigated` on sub-frame does NOT update URL
- Removing an extension removes all playwright clients bound to it
- `findExtensionByStableKey` correctly derives from extensions map
- State is immutable -- original state unchanged after transition

## Step 4 -- Replace inline mutations with `store.setState()`

**File:** `src/cdp-relay.ts`

Replace every inline mutation with `store.setState()` calling the pure transition
functions from step 2. The handlers become:

```ts
// before (scattered mutation + I/O)
connection.connectedTargets.set(targetParams.sessionId, { ... })
sendToPlaywright({ message: ... })

// after (centralized transition + explicit I/O)
store.setState((s) => addTarget(s, connectionId, targetParams))
sendToPlaywright({ message: ... })
```

Per the skill pattern, handlers do **two things**:

1. `store.setState(pureTransition)` -- state
2. `ws.send(responseOrForward)` -- I/O

**What stays in handlers** (not in subscribe):

- `sendToPlaywright()` calls -- they need the specific CDP message (event data)
- `sendToExtension()` calls -- request-response pipeline
- `emitter.emit()` calls -- event routing to external listeners

This follows the skill's guidance: "Subscribe: side effects derived from state
shape. Handler: side effects that need event data."

## Step 5 -- Add `subscribe()` for reactive side effects

**File:** `src/cdp-relay.ts`

Add a single `store.subscribe()` after store creation. Move these side effects
into it:

| Side effect | Currently in | Why it fits subscribe |
|---|---|---|
| Extension ping start/stop | `onOpen`/`onClose` handlers | "If extension in state, ping it; if removed, stop" |
| Close playwright clients on extension disconnect | `onClose` (~line 1518) | "If extension gone from state, close its clients" |
| Clean up recording relays on extension disconnect | `onClose` (~line 1493) | "If extension gone, cancel its recordings" |
| Reject pending requests on extension disconnect | `onClose` (~line 1503) | "If extension gone, reject all pending" |
| Logging connection/disconnection | scattered across handlers | "If extensions/clients map changed, log it" |

Per the skill: "Side effects in subscribe should be derived from state shape, not
from specific events -- ask 'given this state, what should the world look like?'
not 'what event just happened?'"

```ts
store.subscribe((state, prev) => {
  // extensions removed -> cleanup
  for (const [id, ext] of prev.extensions) {
    if (!state.extensions.has(id)) {
      // stop ping
      if (ext.pingInterval) clearInterval(ext.pingInterval)
      // reject pending requests
      for (const pending of ext.pendingRequests.values()) {
        pending.reject(new Error('Extension connection closed'))
      }
      // cancel recordings
      const relay = recordingRelays.get(id)
      if (relay) relay.cancelRecording({}).catch(() => {})
      recordingRelays.delete(id)
      // close bound playwright clients
      for (const [clientId, client] of state.playwrightClients) {
        if (client.extensionId === id) {
          client.ws.close(1000, 'Extension disconnected')
        }
      }
      logger?.log(`Extension disconnected: ${id}`)
    }
  }

  // extensions added -> start ping
  for (const [id, ext] of state.extensions) {
    if (!prev.extensions.has(id)) {
      startExtensionPing(id)
      logger?.log(`Extension connected: ${id}`)
    }
  }
})
```

## Step 6 -- Update helper functions to read from store

**File:** `src/cdp-relay.ts`

Update these functions to use `store.getState()`:

- `getExtensionConnection()` -- reads `store.getState().extensions`
- `getDefaultExtensionId()` -- reads from store
- `findExtensionIdByCdpSession()` -- reads from store
- HTTP endpoints (`/extension/status`, `/extensions/status`, `/json/list`, etc.)
- `sendToPlaywright()` -- reads `playwrightClients` from store
- `sendToExtension()` -- reads extension from store

Replace all `extensionKeyIndex.get(key)` calls with
`findExtensionByStableKey(store.getState(), key)`.

## Step 7 -- Verify integration tests pass

**Command:** `bun test relay-core.test.ts`

Run the existing integration test suite. No behavior should change. If tests fail,
debug the state transition that's wrong.

---

## Files changed summary

| File | Change |
|---|---|
| `src/relay-state.ts` | **New** -- pure state type, transition functions, derivation helpers |
| `src/relay-state.test.ts` | **New** -- unit tests for all transition functions |
| `src/cdp-relay.ts` | **Modified** -- replace scattered Maps with Zustand store, replace inline mutations with `setState()`, add `subscribe()`, update helpers |
| `package.json` | **Modified** -- add `zustand` dependency (if not already present) |

## What does NOT change

- Public `RelayServer` API (`close`, `on`, `off`)
- HTTP endpoint behavior
- WebSocket protocol (CDP messages, extension messages)
- `RecordingRelay` class (already well-encapsulated)
- `recording-relay.ts`, `protocol.ts`, `cdp-types.ts` (untouched)
- Integration test expectations

## Risks and mitigations

- **Performance**: creating new Maps on every `setState()` adds allocations. At
  the scale of a CDP relay (dozens of tabs), this is negligible. If it ever matters,
  Immer can be added for structural sharing.
- **Race conditions**: the current code has implicit ordering (mutation then send).
  With `setState()`, the ordering is the same -- `setState` is synchronous, so
  `sendToPlaywright` still runs after state is updated.
- **subscribe firing order**: Zustand `subscribe` fires synchronously after
  `setState`. Side effects in subscribe (like closing WebSockets) happen
  immediately, same as today.
