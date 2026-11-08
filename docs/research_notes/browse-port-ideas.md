---
title: Ideas to port from anomalyco/browse
description: >
  Features, fixes and simplifications found by reading all of anomalyco/browse
  (v0.0.14, fetched 2026-11-07) and comparing it with playwriter. Ends with a
  list of proposed worker sessions with draft prompts.
---

# Ideas to port from anomalyco/browse

[anomalyco/browse](https://github.com/anomalyco/browse) is the opencode team's take on
playwriter: same relay port (19988), an `execute` tool with Playwright code, a ghost cursor,
recording, and a toolbar button. It is about 66k lines (Bun, Effect, Solid, Patchright).

Version read: `0.0.14`, `dev` branch, fetched 2026-11-07. Paths below are relative to
`cli/src/` for browse and `playwriter/src/` for playwriter unless noted.

Six research agents read every browse file by area and checked each claim against playwriter
code. Some numbers were measured (snapshot benchmark, vm rejection test, 64 KiB pipe test).
Items marked **verify** are not confirmed yet.

All proposals keep the WS protocol backward compatible. Relay-only changes need no extension
release. Extension features are gated on the existing `?capabilities=` list.

## Top 10, ranked by value / effort

| # | Item | Kind | Value | Effort |
|---|------|------|-------|--------|
| 1 | One un-awaited rejection or throwing timer in agent code kills the relay (all sessions) or MCP | fix | high | S-M |
| 2 | Relay restart reuses session ids: agent A's `-s 1` silently runs in agent B's new session | fix | high | S |
| 3 | A newer CLI kills a busy relay (and any process on 19988), wiping other agents' work | fix | high | M |
| 4 | Screenshot labels are misplaced or missing after the page scrolls | fix | high | S |
| 5 | Output truncation drops the return value when console logs are long | fix | high | S |
| 6 | Flat 30 s extension timeout breaks `waitForFunction` / long `evaluate` | fix | med-high | S |
| 7 | `Runtime.enable` from a second client destroys other clients' execution contexts | fix | high | M |
| 8 | Logs store typed passwords, cookies and auth headers in 0644 files | fix | high | S |
| 9 | `handoff()`: give the tab to the user, continue on a trusted Continue click | feature | high | M |
| 10 | Snapshot shows no element state and dumps 1 MB on big pages | feature | high | S-M |

## 1. Crash resilience (relay, MCP, executor)

### 1.1 Unhandled rejections from agent code kill the relay

- **browse**: `relay/process-guard.ts`, `relay/process-faults.ts` (`handleRelayProcessFault`,
  `isBenignClosedSessionRejection`), `execute-realm/membrane-policy.ts` (`retainPromiseHook`),
  `execute/rejection-scope.ts`. Promise hooks tag promises created by an execute call, so a
  rejection is reported as a warning on that call. Benign Playwright "session closed" faults
  are counted, logged once a minute, shown in `status` and `doctor`.
- **playwriter today**: `start-relay-server.ts:11-19` and `cli.ts:1958-1966` call
  `process.exit(1)` on `unhandledRejection` and `uncaughtException`. `mcp.ts` has no handler,
  so Node's default crashes it. A vm script proved the rejection reaches the host handler.
  `state.page.click('#missing')` without `await` kills every session after 60 s. The execute
  timeout `abortController.abort()` makes this more likely.
- **verified live** (2026-11-07, `serve` on port 19951, headless session): both
  `state.p.click('#missing', { timeout: 500 })` without `await` and
  `setTimeout(() => { throw new Error('boom') }, 200)` killed the relay within 2 s. The
  "Unhandled Rejection" line never reached `relay-server.log` (confirms 1.3). Side finding:
  the auto-spawned relay ignores `PLAYWRITER_PORT` because `start-relay-server.ts` calls
  `startServer()` with the default port 19988.
- **change**: log, count, continue on `unhandledRejection`. Keep `uncaughtException` fatal
  unless the stack is from sandbox code or playwright-core. Optional attribution via
  `v8.promiseHooks` + `AsyncLocalStorage`, installed only while an execute runs, then
  `enqueueWarning` on the owning executor. Regression test: un-awaited rejection, then a second
  execute that must succeed.

### 1.2 Agent timers leak and can crash the relay

- **browse**: `execute-realm/globals.ts` wraps `setTimeout`/`setInterval`, tracks ids per realm,
  clears them on reset/dispose, and turns a throwing callback into a realm reset.
- **playwriter today**: `usefulGlobals` (`executor.ts:133-149`) passes host timers. `reset()`
  never clears them. A throwing callback is an `uncaughtException`, so the relay exits.
- **change**: wrapped timers in `executor.ts`, a `Set` of ids, try/catch to `enqueueWarning`,
  clear in `clearExecutionState`. Effort S.

### 1.3 The fatal crash log is lost, and restarts erase the old log

- **browse**: `relay/log.ts` sync append, 1 MB rotation to `.1`.
- **playwriter today**: `create-logger.ts` buffers 500 ms, so `await logger.error(...)` then
  `process.exit(1)` loses the line. `createFileLogger` truncates on start, and the CLI restarts
  the relay automatically, so the previous crash log is gone. `relay-server.log` has no size cap.
- **change**: flush or `appendFileSync` in fatal handlers, rename old log to `.1`, add a size cap.

### 1.4 Sync CPU limit only covers the first slice (idea, not now)

browse runs each realm entry under `runInContext({ timeout })` with
`microtaskMode: "afterEvaluate"` and a ~800 line proxy membrane. In playwriter,
`await x; while (true) {}` freezes the relay forever. Too big to port. Document the limit.

## 2. Relay restarts and session persistence

### 2.1 Session ids restart at 1 after every relay restart

- **playwriter today**: `cdp-relay.ts:2216` `let nextSessionNumber = 1`. The relay restarts on
  every CLI version change. `/cli/execute` never checks ownership.
- **change**: persist the highest id in `~/.playwriter/` (atomic 0600 write like
  `persistCloudSessions`). Effort S. Superseded by 2.2.

### 2.2 Sessions survive relay restarts

- **browse**: `session-manager/catalog.ts` (atomic fsync write, corrupt file moved aside),
  `session-manager.ts` `restore()`, `sweepOrphanedRelayTargets()`. Named sessions are never
  reaped; auto-named ones are.
- **playwriter today**: sessions live in `ExecutorManager` memory. After a restart every agent
  gets `Session N not found`. `ownershipKey = relayInstanceId:sessionId` (`cdp-relay.ts:125`)
  changes per start, so `closeTabsForKey` cannot find tabs created before the restart.
- **change**: persist `{id, kind, tabGroup, color, cwd, browser stableKey, ownershipKey}` to
  `~/.playwriter/sessions.json`. Use a stable UUID ownership key (opaque to the extension, no
  protocol change). Recreate the executor lazily and warn "relay restarted, state was cleared,
  your tabs: ...". Skip direct, cdp and cloud sessions. Effort M.

### 2.3 Do not kill a busy relay on upgrade; drain first

- **browse**: `session-manager/admission.ts` (`beginDrain`, `withAdmission`),
  `relay/shutdown.ts` (shutdown bound to `instanceId`, 409 if changed, busy reasons, `--force`),
  `relay/lifecycle.ts` `isSameRelayInstance`. `/version` returns `instanceId`, `pid`, `buildId`.
- **playwriter today**: `relay-client.ts:289-296` kills an older relay by port as soon as any
  newer client runs. Racing clients can kill the relay the other just started. A port holder
  that does not answer `/version` is killed even if it is not playwriter.
- **change**: `/version` adds `instanceId`, `pid`, `activeExecutes`, `sessions`.
  `POST /cli/shutdown {drain, timeoutMs}` refuses new executes with 503, waits up to ~30 s,
  persists sessions, exits. CLI calls it, falls back to kill on 404. Kill only the probed pid,
  check the process command line first. `serve restart` refuses while busy unless `--force`.

### 2.4 Abort the script when the CLI caller disconnects

- **browse**: `session-manager/execution.ts` `Effect.onInterrupt` stops the script.
- **playwriter today**: `/cli/execute` ignores request abort, so a Ctrl-C or agent bash
  timeout leaves the script running and the session locked by `runExclusive`.
- **change**: pass `c.req.raw.signal` into `executor.execute` (**verify** `@hono/node-server`
  aborts it on socket close).

### 2.5 One-shot execute `--rm`

`playwriter --rm -e '...'` creates a session, runs, deletes with `closeCreatedTabs`. Effort S.

## 3. CDP layer correctness

### 3.1 Per-method extension timeouts

- **browse**: `relay/rpc.ts` `awaitsPagePromise`: 5 min for `Runtime.evaluate`/`callFunctionOn`
  with `awaitPromise`, 60 s other debugger commands, 4 s ping, 15 s extension commands.
- **playwriter today**: `sendToExtension` (`cdp-relay.ts:389`) uses 30 s for every command, so
  `page.waitForFunction(fn, {timeout: 60000})` fails at 30 s with "Extension request timeout".
- **change**: pick the timeout from the method and `params.awaitPromise`. Relay only. Effort S.

### 3.2 Cache `Runtime` context events per session

- **browse**: `cdp/runtime.ts` `CdpRuntime` replays cached `executionContextCreated` to a new
  client only, cycles disable/enable only if no default context arrives within 3 s, refcounts
  disable.
- **playwriter today**: `extension/src/background.ts:1480` does `Runtime.disable` +
  `Runtime.enable` for every `Runtime.enable`. Chrome re-emits contexts to all clients;
  Playwright's `_contextCreated` destroys the old context, so another session's in-flight
  `evaluate` fails with "Execution context was destroyed". Happens on every `session new`.
- **change**: relay caches context events per CDP sessionId; first enable forwards, later ones
  replay to that client and return `{}`. Clear on detach, crash, reattach. Old extensions are
  unaffected (fewer commands). Test: two clients on one tab, evaluate during second connect.

### 3.3 Detect an unresponsive extension

- **browse**: `relay/rpc.ts` liveness probe, `housekeeping.ts` stops executions with "browser
  isn't responding (asleep or frozen?)".
- **playwriter today**: `startExtensionPing` sends pings, the `pong` handler does nothing.
- **change**: track `lastMessageAt`, mark unresponsive after ~10 s silence, reject pending
  requests with a clear message, show in `/extensions/status`.

### 3.4 Smaller CDP fixes (verify each first)

- `Inspector.targetCrashed` is not handled, only `Target.targetCrashed` (`cdp-relay.ts:1810`).
- bfcache `goBack`: browse sends synthetic `Page.lifecycleEvent` after
  `frameNavigated type: BackForwardCacheRestore` (`relay/extension-events.ts:557`).
- Hung background screenshots: browse "nudges" with 1x1 captures (`cdp-dispatch.ts`).
- `data:` URL navigation through the extension: browse writes the content into `about:blank`.
- `about:blank#fragment` crash claim (`src/background/agent-relay/debugger.ts`).

### 3.5 Focus emulation only while a session is active (idea)

Playwright enables `setFocusEmulationEnabled(true)` per frame; the relay forwards it, so
attached user tabs always report `document.hasFocus() === true`. browse
(`cdp/tab-activity.ts`) enables it only while a script runs on the tab. Effort M.

### 3.6 Session-scoped target visibility (idea, L)

browse `cdp/visibility.ts`: tabs a session created are visible only to that session. Would
remove N x M page init and much of 3.2. `context.pages()` semantics change.

### 3.7 Reap idle extension sessions' CDP clients (idea)

Disconnect the executor's browser after N hours idle, reconnect lazily, warn about stale
`state.page`. Uses the existing `idleTimeMs`.

## 4. Execute output and ergonomics

### 4.1 Truncation keeps the return value

- **browse**: `execute/log-capture.ts` (folds repeats into `repeatCount`, caps logs),
  `execute/result-formatting.ts` `boundExecuteResult` (precise hint to write large data to a file).
- **playwriter today**: `executeInternal` (`executor.ts:1917-1956`) joins warnings, logs and
  return value, then keeps the first 10k chars. A logging loop then `return summary` loses the
  summary. `mcp.ts:279-287` truncates a second time.
- **change**: fold identical log lines (`(x37)`), give logs ~60% with head and tail, always
  append the return value, truncate once.

### 4.2 Returned image Buffers become images

`extractExecuteMedia` detects PNG/JPEG/WebP buffers anywhere in the return value. playwriter
prints `<Buffer 89 50 4e 47 ...>`. Route them through `resizeImageForAgent` and the image
collector, cap at 3.

### 4.3 Clean error stacks and Node-vs-page hints

Keep the message plus `.playwriter-eval.js` frames only (`code-runner.ts` `userCodeStack`).
Add hints: "`document` is undefined, use page.evaluate", "<div> intercepts pointer events:
dismiss the overlay, do not retry the same click". Relay log keeps the full stack.

### 4.4 Re-bind `state.page` when the same tab re-attaches

`execute/default-page.ts`: after a PDF, extension frame or SW restart, the Page closes but the
target id returns. Record `page.targetId()` on close, re-bind keys at the next execute, warn.
Add a PDF hint when `contentType === 'application/pdf'`.

### 4.5 Smaller items

- WebMCP helper `webmcp.list/call` (`execute/webmcp.ts`). Low value now.
- Zoom guard warning and "addInitScript is visible to the page" warning (`guards.ts`).
- Patchright mode: `getLatestLogs` is silently empty; add opt-in console capture
  (`execute/console.ts`). Patchright `count()`/`all()` slowness fix belongs in the
  `patchright-playwriter` fork (`execute/patchright-tuning.ts`: 650 ms to 9 ms).
- CLI output over 64 KiB is cut by `process.exit(1)` after `console.error` on a pipe (tested on
  macOS: 65536 bytes). Use `process.exitCode = 1` and return.

## 5. Snapshots, screenshots, ghost cursor

Benchmark (5k-row table, direct CDP): playwriter `getAriaSnapshot` ~1,700 ms, ~1 MB output
(`interactiveOnly` same size), 6.9 MB `getFlattenedDocument` + 25 MB AX tree. browse
`browserCapture` ~30 ms, 80 prioritized entries. Do not adopt browse's heuristic engine (it
computes names by hand and lacks OOPIF support); take the budget ideas.

