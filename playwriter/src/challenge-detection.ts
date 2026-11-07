/**
 * Bot challenge and block page detection, ported from anomalyco/browse
 * (cli/src/execute/challenge-detection.ts and code-runner.ts detectChallenge).
 *
 * After an execute call navigates a page, the executor reads a few signals from it and classifies it:
 *
 * - `non-interactive`: an interstitial the browser clears by itself (Cloudflare "Just a moment...", Akamai and
 *   AWS WAF silent checks, DataDome device check). The executor waits for it, within the execute timeout.
 * - `interactive`: a challenge only a person should answer (Turnstile, reCAPTCHA or hCaptcha walls, PerimeterX
 *   "Press & Hold", DataDome or AWS WAF captcha). The agent must not touch it and should ask the user.
 * - `block`: the site refused the visit (Cloudflare "Sorry, you have been blocked", Akamai or Imperva "Access
 *   Denied"). Retrying makes it worse for the user's IP.
 *
 * Signals are vendor markers (challenge iframes and scripts, element ids) and title or text phrases. Generic
 * phrases only count on short pages, so an article that mentions "verify you are human" is not a challenge.
 * Detection is conservative: a miss costs an agent turn, a false positive costs a wait or a needless stop.
 */

import { setTimeout as delay } from 'node:timers/promises'
import type { Page } from '@xmorse/playwright-core'

export type ChallengeVendor =
  | 'cloudflare'
  | 'akamai'
  | 'datadome'
  | 'perimeterx'
  | 'imperva'
  | 'aws-waf'
  | 'recaptcha'
  | 'hcaptcha'
  | 'generic'

export type ChallengeKind = 'non-interactive' | 'interactive' | 'block'

export type ChallengeDetection = {
  vendor: ChallengeVendor
  kind: ChallengeKind
  /** The marker that matched, for logs and the agent ("title: Just a moment...", "iframe challenges.cloudflare.com"). */
  signal: string
}

/** What the probe reads from the page. Every field is bounded by the probe. */
export type ChallengeProbe = {
  url: string
  title: string
  /** document.body.innerText, first 3000 characters. */
  text: string
  /** Full innerText length, to tell short interstitials from long pages. */
  textLength: number
  /** Frame URLs from Playwright's page.frames(). */
  frameUrls: string[]
  /** Script src values, first 50. */
  scriptSrcs: string[]
  /** Which of `probeSelectors` matched an element. */
  selectors: string[]
  /** Which matched selectors have a non-zero size. */
  visibleSelectors: string[]
}

/** Element markers the probe checks. Keep in sync with `classifyChallenge`. */
export const probeSelectors = [
  // Cloudflare
  '#challenge-form',
  '#challenge-running',
  '#challenge-stage',
  '#cf-challenge-running',
  '.cf-turnstile',
  '#cf-error-details',
  // Akamai Bot Manager
  '#sec-if-cpt-container',
  '#sec-cpt-if',
  '#sec-text-if',
  // DataDome
  '#ddv1-captcha-container',
  // PerimeterX / HUMAN
  '#px-captcha',
  '#px-captcha-wrapper',
  "[id^='px-captcha']",
  // Imperva / Incapsula
  "#main-iframe[src*='_Incapsula_Resource']",
  // AWS WAF
  '#captcha-container awswaf-captcha',
  'awswaf-captcha',
  '#challenge-container',
  // reCAPTCHA / hCaptcha
  '.g-recaptcha',
  "iframe[src*='/recaptcha/'][title*='challenge']",
  '.h-captcha',
]

/** Runs in the page via page.evaluate, so it must be self-contained. Read-only: it never changes the DOM. */
export const probePageScript = (selectors: string[]) => {
  const body = document.body
  const text = body ? body.innerText ?? '' : ''
  const matched: string[] = []
  const visible: string[] = []
  for (const selector of selectors) {
    let element: { getBoundingClientRect(): { width: number; height: number } } | null = null
    try {
      element = document.querySelector(selector)
    } catch {
      element = null
    }
    if (!element) continue
    matched.push(selector)
    const rect = element.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) visible.push(selector)
  }
  return {
    title: document.title.slice(0, 300),
    text: text.slice(0, 3000),
    textLength: text.length,
    scriptSrcs: Array.from(document.scripts as ArrayLike<{ src: string }>, (script) => script.src)
      .filter(Boolean)
      .slice(0, 50),
    selectors: matched,
    visibleSelectors: visible,
  }
}

