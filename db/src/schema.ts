// Schema for the Playwriter D1 database.
// Contains BetterAuth core tables for auth (Google social login, device flow),
// the org/member hierarchy, and cloud browser/session tables for Browser Use
// cloud browser management.

import { defineRelations } from 'drizzle-orm'
import * as s from 'drizzle-orm/sqlite-core'
import { ulid } from 'ulid'

// Integer column that stores epoch milliseconds as a plain number.
// Accepts Date objects in toDriver so BetterAuth's internal Date params
// don't crash D1's .bind() which only accepts string | number | null | ArrayBuffer.
export const epochMs = s.customType<{ data: number; driverParam: number }>({
  dataType() {
    return 'integer'
  },
  toDriver(value: unknown): number {
    if (value instanceof Date) return value.getTime()
    return value as number
  },
  fromDriver(value: unknown): number {
    return value as number
  },
})

// ── BetterAuth core tables ──────────────────────────────────────────

export const user = s.sqliteTable('user', {
  id: s.text('id').primaryKey().notNull().$defaultFn(() => ulid()),
  name: s.text('name').notNull(),
  email: s.text('email').notNull().unique(),
  emailVerified: s.integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: s.text('image'),
  createdAt: epochMs('created_at').notNull().$defaultFn(() => Date.now()),
  updatedAt: epochMs('updated_at').notNull().$defaultFn(() => Date.now()),
})

export const session = s.sqliteTable('session', {
  id: s.text('id').primaryKey().notNull().$defaultFn(() => ulid()),
  userId: s.text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  token: s.text('token').notNull().unique(),
  expiresAt: epochMs('expires_at').notNull(),
  ipAddress: s.text('ip_address'),
  userAgent: s.text('user_agent'),
  createdAt: epochMs('created_at').notNull().$defaultFn(() => Date.now()),
  updatedAt: epochMs('updated_at').notNull().$defaultFn(() => Date.now()),
}, (table) => [
  s.index('session_user_id_idx').on(table.userId),
])

export const account = s.sqliteTable('account', {
  id: s.text('id').primaryKey().notNull().$defaultFn(() => ulid()),
  userId: s.text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accountId: s.text('account_id').notNull(),
  providerId: s.text('provider_id').notNull(),
  accessToken: s.text('access_token'),
  refreshToken: s.text('refresh_token'),
  accessTokenExpiresAt: epochMs('access_token_expires_at'),
  refreshTokenExpiresAt: epochMs('refresh_token_expires_at'),
  scope: s.text('scope'),
  idToken: s.text('id_token'),
  password: s.text('password'),
  createdAt: epochMs('created_at').notNull().$defaultFn(() => Date.now()),
  updatedAt: epochMs('updated_at').notNull().$defaultFn(() => Date.now()),
}, (table) => [
  s.index('account_user_id_idx').on(table.userId),
])

export const verification = s.sqliteTable('verification', {
  id: s.text('id').primaryKey().notNull().$defaultFn(() => ulid()),
  identifier: s.text('identifier').notNull(),
  value: s.text('value').notNull(),
  expiresAt: epochMs('expires_at').notNull(),
  createdAt: epochMs('created_at').notNull().$defaultFn(() => Date.now()),
  updatedAt: epochMs('updated_at').notNull().$defaultFn(() => Date.now()),
})

// ── Device flow (BetterAuth device authorization plugin) ────────────

export const deviceCode = s.sqliteTable('device_code', {
  id: s.text('id').primaryKey().notNull().$defaultFn(() => ulid()),
  deviceCode: s.text('device_code').notNull().unique(),
  userCode: s.text('user_code').notNull().unique(),
  userId: s.text('user_id').references(() => user.id, { onDelete: 'cascade' }),
  expiresAt: epochMs('expires_at').notNull(),
  status: s.text('status', { enum: ['pending', 'approved', 'denied', 'expired'] }).notNull().default('pending'),
  lastPolledAt: epochMs('last_polled_at'),
  pollingInterval: s.integer('polling_interval', { mode: 'number' }),
  clientId: s.text('client_id'),
  scope: s.text('scope'),
}, (table) => [
  s.index('device_code_user_id_idx').on(table.userId),
])

// ── Org tables ──────────────────────────────────────────────────────

export const org = s.sqliteTable('org', {
  id: s.text('id').primaryKey().notNull().$defaultFn(() => ulid()),
  name: s.text('name').notNull(),
  /** Stripe customer id, one customer per org, set once on first checkout.
   *  Single source of truth; reused for every checkout/portal call so we never
   *  create duplicate Stripe customers. */
  stripeCustomerId: s.text('stripe_customer_id'),
  createdAt: epochMs('created_at').notNull().$defaultFn(() => Date.now()),
  updatedAt: epochMs('updated_at').notNull().$defaultFn(() => Date.now()),
})

