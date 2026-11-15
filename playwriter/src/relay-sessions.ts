/**
 * Relay session API shared by the CLI and the MCP: browser discovery, session
 * create/list/update/delete/reset and execute over the relay /cli/* endpoints.
 * Nothing here prints. Callers format results and warnings for their own output.
 */

import pc from 'picocolors'
import { Agent, fetch as undiciFetch } from 'undici'
import dedent from 'string-dedent'
import { parseRelayHost } from './utils.js'
import type { TabGroupColor } from './protocol.js'
import {
  ensureRelayServer,
  waitForConnectedExtensions,
  getLocalExtensionStatuses,
  getExtensionOutdatedWarning,
  RELAY_PORT,
  EXTENSION_NOT_CONNECTED_ERROR,
  type ExtensionStatus,
} from './relay-client.js'
import { discoverChromeInstances, resolveDirectInput, type DiscoveredInstance } from './chrome-discovery.js'
import { getCloudClient, loadCloudAuth, buildLiveUrl } from './cloud-client.js'

const STATUS_TIMEOUT_MS = 2000
const SESSION_EXTENSION_WAIT_MS = 20_000
const EXTENSION_POLL_MS = 250
const EXECUTE_RESPONSE_GRACE_MS = 30_000
const MAX_CLOUD_TIMEOUT_MINUTES = 240

// Executes can run for minutes; undici's default headers timeout would cut them off.
const executeDispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0 })

const NO_CHROME_ERROR = dedent`
  No Chrome browser found. Install one first:

    playwriter browser install

  This downloads Chrome for Testing from Google.
`

/** Where the relay runs. Missing fields fall back to PLAYWRITER_HOST and PLAYWRITER_TOKEN. */
export type RelayTarget = { host?: string; token?: string }

export type SessionClient = 'cli' | 'mcp'

export class ExtensionNotConnectedError extends Error {
  readonly code = 'extension_not_connected'
  constructor() {
    super(EXTENSION_NOT_CONNECTED_ERROR)
    this.name = 'ExtensionNotConnectedError'
  }
}

export function isLocalRelay(relay: RelayTarget): boolean {
  return !relay.host && !process.env.PLAYWRITER_HOST
}

export function getServerUrl(host?: string): string {
  const serverHost = host || process.env.PLAYWRITER_HOST || '127.0.0.1'
  return parseRelayHost(serverHost, RELAY_PORT).httpBaseUrl
}

/** Every relay request sends the token the same way. Falls back to PLAYWRITER_TOKEN. */
export function buildAuthHeaders({ token, json }: { token?: string; json?: boolean }): Record<string, string> {
  const headers: Record<string, string> = {}
  if (json) {
    headers['Content-Type'] = 'application/json'
  }
  const effectiveToken = token || process.env.PLAYWRITER_TOKEN
  if (effectiveToken) {
    headers['Authorization'] = `Bearer ${effectiveToken}`
  }
  return headers
}

async function ensureLocalRelay({ relay, logger }: { relay: RelayTarget; logger?: { log: (...args: any[]) => void } }): Promise<void> {
  if (isLocalRelay(relay)) {
    await ensureRelayServer({ logger })
  }
}

/** Relay errors come as JSON { error } or { text }, or as plain text from old relays and proxies. */
async function readRelayError(response: { status: number; text: () => Promise<string> }): Promise<string> {
  const text = await response.text()
  try {
    const json = JSON.parse(text) as { error?: string; text?: string }
    return json.error || json.text || `${response.status} ${text}`
  } catch {
    return `${response.status} ${text}`
  }
}

