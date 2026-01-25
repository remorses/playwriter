import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import dedent from 'string-dedent'
import { LOG_FILE_PATH, VERSION } from './utils.js'
import { ensureRelayServer, RELAY_PORT } from './relay-client.js'
import { PlaywrightExecutor, CodeExecutionTimeoutError } from './executor.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const require = createRequire(import.meta.url)

// Single executor instance for MCP (created lazily)
let executor: PlaywrightExecutor | null = null

interface RemoteConfig {
  host: string
  port: number
  token?: string
}

function getRemoteConfig(): RemoteConfig | null {
  const host = process.env.PLAYWRITER_HOST
  if (!host) {
    return null
  }
  return {
    host,
    port: RELAY_PORT,
    token: process.env.PLAYWRITER_TOKEN,
  }
}

function getLogServerUrl(): string {
  const remote = getRemoteConfig()
  if (remote) {
    return `http://${remote.host}:${remote.port}/mcp-log`
  }
  return `http://127.0.0.1:${RELAY_PORT}/mcp-log`
}

async function sendLogToRelayServer(level: string, ...args: any[]) {
  try {
    await fetch(getLogServerUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level, args }),
      signal: AbortSignal.timeout(1000),
    })
  } catch {
    // Silently fail if relay server is not available
  }
}

/**
 * Log to both console.error (for early startup) and relay server log file.
 * Fire-and-forget to avoid blocking.
 */
function mcpLog(...args: any[]) {
  console.error(...args)
  sendLogToRelayServer('log', ...args)
}

/** MCP-specific logger for executor */
const mcpLogger = {
  log: (...args: any[]) => mcpLog(...args),
  error: (...args: any[]) => {
    console.error(...args)
    sendLogToRelayServer('error', ...args)
  },
}

async function ensureRelayServerForMcp(): Promise<void> {
  await ensureRelayServer({ logger: mcpLogger })
}

async function getOrCreateExecutor(): Promise<PlaywrightExecutor> {
  if (executor) {
    return executor
  }
  
  const remote = getRemoteConfig()
  if (!remote) {
    await ensureRelayServerForMcp()
  }
  
  // Pass config instead of pre-generated URL so executor can generate unique URLs for each connection
  const cdpConfig = remote || { port: RELAY_PORT }
  executor = new PlaywrightExecutor({
    cdpConfig,
    logger: mcpLogger,
    cwd: process.cwd(),
  })
  
  return executor
}

async function checkRemoteServer({ host, port }: { host: string; port: number }): Promise<void> {
  const versionUrl = `http://${host}:${port}/version`
  try {
    const response = await fetch(versionUrl, { signal: AbortSignal.timeout(3000) })
    if (!response.ok) {
      throw new Error(`Server responded with status ${response.status}`)
    }
  } catch (error: any) {
    const isConnectionError = error.cause?.code === 'ECONNREFUSED' || error.name === 'TimeoutError'
    if (isConnectionError) {
      throw new Error(
        `Cannot connect to remote relay server at ${host}:${port}. ` +
          `Make sure 'npx -y playwriter serve' is running on the host machine.`,
      )
    }
    throw new Error(`Failed to connect to remote relay server: ${error.message}`)
  }
}

const server = new McpServer({
  name: 'playwriter',
  title: 'The better playwright MCP: works as a browser extension. No context bloat. More capable.',
  version: VERSION,
})

const promptContent =
  fs.readFileSync(path.join(__dirname, '..', 'dist', 'prompt.md'), 'utf-8') +
  `\n\nfor debugging internal playwriter errors, check playwriter relay server logs at: ${LOG_FILE_PATH}`

server.resource(
  'debugger-api',
  'https://playwriter.dev/resources/debugger-api.md',
  { mimeType: 'text/plain' },
  async () => {
    const packageJsonPath = require.resolve('playwriter/package.json')
    const packageDir = path.dirname(packageJsonPath)
    const content = fs.readFileSync(path.join(packageDir, 'dist', 'debugger-api.md'), 'utf-8')
    return {
      contents: [{ uri: 'https://playwriter.dev/resources/debugger-api.md', text: content, mimeType: 'text/plain' }],
    }
  },
)