export const orgMember = s.sqliteTable('org_member', {
  id: s.text('id').primaryKey().notNull().$defaultFn(() => ulid()),
  orgId: s.text('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  userId: s.text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  role: s.text('role', { enum: ['admin', 'member'] }).notNull().default('member'),
  createdAt: epochMs('created_at').notNull().$defaultFn(() => Date.now()),
}, (table) => [
  s.index('org_member_org_id_idx').on(table.orgId),
  s.index('org_member_user_id_idx').on(table.userId),
  s.uniqueIndex('org_member_org_id_user_id_unique').on(table.orgId, table.userId),
  // Ensures ensureOrg() race safety: two concurrent requests for the same user
  // can't both succeed in creating different orgs because the second insert
  // hits this unique constraint.
  s.uniqueIndex('org_member_user_id_unique').on(table.userId),
])

// ── Cloud browsers (Browser Use profiles tied to an org) ────────────

// TODO(subscription): gate cloud browser creation behind active subscription
export const cloudBrowser = s.sqliteTable('cloud_browser', {
  id: s.text('id').primaryKey().notNull().$defaultFn(() => ulid()),
  orgId: s.text('org_id').notNull().references(() => org.id, { onDelete: 'cascade' }),
  name: s.text('name').notNull(),
  /** Browser Use profile id for persistent browser state (cookies, localStorage, etc.) */
  browserUseProfileId: s.text('browser_use_profile_id'),
  /** Default proxy region for sessions spawned from this browser */
  defaultRegion: s.text('default_region'),
  createdAt: epochMs('created_at').notNull().$defaultFn(() => Date.now()),
  updatedAt: epochMs('updated_at').notNull().$defaultFn(() => Date.now()),
}, (table) => [
  s.index('cloud_browser_org_id_idx').on(table.orgId),
])

// ── Cloud sessions (active Browser Use sessions) ────────────────────

// TODO(subscription): gate cloud session creation behind active subscription
// Org is derived from cloudBrowser.orgId via the FK relationship.
// Not stored directly on cloudSession to avoid drift between the two.
export const cloudSession = s.sqliteTable('cloud_session', {
  id: s.text('id').primaryKey().notNull().$defaultFn(() => ulid()),
  cloudBrowserId: s.text('cloud_browser_id').notNull().references(() => cloudBrowser.id, { onDelete: 'cascade' }),
  /** Browser Use session id for CDP connection */
  browserUseSessionId: s.text('browser_use_session_id'),
  /** CDP WebSocket URL for connecting Playwright */
  cdpUrl: s.text('cdp_url'),
  /** Proxy region used for this session */
  proxyRegion: s.text('proxy_region'),
  /** Whether media (images, videos) is blocked to save bandwidth */
  blockMedia: s.integer('block_media', { mode: 'boolean' }).notNull().default(false),
  status: s.text('status', {
    enum: ['creating', 'running', 'stopped', 'error'],
  }).notNull().default('creating'),
  lastActivityAt: epochMs('last_activity_at'),
  createdAt: epochMs('created_at').notNull().$defaultFn(() => Date.now()),
  updatedAt: epochMs('updated_at').notNull().$defaultFn(() => Date.now()),
}, (table) => [
  s.index('cloud_session_cloud_browser_id_idx').on(table.cloudBrowserId),
])

// ── Relations (v2 API) ──────────────────────────────────────────────

export const relations = defineRelations(
  { user, session, account, verification, deviceCode, org, orgMember, cloudBrowser, cloudSession },
  (r) => ({
    user: {
      sessions: r.many.session(),
      accounts: r.many.account(),
      orgs: r.many.org({
        from: r.user.id.through(r.orgMember.userId),
        to: r.org.id.through(r.orgMember.orgId),
      }),
    },
    session: {
      user: r.one.user({ from: r.session.userId, to: r.user.id }),
    },
    account: {
      user: r.one.user({ from: r.account.userId, to: r.user.id }),
    },
    verification: {},
    deviceCode: {
      user: r.one.user({ from: r.deviceCode.userId, to: r.user.id }),
    },
    org: {
      members: r.many.orgMember(),
      cloudBrowsers: r.many.cloudBrowser(),
      users: r.many.user({
        from: r.org.id.through(r.orgMember.orgId),
        to: r.user.id.through(r.orgMember.userId),
      }),
    },
    orgMember: {
      org: r.one.org({ from: r.orgMember.orgId, to: r.org.id }),
      user: r.one.user({ from: r.orgMember.userId, to: r.user.id }),
    },
    cloudBrowser: {
      org: r.one.org({ from: r.cloudBrowser.orgId, to: r.org.id }),
      sessions: r.many.cloudSession(),
    },
    cloudSession: {
      cloudBrowser: r.one.cloudBrowser({ from: r.cloudSession.cloudBrowserId, to: r.cloudBrowser.id }),
    },
  }),
)