async function postRelay<T>({ relay, path, body }: { relay: RelayTarget; path: string; body: unknown }): Promise<T> {
  const response = await fetch(`${getServerUrl(relay.host)}${path}`, {
    method: 'POST',
    headers: buildAuthHeaders({ token: relay.token, json: true }),
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw new Error(await readRelayError(response))
  }
  return (await response.json()) as T
}

export async function fetchExtensionsStatus(relay: RelayTarget): Promise<ExtensionStatus[]> {
  const serverUrl = getServerUrl(relay.host)
  const headers = buildAuthHeaders({ token: relay.token })
  try {
    const response = await fetch(`${serverUrl}/extensions/status`, {
      signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
      headers,
    })
    if (response.ok) {
      const data = (await response.json()) as { extensions: ExtensionStatus[] }
      return data?.extensions || []
    }
    // Old relays only have the single-extension endpoint
    const fallback = await fetch(`${serverUrl}/extension/status`, {
      signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
      headers,
    })
    if (!fallback.ok) {
      return []
    }
    const data = (await fallback.json()) as {
      connected: boolean
      activeTargets: number
      browser: string | null
      profile: { email: string; id: string } | null
      playwriterVersion?: string | null
    }
    if (!data?.connected) {
      return []
    }
    return [
      {
        extensionId: 'default',
        stableKey: undefined,
        browser: data.browser,
        profile: data.profile,
        activeTargets: data.activeTargets,
        playwriterVersion: data.playwriterVersion || null,
      },
    ]
  } catch {
    return []
  }
}

// ============================================================================
// Browser discovery
// ============================================================================

/** A browser a session can be created on, listed by `session list` and by the MCP `session_list` tool. */
export interface BrowserOption {
  key: string
  type: 'extension' | 'direct' | 'cloud' | 'headless'
  browser: string
  profile: string
  /** Extension entries. null means the relay's only (legacy) extension */
  extensionId?: string | null
  /** Direct CDP entries */
  wsUrl?: string
  profiles?: Array<{ name: string; email: string }>
  /** Cloud entries: the running VM to reattach to. Missing on the "new cloud browser" entry */
  activeCloudSessionId?: string
}

function extensionToBrowserOption(extension: ExtensionStatus): BrowserOption {
  return {
    key: extension.stableKey || extension.extensionId,
    type: 'extension',
    browser: extension.browser || 'Chrome',
    profile: extension.profile?.email || '(not signed in)',
    extensionId: extension.extensionId === 'default' ? null : extension.stableKey || extension.extensionId,
  }
}

export function formatInstanceProfiles(instance: DiscoveredInstance): string {
  if (instance.profiles.length === 0) {
    return '(unknown)'
  }
  return instance.profiles
    .map((p) => {
      return p.email ? `${p.name} (${p.email})` : p.name
    })
    .join(', ')
}

function instanceToBrowserOption(instance: DiscoveredInstance): BrowserOption {
  return {
    key: `direct:${instance.port}`,
    type: 'direct',
    browser: instance.browser,
    profile: formatInstanceProfiles(instance),
    wsUrl: instance.wsUrl,
    profiles: instance.profiles,
  }
}

/** Running cloud browsers plus a "cloud" entry for a new one. [] when not logged in. */
async function discoverCloudBrowsers({ warnings }: { warnings: string[] }): Promise<BrowserOption[]> {
  const client = getCloudClient()
  if (!client) {
    return []
  }
  try {
    const { sessions } = await client.getStatus()
    const running: BrowserOption[] = sessions.map((s) => {
      return {
        key: `cloud-${s.index}`,
        type: 'cloud',
        browser: 'Chromium',
        profile: `(running, expires ${new Date(s.timeoutAt).toLocaleTimeString()})`,
        activeCloudSessionId: s.cloudSessionId,
      }
    })
    return [...running, { key: 'cloud', type: 'cloud', browser: 'Chromium', profile: '(new cloud browser)' }]
  } catch (error) {
    warnings.push(`Cloud browser discovery failed: ${error instanceof Error ? error.message : String(error)}`)
    return []
  }
}

/** Local extensions connected to the relay. Locally it starts the relay and waits up to waitMs for an extension. */
async function getConnectedExtensions({
  relay,
  waitMs,
  logger,
}: {
  relay: RelayTarget
  waitMs: number
  logger?: { log: (...args: any[]) => void }
}): Promise<ExtensionStatus[]> {
  if (!isLocalRelay(relay)) {
    return getLocalExtensionStatuses(await fetchExtensionsStatus(relay))
  }
  await ensureRelayServer({ logger })
  return waitForConnectedExtensions({ timeoutMs: waitMs, pollIntervalMs: EXTENSION_POLL_MS, logger })
}

/** Headless sessions need a Chrome binary on this machine. */
async function getHeadlessOption(): Promise<BrowserOption[]> {
  try {
    const { resolveBrowserExecutablePath } = await import('./browser-config.js')
    resolveBrowserExecutablePath()
    return [{ key: 'headless', type: 'headless', browser: 'Chrome (Headless)', profile: '-' }]
  } catch {
    return []
  }
}

/**
 * Every browser a new session can use: extensions, local Chrome instances with
 * debugging enabled (local relay only), headless Chrome and cloud browsers (when logged in).
 */
export async function discoverBrowserOptions({
  relay,
  extensionWaitMs,
  logger,
}: {
  relay: RelayTarget
  /** How long to wait for an extension to connect to a local relay */
  extensionWaitMs: number
  logger?: { log: (...args: any[]) => void }
}): Promise<{ options: BrowserOption[]; warnings: string[] }> {
  const warnings: string[] = []
  const [extensions, instances, headless, cloudOptions] = await Promise.all([
    getConnectedExtensions({ relay, waitMs: extensionWaitMs, logger }),
    isLocalRelay(relay) ? discoverChromeInstances() : Promise.resolve([]),
    getHeadlessOption(),
    discoverCloudBrowsers({ warnings }),
  ])
  const options = [
    ...extensions.map(extensionToBrowserOption),
    ...instances.map(instanceToBrowserOption),
    ...headless,
    ...cloudOptions,
  ]
  return { options, warnings }
}

export function formatBrowserTable(options: BrowserOption[]): string {
  const typeLabels = options.map((opt) => {
    return opt.type === 'direct' ? '--direct' : opt.type
  })
  const keyWidth = Math.max(3, ...options.map((opt) => opt.key.length))
  const typeWidth = Math.max(4, ...typeLabels.map((t) => t.length))
  const browserWidth = Math.max(7, ...options.map((opt) => opt.browser.length))
  const header = 'KEY'.padEnd(keyWidth) + '  ' + 'TYPE'.padEnd(typeWidth) + '  ' + 'BROWSER'.padEnd(browserWidth) + '  PROFILE'
  const rows = options.map((opt, i) => {
    return opt.key.padEnd(keyWidth) + '  ' + typeLabels[i].padEnd(typeWidth) + '  ' + opt.browser.padEnd(browserWidth) + '  ' + opt.profile
  })
  return [header, '-'.repeat(keyWidth + typeWidth + browserWidth + 20), ...rows].join('\n')
}

/**
 * Explains why a requested cloud browser key is not available: not logged in,
 * expired auth, or no subscription. null when the key is not a cloud key or
 * cloud options exist (then it is a typo and the browser list explains it).
 */
async function getCloudUnavailableMessage({
  browserKey,
  hasCloudOptions,
}: {
  browserKey: string
  hasCloudOptions: boolean
}): Promise<string | null> {
  if (!browserKey.startsWith('cloud') || hasCloudOptions) {
    return null
  }
  if (!loadCloudAuth()) {
    return dedent`
      Cloud browsers require authentication.

        Option 1: Run \`playwriter cloud login\` (interactive browser flow)
        Option 2: Set PLAYWRITER_API_KEY env var (create one at playwriter.dev/dashboard)

        Then subscribe at playwriter.dev/dashboard and create a session with browser "cloud".
    `
  }
  const tokenValid = await getCloudClient()
    ?.getStatus()
    .then(() => true)
    .catch(() => false)
  if (!tokenValid) {
    return 'Cloud authentication expired. Run `playwriter cloud login` or set PLAYWRITER_API_KEY env var.'
  }
  return dedent`
    No cloud browser sessions available. You are logged in, but you may need an active subscription.
    Run \`playwriter cloud subscribe\` to manage your plan, then create a session with browser "cloud".
  `
}

// ============================================================================
// Session creation
// ============================================================================

export type SessionMode = 'extension' | 'headless' | 'direct' | 'remote' | 'cloud'

export type CreatedSession = {
  id: string
  mode: SessionMode
  /** Short description for "Session N created (label)". Empty for plain extension sessions */
  label: string
  liveUrl?: string | null
  /** Extra lines worth showing the agent, like remote control caveats */
  notes: string[]
}

export type NewSessionResult =
  | { kind: 'created'; session: CreatedSession; warnings: string[] }
  /** Several browsers match: the caller must pick one by key and create the session again */
  | { kind: 'choose'; message: string; options: BrowserOption[]; warnings: string[] }

export type NewSessionOptions = {
  relay: RelayTarget
  cwd: string
  client: SessionClient
  /** Key from discoverBrowserOptions, or "headless" (launch Chrome) or "cloud" (new cloud browser) */
  browser?: string
  /** Direct CDP: '' auto-discovers Chrome with debugging on, else a ws:// URL or host:port */
  direct?: string
  /** Remote control id another user shared with the extension `Remote control` button */
  remote?: string
  tabGroup?: string
  tabGroupColor?: TabGroupColor
  patchright?: boolean
  /** Cloud residential proxy region, e.g. us, de */
  proxy?: string
  /** Cloud custom proxy, host:port or user:pass@host:port */
  customProxy?: string
  /** Cloud browser timeout in minutes (1-240) */
  cloudTimeoutMinutes?: number
  /** Load images, video and fonts through the cloud proxy (blocked by default to save bandwidth) */
  disableProxyBandwidthAcceleration?: boolean
  logger?: { log: (...args: any[]) => void }
}

type RelaySessionResponse = {
  id: string
  warning?: string | null
  /** Echoed by relays that support tab groups */
  tabGroup?: string | null
}

/** Parse a custom proxy string (host:port or user:pass@host:port). */
export function parseCustomProxy(proxyStr: string): { host: string; port: number; username?: string; password?: string } {
  const atIdx = proxyStr.lastIndexOf('@')
  const userPass = atIdx === -1 ? '' : proxyStr.slice(0, atIdx)
  const hostPort = atIdx === -1 ? proxyStr : proxyStr.slice(atIdx + 1)
  const colonIdx = userPass.indexOf(':')
  const username = userPass ? (colonIdx === -1 ? userPass : userPass.slice(0, colonIdx)) : undefined
  const password = userPass && colonIdx !== -1 ? userPass.slice(colonIdx + 1) : undefined

  const lastColon = hostPort.lastIndexOf(':')
  if (lastColon === -1) {
    throw new Error(`Invalid proxy format: missing port in "${proxyStr}". Expected host:port or user:pass@host:port`)
  }
  const port = parseInt(hostPort.slice(lastColon + 1), 10)
  if (isNaN(port)) {
    throw new Error(`Invalid proxy port in "${proxyStr}"`)
  }
  return { host: hostPort.slice(0, lastColon), port, username, password }
}

export function validateCloudTimeout(minutes: number | undefined): number | undefined {
  if (minutes === undefined) {
    return undefined
  }
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_CLOUD_TIMEOUT_MINUTES) {
    throw new Error(`Cloud timeout must be an integer from 1 to ${MAX_CLOUD_TIMEOUT_MINUTES} minutes`)
  }
  return minutes
}

