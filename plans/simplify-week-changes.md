# Simplify this week's relay changes plan

Commits on `main` since 2026-11-01 added ~3k lines. None is released yet (last release
playwriter@0.10.0, 2026-11-06), so flags and files can change with no compat cost.
Check a box only when its evidence exists (test output, `pnpm typecheck` output).

Status: Tasks 1, 3 and 4 done (uncommitted). Task 2 skipped by the user: `auto` human input stays.

## Task 1: replace saved sessions with a saved id counter (2c4265957, part of 44d489a7c, 75ae4467f)

Why: the real bug was id reuse (`-s 1` ran in another agent's new session 1). Only the counter
fixes that. Restoring executors lazily (remote re-dial, list merge, delete of not-restored
sessions, 9-field validator) is ~280 lines for a session whose `state` is lost anyway.

- [x] Delete `session-catalog.ts`, `getSessionExecutor`, `savedSessionInfo`, `createSavedSessionExecutor`,
  the saved-session branches in `/cli/sessions`, `/cli/session/:id`, `/cli/session/delete`.
- [x] Keep: ids never reused. Save only `nextSessionNumber` (one small JSON file per port, daemon only).
- [x] Keep: ownership key per session. Back to `<relayInstanceId>:<id>`, computed, no storage.
- [x] Unknown id below the counter returns: `Session N ended or was lost when the relay restarted.
  Run playwriter session new.` Drain 503 text stops promising the id is kept.
- [x] Lost: tabs of a pre-restart session are not closed by `session delete --close-tabs`. Accepted.
- [x] Rewrite the restart test in `tab-groups.test.ts` to check the new error. Evidence: `never reuses session ids across a relay restart` passes.

## Task 2: human input on/off only, default off (75ae4467f). SKIPPED by user

Why: `auto` turns 1 s mouse paths on for x.com, google, amazon and 20 more sites for every user,
before any data shows it helps. Playwriter drives a real Chrome. The stealth plan only needs off vs on.

- [ ] Remove `auto`, `BOT_PROTECTED_DOMAINS`, `isBotProtectedUrl` and its unit test.
- [x] Mode lives in an in-memory map in the relay (needed by Task 1 even with Task 2 skipped).
- [ ] Keep the 405-line `human-input.ts` pacing itself until Stealth Bench Task 4 has numbers.
  Delete it if on vs off shows no gain.

## Task 3: drop foreign-process detection in relay kill (44d489a7c)

Why: `getProcessCommandLine` (ps, /proc, PowerShell) and a name regex guard against another program
on port 19988. Rare, and a regex miss on Windows blocks the upgrade with an error.

- [x] Delete `getProcessCommandLine` and `RELAY_COMMAND_REGEX`; kill the probed pid as before this week.
- [x] Keep: `/cli/drain`, active execute count, abort on caller disconnect, `serve restart --force`.

## Task 4 (optional): drop promise-hook fault attribution (accdfcc83)

Why: a v8 promise hook with refcount, WeakMap and AsyncLocalStorage, active on every await of every
session while any execute runs, only to tag a "missing await?" warning to the right session.

- [x] Remove `retainPromiseHook` and `promiseOwners`. AsyncLocalStorage alone attributes rejections (checked on Node 18, 20, 22, 24: sync, after await, in timer, then chain). Evidence: process-guard tests pass.
- [x] Keep: process guard (relay survives agent mistakes), sandbox timer wrappers, sync log flush, rotation.

## Keep as is

- b8dba4fea Runtime.enable replay: real multi-agent bug, contained in the relay.
- 2b06431de output truncation: real bug (lost return value), simple and unit tested.
- challenge-detection.ts: Stealth Bench Task 4 measures it. Revisit after.
- Small fixes (snapshot, labels, 30 s evaluate, 64 KiB pipe, idle headless cleanup).

## Done

- [x] `pnpm typecheck` passes. Affected tests pass (tab-groups, process-guard, anti-bot, remote control). Pending changesets updated instead of new ones (unreleased). ~170 lines net removed plus `session-catalog.ts` (130).
- [ ] Full suite: 4 unrelated failures (missing chromium-1209 binary, hacker-news network, headless audio).

Decisions: none yet.
