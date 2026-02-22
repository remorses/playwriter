import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { Stream } from 'node:stream'
import path from 'node:path'
import url from 'node:url'

const __filename = url.fileURLToPath(import.meta.url)

export interface CreateTransportOptions {
  clientName?: string
  port?: number
}

export async function createTransport({ args = [], port }: { args?: string[]; port?: number } = {}): Promise<{
  transport: Transport
  stderr: Stream | null
}> {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    DEBUG: 'playwriter:mcp:test',
    DEBUG_COLORS: '0',
    DEBUG_HIDE_DATE: '1',
  }
  if (port) {
    env.PLAYWRITER_PORT = String(port)
  }
  const transport = new StdioClientTransport({
    command: 'pnpm',
    args: ['vite-node', path.join(path.dirname(__filename), 'cli.ts'), ...args],
    cwd: path.join(path.dirname(__filename), '..'),
    stderr: 'pipe',
    env,
  })

  return {
    transport,
    stderr: transport.stderr!,
  }
}

export async function createMCPClient(options?: CreateTransportOptions): Promise<{
  client: Client
  stderr: string
  cleanup: () => Promise<void>
}> {
  const client = new Client({
    name: options?.clientName ?? 'test',
    version: '1.0.0',
  })

  const { transport, stderr } = await createTransport({ port: options?.port })

  let stderrBuffer = ''
  stderr?.on('data', (data) => {
    process.stderr.write(data)

    stderrBuffer += data.toString()
  })

  await client.connect(transport)
  await client.ping()

  const cleanup = async () => {
    try {
      await client.close()
    } catch (e) {
      console.error('Error during MCP client cleanup:', e)
      // Ignore errors during cleanup
    }
  }

  return {
    client,
    stderr: stderrBuffer,
    cleanup,
  }
}
