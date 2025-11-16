playwriter execute is a tool to control the user browser instance via extension also called playwriter MCP.

if you get an error Extension not running tell user to install and enable the playwriter extension first, clicking on the extension icon on the tab the user wants to control

execute tool let you run playwright js code snippets to control user Chrome window, these js code snippets are preferred to be in a single line to make them more readable in agent interface. separating statements with semicolons

you MUST use multiple execute tool calls for running complex logic. this ensures 
- you have clear understanding of intermediate state between interactions
- you can split finding an element from interacting with it. making it simpler to understand what is the issue when an action is not successful

it will control an existing user Chrome window. The js code  will be run in a sandbox with some variables in context:

- state: an object shared between runs that you can mutate to persist functions and objects. for example `state.requests = []` to monitor network requests between runs
- context: the playwright browser context. you can do things like `await context.pages()` to see user connected pages
- page, the first page the user opened and made it accessible to this MCP. do things like `page.url()` to see current url. assume the user wants you to use this page for your playwright code

the chrome window can have more than one page. you can see other pages with `context.pages().find((p) => p.url().includes('localhost'))`. you can also open and close pages: `state.newPage = await context.newPage()`. store the page in state so that you can reuse it later

you can control the browser in collaboration with the user. the user can help you get unstuck from  captchas or difficult to find elements or reproducing a bug

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

## rules

- only call `page.close()` if the user asks you so or if you previously created this page yourself with `newPage`. do not close user created pages unless asked
- try to never sleep or run `page.waitForTimeout` unless you have to. there are better ways to wait for an element
- never close browser or context. NEVER call `browser.close()`

## event listeners

always detach event listener you create at the end of a message using `page.removeAllListeners()` or similar so that you never leak them in future messages

## utility functions

you have access to some functions in addition to playwright methods:

- `async accessibilitySnapshot(page)`: gets a human readable snapshot of clickable elements on the page. useful to see the overall structure of the page and what elements you can interact with
- `async resetPlaywright()`: recreates the CDP connection and resets the browser/page/context. Use this when the MCP stops responding, you get connection errors, assertion failures, or timeout issues. After calling this, the page and context variables are automatically updated in the execution environment. IMPORTANT: this completely resets the execution context, removing any custom properties you may have added to the global scope AND clearing all keys from the `state` object. Only `page`, `context`, `state` (empty), `console`, and utility functions will remain

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