| Item | browse | playwriter today | Effort |
|------|--------|------------------|--------|
| Labels scroll bug | `position: fixed`, viewport coords | `a11y-client.ts` absolute container + `scrollY`, but `DOM.getBoxModel` is viewport-relative | S |
| Screenshot refs | labels register into the ref registry | `screenshotWithAccessibilityLabels` never sets `lastRefToLocator`; `eN` can point elsewhere | S |
| Element state | `[checked] [disabled] [expanded] [level=2]` | `buildRawSnapshotTree` drops AX `properties` | S |
| `search` bugs | resets `lastIndex`, case-insensitive, "N matches" | `/g` regex skips matches, case-sensitive, silent cap at 10 | S |
| Budgeted output | priority + `maxItems`, collapsed nav | full tree then blind 10k slice | M |
| Table collapse in interactive mode | inline row names | rows, cells kept by `CONTEXT_ROLES` | S-M |
| Screenshot legend | `labels: [{ref, role, text, context}]` for visible items | full interactive snapshot appended in `mcp.ts`/`cli.ts` | S-M |
| Modal auto-scope | scope to single open modal | manual `locator` | S |
| Duplicate refs | css path `.and(getByRole)`, fail on drift | `>> nth=N`, shifts on insert | M |
| One DOMSnapshot call | n/a | `getFlattenedDocument` + N x `getBoxModel` | M |
| Draw labels onto PNG | `drawScreenshotLabels` | labels are page DOM, show in recordings | M |
| `screenshotDiff` | pixelmatch helper | none | S |
| Settle / retry on mid-capture navigation | `needsSettle`, 3 retries | throws "Page navigated while..." | S |

