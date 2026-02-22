<!-- This AGENTS.md file is generated. Look for an agents.md package.json script to see what files to update instead. -->

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

## extension version

after EVERY change made inside extension/ folder you MUST bump the manifest.json version and update the CHANGELOG.md file. then create a git tag with extension@version after committing.

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

## changelogs

when you do an any change, update relevant CHANGELOG.md files for each package.

also bump package.json versions and IMPORTANTLY also the extension/manifest.json version!

you also MUST always bump the playwright core package.json version too on any changes made there. so during publishing we know if that package needs to also be published, first, before publishing playwriter. checking if its version is already publishing in npm with `npm show @xmorse/playwright-core version`

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

make sure to always bump the package json and update the

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

# core guidelines

when summarizing changes at the end of the message, be super short, a few words and in bullet points, use bold text to highlight important keywords. use markdown.

please ask questions and confirm assumptions before generating complex architecture code.

NEVER run commands with & at the end to run them in the background. this is leaky and harmful! instead ask me to run commands in the background using tmux if needed.

NEVER commit yourself unless asked to do so. I will commit the code myself.

NEVER use git to revert files to previous state if you did not create those files yourself! there can be user changes in files you touched, if you revert those changes the user will be very upset!

## files

always use kebab case for new filenames. never use uppercase letters in filenames

never write temporary files to /tmp. instead write them to a local ./tmp folder instead. make sure it is in .gitignore too

## see files in the repo

use `git ls-files | tree --fromfile` to see files in the repo. this command will ignore files ignored by git

## handling unexpected file contents after a read or write

if you find code that was not there since the last time you read the file it means the user or another agent edited the file. do not revert the changes that were added. instead keep them and integrate them with your new changes

IMPORTANT: NEVER commit your changes unless clearly and specifically asked to!

## opening me files in zed to show me a specific portion of code

you can open files when i ask me "open in zed the line where ..." using the command `zed path/to/file:line`

# typescript

- ALWAYS use normal imports instead of dynamic imports, unless there is an issue with es module only packages and you are in a commonjs package (this is rare).
- when throwing errors always use clause instead of error inside message: `new Error("wrapping error", { cause: e })` instead of `new Error(\`wrapping error ${e}\`)`

- use a single object argument instead of multiple positional args: use object arguments for new typescript functions if the function would accept more than one argument, so it is more readable, ({a,b,c}) instead of (a,b,c). this way you can use the object as a sort of named argument feature, where order of arguments does not matter and it's easier to discover parameters.

- always add the {} block body in arrow functions: arrow functions should never be written as `onClick={(x) => setState('')}`. NEVER. instead you should ALWAYS write `onClick={() => {setState('')}}`. this way it's easy to add new statements in the arrow function without refactoring it.

- in array operations .map, .filter, .reduce and .flatMap are preferred over .forEach and for of loops. For example prefer doing `.push(...array.map(x => x.items))` over mutating array variables inside for loops. Always think of how to turn for loops into expressions using .map, .filter or .flatMap if you ever are about to write a for loop.

- if you encounter typescript errors like "undefined | T is not assignable to T" after .filter(Boolean) operations: use a guarded function instead of Boolean: `.filter(isTruthy)`. implemented as `function isTruthy<T>(value: T): value is NonNullable<T> { return Boolean(value) }`

- minimize useless comments: do not add useless comments if the code is self descriptive. only add comments if requested or if this was a change that i asked for, meaning it is not obvious code and needs some inline documentation. if a comment is required because the part of the code was result of difficult back and forth with me, keep it very short.

- ALWAYS add all information encapsulated in my prompt to comments: when my prompt is super detailed and in depth, all this information should be added to comments in your code. this is because if the prompt is very detailed it must be the fruit of a lot of research. all this information would be lost if you don't put it in the code. next LLM calls would misinterpret the code and miss context.

- NEVER write comments that reference changes between previous and old code generated between iterations of our conversation. do that in prompt instead. comments should be used for information of the current code. code that is deleted does not matter.

- use early returns (and breaks in loops): do not nest code too much. follow the go best practice of if statements: avoid else, nest as little as possible, use top level ifs. minimize nesting. instead of doing `if (x) { if (b) {} }` you should do `if (x && b) {};` for example. you can always convert multiple nested ifs or elses into many linear ifs at one nesting level. use the @think tool for this if necessary.

