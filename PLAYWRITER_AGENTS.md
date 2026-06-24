this is the playwriter codebase

the extension uses chrome.debugger to manage the user browser

read ./README.md for an overview of how this extension and mcp work
read playwriter/src/skill.md to understand the MCP docs (source of truth)

## backward compatibility

breaking changes to the WS protocol MUST never be made. publishing the extension code will never be instant, which means the extension must keep working with newer versions of the MCP and WS relay server.

## architecture

- user installs the extension in chrome. we assume there is only one chrome window for now, the first opened.
- extension connects to a websocket server on port 19988. if this server is not yet open, it retries connecting in a loop
- the MCP spawns the ws server if not already listening on 19988, in background. the mcp then connects to this same server with a playwright client
- the server exposes /cdp/client-id which is used by playwright clients to communicate with the extension
- the extension instead connects to /extension which is used to receive cdp commands and send responses and cdp events.
- some events are treated specially for example because
  - we need to send attachedToTarget to let playwright know which pages are available
  - we need to send detachedFromTarget when we disable the extension in a tab
  - a few more events need custom handling
- tabs are identified by sessionId or targetId (CDP concepts) or tabId (chrome debugger concept only)

mcp.ts MUST never use console.log. only console.error

write code that will run on all platforms: mac, linux, windows. especially around paths handling and command execution

## development

### running MCP locally

to test the MCP server with local changes, add it to your MCP client config with tsx:

```json
{
  "mcpServers": {
    "playwriter": {
      "command": "tsx",
      "args": ["/path/to/playwriter/playwriter/src/mcp.ts"]
    }
  }
}
```

make sure you have tsx installed globally: `pnpm i -g tsx`

### running CLI locally

to test CLI changes without publishing:

```bash
 # mac/linux: kill any existing relay on 19988
 PIDS=($(lsof -ti :19988))
 if [ ${#PIDS[@]} -gt 0 ]; then kill "${PIDS[@]}"; fi
 # verify port is free (must print nothing)
 lsof -ti :19988

 # windows (powershell): kill any existing relay on 19988
 Get-NetTCPConnection -LocalPort 19988 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
 # verify port is free (must print nothing)
 Get-NetTCPConnection -LocalPort 19988 -ErrorAction SilentlyContinue

 tsx playwriter/src/cli.ts -s 1 -e "await page.goto('https://example.com')"
 tsx playwriter/src/cli.ts -s 1 -e "console.log(await snapshot({ page }))"
 tsx playwriter/src/cli.ts session new
 tsx playwriter/src/cli.ts -s 1 -e "await page.click('button')"
```

### reloading extension during development

after making changes to extension code:

```bash
pnpm --filter mcp-extension reload  # builds and opens chrome://extensions page
```

then click the reload button on the extension card in Chrome. the extension has a stable dev ID (`pebbngnfojnignonigcnkdilknapkgid`) so you don't need to reconfigure anything.

## extension version

after EVERY change made inside extension/ folder you MUST bump the manifest.json version. then create a git tag with extension@version after committing.

Do not manually edit CHANGELOG.md files for extension changes. If the extension change also affects a public package release note, add a changeset for that public package instead.

## github releases

after publishing the CLI (`playwriter` npm package), always create GitHub releases for both the CLI and the extension (if extension code changed).

**CLI release:**

```bash
# after changesets versioned and published the playwriter package
VERSION=$(node -p "require('./playwriter/package.json').version")
gh release create "playwriter@$VERSION" --title "playwriter@$VERSION" --latest --notes "$(cat <<'EOF'
paste changelog entries here
EOF
)"
```

**extension release** (only if extension/ changed since last extension release):

