/**
 * Integration tests for per-session tab group names.
 * - `session new --tab-group` puts tabs created by that session in a custom group.
 * - Manually toggled tabs stay in the default 'playwriter' group.
 * - `/cli/session/update` renames the group and moves its tabs.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  setupTestContext,
  cleanupTestContext,
  getExtensionServiceWorker,
  type TestContext,
  js,
} from './test-utils.js'
import { startPlayWriterCDPRelayServer } from './cdp-relay.js'
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

  it('a session sees only its own tabs and popups plus toggled tabs, also after reconnecting', async () => {
    const newSession = async () => {
      const response = await fetch(`${SERVER_URL}/cli/session/new`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ tabGroup: 'agent-own' }),
      })
      return ((await response.json()) as { id: string }).id
    }
    const sessions = { first: await newSession(), second: await newSession() }
    const listPages = async (sessionId: string) => {
      const result = await executeCli({
        sessionId,
        code: js`return JSON.stringify((await Promise.all(context.pages().map((p) => p.title()))).sort())`,
      })
      expect(result.isError).toBeFalsy()
      return result.text.replace(`[return value] `, '')
    }

    for (const [name, sessionId] of Object.entries(sessions)) {
      const result = await executeCli({
        sessionId,
        code: js`
          state.ownPage = await context.newPage();
          await state.ownPage.goto('about:blank');
          await state.ownPage.evaluate(() => { document.title = '${name}' });
          const [popup] = await Promise.all([
            state.ownPage.waitForEvent('popup'),
            state.ownPage.evaluate(() => { window.open('about:blank') }),
          ]);
          await popup.evaluate(() => { document.title = '${name}-popup' });
        `,
      })
      expect(result.isError, result.text).toBeFalsy()
    }
    // the first session got the second session's tabs live, the second one on connect
    expect(await listPages(sessions.first)).toMatchInlineSnapshot(`"["","first","first-popup"]"`)
    expect(await listPages(sessions.second)).toMatchInlineSnapshot(`"["","second","second-popup"]"`)

    const switched = await fetch(`${SERVER_URL}/cli/session/update`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ sessionId: sessions.first, patchright: true }),
    })
    expect(switched.status).toBe(200)
    expect(await listPages(sessions.first)).toMatchInlineSnapshot(`"["","first","first-popup"]"`)

    // tabs of a deleted session become shared
    await fetch(`${SERVER_URL}/cli/session/delete`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ sessionId: sessions.second }),
    })
    const third = await newSession()
    expect(await listPages(third)).toMatchInlineSnapshot(`"["","second","second-popup"]"`)
    await executeCli({
      sessionId: third,
      code: js`
        for (const page of context.pages()) if ((await page.title()).startsWith('second')) await page.close();
      `,
    })

    for (const sessionId of [sessions.first, third]) {
      await fetch(`${SERVER_URL}/cli/session/delete`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ sessionId, closeCreatedTabs: true }),
      })
    }
  }, 90000)

  it('never reuses session ids across a relay restart', async () => {
    const createResponse = await fetch(`${SERVER_URL}/cli/session/new`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ tabGroup: 'agent-restart' }),
    })
    const { id: sessionId } = (await createResponse.json()) as { id: string }
    const before = await executeCli({
      sessionId,
      code: js`
        state.ownPage = await context.newPage();
        await state.ownPage.goto('about:blank');
      `,
    })
    expect(before.isError).toBeFalsy()
    await waitForGroups((g) => g.some((group) => group.title === 'agent-restart' && group.tabCount === 1))

    const serviceWorker = await getExtensionServiceWorker(testCtx!.browserContext)
    const waitForConnectionState = async (connected: boolean) => {
      await serviceWorker.evaluate(async (expected) => {
        while ((globalThis.getExtensionState().connectionState === 'connected') !== expected) {
          await new Promise((r) => setTimeout(r, 50))
        }
      }, connected)
    }
    testCtx!.relayServer.close()
    await waitForConnectionState(false)
    testCtx!.relayServer = await startPlayWriterCDPRelayServer({ port: TEST_PORT, sessionCounterFile: testCtx!.sessionCounterFile })
    await waitForConnectionState(true)

    const nextResponse = await fetch(`${SERVER_URL}/cli/session/new`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    })
    const { id: nextId } = (await nextResponse.json()) as { id: string }
    expect(Number(nextId)).toBeGreaterThan(Number(sessionId))

    // the stale id never runs in another agent's session
    const after = await executeCli({ sessionId, code: js`return 1` })
    expect(after.isError).toBe(true)
    expect(after.text.replace(`Session ${sessionId}`, 'Session N')).toMatchInlineSnapshot(`"Session N ended or was lost when the relay restarted. Run 'playwriter session new' to get a new one."`)

    await fetch(`${SERVER_URL}/cli/session/delete`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ sessionId: nextId }),
    })
    // tabs of the lost session stay open; close them so later tests start clean
    await serviceWorker.evaluate(async () => {
      const groups = await chrome.tabGroups.query({ title: 'agent-restart' })
      for (const group of groups) {
        const tabs = await chrome.tabs.query({ groupId: group.id })
        await chrome.tabs.remove(tabs.map((tab) => tab.id!))
      }
    })
  }, 60000)
})
