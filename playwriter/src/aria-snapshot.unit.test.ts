import { describe, expect, it } from 'vitest'
import type { Protocol } from 'devtools-protocol'
import {
  buildRawSnapshotTree,
  buildSnapshotLines,
  filterFullSnapshotTree,
  filterInteractiveSnapshotTree,
  finalizeSnapshotOutput,
  type SnapshotNode,
} from './aria-snapshot.js'

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
