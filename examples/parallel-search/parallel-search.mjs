import crypto from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

async function callParallel({ name, arguments: args, signal }) {
  const deadline = AbortSignal.timeout(60_000)
  const operationSignal = signal ? AbortSignal.any([signal, deadline]) : deadline
  operationSignal.throwIfAborted()
  const client = new Client({ name: 'playwriter-parallel-search-example', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL('https://search.parallel.ai/mcp'), {
    requestInit: {
      headers: { 'User-Agent': 'playwriter-parallel-search-example/1.0.0' },
    },
    fetch: (url, init) => {
      return fetch(url, {
        ...init,
        signal: init?.signal ? AbortSignal.any([init.signal, operationSignal]) : operationSignal,
      })
    },
  })

  try {
    await client.connect(transport, { signal: operationSignal, timeout: 15_000 })
    const { tools } = await client.listTools({}, { signal: operationSignal, timeout: 15_000 })
    if (
      !tools.some((tool) => {
        return tool.name === name
      })
    ) {
      throw new Error(`Parallel does not expose ${name}`)
    }
    const result = await client.callTool({ name, arguments: args }, undefined, {
      signal: operationSignal,
      timeout: 60_000,
    })
    if (result.isError) {
      throw new Error(`Parallel ${name} failed`, { cause: result })
    }
    if (result.structuredContent) {
      return result.structuredContent
    }
    const text = result.content.find((item) => {
      return item.type === 'text'
    })?.text
    if (!text) {
      throw new Error(`Parallel ${name} returned no JSON content`)
    }
    return JSON.parse(text)
  } finally {
    await client.close()
  }
}

export async function searchWeb({ objective, searchQueries, signal }) {
  return callParallel({
    name: 'web_search',
    arguments: { objective, search_queries: searchQueries, session_id: crypto.randomUUID() },
    signal,
  })
}

export async function fetchPages({ urls, objective, sessionId, signal }) {
  return callParallel({
    name: 'web_fetch',
    arguments: { urls, objective, session_id: sessionId ?? crypto.randomUUID() },
    signal,
  })
}
