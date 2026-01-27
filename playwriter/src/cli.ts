#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cac } from '@xmorse/cac'
import { VERSION, LOG_FILE_PATH, LOG_CDP_FILE_PATH } from './utils.js'
import { ensureRelayServer, RELAY_PORT, waitForExtension } from './relay-client.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const cliRelayEnv = { PLAYWRITER_AUTO_ENABLE: '1' }

const cli = cac('playwriter')

cli
  .command('', 'Start the MCP server or controls the browser with -e')
  .option('--host <host>', 'Remote relay server host to connect to (or use PLAYWRITER_HOST env var)')
  .option('--token <token>', 'Authentication token (or use PLAYWRITER_TOKEN env var)')
  .option('-s, --session <name>', 'Session ID (required for -e, get one with `playwriter session new`)')
  .option('-e, --eval <code>', 'Execute JavaScript code and exit, read https://playwriter.dev/SKILL.md for usage')
  .option('--timeout <ms>', 'Execution timeout in milliseconds', { default: 10000 })
  .action(async (options: { host?: string; token?: string; eval?: string; timeout?: number; session?: string }) => {
    // If -e flag is provided, execute code via relay server
    if (options.eval) {
      await executeCode({
        code: options.eval,
        timeout: options.timeout || 10000,
        sessionId: options.session,
        host: options.host,
        token: options.token,
      })
      return
    }

    // Otherwise start the MCP server
    const { startMcp } = await import('./mcp.js')
    await startMcp({
      host: options.host,
      token: options.token,
    })
  })

async function getServerUrl(host?: string): Promise<string> {
  const serverHost = host || process.env.PLAYWRITER_HOST || '127.0.0.1'
  return `http://${serverHost}:${RELAY_PORT}`
}

async function executeCode(options: {
  code: string
  timeout: number
  sessionId?: string
  host?: string
  token?: string
}): Promise<void> {
  const { code, timeout, host, token } = options
  const cwd = process.cwd()
  const sessionId = options.sessionId || process.env.PLAYWRITER_SESSION

  const serverUrl = await getServerUrl(host)

  // Ensure relay server is running (only for local)
  if (!host && !process.env.PLAYWRITER_HOST) {
    const restarted = await ensureRelayServer({ logger: console, env: cliRelayEnv })
    if (restarted){
      const connected = await waitForExtension({ logger: console, timeoutMs: 10000 })
      if (!connected) {
        console.error('Warning: Extension not connected. Commands may fail.')
      }
    }
  }

  // Session is required
  if (!sessionId) {
    console.error('Error: -s/--session is required.')
    console.error('Always run `playwriter session new` first to get a session ID to use.')
    process.exit(1)
  }

  // Build request URL with token if provided
  const executeUrl = `${serverUrl}/cli/execute`

  try {
    const response = await fetch(executeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token || process.env.PLAYWRITER_TOKEN ? { 'Authorization': `Bearer ${token || process.env.PLAYWRITER_TOKEN}` } : {}),
      },
      body: JSON.stringify({ sessionId, code, timeout, cwd }),
    })

    if (!response.ok) {
      const text = await response.text()
      console.error(`Error: ${response.status} ${text}`)
      process.exit(1)
    }

    const result = await response.json() as { text: string; images: Array<{ data: string; mimeType: string }>; isError: boolean }

    // Print output
    if (result.text) {
      if (result.isError) {
        console.error(result.text)
      } else {
        console.log(result.text)
      }
    }

    // Note: images are base64 encoded, we could save them to files if needed
    if (result.images && result.images.length > 0) {
      console.log(`\n${result.images.length} screenshot(s) captured`)
    }

    if (result.isError) {
      process.exit(1)
    }
  } catch (error: any) {
    if (error.cause?.code === 'ECONNREFUSED') {
      console.error('Error: Cannot connect to relay server.')
      console.error('The Playwriter relay server should start automatically. Check logs at:')
      console.error(`  ${LOG_FILE_PATH}`)
    } else {
      console.error(`Error: ${error.message}`)
    }
    process.exit(1)
  }
}

