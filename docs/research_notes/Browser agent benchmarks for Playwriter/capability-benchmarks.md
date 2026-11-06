# Capability benchmarks for browser automation (stealth, auth, hard UI, resources)

Research date: Oct 21, 2026. Scope: benchmarks and test suites that measure browser-automation capabilities beyond plain task success, with methods, scoring, and published results for competitors of Playwriter.

## Bot-detection / stealth benchmarks: what exists, how they score, what results are published

### Takeaway
There are now three public infra-stealth benchmarks with published per-provider results: Browser Use **Stealth Bench V1** (71 high-security sites; Browser Use Cloud 81%, Anchor 77%, Kernel 67%, Steel 47%, Browserbase 42%, Hyperbrowser 40%), Halluminate **BrowserBench** (292 sites, scored as "stealth failure rate"; Anchor stealth 1.7% best), and the engine-level **techinz/browsers-benchmark** (Cloudflare/DataDome/Akamai/Kasada/etc., plus memory/CPU, reCAPTCHA v3 score, CreepJS). All of them test fresh/cloud or freshly launched local browsers. None tests "the user's own real running Chrome", which is Playwriter's angle. The Browser Use runner already has `local_headful`/`local_headless` providers, so a Playwriter adapter would be the direct way to get comparable numbers.

### Cited Findings

