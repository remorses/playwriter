---
'playwriter': minor
---

Add `handoff`, `waitForHandoff` and `clearHandoff` so agents hand the tab to the user for sign-ins, 2FA codes, captchas and approvals.

`handoff` brings the tab to the front and shows a Playwriter card with one line saying what to do, in the top-right corner or beside a `target` element with a ring around it. `waitForHandoff` returns once the page shows the step is done (a URL match or a page function), or once the user presses Done on a `manual: true` card. The card works on pages with a strict CSP and Trusted Types, lets clicks through, and comes back after navigations until the handoff ends.