Ghost cursor:

- **Cursor lags the click**: browse awaits the cursor animation (2 s cap) before forwarding
  input. playwriter's `GhostCursorController` is fire-and-forget although the fork's
  `mouseActionRequest` ack exists for this. Await arrival at least while recording. Port the
  arc + spring motion (`ghost-cursor/client-motion.ts`).
- **Page-visible artifacts**: playwriter injects the cursor in the main world
  (`window.__playwriterGhostCursor`), sets `globalThis.__a11y`, adds a screenshot style and html
  class. browse draws in an isolated world in a closed shadow root. Needs extension release
  first. Effort L.

## 6. Anti-bot: challenge detection and human-like input

### 6.1 Bot challenge detection after navigation

- **browse**: `execute/challenge-detection.ts` (`probePageScript`, pure `classifyChallenge`),
  `code-runner.ts` `detectChallenge`. Vendors: Cloudflare, Akamai, DataDome, PerimeterX,
  Imperva, AWS WAF, reCAPTCHA, hCaptcha, generic (only on pages under 1,500 chars). Kinds:
  non-interactive (wait up to 15 s), interactive (recommend handoff), block (stop). Warns not
  to reload, which worsens the block for the user's IP.
- **change**: new `challenge-detection.ts`, probe only pages whose main frame navigated during
  the call, report via `enqueueWarning`, skill.md rule. Fixture-based inline snapshot test.

