---
title: Search the web before opening a Playwriter tab
description: Use anonymous Parallel Search MCP from a local Playwriter module.
prompt: |
  Create a runnable local-module example for @playwriter/src/skill.md's
  importing-local-scripts workflow. Declare dependencies in @package.json.
  Use @https://docs.parallel.ai/integrations/mcp/search-mcp for anonymous
  Streamable HTTP search and optional fetch, then show explicit browser
  navigation with the CLI from @README.md and
  @website/src/pages/docs/headless.mdx. Bound requests and close clients.
---

# Search the web before opening a Playwriter tab

Use [Parallel Search MCP](https://docs.parallel.ai/integrations/mcp/search-mcp)
to find relevant pages, then open a chosen result with Playwriter. The anonymous
endpoint provides free search in Fast mode and page fetching without an account
or API key, subject to free-tier rate limits. Search queries and fetched URLs go
to Parallel; browser cookies are not sent by this module.

This example uses Playwriter's supported local module imports. It does not add
tools to the Playwriter MCP server or run an LLM agent loop.

## Install and create a session

With Node.js 22+ and pnpm installed, run from this directory:

```bash
pnpm install --ignore-workspace --frozen-lockfile
pnpm exec playwriter browser install
pnpm exec playwriter session new --browser headless
```

The last command prints a session id. Replace `1` below with that id. To use your
own Chrome with the Playwriter extension, enable the extension on a tab and run
`pnpm exec playwriter session new` instead.

## Search, inspect, then browse

Run commands from this directory so relative imports resolve correctly:

```bash
pnpm exec playwriter -s 1 --timeout 70000 -e 'state.parallel = await import("./parallel-search.mjs"); state.search = await state.parallel.searchWeb({ objective: "Find the official Playwright documentation for locators", searchQueries: ["Playwright locators official documentation"] }); console.log(JSON.stringify(state.search, null, 2))'
```

The response contains `results` with URLs, titles and excerpts, plus a
`session_id`. Inspect the results and choose a URL before navigating. For example,
if the official locator guide appears in the results:

```bash
pnpm exec playwriter -s 1 -e 'state.page = await context.newPage(); await state.page.goto("https://playwright.dev/docs/locators", { waitUntil: "domcontentloaded" }); console.log(await snapshot({ page: state.page }))'
```

Use browser automation when you need rendered content or interactions. When you
need more text from a specific public page, call `fetchPages` instead:

```bash
pnpm exec playwriter -s 1 --timeout 70000 -e 'console.log(JSON.stringify(await state.parallel.fetchPages({ urls: ["https://playwright.dev/docs/locators"], objective: "Explain how role locators work", sessionId: state.search.session_id }), null, 2))'
```

Fetch returns `results` and per-URL `errors`; inspect both. Fetch excerpts are
public page content and do not use your browser's logged-in session. Each call
closes its MCP connection and has a 60-second total deadline. Both functions also
accept an optional `signal` for cancellation from local JavaScript.

When finished, remove the session and its opened tabs:

```bash
pnpm exec playwriter session delete 1
```
