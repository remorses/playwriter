---
'@xmorse/playwright-core': patch
'playwriter': patch
---

`@xmorse/playwright-core` is now based on Playwright 1.64.1, the same version as `@playwriter/patchright-core`. All fork APIs keep working: `page.targetId()`, `page.sessionId()`, `frame.frameId()`, `context.getExistingCDPSession()`, `page.onMouseAction`, `locator.selector()`, `browserType.runWithAbortSignal()` and actionability reasons in timeout errors.

`playwriter recorder` uses the new Playwright recording API. Recorded actions still carry the page alias and frames, and clicks are reported live, so a click comes before the popup it opens. Every recording now names its first page `page`, so its code runs on its own.