### 6.2 Human-like input in the relay

- **browse**: `execute/human-input.ts`: per-tab queue, Bezier path with minimum-jerk speed,
  Fitts' law duration, tremor, 25% overshoot, 2 px off center, 45-130 ms before press,
  30-110 ms between keys, wheel bursts. Key lesson in `pace()`: Chrome can hold pointer-event
  replies ~1 s on background tabs, so wait for reply or gap, whichever is first.
- **change**: intercept `Input.dispatchMouseEvent`/`KeyEvent` and `DOM.scrollIntoViewIfNeeded`
  in `cdp-relay.ts`, send extra moves through `sendToExtension`. Env toggle
  `PLAYWRITER_HUMAN_INPUT`. Off in tests. Old extensions work (same commands).

### 6.3 Stealth probe harness (idea)

`stress/stealth/probe.html` + `run.ts`: local probe of CDP-input tells plus public detectors
(sannysoft, CreepJS, rebrowser, reCAPTCHA v3 score). Port as a manual script to compare the
default fork, `--patchright` and human input. Never in CI.

## 7. Security and privacy

| Item | browse | playwriter today | Effort |
|------|--------|------------------|--------|
| Redact logs, 0600 files, 0700 dir | `session-manager/journal.ts` `redactJournalText` (bounded regex) | `executor.ts:1279` logs raw code; `cdp.jsonl` keeps `Input.insertText` text and Cookie/Authorization headers; files 0644 | S |
| Relay token for local HTTP and CDP | `relay/secrets.ts`, token in `/json/version` URL | token only in `serve` mode; any local user can `POST /cli/execute` | M |
| Env allowlist for relay and sandbox `process.env` | `relay/lifecycle.ts` `relayEnvironment` | `relay-client.ts:333` spawns with full env; sandbox exposes it | S |
| Constant-time token compare, `::ffff:127.0.0.1` loopback | `secretsEqual`, `isLocalPeer` | `===`, misses mapped addresses | S |
| Extension pairing (ECDH + HMAC) | `relay/browser-pairing.ts`, `extension-handshake.ts` | extension trusts any process on 19988 | L |
| Read-only sessions (reject `Input.*`, navigation) | `cdp/guardrails.ts` `readOnlyAllowedMethods` | none; hook point exists in `routeCdpCommand` | S-M |
| Opt-in CDP guardrails | cookie scoping, refuse cache clears, WebAuthn, permission grants | removed on purpose in `e486f8791` | S |