server.resource(
  'editor-api',
  'https://playwriter.dev/resources/editor-api.md',
  { mimeType: 'text/plain' },
  async () => {
    const packageJsonPath = require.resolve('playwriter/package.json')
    const packageDir = path.dirname(packageJsonPath)
    const content = fs.readFileSync(path.join(packageDir, 'dist', 'editor-api.md'), 'utf-8')
    return {
      contents: [{ uri: 'https://playwriter.dev/resources/editor-api.md', text: content, mimeType: 'text/plain' }],
    }
  },
)

server.resource(
  'styles-api',
  'https://playwriter.dev/resources/styles-api.md',
  { mimeType: 'text/plain' },
  async () => {
    const packageJsonPath = require.resolve('playwriter/package.json')
    const packageDir = path.dirname(packageJsonPath)
    const content = fs.readFileSync(path.join(packageDir, 'dist', 'styles-api.md'), 'utf-8')
    return {
      contents: [{ uri: 'https://playwriter.dev/resources/styles-api.md', text: content, mimeType: 'text/plain' }],
    }
  },
)

server.tool(
  'execute',
  promptContent,
  {
    code: z
      .string()
      .describe(
        'js playwright code, has {page, state, context} in scope. Should be one line, using ; to execute multiple statements. you MUST call execute multiple times instead of writing complex scripts in a single tool call.',
      ),
    timeout: z.number().default(10000).describe('Timeout in milliseconds for code execution (default: 10000ms)'),
  },
  async ({ code, timeout }) => {
    try {
      // Check relay server on every execute to auto-recover from crashes
      const remote = getRemoteConfig()
      if (!remote) {
        await ensureRelayServerForMcp()
      }
      
      const exec = await getOrCreateExecutor()
      const result = await exec.execute(code, timeout)
      
      // Transform executor result to MCP format
      const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [
        { type: 'text', text: result.text },
      ]
      
      for (const image of result.images) {
        content.push({ type: 'image', data: image.data, mimeType: image.mimeType })
      }
      
      if (result.isError) {
        return { content, isError: true }
      }
      
      return { content }
    } catch (error: any) {
      const errorStack = error.stack || error.message
      const isTimeoutError = error instanceof CodeExecutionTimeoutError || error.name === 'TimeoutError'
      
      console.error('Error in execute tool:', errorStack)
      if (!isTimeoutError) {
        sendLogToRelayServer('error', 'Error in execute tool:', errorStack)
      }
      
      const resetHint = isTimeoutError
        ? ''
        : '\n\n[HINT: If this is an internal Playwright error, page/browser closed, or connection issue, call the `reset` tool to reconnect. Do NOT reset for other non-connection non-internal errors.]'
      
      return {
        content: [{ type: 'text', text: `Error executing code: ${error.message}\n${errorStack}${resetHint}` }],
        isError: true,
      }
    }
  },
)

server.tool(
  'reset',
  dedent`
    Recreates the CDP connection and resets the browser/page/context. Use this when the MCP stops responding, you get connection errors, if there are no pages in context, assertion failures, page closed, or other issues.

    After calling this tool, the page and context variables are automatically updated in the execution environment.

    This tools also removes any custom properties you may have added to the global scope AND clearing all keys from the \`state\` object. Only \`page\`, \`context\`, \`state\` (empty), \`console\`, and utility functions will remain.

    if playwright always returns all pages as about:blank urls and evaluate does not work you should ask the user to restart Chrome. This is a known Chrome bug.
  `,
  {},
  async () => {
    try {
      // Check relay server to auto-recover from crashes
      const remote = getRemoteConfig()
      if (!remote) {
        await ensureRelayServerForMcp()
      }
      
      const exec = await getOrCreateExecutor()
      const { page, context } = await exec.reset()
      const pagesCount = context.pages().length
      return {
        content: [
          { type: 'text', text: `Connection reset successfully. ${pagesCount} page(s) available. Current page URL: ${page.url()}` },
        ],
      }
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Failed to reset connection: ${error.message}` }],
        isError: true,
      }
    }
  },
)

export async function startMcp(options: { host?: string; token?: string } = {}) {
  if (options.host) {
    process.env.PLAYWRITER_HOST = options.host
  }
  if (options.token) {
    process.env.PLAYWRITER_TOKEN = options.token
  }

  const remote = getRemoteConfig()
  if (!remote) {
    await ensureRelayServerForMcp()
  } else {
    mcpLog(`Using remote CDP relay server: ${remote.host}:${remote.port}`)
    await checkRemoteServer(remote)
  }

  const transport = new StdioServerTransport()
  await server.connect(transport)
}
