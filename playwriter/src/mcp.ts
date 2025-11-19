import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { Page, Browser, BrowserContext, chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { getCdpUrl } from './utils.js'

const require = createRequire(import.meta.url)

const usefulGlobals = {
  setTimeout,
  setInterval,
  clearTimeout,
  clearInterval,
  URL,
  URLSearchParams,
  fetch,
  Buffer,
  TextEncoder,
  TextDecoder,
  crypto,
  AbortController,
  AbortSignal,
  structuredClone,
} as const

interface State {
  isConnected: boolean
  page: Page | null
  browser: Browser | null
  context: BrowserContext | null
}

interface VMContext {
  page: Page
  context: BrowserContext
  state: Record<string, any>
  console: {
    log: (...args: any[]) => void
    info: (...args: any[]) => void
    warn: (...args: any[]) => void
    error: (...args: any[]) => void
    debug: (...args: any[]) => void
  }
  accessibilitySnapshot: (page: Page) => Promise<string>
  resetPlaywright: () => Promise<{ page: Page; context: BrowserContext }>
  require: NodeRequire
  import: (specifier: string) => Promise<any>
}

type VMContextWithGlobals = VMContext & typeof usefulGlobals

const state: State = {
  isConnected: false,
  page: null,
  browser: null,
  context: null,
}

const RELAY_PORT = 19988

async function isPortTaken(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${port}/`)
    return response.ok
  } catch {
    return false
  }
}

async function ensureRelayServer(): Promise<void> {
  const portTaken = await isPortTaken(RELAY_PORT)

  if (portTaken) {
    console.error('CDP relay server already running')
    return
  }

  console.error('Starting CDP relay server...')

  const scriptPath = require.resolve('../dist/start-relay-server.js')

  const serverProcess = spawn(process.execPath, [scriptPath], {
    detached: true,
    stdio: 'ignore',
  })

  serverProcess.unref()

  // wait for extension to connect
  await new Promise((resolve) => setTimeout(resolve, 1000))

  console.error('CDP relay server started')
}

async function ensureConnection(): Promise<{ browser: Browser; page: Page }> {
  if (state.isConnected && state.browser && state.page) {
    return { browser: state.browser, page: state.page }
  }

  await ensureRelayServer()

  const cdpEndpoint = getCdpUrl({ port: RELAY_PORT })
  const browser = await chromium.connectOverCDP(cdpEndpoint)

  const contexts = browser.contexts()
  const context = contexts.length > 0 ? contexts[0] : await browser.newContext()

  const pages = context.pages()
  const page = pages.length > 0 ? pages[0] : await context.newPage()

  state.browser = browser
  state.page = page
  state.context = context
  state.isConnected = true

  return { browser, page }
}

async function getCurrentPage() {
  if (state.page) {
    return state.page
  }

  if (state.browser) {
    const contexts = state.browser.contexts()
    if (contexts.length > 0) {
      const pages = contexts[0].pages()

      if (pages.length > 0) {
        const page = pages[0]
        page.waitForEvent('load', {timeout})
        await page.emulateMedia({ colorScheme: null })
        return page
      }
    }
  }

  throw new Error('No page available')
}

async function resetConnection(): Promise<{ browser: Browser; page: Page; context: BrowserContext }> {
  if (state.browser) {
    try {
      await state.browser.close()
    } catch (e) {
      console.error('Error closing browser:', e)
    }
  }

  state.browser = null
  state.page = null
  state.context = null
  state.isConnected = false

  await ensureRelayServer()

  const cdpEndpoint = getCdpUrl({ port: RELAY_PORT })
  const browser = await chromium.connectOverCDP(cdpEndpoint)

  const contexts = browser.contexts()
  const context = contexts.length > 0 ? contexts[0] : await browser.newContext()

  const pages = context.pages()
  const page = pages.length > 0 ? pages[0] : await context.newPage()

  state.browser = browser
  state.page = page
  state.context = context
  state.isConnected = true

  return { browser, page, context }
}

const server = new McpServer({
  name: 'playwriter',
  title: 'The better playwright MCP: works as a browser extension. No context bloat. More capable.',
  version: '1.0.0',
})

const promptContent = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'prompt.md'), 'utf-8')

server.tool(
  'execute',
  promptContent,
  {
    code: z
      .string()
      .describe(
        'js playwright code, has {page, state, context} in scope. Should be one line, using ; to execute multiple statements. you MUST call execute multiple times instead of writing complex scripts in a single tool call.',
      ),
    timeout: z.number().default(5000).describe('Timeout in milliseconds for code execution (default: 5000ms)'),
  },
  async ({ code, timeout }) => {
    await ensureConnection()

    const page = await getCurrentPage()
    const context = state.context || page.context()

    console.error('Executing code:', code)
    try {
      const consoleLogs: Array<{ method: string; args: any[] }> = []

      const customConsole = {
        log: (...args: any[]) => {
          consoleLogs.push({ method: 'log', args })
        },
        info: (...args: any[]) => {
          consoleLogs.push({ method: 'info', args })
        },
        warn: (...args: any[]) => {
          consoleLogs.push({ method: 'warn', args })
        },
        error: (...args: any[]) => {
          consoleLogs.push({ method: 'error', args })
        },
        debug: (...args: any[]) => {
          consoleLogs.push({ method: 'debug', args })
        },
      }

      const accessibilitySnapshot = async (targetPage: Page) => {
        if ((targetPage as any)._snapshotForAI) {
          const snapshot = await (targetPage as any)._snapshotForAI()
          const snapshotStr =
            typeof snapshot === 'string'
              ? snapshot
              : JSON.stringify(snapshot, null, 2)
          return snapshotStr
        }
        throw new Error('accessibilitySnapshot is not available on this page')
      }

      let vmContextObj: VMContextWithGlobals = {
        page,
        context,
        state,
        console: customConsole,
        accessibilitySnapshot,
        resetPlaywright: async () => {
          const { page: newPage, context: newContext } = await resetConnection()

          Object.keys(state).forEach(key => delete state[key])

          const resetObj: VMContextWithGlobals = {
            page: newPage,
            context: newContext,
            state,
            console: customConsole,
            accessibilitySnapshot,
            resetPlaywright: vmContextObj.resetPlaywright,
            require,
            import: vmContextObj.import,
            ...usefulGlobals
          }
          Object.keys(vmContextObj).forEach(key => delete (vmContextObj as any)[key])
          Object.assign(vmContextObj, resetObj)
          return { page: newPage, context: newContext }
        },
        require,
        import: (specifier: string) => import(specifier),
        ...usefulGlobals
      }

      const vmContext = vm.createContext(vmContextObj)

      const wrappedCode = `(async () => { ${code} })()`

      const result = await Promise.race([
        vm.runInContext(wrappedCode, vmContext, {
          timeout,
          displayErrors: true,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Code execution timed out after ${timeout}ms`)), timeout),
        ),
      ])

      let responseText = ''

      if (consoleLogs.length > 0) {
        responseText += 'Console output:\n'
        consoleLogs.forEach(({ method, args }) => {
          const formattedArgs = args
            .map((arg) => {
              if (typeof arg === 'object') {
                return JSON.stringify(arg, null, 2)
              }
              return String(arg)
            })
            .join(' ')
          responseText += `[${method}] ${formattedArgs}\n`
        })
        responseText += '\n'
      }

      if (result !== undefined) {
        responseText += 'Return value:\n'
        if (typeof result === 'string') {
          responseText += result
        } else {
          responseText += JSON.stringify(result, null, 2)
        }
      } else if (consoleLogs.length === 0) {
        responseText += 'Code executed successfully (no output)'
      }

      const MAX_LENGTH = 1000
      let finalText = responseText.trim()
      if (finalText.length > MAX_LENGTH) {
        finalText = finalText.slice(0, MAX_LENGTH) + `\n\n[Truncated to ${MAX_LENGTH} characters. Better manage your logs or paginate them to read the full logs]`
      }

      return {
        content: [
          {
            type: 'text',
            text: finalText,
          },
        ],
      }
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: `Error executing code: ${error.message}\n${error.stack || ''}`,
          },
        ],
        isError: true,
      }
    }
  },
)

// Start the server
async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('Playwright MCP server running on stdio')
}

async function cleanup() {
  console.error('Shutting down MCP server...')

  if (state.browser) {
    try {
      await state.browser.close()
    } catch (e) {
      // Ignore errors during browser close
    }
  }

  process.exit(0)
}

// Handle process termination
process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)
process.on('exit', () => {
  // Browser cleanup is handled by the async cleanup function
})

main().catch(console.error)