Note: `MEMORY.md:223` still says the relay blocks `Network.clearBrowserCookies`. That is stale.

playwriter `execute` has full Node access, so secrets, read-only and allowlists stop mistakes
and keep values out of transcripts. They do not stop hostile code. Say so in docs.

## 8. Handoff, badges, secrets, network capture

### 8.1 `handoff()` to the user

- **browse**: `session-manager/handoff.ts` (`HandoffRegistry`, `holdCompletion` for a blocking
  `start` click like passkeys), `relay/tab-presentation.ts`, `src/content/page-status.ts`
  (card as top-layer popover in a closed shadow root, re-raised on fullscreen and dialogs, only
  `isTrusted` clicks), `src/background/handoff-notice.ts` (system notification while recording).
  The execute deadline pauses while waiting. A toolbar click finishes a handoff, else stops the
  running script, else toggles the tab.
- **playwriter today**: no handoff. Reusable: closed-shadow toolbar (`toolbar.ts`),
  `isTrustedToolbarClick`, capability negotiation, the recorder's toggle routes.
- **change**: `handoff({ page, message, timeoutMs })` in executor, relay registry, new
  extension method gated on a `handoff` capability ("update the extension" otherwise), card in
  `toolbar.ts`, RUN/WAIT badge, icon menu "Continue". v1 without deadline pausing. Avoid the
  `notifications` permission (would disable the extension on update until approved).

### 8.2 Site secrets `secrets.type(locator, name)` + TOTP

`auth/site-secrets.ts`, `execute/secrets-bridge.ts`: checks the field's frame URL against the
secret's origins, types with `keyboard.insertText`, registers the value for redaction first,
returns `{typed, name, origin}`. Depends on 7 (log redaction). Effort M.

### 8.3 Network capture to a redacted HAR

`network-capture.ts`, `network-capture/redaction.ts` (`SecretCollector`, ~480 lines, no Effect
dependency), `har-redaction.ts` (`summarizeEndpoints`: up to 30 routes with keys). Credentials
become `${BC_SECRET_N}`. Replaces skill.md's raw `page.on('request')` advice. Effort M.

### 8.4 Per-session domain allowlist (low, L)

`auth/domain-policy.ts`, `session-manager/navigation-guard.ts` with DNS-rebinding checks. Only
worth it with 8.2.

## 9. Extension

| Item | browse | playwriter today | Effort |
|------|--------|------------------|--------|
| Restore the user's active tab after an agent `_blank` popup | `agent-relay/popups.ts` `adoptOpened` | `onCreatedNavigationTarget` only maps source tab; **verify** Chrome activates the tab | S |
| Never open a focused window; normal windows only | `agent-relay/window.ts` | `getPreferredWindowId` has no `windowTypes` filter; zero windows makes a focused one | S |
| Cap reply size instead of losing the WS (1009) | `agent-relay/wire.ts` `MAX_MESSAGE` | `sendToLocalRelay` sends any size; `ws` 100 MiB limit closes the socket | S |
| Do not close tabs the user lent | `grouping.ts` `ungroup` | `Target.closeTarget` removes any tab | S |
| Update icons only for the changed tab | `index.ts` `updateBadges([tab])` | `updateIcons()` queries all tabs on every `onUpdated` (~400 calls with 100 tabs) | S |
| Log only slow or failed CDP commands | `commands.ts` `SLOW_CDP` | every command logged and sent over WS | S |
| Ownership check with `Target.getTargetInfo` | `debugger-hub.ts` `ownedByUs` | `getTargets().attached` (MEMORY says unreliable) | S |
| Explicit SW keepalive | `getPlatformInfo()` on ping | hidden dependency on `updateIcons` API calls | S |
| Second icon click cancels a pending attach | `agent-relay.ts` `pendingAttach` | "connecting" tabs ignore clicks | S |
| Browser restart: clear owned ids, ungroup restored groups | `tab-cleanup.ts` `onStartup` | `ownedTabIds` survive; restored grouped tabs auto-attach (**verify**) | S-M |
| Ungroup before close (saved group bug) | `closeAgentTab` | direct `tabs.remove` | S |
| Idle agent tab cleanup with `chrome.alarms` | `tab-cleanup.ts` | none | M |
| Re-attach same tabs after extension reload / SW restart | `debugger-hub.ts` `persist`/`restore` (URL must match) | store is memory only, reload drops all tabs | M |
| Collapse agent groups, keep them first | `agent-relay/groups.ts` | no collapse or move; opt-in | M |
| Separate unfocused agent window | `agent-relay/window.ts` (never minimize: screenshots hang) | none | M |
| Diagnostics ring buffer in `storage.session` | `agent-relay/log.ts` | logs lost when relay is down | S-M |
| Toolbar in top layer, re-raised | `content/page-status.ts` popover | fixed host, covered by dialogs and fullscreen | M |

