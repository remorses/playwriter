// Shared billing, quota, and VM lifecycle helpers for cloud browser sessions.
// Used by cloud-api.ts (HTTP routes) and cdp-proxy.ts (WebSocket proxy).

import { env } from 'cloudflare:workers'
import * as orm from 'drizzle-orm'
import * as schema from 'db/schema'
import { getDb, type OrgInfo } from './db.ts'
import { BrowserUseClient, BrowserUseApiError } from './lib/browser-use.ts'
import type { BrowserSession } from './lib/browser-use.ts'
import { ACTIVE_SUBSCRIPTION_STATUSES } from './lib/billing-rules.ts'

// ── Constants ───────────────────────────────────────────────────────

export const PENDING_PREFIX = 'pending-'
/** Placeholder rows older than 2 minutes are considered stale (VM creation
 *  should complete in under 60s). Fresh ones are counted as occupied slots. */
export const PENDING_STALE_MS = 2 * 60_000

// ── BU client factory ───────────────────────────────────────────────

export function getBrowserUse() {
  return new BrowserUseClient({ apiKey: env.BROWSER_USE_API_KEY as string })
}

// ── Helpers ─────────────────────────────────────────────────────────

export function isPendingRow(row: typeof schema.cloudSession.$inferSelect): boolean {
  return row.browserUseSessionId.startsWith(PENDING_PREFIX)
}

export function isUniqueConstraintError(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause)
  return message.includes('UNIQUE constraint failed') || message.includes('SQLITE_CONSTRAINT_UNIQUE')
}

/** Parse Browser Use proxyCost string (e.g. "0.05") to integer cents. */
export function parseCostToCents(proxyCost: string): number {
  const parsed = parseFloat(proxyCost)
  if (Number.isNaN(parsed)) return 0
  return Math.round(parsed * 100)
}

// ── Slot claiming ───────────────────────────────────────────────────

