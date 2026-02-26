/**
 * Encapsulates ghost cursor lifecycle for recording sessions.
 * Keeps onMouseAction chaining/restoration isolated from executor logic.
 */

import type { BrowserContext, Page } from '@xmorse/playwright-core'
import { applyGhostCursorMouseAction, disableGhostCursor, enableGhostCursor, type GhostCursorClientOptions } from './ghost-cursor.js'

interface RecordingGhostCursorLogger {
  error: (...args: unknown[]) => void
}

interface RecordingTargetOptions {
  page?: Page
  sessionId?: string
}

export class RecordingGhostCursorController {
  private readonly previousMouseActionByPage = new WeakMap<Page, Page['onMouseAction']>()
  private readonly cursorApplyQueueByPage = new WeakMap<Page, Promise<void>>()
  private readonly logger: RecordingGhostCursorLogger

  constructor(options: { logger: RecordingGhostCursorLogger }) {
    this.logger = options.logger
  }

  resolveRecordingTargetPage(options: {
    context: BrowserContext
    defaultPage: Page
    target?: RecordingTargetOptions
  }): Page {
    const { context, defaultPage, target } = options

    if (target?.page) {
      return target.page
    }

    if (target?.sessionId) {
      const pageForSession = context.pages().find((candidatePage) => {
        return candidatePage.sessionId() === target.sessionId
      })

      if (pageForSession) {
        return pageForSession
      }
    }

    return defaultPage
  }

  async enableForRecording(options: { page: Page }): Promise<void> {
    const { page } = options

    try {
      await enableGhostCursor({ page })
      if (!this.previousMouseActionByPage.has(page)) {
        this.previousMouseActionByPage.set(page, page.onMouseAction)
      }

      const previousMouseAction = this.previousMouseActionByPage.get(page)
      page.onMouseAction = async (event) => {
        const pendingCursorApply = this.cursorApplyQueueByPage.get(page) || Promise.resolve()
        const nextCursorApply = pendingCursorApply
          .then(async () => {
            await applyGhostCursorMouseAction({ page, event })
          })
          .catch((error) => {
            this.logger.error('[playwriter] Failed to apply ghost cursor action', error)
          })
        this.cursorApplyQueueByPage.set(page, nextCursorApply)

        if (!previousMouseAction) {
          return
        }

        await previousMouseAction(event)
      }
    } catch (error) {
      page.onMouseAction = this.previousMouseActionByPage.get(page) ?? null
      this.previousMouseActionByPage.delete(page)
      this.logger.error('[playwriter] Failed to enable ghost cursor', error)
    }
  }

  async disableForRecording(options: { page: Page }): Promise<void> {
    const { page } = options
    page.onMouseAction = this.previousMouseActionByPage.get(page) ?? null
    this.previousMouseActionByPage.delete(page)
    this.cursorApplyQueueByPage.delete(page)

    try {
      await disableGhostCursor({ page })
    } catch (error) {
      this.logger.error('[playwriter] Failed to disable ghost cursor', error)
    }
  }

  async show(options: { page: Page; cursorOptions?: GhostCursorClientOptions }): Promise<void> {
    const { page, cursorOptions } = options
    await enableGhostCursor({ page, cursorOptions })
  }

  async hide(options: { page: Page }): Promise<void> {
    const { page } = options
    await disableGhostCursor({ page })
  }
}
