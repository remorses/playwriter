# Speed, token, cost and step benchmarks for browser automation tools (code-as-action vs one-tool-per-action)

Research date: 2026-10-21. Sources were fetched directly where possible. Search-engine summaries were used only to find leads. Numbers that I could not trace to a primary source are marked **(secondary)** or listed under Gaps.

## Existing published speed/token/cost comparisons between browser tools

### Takeaway
The only reproducible, end-to-end, same-model comparison I found is SawyerHood's `dev-browser-eval`. It runs Claude Code headless on one task, 3 runs per method. A script-based tool (dev-browser) used 43% fewer turns and cost 39% less than Playwright MCP, and finished 14% faster. Most other claims (agent-browser "94% fewer tokens", Playwright CLI "114K vs 27K tokens") are vendor marketing or come from third-party blogs with no published harness. The adjacent "code mode" results from Anthropic and Cloudflare (98.7% fewer tokens, 37% fewer tokens, 1,000 tokens for a whole API) are about MCP in general, not about browsers.

### Cited Findings

**SawyerHood dev-browser-eval (December 2025, the best existing template)**
- Results table, averaged over 3 runs per method: Dev Browser 3m 53s, $0.88, 29 turns, 100% (3/3); Playwright MCP 4m 31s, $1.45, 51 turns, 100% (3/3); Playwright Skill 8m 07s, $1.45, 38 turns, 67% (2/3); Claude Code Native Chrome (Claude Chrome extension) 12m 54s, $2.81, 80 turns, 100% (3/3). — [dev-browser-eval benchmark-comparison.md](https://github.com/SawyerHood/dev-browser-eval/blob/main/benchmark-comparison.md)
- Derived claims: dev-browser is 14% faster than Playwright MCP, 52% faster than Playwright Skill and 70% faster than Claude's Chrome extension. It is 39% cheaper than Playwright MCP and Playwright Skill, and 69% cheaper than the Chrome extension. It used 43%, 24% and 64% fewer turns than those three. — [dev-browser-eval benchmark-comparison.md](https://github.com/SawyerHood/dev-browser-eval/blob/main/benchmark-comparison.md); the same table appeared in the dev-browser README on 2025-12-19 ([README@febf0902](https://github.com/SawyerHood/dev-browser/blob/febf0902/README.md))
- Single task: "Start the dev server and {method instruction} to create an account (with a unique and secure email and password), login, add 5 games (rate them all a 9), and view the collection. think". Target app: a local `game-tracker` app. State is reset before each run (kill ports, clear /tmp, reset DB). — [scripts/benchmark.ts](https://github.com/SawyerHood/dev-browser-eval/blob/main/scripts/benchmark.ts)
- Harness: `claude -p <prompt> --dangerously-skip-permissions --output-format stream-json --verbose`. Each method gets its own `.claude/settings.local.json` that enables only that method's plugin, plus an `.mcp.json` (`npx -y @playwright/mcp@latest` for the MCP method, `--chrome` flag for the native-Chrome method). RUNS = 3. JSONL transcripts are saved per run. — [scripts/benchmark.ts](https://github.com/SawyerHood/dev-browser-eval/blob/main/scripts/benchmark.ts), [benchmark-results/](https://github.com/SawyerHood/dev-browser-eval/tree/main/benchmark-results)
- Success check: the last JSONL line must have `"subtype":"success"` and must report an average score of 9.0. — [update-success-rate.md](https://github.com/SawyerHood/dev-browser-eval/blob/main/.claude/commands/update-success-rate.md)
- dev-browser 1.0 (Sept 2026) moved from Playwright/QuickJS to Puppeteer/Bun. It now publishes micro-latency numbers (Linux, headless, warm daemon, median of 9 runs): empty script ~13 ms, getPage + title ~14 ms, `page.snapshot()` on a SERP-like page ~18 ms, `page.shot()` ~36 ms, cold daemon + Chrome launch ~280 ms. The README says "The older end-to-end comparison is in dev-browser-eval". — [dev-browser README](https://github.com/SawyerHood/dev-browser)

**Microsoft Playwright CLI vs Playwright MCP**
- Microsoft's official position, with no numbers: "Modern coding agents increasingly favor CLI–based workflows exposed as SKILLs over MCP because CLI invocations are more token-efficient: they avoid loading large tool schemas and verbose accessibility trees into the model context". MCP "remains relevant for... exploratory automation, self-healing tests, or long-running autonomous workflows". — [microsoft/playwright-cli README](https://github.com/microsoft/playwright-cli), [microsoft/playwright-mcp README](https://github.com/microsoft/playwright-mcp)
- Playwright MCP now has token-saving flags: `--snapshot-mode` (full or partial snapshots in responses) and `--mobile` ("Mobile pages are usually lighter, which saves tokens"). — [playwright-mcp README](https://github.com/microsoft/playwright-mcp)
- **(secondary)** "~114,000 tokens with Playwright MCP vs ~27,000 with Playwright CLI for a typical task (4x)". Some users report up to 10x on longer sessions. MCP tool schemas cost about 3,600 tokens upfront for ~26 tools. These numbers appear in many 2026 third-party blog posts (for example one titled "Playwright MCP Burns 114K Tokens Per Test. The New CLI Uses 27K", 2026-02-24). I could not find a Microsoft primary source, a task list or a harness. — found via Google search only; treat as unverified.

**Vercel agent-browser**
- Primary claim: the snapshot with refs gives "~200-400 tokens vs ~3000-5000 for full DOM". "Compact text output uses fewer tokens than JSON". — [agent-browser.dev](https://agent-browser.dev/)
- The README adds `screenshot --if-changed` ("Recommended: skip unchanged images to save tokens"). It has no benchmark table. — [vercel-labs/agent-browser README](https://github.com/vercel-labs/agent-browser)
- **(secondary)** "94% fewer tokens than Playwright MCP for a 10-step flow (~7K vs ~114K)" and "Playwright MCP ~13,700 tokens of tool definitions". These come from search summaries of blog posts. I found no primary methodology.

**Chrome DevTools MCP**
- GitHub issue #635 (2025-11-29), "Reduce token usage by skipping ignored accessibility nodes". In one snapshot, 278 of 543 nodes had role `ignored`. At ~6 tokens per line, that is about 1,668 wasted tokens per snapshot or click response. The same verbose snapshot comes back after every `click`. — [chrome-devtools-mcp#635](https://github.com/ChromeDevTools/chrome-devtools-mcp/issues/635)
- The server now has a `--slim` flag that "exposes a reduced set of tools" for basic browser tasks. — [chrome-devtools-mcp README](https://github.com/ChromeDevTools/chrome-devtools-mcp)
- **(secondary)** Tool discovery costs "~17,000 tokens". One claim says a Wikipedia snapshot is ~135K tokens. Another says a "bdg" CLI uses up to 13x fewer tokens than Chrome DevTools MCP. None of these could be traced to a primary source.

**Anthropic, code execution with MCP (2025-11-04)**
- Presenting MCP servers as a TypeScript file tree that the agent imports from code "reduces the token usage from 150,000 tokens to 2,000 tokens—a time and cost saving of 98.7%". Intermediate data (for example a 10,000-row sheet) is filtered in code, so the model sees only 5 rows. The example is Google Drive → Salesforce, not browser automation. — [anthropic.com/engineering/code-execution-with-mcp](https://www.anthropic.com/engineering/code-execution-with-mcp)

**Anthropic, advanced tool use / Programmatic Tool Calling (2025-11-24)**
- Programmatic Tool Calling: "Average usage dropped from 43,588 to 27,297 tokens, a 37% reduction on complex research tasks". When Claude runs 20+ tool calls in one code block, "you eliminate 19+ inference passes". Accuracy went from 25.6% to 28.5% on internal knowledge retrieval and from 46.5% to 51.2% on GIA. — [anthropic.com/engineering/advanced-tool-use](https://www.anthropic.com/engineering/advanced-tool-use)
- Worked example: checking 20 employees' expenses went from 200 KB of raw expense data in context to 1 KB of results. The post says PTC is most useful for "Running parallel operations across many items (checking 50 endpoints, for example)" and for "three or more dependent tool calls". — [same](https://www.anthropic.com/engineering/advanced-tool-use)
- Tool Search Tool: about 77K tokens of context are used before work starts with all tools loaded, vs about 8.7K with tool search (85% reduction). The post also says "we've seen tool definitions consume 134K tokens before optimization". — [same](https://www.anthropic.com/engineering/advanced-tool-use)

**Cloudflare Code Mode**
- 2025-09 ("Code Mode: the better way to use MCP", Kenton Varda and Sunil Pai): convert MCP tools to a TypeScript API and have the LLM write code. "The approach really shines when an agent needs to string together multiple calls... the output of each tool call must feed into the LLM's neural network, just to be copied over to the inputs of the next call, wasting time, energy, and tokens." Qualitative only; no token table. — [blog.cloudflare.com/code-mode](https://blog.cloudflare.com/code-mode/)
- 2026-02-20 ("Code Mode: give agents an entire API in 1,000 tokens", Matt Carey): the whole Cloudflare API (2,500+ endpoints, per search summary) is exposed in about 1,000 tokens of tool surface. — [blog.cloudflare.com/code-mode-mcp](https://blog.cloudflare.com/code-mode-mcp/)

**Agent-level evals with speed and cost columns (browser agents, not MCP tools)**
- Stagehand / Browserbase "Browser Agent Evals" (hardbench, updated 2026-09-03, 15 of 83 runs shown). It reports accuracy, seconds per task and $ per task for each model+harness pair. Examples: claude-opus-5-5 + Claude Code 89.0%, 326 s, $0.510; gpt-6-astra + Codex 87.0%, 320 s, $3.073; gpt-6-sol + Codex 76.0%, 268 s (fastest), $0.407; gpt-6-luna + Codex 74.0%, 311 s, $0.0225 (cheapest); claude-haiku-5-5 + Claude Code 74.0%, 307 s, $0.0679. — [stagehand.dev/evals](https://www.stagehand.dev/evals)
- Browser Use BU Bench V2.1: 200 real web tasks scored with weighted findings rubrics. Defaults are 60 min per task and up to 100 concurrent tasks. The default runner is now "BrowserCode", their code-writing agent. — [browser-use/benchmark README](https://github.com/browser-use/benchmark)
- **(secondary)** Browser Use claims: about 3 s per step and 68 s average per task on Online-Mind2Web with BU 1.0, vs 225 s for Gemini 2.5 Computer Use. Their ChatBrowserUse model is "3 to 5x faster than general models". 89.1% on WebVoyager. A December 2025 release reached "200 tasks per dollar". Skyvern 2.0 reports 85.85% on WebVoyager. Not verified against primary pages.
- **(secondary)** Stagehand caching: a cached `agent.execute` replays in "~2-3 seconds, 0 tokens" vs "~20-30 seconds, ~50,000 tokens" on first run, described as "10-100x faster". Planning a form with one `observe()` and then running `act()` without LLM calls is "2-3x faster". These come from Stagehand docs as summarized by search; not fetched directly.

### Inferences
- dev-browser-eval is close to Playwriter's use case: Claude Code, a real local app, a CRUD flow with a repeated part ("add 5 games"). But the repetition is small (N=5), so the turn gap (29 vs 51) is modest. A larger N should widen the gap if script tools are O(1) turns per batch and per-action tools are O(N).
- Every published "MCP vs CLI" token claim credits the savings to two causes: (a) tool schema overhead and (b) snapshots returned inline after every action. A third cause, (c) one inference pass per action, is the one code-as-action removes. Anthropic's PTC post is the clearest primary source for (c): "eliminate 19+ inference passes".
- Playwright CLI and agent-browser still need one shell call per action. They reduce bytes per step, not the number of steps. Playwriter (and dev-browser) can reduce both. A benchmark should separate the two effects, for example by also reporting tokens per turn.
- Snapshot-trimming flags (`--slim`, `--snapshot-mode`, `--mobile`) mean a fair comparison must record the exact flags and version of each competitor.

### Gaps
- I found no primary source for the 114K/27K Playwright CLI vs MCP figures, the agent-browser "94%" figure, or the Chrome DevTools MCP "17K tokens of tool definitions" figure. Measure these yourself (count the tool-definition tokens from the Claude Code `system/init` event and the first API usage).
- I found no published benchmark that includes Playwriter, BrowserMCP, or a scaling curve (tokens vs number of items).
- I found no published wall-clock comparison of Chrome DevTools MCP vs Playwright MCP on the same task.

## Research on "code as action" and scripts vs click-by-click

### Takeaway
The academic evidence that code or API actions beat step-by-step GUI actions is consistent. CodeAct reports up to 20% higher success. Beyond Browsing (APIs) reports +24 points absolute on WebArena. SkillWeaver and WALT report gains from reusable tools, and AWM and WALT report fewer steps. These papers mostly measure success rate and steps, not tokens or $. No paper I found isolates "one script loops over N items" vs "N tool calls" in a live browser.

### Cited Findings
- **CodeAct** (Wang et al., 2024-02-01, ICML 2024): executable Python code as a unified action space. Across 17 LLMs on API-Bank and a new benchmark, it gets "up to 20% higher success rate" than JSON/text actions. The paper also releases CodeActInstruct (7k multi-turn interactions). — [arXiv:2402.01030](https://arxiv.org/abs/2402.01030), [github.com/xingyaoww/code-act](https://github.com/xingyaoww/code-act)
- **Beyond Browsing: API-Based Web Agents** (Song et al., 2024-10-21, revised 2025-06-16): on WebArena, API-calling agents beat browsing agents. Hybrid (API + browse) agents reach 38.9% success, "more than 24.0% absolute improvement over web browsing alone". — [arXiv:2410.16464](https://arxiv.org/abs/2410.16464)
- **SkillWeaver** (2025-04-09): agents synthesize reusable skills as APIs. Relative success gains are 31.8% on WebArena and 39.8% on real websites. APIs made by strong agents improve weaker agents by up to 54.3% on WebArena. — [arXiv:2504.07079](https://arxiv.org/abs/2504.07079), [github.com/OSU-NLP-Group/SkillWeaver](https://github.com/OSU-NLP-Group/SkillWeaver)
- **Agent Workflow Memory** (2024-09-11): reusable workflows give +24.6% relative success on Mind2Web and +51.1% on WebArena, "while reducing the number of steps taken to solve WebArena tasks successfully". — [arXiv:2409.07429](https://arxiv.org/abs/2409.07429), [github.com/zorazrw/agent-workflow-memory](https://github.com/zorazrw/agent-workflow-memory)
- **WALT: Web Agents that Learn Tools** (Salesforce, 2025-10-01): reverse-engineers site functions (search, filter, sort, post, create, edit) into callable tools. On VisualWebArena and WebArena it "achieves higher success with fewer steps and less LLM-dependent reasoning". — [arXiv:2510.01524](https://arxiv.org/abs/2510.01524), [github.com/SalesforceAIResearch/WALT](https://github.com/SalesforceAIResearch/WALT)
- **AgentOccam** (2024-10-17): aligning the observation and action space with what the LLM knows gives +26.6 points (+161%) over plain web agents on WebArena. This supports "give the model an interface it was trained on", which is the same argument Cloudflare makes for TypeScript. — [arXiv:2410.13825](https://arxiv.org/abs/2410.13825)
- Cloudflare's version of the argument: "LLMs have an enormous amount of real-world TypeScript in their training set, but only a small set of contrived examples of tool calls." — [blog.cloudflare.com/code-mode](https://blog.cloudflare.com/code-mode/)
- **(secondary)** ActionEngine, Webwright and "compile-and-execute" web agents generate Playwright programs with one LLM call and then run them. They claim cost drops "from O(M×N) to amortized O(1)". MacroBench evaluates LLM-written web macros. I did not fetch primary papers for these. — found via search only.

### Inferences
- CodeAct's mechanism (compose many operations in one action, use control flow) is exactly Playwriter's loop-over-100-items advantage. CodeAct measured success, not cost, so it supports the reliability claim more than the cost claim.
- The Beyond Browsing and WALT results suggest a strong Playwriter baseline. Inside one script, the agent can call the site's own fetch/JSON endpoints (`page.evaluate(fetch...)`) instead of clicking. Per-action MCP tools cannot do this without an eval tool.

### Gaps
- No paper found that reports tokens, $ and wall-clock for script-based vs per-action browser control on the same tasks with the same model.
- I did not verify ActionEngine or MacroBench details (time budget).

## Benchmarks with repetitive or data-heavy tasks

### Takeaway
WebChoreArena (tedious WebArena chores, 532 tasks) and WideSearch (200 "collect many atomic facts into a table" tasks) are the best existing sets with many repeated items. Both stress exactly the loop-and-aggregate pattern. Neither reports tool-level cost, and WideSearch is search-oriented, not browser-control oriented. For a clean Playwriter comparison, a small custom fixture suite is still the most controllable option.

### Cited Findings
- **WebChoreArena** (2025-06-02): 532 tasks on the four self-hosted WebArena environments, in three categories: Massive Memory (retain and retrieve a lot of observed information), Calculation, and Long-Term Memory (across many pages). "Even with GPT-5, there remains substantial room for improvement compared to WebArena." — [arXiv:2506.01952](https://arxiv.org/abs/2506.01952)
- **WideSearch** (ByteDance Seed, 2025-08-11): 200 tasks (100 EN, 100 ZH) that need "large-scale atomic information" arranged in a table, each fact verifiable. The paper calls the work "more repetitive than cognitively complex". Most of the 10+ systems tested score near 0% success and the best scores 5%. Humans with cross-validation reach near 100%. — [arXiv:2508.07999](https://arxiv.org/abs/2508.07999), [widesearch-seed.github.io](https://widesearch-seed.github.io/)
- **Mind2Web 2** (2025-06-26): 130 long-horizon, real-time browsing and synthesis tasks, graded by Agent-as-a-Judge. The best system (OpenAI Deep Research) reaches 50-70% of human performance. — [arXiv:2506.21506](https://arxiv.org/abs/2506.21506), [github.com/OSU-NLP-Group/Mind2Web-2](https://github.com/OSU-NLP-Group/Mind2Web-2)
- **BU Bench V2.1**: 200 real-web tasks with rubrics. One run of 100 tasks is reported to take about 3 hours **(secondary)**. — [browser-use/benchmark](https://github.com/browser-use/benchmark)
- **Stagehand hardbench / Browserbase Benchmark v2 / Online Mind2Web**: these are listed as eval sets on the Stagehand evals page, with speed and cost per task. — [stagehand.dev/evals](https://www.stagehand.dev/evals)

### Inferences
- WebChoreArena "Massive Memory" and "Calculation" tasks (for example "sum the totals of all orders from customer X across pages") are a ready-made, self-hosted and deterministic source of loop-heavy tasks. They are a good choice for a credible external subset.
- Live-web sets (WideSearch, BU Bench, Mind2Web 2) add noise from site drift and bot walls. They suit a headline demo, not a controlled speed or cost study.

### Gaps
- I did not find per-category success numbers for WebChoreArena or how many items each task touches. Read the paper's tables before choosing tasks.

## How to measure wall-clock time, tokens and $ fairly with the same model

### Takeaway
The accepted method, used by dev-browser-eval and the Stagehand evals, is: fix the model and the harness (Claude Code headless or Codex), change only the browser tool, run each method N≥3 times on reset state, and read cost, turns and duration from the harness's final JSON. Proposed task designs for Playwriter follow.

### Cited Findings
- Claude Code headless: `claude -p ... --output-format json` "includes total_cost_usd and a per-model cost breakdown". With `--continue` or `--resume` the cost covers the whole conversation. "Both figures are client-side estimates and can differ from your actual bill." — [Claude Code headless docs](https://docs.claude.com/en/docs/claude-code/headless)
- dev-browser-eval uses `--output-format stream-json --verbose`, saves the full JSONL per run and parses the final `result` line for time, cost and turns. It isolates each method with per-method `settings.local.json` (`enabledPlugins`, `allowedMcpServers`) and `--mcp-config`. — [scripts/benchmark.ts](https://github.com/SawyerHood/dev-browser-eval/blob/main/scripts/benchmark.ts)
- Stagehand evals report accuracy, seconds per task and $ per task per (model, harness), with harnesses such as Claude Code and Codex. — [stagehand.dev/evals](https://www.stagehand.dev/evals)
- Anthropic's PTC numbers are averages of total tokens over a task set (43,588 → 27,297). — [advanced-tool-use](https://www.anthropic.com/engineering/advanced-tool-use)

### Inferences: proposed benchmark design for Playwriter

**Harness (copy dev-browser-eval, then extend it)**
- Use `claude -p "<task>" --output-format stream-json --verbose --dangerously-skip-permissions`, with one fixed model (for example claude-sonnet-5-5) and `--max-turns` capped (for example 150).
- Per-method config: only one browser tool enabled (MCP via `--mcp-config` or a skill or plugin). Record versions and flags for every tool (for example Playwright MCP `--snapshot-mode`, chrome-devtools-mcp `--slim`).
- Metrics from the final `result` event: `duration_ms`, `num_turns`, `total_cost_usd`, `usage` (input, output, cache_read, cache_creation). Also derive from the JSONL: number of tool calls, bytes of tool results, tokens of tool definitions (from the init or first-request usage), and peak context size.
- Correctness: a deterministic checker (JSON diff vs ground truth, or a DB query on the fixture app). Report success rate, plus **cost per successful task**. Never average cost over failed runs without saying so.
- At least 3 runs per (task, method). 5 runs are better. Report the median and the min-max range.
- Reset state between runs (DB, browser profile, ports), as dev-browser-eval does. Use a warm browser for all methods, or a cold one for all.
- For Playwriter specifically, it drives the user's real Chrome. Run the other tools against the same Chrome where they support it (Playwright MCP `--extension`, chrome-devtools-mcp connecting to a running browser, dev-browser `--connect`, agent-browser `connect <port>`) so page load times match.

**Task suite: local fixtures plus a scaling parameter N (1, 10, 50, 100)**

| # | Task | Why it separates code-as-action from per-action tools | Checker |
|---|------|------|------|
| T1 | Paginated table scrape: a fixture shop with N products over N/10 pages. Return JSON `[{name, price, sku}]`. | Per-action tools need snapshot + click "next" per page plus reading each row. A script loops in one call. | exact JSON match |
| T2 | Detail-page crawl: list page → open each of N product pages → collect one field only on the detail page → return the sum or average. (WebChoreArena "Massive Memory" + "Calculation" style.) | N navigations; per-action agents must hold N values in context. | numeric equality |
| T3 | Bulk form entry: create N records from a provided CSV in a CRUD app (dev-browser-eval's "add 5 games" scaled up). | N × (click add, fill 3-5 fields, submit). | DB query |
| T4 | Infinite-scroll / lazy-load collection of N items. | Repeated scroll + snapshot vs a while-loop in code. | exact set match |
| T5 | Bulk edit with a condition: in an admin table, change the status of every row matching a rule (for example price > X) across pages. | Needs conditional logic per row. | DB query |
| T6 | Control task, N=1: log in and change one setting. | Single-action tasks where per-action tools should tie or win. Report it honestly. | DB query |
| T7 (external) | 10-20 WebChoreArena tasks from the Shopping / Shopping-admin / GitLab envs. | Third-party credibility, self-hosted, deterministic. | WebChoreArena evaluator |

- Plot tokens, $, turns and wall-clock against N for each method. Expected result (hypothesis, not yet measured): Playwriter's turns stay roughly flat in N after the agent explores the page once. Per-action tools grow about linearly in N. Snapshot-heavy tools grow faster than linearly in tokens, because the full history is re-sent each turn.
- Also report a success-vs-N curve. Per-action agents often stop early or skip items on long lists (WebChoreArena's "Massive Memory" failure mode).

**Competitors to include:** Playwright MCP (default and `--snapshot-mode` tuned), Playwright CLI with skills, Chrome DevTools MCP (default and `--slim`), Vercel agent-browser (CLI skill), dev-browser (script-based, the closest peer), BrowserMCP, and Claude in Chrome (`--chrome`). browser-use and Stagehand are agent frameworks with their own LLM loop. Compare them only on agent-level metrics (time, $, success), or use Stagehand's MCP if one exists. State the difference clearly.

**Fairness caveats to publish with the results**
- Prompt caching hides much of the token cost of re-sent context. Report both raw input tokens and $ (which includes cache pricing).
- Tool-description and skill size differ between tools. Playwriter's skill text is loaded too, so count it.
- The "use X" instruction in the prompt affects behavior. Use the same template for all methods, as dev-browser-eval does.
- Results from one model do not carry over to others. Run at least two models (for example a Claude model and a GPT model through Codex) if possible.

### Gaps
- I did not check whether Codex CLI's `exec --json` output has an equivalent cost field. It needs checking before a multi-harness run.
- I found no published scaling-curve (tokens vs N items) benchmark for any browser tool. The proposed T1-T5 design would be new.
