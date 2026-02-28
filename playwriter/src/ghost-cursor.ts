/**
 * Node-side ghost cursor helpers.
 * Injects the browser bundle and forwards mouse action events to the page overlay.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page, MouseActionEvent } from '@xmorse/playwright-core'

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

interface GhostCursorBrowserApi {
  enable: (options?: GhostCursorClientOptions) => void
  disable: () => void
  applyMouseAction: (event: MouseActionEvent) => void
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

async function ensureGhostCursorInjected(options: { page: Page }): Promise<void> {
  const { page } = options
  const hasGhostCursor = await page.evaluate(() => {
    return Boolean((globalThis as { __playwriterGhostCursor?: unknown }).__playwriterGhostCursor)
  })

  if (hasGhostCursor) {
    return
  }

  const code = getGhostCursorCode()
  await page.evaluate(code)
}

export async function enableGhostCursor(options: {
  page: Page
  cursorOptions?: GhostCursorClientOptions
}): Promise<void> {
  const { page, cursorOptions } = options
  await ensureGhostCursorInjected({ page })

  await page.evaluate(
    ({ optionsFromNode }) => {
      const api = (globalThis as { __playwriterGhostCursor?: GhostCursorBrowserApi }).__playwriterGhostCursor
      api?.enable(optionsFromNode)
    },
    { optionsFromNode: cursorOptions },
  )
}

export async function disableGhostCursor(options: { page: Page }): Promise<void> {
  const { page } = options
  await page.evaluate(() => {
    const api = (globalThis as { __playwriterGhostCursor?: GhostCursorBrowserApi }).__playwriterGhostCursor
    api?.disable()
  })
}

export async function applyGhostCursorMouseAction(options: {
  page: Page
  event: MouseActionEvent
}): Promise<void> {
  const { page, event } = options

  const applied = await page.evaluate(
    ({ serializedEvent }) => {
      const api = (globalThis as { __playwriterGhostCursor?: GhostCursorBrowserApi }).__playwriterGhostCursor
      if (!api) {
        return false
      }

      api.applyMouseAction(serializedEvent)
      return true
    },
    { serializedEvent: event },
  )

  if (applied) {
    return
  }

  await ensureGhostCursorInjected({ page })
  await page.evaluate(
    ({ serializedEvent }) => {
      const api = (globalThis as { __playwriterGhostCursor?: GhostCursorBrowserApi }).__playwriterGhostCursor
      api?.applyMouseAction(serializedEvent)
    },
    { serializedEvent: event },
  )
}
