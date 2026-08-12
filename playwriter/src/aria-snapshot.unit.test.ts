import { describe, expect, it } from 'vitest'
import type { Page } from '@xmorse/playwright-core'
import type { Protocol } from 'devtools-protocol'
import {
  buildRawSnapshotTree,
  buildSnapshotLines,
  ensureSnapshotDomainsEnabled,
  filterFullSnapshotTree,
  filterInteractiveSnapshotTree,
  finalizeSnapshotOutput,
  getAriaSnapshot,
  type SnapshotNode,
} from './aria-snapshot.js'
import type { ICDPSession } from './cdp-session.js'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

const nextTurn = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('aria-snapshot CDP setup', () => {
  it('keeps DOM enabled but re-enables accessibility for each snapshot', async () => {
    const calls: string[] = []
    const session = {
      send: async (method: string) => {
        calls.push(method)
        return {}
      },
    } as unknown as ICDPSession
    const page = {} as Page

    await ensureSnapshotDomainsEnabled({ cacheKey: page, session, sessionId: null })
    await ensureSnapshotDomainsEnabled({ cacheKey: page, session, sessionId: null })

    expect(calls).toEqual(['DOM.enable', 'Accessibility.enable', 'Accessibility.enable'])
  })

  it('coalesces concurrent DOM setup and retries it after rejection', async () => {
    const firstDomEnable = deferred<void>()
    let domEnableCalls = 0
    const session = {
      send: async (method: string) => {
        if (method === 'DOM.enable') {
          domEnableCalls += 1
          if (domEnableCalls === 1) {
            return await firstDomEnable.promise
          }
        }
        return {}
      },
    } as unknown as ICDPSession
    const cacheKey = {}

    const first = ensureSnapshotDomainsEnabled({ cacheKey, session, sessionId: null })
    const concurrent = ensureSnapshotDomainsEnabled({ cacheKey, session, sessionId: null })
    await nextTurn()
    expect(domEnableCalls).toBe(1)

    firstDomEnable.reject(new Error('setup failed'))
    await expect(first).rejects.toThrow('setup failed')
    await expect(concurrent).rejects.toThrow('setup failed')

    await ensureSnapshotDomainsEnabled({ cacheKey, session, sessionId: null })
    expect(domEnableCalls).toBe(2)
  })

  it('does not share DOM setup across explicit CDP session keys', async () => {
    const calls: string[] = []
    const createSession = (name: string) =>
      ({
        send: async (method: string) => {
          calls.push(`${name}:${method}`)
          return {}
        },
      }) as unknown as ICDPSession
    const firstSession = createSession('first')
    const secondSession = createSession('second')

    await ensureSnapshotDomainsEnabled({ cacheKey: firstSession, session: firstSession, sessionId: null })
    await ensureSnapshotDomainsEnabled({ cacheKey: secondSession, session: secondSession, sessionId: null })

    expect(calls).toEqual([
      'first:DOM.enable',
      'first:Accessibility.enable',
      'second:DOM.enable',
      'second:Accessibility.enable',
    ])
  })

  it('enables domains for each page and each temporary OOPIF session', async () => {
    const calls: string[] = []
    const session = {
      send: async (method: string, _params: unknown, sessionId: string | null) => {
        calls.push(`${sessionId ?? 'main'}:${method}`)
        return {}
      },
    } as unknown as ICDPSession
    const firstPage = {} as Page
    const secondPage = {} as Page

    await ensureSnapshotDomainsEnabled({ cacheKey: firstPage, session, sessionId: null })
    await ensureSnapshotDomainsEnabled({ cacheKey: secondPage, session, sessionId: null })
    await ensureSnapshotDomainsEnabled({ cacheKey: firstPage, session, sessionId: 'oopif-1' })
    await ensureSnapshotDomainsEnabled({ cacheKey: firstPage, session, sessionId: 'oopif-2' })

    expect(calls).toEqual([
      'main:DOM.enable',
      'main:Accessibility.enable',
      'main:DOM.enable',
      'main:Accessibility.enable',
      'oopif-1:DOM.enable',
      'oopif-1:Accessibility.enable',
      'oopif-2:DOM.enable',
      'oopif-2:Accessibility.enable',
    ])
  })

  it('requests the DOM and accessibility trees in parallel', async () => {
    const calls: string[] = []
    let resolveDom!: (value: unknown) => void
    let resolveAccessibility!: (value: unknown) => void
    const session = {
      send: async (method: string) => {
        calls.push(method)
        if (method === 'DOM.getFlattenedDocument') {
          return await new Promise((resolve) => {
            resolveDom = resolve
          })
        }
        if (method === 'Accessibility.getFullAXTree') {
          return await new Promise((resolve) => {
            resolveAccessibility = resolve
          })
        }
        return {}
      },
    } as unknown as ICDPSession
    const page = {} as Page

    const snapshotPromise = getAriaSnapshot({ page, cdp: session })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(calls).toContain('DOM.getFlattenedDocument')
    expect(calls).toContain('Accessibility.getFullAXTree')

    resolveAccessibility({ nodes: [] })
    await nextTurn()
    expect(calls.at(-1)).toBe('Accessibility.disable')

    resolveDom({ nodes: [] })
    await snapshotPromise
    expect(calls.at(-1)).toBe('Accessibility.disable')
  })

  it('waits for a pending AX capture before disabling after DOM failure', async () => {
    const calls: string[] = []
    const axCapture = deferred<unknown>()
    const session = {
      send: async (method: string) => {
        calls.push(method)
        if (method === 'DOM.getFlattenedDocument') {
          throw new Error('DOM capture failed')
        }
        if (method === 'Accessibility.getFullAXTree') {
          return await axCapture.promise
        }
        return {}
      },
    } as unknown as ICDPSession

    const snapshotPromise = getAriaSnapshot({ page: {} as Page, cdp: session })
    await nextTurn()
    expect(calls).not.toContain('Accessibility.disable')

    axCapture.resolve({ nodes: [] })
    await expect(snapshotPromise).rejects.toThrow('DOM capture failed')
    expect(calls.at(-1)).toBe('Accessibility.disable')
  })

  it('waits for a pending DOM capture before releasing after AX failure', async () => {
    const calls: string[] = []
    const domCapture = deferred<unknown>()
    const session = {
      send: async (method: string) => {
        calls.push(method)
        if (method === 'DOM.getFlattenedDocument') {
          return await domCapture.promise
        }
        if (method === 'Accessibility.getFullAXTree') {
          throw new Error('AX capture failed')
        }
        return {}
      },
    } as unknown as ICDPSession

    let settled = false
    const snapshotPromise = getAriaSnapshot({ page: {} as Page, cdp: session }).finally(() => {
      settled = true
    })
    await nextTurn()
    expect(calls).toContain('Accessibility.disable')
    expect(settled).toBe(false)

    domCapture.resolve({ nodes: [] })
    await expect(snapshotPromise).rejects.toThrow('AX capture failed')
    expect(settled).toBe(true)
  })

  it('serializes overlapping accessibility captures for the same page', async () => {
    const calls: string[] = []
    const firstAxCapture = deferred<unknown>()
    let axCaptureCount = 0
    const session = {
      send: async (method: string) => {
        calls.push(method)
        if (method === 'DOM.getFlattenedDocument') {
          return { nodes: [] }
        }
        if (method === 'Accessibility.getFullAXTree') {
          axCaptureCount += 1
          if (axCaptureCount === 1) {
            return await firstAxCapture.promise
          }
          return { nodes: [] }
        }
        return {}
      },
    } as unknown as ICDPSession
    const page = {} as Page

    const first = getAriaSnapshot({ page, cdp: session })
    await nextTurn()
    const second = getAriaSnapshot({ page, cdp: session })
    await nextTurn()
    expect(calls.filter((call) => call === 'Accessibility.enable')).toHaveLength(1)

    firstAxCapture.resolve({ nodes: [] })
    await first
    await second

    const accessibilityCalls = calls.filter((call) => call.startsWith('Accessibility.'))
    expect(accessibilityCalls).toEqual([
      'Accessibility.enable',
      'Accessibility.getFullAXTree',
      'Accessibility.disable',
      'Accessibility.enable',
      'Accessibility.getFullAXTree',
      'Accessibility.disable',
    ])
  })

  it('re-enables DOM once when a stale cache is detected during capture', async () => {
    const calls: string[] = []
    let captureAttempts = 0
    const session = {
      send: async (method: string) => {
        calls.push(method)
        if (method === 'DOM.getFlattenedDocument') {
          captureAttempts += 1
          if (captureAttempts === 1) {
            throw new Error("DOM agent hasn't been enabled")
          }
          return { nodes: [] }
        }
        if (method === 'Accessibility.getFullAXTree') {
          return { nodes: [] }
        }
        return {}
      },
    } as unknown as ICDPSession

    await getAriaSnapshot({ page: {} as Page, cdp: session })

    expect(calls.filter((call) => call === 'DOM.enable')).toHaveLength(2)
    expect(captureAttempts).toBe(2)
  })
})

