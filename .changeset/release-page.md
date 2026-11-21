---
'playwriter': minor
---

Add `releasePage({ page })` to hand a tab back to the user without closing it.

The tab stays open, Playwriter detaches the debugger from it and takes it out of the tab group, and no session can see it anymore. Chrome hides the "started debugging this browser" banner once no tab is attached. For Playwright the page is closed. It is a global in `execute` and an export of the `playwriter` package:

```ts
import { releasePage } from 'playwriter'

await releasePage({ page })
```

Needs extension 0.0.180 or newer. With an older extension `releasePage` throws and the tab stays attached.

Fixes #143
