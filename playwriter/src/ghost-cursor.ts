/**
 * Node-side ghost cursor helpers.
 * Injects the browser bundle into playwriter's isolated world and forwards mouse action events to it.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page, MouseActionEvent } from '@xmorse/playwright-core'
import { evaluateInPlaywriterWorld } from './cdp-session.js'

export interface GhostCursorClientOptions {
  style?: 'minimal' | 'dot' | 'screenstudio'
  color?: string
  size?: number
  zIndex?: number
  easing?: string
  minDurationMs?: number
  maxDurationMs?: number
  speedPxPerMs?: number
}

let ghostCursorCode: string | null = null

function getGhostCursorCode(): string {
  if (ghostCursorCode) {
    return ghostCursorCode
  }

  const currentDir = path.dirname(fileURLToPath(import.meta.url))
  const bundlePath = path.join(currentDir, '..', 'dist', 'ghost-cursor-client.js')
  ghostCursorCode = fs.readFileSync(bundlePath, 'utf-8')
  return ghostCursorCode
}

/**
 * Calls the cursor API in playwriter's isolated world, installing the bundle first when the document is new.
 * The page cannot see the cursor's global or its DOM calls. With `install` false a missing cursor is left alone.
 */
async function callGhostCursor({
  page,
  method,
  payload,
  install = true,
}: {
  page: Page
  method: 'enable' | 'disable' | 'applyMouseAction'
  payload?: GhostCursorClientOptions | MouseActionEvent
  install?: boolean
}): Promise<void> {
  const api = 'globalThis.__playwriterGhostCursor'
  const invoke = `${api}.${method}(${payload === undefined ? '' : JSON.stringify(payload)})`
  const called = await evaluateInPlaywriterWorld<boolean>({ page, expression: `${api} ? (${invoke}, true) : false` })
  if (called || !install) {
    return
  }
  await evaluateInPlaywriterWorld({ page, expression: `${getGhostCursorCode()}\n;${invoke}` })
}

export async function enableGhostCursor(options: {
  page: Page
  cursorOptions?: GhostCursorClientOptions
}): Promise<void> {
  try {
    await callGhostCursor({ page: options.page, method: 'enable', payload: options.cursorOptions })
  } catch {
    // Non-fatal — page may be closed or navigating.
  }
}

export async function disableGhostCursor(options: { page: Page }): Promise<void> {
  try {
    await callGhostCursor({ page: options.page, method: 'disable', install: false })
  } catch {
    // Non-fatal — page may be closed or navigating.
  }
}

export async function applyGhostCursorMouseAction(options: {
  page: Page
  event: MouseActionEvent
}): Promise<void> {
  // Never throw — the cursor is cosmetic and must not break the caller's action.
  try {
    await callGhostCursor({ page: options.page, method: 'applyMouseAction', payload: options.event })
  } catch {
    // Swallow — page may be closed, navigating, or debugger detached.
  }
}
