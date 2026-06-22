// Node.js entrypoint for the Playwriter D1 schema.
// Uses drizzle-orm/sqlite-proxy plus Cloudflare's D1 HTTP API so scripts can
// query the remote D1 database outside Cloudflare Workers through the same
// `db` package import path.

import { drizzle } from 'drizzle-orm/sqlite-proxy'
import * as schema from './schema.ts'

export { schema }

async function queryD1({
  sql,
  params,
  method,
}: {
  sql: string
  params: any[]
  method: 'run' | 'all' | 'values' | 'get'
}) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID!}/d1/database/${process.env.CLOUDFLARE_DATABASE_ID!}/${method === 'values' ? 'raw' : 'query'}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.CLOUDFLARE_D1_TOKEN!}`,
      },
      body: JSON.stringify({ sql, params }),
    },
  )

  const data = await response.json()

  if (!data || typeof data !== 'object') {
    throw new Error('Invalid D1 response')
  }

  if (!('success' in data) || typeof data.success !== 'boolean') {
    throw new Error('Invalid D1 response')
  }

  if (!data.success) {
    const errors = 'errors' in data && Array.isArray(data.errors)
      ? data.errors
        .filter((error) => error && typeof error === 'object' && 'code' in error && 'message' in error)
        .map((error) => `${error.code}: ${error.message}`)
        .join('\n')
      : 'Unknown D1 error'

    throw new Error(errors)
  }

  if (!('result' in data) || !Array.isArray(data.result)) {
    throw new Error('Invalid D1 response')
  }

  const result = data.result[0]?.results
  const rows = Array.isArray(result) ? result : (result?.rows ?? [])

  // sqlite-proxy expects a falsy rows value for `get` no-row results.
  // Returning [] is truthy and can produce `{ id: undefined }` in findFirst.
  // https://github.com/drizzle-team/drizzle-orm/issues/5461
  return {
    rows: method === 'get' && rows.length === 0 ? undefined : rows,
  }
}

export function getDb() {
  return drizzle(
    (sql, params, method) => queryD1({ sql, params, method }),
    async (queries) => Promise.all(queries.map((query) => queryD1(query))),
    { schema, relations: schema.relations },
  )
}
