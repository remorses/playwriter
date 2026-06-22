// Cloudflare Workers entrypoint for the Playwriter D1 schema.
// Uses drizzle-orm/d1 with the `workerd` export condition so worker code and
// local Node.js scripts can share the same `db` package import path.

import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from './schema.ts'

export { schema }

export function getDb() {
  return drizzle(env.DB, { schema, relations: schema.relations })
}
