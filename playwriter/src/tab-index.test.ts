import { describe, expect, test } from 'vitest'
import {
  TabIndex,
  describeAgent,
  formatAgo,
  formatDuplicateWarning,
  isTabUseCommand,
  normalizeTabLocation,
  shortCwd,
  type AgentSummary,
  type TabTarget,
} from './tab-index.js'

const NOW = 1_800_000_000_000

function makeTargets(entries: Array<[targetId: string, url: string]>): TabTarget[] {
  return entries.map(([targetId, url]) => {
    return { targetId, url, title: `title ${targetId}`, extensionId: 'install:Chrome:abc' }
  })
}

const agents: AgentSummary[] = [
  { key: '3', kind: 'session', label: null, cwd: '/home/tk/GitHub/halfhour/.claude/worktrees/launch-plan', lastActivityAt: NOW, connected: true },
  { key: 'mcp:a1b2c3', kind: 'mcp', label: 'reviewer', cwd: 'C:\\Users\\me\\code\\site', lastActivityAt: NOW, connected: false },
]

describe('normalizeTabLocation', () => {
  test('keeps host and path, drops query, hash and trailing slash', () => {
    expect(
      [
        'https://play.google.com/console/app/123?tab=releases#top',
        'https://play.google.com/console/app/123/',
        'http://localhost:3000/',
        'https://example.com',
        'about:blank',
        'chrome://extensions',
        'not a url',
        '',
      ].map(normalizeTabLocation),
    ).toMatchInlineSnapshot(`
      [
        "play.google.com/console/app/123",
        "play.google.com/console/app/123",
        "localhost:3000",
        "example.com",
        null,
        null,
        null,
        null,
      ]
    `)
  })
})

describe('isTabUseCommand', () => {
  test('counts commands that drive a tab, not the setup Playwright sends to every tab', () => {
    expect(
      [
        'Page.navigate',
        'Input.dispatchMouseEvent',
        'DOM.getBoxModel',
        'Page.captureScreenshot',
        'Page.enable',
        'Runtime.enable',
        'Runtime.evaluate',
        'Target.setAutoAttach',
        'Emulation.setFocusEmulationEnabled',
      ].map((method) => {
        return `${method}: ${isTabUseCommand(method)}`
      }),
    ).toMatchInlineSnapshot(`
      [
        "Page.navigate: true",
        "Input.dispatchMouseEvent: true",
        "DOM.getBoxModel: true",
        "Page.captureScreenshot: true",
        "Page.enable: false",
        "Runtime.enable: false",
        "Runtime.evaluate: false",
        "Target.setAutoAttach: false",
        "Emulation.setFocusEmulationEnabled: false",
      ]
    `)
  })
})

describe('shortCwd and describeAgent', () => {
  test('shortens worktree and plain paths on both OSes', () => {
    expect(
      [
        '/home/tk/GitHub/halfhour/.claude/worktrees/launch-plan',
        'C:\\Users\\me\\GitHub\\site\\.claude\\worktrees\\fix-nav',
        '/home/tk/GitHub/bsky-alt/',
        null,
      ].map(shortCwd),
    ).toMatchInlineSnapshot(`
      [
        "halfhour/launch-plan",
        "site/fix-nav",
        "bsky-alt",
        null,
      ]
    `)
  })

  test('prefers the label, falls back to the short cwd, then the bare key', () => {
    expect(
      ['3', 'mcp:a1b2c3', 'mcp:unknown', null].map((key) => {
        return describeAgent({ key, agents })
      }),
    ).toMatchInlineSnapshot(`
      [
        "3 (halfhour/launch-plan)",
        "mcp:a1b2c3 (reviewer)",
        "mcp:unknown",
        "-",
      ]
    `)
  })
})

describe('formatAgo', () => {
  test('buckets elapsed time', () => {
    expect(
      [NOW - 2_000, NOW - 45_000, NOW - 5 * 60_000, NOW - 3 * 3_600_000, NOW - 72 * 3_600_000, null].map(
        (timestamp) => {
          return formatAgo({ timestamp, now: NOW })
        },
      ),
    ).toMatchInlineSnapshot(`
      [
        "just now",
        "45s ago",
        "5m ago",
        "3h ago",
        "3d ago",
        "-",
      ]
    `)
  })
})

