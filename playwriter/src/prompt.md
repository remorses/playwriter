playwriter execute is a tool to control the user browser instance via extension also called playwriter MCP.

if you get an error Extension not running tell user to install and enable the playwriter extension first, clicking on the extension icon on the tab the user wants to control

execute tool let you run playwright js code snippets to control user Chrome window, these js code snippets are preferred to be in a single line to make them more readable in agent interface. separating statements with semicolons

it will control an existing user Chrome window. The js code  will be run in a sandbox with some variables in context:

- state: an object shared between runs that you can mutate to persist functions and objects. for example `state.requests = []` to monitor network requests between runs
- context: the playwright browser context. you can do things like `await context.pages()` to see user connected pages
- page, the first page the user opened and made it accessible to this MCP. do things like `page.url()` to see current url. assume the user wants you to use this page for your playwright code

the chrome window can have more than one page. you can see other pages with `context.pages().find((p) => p.url().includes('localhost'))`. you can also open and close pages: `state.newPage = await context.newPage()`. store the page in state so that you can reuse it later

you can control the browser in collaboration with the user. the user can help you get unstuck from  captchas or difficult to find elements or reproducing a bug

## rules

- only call `page.close()` if the user asks you so or if you previously created this page yourself with `newPage`. do not close user created pages unless asked
- try to never sleep or run `page.waitForTimeout` unless you have to. there are better ways to wait for an element

## event listeners

always detach event listener you create at the end of a message using `page.removeAllListeners()` or similar so that you never leak them in future messages

## utility functions

you have access to some functions in addition to playwright methods:

- `async accessibilitySnapshot(page)`: gets a human readable snapshot of clickable elements on the page. useful to see the overall structure of the page and what elements you can interact with

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
                    - link "Blocks" [ref=e15] [cursor=pointer]:
                        - /url: /blocks
                    - link "Charts" [ref=e16] [cursor=pointer]:
                        - /url: /charts/area
                    - link "Themes" [ref=e17] [cursor=pointer]:
                        - /url: /themes
                    - link "Colors" [ref=e18] [cursor=pointer]:
                        - /url: /colors
```

Then you can use `page.locator(`aria-ref=${ref}`)` to get an element with a specific `ref` and interact with it.

`const componentsLink = page.locator('aria-ref=e14').click()`

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

you can keep track of logs using `globalThis.logs = []; page.on('console', msg => globalThis.logs.push({ type: msg.type(), text: msg.text() }))`

later, you can read logs that you care about. For example, to get the last 100 logs that contain the word "error":

`console.log('errors:'); globalThis.logs.filter(log => log.type === 'error').slice(-100).forEach(x => console.log(x))`

then to reset logs: `globalThis.logs = []` and to stop listening: `page.removeAllListeners('console')`
