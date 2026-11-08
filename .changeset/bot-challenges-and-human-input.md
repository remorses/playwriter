---
'playwriter': minor
---

Agents now get told when a page shows a bot check, captcha or block page. After an execute navigates a page, Playwriter checks it for Cloudflare, Akamai, DataDome, PerimeterX, Imperva, AWS WAF, reCAPTCHA and hCaptcha pages. Checks that clear by themselves are waited out within the execute timeout. For a captcha or a block, execute prints a `[WARNING]` that tells the agent not to reload and to ask the user instead.

New human-like input: mouse moves follow curved paths, clicks get human press timing, scrolling glides in wheel flicks, and key presses are spaced 30-110 ms apart. This makes behavioral bot detection less likely to flag the agent, at the cost of slower actions. It is on by default only on sites with heavy bot detection (x.com, amazon, google, pinterest, ebay, instagram, linkedin and similar). Pick it per session with `playwriter session new --human-input auto|on|off`, or `connectViaExtension({ humanInput })` in the Node API.
