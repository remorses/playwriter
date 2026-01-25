import type { Page } from 'playwright-core'
import { sleep } from './utils.js'

const FILTERED_DOMAINS = [
  'doubleclick',
  'googlesyndication',
  'googleadservices',
  'google-analytics',
  'googletagmanager',
  'facebook.net',
  'fbcdn.net',
  'twitter.com',
  'linkedin.com',
  'hotjar',
  'mixpanel',
  'segment.io',
  'segment.com',
  'newrelic',
  'datadoghq',
  'sentry.io',
  'fullstory',
  'amplitude',
  'intercom',
  'crisp.chat',
  'zdassets.com',
  'zendesk',
  'tawk.to',
  'hubspot',
  'marketo',
  'pardot',
  'optimizely',
  'crazyegg',
  'mouseflow',
  'clarity.ms',
  'bing.com/bat',
  'ads.',
  'analytics.',
  'tracking.',
  'pixel.',
]

const FILTERED_EXTENSIONS = ['.gif', '.ico', '.cur', '.woff', '.woff2', '.ttf', '.otf', '.eot']

export interface WaitForPageLoadOptions {
  page: Page
  timeout?: number
  pollInterval?: number
  minWait?: number
}

export interface WaitForPageLoadResult {
  success: boolean
  readyState: string
  pendingRequests: string[]
  waitTimeMs: number
  timedOut: boolean
}

export async function waitForPageLoad(options: WaitForPageLoadOptions): Promise<WaitForPageLoadResult> {
  const { page, timeout = 30000, pollInterval = 100, minWait = 500 } = options

  const startTime = Date.now()
  let timedOut = false
  let lastReadyState = ''
  let lastPendingRequests: string[] = []

  const checkPageReady = async (): Promise<{ ready: boolean; readyState: string; pendingRequests: string[] }> => {
    const result = await page.evaluate(
      ({ filteredDomains, filteredExtensions, stuckThreshold, slowResourceThreshold }): {
        ready: boolean
        readyState: string
        pendingRequests: string[]
      } => {
        const doc = globalThis.document as { readyState: string }
        const readyState = doc.readyState

        if (readyState !== 'complete') {
          return { ready: false, readyState, pendingRequests: [`document.readyState: ${readyState}`] }
        }

        const resources = (performance as any).getEntriesByType('resource') as Array<{
          name: string
          startTime: number
          responseEnd: number
        }>
        const now = (performance as any).now() as number

        const pendingRequests = resources
          .filter((r) => {
            if (r.responseEnd > 0) {
              return false
            }

            const elapsed = now - r.startTime
            const url = r.name.toLowerCase()

            if (url.startsWith('data:')) {
              return false
            }

            if (filteredDomains.some((domain: string) => url.includes(domain))) {
              return false
            }

            if (elapsed > stuckThreshold) {
              return false
            }

            if (elapsed > slowResourceThreshold && filteredExtensions.some((ext: string) => url.includes(ext))) {
              return false
            }

            return true
          })
          .map((r) => r.name)

        return {
          ready: pendingRequests.length === 0,
          readyState,
          pendingRequests,
        }
      },
      {
        filteredDomains: FILTERED_DOMAINS,
        filteredExtensions: FILTERED_EXTENSIONS,
        stuckThreshold: 10000,
        slowResourceThreshold: 3000,
      },
    )

    return result
  }

  // Fast path: check immediately first. If already ready, return without waiting.
  try {
    const firstCheck = await checkPageReady()
    if (firstCheck.ready) {
      return {
        success: true,
        readyState: firstCheck.readyState,
        pendingRequests: [],
        waitTimeMs: Date.now() - startTime,
        timedOut: false,
      }
    }
    lastReadyState = firstCheck.readyState
    lastPendingRequests = firstCheck.pendingRequests
  } catch (e) {
    // First check failed, continue with polling
  }

  // Not ready yet - wait minWait to let JS settle and catch late-starting requests
  await sleep(minWait)

  while (Date.now() - startTime < timeout) {
    try {
      const { ready, readyState, pendingRequests } = await checkPageReady()
      lastReadyState = readyState
      lastPendingRequests = pendingRequests

      if (ready) {
        return {
          success: true,
          readyState,
          pendingRequests: [],
          waitTimeMs: Date.now() - startTime,
          timedOut: false,
        }
      }
    } catch (e) {
      console.error('[waitForPageLoad] page.evaluate failed:', e)
      return {
        success: false,
        readyState: 'error',
        pendingRequests: ['page.evaluate failed - page may have closed or navigated'],
        waitTimeMs: Date.now() - startTime,
        timedOut: false,
      }
    }

    await sleep(pollInterval)
  }

  timedOut = true

  return {
    success: false,
    readyState: lastReadyState,
    pendingRequests: lastPendingRequests.slice(0, 10),
    waitTimeMs: Date.now() - startTime,
    timedOut,
  }
}
