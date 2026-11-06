# Browser-automation tools landscape and the benchmarks each one cites (as of Oct 2026)

Research date: 2026-10-21. All numbers are vendor self-reports unless noted. "Search-only" means the claim came from a search summary and I could not open a primary page for it; treat it as unverified.

## Which benchmarks does each tool cite, and with which scores?

### Takeaway
Two groups of tools exist. Autonomous agents (browser-use, Magnitude, Skyvern, Surfer, Notte, Operator/CUA, Mariner, Alumnium, browser-control) compete on WebVoyager, Online-Mind2Web, WebArena, WebBench, OSWorld and BU Bench. Coding-agent tools (Playwright MCP/CLI, Chrome DevTools MCP, agent-browser, dev-browser, BrowserMCP, mcp-chrome, BrowserTools MCP) mostly publish no task-success benchmarks. Their only head-to-head is the Browser Use "Browser Harness" eval on BU Bench V2.1 (Oct 2026). Playwriter is not in any leaderboard or comparison table I found.

### Cited Findings

#### Leaderboards and benchmarks (reference)
- Steel.dev leaderboard tracks WebVoyager (643 live-web tasks, 15 sites, 22 entries), Online-Mind2Web (300 tasks, 136 sites), BrowseComp (104 entries), WebArena (52 entries), OSWorld, OSWorld 2.0. Last updated 2026-10-11. Repo is open: — [steel-dev/leaderboard README](https://github.com/steel-dev/leaderboard), [WebVoyager page](https://leaderboard.steel.dev/leaderboards/webvoyager), [Online-Mind2Web page](https://leaderboard.steel.dev/leaderboards/online-mind2web)
- WebArena top: WebTactix (DeepSeek v3.2) 74.3%, OpAgent 71.6%, ColorBrowserAgent 71.2%, Claude Code + GBOX MCP 68.0%, DeepSky Agent 66.9% — [steel-dev/leaderboard](https://github.com/steel-dev/leaderboard)
- BrowseComp top: GPT-5.6 Sol Ultra 92.2%, GPT-6 Astra 91.5%, Kimi K3 91.2%, Claude Opus 5 90.8%. These are model scores, not browser tools — [steel-dev/leaderboard](https://github.com/steel-dev/leaderboard)
- Halluminate WebBench: 2,454 tasks across 452 live sites from top-1000 by traffic; READ 64.4% of tasks, CREATE 20.9%, UPDATE 7.1%, DELETE 6.1%, FILE_MANIPULATION 1.5%. Leaderboard at webbench.ai. Submission requires emailing Halluminate — [Halluminate/WebBench](https://github.com/Halluminate/WebBench)
- WebBench human evaluation cost about $3,000 per agent, so only a few vendors were tested — [Skyvern blog](https://www.skyvern.com/blog/web-bench-a-new-way-to-compare-ai-browser-agents/)
- BU Bench V2.1: 200 tasks (encrypted), runner `uv run python run_eval.py`, can run on GitHub Actions, `--browser local_headless` option. V1 and Stealth Bench V1 still selectable — [browser-use/benchmark](https://github.com/browser-use/benchmark)
- Browser Use benchmark page (BU Bench v2.1, 180 tasks, 2026-10-17): GPT-6.1 Sol medium 79.6 ($1.30/task, 8 min), Claude Opus 5.5 high 75.0 ($2.35, 12 min), Browser Use "BU fast" 72.9 (11¢, 9 min), Claude Sonnet 5.5 high 72.7 ($1.53). All models run in the open-source BrowserCode harness. Score = mean weighted rubric score 0-100; cost excludes search, judge, browser, runner — [browser-use.com/benchmarks](https://browser-use.com/benchmarks)

#### WebVoyager leaderboard entries (Steel, 2026-10-11)
| Rank | System | Score | Note |
|---|---|---|---|
| 1 | browser-control (Fable 5), Om Labs | 99.19% | Shell-native CDP harness via Claude Code; 610/615 tasks; GPT-5.5 judge; self-reported |
| 2 | Alumnium (Claude Code + Alumnium MCP + Selenium) | 98.5% | 610 tasks, Mar 2026 |
| 3 | Surfer 2, H Company | 97.1% | o3 + Sonnet 4.5 + GPT-4.1 + Holo1.5 stack |
| 4 | Magnitude | 93.9% | |
| 5 | Surfer-H + Holo1 | 92.2% | |
| 6 | browser-control (Opus 4.8) | 90.41% | |
| 7 | Browserable | 90.4% | |
| 8 | Browser Use | 89.1% | |
| later | Operator, Notte, Skyvern 2.0, Project Mariner, Agent-E, WebVoyager original, Anthropic CU 3.5, GPT-4 All Tools | see below | |

Source: [Steel WebVoyager leaderboard](https://leaderboard.steel.dev/leaderboards/webvoyager), [steel-dev/leaderboard](https://github.com/steel-dev/leaderboard)

- browser-control harness repo: 610/615 (99.19%) with fable-5; 556/615 (90.41%) with Opus 4.8; packaged 2026-06-17; pinned deps; runner is Claude Code + browser-control (Rust CDP tool) — [omxyz/webvoyager](https://github.com/omxyz/webvoyager)
- Alumnium: 98.5% on 610 tasks with Claude Code, Mar 26 2026; publishes transcripts, screenshots, evaluator responses; modified WebVoyager fork because GPT-4V is gone — [Alumnium blog](https://alumnium.ai/blog/webvoyager-benchmark/)
- Magnitude: 93.9% pass@1, avg 15.5 steps; compares browser-use 89.1% (18.11 steps), OpenAI Operator 87.0%, Skyvern 85.9%, WebVoyager original 59.1% — [magnitudedev/webvoyager](https://github.com/magnitudedev/webvoyager)
- Note: the `magnitudedev/magnitude` repo README now describes a local LLM inference engine ("2x faster than Ollama"), not the browser agent — [magnitudedev/magnitude](https://github.com/magnitudedev/magnitude)
- Skyvern 2.0: 85.85% WebVoyager — [Skyvern README](https://github.com/Skyvern-AI/skyvern), [Skyvern 2.0 report](https://www.skyvern.com/blog/skyvern-2-0-state-of-the-art-web-navigation-with-85-8-on-webvoyager-eval/)
- Skyvern: "SOTA on WebBench with 64.4% accuracy" — [Skyvern README](https://github.com/Skyvern-AI/skyvern). Note the same Skyvern blog says Anthropic Sonnet 3.7 CUA was SOTA on the write-heavy subset — [Skyvern blog](https://www.skyvern.com/blog/web-bench-a-new-way-to-compare-ai-browser-agents/)
- Skyvern Oct 1 2026: rewrite "using Pi as inspiration" made it 2.3x faster and scored 90.5% on Odysseys. Jul 15 2026: "Rustwright", Playwright in Rust, 70% less memory, 2.55x faster boot — [Skyvern blog index](https://www.skyvern.com/blog/web-bench-a-new-way-to-compare-ai-browser-agents/) (seen as linked posts; full posts not opened)
- Surfer 2: SOTA on OSWorld, WebVoyager, WebArena, AndroidWorld; OSWorld E2E 60.1% pass@1, 77.0% pass@10 — [hcompany.ai/surfer-2](https://hcompany.ai/surfer-2)
- Agent-E: WebVoyager validation on GPT-4 Turbo; builds on WebArena test harness — [EmergenceAI/Agent-E](https://github.com/EmergenceAI/Agent-E). Leaderboard value ~73.2% (inferred from leaderboard score list ordering; not opened individually).
- Notte 86.2% WebVoyager (search-only), Project Mariner 83.5% (search-only, Dec 2024)
- OpenAI CUA / Operator: OSWorld 38.1%, WebArena 58.1%, WebVoyager 87% — [OpenAI CUA](https://openai.com/index/computer-using-agent/)
- Convergence Proxy: 88% WebVoyager (search-only)

#### Online-Mind2Web (Steel, 2026-10-11)
- Browser Use Cloud (bu-max) 97.0% (Mar 2026, custom Claude Agent SDK judge, "not directly comparable"); GPT-5.4 native CU 93.0%; ABP + Claude Opus 4.6 90.53% (all 300 results public); TinyFish 90.0% (all runs public); CUAWright + GPT-5.5 89.4% (Oct 2026); UI-TARS-2 88.2%; OpenAGI Lux 83.6%; Yutori Navigator 78.7%; ChatGPT Atlas Agent Mode 71.0%; Gemini 2.5 Computer Use 69.0%; Stagehand (Gemini 2.5 CU) 65.0%; OpenAI Operator 61.3%; Claude 4.0 61.0%; Stagehand (Sonnet 4.5) 55.0%; Browser Use (gpt-4o) 30.0% (Nov 2024) — [Steel Online-Mind2Web](https://leaderboard.steel.dev/leaderboards/online-mind2web)
- ABP: "90.53% on Online Mind2Web — reproducible results" — [theredsix/agent-browser-protocol (dev branch)](https://github.com/theredsix/agent-browser-protocol/tree/dev), results repo [theredsix/abp-online-mind2web-results](https://github.com/theredsix/abp-online-mind2web-results)
- Gemini 2.5 Computer Use: "leading quality for browser control at the lowest latency, as measured on the Browserbase harness for Online-Mind2Web" (Oct 2025) — [Google blog](https://blog.google/technology/google-deepmind/gemini-computer-use-model/)
- Stagehand / Browserbase run a public "Browser Agent Evals" page comparing models on accuracy, cost and speed; "Browserbase Benchmark v2" includes online mind2web runs — [stagehand.dev/evals](https://www.stagehand.dev/evals)

#### OSWorld and computer-use agents
- Simular Agent S3: 69.9% OSWorld (Oct 2025), 72.60% (Dec 2025, "first to surpass human"); Sai 73% on OSWorld 2.0 (Aug 2026); Simular API claims "90% token saving" — [simular-ai/Agent-S](https://github.com/simular-ai/Agent-S)
- CUAWright (bash-only action interface + filesystem tools): OSWorld 2.0 +33.2% relative partial reward and −37.5% cost vs published GPT-5.5 baseline; Online-Mind2Web +4.7% and Odysseys +44.0% success vs GUI-native harness — [arXiv 2610.04116](https://arxiv.org/abs/2610.04116)

#### Claude in Chrome
- Anthropic cites prompt-injection numbers, not task success: 123 test cases, 29 attack scenarios; attack success 23.6% without mitigations, 11.2% with; browser-specific challenge set 35.7% → 0% — [Anthropic: Claude for Chrome](https://www.anthropic.com/news/claude-for-chrome)

#### Tools with no task-success benchmark found
- Playwright MCP, Playwright CLI: no benchmark numbers in READMEs; only qualitative "token-efficient" claims — [playwright-mcp](https://github.com/microsoft/playwright-mcp), [playwright-cli](https://github.com/microsoft/playwright-cli)
- Chrome DevTools MCP: no benchmarks; Google collects tool success/latency telemetry — [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp)
- agent-browser, BrowserMCP, mcp-chrome (hangwin), BrowserTools MCP, Nanobrowser, AgentQL, Browserless, LaVague, Bytebot, Steel browser, HyperAgent, Kernel: none publish success-rate benchmarks in their READMEs — READMEs of [agent-browser](https://github.com/vercel-labs/agent-browser), [BrowserMCP](https://github.com/BrowserMCP/mcp), [mcp-chrome](https://github.com/hangwin/mcp-chrome), [browser-tools-mcp](https://github.com/AgentDeskAI/browser-tools-mcp), [nanobrowser](https://github.com/nanobrowser/nanobrowser), [agentql](https://github.com/tinyfish-io/agentql), [browserless](https://github.com/browserless/browserless), [LaVague](https://github.com/lavague-ai/LaVague), [bytebot](https://github.com/bytebot-ai/bytebot), [steel-browser](https://github.com/steel-dev/steel-browser), [HyperAgent](https://github.com/hyperbrowserai/HyperAgent), [kernel-images](https://github.com/kernel/kernel-images)
- TinyFish (AgentQL company) does appear on Online-Mind2Web at 90.0% — [Steel Online-Mind2Web](https://leaderboard.steel.dev/leaderboards/online-mind2web)
- rtrvr.ai: WebBench run June 2025 on 323 tasks; 96.61% of its failures were agent errors, 3.39% infrastructure errors (attributed to local extension design). 81.4% overall is search-only — [rtrvr WebBench post](https://www.rtrvr.ai/blog/web-bench-results)
- Perplexity Comet, Opera Neon: no benchmark numbers found.

### Inferences
- WebVoyager is saturated (top 99.19%, many above 90%), and teams now edit the task set (Alumnium removed 24 tasks; browser-control drops 4 more). A Playwriter WebVoyager number would only matter if near 99% and on the same 610/615 task set.
- Two of the top WebVoyager entries (browser-control, Alumnium) are "Claude Code + a CLI/MCP browser tool". This is the exact category Playwriter is in, so Playwriter can enter with the same runner style using the open omxyz/webvoyager or Alumnium fork.
- Online-Mind2Web results are not comparable across judges (Steel flags this). Human-eval vs WebJudge scores differ by 10+ points.

### Gaps
- Could not open Steel leaderboard rows 9 to 22 individually; scores for Notte, Mariner, Operator, Agent-E there come from ordering plus other sources.
- WebBench leaderboard (webbench.ai) per-vendor table not fetched.
- No benchmarks found for Perplexity Comet, Opera Neon, ChatGPT Atlas (except Atlas 71.0% Online-Mind2Web via OpenAI), BrowserMCP, mcp-chrome, BrowserTools MCP, Bytebot, Kernel, Anchor (agent side).

## Which tools publish speed, latency, cost or token comparisons vs competitors?

### Takeaway
The only rigorous, open, same-agent comparison of coding-agent browser tools is Browser Use's Browser Harness eval (BU Bench V2.1, 100 tasks, Codex + GPT-6 Luna, 2026-10-14). It found no success difference between Browser Harness, Playwright MCP, Chrome DevTools MCP and agent-browser, but large token/cost differences (2.1M vs 3.3-6.7M median input tokens). Most other speed/token claims (agent-browser "93% less context", Playwright CLI "4x fewer tokens") have no primary methodology I could find.

### Cited Findings

#### Browser Harness matched eval (most relevant to Playwriter)
| Tool | Score 0-100 (95% CI) | Fully solved | Median input tokens | Median cost | Median time | Median tool calls |
|---|---|---|---|---|---|---|
| Browser Harness a6426f84 | 60.4 (55.2-65.4) | 11% | 2.1M | $0.042 | 9.0 min | 42 |
| Playwright MCP 0.0.83 | 60.0 (55.1-65.0) | 11% | 4.4M | $0.066 | 8.3 min | 57 |
| Chrome DevTools MCP 1.10.1 | 61.0 (55.8-65.9) | 11% | 6.7M | $0.097 | 8.7 min | 67.5 |
| agent-browser 0.39.1 | 56.3 (51.1-61.5) | 9% | 3.3M | $0.056 | 11.2 min | 45 |

- Method: tasks bu2-001 to bu2-100 of public BU Bench V2.1; Codex CLI 0.144.6, GPT-6 Luna medium, web search off; same frozen judge; same fresh Browser Use cloud browser over CDP with US proxy; identical prompt except one line naming the tool; one run per task, agent failures never retried. Claude Code, Cursor, Playwright CLI, Claude in Chrome not measured. A first agent-browser run was discarded due to a setup bug — [browser-use/browser-harness README](https://github.com/browser-use/browser-harness), per-task data [coding-agent-browser-tools.json](https://browser-use.com/benchmarks/coding-agent-browser-tools.json)
- "No tool wins on score: every paired difference against Browser Harness has a 95% CI that includes zero" — [browser-harness README](https://github.com/browser-use/browser-harness)
- The same README has a feature table comparing which browser each tool drives (your Chrome vs own profile) and what you approve, covering Playwright MCP, Playwright CLI, Chrome DevTools MCP, agent-browser, Claude in Chrome, ChatGPT browser — [browser-harness README](https://github.com/browser-use/browser-harness)

#### Other speed/token/cost claims
- dev-browser: medians of 9 runs, Linux headless, warm daemon: empty script ~13 ms, `getPage`+`title` ~14 ms, `snapshot()` ~18 ms, `shot()` ~36 ms, cold daemon+Chrome ~280 ms; run with `bun run bench/run.ts --runs 9`. Older end-to-end comparison in dev-browser-eval — [SawyerHood/dev-browser](https://github.com/SawyerHood/dev-browser)
- dev-browser-eval: Claude Code runs a task against a "game-tracker" app with 3 methods (dev-browser, playwright-skill, playwright-mcp), 3 runs each, report averaged to `benchmark-comparison.md`. The README does not show result numbers — [SawyerHood/dev-browser-eval](https://github.com/SawyerHood/dev-browser-eval)
- ABP (Agent Browser Protocol, Chromium fork that freezes JS/time between steps): "2x lower token usage, 2x faster automation runs, 2x lower tool calls, ~100ms overhead per action" — [agent-browser-protocol dev README](https://github.com/theredsix/agent-browser-protocol/tree/dev). Baseline for "2x" not stated in fetched text.
- Stagehand v3 (Oct 2025): "44.11% faster on average across iframes and shadow-root interactions" vs Stagehand v2; dropped Playwright, runs on CDP — [Browserbase blog](https://www.browserbase.com/blog/stagehand-v3)
- Stagehand v4 README: "2x faster execution than Playwright cloud equivalent browsers" on Browserbase; "Hybrid accessibility-tree trimming" for token efficiency; server-side caching "no tokens spent" on repeated calls. No methodology linked — [browserbase/stagehand](https://github.com/browserbase/stagehand)
- Browser Use benchmark page: BU fast agent 72.9 at 11¢/task, "level with Claude Sonnet 5.5 high at 14× less"; earlier "Internal Bench Hard": 82% solved at 17¢ each, "20 points better than Opus 5, which costs 20× more per solved task" — [browser-use.com/benchmarks](https://browser-use.com/benchmarks)
- Magnitude reports average steps (15.5 vs browser-use 18.11) as an efficiency metric — [magnitudedev/webvoyager](https://github.com/magnitudedev/webvoyager)
- Yutori Navigator: "3.3x faster per-step than Claude 4.5" (listed on leaderboard) — [Steel Online-Mind2Web](https://leaderboard.steel.dev/leaderboards/online-mind2web)
- rtrvr.ai (Oct 1 2026): "ran five tasks about 5× faster than OpenAI dots"; scoring large pages raised cost — [rtrvr blog](https://www.rtrvr.ai/blog)
- mcp-chrome (hangwin): comparison table claims "50-200ms inter-process communication … Faster" vs Playwright-based MCP — [hangwin/mcp-chrome](https://github.com/hangwin/mcp-chrome)
- BrowserMCP: "Fast: automation happens locally … without network latency" (qualitative) — [BrowserMCP/mcp](https://github.com/BrowserMCP/mcp)
- Playwright MCP README: recommends Playwright CLI for coding agents because CLI "avoid[s] loading large tool schemas and verbose accessibility trees into the model context" (qualitative, no numbers) — [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp)
- Playwright CLI ~27K vs Playwright MCP ~114K tokens per typical task (~4x) — search-only; widely repeated in blogs, primary source not found.
- agent-browser "up to 93% less context than Playwright MCP" (attributed to Vercel Labs/Chris Tate) — search-only; not in current README or agent-browser.dev text I fetched.
- Skyvern: rewrite 2.3x faster (Oct 2026); Rustwright 2.55x faster boot, 70% less memory than Playwright (Jul 2026) — [Skyvern blog index](https://www.skyvern.com/blog/web-bench-a-new-way-to-compare-ai-browser-agents/) (titles/teasers only)
- HyperAgent: action recording and deterministic replay "without LLM calls" for cost (qualitative) — [HyperAgent](https://github.com/hyperbrowserai/HyperAgent)
- Kernel: "<20ms" cold restarts (unikernel images) — [kernel-images](https://github.com/kernel/kernel-images)

#### Cloud browser infrastructure benchmarks (not agent quality)
- Browser Arena (Notte): open, reproducible lifecycle benchmark (create session, connect CDP, navigate, release) plus browser-throughput (10-action loops on Wikipedia) and proxy-get benchmarks; extended from Steel's [steel-dev/browserbench](https://github.com/steel-dev/browserbench) — [nottelabs/browserarena](https://github.com/nottelabs/browserarena)
- Notte leads Browser Arena: 100% reliability, 394 ms, $0.05/browser-hour; "3x faster than Browserbase, 9x faster than Browser Use" — search-only.
- Stealth Bench V2 (2026-09-25): Browser Use Cloud 90.5% (confirmed in [browser-use README](https://github.com/browser-use/browser-use)); others search-only: Anchor 82%, Kernel 80.5%, Browserbase 78.5%, Browserless 77.5%, Steel 74.5%, Hyperbrowser 73.5%. Page says plain Chrome managed 14% and 3% — [browser-use.com/benchmarks/browsers](https://browser-use.com/benchmarks/browsers)
- Halluminate BrowserBench (Nov 2025): stealth/reliability for infra; Browser Use Cloud 84.8% — [browser-use.com/benchmarks/browsers](https://browser-use.com/benchmarks/browsers)

### Inferences
- The Browser Harness eval is the best template for Playwriter: public tasks, public runner, per-task JSON, same agent per tool. Playwriter can be added as a fifth row with one changed prompt line. It also leaves gaps Playwriter can fill: Claude Code, Playwright CLI, Claude in Chrome were not measured.
- Success rate barely differs between tools when the model is fixed. The differentiating metrics are input tokens, cost, tool calls and wall time. Playwriter's code-snippet approach should mainly win on tool calls and tokens.
- Browser Use authored the eval and its own tool won on tokens, so independent reruns matter.

### Gaps
- Primary sources for "93% less context" (agent-browser) and "114K vs 27K tokens" (Playwright CLI) not found.
- dev-browser-eval result numbers not visible in README (maybe in generated report file not fetched).
- Notte Browser Arena live numbers and Stealth Bench V2 per-provider numbers not confirmed from primary pages.

## Which of these claims are reproducible (open harness and tasks)?

### Takeaway
Reproducible: BU Bench V2.1 + Browser Harness eval, omxyz/webvoyager (browser-control), Alumnium WebVoyager fork, Magnitude WebVoyager repo, ABP Online-Mind2Web results, dev-browser micro-bench and dev-browser-eval, Browser Arena, WebBench dataset. Not reproducible: OpenAI CUA/Operator/Atlas, Mariner, Gemini CU, Surfer 2 harness, Stagehand "2x faster", agent-browser "93%", Claude in Chrome safety numbers.

### Cited Findings
- BU Bench V2.1: public runner, tasks encrypted but runnable with own API keys; GitHub Actions workflow `run-benchmark.yml`; local headless browser option — [browser-use/benchmark](https://github.com/browser-use/benchmark)
- Browser Harness tool comparison: method and per-task scores published as JSON — [coding-agent-browser-tools.json](https://browser-use.com/benchmarks/coding-agent-browser-tools.json)
- browser-control WebVoyager: pinned Python deps, browser-control commit lock, Cargo lock, judge script `evaluation/auto_eval.py`, run artifacts — [omxyz/webvoyager](https://github.com/omxyz/webvoyager)
- Alumnium: code in WebVoyager fork with commit-level explanations; transcripts at webvoyager.alumnium.ai — [Alumnium blog](https://alumnium.ai/blog/webvoyager-benchmark/)
- Magnitude: repo to reproduce results; per-task results site — [magnitudedev/webvoyager](https://github.com/magnitudedev/webvoyager)
- ABP: reproducible results repo — [abp-online-mind2web-results](https://github.com/theredsix/abp-online-mind2web-results)
- dev-browser: `bun run bench/run.ts --runs 9`; dev-browser-eval scripts — [dev-browser](https://github.com/SawyerHood/dev-browser), [dev-browser-eval](https://github.com/SawyerHood/dev-browser-eval)
- Browser Arena: `npm run bench -- --benchmark=browser-throughput --provider=notte --runs=100` — [nottelabs/browserarena](https://github.com/nottelabs/browserarena)
- WebBench: dataset on HuggingFace; official scoring requires contacting Halluminate — [Halluminate/WebBench](https://github.com/Halluminate/WebBench)
- Operator Online-Mind2Web: "OpenAI did not publish judge, harness, or task-level results"; GPT-5.4 and Atlas raw data not public — [Steel Online-Mind2Web](https://leaderboard.steel.dev/leaderboards/online-mind2web)
- Surfer 2: "release of the exact Surfer 2 harness was not verified" — [Steel WebVoyager](https://leaderboard.steel.dev/leaderboards/webvoyager)
- Stagehand evals: Stagehand docs say its eval tooling can run external benchmarks (WebBench, GAIA, WebVoyager, OnlineMind2Web, OSWorld) — search-only, [stagehand.dev/evals](https://www.stagehand.dev/evals)

### Inferences
- Fastest credible path for Playwriter: (1) add a Playwriter row to the BU Bench V2.1 coding-agent eval; (2) run omxyz/webvoyager or Alumnium's fork with Claude Code + Playwriter; (3) a dev-browser-style latency micro-bench (empty script, snapshot, screenshot).

### Gaps
- Did not verify whether BU Bench task decryption keys are freely available or need a request.
- Did not verify whether dev-browser-eval's game-tracker app is public.

## Which tools use a code-writing / scripting approach (like Playwriter) vs step-by-step tool calls?

### Takeaway
Code/script approach is now mainstream among top performers: dev-browser, Browser Harness, BrowserCode, browser-control (shell CDP), CUAWright (bash + generated browser code), Stagehand (code SDK with AI primitives), HyperAgent, Playwright MCP `browser_evaluate`/`--init-page`. Step-by-step tool calls: Playwright MCP default, Chrome DevTools MCP, agent-browser (CLI commands with refs), BrowserMCP, mcp-chrome, BrowserTools MCP, Claude in Chrome, and vision CUAs (Operator, Gemini CU, Surfer, Simular).

### Cited Findings
- dev-browser: agent runs JS scripts via `dev-browser -e '...'`, e.g. `await browser.listPages()`; Playwright-based — [SawyerHood/dev-browser](https://github.com/SawyerHood/dev-browser)
- Browser Harness: drives your running Chrome over CDP; agent uses it as CLI + SKILL.md; ~self-healing helpers — [browser-use/browser-harness](https://github.com/browser-use/browser-harness)
- BrowserCode: fork of OpenCode, "drives real browsers through unconstrained CDP … writes scripts to reuse later"; `browser_execute(code)` primitive (search summary) — [browser-use/browsercode](https://github.com/browser-use/browsercode)
- browser-control: "Shell-native CDP harness" driven by Claude Code — [Steel WebVoyager](https://leaderboard.steel.dev/leaderboards/webvoyager)
- CUAWright: bash as sole action interface, filesystem for dynamic tool creation; "generated browser code" on Online-Mind2Web — [arXiv 2610.04116](https://arxiv.org/abs/2610.04116), [Steel Online-Mind2Web](https://leaderboard.steel.dev/leaderboards/online-mind2web)
- Stagehand: code SDK (TS, Python, Go) with `act`/`observe`/`extract`, "batch commands", caching — [browserbase/stagehand](https://github.com/browserbase/stagehand)
- Playwright MCP: one tool per action, plus `browser_evaluate` for JS and `--init-page` TS file — [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp)
- Playwright CLI: one shell command per action (`playwright-cli eval <func> [ref]`, `mousemove`) — [microsoft/playwright-cli](https://github.com/microsoft/playwright-cli)
- agent-browser: one CLI command per action with snapshot refs; `eval <js>` available — [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser)
- Alumnium: natural-language MCP subagent (GPT-5 nano) over Selenium, orchestrated by Claude Code — [Steel WebVoyager](https://leaderboard.steel.dev/leaderboards/webvoyager)
- HyperAgent: `page.ai()` on top of Playwright, records XPaths for replay — [HyperAgent](https://github.com/hyperbrowserai/HyperAgent)

### Inferences
- Playwriter's closest peers for a fair comparison are dev-browser and Browser Harness (both script-based, real Chrome). Its main differentiator to prove is "user's own running Chrome via extension + full Playwright API in a stateful sandbox". Only Browser Harness, Claude in Chrome and Playwright MCP `--extension` share the "your logged-in Chrome" property.
- Median tool calls in the Browser Harness eval (42 vs 57 Playwright MCP vs 67.5 DevTools MCP) suggest script-based tools reduce tool calls. Playwriter should report tool calls per task as a headline metric.

### Gaps
- Could not confirm BrowserCode's `browser_execute(code)` from the README text fetched (search-only).
- No data on whether any leaderboard accepts a pure "coding-agent + browser tool" submission besides Steel (which already lists browser-control and Alumnium).