// Session management commands
cli
  .command('session new', 'Create a new session and print the session ID')
  .option('--host <host>', 'Remote relay server host')
  .action(async (options: { host?: string }) => {
    const serverUrl = await getServerUrl(options.host)

    if (!options.host && !process.env.PLAYWRITER_HOST) {
      await ensureRelayServer({ logger: console, env: cliRelayEnv })
    }

    try {
      const res = await fetch(`${serverUrl}/cli/session/suggest`)
      const { next } = await res.json() as { next: number }
      console.log(`Session ${next} created. Use with: playwriter -s ${next} -e "..."`)
    } catch (error: any) {
      console.error(`Error: ${error.message}`)
      process.exit(1)
    }
  })

cli
  .command('session list', 'List all active sessions')
  .option('--host <host>', 'Remote relay server host')
  .action(async (options: { host?: string }) => {
    const serverUrl = await getServerUrl(options.host)

    if (!options.host && !process.env.PLAYWRITER_HOST) {
      await ensureRelayServer({ logger: console, env: cliRelayEnv })
    }

    try {
      const res = await fetch(`${serverUrl}/cli/sessions`)
      const { sessions } = await res.json() as {
        sessions: Array<{
          id: string
          stateKeys: string[]
        }>
      }

      if (sessions.length === 0) {
        console.log('No active sessions')
        return
      }

      // Calculate column widths for aligned table
      const idWidth = Math.max(2, ...sessions.map((s) => { return String(s.id).length }))
      const stateWidth = Math.max(10, ...sessions.map((s) => { return s.stateKeys.join(', ').length || 1 }))

      // Header
      console.log('ID'.padEnd(idWidth) + '  ' + 'State Keys')
      console.log('-'.repeat(idWidth + stateWidth + 2))

      // Rows
      for (const session of sessions) {
        const stateStr = session.stateKeys.length > 0 ? session.stateKeys.join(', ') : '-'
        console.log(String(session.id).padEnd(idWidth) + '  ' + stateStr)
      }
    } catch (error: any) {
      console.error(`Error: ${error.message}`)
      process.exit(1)
    }
  })

cli
  .command('session delete <sessionId>', 'Delete a session and clear its state')
  .option('--host <host>', 'Remote relay server host')
  .action(async (sessionId: string, options: { host?: string }) => {
    const serverUrl = await getServerUrl(options.host)

    if (!options.host && !process.env.PLAYWRITER_HOST) {
      await ensureRelayServer({ logger: console, env: cliRelayEnv })
    }

    try {
      const response = await fetch(`${serverUrl}/cli/session/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })

      if (!response.ok) {
        const result = await response.json() as { error: string }
        console.error(`Error: ${result.error}`)
        process.exit(1)
      }

      console.log(`Session ${sessionId} deleted.`)
    } catch (error: any) {
      console.error(`Error: ${error.message}`)
      process.exit(1)
    }
  })

cli
  .command('session reset <sessionId>', 'Reset the browser connection for a session')
  .option('--host <host>', 'Remote relay server host')
  .action(async (sessionId: string, options: { host?: string }) => {
    const cwd = process.cwd()
    const serverUrl = await getServerUrl(options.host)

    if (!options.host && !process.env.PLAYWRITER_HOST) {
      await ensureRelayServer({ logger: console, env: cliRelayEnv })
    }

    try {
      const response = await fetch(`${serverUrl}/cli/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, cwd }),
      })

      if (!response.ok) {
        const text = await response.text()
        console.error(`Error: ${response.status} ${text}`)
        process.exit(1)
      }

      const result = await response.json() as { success: boolean; pageUrl: string; pagesCount: number }
      console.log(`Connection reset successfully. ${result.pagesCount} page(s) available. Current page URL: ${result.pageUrl}`)
    } catch (error: any) {
      console.error(`Error: ${error.message}`)
      process.exit(1)
    }
  })

