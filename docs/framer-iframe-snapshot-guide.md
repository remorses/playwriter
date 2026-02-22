---
title: Framer Plugin Iframe Snapshot Guide
description: Step-by-step instructions to open the Framer MCP plugin iframe and run snapshot on it.
prompt: |
  Create a concise step-by-step guide to open the Framer plugin iframe and
  verify snapshot on that iframe using playwriter CLI. Include the
  exact Framer project URL and the plugins.framercdn iframe URL. Also document
  the Command+K workflow to open the MCP plugin: press Command+K, search for MCP
  in the command palette, press Enter, then wait ~1 second for the iframe to
  appear. Reference any files read for context.

  Sources:
  - @/Users/morse/Documents/GitHub/playwriter/tmp/session-ses_437d9a10bffeFmy3k3hVcAFZnf.md
  - @/Users/morse/Documents/GitHub/playwriter/tmp/session-ses_43807a563ffe1tCS0FWK79IpcV.md
---

## Step-by-step

- Always reuse an existing Framer tab when possible (do not open a new page each run).
  Use this pattern to pick an existing page first, then navigate only if needed:

```bash
playwriter -s 1 -e "const target = 'https://framer.com/projects/unframer-source--XOxwdyyCrFEE9uKnKFPq-6gX7n?node=augiA20Il'; const framerPage = context.pages().find((p) => p.url().includes('framer.com/projects/unframer-source')) || page; if (!framerPage.url().includes('framer.com/projects/unframer-source')) { await framerPage.goto(target, { waitUntil: 'domcontentloaded' }); } console.log(framerPage.url());"
```

- Never call `bringToFront()` in this flow. It steals focus and interrupts manual work while tests are running.

- Open the Framer project URL in Chrome:
  https://framer.com/projects/unframer-source--XOxwdyyCrFEE9uKnKFPq-6gX7n?node=augiA20Il

- Wait for the editor UI to finish loading (toolbar visible) before opening the command palette.

- Press Command+K to open the command palette.

- Verify the palette is open (look for the command dialog and MCP entry in the snapshot output):

```bash
playwriter -s 1 -e "console.log(await snapshot({ page, search: /dialog|Search…|MCP/ }));"
```

- Search for **MCP**, press Enter, then wait about 1 second for the plugin iframe to appear.

- Verify the plugin iframe exists (should include `plugins.framercdn.com`):

```bash
playwriter -s 1 -e "const iframes = await page.locator('iframe').all(); for (const f of iframes) { console.log(await f.getAttribute('src')); }"
```

- Wait until the MCP iframe is present (verifies the action worked):

```bash
playwriter -s 1 -e "const iframe = page.locator(\"iframe[src*='plugins.framercdn.com']\"); await iframe.first().waitFor({ timeout: 10000 }); console.log('iframe ready');"
```

- Grab the iframe’s locator by URL:

```bash
playwriter -s 1 -e "const iframe = page.locator(\"iframe[src*='plugins.framercdn.com']\"); console.log(await iframe.count());"
```

- Run the accessibility snapshot on that iframe using `contentFrame()` (FrameLocator is auto-resolved to Frame):

```bash
playwriter -s 1 -e "const frame = await page.locator(\"iframe[src*='plugins.framercdn.com']\").contentFrame(); console.log(await snapshot({ page, frame }));"
```

- Alternative: use `page.frames()` to get the Frame directly:

```bash
playwriter -s 1 -e "const frame = page.frames().find(f => f.url().includes('plugins.framercdn.com')); console.log(await snapshot({ page, frame }));"
```

- Validate the snapshot contains MCP UI text (confirms the panel is actually loaded):

```bash
playwriter -s 1 -e "const frame = await page.locator(\"iframe[src*='plugins.framercdn.com']\").contentFrame(); console.log(await snapshot({ page, frame, search: /Control Framer with MCP|Login With Google/ }));"
```

## Expected iframe URL

- https://nw12xtr7iedsczg1le9s9pqfl.plugins.framercdn.com/?mode=canvas
