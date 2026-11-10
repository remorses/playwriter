---
title: Anti-detection and human input, playwriter vs anomalyco/browse
description: >
  Side-by-side of bot-detection evasion and humanized input in browse (v0.0.16, dev, read
  2026-11-09) and playwriter (main 0f05a49c1): mouse paths, typing, scrolling, timing,
  fingerprint, stealth patches, challenge handling. Lists what browse has that we lack, what we
  do better, shared gaps, and the page probe measurements from 2026-11-08.
---

# Anti-detection and human input, playwriter vs anomalyco/browse

**Gist.** The humanized input core is the same code (ours is a port). We aim clicks better and
keep normal sites fast with `auto`. browse is quieter in the page: always Patchright, no DOM
footprint by default, focus emulation only while a session works. It also has a broader stealth
harness and an in-page handoff for challenges.

Versions read: browse `0.0.16` (`dev`, fetched 2026-11-09, patchright-core 1.63.0). playwriter
`main` at `0f05a49c1`, with per-session human input (`75ae4467f`) and page scripts in an isolated
world (`d3f2d1b41`). Paths: browse `cli/src/`, playwriter `playwriter/src/`.

## Side by side

### Human input

| Area | browse | playwriter |
|------|--------|------------|
| Where | relay, before each `Input.dispatchMouseEvent`, `dispatchKeyEvent`, `DOM.scrollIntoViewIfNeeded` (`execute/human-input.ts`) | same hook in the relay (`human-input.ts`, `cdp-relay.ts`) |
| Mouse path | cubic Bezier with a bow of 4 to 18% of the distance, minimum-jerk speed, 8 to 17 ms samples, tremor that fades, 25% overshoot on moves over 250 px, Fitts' law duration capped at 1.1 s | identical |
| First move on a page | from a random point within ±260/±180 px of the target, clamped to the viewport | identical |
| Click aim | every mouse event offset by noise(2.2)/noise(1.6), about ±3 px, also raw `mouse.click(x, y)` | only element centers measured by the last `DOM.getContentQuads`: inner 40% of the quad, max 10 px, along rotated edges. Raw coordinates stay exact |
| Press timing | 45 to 130 ms settle before press, 60 to 140 ms hold | identical |
| Typing | 30 to 110 ms between keyDowns (within 1 s); keyUp not delayed | identical |
| `fill()` | `Input.insertText`, not paced | same |
| Wheel | each wheel event becomes an ease-out burst at ~60 Hz | identical |
| Scroll into view | wheel flicks of 450 to 900 px toward a goal at 35 to 50% of the viewport, then Playwright's own scroll fine-tunes | same flicks, but the stall check is broken (see below) |
| Background tabs | `pace()` never waits past a sample's gap (Chrome holds replies for background tabs ~1 s) | identical |
| Default | on for every page. Status page toggle, `OPENCODE_BROWSER_HUMAN_INPUT` overrides | per session: `auto` (default) humanizes only a list of bot-heavy sites (x.com, amazon.\*, google.\*, linkedin, reddit...), `on`, `off` |

### Page footprint and fingerprint

| Area | browse | playwriter |
|------|--------|------------|
| Stealth driver | always Patchright (no `Runtime.enable`, isolated `evaluate`, init scripts via routes) | Playwright fork by default. Patchright fork (`@playwriter/patchright-core`, 1.64.1) only with `--patchright` / `PLAYWRITER_PATCHRIGHT=1` |
| `Runtime.enable` | never by the driver; console capture is opt-in per page (`execute/console.ts`) | enabled on every attached page. No console-serialization leak in Chrome 147 |
| Agent `page.evaluate` | isolated world | main world (Playwright semantics) |
| Own page scripts (cursor, challenge probe, screenshot cleanup) | isolated world | isolated world since `d3f2d1b41`; no globals, no foreign DOM calls |
| DOM nodes | none until a handoff card or opt-in cursor; closed shadow root, no id | toolbar hosts `[data-playwriter-toolbar]` on every attached tab; fork toggles `data-playwriter-agent` on them per action; cursor `#__playwriter_ghost_cursor__` (no shadow root) after the first mouse action |
| Ghost cursor | off by default (status page or `OPENCODE_BROWSER_GHOST_CURSOR`) | always on |
| Focus emulation | off on attach; on only while a session uses the tab; re-applied after navigation (`cdp/tab-activity.ts`) | on for every attached page (Playwright default) |
| Emulated media | relay drops all four driver defaults (color scheme, reduced motion, forced colors, contrast) unless the agent set them (`cdp/shims.ts`) | fork sends `prefers-color-scheme: ''` (no override), but still forces `reduced-motion: no-preference`, `forced-colors: none`, `contrast: no-preference` (seen in `cdp.jsonl`) |
| UA, viewport, fonts, WebGL | user's real Chrome, no overrides, no JS patches | same |
| `navigator.webdriver` | false in user Chrome | same |
| `screenX == clientX` on CDP input | yes, Chrome limitation | yes |

### Challenges and testing

