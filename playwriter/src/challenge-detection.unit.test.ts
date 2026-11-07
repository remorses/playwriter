import { describe, expect, test } from 'vitest'
import { challengeWarning, classifyChallenge, type ChallengeProbe } from './challenge-detection.js'

function probe(overrides: Partial<ChallengeProbe>): ChallengeProbe {
  const text = overrides.text ?? ''
  return {
    url: 'https://shop.example/',
    title: '',
    text,
    textLength: overrides.textLength ?? text.length,
    frameUrls: [],
    scriptSrcs: [],
    selectors: [],
    visibleSelectors: [],
    ...overrides,
  }
}

const article = `How bot detection works: sites ask you to verify you are human. ${'Long article text. '.repeat(200)}`

const fixtures: Record<string, ChallengeProbe> = {
  'cloudflare waiting': probe({
    title: 'Just a moment...',
    text: 'Checking if the site connection is secure',
    selectors: ['#challenge-running'],
  }),
  'cloudflare turnstile checkbox': probe({
    title: 'Just a moment...',
    text: 'Verify you are human by completing the action below.',
    frameUrls: ['https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/if/ov2/av0/rcv/abc'],
    selectors: ['.cf-turnstile'],
    visibleSelectors: ['.cf-turnstile'],
  }),
  'cloudflare block': probe({
    title: 'Attention Required! | Cloudflare',
    text: 'Sorry, you have been blocked. Cloudflare Ray ID: 1',
    selectors: ['#cf-error-details'],
  }),
  'akamai block': probe({
    title: 'Access Denied',
    text: 'Access Denied\nYou don\'t have permission to access "http://shop.example/" on this server.\nReference #18.abc.1700000000.1',
  }),
  'akamai interstitial': probe({ selectors: ['#sec-if-cpt-container'], text: 'Please wait while we verify' }),
  perimeterx: probe({
    selectors: ['#px-captcha'],
    text: 'Press & Hold to confirm you are a human (and not a bot).',
  }),
  'datadome captcha': probe({ frameUrls: ['https://geo.captcha-delivery.com/captcha/?initialCid=x'] }),
  'datadome interstitial': probe({ frameUrls: ['https://geo.captcha-delivery.com/interstitial/?initialCid=x'] }),
  'imperva interstitial': probe({ frameUrls: ['https://shop.example/_Incapsula_Resource?SWUDNSAI=1'] }),
  'imperva block': probe({
    scriptSrcs: ['https://shop.example/_Incapsula_Resource?x'],
    text: 'Request unsuccessful. Incapsula incident ID: 1-2',
  }),
  'aws waf captcha': probe({ selectors: ['awswaf-captcha'] }),
  'hcaptcha wall': probe({
    text: 'Please verify you are a human',
    frameUrls: ['https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html#frame=checkbox'],
  }),
  'recaptcha wall': probe({
    text: 'Our systems have detected unusual traffic',
    frameUrls: ['https://www.google.com/recaptcha/api2/anchor?k=x'],
  }),
  'google sorry': probe({ url: 'https://www.google.com/sorry/index?continue=x', text: 'unusual traffic' }),
  'generic block': probe({ title: 'Access Denied', text: 'Access denied' }),
  'generic verification': probe({ title: 'Security', text: 'Please verify you are a human to continue.' }),
  'article mentioning bots': probe({
    title: 'Bot detection explained',
    text: article.slice(0, 3000),
    textLength: article.length,
  }),
  'login form with embedded recaptcha': probe({
    title: 'Sign in',
    text: 'Email\nPassword\nSign in',
    frameUrls: ['https://www.google.com/recaptcha/api2/anchor?k=x'],
  }),
  'normal page': probe({ title: 'Example Domain', text: 'This domain is for use in documentation examples.' }),
}

describe('classifyChallenge', () => {
  test('classifies vendor pages and ignores normal ones', () => {
    const results = Object.entries(fixtures).map(([name, fixture]) => {
      const detection = classifyChallenge(fixture)
      return `${name}: ${detection ? `${detection.vendor} ${detection.kind} (${detection.signal})` : 'none'}`
    })
    expect('\n' + results.join('\n')).toMatchInlineSnapshot(`
      "
      cloudflare waiting: cloudflare non-interactive (title: Just a moment...)
      cloudflare turnstile checkbox: cloudflare interactive (title: Just a moment...)
      cloudflare block: cloudflare block (text: Sorry, you have been blocked)
      akamai block: akamai block (title: Access Denied (Akamai reference))
      akamai interstitial: akamai non-interactive (element #sec-if-cpt-container)
      perimeterx: perimeterx interactive (element #px-captcha)
      datadome captcha: datadome interactive (iframe https://geo.captcha-delivery.com/captcha/?initialCid=x)
      datadome interstitial: datadome non-interactive (iframe https://geo.captcha-delivery.com/interstitial/?initialCid=x)
      imperva interstitial: imperva non-interactive (resource https://shop.example/_Incapsula_Resource?SWUDNSAI=1)
      imperva block: imperva block (text: Request unsuccessful (Incapsula))
      aws waf captcha: aws-waf interactive (element awswaf-captcha)
      hcaptcha wall: hcaptcha interactive (iframe https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html#frame=checkbox)
      recaptcha wall: recaptcha interactive (iframe https://www.google.com/recaptcha/api2/anchor?k=x)
      google sorry: recaptcha interactive (url: google.com/sorry)
      generic block: generic block (title: Access Denied)
      generic verification: generic interactive (text: verify you are a human)
      article mentioning bots: none
      login form with embedded recaptcha: none
      normal page: none"
    `)
  })
})

describe('challengeWarning', () => {
  test('tells the agent to ask the user, wait, or stop', () => {
    const base = { vendor: 'cloudflare' as const, signal: 'title: Just a moment...', url: 'https://shop.example/a?b' }
    const warnings = [
      challengeWarning({ ...base, kind: 'interactive', status: 'blocked', waitedMs: 0 }),
      challengeWarning({ ...base, kind: 'non-interactive', status: 'blocked', waitedMs: 8_200 }),
      challengeWarning({ ...base, kind: 'block', status: 'blocked', waitedMs: 0 }),
      challengeWarning({ ...base, kind: 'non-interactive', status: 'cleared', waitedMs: 3_000 }),
    ]
    expect('\n' + warnings.join('\n')).toMatchInlineSnapshot(`
      "
      Bot challenge on https://shop.example: cloudflare captcha or verification (title: Just a moment...). Do not reload, retry or try to solve it yourself. Ask the user to solve it in the browser tab, then continue.
      Bot check on https://shop.example: cloudflare is still checking the browser after 8 s (title: Just a moment...). Do not reload. Wait for it in the next execute (e.g. await page.waitForTimeout(5000)); if it stays, ask the user to solve it in the tab.
      Blocked: https://shop.example refused the visit (cloudflare, title: Just a moment...). Do not retry or reload in a loop, which makes the block worse for the user's IP and account. Stop and tell the user.
      "
    `)
  })
})
