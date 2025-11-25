playwriter execute is a tool to control the user browser instance via extension also called playwriter MCP.

if you get an error Extension not running tell user to install and enable the playwriter extension first, clicking on the extension icon on the tab the user wants to control

execute tool let you run playwright js code snippets to control user Chrome window, these js code snippets are preferred to be in a single line to make them more readable in agent interface. separating statements with semicolons

you can extract data from your script using `console.log`. But remember that console.log in `page.evaluate` callbacks are run in the browser, so you will not see them. Instead log the evaluate result

to keep some variables between calls, you can use `state` global object. constants and variables are reset between runs. Instead use code like `state.newPage = await browser.newPage();` to reuse the created page in later calls

you MUST use multiple execute tool calls for running complex logic. this ensures 
- you have clear understanding of intermediate state between interactions
- you can split finding an element from interacting with it. making it simpler to understand what is the issue when an action is not successful

it will control an existing user Chrome window. The js code  will be run in a sandbox with some variables in context:

- state: an object shared between runs that you can mutate to persist functions and objects. for example `state.requests = []` to monitor network requests between runs
- context: the playwright browser context. you can do things like `await context.pages()` to see user connected pages
- page, the first page the user opened and made it accessible to this MCP. do things like `page.url()` to see current url. assume the user wants you to use this page for your playwright code
- require: node's require function to load modules
- all standard Node.js globals: setTimeout, setInterval, clearTimeout, clearInterval, URL, URLSearchParams, fetch, Buffer, TextEncoder, TextDecoder, crypto, AbortController, AbortSignal, structuredClone

the chrome window can have more than one page. you can see other pages with `context.pages().find((p) => p.url().includes('localhost'))`. you can also open and close pages: `state.newPage = await context.newPage()`. store the page in state so that you can reuse it later

you can control the browser in collaboration with the user. the user can help you get unstuck from  captchas or difficult to find elements or reproducing a bug

## capabilities

examples of things playwriter MCP can do:
- monitor logs for a page while the user reproduces a but to let you understand what is causing a bug
- monitor logs while also controlling the page, then read collected logs and debug an issue
- monitor xhr network requests while scrolling an infinite scroll page to extract data from a website
- get accessibility snapshot to see clickable elements on the page, then click or interact with them to automate a task like ordering pizza

## finding the page to execute code in

if you plan to control a specific page for an url you can store it in `state` so you can reuse it later on:

```js
const pages = context.pages().filter(x => x.url().includes('localhost'));
if (pages.length === 0) throw new Error('No page with URL matching localhost found');
if (pages.length > 1) throw new Error('Multiple pages with URL matching localhost found');
state.localhostPage = pages[0];
// do things with the page
await state.localhostPage.bringToFront();
```

IMPORTANT! never call bringToFront unless specifically asked by the user. It is very bothering to the user otherwise! you don't need to call bringToFront before being able to interact. you can very well interact without calling it first. on any page in the background you have access to.

## rules

- only call `page.close()` if the user asks you so or if you previously created this page yourself with `newPage`. do not close user created pages unless asked
- try to never sleep or run `page.waitForTimeout` unless you have to. there are better ways to wait for an element
- never close browser or context. NEVER call `browser.close()`

## always check the current page state after an action

after you click a button or submit a form you ALWAYS have to then check what is the current state of the page. you cannot assume what happened after doing an action. instead run the following code to know what happened after the action:

`console.log('url:', page.url()); console.log(await accessibilitySnapshot({ page }).then(x => x.slice(0, 1000)));`

if nothing happened you may need to wait before the action completes, using something like `page.waitForNavigation({timeout: 3000})` or `await page.waitForLoadState('networkidle', {timeout: 3000})`

if nothing happens it could also means that you clicked the wrong button or link. try to search for other appropriate elements to click or submit


## event listeners

always detach event listener you create at the end of a message using `page.removeAllListeners()` or similar so that you never leak them in future messages

## utility functions

you have access to some functions in addition to playwright methods:

- `async accessibilitySnapshot({ page, search, contextLines, showDiffSinceLastCall })`: gets a human readable snapshot of clickable elements on the page. useful to see the overall structure of the page and what elements you can interact with.
    - `page`: the page object to snapshot
    - `search`: (optional) a string or regex to filter the snapshot. If provided, returns the first 10 matches with surrounding context
    - `contextLines`: (optional) number of lines of context to show around each match (default: 10)
    - `showDiffSinceLastCall`: (optional) if true, returns a unified diff patch showing only changes since the last snapshot call for this page. Disables search when enabled. Useful to see what changed after an action.
- `getLatestLogs({ page, count, search })`: retrieves browser console logs. The system automatically captures and stores up to 5000 logs per page. Logs are cleared when a page reloads or navigates.
    - `page`: (optional) filter logs by a specific page instance. Only returns logs from that page
    - `count`: (optional) limit number of logs to return. If not specified, returns all available logs
    - `search`: (optional) string or regex to filter logs. Only returns logs that match