```bash
# build the extension dist for release
cd extension && PRODUCTION=true PLAYWRITER_EXTENSION_DIST=dist-release pnpm build && cd ..
rm -f playwriter-*.zip && cd extension/dist-release && zip -r ../../playwriter-$(node -p "require('../manifest.json').version").zip . && cd ../..

# create the release, uploading the zip as an asset
VERSION=$(node -p "require('./extension/manifest.json').version")
gh release create "extension@$VERSION" "playwriter-$VERSION.zip" --title "Extension $VERSION" --latest=false --notes "$(cat <<'EOF'
paste changelog entries here
EOF
)"
```

read `extension/CHANGELOG.md` entries since the last extension GitHub release, merge them into a numbered list following the same changepub format (user-facing outcomes, sorted by relevance, no internal chores).

use `--latest=false` for extension releases so they don't override the CLI release as the "Latest" GitHub release. the CLI release should always be the latest one.

### testing

```bash
pnpm test              # run all tests (takes ~90 seconds)
pnpm test -t "screenshot"  # run specific test by name
pnpm test:watch        # watch mode
```

tests run against a real Chrome instance with the extension loaded.

the test script passes `-u` to update inline snapshots automatically.

#### test setup

tests use these utilities from `test-utils.ts`:

```ts
// setup browser with extension loaded + relay server
const testCtx = await setupTestContext({
  port: 19987,
  tempDirPrefix: 'pw-test-',
  toggleExtension: true, // creates initial page with extension enabled
})

// get extension service worker to call extension functions
const serviceWorker = await getExtensionServiceWorker(testCtx.browserContext)

// toggle extension on current tab
await serviceWorker.evaluate(async () => {
  await globalThis.toggleExtensionForActiveTab()
})

// cleanup after tests
await cleanupTestContext(testCtx, cleanup)
```

to test MCP tools, create an MCP client:

```ts
import { createMCPClient } from './mcp-client.js'

const { client, cleanup } = await createMCPClient({ port: 19987 })
const result = await client.callTool({
  name: 'execute',
  arguments: { code: 'await page.goto("https://example.com")' },
})
```

#### adding tests

tests live in `playwriter/src/*.test.ts`. add new tests to existing describe blocks or create new test files.

each test should reset the extension connection. NEVER call `browser.close()` in tests.

remember: toggling extension on a tab adds it to available pages. if you toggle then call `context.newPage()`, you'll have 2 pages.

IMPORTANT: set bash timeout to at least 300000ms (5 minutes) when running `pnpm test`

to debug test failures, inspect the relay server log file. during tests, logs are written to `./relay-server.log` in the playwriter folder (not the system temp directory). contains extension, MCP and WS server logs with all CDP events.

### project structure

extension/ contains the chrome extension code. you need to run `pnpm build` to make it ready to be loaded in chrome. the extension folder chrome will use is extension/dist

when I ask you to release extension run package.json release script

playwriter contains the ws server and MCP code. also the tests for the mcp are there. playwriter/src/skill.md is the source of truth for MCP docs - edit that file to update agent instructions. the build script generates playwriter/dist/prompt.md from skill.md, stripping CLI-only sections.

playwriter/src/resource.md is for more generic knowledge about playwright that the agent can use when necessary, for things like best practices for selecting locators on the page

website/public/resources/ and website/public/SKILL.md are auto-generated by `playwriter/scripts/build-resources.ts` during `pnpm build`. DO NOT edit these files manually - edit the source files instead (e.g. `debugger-examples.ts`, `editor-examples.ts`, `styles-examples.ts`, `playwriter/src/skill.md`)

skills/playwriter/SKILL.md is a lightweight stub that tells agents to run `playwriter skill` for full, up-to-date instructions.

## CDP docs

here are some commands you can run to fetch docs about CDP domains (events and commands namespaces)

```
curl -sL https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Target.pdl # manage “targets”: pages, iframes, workers, etc., and attach/detach sessions
curl -sL https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Browser.pdl # top-level browser control: version info, window management, permission settings, etc.
curl -sL https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Page.pdl # navigate, reload, screenshot, PDF, frame management, dialogs, and page lifecycle events.
curl -sL https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Emulation.pdl # emulate device metrics, viewport, timezone, locale, geolocation, media type, CPU, etc.
```

