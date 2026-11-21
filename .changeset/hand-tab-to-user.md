---
'playwriter': minor
---

Add `handoff`, `waitForHandoff` and `clearHandoff` so agents hand the tab to the user for sign-ins, 2FA codes, captchas and approvals.

`handoff` shows a Playwriter card without stealing focus and returns a link for the chat that brings the tab to the front when opened. The card shows one line saying what to do, in the top-right corner or beside a `target` element with a ring around it. `waitForHandoff` returns once the page shows the step is done (a URL match or a page function), or once the user presses Done on a `manual: true` card. If the user closes the card with its X, `waitForHandoff` throws so the agent can ask in chat. The card uses an iOS-style translucent material that follows the system light or dark mode. The card works on pages with a strict CSP and Trusted Types, lets clicks through, and comes back after navigations until the handoff ends.