## 10. MCP, CLI, update, recording, tests

- **MCP connects before the relay is ready**: `mcp.ts:369-392` awaits
  `ensureRelayServerForMcp()` (worst case ~30 s) before `server.connect`; a failure exits with
  no message. browse registers tools first and returns relay errors as tool errors
  (`cli/test/mcp-protocol.test.ts`). Effort S.
- **Update notice**: browse `update/auto-update.ts` reads the npm dist-tag (abbreviated
  metadata), caches hourly, adds one note per MCP server (`withUpdateNote`). playwriter only
  warns when the extension is newer. Add a daily cached check in the relay, expose `latest` on
  `/version`, `enqueueWarning` once. Opt-out env. Effort S.
- **`playwriter doctor [--json]`**: relay vs CLI version, extension status and version, port
  holder, ffmpeg encoder, Chrome on 9222, npm latest, log paths, fault count. Effort S-M.
- **Exit code 4 for relay/extension unreachable** (`cli/output.ts` `ExitCode`). Low.
- **Flight recorder**: `recording-relay/flight-recorder.ts` keeps JPEG frames with timestamps
  (60 s, 128 MB, 7200 frames caps) and `saveLast` encodes a window. Reuse `PageCapture` and
  `mergeScreencastParams`. Encode with timestamped MJPEG in Matroska
  (`mjpeg-matroska.ts`, ~100 lines EBML). Effort M.
- **Screenshot fallback when screencast sends no frames** (`screencast.ts`
  `startScreenshotFallback`): playwriter repeats the last frame forever. Effort S.
- **MCP as thin relay client** (simplification, L): `mcp.ts` builds its own executor; the CLI
  uses the relay's. Moving MCP to `/cli/session/new` + `/cli/execute` gives one code path, MCP
  access to headless/cloud/tab groups, and makes a hot-swap supervisor
  (`mcp/supervisor.ts`) possible later.
- **Shrink the always-loaded prompt** (idea): `execute` description is 53 KB of
  `dist/prompt.md`. browse sends ~600 tokens of initialize instructions and a `skill` command.
  Needs evals before changing. Add MCP tool annotations.
- **Old-extension compatibility test lane**: browse `stress/installed.ts` tests the released
  zip. playwriter tests always build the working tree, so nothing tests the AGENTS.md
  compatibility rule. Download the last `extension@*` release zip and run a core subset.
- **Release artifact check**: `scripts/check-artifacts.ts` + `store/permissions.json`:
  permission allowlist, no test port, no `key`, npm pack sanity. Effort S.
- **Fuzz and chaos soak** (`stress/fuzz.ts`, `stress/soak.ts`): later.
- **Calling-agent detection** (`setup/agent-config.ts` `callingAgent`) for telemetry. Low.

## Skip: playwriter already does this or it does not fit

- Auto-return, abort of running Playwright calls on timeout, downloads support.
- Diff since last snapshot, refs invalidated on navigation, OOPIF scoping, test-id locators,
  shadow DOM piercing, image resize for LLMs.
- Multi-browser per relay, origin allowlist, Host and Sec-Fetch checks, capability detection,
  EADDRINUSE race recovery, popup relocation, other-extension frame removal.
- Screencast to mp4 without offscreen (playwriter's is more complete: hardware encoders,
  audio, RTMP), atomic recording writes, stable tool descriptions, 2 tools vs 18.
- `demonstrate()` (playwriter has the action recorder), `fillInput` synthetic fallback.
- Proxy-membrane sandbox realm, `files` helper: large, not a security boundary.
- Chrome API stub tests (conflicts with the no-mocks rule; extract pure planners into
  `protocol.ts` instead). File-size and folder-shape lint (conflicts with "avoid tiny files").
- XDG path migration, MCP config writer for 30 agents, secret profiles + `secrets run`.
- `autoDiscardable:false` (debugger attach already blocks discarding).

## Proposed worker sessions

Ordered by priority. Each is one coherent task. All must follow AGENTS.md: changeset per
change, manifest bump for extension edits, backward compatible WS protocol.

### Tier 1: fixes, relay only