you can list other files in that folder on github to read more if you need to control things like DOM, performance, etc

## Browser Use Cloud API docs

cloud browser sessions use the Browser Use hosted Chromium API. before editing cloud browser code (`cloud-client.ts`, `cloud-api.ts`, `browser-use.ts`, or cloud-related CLI commands), read the relevant docs:

- LLM-optimized full docs: https://docs.browser-use.com/cloud/llms-full.txt
- OpenAPI spec: https://docs.browser-use.com/openapi/v3.json

our typed client lives in `website/src/lib/browser-use.ts` and only uses the `/browsers` endpoints (create, get, stop, list). we do not use the agent/sessions endpoints; we connect via CDP directly.

## D1 query optimization

D1 queries are slow, especially writes. minimize the number of D1 round trips in every code path. use `db.batch()` to combine multiple reads or writes into a single round trip wherever possible. never add a separate D1 write when you can piggyback it onto an existing batch call.

when reviewing or writing cloud-api, scheduled, or any website code that touches D1:
- count the number of D1 round trips per request and document them in comments
- prefer batching N statements into 1 `db.batch()` call over N individual queries
- if adding a new column/field that needs updating, find an existing write to batch it with instead of adding a new one

## changesets

this repo uses Changesets for public package release notes and version bumps.

For every fix or feature that affects a public package, add one `.changeset/*.md` file at the repo root. Do not edit package CHANGELOG.md files directly and do not manually bump public package versions; changesets are consumed at publish time to update versions and changelogs.

Use `patch` for fixes and `minor` for new features. Include every affected public package in the changeset frontmatter, for example `playwriter` or `@xmorse/playwright-core`. Skip private packages such as `mcp-extension`.

Before adding a changeset, run `gh issue list --state all --limit 20` and reference a matching issue with `Fixes #123` on its own line when the change fixes one.

If a change touches extension code, still bump `extension/manifest.json` because Chrome extension releases are separate from npm package changesets.

## debugging playwriter mcp issues

sometimes the user will ask you to debug an mcp issue. to do this you may want to add logs to the mcp and server. to do this you will also need to restart the server so we use the latest code. restarting the mcp yourself is not possible. instead you will need to ask the user to do it or write a test case, where the mcp can be reloaded. also making changes in the extension will not work. you will have to write a test case for that to work. you can ask the user to reconnect these too. for reloading the extension you can run the `pnpm build` script and do `osascript -e 'tell application "Google Chrome" to open location "chrome://extensions/?id=pebbngnfojnignonigcnkdilknapkgid"'` to make it easier for the user to reload it

if the problem was in the ws server you can restart that yourself killing process listening on 19988 and sending a new mcp call.

## running playwriter cli locally

to run the cli locally with your current changes call `tsx playwriter/src/cli.ts -e ...`. also make sure you kill process on 19988 first to make sure to use the latest relay executor code.

# playwright fork submodule (@xmorse/playwright-core)

we maintain a fork of playwright-core at `./playwright` as a git submodule. this allows us to expose frame-level CDP access (targetId/sessionId) that upstream playwright doesn't provide.

relevant files are located in paths like playwright/packages/playwright-core/src/client/page.ts

ignore everything that is outside of playwright/packages/playwright-core in the playwright submodule, it is unused

EVERY update to playwright code that changes its api or behaviour MUST be followed by a changeset for `@xmorse/playwright-core`. on release of the playwriter package then the playwright-core package must be released first, always using `pnpm publish` command. no need to update version in playwriter package.json because we use the :workspace version.

### adding or updating @xmorse/playwright-core public APIs

`types.d.ts` is **generated** — never edit it directly. the generation pipeline is:

```
playwright/docs/src/api/class-*.md          ← markdown doc entries (source of truth)
playwright/utils/generate_types/overrides.d.ts  ← complex type overrides & standalone type exports
         ↓
playwright/utils/generate_types/index.js    ← generator script
         ↓
playwright/packages/playwright-core/types/types.d.ts   ← generated output
playwright/packages/playwright-client/types/types.d.ts  ← generated output
```

if you add runtime code (a new method, property, or type) to the fork without updating the type generation inputs, the API will work at runtime but TypeScript consumers won't see it — `pnpm typecheck` in playwriter will fail.

**full checklist for adding a new API (in order):**

1. **implement the runtime code**
   - client side: `playwright/packages/playwright-core/src/client/*.ts`
   - server side (if needed): `playwright/packages/playwright-core/src/server/*.ts`
   - protocol (if it crosses the channel): `playwright/packages/protocol/src/channels.d.ts` + dispatchers

2. **add a doc entry in the markdown** — this is what the type generator reads
   - methods: `playwright/docs/src/api/class-page.md`, `class-browsercontext.md`, `class-locator.md`, etc.
   - format examples:
     ```md
     ## async method: BrowserContext.getExistingCDPSession
     * since: v1.59
     * langs: js
     - returns: <[CDPSession]>

     Description of what the method does.

     ### param: BrowserContext.getExistingCDPSession.page
     * since: v1.59
     - `page` <[Page]|[Frame]>

     Parameter description.
     ```
     ```md
     ## property: Page.onMouseAction
     * since: v1.59
     * langs: js
     - type: <[null]|[function]\([MouseActionEvent]\):[Promise]<[void]>>

     Property description.
     ```
     ```md
     ## method: Locator.selector
     * since: v1.59
     * langs: js
     - returns: <[string]>

     Method description.
     ```
   - use `* langs: js` for JS/TS-only APIs (skips Java/Python/C# generation)

3. **add type overrides if needed** — `playwright/utils/generate_types/overrides.d.ts`
   - REQUIRED for: standalone exported types (e.g. `export type MouseActionEvent = {...}`), complex generics, function overloads
   - the generator validates that every method/property in overrides.d.ts has a matching doc entry in the markdown — if you add an override without a doc entry, generation fails with `Unknown override method`
   - standalone type aliases (`export type Foo = {...}`) do NOT need a doc entry, only interface members do

4. **regenerate types.d.ts**
   ```bash
   node playwright/utils/generate_types/index.js
   ```

5. **rebuild playwright-core**
   ```bash
   pnpm playwright:build  # 0.1s
   ```

6. **add a changeset** for `@xmorse/playwright-core` describing the public API or behavior change

7. **verify** — run `pnpm typecheck` in the `playwriter/` package to confirm zero errors

### submodule setup

the playwright submodule should always stay on branch `playwriter`. never switch to main or other branches.

```bash
# check current branch
cd playwright && git branch

# if not on playwriter branch
git checkout playwriter
```

### bootstrapping the repo

after cloning this repo, run bootstrap to set up the playwright submodule:

```bash
pnpm bootstrap
```

this does:

1. `git submodule update --init` - init the playwright submodule
2. `pnpm install` - install deps and link workspace packages
3. `node playwright/utils/generate_injected.js` - generate browser scripts to `src/generated/`
4. `node playwright/packages/playwright-core/build.mjs` - transpile (0.1s)

### rebuilding after changes

after modifying playwright-core source:

```bash
pnpm playwright:build  # 0.1s
```

### how the simplified build works

upstream playwright bundles all dependencies into single files (zero runtime deps). we skip this by using direct dependencies instead:

**1. dependencies in package.json** - ws, debug, pngjs, commander, etc. are regular deps

**2. rewritten bundle files** - `playwright/packages/playwright-core/src/utilsBundle.ts`, `zipBundle.ts`, `mcpBundle.ts` import directly:

```ts
// before (bundled)
export const ws = require('./utilsBundleImpl').ws

// after (direct)
import wsLibrary from 'ws'
export const ws = wsLibrary
```

**3. simple build script** (`playwright/packages/playwright-core/build.mjs`) - just esbuild transpile + copy vendored files:

```bash
# transpile src/**/*.ts → lib/**/*.js (0.1s)
# copy third_party/lockfile.js, third_party/extract-zip.js
```

**4. generated files** - `playwright/packages/playwright-core/src/generated/*.ts` are browser scripts created by `playwright/utils/generate_injected.js`. these only need regenerating if upstream changes injected scripts.

|              | upstream    | ours           |
| ------------ | ----------- | -------------- |
| build time   | ~30s        | 0.1s           |
| dependencies | 0 (bundled) | ~20 (external) |
| trace-viewer | built       | skipped        |

### key source files

- `playwright/packages/playwright-core/src/server/chromium/` - chromium CDP implementation
- `playwright/packages/playwright-core/src/server/chromium/crConnection.ts` - CDP websocket connection
- `playwright/packages/playwright-core/src/server/chromium/crBrowser.ts` - browser and page discovery
- `playwright/packages/playwright-core/src/server/chromium/chromium.ts` - connectOverCDP implementation

## ./claude-extension

ignore ./claude-extension. this is the source code of the Claude Chrome extension. used to reverse engineer new methods and tools to extract and control the page

## reading playwriter logs

you can find the logfile for playwriter executing `playwriter logfile`. read that then to understand issues happening and debug them

`playwriter logfile` also logs a jsonl file with all CDP commands and events being sent between extension, cli, mcp and relay. the cdp log is a jsonl file (one json object per line). you can use jq to process and read it efficiently. for example, list direction + method:

```bash
jq -r '.direction + "\t" + (.message.method // "response")' ~/.playwriter/cdp.jsonl | uniq -c
```

## testing iframe behaviour with snapshots and out of process frames

iframes are a complex feature in CDP and playwriter. to test a real world scenario follow the document ./docs/framer-iframe-snapshot-guide.md manually. using global playwriter cli. restarting relay killing port 19988 first.

do this when user asks to try framer iframes.

# patchright-playwriter fork (@playwriter/patchright-core)

we maintain a separate repo at https://github.com/remorses/patchright-playwriter that produces `@playwriter/patchright-core`. this package combines patchright's stealth patches (undetected Playwright, bypasses Cloudflare/Datadome/etc.) with our playwriter extensions.

the fork lives at `~/Documents/GitHub/patchright-playwriter/`. read its `AGENTS.md` for full build, publish, and sync instructions.

## applying new playwright fork changes to patchright-playwriter

when we add features or fixes to our playwright fork (the `./playwright` submodule in this repo), those same changes need to be applied to the patchright-playwriter fork so `@playwriter/patchright-core` stays in sync.

1. find the last sync date by checking the patchright-playwriter repo's `playwriter.patch` header or commit history:
```bash
cd ~/Documents/GitHub/patchright-playwriter
git log --oneline -5
```

2. in this repo, generate a diff of new changes since that date:
```bash
cd ~/Documents/GitHub/playwriter/playwright
BASE=$(git merge-base HEAD upstream/main)
git log --oneline $BASE..HEAD -- packages/playwright-core/src/ | head -20
# generate the full diff
git diff $BASE..HEAD -- packages/playwright-core/src/ > /tmp/playwriter-changes.patch
```

3. in the patchright-playwriter repo, rebuild from scratch then apply:
```bash
cd ~/Documents/GitHub/patchright-playwriter
bash utils/rebuild_local_package.sh
cd playwright
git apply --reject /tmp/playwriter-changes.patch
# resolve .rej files if any, then regenerate playwriter.patch
```

4. regenerate the playwriter.patch:
```bash
cd playwright
git log --oneline | head -5  # find the patchright-patches commit hash
git diff <patchright-commit>..HEAD > ../playwriter.patch
cd .. && git add playwriter.patch && git commit -m 'update playwriter.patch with latest changes'
```