const roleValue = (value: string): Protocol.Accessibility.AXValue => {
  return { type: 'role', value }
}

const nameValue = (value: string): Protocol.Accessibility.AXValue => {
  return { type: 'string', value }
}

describe('aria-snapshot tree filters', () => {
  it('builds a raw snapshot tree with scope pruning', () => {
    const rootId = '1' as Protocol.Accessibility.AXNodeId
    const mainId = '2' as Protocol.Accessibility.AXNodeId
    const navId = '3' as Protocol.Accessibility.AXNodeId
    const listId = '4' as Protocol.Accessibility.AXNodeId
    const listItemId = '5' as Protocol.Accessibility.AXNodeId
    const linkId = '6' as Protocol.Accessibility.AXNodeId
    const headingId = '7' as Protocol.Accessibility.AXNodeId
    const buttonId = '8' as Protocol.Accessibility.AXNodeId

    const axById = new Map<Protocol.Accessibility.AXNodeId, Protocol.Accessibility.AXNode>([
      [
        rootId,
        {
          nodeId: rootId,
          ignored: false,
          role: roleValue('rootwebarea'),
          childIds: [mainId, navId],
        },
      ],
      [
        mainId,
        {
          nodeId: mainId,
          ignored: false,
          role: roleValue('main'),
          childIds: [headingId, buttonId],
          backendDOMNodeId: 200 as Protocol.DOM.BackendNodeId,
        },
      ],
      [
        navId,
        {
          nodeId: navId,
          ignored: false,
          role: roleValue('navigation'),
          childIds: [listId],
          backendDOMNodeId: 201 as Protocol.DOM.BackendNodeId,
        },
      ],
      [
        listId,
        {
          nodeId: listId,
          ignored: false,
          role: roleValue('list'),
          childIds: [listItemId],
          backendDOMNodeId: 202 as Protocol.DOM.BackendNodeId,
        },
      ],
      [
        listItemId,
        {
          nodeId: listItemId,
          ignored: false,
          role: roleValue('listitem'),
          childIds: [linkId],
          backendDOMNodeId: 203 as Protocol.DOM.BackendNodeId,
        },
      ],
      [
        linkId,
        {
          nodeId: linkId,
          ignored: false,
          role: roleValue('link'),
          name: nameValue('Docs'),
          backendDOMNodeId: 204 as Protocol.DOM.BackendNodeId,
        },
      ],
      [
        headingId,
        {
          nodeId: headingId,
          ignored: false,
          role: roleValue('heading'),
          name: nameValue('Title'),
          backendDOMNodeId: 205 as Protocol.DOM.BackendNodeId,
        },
      ],
      [
        buttonId,
        {
          nodeId: buttonId,
          ignored: false,
          role: roleValue('button'),
          name: nameValue('Submit'),
          backendDOMNodeId: 206 as Protocol.DOM.BackendNodeId,
        },
      ],
    ])

    const allowed = new Set<Protocol.DOM.BackendNodeId>([204 as Protocol.DOM.BackendNodeId])
    const isNodeInScope = (node: Protocol.Accessibility.AXNode): boolean => {
      return Boolean(node.backendDOMNodeId && allowed.has(node.backendDOMNodeId))
    }

    const rawTree = buildRawSnapshotTree({ nodeId: rootId, axById, isNodeInScope })
    expect(rawTree).toMatchInlineSnapshot(`
      {
        "backendNodeId": undefined,
        "children": [
          {
            "backendNodeId": 201,
            "children": [
              {
                "backendNodeId": 202,
                "children": [
                  {
                    "backendNodeId": 203,
                    "children": [
                      {
                        "backendNodeId": 204,
                        "children": [],
                        "ignored": false,
                        "name": "Docs",
                        "role": "link",
                      },
                    ],
                    "ignored": false,
                    "name": "",
                    "role": "listitem",
                  },
                ],
                "ignored": false,
                "name": "",
                "role": "list",
              },
            ],
            "ignored": false,
            "name": "",
            "role": "navigation",
          },
        ],
        "ignored": false,
        "name": "",
        "role": "rootwebarea",
      }
    `)
  })

  it('filters interactive-only trees with labels and wrapper hoisting', () => {
    const rawTree: SnapshotNode = {
      role: 'main',
      name: '',
      ignored: false,
      children: [
        {
          role: 'navigation',
          name: '',
          ignored: false,
          children: [{ role: 'link', name: 'Home', backendNodeId: 2 as Protocol.DOM.BackendNodeId, children: [] }],
        },
        {
          role: 'labeltext',
          name: '',
          ignored: false,
          children: [{ role: 'statictext', name: 'Email', ignored: false, children: [] }],
        },
        {
          role: 'generic',
          name: '',
          ignored: false,
          children: [{ role: 'button', name: 'Save', backendNodeId: 1 as Protocol.DOM.BackendNodeId, children: [] }],
        },
        {
          role: 'generic',
          name: 'Wrapper',
          ignored: false,
          children: [
            { role: 'statictext', name: 'Wrapper', ignored: false, children: [] },
            { role: 'statictext', name: 'Hint', ignored: false, children: [] },
          ],
        },
        {
          role: 'generic',
          name: '',
          ignored: true,
          children: [
            { role: 'button', name: 'Ignored Action', backendNodeId: 3 as Protocol.DOM.BackendNodeId, children: [] },
          ],
        },
        { role: 'heading', name: 'Settings', ignored: false, children: [] },
      ],
    }

    const domByBackendId = new Map<
      Protocol.DOM.BackendNodeId,
      {
        nodeId: Protocol.DOM.NodeId
        parentId?: Protocol.DOM.NodeId
        backendNodeId: Protocol.DOM.BackendNodeId
        nodeName: string
        attributes: Map<string, string>
      }
    >([
      [
        1 as Protocol.DOM.BackendNodeId,
        {
          nodeId: 10 as Protocol.DOM.NodeId,
          backendNodeId: 1 as Protocol.DOM.BackendNodeId,
          nodeName: 'BUTTON',
          attributes: new Map([['id', 'save-btn']]),
        },
      ],
      [
        2 as Protocol.DOM.BackendNodeId,
        {
          nodeId: 11 as Protocol.DOM.NodeId,
          backendNodeId: 2 as Protocol.DOM.BackendNodeId,
          nodeName: 'A',
          attributes: new Map([['data-testid', 'nav-home']]),
        },
      ],
      [
        3 as Protocol.DOM.BackendNodeId,
        {
          nodeId: 12 as Protocol.DOM.NodeId,
          backendNodeId: 3 as Protocol.DOM.BackendNodeId,
          nodeName: 'BUTTON',
          attributes: new Map([['id', 'ignored-action']]),
        },
      ],
    ])

    let refCounter = 0
    const createRefForNode = (options: {
      backendNodeId?: Protocol.DOM.BackendNodeId
      role: string
      name: string
    }): string => {
      refCounter += 1
      return `${options.role}-${options.name}-${refCounter}`
    }

    const filtered = filterInteractiveSnapshotTree({
      node: rawTree,
      ancestorNames: [],
      labelContext: false,
      domByBackendId,
      createRefForNode,
    })

    expect(filtered).toMatchInlineSnapshot(`
      {
        "names": Set {
          "Home",
          "Email",
          "Save",
          "Ignored Action",
        },
        "nodes": [
          {
            "backendNodeId": undefined,
            "baseLocator": undefined,
            "children": [
              {
                "backendNodeId": undefined,
                "baseLocator": undefined,
                "children": [
                  {
                    "backendNodeId": 2,
                    "baseLocator": "[data-testid="nav-home"]",
                    "children": [],
                    "name": "Home",
                    "ref": "link-Home-1",
                    "role": "link",
                  },
                ],
                "name": "",
                "ref": undefined,
                "role": "navigation",
              },
              {
                "backendNodeId": undefined,
                "baseLocator": undefined,
                "children": [
                  {
                    "children": [],
                    "name": "Email",
                    "role": "text",
                  },
                ],
                "name": "",
                "ref": undefined,
                "role": "labeltext",
              },
              {
                "backendNodeId": 1,
                "baseLocator": "[id="save-btn"]",
                "children": [],
                "name": "Save",
                "ref": "button-Save-2",
                "role": "button",
              },
              {
                "backendNodeId": 3,
                "baseLocator": "[id="ignored-action"]",
                "children": [],
                "indentOffset": 1,
                "name": "Ignored Action",
                "ref": "button-Ignored Action-3",
                "role": "button",
              },
            ],
            "name": "",
            "ref": undefined,
            "role": "main",
          },
        ],
      }
    `)
  })

  it('generates locator output for full snapshot trees', () => {
    const rawTree: SnapshotNode = {
      role: 'form',
      name: 'Account',
      ignored: false,
      children: [
        { role: 'textbox', name: 'Email', backendNodeId: 2 as Protocol.DOM.BackendNodeId, children: [] },
        {
          role: 'group',
          name: '',
          ignored: false,
          children: [
            { role: 'button', name: 'Save', backendNodeId: 3 as Protocol.DOM.BackendNodeId, children: [] },
            { role: 'button', name: 'Save', backendNodeId: 4 as Protocol.DOM.BackendNodeId, children: [] },
          ],
        },
      ],
    }

    const domByBackendId = new Map<
      Protocol.DOM.BackendNodeId,
      {
        nodeId: Protocol.DOM.NodeId
        parentId?: Protocol.DOM.NodeId
        backendNodeId: Protocol.DOM.BackendNodeId
        nodeName: string
        attributes: Map<string, string>
      }
    >([
      [
        2 as Protocol.DOM.BackendNodeId,
        {
          nodeId: 20 as Protocol.DOM.NodeId,
          backendNodeId: 2 as Protocol.DOM.BackendNodeId,
          nodeName: 'INPUT',
          attributes: new Map([['data-testid', 'email-input']]),
        },
      ],
      [
        3 as Protocol.DOM.BackendNodeId,
        {
          nodeId: 21 as Protocol.DOM.NodeId,
          backendNodeId: 3 as Protocol.DOM.BackendNodeId,
          nodeName: 'BUTTON',
          attributes: new Map([['id', 'save-primary']]),
        },
      ],
      [
        4 as Protocol.DOM.BackendNodeId,
        {
          nodeId: 22 as Protocol.DOM.NodeId,
          backendNodeId: 4 as Protocol.DOM.BackendNodeId,
          nodeName: 'BUTTON',
          attributes: new Map([['id', 'save-secondary']]),
        },
      ],
    ])

    let refCounter = 0
    const createRefForNode = (): string => {
      refCounter += 1
      return `e${refCounter}`
    }

    const filtered = filterFullSnapshotTree({
      node: rawTree,
      ancestorNames: [],
      domByBackendId,
      createRefForNode,
    })

    const lines = buildSnapshotLines(filtered.nodes)
    const result = finalizeSnapshotOutput(lines, filtered.nodes, new Map())
    expect(result.snapshot).toMatchInlineSnapshot(`
      "- form "Account":
        - textbox "Email" [data-testid="email-input"]
        - button "Save" [id="save-primary"]
        - button "Save" [id="save-secondary"]"
    `)
    expect(result).toMatchInlineSnapshot(`
      {
        "snapshot": "- form "Account":
        - textbox "Email" [data-testid="email-input"]
        - button "Save" [id="save-primary"]
        - button "Save" [id="save-secondary"]",
        "tree": [
          {
            "backendNodeId": undefined,
            "children": [
              {
                "backendNodeId": 2,
                "children": [],
                "locator": "[data-testid="email-input"]",
                "name": "Email",
                "ref": "e1",
                "role": "textbox",
                "shortRef": "e1",
              },
              {
                "backendNodeId": 3,
                "children": [],
                "locator": "[id="save-primary"]",
                "name": "Save",
                "ref": "e2",
                "role": "button",
                "shortRef": "e2",
              },
              {
                "backendNodeId": 4,
                "children": [],
                "locator": "[id="save-secondary"]",
                "name": "Save",
                "ref": "e3",
                "role": "button",
                "shortRef": "e3",
              },
            ],
            "locator": undefined,
            "name": "Account",
            "ref": undefined,
            "role": "form",
            "shortRef": undefined,
          },
        ],
      }
    `)
  })

  it('drops redundant text and preserves named wrappers in full snapshots', () => {
    const rawTree: SnapshotNode = {
      role: 'section',
      name: 'Billing',
      ignored: false,
      children: [
        {
          role: 'generic',
          name: 'Card',
          ignored: false,
          children: [
            { role: 'statictext', name: 'Card', ignored: false, children: [] },
            { role: 'statictext', name: 'Card number', ignored: false, children: [] },
          ],
        },
      ],
    }

    const domByBackendId = new Map<
      Protocol.DOM.BackendNodeId,
      {
        nodeId: Protocol.DOM.NodeId
        parentId?: Protocol.DOM.NodeId
        backendNodeId: Protocol.DOM.BackendNodeId
        nodeName: string
        attributes: Map<string, string>
      }
    >()

    const createRefForNode = (): string | null => {
      return null
    }

    const filtered = filterFullSnapshotTree({
      node: rawTree,
      ancestorNames: [],
      domByBackendId,
      createRefForNode,
    })

    expect(filtered).toMatchInlineSnapshot(`
      {
        "names": Set {
          "Card",
          "Billing",
        },
        "nodes": [
          {
            "backendNodeId": undefined,
            "baseLocator": undefined,
            "children": [
              {
                "backendNodeId": undefined,
                "baseLocator": undefined,
                "children": [],
                "name": "Card",
                "ref": undefined,
                "role": "generic",
              },
            ],
            "name": "Billing",
            "ref": undefined,
            "role": "section",
          },
        ],
      }
    `)
  })

  it('respects refFilter in interactive-only snapshots', () => {
    const rawTree: SnapshotNode = {
      role: 'main',
      name: '',
      ignored: false,
      children: [
        { role: 'button', name: 'Delete', backendNodeId: 5 as Protocol.DOM.BackendNodeId, children: [] },
        { role: 'button', name: 'Save', backendNodeId: 6 as Protocol.DOM.BackendNodeId, children: [] },
      ],
    }

    const domByBackendId = new Map<
      Protocol.DOM.BackendNodeId,
      {
        nodeId: Protocol.DOM.NodeId
        parentId?: Protocol.DOM.NodeId
        backendNodeId: Protocol.DOM.BackendNodeId
        nodeName: string
        attributes: Map<string, string>
      }
    >([
      [
        5 as Protocol.DOM.BackendNodeId,
        {
          nodeId: 30 as Protocol.DOM.NodeId,
          backendNodeId: 5 as Protocol.DOM.BackendNodeId,
          nodeName: 'BUTTON',
          attributes: new Map([['id', 'delete']]),
        },
      ],
      [
        6 as Protocol.DOM.BackendNodeId,
        {
          nodeId: 31 as Protocol.DOM.NodeId,
          backendNodeId: 6 as Protocol.DOM.BackendNodeId,
          nodeName: 'BUTTON',
          attributes: new Map([['id', 'save']]),
        },
      ],
    ])

    let refCounter = 0
    const createRefForNode = (): string => {
      refCounter += 1
      return `e${refCounter}`
    }

    const filtered = filterInteractiveSnapshotTree({
      node: rawTree,
      ancestorNames: [],
      labelContext: false,
      domByBackendId,
      createRefForNode,
      refFilter: ({ name }) => name !== 'Delete',
    })

    expect(filtered).toMatchInlineSnapshot(`
      {
        "names": Set {
          "Save",
        },
        "nodes": [
          {
            "backendNodeId": undefined,
            "baseLocator": undefined,
            "children": [
              {
                "backendNodeId": 6,
                "baseLocator": "[id="save"]",
                "children": [],
                "name": "Save",
                "ref": "e1",
                "role": "button",
              },
            ],
            "name": "",
            "ref": undefined,
            "role": "main",
          },
        ],
      }
    `)
  })
})