To bring a tab to front and focus it, use the standard Playwright method `await page.bringToFront()`

example:

```md
- generic [active] [ref=e1]:
    - generic [ref=e2]:
        - banner [ref=e3]:
            - generic [ref=e5]:
                - link "shadcn/ui" [ref=e6] [cursor=pointer]:
                    - /url: /
                    - img
                    - generic [ref=e11] [cursor=pointer]: shadcn/ui
                - navigation [ref=e12]:
                    - link "Docs" [ref=e13] [cursor=pointer]:
                        - /url: /docs/installation
                    - link "Components" [ref=e14] [cursor=pointer]:
                        - /url: /docs/components
```

Then you can use `page.locator(`aria-ref=${ref}`)` to get an element with a specific `ref` and interact with it.

`const componentsLink = page.locator('aria-ref=e14').click()` 

IMPORTANT: notice that we do not add any quotes in `aria-ref`! it MUST be called without quotes

## getting selector for a locator identified by snapshot aria-ref

in some cases you want to get a selector for a locator you just identified using `const element = page.locator('aria-ref=${ref}')`. To do so you can use `await getLocatorStringForElement(element)`. This is useful if you need to find other elements of the same type in a list for example. If you know the selector you can usually change a bit the selector to find the other elements of the same type in the list or table

```js
const loc = page.locator('aria-ref=123');
console.log(await getLocatorStringForElement(loc)); 
// => "getByRole('button', { name: 'Save' })" or similar
```

## finding specific elements with snapshot

You can use `search` to find specific elements in the snapshot without reading the whole page structure. This is useful for finding forms, textareas, or specific text.

Example: find a textarea or form using case-insensitive regex:

```js
const snapshot = await accessibilitySnapshot({ page, search: /textarea|form/i })
console.log(snapshot)
```

Example: find elements containing "Login":

```js
const snapshot = await accessibilitySnapshot({ page, search: "Login" })
console.log(snapshot)
```

## getting outputs of code execution

You can use `console.log` to print values you want to see in the tool call result. For seeing logs across runs you can store then in `state.logs` and then print them later, filtering and paginating them too.

## using page.evaluate

you can execute client side JavaScript code using `page.evaluate()`

When executing code with `page.evaluate()`, return values directly from the evaluate function. Use `console.log()` outside of evaluate to display results:

```js
// Get data from the page by returning it
const title = await page.evaluate(() => document.title)
console.log('Page title:', title)

// Return multiple values as an object
const pageInfo = await page.evaluate(() => ({
    url: window.location.href,
    buttonCount: document.querySelectorAll('button').length,
    readyState: document.readyState,
}))
console.log(pageInfo)
```

## read logs during interactions

you can see logs during interactions with `page.on('console', msg => console.log(`Browser log: [${msg.type()}] ${msg.text()}`))`

then remember to call `context.removeAllListeners()` or `page.removeAllListeners('console')` to not see logs in next execute calls.

## reading past logs

you can keep track of logs using `state.logs = []; page.on('console', msg => state.logs.push({ type: msg.type(), text: msg.text() }))`

later, you can read logs that you care about. For example, to get the last 100 logs that contain the word "error":

`console.log('errors:'); state.logs.filter(log => log.type === 'error').slice(-100).forEach(x => console.log(x))`

then to reset logs: `state.logs = []` and to stop listening: `page.removeAllListeners('console')`

## using getLatestLogs to read browser console logs

The system automatically captures and stores up to 5000 browser console logs per page. Logs are automatically cleared when a page reloads or navigates to a new URL. You can retrieve logs using the `getLatestLogs` function:

```js
// Get all browser console logs from all pages (up to 5000 per page)
const allLogs = await getLatestLogs()
console.log(allLogs)

// Get last 50 browser error logs
const errorLogs = await getLatestLogs({ count: 50, search: /\[error\]/ })
console.log(errorLogs)

// Get all browser logs from the current page only
const pageLogs = await getLatestLogs({ page })
console.log(pageLogs)

// Find browser logs containing specific text
const authLogs = await getLatestLogs({ search: 'authentication failed' })
console.log(authLogs)

// Example output format:
// [log] User clicked login button
// [error] Failed to fetch /api/auth
// [warn] Session expiring soon
```

## loading file content into inputs

you can use the `require` function to read files and fill inputs with their content:

```js
const fs = require('node:fs'); const content = fs.readFileSync('/path/to/file.txt', 'utf-8'); await page.locator('textarea').fill(content)
```

for example, to fill a textarea with the content of a markdown file:

```js
const fs = require('node:fs'); const readme = fs.readFileSync('./README.md', 'utf-8'); await page.locator('#description').fill(readme); console.log('Filled textarea with README content')
```
