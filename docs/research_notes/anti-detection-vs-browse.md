---
title: Anti-detection, playwriter vs anomalyco/browse
description: >
  Side-by-side of what browse (v0.0.14, dev, read 2026-11-08) does against bot detection and
  how playwriter compares, with page probe measurements before and after the fixes.
---

# Anti-detection, playwriter vs anomalyco/browse

Probe: a local page that hooks `querySelector`, `getElementById`, `createElement` and
`getBoundingClientRect`, watches DOM mutations, diffs window globals, and checks the
`Runtime.enable` console leak. Adapted from browse `stress/stealth/probe.html`. It ran in Chrome
for Testing 147 with the extension, through the relay. The actions were `goto`, two `click`s,
`pressSequentially` and `screenshot`. It now lives in `anti-bot.test.ts`.

## Side by side

| Area | browse | playwriter before | playwriter now |
|------|--------|-------------------|----------------|
| Challenge detection rules | `challenge-detection.ts`, 9 vendors, 3 kinds | same port | same |
| Challenge probe world | isolated (Patchright `evaluate`) | main world `page.evaluate`, page sees `querySelector` from a foreign stack | isolated world via `Page.createIsolatedWorld` |
| Human mouse, wheel, keys | Bezier, min-jerk, Fitts, tremor, overshoot, wheel glide, 30-110 ms keys | same port | same |
| Off-center clicks | every point +-3 px blind, also `mouse.click(x, y)` | exact center every time | only element centers (matched to the last `DOM.getContentQuads`), inner 40%, max 10 px; raw coordinates stay exact |
| Human input default | on (status page toggle, env override) | opt-in env | per-session mode (`on`, `off`, `auto` on bot-protected sites), from main 75ae4467f |
| Ghost cursor | off by default; isolated world, closed shadow root, no id | extension injects bundle into main world of every attached tab: `window.__playwriterGhostCursor` global, main-world DOM calls | isolated world, injected on the first agent mouse action; no global. Element `#__playwriter_ghost_cursor__` still in DOM, always on |
| Screenshot cleanup | nothing injected | main-world `<style id=__playwriter_screenshot_style__>` left in the page, `class` toggled on `<html>` | adopted stylesheet from the isolated world, removed after capture; no node, no attribute |
| In-page UI | nothing in the DOM until a handoff card (closed shadow root, no id, top layer) | toolbar hosts `[data-playwriter-toolbar]` in every attached tab; fork sets `data-playwriter-agent` on it per action | unchanged (product decision) |
| Runtime domain | Patchright: never enabled; console capture opt-in per page | enabled on every page | unchanged; probe shows no console-serialization leak in Chrome 147 |
| Agent `page.evaluate` | isolated by default (Patchright) | main world (Playwright semantics) | unchanged; `snapshot()` render wait moved to the isolated world |
| Focus emulation | only while a session uses the tab | always on (Playwright default) | unchanged (research note 3.5) |
| `screenX == clientX` on CDP input | yes (Chrome limitation) | yes | yes |
| Stealth harness | `stress/stealth/run.ts` + public detectors | none | page probe in `anti-bot.test.ts`; no public detector runs |

## Probe results

| Signal | before, human off | before, human on | after, human on |
|--------|-------------------|------------------|-----------------|
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

- **Toolbar in the DOM.** browse adds nothing to the page until it needs the user. Our toolbar is
  a visible product feature; hiding it or dropping the ids would cut the strongest remaining DOM tell.
- **Ghost cursor default.** browse keeps it off. Ours is always on, so the cursor element appears
  after the first click on every page.
- **Patchright as default.** It would stop `Runtime.enable` and make agent evaluates isolated,
  but changes console capture and `page.evaluate` semantics. The measured console leak is gone in
  current Chrome, so the gain today is small.