**S1. Relay and MCP crash hardening**

> Read `docs/research_notes/browse-port-ideas.md` sections 1.1 to 1.3. Make the relay and
> MCP survive agent mistakes: an un-awaited rejecting Playwright call or a throwing
> `setTimeout` callback in execute code must not exit the process. In `start-relay-server.ts`,
> `cli.ts` serve and `mcp.ts`, log with rate limit, count, continue on `unhandledRejection`;
> keep `uncaughtException` fatal unless the stack is sandbox or playwright-core. Wrap sandbox
> timers in `executor.ts` (track ids, clear on reset, catch throws into `enqueueWarning`).
> Attribute rejections to the running executor if simple (`v8.promiseHooks` only while an
> execute runs; see browse `execute-realm/membrane-policy.ts`). Fix `create-logger.ts` so
> fatal lines are flushed, rotate the old log to `.1` instead of truncating, add a size cap.
> Add one regression test: un-awaited rejection then a second execute that succeeds.

**S2. Sessions survive relay restarts**

> Read section 2.1 and 2.2 of `docs/research_notes/browse-port-ideas.md`. Today
> `nextSessionNumber` restarts at 1 and sessions live only in memory, so after a relay
> restart agent A's `-s 1` can run in agent B's new session. Persist extension and remote
> sessions to `~/.playwriter/sessions.json` (atomic 0600 write) with a stable UUID
> ownership key instead of `relayInstanceId:sessionId`. Recreate executors lazily on first
> `/cli/execute` and warn that `state` was cleared, listing tabs matching the key. Never
> reuse ids. Reference: browse `session-manager/catalog.ts`. Test the restart flow.

**S3. Safe relay upgrades**

> Read section 2.3 and 2.4 of `docs/research_notes/browse-port-ideas.md`. A newer CLI
> kills an older relay by port even while other agents execute, can kill a relay a racing
> client just started, and can kill a non-playwriter process on 19988. Add `instanceId`,
> `pid`, `activeExecutes`, `sessions` to `/version`; add `POST /cli/shutdown` that drains
> (503 for new executes, wait ~30 s); kill only the probed pid after checking its command
> line; `serve restart` refuses while busy without `--force`. Fall back to today's behaviour
> for old relays. Also abort a running execute when the `/cli/execute` request is aborted.
> Reference: browse `relay/shutdown.ts`, `relay/lifecycle.ts`,
> `session-manager/admission.ts`. Depends on S2 for persisting sessions before exit.

**S4. CDP correctness in the relay**

> Read section 3 of `docs/research_notes/browse-port-ideas.md`. In `cdp-relay.ts`:
> (1) per-method timeouts in `sendToExtension` (5 min for `awaitPromise` evaluates, 60 s
> other CDP); (2) cache `Runtime.executionContext*` events per CDP session so a second
> client's `Runtime.enable` is answered from cache instead of the extension's disable+enable
> cycle that destroys other clients' contexts; (3) mark an extension unresponsive after ~10 s
> without messages and fail pending requests clearly; (4) verify and fix
> `Inspector.targetCrashed` and bfcache `goBack`. Reference: browse `relay/rpc.ts`,
> `cdp/runtime.ts`, `relay/extension-events.ts`. Add a two-client test for (2).

**S5. Execute output quality**

> Read section 4 of `docs/research_notes/browse-port-ideas.md`. In `executor.ts` and
> `mcp.ts`: never drop the return value on truncation (fold repeated log lines, budget logs
> head+tail, truncate once); return image Buffers as images via `resizeImageForAgent`;
> keep only user frames in error stacks and add Node-vs-page and pointer-intercept hints;
> re-bind `state.*` pages by `targetId` when the same tab re-attaches; fix CLI output
> truncation past 64 KiB (`process.exitCode` instead of `process.exit`); add `--rm`.
> Reference: browse `execute/result-formatting.ts`, `log-capture.ts`, `default-page.ts`.

### Tier 2: snapshot and security

**S6. Snapshot and screenshot labels quality**

> Read section 5 of `docs/research_notes/browse-port-ideas.md`. Fix labels after scroll
> (`a11y-client.ts` uses absolute + scrollY but `DOM.getBoxModel` is viewport-relative);
> make `screenshotWithAccessibilityLabels` set `lastRefToLocator`; add element state
> (`[checked] [disabled] [expanded] [level=N]`) from AX properties; fix `search` (`lastIndex`,
> case-insensitive, "N matches" header); add a line budget with collapsed same-role runs
> and table collapse in `interactiveOnly`; return a compact legend of labelled refs instead
> of the full snapshot after labelled screenshots; auto-scope to a single open modal.
> Measure with the 5k-row fixture before and after. Reference: browse `snapshot/*`.

**S7. Local security hardening**