cli
  .command('serve', 'Start the CDP relay server for remote MCP connections')
  .option('--host <host>', 'Host to bind to', { default: '0.0.0.0' })
  .option('--token <token>', 'Authentication token (or use PLAYWRITER_TOKEN env var)')
  .option('--replace', 'Kill existing server if running')
  .action(async (options: { host: string; token?: string; replace?: boolean }) => {
    const token = options.token || process.env.PLAYWRITER_TOKEN
    const isPublicHost = options.host === '0.0.0.0' || options.host === '::'
    if (isPublicHost && !token) {
      console.error('Error: Authentication token is required when binding to a public host.')
      console.error('Provide --token <token> or set PLAYWRITER_TOKEN environment variable.')
      process.exit(1)
    }

    // Check if server is already running on the port
    const net = await import('node:net')
    const isPortInUse = await new Promise<boolean>((resolve) => {
      const socket = new net.Socket()
      socket.setTimeout(500)
      socket.on('connect', () => {
        socket.destroy()
        resolve(true)
      })
      socket.on('timeout', () => {
        socket.destroy()
        resolve(false)
      })
      socket.on('error', () => {
        resolve(false)
      })
      socket.connect(RELAY_PORT, '127.0.0.1')
    })

    if (isPortInUse) {
      if (!options.replace) {
        console.log(`Playwriter server is already running on port ${RELAY_PORT}`)
        console.log('Tip: Use --replace to kill the existing server and start a new one.')
        process.exit(0)
      }

      // Kill existing process on the port
      console.log(`Killing existing server on port ${RELAY_PORT}...`)
      const { killPortProcess } = await import('kill-port-process')
      await killPortProcess(RELAY_PORT)
    }

    // Lazy-load heavy dependencies only when serve command is used
    const { createFileLogger } = await import('./create-logger.js')
    const { startPlayWriterCDPRelayServer } = await import('./cdp-relay.js')

    const logger = createFileLogger()

    process.title = 'playwriter-serve'

    process.on('uncaughtException', async (err) => {
      await logger.error('Uncaught Exception:', err)
      process.exit(1)
    })

    process.on('unhandledRejection', async (reason) => {
      await logger.error('Unhandled Rejection:', reason)
      process.exit(1)
    })

    const server = await startPlayWriterCDPRelayServer({
      port: RELAY_PORT,
      host: options.host,
      token,
      logger,
    })

    console.log('Playwriter CDP relay server started')
    console.log(`  Host: ${options.host}`)
    console.log(`  Port: ${RELAY_PORT}`)
    console.log(`  Token: ${token ? '(configured)' : '(none)'}`)
    console.log(`  Logs: ${logger.logFilePath}`)
    console.log(`  CDP Logs: ${LOG_CDP_FILE_PATH}`)
    console.log('')
    console.log(`CDP endpoint: http://${options.host}:${RELAY_PORT}${token ? '?token=<token>' : ''}`)
    console.log('')
    console.log('Press Ctrl+C to stop.')

    process.on('SIGINT', () => {
      console.log('\nShutting down...')
      server.close()
      process.exit(0)
    })

    process.on('SIGTERM', () => {
      console.log('\nShutting down...')
      server.close()
      process.exit(0)
    })
  })

cli
  .command('logfile', 'Print the path to the relay server log file')
  .action(() => {
    console.log(`relay: ${LOG_FILE_PATH}`)
    console.log(`cdp: ${LOG_CDP_FILE_PATH}`)
  })

cli
  .command('skill', 'Print the full playwriter usage instructions')
  .action(() => {
    const skillPath = path.join(__dirname, '..', 'src', 'skill.md')
    const content = fs.readFileSync(skillPath, 'utf-8')
    console.log(content)
  })

cli.help()
cli.version(VERSION)

cli.parse()
