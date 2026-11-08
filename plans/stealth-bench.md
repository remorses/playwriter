# Stealth Bench for playwriter plan

Measure how often anti-bot systems block playwriter, on Browser Use's open Stealth Bench V1
(github.com/browser-use/benchmark), next to the published cloud browser numbers. Compare
human input off and on (`session new --human-input off|on`), and record time and steps per task.

Check a box only when its evidence exists (command output, results JSON path, screenshot).
Write the evidence next to the box.

Constraints for every task:

- Same agent and judge as the official runs (browser-use 0.11.5, `bu-2-0`, legacy Gemini judge),
  else the numbers do not compare. Official baseline: local_headful 39/80, 56 s and 8.8 steps per task.
- Never publish or commit decrypted tasks. Results JSON and screenshots stay private.
- Set `ANONYMIZED_TELEMETRY=false` (browser-use sends PostHog telemetry by default).
- Never use the user's everyday Chrome profile unless Task 5 is approved. Use a separate relay port.
- Concurrency 1 for playwriter runs (one extension, one window).

## Task 1: browser-use can drive playwriter's relay (riskiest unknown)

- [ ] A browser-use Agent connected to the relay CDP endpoint (`/json/version`, `/cdp/:clientId`)
  opens a tab, navigates, clicks and types on one harmless site, in a Chrome for Testing profile
  from `playwriter browser start`. Pass when the agent run ends with no CDP error and the relay
  log shows its commands.
- [ ] List every CDP method browser-use sends that the relay rejects or mishandles. Fix in the
  relay only what blocks the run. Pass when the list is empty or each item has a fix.

## Task 2: reproduce the official baseline on this machine and IP

- [ ] Run `--benchmark Stealth_Bench_V1 --browser local_headful` on 10 tasks, then all 80.
  Pass when the score is near the published 39/80 (the IP and date change it; record both).

## Task 3: playwriter provider (after Task 1)

- [ ] A `playwriter` provider for the runner, kept in this repo under `benchmarks/stealth-bench/`
  with a README of the exact command. Pass when `--browser playwriter --tasks 3` completes.

## Task 4: full runs, clean profile (after Tasks 2 and 3)

- [ ] 80 tasks with human input off, then 80 with human input on, same profile, same IP, same day.
  Pass when both results JSON files exist with 0 unscored tasks.
- [ ] Count the `[WARNING] Bot challenge` lines against the judge's blocked verdicts. Pass when
  the agreement rate is written down; it checks our challenge detection on real sites.

## Task 5: warm real profile (needs user approval)

- [ ] Same two runs on a copy of the user's real profile. Pass when results exist and are reported
  separately from Task 4 (clearance cookies and account reputation change verdicts).

## Done

- [ ] `docs/` report: one table with success by category, seconds and steps per task, cost, next to
  the 9 official providers, labeled vendor-run, with run date, IP type, Chrome version and profile.

Decisions: none yet.