> Read section 7 of `docs/research_notes/browse-port-ideas.md`. Redact credentials in
> `relay-server.log` and `cdp.jsonl` (raw execute code, `Input.insertText`, cookie and auth
> headers; port browse `redactJournalText` with bounded regex), create log files 0600 and
> `~/.playwriter` 0700; spawn the relay with an env allowlist and filter sandbox
> `process.env`; constant-time token compare; accept `::ffff:127.0.0.1`. Then add a local
> relay token file (`~/.playwriter/relay-token`, 0600) required by `/cli/*` and `/cdp`,
> read by CLI, MCP and `getCdpUrl`. Fix the stale `MEMORY.md:223` line. Ask before the token
> step since it breaks direct `connectOverCDP` scripts.

### Tier 3: features

**S8. handoff() with Continue card and RUN/WAIT badge**

> Read section 8.1 of `docs/research_notes/browse-port-ideas.md`. Add
> `handoff({ page, message, timeoutMs })` to the executor. Relay keeps a registry keyed by
> session; it sends a new extension method only when the extension reports a `handoff`
> capability, else fails with "update the extension". Extension shows a card in
> `toolbar.ts` (closed shadow root, `isTrustedToolbarClick`), RUN/WAIT badge, icon menu
> "Continue", and a toolbar click on a busy tab stops the script. No new permissions.
> Ship the extension side first; bump manifest; changeset; skill.md section.

**S9. Bot challenge detection and human-like input**

> Read section 6 of `docs/research_notes/browse-port-ideas.md`. (1) Port browse
> `execute/challenge-detection.ts` as a pure classifier plus probe; run it only on pages
> that navigated during an execute; wait for non-interactive checks within the remaining
> timeout; report via `enqueueWarning`; skill.md rule never to reload a blocked page.
> Fixture inline-snapshot test. (2) Human-like input in `cdp-relay.ts` for
> `Input.dispatchMouseEvent`/`KeyEvent`, opt-in via `PLAYWRITER_HUMAN_INPUT`, using browse
> `execute/human-input.ts` (note the background-tab `pace()` lesson). Optionally a manual
> stealth probe script.

**S10. Extension focus and tab hygiene**

> Read section 9 of `docs/research_notes/browse-port-ideas.md`. In
> `extension/src/background.ts`: restore the user's active tab after an agent `_blank`
> popup (add a test in `popup-relocation.test.ts`); only use normal windows and never
> create a focused one; cap reply size instead of losing the WS; do not close tabs the user
> lent; update icons only for the changed tab; log only slow or failed CDP commands;
> `Target.getTargetInfo` ownership check; explicit keepalive; second click cancels a
> pending attach; on `runtime.onStartup` clear owned ids and ungroup restored groups;
> ungroup before close. Bump manifest, changeset.

**S11. Extension lifecycle: idle cleanup and re-attach after reload**

> Read section 9 of `docs/research_notes/browse-port-ideas.md`. Track agent-created tabs in
> `storage.session`, close idle ones with `chrome.alarms` (default 30 min or opt-in, skip
> active, audible, recording tabs); persist attached tabs `{tabId, url, group}` and
> re-attach them after an extension reload or SW restart when the URL still matches; add a
> diagnostics ring buffer flushed to the relay after handshake. Depends on S10's
> `createdByAgent` flag.

**S12. MCP startup, update notice, doctor**

> Read section 10 of `docs/research_notes/browse-port-ideas.md`. Connect the MCP stdio
> transport before the relay is ready and turn relay failures into tool errors; add a
> daily cached npm `latest` check in the relay, exposed on `/version`, shown once via
> `enqueueWarning`; add `playwriter doctor [--json]`; exit code 4 when relay or extension is
> unreachable. Reference: browse `mcp.ts`, `update/auto-update.ts`, `doctor.ts`.

**S13. Flight recorder and screencast fallback**

> Read section 10 of `docs/research_notes/browse-port-ideas.md`. Add
> `flightRecorder.start({ page, retentionMs })` / `saveLast({ path, durationMs })` reusing
> `PageCapture` in `screen-recording.ts`, with hard caps; encode via timestamped MJPEG in
> Matroska (browse `recording-relay/mjpeg-matroska.ts`). Add the screenshot fallback when
> the screencast sends no frames for 1.5 s. Make the ghost cursor await arrival before the
> click while recording.

**S14. Compatibility test lane and release checks**

> Read section 10 of `docs/research_notes/browse-port-ideas.md`. Add an env-gated test
> lane that loads the last `extension@*` GitHub release zip and runs connect, session new,
> execute, snapshot, recording against the current relay. Add a release check script:
> manifest permission allowlist, no test port or `key` in the zip, npm pack contains
> `dist/prompt.md`.

Later, only if wanted: network capture to redacted HAR (8.3), site secrets (8.2), MCP as thin
relay client (10), read-only sessions (7), separate agent window and group collapse (9).
