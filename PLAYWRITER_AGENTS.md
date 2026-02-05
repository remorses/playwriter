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
 lsof -ti :19988 | xargs kill
 
 # windows (powershell): kill any existing relay on 19988
 Get-NetTCPConnection -LocalPort 19988 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
 
 tsx playwriter/src/cli.ts -s 1 -e "await page.goto('https://example.com')"
 tsx playwriter/src/cli.ts -s 1 -e "console.log(await accessibilitySnapshot({ page }))"
 tsx playwriter/src/cli.ts session new
 tsx playwriter/src/cli.ts -s 1 -e "await page.click('button')"
```

### reloading extension during development

after making changes to extension code:

```bash
pnpm --filter mcp-extension reload  # builds and opens chrome://extensions page
```

then click the reload button on the extension card in Chrome. the extension has a stable dev ID (`pebbngnfojnignonigcnkdilknapkgid`) so you don't need to reconfigure anything.

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
  toggleExtension: true  // creates initial page with extension enabled
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
  arguments: { code: 'await page.goto("https://example.com")' }
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

## changelogs

when you do an important change, update relevant CHANGELOG.md files for each package.

also bump package.json versions and IMPORTANT also the extension/manifest.json version too

## debugging playwriter mcp issues

sometimes the user will ask you to debug an mcp issue. to do this you may want to add logs to the mcp and server. to do this you will also need to restart the server so we use the latest code. restarting the mcp yourself is not possible. instead you will need to ask the user to do it or write a test case, where the mcp can be reloaded. also making changes in the extension will not work. you will have to write a test case for that to work. you can ask the user to reconnect these too. for reloading the extension you can run the `pnpm build` script and do `osascript -e 'tell application "Google Chrome" to open location "chrome://extensions/?id=pebbngnfojnignonigcnkdilknapkgid"'` to make it easier for the user to reload it

if the problem was in the ws server you can restart that yourself killing process listening on 19988 and sending a new mcp call.

## running playwriter cli locally

to run the cli locally with your current changes call `tsx playwriter/src/cli.ts -e ...`. also make sure you kill process on 19988 first to make sure to use the latest relay executor code.

# playwright fork submodule (@xmorse/playwright-core)

we maintain a fork of playwright-core at `./playwright` as a git submodule. this allows us to expose frame-level CDP access (targetId/sessionId) that upstream playwright doesn't provide.

relevant files are located in paths like playwright/packages/playwright-core/src/client/page.ts

ignore everything that is outside of playwright/packages/playwright-core in the playwright submodule, it is unused

for our playwright fork notice the types.d.ts are generated from markdown files, so adding new APIs require updating those and not the actual source files unfortunately

EVERY update to playwright code that changes its api or behaviour MUST be followed by a bump in version and update in playwright-core/CHANGELOG.md file. on release of the playwriter package then the playwright-core package must be released first, always using `pnpm publish` command. no need to update version in playwriter package.json because we use the :workspace version.

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
export const ws = require('./utilsBundleImpl').ws;

// after (direct)  
import wsLibrary from 'ws';
export const ws = wsLibrary;
```

**3. simple build script** (`playwright/packages/playwright-core/build.mjs`) - just esbuild transpile + copy vendored files:
```bash
# transpile src/**/*.ts → lib/**/*.js (0.1s)
# copy third_party/lockfile.js, third_party/extract-zip.js
```

**4. generated files** - `playwright/packages/playwright-core/src/generated/*.ts` are browser scripts created by `playwright/utils/generate_injected.js`. these only need regenerating if upstream changes injected scripts.

| | upstream | ours |
|---|---|---|
| build time | ~30s | 0.1s |
| dependencies | 0 (bundled) | ~20 (external) |
| trace-viewer | built | skipped |

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
jq -r '.direction + "\t" + (.message.method // "response")' /tmp/playwriter/cdp.jsonl | uniq -c
```

## testing iframe behaviour with snapshots and out of process frames

iframes are a complex feature in CDP and playwriter. to test a real world scenario follow the document ./docs/framer-iframe-snapshot-guide.md manually. using global playwriter cli. restarting relay killing port 19988 first.

do this when user asks to try framer iframes.
