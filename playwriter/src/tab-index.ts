/**
 * Tab index: which agent opened and last used each tab, so agents and users can
 * see who is driving which tab and avoid opening duplicate tabs on the same page.
 *
 * Lives in the relay only. The extension also stores an ownership key per tab
 * (groupKey) but never reports it back, and extension releases are slow, so the
 * relay derives ownership from the CDP traffic it already routes:
 * - "opened by" comes from the client that sent Target.createTarget
 * - "last used by" comes from the client that last sent a tab-driving command
 *
 * Agents are keyed by CLI/SDK session id ("3") or, for MCP servers that have no
 * relay session, by `mcp:<random id>` generated once per MCP process.
 */
import crypto from 'node:crypto'

/** `session` = CLI/SDK relay session, `mcp` = MCP server process (no relay session) */
export type AgentKind = 'session' | 'mcp'

export type AgentRecord = {
  key: string
  kind: AgentKind
  /** Optional human label from PLAYWRITER_AGENT */
  label: string | null
  cwd: string | null
  firstSeenAt: number
  lastActivityAt: number
}

export type TabRecord = {
  targetId: string
  openedBy: string | null
  openedAt: number | null
  lastUsedBy: string | null
  lastUsedAt: number | null
}

/** A live page target as the relay sees it, joined with its tab record. */
export type TabTarget = {
  targetId: string
  url: string
  title: string
  extensionId: string
}

export type TabView = TabTarget & Omit<TabRecord, 'targetId'>

export type DuplicateTabGroup = {
  location: string
  tabs: TabView[]
}

/** An agent as returned by /cli/tabs and /cli/sessions. */
export type AgentSummary = Omit<AgentRecord, 'firstSeenAt'> & {
  connected: boolean
}

/**
 * Short form of an agent's working directory. Claude Code worktrees
 * (`<repo>/.claude/worktrees/<name>`) become `<repo>/<name>`; anything else
 * becomes its last path segment. Handles Windows and POSIX separators because
 * the CLI, MCP and relay can run on different OSes (WSL).
 */
export function shortCwd(cwd: string | null): string | null {
  if (!cwd) {
    return null
  }
  const worktree = cwd.match(/([^\\/]+)[\\/]\.claude[\\/]worktrees[\\/]([^\\/]+)/)
  if (worktree) {
    return `${worktree[1]}/${worktree[2]}`
  }
  return cwd.split(/[\\/]/).filter(Boolean).at(-1) || cwd
}

/** e.g. `3 (halfhour/launch-plan)` or `mcp:a1b2c3 (reviewer)` */
export function describeAgent({ key, agents }: { key: string | null; agents: AgentSummary[] }): string {
  if (!key) {
    return '-'
  }
  const agent = agents.find((candidate) => {
    return candidate.key === key
  })
  const detail = agent?.label || shortCwd(agent?.cwd ?? null)
  return detail ? `${key} (${detail})` : key
}

export function formatAgo({ timestamp, now }: { timestamp: number | null; now: number }): string {
  if (!timestamp) {
    return '-'
  }
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000))
  if (seconds < 5) {
    return 'just now'
  }
  if (seconds < 60) {
    return `${seconds}s ago`
  }
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) {
    return `${minutes}m ago`
  }
  const hours = Math.round(minutes / 60)
  if (hours < 48) {
    return `${hours}h ago`
  }
  return `${Math.round(hours / 24)}d ago`
}

export function formatDuplicateWarning({
  group,
  agentKey,
  agents,
  now,
}: {
  group: DuplicateTabGroup
  agentKey: string
  agents: AgentSummary[]
  now: number
}): string {
  const tabs = group.tabs.map((tab) => {
    const user = tab.lastUsedBy ?? tab.openedBy
    const who = user === agentKey ? 'you' : describeAgent({ key: user, agents })
    const when = formatAgo({ timestamp: Math.max(tab.lastUsedAt ?? 0, tab.openedAt ?? 0) || null, now })
    const title = tab.title ? `"${tab.title}" ` : ''
    return user ? `${title}used by ${who} ${when}` : `${title}not used by any agent`
  })
  return (
    `${group.location} is open in ${group.tabs.length} tabs: ${tabs.join('; ')}. ` +
    `Reuse an existing tab from context.pages() instead of opening another, ` +
    `and coordinate before driving a tab another agent is using. Run \`playwriter tabs\` to see all tabs.`
  )
}

/** Records idle longer than this, whose tab or agent is gone, are pruned. */
export const TAB_INDEX_MAX_IDLE_MS = 60 * 60 * 1000

// Playwright sends Page.enable, Runtime.enable, etc. to every tab when it
// connects, and helpers like the ghost cursor run Runtime.evaluate in the
// background, so counting every command would mark every tab as used by every
// agent that connects. Only commands that drive a tab count.
const TAB_USE_METHOD_PREFIXES = ['Input.', 'DOM.', 'Accessibility.']
const TAB_USE_METHODS = new Set([
  'Page.navigate',
  'Page.reload',
  'Page.navigateToHistoryEntry',
  'Page.captureScreenshot',
  'Page.printToPDF',
  'Page.bringToFront',
  'Page.close',
  'Page.handleJavaScriptDialog',
])

export function isTabUseCommand(method: string): boolean {
  if (TAB_USE_METHODS.has(method)) {
    return true
  }
  return TAB_USE_METHOD_PREFIXES.some((prefix) => {
    return method.startsWith(prefix)
  })
}

/**
 * The "part of the UI" a URL points at: origin + path, ignoring query, hash and
 * a trailing slash. Returns null for blank and browser-internal pages, which are
 * never considered duplicates.
 */
