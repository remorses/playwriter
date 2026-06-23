// Cloud browser API routes mounted at /api/cloud/*.
// Proxies Browser Use API v3 — the bu_ API key never reaches the client.
// VM status is queried from Browser Use on demand (source of truth),
// our D1 only stores the org → BU session ID mapping for multi-tenancy.

import { Spiceflow, json } from 'spiceflow'
import { z } from 'zod'
import { getDb, requireOrgSession } from './db.ts'
import type { BrowserSession } from './lib/browser-use.ts'
import {
  getBrowserUse,
  isPendingRow,
  resolveActiveSession,
  cleanupDeadSessions,
  recordFinalCostAndDelete,
  validateCloudAccess,
  createCloudBrowserVM,
} from './cloud-helpers.ts'

// ── Types ───────────────────────────────────────────────────────────

interface CloudSessionStatus {
  cloudSessionId: string
  browserUseSessionId: string
  /** Display index derived from creation order (1-based) */
  index: number
  createdAt: number
  status: 'active' | 'stopped'
  cdpUrl: string | null
  liveUrl: string | null
  timeoutAt: string
}

// ── Sub-app ─────────────────────────────────────────────────────────

export const cloudApp = new Spiceflow({ basePath: '/api/cloud' })

  // ── GET /api/cloud/status ───────────────────────────────────────
  // Returns org's active cloud sessions with their VM status.
  .get('/status', async ({ request }) => {
    const { org } = await requireOrgSession(request)
    const db = getDb()
    const bu = getBrowserUse()

    const sessions = await db.query.cloudSession.findMany({
      where: { orgId: org.id },
      orderBy: { createdAt: 'asc' },
    })

    // Check each session against BU API in parallel, collecting dead IDs
    // for a single batch-delete at the end instead of N individual deletes.
    const deadIds: string[] = []
    const nonPending = sessions.filter((row) => {
      return !isPendingRow(row)
    })
    const vmResults = await Promise.all(
      nonPending.map((row) => {
        return resolveActiveSession(row, bu, deadIds)
      }),
    )

    const result: CloudSessionStatus[] = []
    for (let i = 0; i < nonPending.length; i++) {
      const row = nonPending[i]!
      const vm = vmResults[i]
      if (vm) {
        result.push({
          cloudSessionId: row.id,
          browserUseSessionId: row.browserUseSessionId,
          index: result.length + 1,
          createdAt: row.createdAt,
          status: vm.status,
          cdpUrl: vm.cdpUrl,
          liveUrl: vm.liveUrl,
          timeoutAt: vm.timeoutAt,
        })
      }
    }

    // Batch-delete all dead/stale sessions in one D1 call
    await cleanupDeadSessions(deadIds)

    return { sessions: result }
  })

  // ── POST /api/cloud/connect ─────────────────────────────────────
  // Create a new Browser Use VM for the org.
  // Returns the cdpUrl for direct CDP connection.
  .route({
    method: 'POST',
    path: '/connect',
    request: z.object({
      proxyRegion: z.string().optional(),
      /** Cloud browser timeout in minutes (1-240, default 60) */
      timeout: z.number().min(1).max(240).optional(),
      customProxy: z
        .object({
          host: z.string(),
          port: z.number(),
          username: z.string().optional(),
          password: z.string().optional(),
        })
        .optional(),
    }),
    async handler({ request }) {
      const { org } = await requireOrgSession(request)
      const body = await request.json()

      const { maxSessions } = await validateCloudAccess({ orgId: org.id })
      const vm = await createCloudBrowserVM({
        orgId: org.id,
        maxSessions,
        proxyRegion: body.proxyRegion,
        timeout: body.timeout,
        customProxy: body.customProxy,
      })

      return {
        cloudSessionId: vm.cloudSessionId,
        cdpUrl: vm.cdpUrl,
        liveUrl: vm.liveUrl,
        timeoutAt: vm.timeoutAt,
      }
    },
  })

  // ── POST /api/cloud/disconnect ──────────────────────────────────
  // Stop a cloud browser VM.
  .route({
    method: 'POST',
    path: '/disconnect',
    request: z.object({
      cloudSessionId: z.string(),
    }),
    async handler({ request }) {
      const { org } = await requireOrgSession(request)
      const body = await request.json()
      const db = getDb()
      const bu = getBrowserUse()

      // Find the session and verify org ownership directly
      const cloudSession = await db.query.cloudSession.findFirst({
        where: { id: body.cloudSessionId, orgId: org.id },
      })
      if (!cloudSession) {
        throw json({ error: 'cloud session not found' }, { status: 404 })
      }

      // Stop the BU VM and capture final cost before deleting the row.
      // stopBrowser returns the final session state including proxyCost.
      let buSession: BrowserSession | null = null
      try {
        buSession = await bu.stopBrowser(cloudSession.browserUseSessionId)
      } catch {
        // VM might already be stopped; try to get final state
        try {
          buSession = await bu.getBrowser(cloudSession.browserUseSessionId)
        } catch {
          // VM is gone, no cost data available
        }
      }

      // Record final proxy cost delta and delete the session row
      await recordFinalCostAndDelete({ cloudSession, buSession, orgId: org.id })

      return { ok: true }
    },
  })
