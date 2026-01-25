---
name: playwriter
description: Control the user Chrome browser via Playwriter extension with Playwright code snippets in a stateful local js sandbox. Automate web interactions, take screenshots, inspect accessibility trees, and debug web applications.
---

## Quick Start

```bash
# Get a session ID first
playwriter session new
# => 1

# Execute code with your session
playwriter -s 1 -e "await page.goto('https://example.com')"
playwriter -s 1 -e "console.log(await accessibilitySnapshot({ page }))"
playwriter -s 1 -e "await page.screenshot({ path: 'shot.png', scale: 'css' })"
```

If `playwriter` is not found, use `npx playwriter@latest` or `bunx playwriter@latest`.

## Full Documentation

**Always run `playwriter skill` to get the complete, up-to-date skill instructions.**

The skill command outputs detailed docs on:
- Session management
- Context variables (`state`, `page`, `context`)
- Best practices and rules
- Accessibility snapshots and screenshots
- Selector strategies
- Working with pages, navigation, popups, downloads
- Utility functions (`getCleanHTML`, `getCDPSession`, `createDebugger`, etc.)
- Network interception for API scraping
- And more...

```bash
playwriter skill
```