const SHORT_PAGE_CHARS = 1_500

const shortPage = (probe: ChallengeProbe): boolean => probe.textLength < SHORT_PAGE_CHARS

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function hasFrame(probe: ChallengeProbe, pattern: RegExp): string | undefined {
  return probe.frameUrls.find((url) => pattern.test(url))
}

function hasScript(probe: ChallengeProbe, pattern: RegExp): string | undefined {
  return probe.scriptSrcs.find((src) => pattern.test(src))
}

const has = (probe: ChallengeProbe, selector: string): boolean => probe.selectors.includes(selector)
const visible = (probe: ChallengeProbe, selector: string): boolean => probe.visibleSelectors.includes(selector)

/** Classify a probed page, or undefined when it does not look like a challenge or block page. */
export function classifyChallenge(probe: ChallengeProbe): ChallengeDetection | undefined {
  const title = probe.title.trim().toLowerCase()
  const text = probe.text.toLowerCase()
  const host = hostOf(probe.url)
  const signal = (value: string) => value.slice(0, 160)

  // Cloudflare
  if (/sorry, you have been blocked/.test(text) && (has(probe, '#cf-error-details') || /cloudflare/.test(text))) {
    return { vendor: 'cloudflare', kind: 'block', signal: 'text: Sorry, you have been blocked' }
  }
  const cloudflareInterstitial =
    /^just a moment\b|^attention required! \| cloudflare|^checking your browser|^un instant|^einen moment/.test(title) ||
    has(probe, '#challenge-form') ||
    has(probe, '#challenge-running') ||
    has(probe, '#cf-challenge-running') ||
    has(probe, '#challenge-stage')
  const turnstileFrame = hasFrame(probe, /^https:\/\/challenges\.cloudflare\.com\/.*(turnstile|challenge-platform)/)
  if (cloudflareInterstitial || (turnstileFrame && shortPage(probe))) {
    // The managed challenge shows Turnstile's checkbox only when it wants a click; until then it clears itself.
    const widget =
      visible(probe, '.cf-turnstile') || /verify you are human by completing|click to verify|confirm you are human/.test(text)
    return {
      vendor: 'cloudflare',
      kind: widget ? 'interactive' : 'non-interactive',
      signal: cloudflareInterstitial ? signal(`title: ${probe.title.trim()}`) : signal(`iframe ${turnstileFrame}`),
    }
  }

  // PerimeterX / HUMAN
  if (
    has(probe, '#px-captcha') ||
    has(probe, '#px-captcha-wrapper') ||
    has(probe, "[id^='px-captcha']") ||
    /press (?:&|and) hold/.test(text)
  ) {
    return {
      vendor: 'perimeterx',
      kind: 'interactive',
      signal: has(probe, '#px-captcha') ? 'element #px-captcha' : 'text: Press & Hold',
    }
  }

  // DataDome
  const dataDomeFrame = hasFrame(probe, /captcha-delivery\.com/)
  if (dataDomeFrame || has(probe, '#ddv1-captcha-container')) {
    const interstitial = dataDomeFrame !== undefined && /\/interstitial\//.test(dataDomeFrame)
    return {
      vendor: 'datadome',
      kind: interstitial ? 'non-interactive' : 'interactive',
      signal: signal(dataDomeFrame ? `iframe ${dataDomeFrame}` : 'element #ddv1-captcha-container'),
    }
  }

  // Akamai Bot Manager
  if (has(probe, '#sec-if-cpt-container') || has(probe, '#sec-cpt-if') || has(probe, '#sec-text-if')) {
    const interactive = visible(probe, '#sec-cpt-if') && /verify|press|slide|captcha/.test(text)
    return {
      vendor: 'akamai',
      kind: interactive ? 'interactive' : 'non-interactive',
      signal: 'element #sec-if-cpt-container',
    }
  }
  if (title === 'access denied' && /you don't have permission to access/.test(text) && /reference #?\d/.test(text)) {
    return { vendor: 'akamai', kind: 'block', signal: 'title: Access Denied (Akamai reference)' }
  }

  // Imperva / Incapsula
  const incapsula = hasFrame(probe, /_Incapsula_Resource/) ?? hasScript(probe, /_Incapsula_Resource/)
  if (incapsula || has(probe, "#main-iframe[src*='_Incapsula_Resource']")) {
    const captcha =
      /captcha|verify you are human|i am human/.test(text) || hasFrame(probe, /hcaptcha|recaptcha/) !== undefined
    if (/request unsuccessful|incapsula incident id/.test(text) && !captcha) {
      return { vendor: 'imperva', kind: 'block', signal: 'text: Request unsuccessful (Incapsula)' }
    }
    return {
      vendor: 'imperva',
      kind: captcha ? 'interactive' : 'non-interactive',
      signal: signal(`resource ${incapsula ?? '_Incapsula_Resource'}`),
    }
  }
  if (/incapsula incident id/.test(text) && shortPage(probe)) {
    return { vendor: 'imperva', kind: 'block', signal: 'text: Incapsula incident ID' }
  }

  // AWS WAF
  const awsCaptcha = has(probe, 'awswaf-captcha') || has(probe, '#captcha-container awswaf-captcha')
  const awsScript = hasScript(probe, /\.awswaf\.com\//)
  if (awsCaptcha) {
    return { vendor: 'aws-waf', kind: 'interactive', signal: 'element awswaf-captcha' }
  }
  if (awsScript && shortPage(probe) && (has(probe, '#challenge-container') || probe.textLength < 300)) {
    return { vendor: 'aws-waf', kind: 'non-interactive', signal: signal(`script ${awsScript}`) }
  }

  // Captcha walls: a short page that is mostly a reCAPTCHA or hCaptcha widget.
  if (shortPage(probe)) {
    const recaptcha = hasFrame(
      probe,
      /^https:\/\/www\.(?:google|recaptcha)\.(?:com|net)\/recaptcha\/(?:api2|enterprise)\/anchor/,
    )
    const hcaptcha = hasFrame(probe, /^https:\/\/(?:newassets\.|assets\.)?hcaptcha\.com\/captcha\//)
    const wallText =
      /verify you are (?:a )?human|are you a robot|not a robot|unusual traffic|security check|complete the captcha|captcha/.test(
        text,
      ) || /captcha|security check|verify/.test(title)
    if (hcaptcha && wallText) {
      return { vendor: 'hcaptcha', kind: 'interactive', signal: signal(`iframe ${hcaptcha}`) }
    }
    if (recaptcha && wallText) {
      return { vendor: 'recaptcha', kind: 'interactive', signal: signal(`iframe ${recaptcha}`) }
    }
    // Google's own "unusual traffic" interstitial.
    if (/^www\.google\./.test(host) && /\/sorry\//.test(probe.url)) {
      return { vendor: 'recaptcha', kind: 'interactive', signal: 'url: google.com/sorry' }
    }
  }

  // Generic block and verification pages, short pages only.
  if (shortPage(probe)) {
    if (
      /^(?:access denied|403 forbidden|forbidden|blocked|request blocked|you have been blocked)$/.test(title) ||
      /^(?:access to this page has been denied|access denied)\b/.test(text.trim())
    ) {
      return {
        vendor: 'generic',
        kind: 'block',
        signal: signal(`title: ${probe.title.trim() || text.trim().slice(0, 60)}`),
      }
    }
    const haystack = `${title}\n${text}`
    if (
      /verify (?:that )?you are (?:a )?human|confirm you are (?:a )?human|are you a robot\?|pardon our interruption|please verify you are a human|bot (?:check|detection)/.test(
        haystack,
      )
    ) {
      const phrase =
        /verify[^.\n]*human|confirm[^.\n]*human|are you a robot|pardon our interruption|bot (?:check|detection)/.exec(
          haystack,
        )?.[0] ?? 'verification'
      return { vendor: 'generic', kind: 'interactive', signal: signal(`text: ${phrase}`) }
    }
  }
  return undefined
}

export type ChallengeOutcome = ChallengeDetection & {
  /** cleared: the interstitial went away while the executor waited; blocked: it is still there. */
  status: 'cleared' | 'blocked'
  url: string
  waitedMs: number
}

export const PROBE_TIMEOUT_MS = 2_000
const POLL_MS = 1_000
/** Upper bound for waiting on a non-interactive check, like browse. The execute timeout can cut it shorter. */
export const MAX_CHALLENGE_WAIT_MS = 15_000

/** Reads the page, bounded by `deadline` (a page with an open dialog or a busy main thread never answers). */
async function probePage({
  page,
  deadline,
  signal,
}: {
  page: Page
  deadline: number
  signal?: AbortSignal
}): Promise<ChallengeProbe | undefined> {
  const budget = Math.min(PROBE_TIMEOUT_MS, deadline - Date.now())
  if (budget <= 0 || signal?.aborted) throw new Error('No time left for the challenge probe')
  if (page.isClosed()) return undefined
  if (!/^https?:/i.test(page.url())) return undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const stopped = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Error('Challenge probe stopped'))
    timer = setTimeout(onAbort, budget)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
  const probed = await Promise.race([page.evaluate(probePageScript, probeSelectors), stopped]).finally(() => {
    clearTimeout(timer)
    if (onAbort) signal?.removeEventListener('abort', onAbort)
  })
  return {
    ...probed,
    url: page.url(),
    frameUrls: page
      .frames()
      .map((frame) => frame.url())
      .slice(0, 50),
  }
}

/**
 * Classify the page and wait out a non-interactive check until `deadline` (epoch ms). Every probe ends by the
 * deadline too. Undefined when there is no challenge or no time to look.
 */
export async function detectChallenge({
  page,
  deadline,
  signal,
}: {
  page: Page
  deadline: number
  signal?: AbortSignal
}): Promise<ChallengeOutcome | undefined> {
  const first = await probePage({ page, deadline, signal }).catch(() => undefined)
  const detected = first && classifyChallenge(first)
  if (!first || !detected) return undefined
  const started = Date.now()
  let current = detected
  let url = first.url
  while (current.kind === 'non-interactive' && Date.now() < deadline && !signal?.aborted) {
    const aborted = await delay(Math.min(POLL_MS, Math.max(0, deadline - Date.now())), undefined, { signal }).then(
      () => false,
      () => true,
    )
    if (aborted || page.isClosed() || Date.now() >= deadline) break
    // A probe that fails or times out mid-navigation (the check often clears by navigating) counts as still waiting.
    const probe = await probePage({ page, deadline, signal }).catch(() => null)
    if (probe === null) continue
    const next = probe && classifyChallenge(probe)
    if (!next) {
      return { ...current, status: 'cleared', url: probe?.url ?? url, waitedMs: Date.now() - started }
    }
    url = probe.url
    current = next
  }
  return { ...current, status: 'blocked', url, waitedMs: current.kind === 'non-interactive' ? Date.now() - started : 0 }
}

/** Warning for the agent, or undefined when the check cleared. Playwriter drives the user's own Chrome, so
 * interactive challenges go to the user, who can solve them in the tab. */
export function challengeWarning(outcome: ChallengeOutcome): string | undefined {
  if (outcome.status === 'cleared') return undefined
  const where = (() => {
    try {
      return new URL(outcome.url).origin
    } catch {
      return outcome.url
    }
  })()
  if (outcome.kind === 'block') {
    return (
      `Blocked: ${where} refused the visit (${outcome.vendor}, ${outcome.signal}). ` +
      `Do not retry or reload in a loop, which makes the block worse for the user's IP and account. Stop and tell the user.`
    )
  }
  if (outcome.kind === 'non-interactive') {
    return (
      `Bot check on ${where}: ${outcome.vendor} is still checking the browser after ${Math.round(outcome.waitedMs / 1000)} s (${outcome.signal}). ` +
      `Do not reload. Wait for it in the next execute (e.g. await page.waitForTimeout(5000)); if it stays, ask the user to solve it in the tab.`
    )
  }
  return (
    `Bot challenge on ${where}: ${outcome.vendor} captcha or verification (${outcome.signal}). ` +
    `Do not reload, retry or try to solve it yourself. Ask the user to solve it in the browser tab, then continue.`
  )
}