/** Block images/video/fonts when a proxy is on, unless the caller opted out. */
function computeBlockProxyResources(options: NewSessionOptions): boolean | undefined {
  if (!options.proxy && !options.customProxy) {
    return undefined
  }
  return !options.disableProxyBandwidthAcceleration
}

/**
 * Create a relay session the same way for the CLI `session new` and the MCP
 * `session_new` tool. Selection order: remote, headless, direct, then the
 * browser key, then the only connected extension.
 */
export async function newSession(options: NewSessionOptions): Promise<NewSessionResult> {
  const { relay, cwd, client, browser, direct, remote, tabGroup, tabGroupColor, patchright, logger } = options
  const warnings: string[] = []
  const local = isLocalRelay(relay)
  const cloudAuth = loadCloudAuth() ?? undefined
  // Old relays and the CLI path omit client; the relay counts it as cli.
  const clientField = client === 'mcp' ? { client } : {}

  const warnExtensionOnly = (mode: string) => {
    if (tabGroup || tabGroupColor || patchright) {
      warnings.push(`tab group and patchright options only apply to extension and remote sessions, ignored for ${mode}.`)
    }
  }
  const collect = (result: RelaySessionResponse, { tabGroupRequested }: { tabGroupRequested: boolean }) => {
    if (result.warning) {
      warnings.push(result.warning)
    }
    if (tabGroupRequested && result.tabGroup === undefined) {
      warnings.push('The running relay does not support tab groups. Restart it (kill port 19988) after updating playwriter.')
    }
  }
  const created = (session: Omit<CreatedSession, 'notes'> & { notes?: string[] }): NewSessionResult => {
    return { kind: 'created', session: { notes: [], ...session }, warnings }
  }

  const createDirect = async ({ cdpEndpoint, label, instance }: { cdpEndpoint: string; label: string; instance?: { browser: string; profiles: Array<{ name: string; email: string }> } }) => {
    const result = await postRelay<RelaySessionResponse>({
      relay,
      path: '/cli/session/new',
      body: { cdpEndpoint, cwd, browser: instance?.browser, profiles: instance?.profiles, cloudAuth, ...clientField },
    })
    collect(result, { tabGroupRequested: false })
    return created({ id: result.id, mode: 'direct', label })
  }

  const createExtension = async (extensionId: string | null) => {
    const result = await postRelay<RelaySessionResponse>({
      relay,
      path: '/cli/session/new',
      body: { extensionId, cwd, cloudAuth, tabGroup, tabGroupColor, patchright: patchright || undefined, ...clientField },
    })
    collect(result, { tabGroupRequested: Boolean(tabGroup || tabGroupColor) })
    return created({ id: result.id, mode: 'extension', label: '' })
  }

  const createCloud = async (activeCloudSessionId?: string) => {
    warnExtensionOnly('cloud sessions')
    const cloudClient = getCloudClient()
    const auth = loadCloudAuth()
    if (!cloudClient || !auth) {
      throw new Error('Not logged in to cloud. Run `playwriter cloud login` first.')
    }
    const blockProxyResources = computeBlockProxyResources(options)
    const vm = await (async () => {
      if (activeCloudSessionId) {
        const session = await cloudClient.getSessionStatus(activeCloudSessionId)
        if (!session || session.status !== 'active') {
          throw new Error('Cloud session is no longer active. It may have timed out.')
        }
        return { cloudSessionId: activeCloudSessionId, cdpUrl: session.cdpUrl, timeoutAt: session.timeoutAt, isNew: false }
      }
      const connected = await cloudClient.connect({
        proxyRegion: options.proxy,
        customProxy: options.customProxy ? parseCustomProxy(options.customProxy) : undefined,
        timeout: validateCloudTimeout(options.cloudTimeoutMinutes),
      })
      return { ...connected, isNew: true }
    })()
    // A VM this call started must not leak (it is paid) when the relay session fails
    const stopNewVm = async () => {
      if (vm.isNew) {
        await cloudClient.disconnect(vm.cloudSessionId).catch(() => {})
      }
    }
    if (!vm.cdpUrl) {
      await stopNewVm()
      throw new Error('Cloud browser returned no CDP URL. The VM may have failed to start.')
    }
    try {
      const cdpEndpoint = await resolveDirectInput(vm.cdpUrl)
      const result = await postRelay<RelaySessionResponse>({
        relay,
        path: '/cli/session/new',
        body: {
          cdpEndpoint,
          cwd,
          browser: 'Chromium (cloud)',
          cloud: {
            cloudSessionId: vm.cloudSessionId,
            cloudBaseUrl: auth.baseUrl,
            cloudToken: auth.token,
            timeoutAt: vm.timeoutAt,
            blockProxyResources,
          },
          ...clientField,
        },
      })
      collect(result, { tabGroupRequested: false })
      return created({ id: result.id, mode: 'cloud', label: 'cloud', liveUrl: buildLiveUrl(vm.cdpUrl, auth.baseUrl) })
    } catch (error) {
      await stopNewVm()
      throw error
    }
  }

  const createHeadless = async () => {
    warnExtensionOnly('headless sessions')
    await ensureLocalRelay({ relay, logger })
    const result = await postRelay<RelaySessionResponse>({
      relay,
      path: '/cli/session/new',
      body: { headless: true, cwd, cloudAuth, ...clientField },
    }).catch((error: Error) => {
      throw error.message.includes('Could not find a supported browser binary') ? new Error(NO_CHROME_ERROR) : error
    })
    collect(result, { tabGroupRequested: false })
    return created({ id: result.id, mode: 'headless', label: 'headless' })
  }

  const createFromOption = async (option: BrowserOption) => {
    if (option.type === 'headless') {
      return createHeadless()
    }
    if (option.type === 'cloud') {
      return createCloud(option.activeCloudSessionId)
    }
    if (option.type === 'direct') {
      warnExtensionOnly('direct CDP sessions')
      return createDirect({ cdpEndpoint: option.wsUrl!, label: `direct CDP, ${option.browser} ${option.profile}`, instance: { browser: option.browser, profiles: option.profiles || [] } })
    }
    return createExtension(option.extensionId ?? null)
  }

  const selectOption = async ({ key, options: browserOptions }: { key: string; options: BrowserOption[] }) => {
    const selected = browserOptions.find((opt) => opt.key === key)
    if (selected) {
      return selected
    }
    const hasCloudOptions = browserOptions.some((opt) => opt.type === 'cloud')
    const cloudMessage = await getCloudUnavailableMessage({ browserKey: key, hasCloudOptions })
    const available = browserOptions.map((opt) => opt.key).join(', ') || '(none)'
    throw new Error(cloudMessage || `Browser not found: ${key}\nAvailable: ${available}`)
  }

  if (remote) {
    await ensureLocalRelay({ relay, logger })
    const result = await postRelay<RelaySessionResponse>({
      relay,
      path: '/cli/session/new',
      body: { remoteControlUrl: remote, cwd, tabGroup, tabGroupColor, patchright: patchright || undefined, ...clientField },
    })
    collect(result, { tabGroupRequested: Boolean(tabGroup || tabGroupColor) })
    return created({
      id: result.id,
      mode: 'remote',
      label: 'remote browser',
      notes: [
        'context.pages()[0] is the tab where the user started sharing. Remote control is not a security sandbox.',
        'The user can revoke access anytime with Stop sharing on the Remote ON dropdown.',
      ],
    })
  }

  if (browser === 'headless') {
    return createHeadless()
  }

  if (direct) {
    warnExtensionOnly('direct CDP sessions')
    const cdpEndpoint = await resolveDirectInput(direct)
    await ensureLocalRelay({ relay, logger })
    return createDirect({ cdpEndpoint, label: 'direct CDP' })
  }

  if (direct === '') {
    warnExtensionOnly('direct CDP sessions')
    if (!local) {
      throw new Error(dedent`
        Direct CDP auto-discovery only works with a local relay.
        For a remote relay, pass an explicit endpoint reachable from the relay host, like ws://relay-host:9222/devtools/browser/...
      `)
    }
    await ensureLocalRelay({ relay, logger })
    logger?.log(pc.dim('Discovering Chrome instances with debugging enabled...'))
    const directOptions = (await discoverChromeInstances()).map(instanceToBrowserOption)
    if (directOptions.length === 0) {
      throw new Error(dedent`
        No Chrome instances with debugging enabled found.
        Enable debugging in one of these ways:
          1. Open chrome://inspect/#remote-debugging in Chrome
          2. Launch Chrome with: chrome --remote-debugging-port=9222
      `)
    }
    if (browser) {
      return createFromOption(await selectOption({ key: browser, options: directOptions }))
    }
    if (directOptions.length === 1) {
      return createFromOption(directOptions[0])
    }
    return { kind: 'choose', message: 'Multiple Chrome instances with debugging enabled:', options: directOptions, warnings }
  }

  const extensions = await getConnectedExtensions({ relay, waitMs: SESSION_EXTENSION_WAIT_MS, logger })
  for (const extension of extensions) {
    const outdated = getExtensionOutdatedWarning(extension.playwriterVersion)
    if (outdated) {
      warnings.push(outdated)
      break
    }
  }

  // One extension and no explicit pick: skip the slower direct and cloud discovery
  if (extensions.length === 1 && !browser) {
    return createFromOption(extensionToBrowserOption(extensions[0]))
  }

  if (extensions.length > 0 || browser) {
    logger?.log(pc.dim('Discovering additional browsers...'))
  }
  const cloudOptions = await discoverCloudBrowsers({ warnings })
  // An explicit direct:<port> key from session_list must work without an extension too
  const discoverDirect = local && (extensions.length > 0 || Boolean(browser?.startsWith('direct:')))
  const directOptions = discoverDirect ? (await discoverChromeInstances()).map(instanceToBrowserOption) : []
  const allOptions = [...extensions.map(extensionToBrowserOption), ...directOptions, ...cloudOptions]

  if (allOptions.length === 0) {
    const cloudMessage = browser ? await getCloudUnavailableMessage({ browserKey: browser, hasCloudOptions: false }) : null
    if (cloudMessage) {
      throw new Error(cloudMessage)
    }
    throw new ExtensionNotConnectedError()
  }
  if (browser) {
    return createFromOption(await selectOption({ key: browser, options: allOptions }))
  }
  const message = extensions.length === 0 ? 'No local browsers detected, but cloud browsers are available:' : 'Multiple browsers detected:'
  return { kind: 'choose', message, options: allOptions, warnings }
}