**Browser Use Stealth Bench V1 (published March 21, 2026)**
- Built from 300,000 security-check events from Browser Use production traffic; the 71 most common sites where agents got blocked, grouped by anti-bot vendor: Cloudflare 23, PerimeterX 18, DataDome 13, Akamai 8, reCAPTCHA 6, Others (incl. Kasada, Shape) 3 — [Browser Use blog](https://browser-use.com/posts/stealth-benchmark)
- Scoring: simple 3-step tasks per site (search, visit page, read link), no auth; an LLM judge (`gemini-2.5-flash`) only judges whether the agent was blocked, not task correctness; page-load failures count as blocks — [Browser Use blog](https://browser-use.com/posts/stealth-benchmark)
- Control experiments on a datacenter IP (GitHub Actions): headless Chromium 2%, headful Chromium 50% — [Browser Use blog](https://browser-use.com/posts/stealth-benchmark)
- Results (same agent/model `bu-2-0`, multiple runs): Browser Use Cloud 81%, Anchor 77%, Kernel 67%, Steel 47%, Browserbase 42%, Hyperbrowser 40%. Browser Use Cloud per vendor: Cloudflare 93%, Akamai 85%, PerimeterX 81% — [Browser Use blog](https://browser-use.com/posts/stealth-benchmark)
- Vendor note (biased source): "Most major competitors report the same fingerprint: headful Linux Chromium… if your provider's user-agent starts with `Mozilla/5.0 (X11; Linux x86_64)`, run." — [Browser Use blog](https://browser-use.com/posts/stealth-benchmark)
- Open source runner: `uv run python run_eval.py --benchmark Stealth_Bench_V1 --browser <provider>`; providers: `browser-use-cloud`, `anchor`, `browserbase`, `browserless`, `hyperbrowser`, `onkernel`, `steel`, `local_headful`, `local_headless`. Tasks are encrypted (80 tasks in file, plots use a 71-task subset). Judge needs `GOOGLE_API_KEY` — [browser-use/benchmark README](https://github.com/browser-use/benchmark)
- Same post re-ran Halluminate BrowserBench: Browser Use Cloud 84.8%, Hyperbrowser 76.4%, Anchor 76.0%, Steel 73.3%, Browserbase 70.3% — [Browser Use blog](https://browser-use.com/posts/stealth-benchmark)

**"Stealth Bench V2" (100 sites) — UNVERIFIED**
- A Google-search summary reported a "Stealth Bench V2" on 100 bot-protected sites, referenced in a Sept 25, 2026 article: Browser Use 90.5%, Anchor 82%, Kernel 80.5%, Browserbase 78.5%, Browserless 77.5%, Steel 74.5%, Hyperbrowser 73.5%. I could not find the primary page; the browser-use/benchmark README (fetched Oct 21, 2026) documents only Stealth Bench V1. Treat as unconfirmed — [search summary only; README for comparison](https://github.com/browser-use/benchmark)

**Halluminate BrowserBench (published Nov 22, 2025)**
- "The first benchmark built specifically to measure browser infrastructure for web agents": 292 tasks on 292 websites, simple read-based tasks of 5–25 steps; 83% .com, 17% .gov/.edu/.org — [Halluminate blog](https://halluminate.ai/blog/browserbench)
- Site selection: ~150 highest proxy/CAPTCHA-failure sites from 450+ WebBench sites (top: alltrails.com, dickssportinggoods.com, crunchbase.com, open.spotify.com, deezer.com…), plus ~150 top popular sites — [Halluminate blog](https://halluminate.ai/blog/browserbench)
- Metric: Stealth Failure Rate = trajectories failed due to proxy/CAPTCHA issues; human graders for primary results; calibrated LLM judge has 90.4% alignment on stealth failures, 92.8% on accuracy. Agent fixed: Browser Use + GPT-OSS — [Halluminate blog](https://halluminate.ai/blog/browserbench)
- Results (stealth failure rate, lower is better): Anchor Stealth 1.7%, Hyperbrowser Stealth 2.7%, Browserbase Stealth 3.4%, Steel No Stealth 4.7%, Anchor No Stealth 5.0%, Hyperbrowser No Stealth 6.5%, Steel Stealth 6.8%, Browserbase No Stealth 6.8%. Stealth failures were 15% (118/786) of all agent failures — [Halluminate blog](https://halluminate.ai/blog/browserbench)
- In WebBench, the same infra issues "could impact accuracy by 25-50%" — [Halluminate blog](https://halluminate.ai/blog/browserbench)
- Links: [GitHub](https://github.com/Halluminate/BrowserBench), [HF dataset](https://huggingface.co/datasets/Halluminate/BrowserBench), [leaderboard](https://browserbench.ai) — [Halluminate blog](https://halluminate.ai/blog/browserbench)
- Note: Browser Use's re-run reports success rates (70–85%) while Halluminate reports failure rates (1.7–6.8%); the two numbers are different metrics and should not be compared directly — [Browser Use blog](https://browser-use.com/posts/stealth-benchmark); [Halluminate blog](https://halluminate.ai/blog/browserbench)

**techinz/browsers-benchmark (engine-level, open source, 406 stars)**
- Tests engines against Cloudflare, DataDome, Amazon, Google Search, Ticketmaster (Imperva), Akamai, PerimeterX/HUMAN, Kasada, Reddit; also measures memory, CPU, page load, reCAPTCHA v3 score (antcpt.com/score_detector), CreepJS, IP leak and WebRTC leak — [techinz/browsers-benchmark](https://github.com/techinz/browsers-benchmark)
- Engines: Playwright, Camoufox, Patchright, tf-playwright-stealth, CloakBrowser, Selenium, SeleniumBase, NoDriver, ZenDriver, AdsPower — [techinz/browsers-benchmark](https://github.com/techinz/browsers-benchmark)
- Sample bypass rates: patchright 100%, cloakbrowser 90%, camoufox_headless 90%, nodriver-chrome 80%, adspower 80%, seleniumbase-cdp 80%, playwright-chrome 60%, playwright-chrome_headless 40%, patchright_headless 40%, camoufox (headful) 30% — [techinz/browsers-benchmark](https://github.com/techinz/browsers-benchmark)
- Almost all engines got reCAPTCHA v3 score 0.90; CreepJS trust/bot scores were 0 for all because CreepJS disabled those scores ([creepjs#292](https://github.com/abrahamjuliot/creepjs/issues/292)), so CreepJS score is currently not a usable metric — [techinz/browsers-benchmark](https://github.com/techinz/browsers-benchmark)
- Requires one clean proxy per engine; results are a single sample run, small target count (10 targets → 10% steps) — [techinz/browsers-benchmark](https://github.com/techinz/browsers-benchmark)

**Other stealth repos and tools found (not fetched in detail)**
- [pim97/anti-detect-browser-tools-tech-comparison](https://github.com/pim97/anti-detect-browser-tools-tech-comparison), [rebrowser/rebrowser-patches](https://github.com/rebrowser/rebrowser-patches), [daijro/camoufox](https://github.com/daijro/camoufox), [ultrafunkamsterdam/nodriver](https://github.com/ultrafunkamsterdam/nodriver), [Kaliiiiiiiiii-Vinyzu/patchright-python](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright-python) — [Google search summary](https://github.com/techinz/browsers-benchmark)
- Fingerprint test pages commonly used: [bot.sannysoft.com](https://bot.sannysoft.com), [CreepJS](https://abrahamjuliot.github.io/creepjs), [antcpt reCAPTCHA score detector](https://antcpt.com/score_detector) — [techinz/browsers-benchmark](https://github.com/techinz/browsers-benchmark)

### Inferences
- Playwriter drives the user's real headful Chrome on a residential IP with a real profile, history, and cookies. This is the opposite of the 2% headless control and close to "real human". The obvious headline experiment: run Stealth Bench V1 with a new `playwriter` provider vs `local_headful`, `local_headless`, and cloud providers. Same agent, same model, same judge.
- Caveat for fairness: chrome.debugger attaches CDP to the tab, and some detectors look for CDP side effects (e.g. `Runtime.enable` leaks that rebrowser-patches and patchright fix). Playwriter may still be detectable through these. A test on bot.sannysoft.com, the rebrowser bot detector, and a CDP-detection page would show this honestly.
- Real-profile benefits (cookies with trust history, logged-in Google) likely help most on reCAPTCHA v3 and Cloudflare Turnstile, where reputation matters. That is an inference, not measured.
- BrowserBench is the easier one to run (public HF dataset, open harness); Stealth Bench is harder and better at separating providers.

### Gaps
- Could not verify "Stealth Bench V2" (100 sites, 90.5%) from a primary source.
- No published stealth results found for Playwright MCP, Chrome DevTools MCP, agent-browser, Stagehand local, or any extension-based tool (Claude in Chrome, Browser MCP, Playwriter).
- Did not fetch vendor-specific posts from Scrapfly, ZenRows, Bright Data, Kernel, Steel, Anchor on stealth; no numbers from them are included.
- No public DataDome / PerimeterX / fingerprint.com "official test page" benchmark found beyond the site-based tests above.

## Benchmarks for authenticated / personal tasks and the user's own logged-in browser (including prompt-injection safety evals)

### Takeaway
Mainstream task benchmarks deliberately exclude logins (WebVoyager, Online-Mind2Web) or use sandboxed clones with fake accounts (WebArena, REAL). No public benchmark found that scores agents on the user's own logged-in browser. The only published numbers in the "real logged-in browser" setting are safety numbers: Anthropic's Claude in Chrome prompt-injection attack success rates, plus academic security benchmarks (WASP, ST-WebAgentBench). This is an open niche Playwriter could define.

### Cited Findings
- WebVoyager reportedly removed tasks requiring login or CAPTCHA; Online-Mind2Web states "All tasks can be executed without login" — [Google search summary citing](https://github.com/OSU-NLP-Group/Online-Mind2Web) the [Online-Mind2Web repo](https://github.com/OSU-NLP-Group/Online-Mind2Web) and [WebVoyager paper](https://arxiv.org/abs/2401.13919) (not verified directly; check before quoting)
- WebArena uses self-hosted clones (e-commerce, forum, GitLab, CMS, map) with pre-made accounts; tasks are 812 — [WebArena paper](https://arxiv.org/abs/2307.13854) (from search summary)
- REAL Bench (AGI Inc.) uses "near-exact replicas of the most popular real-life sites", powered by the AGI SDK — [agi-inc/agisdk](https://github.com/agi-inc/agisdk) (from search summary)
- Browser Use's Oct 20, 2026 tool comparison ran Browser Harness, Playwright MCP, Chrome DevTools MCP and agent-browser on 100 BU Bench V2.1 tasks, but all on "a fresh cloud browser every time, not your logged-in Chrome" — [Browser Use blog](https://browser-use.com/posts/best-mcp-servers-to-control-a-browser)
- Results of that matched eval (Codex CLI + GPT-6 Luna medium, measured Oct 14, 2026): Browser Harness 60.4 score / 2.1M median input tokens / 42 tool calls / $0.042 / 9.0 min; Playwright MCP 60.0 / 4.4M / 57 / $0.066 / 8.3 min; Chrome DevTools MCP 61.0 / 6.7M / 67.5 / $0.097 / 8.7 min; agent-browser 56.3 / 3.3M / 45 / $0.056 / 11.3 min. All score differences inside 95% intervals that include zero — [Browser Use blog](https://browser-use.com/posts/best-mcp-servers-to-control-a-browser)
- The same post documents logged-in-Chrome modes: Playwright MCP `--extension`, Chrome DevTools MCP `--autoConnect` (Chrome 144+), agent-browser `--auto-connect` / `--profile Default` (works on a copy), Browser MCP (extension, one tab, last npm release April 2025), Browser Harness (CDP via chrome://inspect remote debugging toggle) — [Browser Use blog](https://browser-use.com/posts/best-mcp-servers-to-control-a-browser)
- Chrome DevTools MCP docs say the default WebDriver-controlled launch causes some sites to block sign-in — [Browser Use blog](https://browser-use.com/posts/best-mcp-servers-to-control-a-browser)
- Per-task data file for that eval: [coding-agent-browser-tools.json](https://browser-use.com/benchmarks/coding-agent-browser-tools.json) — [Browser Use blog](https://browser-use.com/posts/best-mcp-servers-to-control-a-browser)

**Prompt-injection safety in the user's own browser**
- Claude in Chrome pilot (Aug 25, 2025): 123 test cases, 29 attack scenarios; autonomous mode without mitigations 23.6% attack success rate (ASR), with mitigations 11.2%; a "challenge" set of 4 browser-specific attacks (hidden DOM form fields, URL text, tab title) went from 35.7% to 0% — [Anthropic](https://www.anthropic.com/news/claude-for-chrome)
- Nov 24, 2025 update with adaptive "Best-of-N" attacker (100 attempts per environment, ~2,200–3,200 attempts per bar): Opus 4.5 8.0% model only → 1.4% with improved safeguards; Sonnet 4.5 13.8% → 1.9%; Haiku 4.5 12.0% → 2.4%; Sonnet 4 13.8% → 2.0%. "A 1% attack success rate… still represents meaningful risk" — [Anthropic research](https://www.anthropic.com/research/prompt-injection-defenses)
- Anthropic also points to Gray Swan's industry indirect-prompt-injection arena — [Anthropic research](https://www.anthropic.com/research/prompt-injection-defenses); [Gray Swan arena](https://app.grayswan.ai/arena/challenge/indirect-prompt-injection/rules)
- WASP (Meta, Apr 2025): end-to-end web agent prompt-injection benchmark; attacks partially succeed in up to 86% of cases but agents often fail to fully complete attacker goals ("security by incompetence") — [arXiv 2504.18575](https://arxiv.org/abs/2504.18575); code [facebookresearch/wasp](https://github.com/facebookresearch/wasp)
- ST-WebAgentBench: safety/policy adherence for enterprise web agents; "Completion Under Policy" was under two-thirds of nominal completion for three SOTA agents — [ST-WebAgentBench repo](https://github.com/segev-shlomov/ST-WebAgentBench) (from search summary)
- Later Claude system-card figures (e.g., Opus 4.6, Opus 5 ASR numbers) appeared only in a search summary and were not verified — [Anthropic transparency hub](https://www.anthropic.com/transparency)

### Inferences
- Playwriter could publish the first "logged-in tasks" benchmark: a small task set on real services the tester is logged into (GitHub notifications, Amazon order history, Google Calendar read, Notion page edit, X bookmarks). Fresh-browser tools must fail these or need cookie export. Score: completed without any login step / human help. Note Tommy's rule: do not drive Google sites with Playwriter, so pick non-Google services.
- A self-hosted variant is reproducible: run WebArena-style apps locally, log in once in the real Chrome, then compare tools that reuse that session vs tools that start fresh.
- Safety is the obvious counter-argument to "your real logged-in browser". Running WASP or Anthropic-style hidden-DOM injections through Playwriter would show the risk honestly; Playwriter is an automation layer, so ASR mostly depends on the model, not the tool.

### Gaps
- No benchmark found that evaluates agents in the user's own running, logged-in browser for capability (not safety).
- OpenAI ChatGPT Atlas: no primary eval numbers fetched. Search summary claimed a discontinuation notice (Aug 2026); unverified.
- AgentDojo browser variant: not researched in detail.

## Hard-UI test suites (iframes, shadow DOM, canvas, drag and drop, uploads, downloads, dialogs, multi-tab)

### Takeaway
Two families exist: agent benchmarks with hard interactions (WebGames: 50+ challenges, best AI 43.1% vs human 95.7% in the paper; MiniWoB++: 100+ synthetic tasks incl. drag/scroll; BrowserGym which wraps them), and classic QA practice sites (the-internet.herokuapp, UI Testing Playground, Expand Testing) that isolate exactly one hard pattern per page. No published results compare MCP/automation tools (as opposed to models) on these patterns. A tool-level "hard-UI" suite built from these pages is an open gap.

### Cited Findings
- WebGames (Convergence, arXiv Feb 25, 2025): 50+ interactive challenges "straightforward for humans" covering fundamental browser interactions, advanced input processing, cognitive tasks, workflow automation, interactive entertainment; hermetic, client-side, verifiable ground truth; best AI system 43.1% vs humans 95.7% (GPT-4o, Claude Computer-Use, Gemini-1.5-Pro, Qwen2-VL evaluated) — [arXiv 2502.18356](https://arxiv.org/abs/2502.18356)
- WebGames is hosted at [webgames.convergence.ai](https://webgames.convergence.ai), dataset at [HF convergence-ai/webgames](https://huggingface.co/datasets/convergence-ai/webgames) — [arXiv 2502.18356](https://arxiv.org/abs/2502.18356)
- A later approach (accessibility tree + selective vision) was reported to reach ~85% on WebGames vs ~50% prior agents — [search summary only, unverified]
- MiniWoB++ (Farama Foundation): 100+ synthetic web environments (buttons, forms, date pickers, drag); agents of all strategies struggle with drag/scroll tasks — [MiniWoB++ repo](https://github.com/Farama-Foundation/MiniWoB-plusplus) (from search summary)
- BrowserGym unifies MiniWoB, WebArena, VisualWebArena, WorkArena, AssistantBench under a Gymnasium API — [BrowserGym repo](https://github.com/ServiceNow/BrowserGym) (search summary gave a different URL; ServiceNow is the known owner, verify)
- BU Bench V1 includes 20 "Custom: page interaction challenges" among its 100 tasks — [browser-use/benchmark README](https://github.com/browser-use/benchmark)
- QA practice sites: [the-internet.herokuapp.com](https://the-internet.herokuapp.com/) (iframes, nested frames, JS alerts, drag and drop, file upload/download, shadow DOM, dynamic loading, multiple windows, basic/form auth); [UI Testing Playground](http://uitestingplayground.com/) (dynamic IDs, AJAX waits, click interception, overlapped elements, shadow DOM, file upload, frames); [Expand Testing](https://practice.expandtesting.com/) (50+ pages incl. shadow DOM, iframes, drag-drop, JS dialogs); plus [DemoQA](https://demoqa.com), [SauceDemo](https://www.saucedemo.com), [Tricentis Obstacle Course](https://obstaclecourse.tricentis.com) — [Google search summary]
- Browser Use notes Browser Harness clicks are coordinate CDP mouse events "so they go through iframes, shadow DOM and cross-origin frames"; Playwright MCP needs `--caps=vision` for coordinate clicks; Browser MCP has no tools to open or switch tabs — [Browser Use blog](https://browser-use.com/posts/best-mcp-servers-to-control-a-browser)

### Inferences
- Best tool-level comparison: a fixed checklist of ~20 hard patterns (cross-origin iframe click, closed shadow root input, canvas drag, HTML5 drag and drop, file upload, file download to disk, alert/confirm/prompt, beforeunload, popup/new tab, OAuth popup, `<select>` native dropdown, contenteditable, right-click menu, hover-only menu, infinite scroll, clipboard, print dialog, permission prompt, basic auth, network-blocked request). Run each tool with the same agent; score pass/fail per pattern. Pages from the-internet + Expand Testing + WebGames cover most.
- Playwriter has full Playwright API (setInputFiles, download events, dialog handlers, frameLocator, page events for popups) plus raw CDP. Tools exposing only a fixed set of MCP actions (Browser MCP's 12 tools, Playwright MCP default caps) likely miss downloads, dialogs or multi-tab. This is a hypothesis to test, not a finding.
- Caveat: chrome.debugger cannot attach to some pages (chrome:// pages, other extensions, Chrome Web Store). That is a known limit to include in an honest suite.

### Gaps
- "ElementBench" not found.
- No published per-tool (MCP server / framework) pass rates on iframes/shadow DOM/downloads/dialogs found.
- WebGames per-category results for tool harnesses (not models) not found.

## Resource usage: memory/CPU of an extra Chrome vs reusing one; startup latency

### Takeaway
Published numbers exist only for launching new browsers: a freshly launched local Chromium engine used ~0.5–1.4 GB RAM in techinz's benchmark, and cloud providers take 0.8–8 s median to create+connect+navigate+release a session (Steel's 5,000-run benchmark). No source measured the marginal cost of attaching to an already running Chrome, which is Playwriter's model; that needs our own measurement.

### Cited Findings
- techinz resource table (one run, page load under test): playwright-chrome_headless 517 MB / 7.4% CPU; playwright-chrome (headful) 1,103 MB / 28.5%; patchright 1,314 MB / 53.3%; patchright_headless 1,277 MB / 16.6%; nodriver-chrome 1,389 MB / 47.4%; camoufox 1,181 MB / 53.3%; selenium-chrome 1,034 MB / 29.8%; adspower 130 MB / 7.0% (AdsPower likely measures only part of the process tree, an artefact) — [techinz/browsers-benchmark](https://github.com/techinz/browsers-benchmark)
- Steel's remote browser benchmark (5,000 runs per provider, AWS EC2 us-east-1, goto google.com, 10 warm-ups): total create→connect→goto→release median: Kernel 776 ms, Steel 867 ms, Browserbase 2,888 ms, Hyperbrowser 3,665.5 ms, Anchor 7,919 ms; p95: 1,006 / 1,090 / 3,886 / 5,338 / 11,561 ms — [steel-dev/browserbench](https://github.com/steel-dev/browserbench)
- Stage breakdown averages: CDP connect over Playwright `connectOverCDP` Kernel 288 ms, Steel 175 ms, Browserbase 1,794 ms, Hyperbrowser 348 ms, Anchor 184 ms; session create Anchor 3,797 ms, Hyperbrowser 1,732 ms — [steel-dev/browserbench](https://github.com/steel-dev/browserbench)
- Reliability: Kernel, Steel, Browserbase, Hyperbrowser 100% after SDK retries; Anchor 97.34% (133 failures in 5,000) — [steel-dev/browserbench](https://github.com/steel-dev/browserbench)
- Steel's benchmark is vendor-run (Steel) and measures first navigation only — [steel-dev/browserbench](https://github.com/steel-dev/browserbench)
- Token cost is another "resource": in Browser Use's matched eval, median input tokens per task were 2.1M (Browser Harness CLI), 3.3M (agent-browser CLI), 4.4M (Playwright MCP), 6.7M (Chrome DevTools MCP) — [Browser Use blog](https://browser-use.com/posts/best-mcp-servers-to-control-a-browser)

### Inferences
- Playwriter's resource story: zero extra browser process (attaches to running Chrome), so marginal RAM is one tab plus the relay/CLI process, and no session create/release step. Steel's 4-stage method (create, connect, goto, release) can be reused directly with Playwriter's stages (relay connect, new page, goto, close) to get a like-for-like latency table.
- Use techinz's method (psutil over the process tree) to measure RAM/CPU of: launching Playwright Chromium, Chrome DevTools MCP default launch, agent-browser headless, vs Playwriter attaching to existing Chrome.
- Token usage per task is a fair, already-accepted metric (Browser Use uses it). Playwriter's single `execute` tool + skill vs Playwright MCP's ~two dozen tool schemas maps to the CLI-vs-MCP token gap Browser Use observed.

### Gaps
- No published measurement of the marginal memory or latency of attaching to an existing Chrome (extension, `--autoConnect`, or remote debugging).
- No published memory comparison for Playwright MCP / Chrome DevTools MCP / agent-browser processes.
- Kernel/Anchor/Browserbase have not published counter-benchmarks to Steel's numbers that I found.
