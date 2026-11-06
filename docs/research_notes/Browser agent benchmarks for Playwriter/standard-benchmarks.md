# Standard public benchmarks for web/browser AI agents (feasibility for Playwriter)

Research date: 2026-10-21. Leaderboard numbers are as of the "last updated" date shown on each source (Steel leaderboard: 2026-10-11). Many top scores are self-reported by vendors; see notes per item.

## Q0. Per-benchmark catalog: what it measures, size, live vs sandboxed, judging, harness, leaderboard, known problems

### Takeaway
The field splits into (a) live-web task suites judged by an LLM or rubric (WebVoyager, Online-Mind2Web, WebTailBench, Odysseys, BU Bench, WebBench, Mind2Web 2, BrowseComp, AssistantBench, ClawBench), and (b) self-hosted or replica sandboxes with programmatic checks (WebArena/-Verified, VisualWebArena, WorkArena, MiniWoB++, WebShop, REAL, WebGames, ST-WebAgentBench, OSWorld). WebVoyager and Online-Mind2Web are saturated at the top (97-99%), so they are now weak at separating strong systems.

### Cited Findings

**WebVoyager (live, 643 tasks, 15 sites, LLM judge)**
- 643 live-web tasks across 15 popular websites (search, navigation, form filling, maps/travel, shopping). — [Steel WebVoyager leaderboard](https://leaderboard.steel.dev/leaderboards/webvoyager)
- Original paper (ACL 2024) used GPT-4V as automatic judge, 85.3% agreement with humans; WebVoyager agent got 59.1%. — [arXiv 2401.13919](https://arxiv.org/abs/2401.13919)
- Top (2026-10-11): browser-control (Om Labs, Claude "Fable 5") 99.19%, self-reported, "610/615 after four documented current-impossible exclusions", GPT-5.5 judge; Alumnium 98.5%; Surfer 2 (H Company) 97.1%; Magnitude 93.9%. — [Steel WebVoyager](https://leaderboard.steel.dev/leaderboards/webvoyager)
- Steel notes: submissions "may remove stale tasks, use different judges, allow different retry budgets, or manually audit evaluator mistakes"; rows are not directly comparable. — [Steel WebVoyager](https://leaderboard.steel.dev/leaderboards/webvoyager)
- Microsoft notes that WebVoyager's evaluation "does not use the model's final output or action history". — [WebTailBench dataset card](https://huggingface.co/datasets/microsoft/WebTailBench)
- Example of task subsetting: Notte reported 86.2% on "WebVoyager30, a 30-task subset run eight times". — [Steel WebVoyager](https://leaderboard.steel.dev/leaderboards/webvoyager)

**Online-Mind2Web (live, 300 tasks, 136 sites, LLM judge + optional human eval)**
- 300 tasks from 136 websites; WebJudge (o4-mini) reaches 86% agreement with humans and a 3.8% success-rate gap; accepted to COLM 2025. — [Online-Mind2Web README](https://github.com/OSU-NLP-Group/Online-Mind2Web); [arXiv 2504.01382](https://arxiv.org/abs/2504.01382)
- Tasks are refreshed: 36 tasks replaced on 2025-11-03 (invalid or CAPTCHA sites); more updates through 2026-05-15. v2 submission schema (2026-05-23) with outsourced human evaluation. — [Online-Mind2Web README](https://github.com/OSU-NLP-Group/Online-Mind2Web)
- Leaderboard: [HF Space](https://huggingface.co/spaces/osunlp/Online_Mind2Web_Leaderboard). Steel lists Browser Use Cloud (bu-max) 97.0%, GPT-5.4 Native Computer Use 93.0%, ABP + Claude Opus 4.6 90.53%. — [Steel hub](https://leaderboard.steel.dev/)
- Paper's thesis: earlier reported web-agent results are over-optimistic ("An Illusion of Progress?"). — [arXiv 2504.01382](https://arxiv.org/abs/2504.01382)
- Criticism: ~25% of Online-Mind2Web tasks use vague "browse"/"find" instructions; only 3 flight-booking tasks. — [WebTailBench dataset card](https://huggingface.co/datasets/microsoft/WebTailBench)

**Mind2Web 2 (live, agentic search, Agent-as-a-Judge)**
- Long-horizon agentic search tasks with time-varying, citation-backed answers; Agent-as-a-Judge with tree-structured rubrics; NeurIPS'25 D&B. Agents must return URL sources. Public dev set and private test set; eval scripts released 2025-10-23. — [Mind2Web-2 README](https://github.com/OSU-NLP-Group/Mind2Web-2); [arXiv 2506.21506](https://arxiv.org/abs/2506.21506)
- 130 tasks; best system (OpenAI Deep Research) reaches 50-70% of human performance (per search summary of the paper; not re-read in full). — [arXiv 2506.21506](https://arxiv.org/abs/2506.21506)
- Eval caches cited webpages; some fail due to CAPTCHAs/login walls; a Chrome-extension "Cache Manager" exists to recapture them. Judge needs OpenAI key; some tasks need Google Maps API key. — [Mind2Web-2 README](https://github.com/OSU-NLP-Group/Mind2Web-2)

**WebArena / WebArena-Verified (sandboxed Docker, 812 tasks, deterministic)**
- WebArena: self-hosted sites (e-commerce, forum, GitLab, CMS, map, wiki), functional-correctness evaluation. — [arXiv 2307.13854](https://arxiv.org/abs/2307.13854)
- WebArena top (Steel, 812 tasks): WebTactix (DeepSeek v3.2) 74.3%, OpAgent 71.6%. — [Steel hub](https://leaderboard.steel.dev/)
- WebArena-Verified (ServiceNow): all 812 tasks audited; LLM-judge and substring matching removed in favor of deterministic, type-aware comparison; evaluators "operate on agent responses and captured network traces" (offline eval via trace replay). Hard subset = 258 tasks. pip/uvx/Docker; optimized Docker images up to 92% smaller with auto-login headers (2026-02-02). — [webarena-verified README](https://github.com/ServiceNow/webarena-verified)
- Conflict: one search summary claimed a 137-task hard subset; the README says 258. Trust README. — [webarena-verified README](https://github.com/ServiceNow/webarena-verified)

**VisualWebArena (sandboxed, visually grounded)**
- Visually grounded tasks built on WebArena-style self-hosted sites; included in BrowserGym. — [arXiv 2401.13649](https://arxiv.org/abs/2401.13649); [BrowserGym README](https://github.com/ServiceNow/BrowserGym)

**WorkArena / BrowserGym (sandboxed enterprise, ServiceNow)**
- WorkArena: 33 tasks on a remote-hosted ServiceNow instance; introduced BrowserGym. — [arXiv 2403.07718](https://arxiv.org/abs/2403.07718)
- BrowserGym is a gym framework bundling MiniWoB, WebArena, WebArenaVerified, VisualWebArena, WorkArena, AssistantBench, WebLINX, OpenApps, TimeWarp, KNOWS; Apache-2.0 per PyPI badge; AgentLab runs experiments. BrowserGym launches its own Playwright Chromium. — [BrowserGym README](https://github.com/ServiceNow/BrowserGym); [arXiv 2412.05467](https://arxiv.org/abs/2412.05467)

**WebBench (Halluminate + Skyvern; live, 2,454 open tasks / 452 sites)**
- 5,750 tasks total, 2,454 open-sourced across 452 live sites (top-1000 by traffic). Mix: READ 1,580 (64.4%), CREATE 512, UPDATE 173, DELETE 149, FILE_MANIPULATION 40. Last updated 2025-05-28. — [WebBench README](https://github.com/Halluminate/WebBench); [HF dataset](https://huggingface.co/datasets/Halluminate/WebBench)
- Write-heavy tasks (login, forms) much harder: SOTA ~46.6% vs >75% on read tasks; blockers are proxies, CAPTCHAs, auth (search summary of Halluminate report). — [Halluminate report](https://halluminate.ai/blog/benchmark); [Skyvern post](https://blog.skyvern.com/web-bench-a-new-way-to-compare-ai-browser-agents/)

**BrowseComp (OpenAI; live research, 1,266 Qs, exact answer)**
- 1,266 short-answer questions, hard to find but easy to verify. — [arXiv 2504.12516](https://arxiv.org/abs/2504.12516); [OpenAI](https://openai.com/index/browsecomp/)
- Top (Steel): GPT-5.6 Sol Ultra 92.2%, GPT-6 Astra 91.5%, Kimi K3 91.2%. — [Steel hub](https://leaderboard.steel.dev/)

**AssistantBench (live, 214 tasks, automatic metrics)**
- 214 realistic, time-consuming tasks on the open web; automatic scoring (F1 / numeric closeness); included in BrowserGym. Original best ~25% accuracy (2024, per search summary). — [HF dataset](https://huggingface.co/datasets/AssistantBench/AssistantBench); [BrowserGym README](https://github.com/ServiceNow/BrowserGym)

**REAL Bench (AGI Inc; sandboxed replicas)**
- Deterministic replicas of 11 sites (Amazon, DoorDash, United, Airbnb, Google Calendar, Gmail, OpenTable, LinkedIn, Uber, UpWork, Zillow clones; website also lists a Marriott clone); 112 tasks in paper; programmatic state checks for action tasks + rubric LLM judge for retrieval; frontier models at most 41% in the paper. — [arXiv 2504.11543](https://arxiv.org/abs/2504.11543); [agisdk README](https://github.com/agi-inc/agisdk); [realevals.ai](https://www.realevals.ai)
- Sites are "already logged in", fixed dates, "perfect replayability", configurable latency; "Bring your own system, black box systems are supported"; `/finish` returns state changes, `/submit` submits outcomes. v1 and v2 task sets. — [realevals.ai](https://www.realevals.ai); [agisdk README](https://github.com/agi-inc/agisdk)

**WebGames (Convergence; client-side sandbox)**
- 150 challenges (53 task families, 5 capability domains); single-page JS app, client-side state; each task reveals a password on success (programmatic check). Best model (gemini-2.5-pro-preview-05-06) ~50% vs 95.7% human; 61/150 unsolved by any model. Inspect AI eval scaffolding included. — [WebGames README](https://github.com/convergence-ai/webgames); [arXiv 2502.18356](https://arxiv.org/abs/2502.18356); [HF dataset](https://huggingface.co/datasets/convergence-ai/webgames)

**OSWorld (desktop VMs incl. web apps)**
- 369 tasks across real web and desktop apps, execution-based evaluation scripts. — [arXiv 2404.07972](https://arxiv.org/abs/2404.07972)
- Top (Steel): Qwen3.8-Max 86.1%, Claude Mythos Preview 85.4%; OSWorld 2.0 (108 long-horizon workflows): Claude Fable 5.1 77.9%. — [Steel hub](https://leaderboard.steel.dev/)

**WebTailBench (Microsoft; live, 609 tasks, rubric verifier)**
- 609 hand-verified tasks across 11 categories (shopping 56, flights 51, hotels 52, restaurants 52, activities 80, ticketing 57, real-estate 48, jobs 50, shopping list 51, comparison shopping 57, compositional 55) + 111 refusal tasks; MIT license. — [WebTailBench dataset card](https://huggingface.co/datasets/microsoft/WebTailBench)
- V1 tasks were calendar-bound through Nov 2025; V2 refresh on 2026-05-12 (`test_v2`). Scored with the "Universal Verifier" using precomputed rubrics. — [WebTailBench dataset card](https://huggingface.co/datasets/microsoft/WebTailBench); [arXiv 2604.06240](https://arxiv.org/abs/2604.06240v1); [Fara paper arXiv 2511.19663](https://arxiv.org/abs/2511.19663)

**BU Bench (browser-use; live, encrypted)**
- V2.1: 200 web tasks scored with weighted "findings" rubrics by an LLM judge; tasks encrypted to avoid crawler/training contamination; latest release v2.1.1 (Sept 2026, CAPTCHA + Reuters fixes). Default runner is BrowserCode with OpenAI executor; defaults 60 min per task, up to 100 concurrent tasks; `--tasks 5` and `--task-ids` for subsets; browser options include `local_headless`; runnable on GitHub Actions. — [browser-use/benchmark README](https://github.com/browser-use/benchmark)
- V1: 100 hand-selected tasks; framework comparison adapters via `run_framework_eval.py`. Stealth Bench V1: 80 tasks (71 plotted) across anti-bot sites. A historical 60-task V2 chart plots "mean rubric score by model and cost per task". — [browser-use/benchmark README](https://github.com/browser-use/benchmark)
- Conflict: a search summary said V2.1 has "180 shared tasks" with GPT-6.1 Sol medium at 79.6/100; the README says 200 tasks. I could not verify the 79.6 figure from a primary source.

**Stagehand evals (Browserbase)**
- Eval CLI for `act`/`extract`/`observe`/`agent` plus dataset suites: WebVoyager, OnlineMind2Web, WebTailBench, Odysseys, HardBench (102 tasks; 38 "core"). Runs locally or on Browserbase; Braintrust tracing. — [Stagehand evals README](https://github.com/browserbase/stagehand/blob/main/packages/evals/README.md); [HardBench README](https://github.com/browserbase/stagehand/blob/main/packages/evals/datasets/hardbenchmark/README.md)

**Steel leaderboard**
- Aggregator (not a benchmark) of source-linked scores for WebVoyager, BrowseComp, WebArena, OSWorld, GAIA, Online-Mind2Web, ClawBench, AgentBench, etc.; mixes self-reported and independent rows; accepts PRs. — [Steel hub](https://leaderboard.steel.dev/)

**BrowserArena**
- Live open-web Arena with user-submitted tasks, head-to-head comparisons, step-level human feedback; found failure modes: CAPTCHA, pop-up banners, direct URL navigation (Oct 2025). — [arXiv 2510.02418](https://arxiv.org/abs/2510.02418)

**Odysseys (CMU; live, 200 long-horizon tasks)**
- 200 long-horizon multi-site tasks from real browsing sessions, evaluated on the live Internet with graded rubric checkpoints; best model 44.5% perfect success; introduces Trajectory Efficiency (rubric score per step), best only 1.15%. — [Odysseys site](https://odysseys-website.pages.dev/)
- Search summary claims 45 easy / 46 medium / 109 hard and ~6.1 rubrics per task (not verified on primary page).

**ST-WebAgentBench (IBM; sandboxed, safety)**
- Policy-aware benchmark on BrowserGym (GitLab, ShoppingAdmin from WebArena, SuiteCRM); metric Completion-under-Policy (CuP) and Risk Ratio; ICLR 2026; Apache-2.0; HF leaderboard. — [ST-WebAgentBench README](https://github.com/segev-shlomov/ST-WebAgentBench); [arXiv 2410.06703](https://arxiv.org/abs/2410.06703)

**WebCanvas / Mind2Web-Live**
- Online eval framework using "key nodes" (intermediate states) instead of only final state; MIT. — [WebCanvas README](https://github.com/iMeanAI/WebCanvas); [arXiv 2406.12373](https://arxiv.org/abs/2406.12373); [Mind2Web-Live](https://huggingface.co/datasets/iMeanAI/Mind2Web-Live)

**WebShop, MiniWoB++, GAIA, AgentBench, ClawBench**
- WebShop: simulated store, 1.18M products, 12,087 instructions; best 2022 model 29% vs human expert 59%. — [arXiv 2207.01206](https://arxiv.org/abs/2207.01206)
- MiniWoB++: synthetic micro-tasks, included in BrowserGym. — [BrowserGym README](https://github.com/ServiceNow/BrowserGym); [MiniWoB docs](https://miniwob.farama.org/)
- GAIA: 466 questions (answers to 300 withheld for the leaderboard); needs browsing + tools; top on Steel 92.36% (OPS-Agentic-Search). — [arXiv 2311.12983](https://arxiv.org/abs/2311.12983); [Steel hub](https://leaderboard.steel.dev/)
- AgentBench: 8 environments incl. WebShop and Mind2Web-style browsing; top AgentRL w/ Qwen2.5-32B 70.4%. — [Steel hub](https://leaderboard.steel.dev/)
- ClawBench (new, found during research): 153 everyday tasks on 144 live platforms (purchases, appointments, job applications, forms); top Claude Sonnet 4.6 33.3%. — [Steel hub](https://leaderboard.steel.dev/)

### Inferences
- WebVoyager and Online-Mind2Web are near ceiling for strong systems, so a Playwriter vs Playwright MCP comparison on them would likely show small success differences; efficiency metrics (tokens, time, steps) would carry the signal.
- Live benchmarks drift, so any published Playwriter number must record the run date, the task revision (e.g. WebTailBench `test_v2`, BU Bench v2.1.1 + checksum) and which tasks were excluded.

### Gaps
- HAL (hal.cs.princeton.edu) timed out on every fetch; I could not get its Online-Mind2Web / AssistantBench cost-per-run numbers.
- Licenses not verified for: WebVoyager repo, Online-Mind2Web, Mind2Web 2, WebBench, WebGames, agisdk, Odysseys, browser-use/benchmark.
- Odysseys GitHub repo: search claimed `github.com/ljjang0/Odysseys`, but it returns 404; harness location unverified (Stagehand evals do include it).
- Exact task counts not verified from primary source: VisualWebArena (~910 from memory), WorkArena++, MiniWoB++, WebCanvas/Mind2Web-Live, ST-WebAgentBench (search said 375 tasks / 3,057 policies; README TOC lists task IDs up to 374, consistent).
- AssistantBench arXiv URL from search (2407.10615) was wrong (points to a physics paper); use the HF dataset link.

## Q1. Which benchmarks report efficiency metrics (time, steps, tokens, cost), not just success?

### Takeaway
Only a few do it first-class: Odysseys (Trajectory Efficiency), Stagehand evals (normalized tokens + list-price cost per run), BU Bench (cost per task in charts), Mind2Web 2 (asks for avg. time), HAL (cost, not verified here). Classic benchmarks (WebVoyager, WebArena, OSWorld, BrowseComp) report success only.

### Cited Findings
- Odysseys argues "efficiency is a first-class concern" and reports Trajectory Efficiency (rubric score per step); frontier agents reach 1.15%. Also plots success vs step budget. — [Odysseys site](https://odysseys-website.pages.dev/)
- Stagehand evals normalize raw token usage per SDK cache rules; compute list-price cost with `cost_source: computed`; keep "missing usage" distinct from zero; end-of-run summary per harness × tool × model. — [Stagehand harness contract](https://github.com/browserbase/stagehand/blob/main/packages/evals/docs/harness-contract.md)
- Stagehand warns step budgets are not comparable across harnesses: Codex/Cursor count tool calls, Claude Code/Pi count turns, Mastra counts model steps; "These are execution limits, not comparable measures of model efficiency." — [Stagehand harness contract](https://github.com/browserbase/stagehand/blob/main/packages/evals/docs/harness-contract.md)
- BU Bench historical chart: "mean rubric score by model and cost per task". — [browser-use/benchmark README](https://github.com/browser-use/benchmark)
- Mind2Web 2 submission optionally includes "avg. time". — [Mind2Web-2 README](https://github.com/OSU-NLP-Group/Mind2Web-2)
- REAL observations include `elapsed_time`; sites have configurable mock latency. — [agisdk README](https://github.com/agi-inc/agisdk); [realevals.ai](https://www.realevals.ai)
- Steel adds model price class (token price) per row but not measured run cost. — [Steel WebVoyager](https://leaderboard.steel.dev/leaderboards/webvoyager)

### Inferences
- For Playwriter, the publishable story is likely "same success, fewer tokens / less wall time / fewer turns". We must collect tokens, wall-clock and tool calls ourselves (e.g. from Claude Code / Codex JSON transcripts), because most benchmark harnesses do not.
- Turn counts differ by harness design (Playwriter runs multi-step JS per call), so report tokens and wall time as primary efficiency metrics; tool calls as secondary.

### Gaps
- No primary source found with measured cost per task for Playwright MCP / Chrome DevTools MCP on a standard benchmark.
- Search results claimed CLI vs MCP numbers (e.g. "CLI 77/100 vs MCP 60/100, 33% better token efficiency", "27K vs 114K tokens") but gave no verifiable source; treat as unverified.

## Q2. Which can run against a real logged-in Chrome? Which are sandboxed and reproducible offline?

### Takeaway
Any live-web benchmark whose judge reads only the final answer + trajectory/screenshots can run in the user's real Chrome (WebVoyager, Online-Mind2Web, WebTailBench, Odysseys, BU Bench with a local browser, Mind2Web 2, BrowseComp, AssistantBench, WebBench, ClawBench). Reproducible sandboxes are WebArena-Verified, REAL, WebGames, WorkArena, MiniWoB++, WebShop, ST-WebAgentBench, OSWorld. Of these, WebArena-Verified, REAL and WebGames are tool-agnostic enough to drive with Playwriter.

### Cited Findings
- BU Bench supports browser providers incl. `local_headful` and `local_headless`, and notes a local browser needs no Browser Use key. — [browser-use/benchmark README](https://github.com/browser-use/benchmark)
- Stagehand evals: `-e local|browserbase` chooses where the browser runs; harness uses a runner-owned tool mount (`stagehand_facade`, a "Playwright-batch MCP surface"); adapters "do not start a second browser". — [Stagehand evals README](https://github.com/browserbase/stagehand/blob/main/packages/evals/README.md); [harness contract](https://github.com/browserbase/stagehand/blob/main/packages/evals/docs/harness-contract.md)
- WebArena-Verified evaluators work on agent responses and captured network traces; offline evaluation via trace replay. — [webarena-verified README](https://github.com/ServiceNow/webarena-verified)
- REAL: "Bring your own system", black-box systems supported, framework agnostic, local evaluation; deterministic, pre-logged-in replicas. — [realevals.ai](https://www.realevals.ai); [agisdk README](https://github.com/agi-inc/agisdk)
- WebGames: client-side single-page app, can run locally (`pnpm run dev`), success verified by password in last message. — [WebGames README](https://github.com/convergence-ai/webgames)
- BrowserGym benchmarks (WorkArena, MiniWoB, VisualWebArena, AssistantBench, ST-WebAgentBench) use BrowserGym's own Playwright env and action space. — [BrowserGym README](https://github.com/ServiceNow/BrowserGym); [ST-WebAgentBench README](https://github.com/segev-shlomov/ST-WebAgentBench)
- WebBench WRITE tasks need logins and 2FA; infra blockers are proxies, CAPTCHAs and auth. — [WebBench README](https://github.com/Halluminate/WebBench)
- Online-Mind2Web replaced tasks on CAPTCHA sites; BrowserArena found CAPTCHAs and pop-ups are main failure modes. — [Online-Mind2Web README](https://github.com/OSU-NLP-Group/Online-Mind2Web); [arXiv 2510.02418](https://arxiv.org/abs/2510.02418)

### Inferences
- A real, residential, logged-in Chrome is a real advantage on live benchmarks (fewer CAPTCHAs/bot blocks, logins already present). This is a fairness issue: Playwright MCP launches a fresh browser by default. Report both "Playwriter real profile" and "Playwriter clean profile" runs, or run all tools in the same Chrome profile, to separate tool quality from infra advantage.
- Logged-in profiles add personalization (search results, cookies, recommendations) that change task outcomes; use a dedicated Chrome profile for benchmark runs.
- BrowserGym-based suites need an adapter that lets the external agent act through Playwriter while BrowserGym only scores; WebArena-Verified avoids this because scoring uses agent output + network traces (we would need to export a HAR from Playwriter).
- WebBench WRITE tasks would need real accounts on hundreds of sites; impractical without account setup and risky (real side effects).

### Gaps
- Not verified whether WebArena-Verified's network-trace format is a standard HAR that Playwriter can produce; check its docs.
- Not verified whether Stagehand's harness lets you swap the tool surface for an external MCP/CLI such as Playwriter or Playwright MCP (only `stagehand_facade` variants documented).

## Q3. Which have small subsets suitable for a quick 30-100 task comparison?

### Takeaway
Good small sets exist: WebArena-Verified Hard (258, or sample from it), Stagehand HardBench core (38), BU Bench V1 (100) or `--tasks N` on V2.1, WebTailBench per-category (48-80 each), Odysseys easy (≈45), REAL v2 (per-site), WebGames (150 fast tasks), WebVoyager30-style samples.

### Cited Findings
- WebArena-Verified Hard subset: 258 tasks "for faster, lower-cost evaluation"; `--task-ids` for single tasks. — [webarena-verified README](https://github.com/ServiceNow/webarena-verified)
- Stagehand: `-l/--limit`, `-s/--sample`, `-f/--filter`; HardBench core 38 tasks, extended 64 more; `EVAL_HARDBENCHMARK_IDS` for fixed IDs. — [Stagehand evals README](https://github.com/browserbase/stagehand/blob/main/packages/evals/README.md); [HardBench README](https://github.com/browserbase/stagehand/blob/main/packages/evals/datasets/hardbenchmark/README.md)
- BU Bench: `--tasks 5`, `--task-ids ...`; V1 is 100 tasks. — [browser-use/benchmark README](https://github.com/browser-use/benchmark)
- WebTailBench category sizes 48-80. — [WebTailBench dataset card](https://huggingface.co/datasets/microsoft/WebTailBench)
- Notte used a 30-task WebVoyager subset run 8 times. — [Steel WebVoyager](https://leaderboard.steel.dev/leaderboards/webvoyager)
- WebGames: 150 tasks, each fast, client-side. — [WebGames README](https://github.com/convergence-ai/webgames)
- REAL: 112 tasks in paper across 11 sites. — [arXiv 2504.11543](https://arxiv.org/abs/2504.11543)

### Inferences
- With 30-100 tasks, success differences under ~10 points are within noise; repeat runs (3x) or use paired per-task comparisons. Fixed task IDs must be published so others can reproduce.
- Small subsets of BU Bench cannot be published as plaintext (encrypted, "do not publish decrypted tasks"), but scores with task IDs can.

### Gaps
- No source gives statistically validated minimum subset sizes for these benchmarks.

## Q4. Which have been used to compare MCP browser tools or coding-agent harnesses (Claude Code, Codex)?

### Takeaway
Stagehand evals is the only open harness found that natively runs Claude Code, Codex, Cursor, Pi etc. as harnesses over WebVoyager / Online-Mind2Web / WebTailBench / Odysseys with cost tracking. On WebVoyager, several top entries are Claude Code + a browser tool (browser-control CDP tool, Alumnium MCP, Magnitude). BU Bench V1 has a framework-comparison runner.

### Cited Findings
- Stagehand evals: `--harness claude_code`, `--harness codex`, cursor, Pi, Claude CUA, Gemini CUA, Mastra, DeepAgents; onboarding runs `run b:webvoyager -l 3 --harness claude_code -e local`. — [Stagehand evals README](https://github.com/browserbase/stagehand/blob/main/packages/evals/README.md); [harness contract](https://github.com/browserbase/stagehand/blob/main/packages/evals/docs/harness-contract.md)
- WebVoyager #1 browser-control: "Shell-native CDP harness driving Fable 5 … Published runner names claude-fable-5 through Claude Code with the public browser-control CDP tool"; #2 Alumnium: "Claude Code orchestrating Alumnium MCP with GPT-5 Nano + Selenium" (Claude Code/Sonnet 4.6 orchestrator); Magnitude 93.9% "pins claude-sonnet-4-20250514 through Claude Code". — [Steel WebVoyager](https://leaderboard.steel.dev/leaderboards/webvoyager)
- BU Bench V1 compares agent frameworks (chart "Comparing Agent Frameworks") with `run_framework_eval.py --list-frameworks`. — [browser-use/benchmark README](https://github.com/browser-use/benchmark)

### Inferences
- The most credible apples-to-apples Playwriter post: Claude Code (same model, same prompt) × {Playwriter, Playwright MCP, Chrome DevTools MCP, agent-browser} on a fixed task set, logging success + tokens + wall time. WebVoyager precedent (browser-control, Alumnium) shows Claude Code harness results are accepted on Steel.
- Extending Stagehand evals with a "playwriter" tool surface may be the cheapest path to reuse their judges and cost accounting, but needs a code change upstream or in a fork.

### Gaps
- Found no peer-reviewed or primary-source benchmark comparing Playwright MCP vs Chrome DevTools MCP vs agent-browser on a standard benchmark with numbers.

## Q5. Ranking for Playwriter (useful + cheap)

### Takeaway
Best first targets: (1) WebArena-Verified Hard sample, (2) Online-Mind2Web, (3) WebTailBench v2 subset, (4) Stagehand evals as runner, (5) Odysseys subset for efficiency, (6) WebGames as cheap capability smoke test. Avoid as primary: WebVoyager alone (saturated, stale), WebBench WRITE, OSWorld, BrowseComp/GAIA/Mind2Web 2 (search-heavy, measure model more than tool).

### Cited Findings
- Ranking inputs: WebArena-Verified deterministic and offline-scorable [README](https://github.com/ServiceNow/webarena-verified); Online-Mind2Web maintained, 86% judge agreement, free auto-eval review [README](https://github.com/OSU-NLP-Group/Online-Mind2Web); WebTailBench refreshed 2026-05, MIT, rubric verifier [card](https://huggingface.co/datasets/microsoft/WebTailBench); Stagehand evals has Claude Code/Codex harnesses + cost [README](https://github.com/browserbase/stagehand/blob/main/packages/evals/README.md); Odysseys efficiency metric [site](https://odysseys-website.pages.dev/); WebGames fast, local, password-verified [README](https://github.com/convergence-ai/webgames); WebVoyager saturated 99.19% [Steel](https://leaderboard.steel.dev/leaderboards/webvoyager).

### Inferences
| Rank | Benchmark | Why for Playwriter | Cost/effort |
| --- | --- | --- | --- |
| 1 | WebArena-Verified (Hard, sample 50-100) | Deterministic, reproducible, credible; tool-agnostic scoring | Docker setup (GitLab/map heavy); no judge cost |
| 2 | Online-Mind2Web (300 or 50-100 sample) | Standard live benchmark, real Chrome fits, free auto-eval | Judge = o4-mini, cheap; live drift |
| 3 | WebTailBench v2 (2-3 categories) | Fresh 2026 tasks, bookings/forms where real Chrome helps | Rubric verifier LLM cost |
| 4 | Stagehand evals as runner | Already runs Claude Code/Codex, tracks tokens/cost | Needs Playwriter tool-surface adapter |
| 5 | Odysseys (easy+medium) | Efficiency metric matches Playwriter's pitch | Long tasks, expensive per task |
| 6 | WebGames (150) | Fast, local, programmatic; tests odd interactions (drag, right-click, scroll) | Very cheap |
| 7 | BU Bench V2.1 subset | Hard live tasks, local browser option, encrypted | Default runner is BrowserCode; needs adapter |
| 8 | REAL v2 | Logged-in replicas of Gmail/Amazon etc, deterministic | agisdk harness, black-box mode |
| 9 | WebVoyager | Most recognized name; Claude Code entries exist | Saturated, stale tasks, weak judge |
| Low | WebBench, BrowseComp, GAIA, Mind2Web 2, AssistantBench, OSWorld, MiniWoB++, WebShop, AgentBench, ST-WebAgentBench, BrowserArena | Measure model/search, need accounts, desktop, or are toy/legacy | Varies |

### Gaps
- No measured dollar cost per full run found for any of these with Claude Code; must be estimated by a pilot run.