export function normalizeTabLocation(url: string | undefined | null): string | null {
  if (!url) {
    return null
  }
  const parsed = (() => {
    try {
      return new URL(url)
    } catch {
      return null
    }
  })()
  if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    return null
  }
  const pathname = parsed.pathname.length > 1 ? parsed.pathname.replace(/\/+$/, '') : ''
  return `${parsed.host}${pathname}`
}

export function generateAgentId(): string {
  return crypto.randomBytes(3).toString('hex')
}

/** Stable key for whoever sent a CDP command, or null for anonymous clients. */
export function agentKeyFor({
  sessionId,
  kind,
  agentId,
}: {
  sessionId?: string | null
  kind?: string | null
  agentId?: string | null
}): string | null {
  if (sessionId) {
    return sessionId
  }
  if (agentId) {
    return `${kind || 'agent'}:${agentId}`
  }
  return null
}

function lastActivityOf(tab: Pick<TabRecord, 'openedAt' | 'lastUsedAt'>): number {
  return Math.max(tab.openedAt || 0, tab.lastUsedAt || 0)
}

export class TabIndex {
  tabs = new Map<string, TabRecord>()
  agents = new Map<string, AgentRecord>()

  upsertAgent({
    key,
    kind,
    label,
    cwd,
    now,
  }: {
    key: string
    kind: AgentKind
    label?: string | null
    cwd?: string | null
    now: number
  }): AgentRecord {
    const existing = this.agents.get(key)
    const record: AgentRecord = {
      key,
      kind,
      label: label || existing?.label || null,
      cwd: cwd || existing?.cwd || null,
      firstSeenAt: existing?.firstSeenAt ?? now,
      lastActivityAt: now,
    }
    this.agents.set(key, record)
    return record
  }

  touchAgent({ key, now }: { key: string; now: number }): void {
    const agent = this.agents.get(key)
    if (agent) {
      agent.lastActivityAt = now
    }
  }

  recordTabOpened({ targetId, agentKey, now }: { targetId: string; agentKey: string | null; now: number }): void {
    const existing = this.tabs.get(targetId)
    this.tabs.set(targetId, {
      targetId,
      openedBy: agentKey,
      openedAt: now,
      lastUsedBy: agentKey ?? existing?.lastUsedBy ?? null,
      lastUsedAt: agentKey ? now : (existing?.lastUsedAt ?? null),
    })
    if (agentKey) {
      this.touchAgent({ key: agentKey, now })
    }
  }

  recordTabUsed({ targetId, agentKey, now }: { targetId: string; agentKey: string | null; now: number }): void {
    if (!agentKey) {
      return
    }
    const existing = this.tabs.get(targetId)
    this.tabs.set(targetId, {
      targetId,
      openedBy: existing?.openedBy ?? null,
      openedAt: existing?.openedAt ?? null,
      lastUsedBy: agentKey,
      lastUsedAt: now,
    })
    this.touchAgent({ key: agentKey, now })
  }

  /** Join live page targets with their records, most recently active first. */
  listTabs({ targets }: { targets: TabTarget[] }): TabView[] {
    return targets
      .map((target): TabView => {
        const record = this.tabs.get(target.targetId)
        return {
          ...target,
          openedBy: record?.openedBy ?? null,
          openedAt: record?.openedAt ?? null,
          lastUsedBy: record?.lastUsedBy ?? null,
          lastUsedAt: record?.lastUsedAt ?? null,
        }
      })
      .sort((a, b) => {
        return lastActivityOf(b) - lastActivityOf(a)
      })
  }

  /**
   * Locations from `urls` that are open in more than one tab, where at least
   * one of those tabs was driven by `agentKey` since `since`. The second
   * condition keeps an agent from being warned about another agent's
   * navigation that merely happened during the same time window.
   */
  findDuplicates({
    targets,
    agentKey,
    since,
    urls,
  }: {
    targets: TabTarget[]
    agentKey: string
    since: number
    urls: string[]
  }): DuplicateTabGroup[] {
    const tabs = this.listTabs({ targets })
    const locations = [...new Set(urls.map(normalizeTabLocation))].filter((location): location is string => {
      return location !== null
    })
    return locations
      .map((location): DuplicateTabGroup => {
        return {
          location,
          tabs: tabs.filter((tab) => {
            return normalizeTabLocation(tab.url) === location
          }),
        }
      })
      .filter((group) => {
        const drivenByAgent = group.tabs.some((tab) => {
          const used = tab.lastUsedBy === agentKey && (tab.lastUsedAt ?? 0) >= since
          const opened = tab.openedBy === agentKey && (tab.openedAt ?? 0) >= since
          return used || opened
        })
        return group.tabs.length > 1 && drivenByAgent
      })
  }

  /**
   * Drop records for tabs that are gone and agents that disconnected, once they
   * have been idle for `maxIdleMs`. Tabs briefly detach whenever the extension's
   * service worker restarts, so records are not dropped the moment a tab detaches.
   */
  prune({
    liveTargetIds,
    connectedAgentKeys,
    now,
    maxIdleMs = TAB_INDEX_MAX_IDLE_MS,
  }: {
    liveTargetIds: Set<string>
    connectedAgentKeys: Set<string>
    now: number
    maxIdleMs?: number
  }): void {
    for (const [targetId, tab] of this.tabs) {
      if (!liveTargetIds.has(targetId) && now - lastActivityOf(tab) > maxIdleMs) {
        this.tabs.delete(targetId)
      }
    }
    for (const [key, agent] of this.agents) {
      if (!connectedAgentKeys.has(key) && now - agent.lastActivityAt > maxIdleMs) {
        this.agents.delete(key)
      }
    }
  }
}