- typecheck after updating code: after any change to typescript code ALWAYS run the `pnpm typecheck` script of that package, or if there is no typecheck script run `pnpm tsc` yourself

- do not use any: you must NEVER use any. if you find yourself using `as any` or `:any`, use the @think tool to think hard if there are types you can import instead. do even a search in the project for what the type could be. any should be used as a last resort.

- NEVER do `(x as any).field` or `'field' in x` before checking if the code compiles first without it. the code probably doesn't need any or the in check. even if it does not compile, use think tool first! before adding (x as any).something, ALWAYS read the .d.ts to understand the types

- do not declare uninitialized variables that are defined later in the flow. instead use an IIFE with returns. this way there is less state. also define the type of the variable before the iife. here is an example:

- use || over in: avoid 'x' in obj checks. prefer doing `obj?.x || ''` over doing `'x' in obj ? obj.x : ''`. only use the in operator if that field causes problems in typescript checks because typescript thinks the field is missing, as a last resort.

- when creating urls from a path and a base url, prefer using `new URL(path, baseUrl).toString()` instead of normal string interpolation. use type-safe react-router `href` or spiceflow `this.safePath` (available inside routes) if possible

- for node built-in imports, never import singular exported names. instead do `import fs from 'node:fs'`, same for path, os, etc.

- NEVER start the development server with pnpm dev yourself. there is no reason to do so, even with &

- When creating classes do not add setters and getters for a simple private field. instead make the field public directly so user can get it or set it himself without abstractions on top

- if you encounter typescript lint errors for an npm package, read the node_modules/package/\*.d.ts files to understand the typescript types of the package. if you cannot understand them, ask me to help you with it.

- NEVER silently suppress errors in catch {} blocks if they contain more than one function call

```ts
// BAD. DO NOT DO THIS
let favicon: string | undefined
if (docsConfig?.favicon) {
  if (typeof docsConfig.favicon === 'string') {
    favicon = docsConfig.favicon
  } else if (docsConfig.favicon?.light) {
    // Use light favicon as default, could be enhanced with theme detection
    favicon = docsConfig.favicon.light
  }
}
// DO THIS. use an iife. Immediately Invoked Function Expression
const favicon: string = (() => {
  if (!docsConfig?.favicon) {
    return ''
  }
  if (typeof docsConfig.favicon === 'string') {
    return docsConfig.favicon
  }
  if (docsConfig.favicon?.light) {
    // Use light favicon as default, could be enhanced with theme detection
    return docsConfig.favicon.light
  }
  return ''
})()
// if you already know the type use it:
const favicon: string = () => {
  // ...
}
```

- when a package has to import files from another packages in the workspace never add a new tsconfig path, instead add that package as a workspace dependency using `pnpm i "package@workspace:*"`

NEVER use require. always esm imports

always try to use non-relative imports. each package has an absolute import with the package name, you can find it in the tsconfig.json paths section. for example, paths inside website can be imported from website. notice these paths also need to include the src directory.

this is preferable to other aliases like @/ because i can easily move the code from one package to another without changing the import paths. this way you can even move a file and import paths do not change much.

always specify the type when creating arrays, especially for empty arrays. if you don't, typescript will infer the type as `never[]`, which can cause type errors when adding elements later.

**Example:**

```ts
// BAD: Type will be never[]
const items = []

// GOOD: Specify the expected type
const items: string[] = []
const numbers: number[] = []
const users: User[] = []
```

remember to always add the explicit type to avoid unexpected type inference.

- when using nodejs APIs like fs always import the module and not the named exports. I prefer hacing nodejs APIs accessed on the module namspace like fs, os, path, etc.

DO `import fs from 'fs'; fs.writeFileSync(...)`
DO NOT `import { writeFileSync } from 'fs';`

- NEVER pass a string to abortController.abort(). instead if you want to pass a reason always pass an Error instance. like `controller.abort(new Error('reason'))`. This way catch blocks receive an Error instance and not something else.

# package manager: pnpm with workspace

this project uses pnpm workspaces to manage dependencies. important scripts are in the root package.json or various packages' package.json

try to run commands inside the package folder that you are working on. for example you should never run `pnpm test` from the root

