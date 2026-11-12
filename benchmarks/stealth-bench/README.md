# Stealth Bench V1 for playwriter

Runs Browser Use's [Stealth Bench V1](https://github.com/browser-use/benchmark) (80 bot-protected
sites, `bu-2-0` agent, Gemini judge) on a Chrome driven through the Playwriter extension.

```
run_eval.py (browser-use 0.11.5 Agent, bu-2-0)
      │  CDP: ws://127.0.0.1:19988/cdp/<id>?extensionId=<stableKey>&patchright=1
      ▼
playwriter relay :19988 ──► Playwriter extension ──► dedicated Chrome (no accounts)
```

`playwriter.py` pins the run to one Chrome by its extension `stableKey`, so the agent never
touches another Chrome connected to the same relay. `patchright=1` humanizes mouse and keyboard
input. Before each task it closes extra tabs and clears cookies and cache of that Chrome profile.

## Setup

1. Install a separate Chrome (for example Chrome Beta), load `extension/dist` unpacked, and
   enable Playwriter on one tab. Do not sign in to any account.
2. Find its `stableKey` (the entry with an empty profile email):

   ```bash
   curl -s localhost:19988/extensions/status | jq '.extensions // . | map({stableKey, email: .profile.email})'
   ```

3. Clone and register the provider:

   ```bash
   git clone https://github.com/browser-use/benchmark tmp/stealth-bench/benchmark
   cd tmp/stealth-bench/benchmark && uv sync --frozen
   cp ../../../benchmarks/stealth-bench/playwriter.py browsers/playwriter.py
   # add `playwriter` to the imports, PROVIDERS and BROWSERS in browsers/__init__.py
   ```

## Run

```bash
GOOGLE_API_KEY="$GEMINI_API_KEY" ANONYMIZED_TELEMETRY=false BROWSER_USE_CLOUD_SYNC=false \
PLAYWRITER_EXTENSION_ID='install:Chrome:...' \
sigillo run -p <project with BROWSER_USE_API_KEY> -c prod -- \
  uv run python run_eval.py --benchmark Stealth_Bench_V1 --browser playwriter --concurrency 1
```

Results go to `results/` and `run_data/` inside the benchmark clone. Never commit them or the
decrypted tasks. Official results use a 71-task subset (no hCaptcha, GeeTest, Temu).
