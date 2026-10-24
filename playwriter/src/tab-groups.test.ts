/**
 * Integration tests for per-session tab group names.
 * - `session new --tab-group` puts tabs created by that session in a custom group.
 * - Manually toggled tabs stay in the default 'playwriter' group.
 * - `/cli/session/update` renames the group and moves its tabs.
 * Also covers the tab index: which agent opened / last used each tab, duplicate
 * tab warnings, MCP agents in the session list, and the activity log.
 */

import fs from 'node:fs'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { chromium } from '@xmorse/playwright-core'
import {
  setupTestContext,
  cleanupTestContext,
  getExtensionServiceWorker,
  createSimpleServer,
  safeCloseCDPBrowser,
  type SimpleServer,
  type TestContext,
  js,
} from './test-utils.js'
import { ACTIVITY_LOG_FILE_PATH, getCdpUrl } from './utils.js'
import type { ActivityEntry } from './activity-log.js'
import type { AgentSummary, TabView } from './tab-index.js'
import './test-declarations.js'

const TEST_PORT = 19972
const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`
const JSON_HEADERS = { 'Content-Type': 'application/json' }

type GroupSnapshot = Array<{ title: string | undefined; color: string; tabCount: number }>

describe('Session tab groups', () => {
  let testCtx: TestContext | null = null

  beforeAll(async () => {
    testCtx = await setupTestContext({ port: TEST_PORT, tempDirPrefix: 'pw-tabgroups-', toggleExtension: true })
  }, 600000)

  afterAll(async () => {
    await cleanupTestContext(testCtx, null)
    testCtx = null
  })

  const executeCli = async ({ sessionId, code }: { sessionId: string; code: string }) => {
    const response = await fetch(`${SERVER_URL}/cli/execute`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ sessionId, code }),
    })
    return (await response.json()) as { text: string; isError: boolean }
  }

  const readGroups = async (): Promise<GroupSnapshot> => {
    const serviceWorker = await getExtensionServiceWorker(testCtx!.browserContext)
    return await serviceWorker.evaluate(async () => {
      const groups = await chrome.tabGroups.query({})
      const snapshots: Array<{ title: string | undefined; color: string; tabCount: number }> = []
      for (const group of groups) {
        const tabs = await chrome.tabs.query({ groupId: group.id })
        snapshots.push({ title: group.title, color: group.color, tabCount: tabs.length })
      }
      return snapshots.sort((a, b) => (a.title || '').localeCompare(b.title || ''))
    })
  }

  const waitForGroups = async (predicate: (groups: GroupSnapshot) => boolean): Promise<GroupSnapshot> => {
    let groups: GroupSnapshot = []
    for (let attempt = 0; attempt < 50; attempt++) {
      groups = await readGroups()
      if (predicate(groups)) {
        return groups
      }
      await new Promise((r) => {
        setTimeout(r, 200)
      })
    }
    return groups
  }

  it('puts session tabs in a custom group while toggled tabs stay in the default one', async () => {
    const createResponse = await fetch(`${SERVER_URL}/cli/session/new`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ tabGroup: 'agent-red' }),
    })
    const created = (await createResponse.json()) as { id: string; tabGroup?: string | null }
    expect(created.tabGroup).toBe('agent-red')

    const result = await executeCli({
      sessionId: created.id,
      code: js`
        state.groupPage = await context.newPage();
        await state.groupPage.goto('about:blank');
        return context.pages().length;
      `,
    })
    expect(result.isError).toBeFalsy()

    const groups = await waitForGroups((g) => {
      return g.some((group) => group.title === 'agent-red' && group.tabCount >= 1)
    })
    const titles = groups.map((g) => g.title)
    expect(titles).toContain('agent-red')
    expect(titles).toContain('playwriter')
    const customGroup = groups.find((g) => g.title === 'agent-red')!
    expect(customGroup.tabCount).toBe(1)
    expect(customGroup.color).not.toBe('green')

    // The extension tracks the group title per tab (source of truth for sync)
    const serviceWorker = await getExtensionServiceWorker(testCtx!.browserContext)
    const groupTitles = await serviceWorker.evaluate(() => {
      const state = globalThis.getExtensionState()
      return Array.from(state.tabs.values())
        .map((tab) => tab.groupTitle || 'playwriter')
        .sort()
    })
    expect(groupTitles).toMatchInlineSnapshot(`
      [
        "agent-red",
        "playwriter",
      ]
    `)
  }, 60000)

  it('renames the session group via /cli/session/update and keeps it for new tabs', async () => {
    const listResponse = await fetch(`${SERVER_URL}/cli/sessions`)
    const { sessions } = (await listResponse.json()) as { sessions: Array<{ id: string; tabGroup: string | null }> }
    const session = sessions.find((s) => s.tabGroup === 'agent-red')
    expect(session).toBeTruthy()

    const updateResponse = await fetch(`${SERVER_URL}/cli/session/update`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ sessionId: session!.id, tabGroup: 'agent-blue' }),
    })
    const updated = (await updateResponse.json()) as {
      success: boolean
      tabGroup: string
      movedTabs: number
      warning?: string
    }
    expect(updated.success).toBe(true)
    expect(updated.tabGroup).toBe('agent-blue')
    expect(updated.warning).toBeUndefined()
    expect(updated.movedTabs).toBe(1)

    const renamedGroups = await waitForGroups((g) => {
      return g.some((group) => group.title === 'agent-blue') && !g.some((group) => group.title === 'agent-red')
    })
    expect(renamedGroups.map((g) => g.title)).toContain('agent-blue')
    expect(renamedGroups.map((g) => g.title)).not.toContain('agent-red')

    // New tabs created after the rename join the renamed group without a reconnect
    const result = await executeCli({
      sessionId: session!.id,
      code: js`
        state.secondGroupPage = await context.newPage();
        await state.secondGroupPage.goto('about:blank');
        return context.pages().length;
      `,
    })
    expect(result.isError).toBeFalsy()

    const finalGroups = await waitForGroups((g) => {
      return g.some((group) => group.title === 'agent-blue' && group.tabCount === 2)
    })
    expect(finalGroups.find((g) => g.title === 'agent-blue')?.tabCount).toBe(2)

    // Session tab group survives in session list
    const finalList = await fetch(`${SERVER_URL}/cli/sessions`)
    const finalSessions = (await finalList.json()) as { sessions: Array<{ id: string; tabGroup: string | null }> }
    expect(finalSessions.sessions.find((s) => s.id === session!.id)?.tabGroup).toBe('agent-blue')

    // Cleanup: close session pages and delete the session
    await executeCli({
      sessionId: session!.id,
      code: js`
        await state.groupPage.close();
        await state.secondGroupPage.close();
        delete state.groupPage;
        delete state.secondGroupPage;
      `,
    })
    await fetch(`${SERVER_URL}/cli/session/delete`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ sessionId: session!.id }),
    })
  }, 60000)

  it('renaming a default-group session moves only its own tabs, not toggled ones', async () => {
    // Session created WITHOUT --tab-group: its tabs share the default
    // 'playwriter' group with the manually toggled tab from setup.
    const createResponse = await fetch(`${SERVER_URL}/cli/session/new`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    })
    const created = (await createResponse.json()) as { id: string }

    const result = await executeCli({
      sessionId: created.id,
      code: js`
        state.defaultGroupPage = await context.newPage();
        await state.defaultGroupPage.goto('about:blank');
        return context.pages().length;
      `,
    })
    expect(result.isError).toBeFalsy()

    await waitForGroups((g) => {
      return g.some((group) => group.title === 'playwriter' && group.tabCount >= 2)
    })

    const updateResponse = await fetch(`${SERVER_URL}/cli/session/update`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ sessionId: created.id, tabGroup: 'agent-default-rename' }),
    })
    const updated = (await updateResponse.json()) as { success: boolean; movedTabs: number; warning?: string }
    expect(updated.success).toBe(true)
    expect(updated.warning).toBeUndefined()
    // Only the session-created tab moves — the manually toggled tab is not stolen
    expect(updated.movedTabs).toBe(1)

    const groups = await waitForGroups((g) => {
      return g.some((group) => group.title === 'agent-default-rename' && group.tabCount === 1)
    })
    expect(groups.find((g) => g.title === 'agent-default-rename')?.tabCount).toBe(1)
    expect(groups.find((g) => g.title === 'playwriter')?.tabCount).toBe(1)

    await executeCli({
      sessionId: created.id,
      code: js`
        await state.defaultGroupPage.close();
        delete state.defaultGroupPage;
      `,
    })
    await fetch(`${SERVER_URL}/cli/session/delete`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ sessionId: created.id }),
    })
  }, 60000)

  it('supports an explicit tab group color on creation and color-only updates', async () => {
    const createResponse = await fetch(`${SERVER_URL}/cli/session/new`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ tabGroup: 'agent-colored', tabGroupColor: 'orange' }),
    })
    const created = (await createResponse.json()) as { id: string; tabGroup?: string | null; tabGroupColor?: string | null }
    expect(created.tabGroup).toBe('agent-colored')
    expect(created.tabGroupColor).toBe('orange')

    const result = await executeCli({
      sessionId: created.id,
      code: js`
        state.coloredPage = await context.newPage();
        await state.coloredPage.goto('about:blank');
        return context.pages().length;
      `,
    })
    expect(result.isError).toBeFalsy()

    const groups = await waitForGroups((g) => {
      return g.some((group) => group.title === 'agent-colored' && group.tabCount === 1)
    })
    expect(groups.find((g) => g.title === 'agent-colored')?.color).toBe('orange')

    // Color-only update: name stays, group recolors
    const updateResponse = await fetch(`${SERVER_URL}/cli/session/update`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ sessionId: created.id, tabGroupColor: 'pink' }),
    })
    const updated = (await updateResponse.json()) as {
      success: boolean
      tabGroup: string
      tabGroupColor?: string
      warning?: string
    }
    expect(updated.success).toBe(true)
    expect(updated.warning).toBeUndefined()
    expect(updated.tabGroup).toBe('agent-colored')
    expect(updated.tabGroupColor).toBe('pink')

    const recolored = await waitForGroups((g) => {
      return g.some((group) => group.title === 'agent-colored' && group.color === 'pink')
    })
    expect(recolored.find((g) => g.title === 'agent-colored')?.color).toBe('pink')

    await executeCli({
      sessionId: created.id,
      code: js`
        await state.coloredPage.close();
        delete state.coloredPage;
      `,
    })
    await fetch(`${SERVER_URL}/cli/session/delete`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ sessionId: created.id }),
    })
  }, 60000)

  it('recolors the default playwriter group via a color-only update', async () => {
    // Session on the default group; the manually toggled tab shares that group.
    const createResponse = await fetch(`${SERVER_URL}/cli/session/new`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    })
    const created = (await createResponse.json()) as { id: string }

    const result = await executeCli({
      sessionId: created.id,
      code: js`
        state.defaultColorPage = await context.newPage();
        await state.defaultColorPage.goto('about:blank');
        return context.pages().length;
      `,
    })
    expect(result.isError).toBeFalsy()

    await waitForGroups((g) => {
      return g.some((group) => group.title === 'playwriter' && group.tabCount >= 2)
    })

    const updateResponse = await fetch(`${SERVER_URL}/cli/session/update`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ sessionId: created.id, tabGroupColor: 'cyan' }),
    })
    const updated = (await updateResponse.json()) as { success: boolean; tabGroup: string; warning?: string }
    expect(updated.success).toBe(true)
    expect(updated.warning).toBeUndefined()
    expect(updated.tabGroup).toBe('playwriter')

    // The whole default group (session tab + toggled tab) turns cyan
    const recolored = await waitForGroups((g) => {
      return g.some((group) => group.title === 'playwriter' && group.color === 'cyan')
    })
    const defaultGroup = recolored.find((g) => g.title === 'playwriter')
    expect(defaultGroup?.color).toBe('cyan')
    expect(defaultGroup?.tabCount).toBe(2)

    await executeCli({
      sessionId: created.id,
      code: js`
        await state.defaultColorPage.close();
        delete state.defaultColorPage;
      `,
    })
    await fetch(`${SERVER_URL}/cli/session/delete`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ sessionId: created.id }),
    })
  }, 60000)

  it('a session without --tab-group uses the default group, not an existing custom one', async () => {
    const newSession = async (body: { tabGroup?: string }) => {
      const response = await fetch(`${SERVER_URL}/cli/session/new`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      })
      return ((await response.json()) as { id: string }).id
    }
    const custom = await newSession({ tabGroup: 'agent-iso' })
    const plain = await newSession({})

    const created = await executeCli({
      sessionId: custom,
      code: js`
        state.isoA = await context.newPage();
        state.isoB = await context.newPage();
      `,
    })
    expect(created.isError).toBeFalsy()
    await waitForGroups((g) => g.some((group) => group.title === 'agent-iso' && group.tabCount === 2))

    const plainResult = await executeCli({
      sessionId: plain,
      code: js`
        state.plainPage = await context.newPage();
        await state.plainPage.goto('about:blank');
      `,
    })
    expect(plainResult.isError).toBeFalsy()

    const groups = await waitForGroups((g) => g.some((group) => group.title === 'playwriter' && group.tabCount === 2))
    expect(groups.find((g) => g.title === 'agent-iso')?.tabCount).toBe(2)
    expect(groups.find((g) => g.title === 'playwriter')?.tabCount).toBe(2)
    const serviceWorker = await getExtensionServiceWorker(testCtx!.browserContext)
    const titles = await serviceWorker.evaluate(() => {
      return Array.from(globalThis.getExtensionState().tabs.values())
        .map((tab) => tab.groupTitle || 'playwriter')
        .sort()
    })
    expect(titles).toMatchInlineSnapshot(`
      [
        "agent-iso",
        "agent-iso",
        "playwriter",
        "playwriter",
      ]
    `)

    for (const sessionId of [custom, plain]) {
      await fetch(`${SERVER_URL}/cli/session/delete`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ sessionId, closeCreatedTabs: true }),
      })
    }
  }, 60000)

  it('deleting a session with closeCreatedTabs closes only its own tabs, not same-group tabs of other sessions', async () => {
    const newSession = async () => {
      const response = await fetch(`${SERVER_URL}/cli/session/new`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ tabGroup: 'agent-shared' }),
      })
      return ((await response.json()) as { id: string }).id
    }
    const first = await newSession()
    const second = await newSession()

    for (const sessionId of [first, second]) {
      const result = await executeCli({
        sessionId,
        code: js`
          state.ownPage = await context.newPage();
          await state.ownPage.goto('about:blank');
          state.popup = await Promise.all([
            state.ownPage.waitForEvent('popup'),
            state.ownPage.evaluate(() => { window.open('about:blank') }),
          ]).then(([popup]) => popup);
        `,
      })
      expect(result.isError).toBeFalsy()
    }
    const before = await waitForGroups((g) => g.some((group) => group.title === 'agent-shared' && group.tabCount === 4))
    expect(before.find((g) => g.title === 'agent-shared')?.tabCount).toBe(4)

    // a close from an older relay start (same id, other ownership key) is refused
    const staleResponse = await fetch(`${SERVER_URL}/cli/session/delete`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ sessionId: first, closeCreatedTabs: true, ownershipKey: `old-relay:${first}` }),
    })
    expect(staleResponse.status).toBe(409)

    const deleteResponse = await fetch(`${SERVER_URL}/cli/session/delete`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ sessionId: first, closeCreatedTabs: true }),
    })
    expect(await deleteResponse.json()).toEqual({ success: true })

    // first session's tab and its popup are closed, second session's two tabs stay
    const groups = await waitForGroups((g) => g.find((group) => group.title === 'agent-shared')?.tabCount === 2)
    expect(groups.find((g) => g.title === 'agent-shared')?.tabCount).toBe(2)
    const survivors = await executeCli({
      sessionId: second,
      code: js`
        return [state.ownPage.isClosed(), state.popup.isClosed()];
      `,
    })
    expect(survivors.text).toMatchInlineSnapshot(`"[return value] [ false, false ]"`)

    await fetch(`${SERVER_URL}/cli/session/delete`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ sessionId: second, closeCreatedTabs: true }),
    })
    const cleaned = await waitForGroups((g) => !g.some((group) => group.title === 'agent-shared'))
    expect(cleaned.some((g) => g.title === 'agent-shared')).toBe(false)
  }, 60000)
})

describe('Tab index', () => {
  const INDEX_PORT = 19973
  const INDEX_URL = `http://127.0.0.1:${INDEX_PORT}`
  let testCtx: TestContext | null = null
  let server: SimpleServer | null = null
  // Unique cwd so this file's activity log entries can be told apart from
  // other test files writing the same log in parallel
  fs.mkdirSync(`${process.cwd()}/tmp`, { recursive: true })
  const sessionCwd = fs.mkdtempSync(`${process.cwd()}/tmp/tabindex-cwd-`)
  const sessionIds: { a?: string; b?: string } = {}

  beforeAll(async () => {
    testCtx = await setupTestContext({ port: INDEX_PORT, tempDirPrefix: 'pw-tabindex-', toggleExtension: true })
    server = await createSimpleServer({
      routes: {
        '/console?from=a': '<title>Console</title><h1>console</h1>',
        '/console?from=b': '<title>Console</title><h1>console</h1>',
        '/other': '<title>Other</title><h1>other</h1>',
      },
    })
  }, 600000)

  afterAll(async () => {
    await server?.close()
    await cleanupTestContext(testCtx, null)
    testCtx = null
    fs.rmSync(sessionCwd, { recursive: true, force: true })
  })

  const newSession = async (): Promise<string> => {
    const response = await fetch(`${INDEX_URL}/cli/session/new`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ cwd: sessionCwd }),
    })
    const { id } = (await response.json()) as { id: string }
    return id
  }

  const execute = async ({ sessionId, code }: { sessionId: string; code: string }) => {
    const response = await fetch(`${INDEX_URL}/cli/execute`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ sessionId, code }),
    })
    return (await response.json()) as { text: string; isError: boolean }
  }

  const readTabs = async () => {
    const response = await fetch(`${INDEX_URL}/cli/tabs`)
    const { tabs } = (await response.json()) as { tabs: TabView[]; agents: AgentSummary[] }
    return tabs
      .filter((tab) => {
        return tab.url.startsWith(server!.baseUrl)
      })
      .map((tab) => {
        return `${tab.url.replace(server!.baseUrl, '')} opened=${tab.openedBy} used=${tab.lastUsedBy}`
      })
      .sort()
  }

  const stabilize = (text: string) => {
    return text
      .replaceAll(new URL(server!.baseUrl).host, 'HOST')
      .replaceAll(sessionCwd.split('/').at(-1)!, 'CWD')
      .replace(/just now|\d+s ago/g, 'RECENTLY')
  }

  it('records which session opened and last used each tab, and warns about duplicates', async () => {
    sessionIds.a = await newSession()
    sessionIds.b = await newSession()

    const first = await execute({
      sessionId: sessionIds.a,
      code: js`
        state.page = await context.newPage();
        await state.page.goto('${server!.baseUrl}/console?from=a');
      `,
    })
    expect(first.isError).toBeFalsy()
    expect(first.text).not.toContain('is open in')

    // Same path, different query: the same part of the UI
    const second = await execute({
      sessionId: sessionIds.b,
      code: js`
        state.page = await context.newPage();
        await state.page.goto('${server!.baseUrl}/console?from=b');
      `,
    })
    expect(second.isError).toBeFalsy()
    const warning = second.text.split('\n').find((line) => {
      return line.includes('is open in')
    })
    expect(stabilize(warning || '')).toMatchInlineSnapshot(`"[WARNING] HOST/console is open in 2 tabs: used by you RECENTLY; used by 1 (CWD) RECENTLY. Reuse an existing tab from context.pages() instead of opening another, and coordinate before driving a tab another agent is using. Run \`playwriter tabs\` to see all tabs."`)

    // Driving an existing tab without navigating never warns
    const click = await execute({
      sessionId: sessionIds.a,
      code: js`
        await state.page.click('h1');
        return await state.page.title();
      `,
    })
    expect(click.text).not.toContain('is open in')

    expect(await readTabs()).toMatchInlineSnapshot(`
      [
        "/console?from=a opened=1 used=1",
        "/console?from=b opened=2 used=2",
      ]
    `)
  }, 60000)

  it('lists MCP agents and the tabs they opened', async () => {
    const browser = await chromium.connectOverCDP(
      getCdpUrl({ port: INDEX_PORT, client: 'mcp', agentId: 'test01', agentLabel: 'tester', agentCwd: '/work/site' }),
    )
    const page = await browser.contexts()[0].newPage()
    await page.goto(`${server!.baseUrl}/other`)

    const response = await fetch(`${INDEX_URL}/cli/sessions`)
    const { sessions, agents } = (await response.json()) as {
      sessions: Array<{ id: string; tabCount: number; lastActivityAt: number | null }>
      agents: Array<AgentSummary & { tabCount: number }>
    }
    expect(
      agents.map((agent) => {
        return `${agent.key} label=${agent.label} cwd=${agent.cwd} tabs=${agent.tabCount} connected=${agent.connected}`
      }),
    ).toMatchInlineSnapshot(`
      [
        "mcp:test01 label=tester cwd=/work/site tabs=1 connected=true",
      ]
    `)
    expect(
      sessions
        .filter((session) => {
          return session.id === sessionIds.a || session.id === sessionIds.b
        })
        .map((session) => {
          return `${session.id} tabs=${session.tabCount} active=${session.lastActivityAt !== null}`
        }),
    ).toMatchInlineSnapshot(`
      [
        "1 tabs=1 active=true",
        "2 tabs=1 active=true",
      ]
    `)
    expect(await readTabs()).toMatchInlineSnapshot(`
      [
        "/console?from=a opened=1 used=1",
        "/console?from=b opened=2 used=2",
        "/other opened=mcp:test01 used=mcp:test01",
      ]
    `)

    await safeCloseCDPBrowser(browser)
  }, 60000)

  it('logs each execute call to the activity log without the code', async () => {
    const entries = fs
      .readFileSync(ACTIVITY_LOG_FILE_PATH, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        return JSON.parse(line) as ActivityEntry
      })
      .filter((entry) => {
        return entry.cwd === sessionCwd
      })
    expect(
      entries.map((entry) => {
        const navigated = entry.navigated.map((url) => {
          return url.replace(server!.baseUrl, '')
        })
        return `session=${entry.session} agent=${entry.agent} client=${entry.client} ok=${entry.ok} navigated=${navigated.join(',')}`
      }),
    ).toMatchInlineSnapshot(`
      [
        "session=1 agent=1 client=cli ok=true navigated=/console?from=a",
        "session=2 agent=2 client=cli ok=true navigated=/console?from=b",
        "session=1 agent=1 client=cli ok=true navigated=",
      ]
    `)
    expect(Object.keys(entries[0]).sort()).toMatchInlineSnapshot(`
      [
        "agent",
        "client",
        "cwd",
        "label",
        "ms",
        "navigated",
        "ok",
        "session",
        "time",
      ]
    `)
  })
})