if you need to install packages always use pnpm

instead of adding packages directly in package.json use `pnpm install package` inside the right workspace folder. NEVER manually add a package by updating package.json

## updating a package

when i ask you to update a package always run `pnpm update -r packagename`. to update to latest also add --latest

Do not do `pnpm add packagename` to update a package. only to add a missing one. otherwise other packages versions will get out of sync.

## fixing duplicate pnpm dependencies

sometimes typescript will fail if there are 2 duplicate packages in the workspace node_modules. this can happen in pnpm if a package is used in 2 different places (even if inside a node_module package, transitive dependency) with a different set of versions for a peer dependency

for example if better-auth depends on zod peer dep and zod is in different versions in 2 dependency subtrees

to identify if a pnpm package is duplicated, search for the string " packagename@" inside `pnpm-lock.yaml`, notice the space in the search string. then if the result returns multiple instances with a different set of peer deps inside the round brackets, it means that this package is being duplicated. here is an example of a package getting duplicated:

```

  better-auth@1.3.6(react-dom@19.1.1(react@19.1.1))(react@19.1.1)(zod@3.25.76):
    dependencies:
      '@better-auth/utils': 0.2.6
      '@better-fetch/fetch': 1.1.18
      '@noble/ciphers': 0.6.0
      '@noble/hashes': 1.8.0
      '@simplewebauthn/browser': 13.1.2
      '@simplewebauthn/server': 13.1.2
      better-call: 1.0.13
      defu: 6.1.4
      jose: 5.10.0
      kysely: 0.28.5
      nanostores: 0.11.4
      zod: 3.25.76
    optionalDependencies:
      react: 19.1.1
      react-dom: 19.1.1(react@19.1.1)

  better-auth@1.3.6(react-dom@19.1.1(react@19.1.1))(react@19.1.1)(zod@4.0.17):
    dependencies:
      '@better-auth/utils': 0.2.6
      '@better-fetch/fetch': 1.1.18
      '@noble/ciphers': 0.6.0
      '@noble/hashes': 1.8.0
      '@simplewebauthn/browser': 13.1.2
      '@simplewebauthn/server': 13.1.2
      better-call: 1.0.13
      defu: 6.1.4
      jose: 5.10.0
      kysely: 0.28.5
      nanostores: 0.11.4
      zod: 4.0.17
    optionalDependencies:
      react: 19.1.1
      react-dom: 19.1.1(react@19.1.1)

```

as you can see, better-auth is listed twice with different sets of peer deps. in this case it's because of zod being in version 3 and 4 in two subtrees of our workspace dependencies.

as a first step, try running `pnpm dedupe better-auth` with your package name and see if there is still the problem.

below i will describe how to generally deduplicate a package. i will use zod as an example. it works with any dependency found in the previous step.

to deduplicate the package, we have to make sure we only have 1 version of zod installed in your workspace. DO NOT use overrides for this. instead, fix the problem by manually updating the dependencies that are forcing the older version of zod in the dependency tree.

to do so, we first have to run the command `pnpm -r why zod@3.25.76` to see the reason the older zod version is installed. in this case, the result is something like this:

```

website /Users/morse/Documents/GitHub/holocron/website (PRIVATE)

dependencies:
@better-auth/stripe 1.2.10
├─┬ better-auth 1.3.6
│ └── zod 3.25.76 peer
└── zod 3.25.76
db link:../db
└─┬ docs-website link:../docs-website
  ├─┬ fumadocs-docgen 2.0.1
  │ └── zod 3.25.76
  ├─┬ fumadocs-openapi link:../fumadocs/packages/openapi
  │ └─┬ @modelcontextprotocol/sdk 1.17.3
  │   ├── zod 3.25.76
  │   └─┬ zod-to-json-schema 3.24.6
  │     └── zod 3.25.76 peer
  └─┬ searchapi link:../searchapi
    └─┬ agents 0.0.109
      ├─┬ @modelcontextprotocol/sdk 1.17.3
      │ ├── zod 3.25.76
      │ └─┬ zod-to-json-schema 3.24.6
      │   └── zod 3.25.76 peer
      └─┬ ai 4.3.19
        ├─┬ @ai-sdk/provider-utils 2.2.8
        │ └── zod 3.25.76 peer
        └─┬ @ai-sdk/react 1.2.12
          ├─┬ @ai-sdk/provider-utils 2.2.8
          │ └── zod 3.25.76 peer
          └─┬ @ai-sdk/ui-utils 1.2.11
            └─┬ @ai-sdk/provider-utils 2.2.8
              └── zod 3.25.76 peer
```