// ============================================================================
// Existing sessions
// ============================================================================

export type RelaySessionInfo = {
  id: string
  stateKeys: string[]
  browser: string | null
  profile: { email: string; id: string } | null
  extensionId: string | null
  cwd: string | null
  tabGroup?: string | null
  tabGroupColor?: string | null
  patchright?: boolean
}

export async function listSessions(relay: RelayTarget): Promise<RelaySessionInfo[]> {
  const response = await fetch(`${getServerUrl(relay.host)}/cli/sessions`, {
    headers: buildAuthHeaders({ token: relay.token }),
    signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(await readRelayError(response))
  }
  const result = (await response.json()) as { sessions: RelaySessionInfo[] }
  return result.sessions
}

export type UpdateSessionResult = {
  patchright?: boolean
  /** The driver changed, so the session reconnected and its state was cleared */
  reconnected?: boolean
  tabGroup?: string
  tabGroupColor?: string
  movedTabs?: number
  warning?: string
}

export async function updateSession({
  relay,
  sessionId,
  tabGroup,
  tabGroupColor,
  patchright,
}: {
  relay: RelayTarget
  sessionId: string
  tabGroup?: string
  tabGroupColor?: TabGroupColor
  patchright?: boolean
}): Promise<UpdateSessionResult> {
  const response = await fetch(`${getServerUrl(relay.host)}/cli/session/update`, {
    method: 'POST',
    headers: buildAuthHeaders({ token: relay.token, json: true }),
    body: JSON.stringify({ sessionId, tabGroup, tabGroupColor, patchright }),
  })
  if (!response.ok) {
    const text = await response.text()
    const error = (() => {
      try {
        return (JSON.parse(text) as { error?: string }).error
      } catch {
        return undefined
      }
    })()
    if (response.status === 404 && !error) {
      throw new Error('The running relay does not support session update. Restart it (kill port 19988) after updating playwriter.')
    }
    throw new Error(error || `${response.status} ${text}`)
  }
  const result = (await response.json()) as UpdateSessionResult
  if (patchright !== undefined && result.patchright === undefined) {
    throw new Error('The running relay does not support switching patchright. Restart it (kill port 19988) after updating playwriter.')
  }
  return result
}

export async function deleteSession({
  relay,
  sessionId,
  closeCreatedTabs,
}: {
  relay: RelayTarget
  sessionId: string
  /** Also close the tabs this session opened. Other sessions' and user-enabled tabs stay open */
  closeCreatedTabs?: boolean
}): Promise<{ warning?: string }> {
  return postRelay<{ warning?: string }>({
    relay,
    path: '/cli/session/delete',
    body: { sessionId, closeCreatedTabs: closeCreatedTabs || undefined },
  })
}

export async function resetSession({ relay, sessionId, cwd }: { relay: RelayTarget; sessionId: string; cwd: string }): Promise<{ pagesCount: number }> {
  return postRelay<{ pagesCount: number }>({ relay, path: '/cli/reset', body: { sessionId, cwd } })
}

export type ExecuteResponse = {
  /** HTTP status. 404: the session does not exist (it ended or the relay restarted) */
  status: number
  text: string
  images: Array<{ data: string; mimeType: string }>
  screenshots: Array<{ path: string; base64: string; snapshot: string; labelCount: number }>
  isError: boolean
  isCloud?: boolean
}

/**
 * Run code in a relay session. Aborting `signal` disconnects, and the relay then
 * aborts the execute and releases the session.
 */
export async function executeInSession({
  relay,
  sessionId,
  code,
  timeout,
  cwd,
  signal,
}: {
  relay: RelayTarget
  sessionId: string
  code: string
  timeout: number
  cwd: string
  signal: AbortSignal
}): Promise<ExecuteResponse> {
  const response = await undiciFetch(`${getServerUrl(relay.host)}/cli/execute`, {
    method: 'POST',
    headers: buildAuthHeaders({ token: relay.token, json: true }),
    body: JSON.stringify({ sessionId, code, timeout, cwd }),
    dispatcher: executeDispatcher,
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeout + EXECUTE_RESPONSE_GRACE_MS)]),
  })
  if (!response.ok) {
    // 503 while the relay drains for an upgrade and 404 for a lost session carry a readable text
    return { status: response.status, text: await readRelayError(response), images: [], screenshots: [], isError: true }
  }
  const result = (await response.json()) as Omit<ExecuteResponse, 'status'>
  return { ...result, status: response.status }
}