describe('TabIndex', () => {
  test('tracks who opened and who last used each tab, most recent first', () => {
    const index = new TabIndex()
    index.recordTabOpened({ targetId: 'T1', agentKey: '3', now: NOW - 60_000 })
    index.recordTabOpened({ targetId: 'T2', agentKey: 'mcp:a1b2c3', now: NOW - 30_000 })
    index.recordTabUsed({ targetId: 'T1', agentKey: 'mcp:a1b2c3', now: NOW - 1_000 })
    // anonymous clients (no session, no agent id) never overwrite ownership
    index.recordTabUsed({ targetId: 'T2', agentKey: null, now: NOW })

    const tabs = index.listTabs({
      targets: makeTargets([
        ['T1', 'https://example.com/a'],
        ['T2', 'https://example.com/b'],
        ['T3', 'https://user-opened.example.com/'],
      ]),
    })
    expect(
      tabs.map((tab) => {
        return `${tab.targetId} opened=${tab.openedBy} used=${tab.lastUsedBy}`
      }),
    ).toMatchInlineSnapshot(`
      [
        "T1 opened=3 used=mcp:a1b2c3",
        "T2 opened=mcp:a1b2c3 used=mcp:a1b2c3",
        "T3 opened=null used=null",
      ]
    `)
  })

  test('reports duplicates only for locations the asking agent just drove', () => {
    const index = new TabIndex()
    const since = NOW - 10_000
    // session 3 has had the console open for a while
    index.recordTabOpened({ targetId: 'OLD', agentKey: '3', now: NOW - 120_000 })
    // the MCP agent just opened a second tab on the same page
    index.recordTabOpened({ targetId: 'NEW', agentKey: 'mcp:a1b2c3', now: NOW - 2_000 })
    index.recordTabUsed({ targetId: 'NEW', agentKey: 'mcp:a1b2c3', now: NOW - 1_000 })
    // session 3 navigated another page during the same window: not the MCP agent's doing
    index.recordTabUsed({ targetId: 'OTHER1', agentKey: '3', now: NOW - 5_000 })

    const targets = makeTargets([
      ['OLD', 'https://play.google.com/console/app/123?tab=a'],
      ['NEW', 'https://play.google.com/console/app/123/'],
      ['OTHER1', 'https://docs.example.com/page'],
      ['OTHER2', 'https://docs.example.com/page#intro'],
    ])
    const duplicates = index.findDuplicates({
      targets,
      agentKey: 'mcp:a1b2c3',
      since,
      urls: ['https://play.google.com/console/app/123/', 'https://docs.example.com/page', 'about:blank'],
    })
    expect(
      duplicates.map((group) => {
        return {
          location: group.location,
          tabs: group.tabs.map((tab) => {
            return tab.targetId
          }),
        }
      }),
    ).toMatchInlineSnapshot(`
      [
        {
          "location": "play.google.com/console/app/123",
          "tabs": [
            "NEW",
            "OLD",
          ],
        },
      ]
    `)

    expect(formatDuplicateWarning({ group: duplicates[0], agentKey: 'mcp:a1b2c3', agents, now: NOW }))
      .toMatchInlineSnapshot(`"play.google.com/console/app/123 is open in 2 tabs: "title NEW" used by you just now; "title OLD" used by 3 (halfhour/launch-plan) 2m ago. Reuse an existing tab from context.pages() instead of opening another, and coordinate before driving a tab another agent is using. Run \`playwriter tabs\` to see all tabs."`)
  })

  test('a single tab at a location is not a duplicate', () => {
    const index = new TabIndex()
    index.recordTabOpened({ targetId: 'T1', agentKey: '3', now: NOW })
    expect(
      index.findDuplicates({
        targets: makeTargets([['T1', 'https://example.com/']]),
        agentKey: '3',
        since: NOW - 1_000,
        urls: ['https://example.com/'],
      }),
    ).toEqual([])
  })

  test('prune keeps live tabs and connected agents, drops stale ones', () => {
    const index = new TabIndex()
    const longAgo = NOW - 2 * 60 * 60 * 1000
    index.upsertAgent({ key: 'mcp:gone', kind: 'mcp', now: longAgo })
    index.upsertAgent({ key: 'mcp:connected', kind: 'mcp', now: longAgo })
    index.upsertAgent({ key: 'mcp:recent', kind: 'mcp', now: NOW - 60_000 })
    index.recordTabOpened({ targetId: 'CLOSED_LONG_AGO', agentKey: '3', now: longAgo })
    // detached tabs survive briefly: the extension's service worker restarts often
    index.recordTabOpened({ targetId: 'DETACHED_RECENTLY', agentKey: '3', now: NOW - 60_000 })
    index.recordTabOpened({ targetId: 'LIVE', agentKey: '3', now: longAgo })

    index.prune({ liveTargetIds: new Set(['LIVE']), connectedAgentKeys: new Set(['mcp:connected']), now: NOW })
    expect({ tabs: [...index.tabs.keys()], agents: [...index.agents.keys()] }).toMatchInlineSnapshot(`
      {
        "agents": [
          "mcp:connected",
          "mcp:recent",
        ],
        "tabs": [
          "DETACHED_RECENTLY",
          "LIVE",
        ],
      }
    `)
  })
})