here we can see zod 3 is installed because of @modelcontextprotocol/sdk, @better-auth/stripe and agents packages. to fix the problem, we can run

```
pnpm update -r --latest  @modelcontextprotocol/sdk @better-auth/stripe agents
```

this way, if these packages include the newer version of the dependency, zod will be deduplicated automatically.

in this case, we could have only updated @better-auth/stripe to fix the issue too, that's because @better-auth/stripe is the one that has better-auth as a peer dep. but finding what is the exact problematic package is difficult, so it is easier to just update all packages you notice that we depend on directly in our workspace package.json files.

if after doing this we still have duplicate packages, you will have to ask the user for help. you can try deleting the node_modules and restarting the approach, but it rarely helps.

# testing

.toMatchInlineSnapshot is the preferred way to write tests. leave them empty the first time, update them with -u. check git diff for the test file every time you update them with -u

never use timeouts longer than 5 seconds for expects and other statements timeouts. increase timeouts for tests if required, up to 1 minute

do not create dumb tests that test nothing. do not write tests if there is not already a test file or describe block for that function or module.

if the inputs for the tests is an array of repetitive fields and long content, generate this input data programmatically instead of hardcoding everything. only hardcode the important parts and generate other repetitive fields in a .map or .reduce

tests should validate complex and non-obvious logic. if a test looks like a placeholder, do not add it.

use vitest or bun test to run tests. tests should be run from the current package directory and not root. try using the test script instead of vitest directly. additional vitest flags can be added at the end, like --run to disable watch mode or -u to update snapshots.

to understand how the code you are writing works, you should add inline snapshots in the test files with expect().toMatchInlineSnapshot(), then run the test with `pnpm test -u --run` or `pnpm vitest -u --run` to update the snapshot in the file, then read the file again to inspect the result. if the result is not expected, update the code and repeat until the snapshot matches your expectations. never write the inline snapshots in test files yourself. just leave them empty and run `pnpm test -u --run` to update them.

> always call `pnpm vitest` or `pnpm test` with `--run` or they will hang forever waiting for changes!
> ALWAYS read back the test if you use the `-u` option to make sure the inline snapshots are as you expect.

- NEVER write the snapshots content yourself in `toMatchInlineSnapshot`. instead leave it as is and call `pnpm test -u` to fill in snapshots content. the first time you call `toMatchInlineSnapshot()` you can leave it empty

- when updating implementation and `toMatchInlineSnapshot` should change, DO NOT remove the inline snapshots yourself, just run `pnpm test -u` instead! This will replace contents of the snapshots without wasting time doing it yourself.

- for very long snapshots you should use `toMatchFileSnapshot(filename)` instead of `toMatchInlineSnapshot()`. put the snapshot files in a snapshots/ directory and use the appropriate extension for the file based on the content

never test client react components. only React and browser independent code.

most tests should be simple calls to functions with some expect calls, no mocks. test files should be called the same as the file where the tested function is being exported from.

NEVER use mocks. the database does not need to be mocked, just use it. simply do not test functions that mutate the database if not asked.

tests should strive to be as simple as possible. the best test is a simple `.toMatchInlineSnapshot()` call. these can be easily evaluated by reading the test file after the run passing the -u option. you can clearly see from the inline snapshot if the function behaves as expected or not.

try to use only describe and test in your tests. do not use beforeAll, before, etc if not strictly required.

NEVER write tests for react components or react hooks. NEVER write tests for react components. you will be fired if you do.

sometimes tests work directly on database data, using prisma. to run these tests you have to use the package.json script, which will call `doppler run -- vitest` or similar. never run doppler cli yourself as you could delete or update production data. tests generally use a staging database instead.

never write tests yourself that call prisma or interact with database or emails. for these, ask the user to write them for you.

changelogs.md

# writing docs