export async function claimCloudSessionSlot({
  orgId,
  maxSessions,
}: {
  orgId: string
  maxSessions: number
}): Promise<typeof schema.cloudSession.$inferSelect | null> {
  const db = getDb()
  for (let slotIndex = 1; slotIndex <= maxSessions; slotIndex++) {
    const placeholderId = `${PENDING_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    try {
      const [row] = await db
        .insert(schema.cloudSession)
        .values({
          orgId,
          slotIndex,
          browserUseSessionId: placeholderId,
        })
        .returning()
      if (row) return row
    } catch (cause) {
      if (isUniqueConstraintError(cause)) {
        continue
      }
      throw new Error('Failed to claim cloud session slot', { cause })
    }
  }
  return null
}

// ── Slot occupancy check ────────────────────────────────────────────

/** Check if a cloud session row represents an occupied slot.
 *  Returns 'occupied' for fresh pending rows, 'dead' for stale ones
 *  (pushed into deadIds), or 'needs-api-check' for real BU sessions. */
export function checkSlotOccupied(
  row: typeof schema.cloudSession.$inferSelect,
  deadIds: string[],
): 'occupied' | 'dead' | 'needs-api-check' {
  if (isPendingRow(row)) {
    if (Date.now() - row.createdAt < PENDING_STALE_MS) {
      return 'occupied'
    }
    deadIds.push(row.id)
    return 'dead'
  }
  return 'needs-api-check'
}

// ── BU session resolution ───────────────────────────────────────────

/** Record final proxy cost delta for a session being removed, then delete the row.
 *  Atomically increments org.proxySpendCents by the delta between the session's
 *  lastProxyCostCents baseline and the final BU proxyCost. */
export async function recordFinalCostAndDelete({
  cloudSession,
  buSession,
  orgId,
}: {
  cloudSession: typeof schema.cloudSession.$inferSelect
  buSession: BrowserSession | null
  orgId: string
}): Promise<void> {
  const db = getDb()
  const finalCostCents = buSession ? parseCostToCents(buSession.proxyCost) : 0
  const deltaCents = Math.max(0, finalCostCents - cloudSession.lastProxyCostCents)

  if (deltaCents > 0) {
    await db.batch([
      db.update(schema.org)
        .set({
          proxySpendCents: orm.sql`${schema.org.proxySpendCents} + ${deltaCents}`,
          updatedAt: Date.now(),
        })
        .where(orm.eq(schema.org.id, orgId)),
      db.delete(schema.cloudSession)
        .where(orm.eq(schema.cloudSession.id, cloudSession.id)),
    ])
  } else {
    await db.delete(schema.cloudSession)
      .where(orm.eq(schema.cloudSession.id, cloudSession.id))
  }
}

/** Check if a cloud session's BU VM is still alive. Returns null if dead.
 *  On confirmed 404: records final cost and pushes ID into deadIds.
 *  On transient errors (500, network): leaves the row for next retry. */
export async function resolveActiveSession(
  row: typeof schema.cloudSession.$inferSelect,
  bu: BrowserUseClient,
  deadIds: string[],
): Promise<BrowserSession | null> {
  try {
    const vm = await bu.getBrowser(row.browserUseSessionId)
    if (vm.status === 'active') {
      return vm
    }
    await recordFinalCostAndDelete({ cloudSession: row, buSession: vm, orgId: row.orgId })
    deadIds.push(row.id)
    return null
  } catch (err) {
    if (err instanceof BrowserUseApiError && err.status === 404) {
      deadIds.push(row.id)
    }
    return null
  }
}

/** Delete dead cloud session rows in one statement. */
export async function cleanupDeadSessions(deadIds: string[]): Promise<void> {
  if (deadIds.length === 0) return
  const db = getDb()
  const uniqueIds = [...new Set(deadIds)]
  await db.delete(schema.cloudSession).where(orm.inArray(schema.cloudSession.id, uniqueIds))
}

// ── Subscription & quota validation ─────────────────────────────────

/** Validate that an org can create a new cloud browser session.
 *  Checks subscription, budget, and quota. Returns maxSessions on success.
 *  Throws a JSON Response error on failure. */
export async function validateCloudAccess({ orgId }: { orgId: string }): Promise<{
  maxSessions: number
}> {
  const db = getDb()
  const bu = getBrowserUse()

  const [activeSub, dbSessions, orgRow] = await db.batch([
    db.query.subscription.findFirst({
      where: {
        orgId,
        status: { in: [...ACTIVE_SUBSCRIPTION_STATUSES] },
      },
    }),
    db.query.cloudSession.findMany({
      where: { orgId },
    }),
    db.query.org.findFirst({
      where: { id: orgId },
      columns: { proxySpendCents: true, proxyBudgetCents: true, proxySpendPeriodStart: true },
    }),
  ] as const)

  if (!activeSub) {
    throw new Response(
      JSON.stringify({ error: 'No active subscription. Run `playwriter cloud subscribe` to get started.' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // Detect billing period rollover and reset spend if needed
  const periodRolledOver = activeSub.currentPeriodStart != null
    && orgRow?.proxySpendPeriodStart !== activeSub.currentPeriodStart
  let proxySpendCents = orgRow?.proxySpendCents ?? 0
  if (periodRolledOver) {
    proxySpendCents = 0
    await db.update(schema.org)
      .set({
        proxySpendCents: 0,
        proxySpendPeriodStart: activeSub.currentPeriodStart,
        updatedAt: Date.now(),
      })
      .where(orm.eq(schema.org.id, orgId))
  }

  // Block if org exceeded proxy spend budget
  if (orgRow && proxySpendCents >= orgRow.proxyBudgetCents) {
    const spentDollars = (proxySpendCents / 100).toFixed(2)
    const budgetDollars = (orgRow.proxyBudgetCents / 100).toFixed(2)
    throw new Response(
      JSON.stringify({ error: `Proxy usage budget exceeded ($${spentDollars}/$${budgetDollars}). Contact support to increase your budget.` }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const maxSessions = activeSub.quantity

  // Count occupied slots: fresh pending + live BU sessions
  const deadIds: string[] = []
  let freshPendingCount = 0
  const buCheckRows: typeof dbSessions = []
  for (const row of dbSessions) {
    const status = checkSlotOccupied(row, deadIds)
    if (status === 'occupied') {
      freshPendingCount++
    } else if (status === 'needs-api-check') {
      buCheckRows.push(row)
    }
  }
  const buResults = await Promise.all(
    buCheckRows.map((row) => {
      return resolveActiveSession(row, bu, deadIds)
    }),
  )
  await cleanupDeadSessions(deadIds)
  const buOccupied = buResults.filter(Boolean).length
  const activeCount = freshPendingCount + buOccupied

  if (activeCount >= maxSessions) {
    throw new Response(
      JSON.stringify({ error: `Cloud session limit reached (${activeCount}/${maxSessions}). Stop an existing session or upgrade your subscription quantity.` }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    )
  }

  return { maxSessions }
}

// ── VM creation with slot lifecycle ─────────────────────────────────

/** Claim a slot, create a BU VM, and return the session info.
 *  Cleans up on failure (deletes placeholder, stops orphaned VM). */
export async function createCloudBrowserVM({
  orgId,
  maxSessions,
  proxyRegion,
  timeout,
  customProxy,
}: {
  orgId: string
  maxSessions: number
  proxyRegion?: string
  timeout?: number
  customProxy?: { host: string; port: number; username?: string; password?: string }
}): Promise<{
  cloudSessionId: string
  browserUseSessionId: string
  cdpUrl: string
  liveUrl: string | null
  timeoutAt: string
}> {
  const db = getDb()
  const bu = getBrowserUse()

  const cloudSession = await claimCloudSessionSlot({ orgId, maxSessions })
  if (!cloudSession) {
    throw new Response(
      JSON.stringify({ error: 'Cloud session limit reached. Stop an existing session or upgrade your subscription quantity.' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    )
  }

  let vm: BrowserSession
  try {
    vm = await bu.createBrowser({
      proxyCountryCode: proxyRegion ?? null,
      timeout: timeout ?? 60,
      customProxy,
    })
  } catch (cause) {
    await db
      .delete(schema.cloudSession)
      .where(orm.eq(schema.cloudSession.id, cloudSession.id))
      .limit(1)
      .catch(() => {})
    throw new Error('Failed to create cloud browser', { cause })
  }

  if (!vm.cdpUrl) {
    await bu.stopBrowser(vm.id).catch(() => {})
    await db
      .delete(schema.cloudSession)
      .where(orm.eq(schema.cloudSession.id, cloudSession.id))
      .limit(1)
      .catch(() => {})
    throw new Response(
      JSON.stringify({ error: 'Browser Use returned no CDP URL. The VM may have failed to start.' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // Update placeholder with real BU session ID
  const updateResult = await db
    .update(schema.cloudSession)
    .set({ browserUseSessionId: vm.id })
    .where(orm.eq(schema.cloudSession.id, cloudSession.id))
    .limit(1)
    .returning()

  if (!updateResult.length) {
    await bu.stopBrowser(vm.id).catch(() => {})
    throw new Error('Cloud session slot was reclaimed during VM creation')
  }

  return {
    cloudSessionId: cloudSession.id,
    browserUseSessionId: vm.id,
    cdpUrl: vm.cdpUrl,
    liveUrl: vm.liveUrl,
    timeoutAt: vm.timeoutAt,
  }
}
