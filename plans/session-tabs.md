# Session-owned tabs, page recovery and focus plan

Three agent UX changes ported in spirit from anomalyco/browse 0.0.16: a session sees only the tabs it
created plus shared tabs, executes recover from broken pages with a clear next step, and tabs claim
focus only while a session works on them.

Check a box only when its evidence exists (test name, relay log line, commit SHA). Write the evidence
next to the box. Verify on real Chrome through the relay, not unit tests alone. Relay-only changes
must keep working with the current published extension.

## Task 1: sessions see only their own tabs and shared tabs

- [ ] The relay knows the owner of every target: tabs a session created, popups of owned tabs, and
  child targets of owned tabs. Pass when a test with two sessions shows each `context.pages()` holds
  only its own tabs plus a user-toggled tab, live and after a reconnect (`session update --patchright`).
- [ ] Commands from a client to a target it cannot see fail with a clear error. Pass when a test sends
  one and gets the error.
- [ ] A Playwright session sends no `Runtime.enable` to a Patchright session's tabs. Pass when the relay
  log of a two-session test has none on the Patchright tab.
- [ ] `skill.md` says other sessions' tabs are invisible and toggled tabs are shared.

## Task 2: events for a tab reach only clients that see it (sequential, after Task 1)

- [ ] Target events and per-session CDP events go only to clients that can see the target. Pass when
  a two-session test shows no events of session A's tab on session B's socket, and the full suite passes.

## Task 3: list real page failures (parallel with Task 1)

- [ ] Count the playwriter failures agents hit, from Kimaki transcripts and relay logs: crashed tab,
  closed `state` page, stuck main world, `chrome-error://`, debugging bar cancelled, PDF viewer,
  reattach. Pass when `docs/research_notes/page-failures.md` lists each kind with counts and one example.

## Task 4: recover from the top failures (sequential, after Task 3)

- [ ] Each failure kind Task 3 ranks high gets a recovery (reconnect, reopen the page) or an execute
  warning that names the next step, like browse `execute/page-recovery.ts`. Pass when each handled kind
  has a test that reproduces it and checks the output.

## Task 5: focus only while a session works (sequential, after Task 2)

- [ ] Attached tabs report real focus (`document.hasFocus()`) between executes, and emulated focus while
  an execute of the owning session runs, like browse `cdp/tab-activity.ts`. Pass when a test reads
  `hasFocus()` from the page during and after an execute, and keyboard and focus tests still pass.

## Done

- [ ] Two real CLI sessions in the user's Chrome (one Patchright) work in parallel without seeing each
  other's tabs, and a toggled tab shows up in both.

Decisions: `plans/decisions/session-owned-tabs.md`