when generating a .md or .mdx file to document things, always add a frontmatter with title and description. also add a prompt field with the exact prompt used to generate the doc. use @ to reference files and urls and provide any context necessary to be able to recreate this file from scratch using a model. if you used urls also reference them. reference all files you had to read to create the doc. use yaml | syntax to add this prompt and never go over the column width of 80

# github

you can use the `gh` cli to do operations on github for the current repository. For example: open issues, open PRs, check actions status, read workflow logs, etc.

## creating issues and pull requests

when opening issues and pull requests with gh cli, never use markdown headings or sections. instead just use simple paragraphs, lists and code examples. be as short as possible while remaining clear and using good English.

example:

```bash
gh issue create --title "Fix login timeout" --body "The login form times out after 5 seconds on slow connections. This affects users on mobile networks.

Steps to reproduce:
1. Open login page on 3G connection
2. Enter credentials
3. Click submit

Expected: Login completes within 30 seconds
Actual: Request times out after 5 seconds

Error in console:
\`\`\`bash
Error: Request timeout at /api/auth/login
\`\`\`"
```

## get current github repo

`git config --get remote.origin.url`

## checking status of latest github actions workflow run

```bash
gh run list # lists latest actions runs
gh run watch <id> --exit-status # if workflow is in progress, wait for the run to complete. the actions run is finished when this command exits. Set a tiemout of at least 10 minutes when running this command
gh pr checks --watch --fail-fast # watch for current branch pr ci checks to finish
gh run view <id> --log-failed | tail -n 300 # read the logs for failed steps in the actions run
gh run view <id> --log | tail -n 300 # read all logs for a github actions run
```

## responding to PR reviews and comments (gh-pr-review extension)

```bash
# view reviews and get thread IDs
gh pr-review review view 42 -R owner/repo --unresolved

# reply to a review comment
gh pr-review comments reply 42 -R owner/repo \
  --thread-id PRRT_kwDOAAABbcdEFG12 \
  --body "Fixed in latest commit"

# resolve a thread
gh pr-review threads resolve 42 -R owner/repo --thread-id PRRT_kwDOAAABbcdEFG12
```

## reading github repos source code

```sh
opensrc zod # npm package name

# Using github: prefix
opensrc github:owner/repo

# Using owner/repo shorthand
opensrc facebook/react

# Using full GitHub URL
opensrc https://github.com/colinhacks/zod

# Fetch a specific branch or tag
opensrc owner/repo@v1.0.0
opensrc owner/repo#main

# Mix packages and repos
```

This will download the source code in ./opensrc. which should be put in .gitignore

# playwright

you can control the browser using the playwright mcp tools. these tools let you control the browser to get information or accomplish actions

if i ask you to test something in the browser, know that the website dev server is already running at http://localhost:7664 for website and :7777 for docs-website (but docs-website needs to use the website domain specifically, for example name-hash.localhost:7777)

# zod

when you need to create a complex type that comes from a prisma table, do not create a new schema that tries to recreate the prisma table structure. instead just use `z.any() as ZodType<PrismaTable>)` to get type safety but leave any in the schema. this gets most of the benefits of zod without having to define a new zod schema that can easily go out of sync.

## converting zod schema to jsonschema

you MUST use the built in zod v4 toJSONSchema and not the npm package `zod-to-json-schema` which is outdated and does not support zod v4.

```ts
import { toJSONSchema } from 'zod'

const mySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(3).max(100),
  age: z.number().min(0).optional(),
})

const jsonSchema = toJSONSchema(mySchema, {
  removeAdditionalStrategy: 'strict',
})
```

github.md

<!-- opensrc:start -->

## Source Code Reference

Source code for dependencies is available in `opensrc/` for deeper understanding of implementation details.

See `opensrc/sources.json` for the list of available packages and their versions.

Use this source code when you need to understand how a package works internally, not just its types/interface.

### Fetching Additional Source Code

To fetch source code for a package or repository you need to understand, run:

```bash
npx opensrc <package>           # npm package (e.g., npx opensrc zod)
npx opensrc pypi:<package>      # Python package (e.g., npx opensrc pypi:requests)
npx opensrc crates:<package>    # Rust crate (e.g., npx opensrc crates:serde)
npx opensrc <owner>/<repo>      # GitHub repo (e.g., npx opensrc vercel/ai)
```

<!-- opensrc:end -->
