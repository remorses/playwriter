this codebase has the codebase for playwriter

the extension uses chrome.debugger to manage the user browser

read ./README.md for an overview of how this extension and mcp work
read playwriter/src/prompt.md to understand how the MCP works

## architecture

- user installs the extension in chrome. we assume there is only one chrome window for now, the first opened. 
- extension connects to a websocket server. on 19988. if this server is still not open, it retries connecting in a loop
- the MCP spawns the ws server if not already listening on 19988, in background. the mcp then connects to this same server with a playwright client
- the server exposes /cdp/client-id which is used by playwright clients to communicate with the extension
- the extension instead connects to /extension which is used to receive cdp commands and send responses and cdp events.
- some events are treated specially for example because
  - we need to send attachedToTarget to let playwright know which pages are available
  - we need to send detachedFromTarget when we disable the extension in a tab
  - a few more events need custom handling
- tabs are identified by sessionId or targetId (CDP concepts) or tabId (chrome debugger concept only)

## development

extension/ contains the chrome extension code. you need to run `pnpm build` to make it ready to be loaded in chrome. the extension folder chrome will use is extension/dist

playwriter contains the ws server and MCP code. also the tests for the mcp are there. playwriter/src/prompt.md contains the docs for the MCP the agent will use. you should add there important sections that help the agent control the browser well with the MCP interface 

playwriter/src/resource.md is for more generic knowledge about playwright that the agent can use when necessary, for things like best practices for selecting locators on the page

## CDP docs

here are some commands you can run to fetch does about CDP various domains (events and commands namespaces)

```
curl -sL https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Target.pdl # manage “targets”: pages, iframes, workers, etc., and attach/detach sessions
curl -sL https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Browser.pdl # top-level browser control: version info, window management, permission settings, etc.
curl -sL https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Page.pdl – navigate, reload, screenshot, PDF, frame management, dialogs, and page lifecycle events.
curl -sL https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Emulation.pdl # emulate device metrics, viewport, timezone, locale, geolocation, media type, CPU, etc.
```

you can list other files in that folder on github to read more if you need to control things like DOM, performance, etc

## testing

run `cd playwriter && pnpm test` to test the extension and mcp and CDP directly in a chrome instance automated. with the extension loaded too.

the test script will also pass -u to update some inline snapshots used

you can run singular tests with `-t "testname"`

each test() block should reset the extension connection to make sure tests are independent.

NEVER call browser.close() in tests or any other code that interacts with our CDP endpoint

remember that every time the extension is activated in a tab that tab gets added to the available pages. so if you toggle the extension and then do .newPage() there will be 2 pages, not 1.

to debug server or extension issues you can also inspect the file playwriter/relay-server.log to see both extension and server logs. with all cdp events sent. to see if there are events missing or something broken. this file is recreated every time the server is started and appended in real time. use rg to only read relevant lines and parts because it can get quite long