| Area | browse | playwriter |
|------|--------|------------|
| Detection | `challenge-detection.ts`: 9 vendors, 3 kinds (non-interactive, interactive, block) | same rules (port), probe in isolated world |
| Wait | polls 1 s, up to 15 s, `OPENCODE_BROWSER_CHALLENGE_WAIT_MS` 0 to 60 s | polls up to 15 s, cut by the execute timeout |
| Response | `aftermath.challenge` with `recommendation: handoff/stop`; `handoff()` shows a card in the page and blocks until the user clicks Continue | `[WARNING]` text telling the agent to stop or ask the user; no in-page handoff |
| Harness | `stress/stealth/run.ts`: probe page plus 8 public detectors (sannysoft, BrowserScan, CreepJS, rebrowser, deviceandbrowserinfo, pixelscan, fingerprint.com, reCAPTCHA v3 score) | probe subset in `anti-bot.test.ts`; Stealth Bench V1 planned (`plans/stealth-bench.md`) |
| Probe coverage | input events (coalesced and predicted counts, timing stats), focus and visibility over the run, foreign main-world calls, Runtime leak, window vs dedicated, shared and service worker navigator, 22 native-function checks, automation globals, DOM nodes, `<html>` attributes | foreign DOM calls, extra globals, DOM nodes, `<html>` attributes, click points, Runtime leak |

## What browse does that we lack

1. **Working scroll stall check.** Ours re-rolls the goal (`random(0.35, 0.5)`) on every measure,
   so `|next - remaining| < 1` almost never holds. An element that cannot scroll gets up to 12
   flicks with pauses (several seconds, estimated, not measured) and wheels the page around. browse fixed this in 0.0.16 by
   picking the goal once per scroll. One-line fix in `scrollToward`.
2. **Focus emulation only while working.** Every attached tab of ours reports
   `document.hasFocus()` true, so two tabs can be "focused" at once.
3. **No DOM footprint by default.** Toolbar hosts, the `data-playwriter-agent` toggle and the
   cursor id are the strongest page-visible tells we still have.
4. **Patchright always on.** No `Runtime.enable`, isolated evaluate. Our mode exists but is opt-in.
5. **All media defaults dropped.** We still override reduced motion, forced colors and contrast,
   which changes the page for users who set them.
6. **In-page handoff.** The user gets a card with Continue; the script resumes by itself.
7. **Broader harness.** Worker consistency, native-function and pointer-event checks, public
   detectors with screenshots.
8. **Configurable challenge wait** (0 to 60 s).

## What we do better

1. **Click aim.** Offsets follow the real element (inner 40%, rotated quads) and reach 10 px, so
   clicks spread like a person's. Raw `mouse.click(x, y)` stays exact for canvas, maps and games;
   browse shifts it.
2. **Speed where it is safe.** `auto` keeps Playwright speed on ordinary sites and humanizes only
   bot-heavy ones, per session. browse slows every action unless the user turns it off globally.
3. **Choice of driver.** Agents keep Playwright main-world semantics by default and can switch to
   Patchright. browse forces isolated evaluate.
4. **Color scheme fixed in the fork**, not by rewriting CDP messages in the relay.

## Gaps in both

- **Key dwell.** Playwright sends keyUp right after keyDown, so every key is held a few ms. Real
  keys are held 50 to 120 ms. Neither paces keyUp.
- **`fill()` is one `insertText`.** No key events at all, and agents use `fill` most.
- **No idle motion.** The pointer only moves on actions; no drift or reading pauses between them.
- **`screenX == clientX`.** CDP input cannot set screen coordinates.
- **`auto` site list** (ours): DataDome or Cloudflare sites outside the list get raw input. Idea:
  turn human input on for an origin once a challenge is detected there.

## Probe results (2026-11-08)

Probe: a local page that hooks `querySelector`, `getElementById`, `createElement` and
`getBoundingClientRect`, watches DOM mutations, diffs window globals, and checks the
`Runtime.enable` console leak. Adapted from browse `stress/stealth/probe.html`. Ran in Chrome for
Testing 147 with the extension, through the relay: `goto`, two `click`s, `pressSequentially`,
`screenshot`. Now in `anti-bot.test.ts`.

| Signal | before, human off | before, human on | after `d3f2d1b41`, human on |
|--------|-------------------|------------------|-----------------------------|
| Extra window globals | `__playwriterGhostCursor` | same | none |
| Hooked DOM calls from foreign stacks | probe `querySelector`, cursor `getElementById` + `createElement` x2, screenshot `getElementById` + `createElement` | same | none |
| Nodes added | 2 toolbar hosts, cursor div, `<style>` | same | 2 toolbar hosts, cursor div |
| `<html>` attribute changes | `class` toggled, `class=""` left behind | same | none |
| Trusted mousemove events for 2 clicks | 2 | 36 | 41 |
| Click points on a 120x40 button centered at 360,220 | 360,220 twice | 360,220 twice | 364,221 and 358,219 |
| Runtime.enable console leak | no | no | no |

`navigator.webdriver` is `true` only because the test Chrome starts with `--enable-automation`.
The user's Chrome reports `false`.

## Left as decisions

- **Toolbar in the DOM.** A visible product feature; hiding it or dropping the ids would cut the
  strongest remaining DOM tell.
- **Ghost cursor default.** browse keeps it off. Ours is always on.
- **Patchright as default.** Stops `Runtime.enable` and isolates agent evaluates, but changes
  console capture and `page.evaluate` semantics. The measured console leak is gone in current
  Chrome, so the gain today is small.
