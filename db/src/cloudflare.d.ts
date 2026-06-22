// Minimal ambient declarations for cloudflare:workers so the db package
// typechecks without pulling in the full wrangler types. The website
// package has the real types via wrangler; this just satisfies tsc here.

declare module 'cloudflare:workers' {
  const env: {
    DB: import('drizzle-orm/d1').D1Database
    [key: string]: unknown
  }
  export { env }
}
