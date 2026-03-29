import { describe, test, expect } from 'vitest'
import type { Root } from 'mdast'
import { slugify, extractText, generateTocTree, flattenTocTree, type TocTreeNode } from './toc-tree.js'

/* ── helpers ─────────────────────────────────────────────────────────── */

/** Compact representation for snapshot readability: "level prefix label href" */
function formatFlat(items: ReturnType<typeof flattenTocTree>): string[] {
  return items.map((i) => {
    const prefix = i.prefix ? `${JSON.stringify(i.prefix)} ` : ''
    return `L${i.visualLevel} ${prefix}${i.label} (${i.href})`
  })
}

/** Build a minimal mdast Root from heading descriptors like [2, "Title"]. */
function buildMdast(headings: Array<[depth: number, text: string]>): Root {
  return {
    type: 'root',
    children: headings.map(([depth, text]) => {
      return {
        type: 'heading' as const,
        depth: depth as 1 | 2 | 3 | 4 | 5 | 6,
        children: [{ type: 'text' as const, value: text }],
      }
    }),
  }
}

/* ── slugify ─────────────────────────────────────────────────────────── */

describe('slugify', () => {
  test('lowercases and replaces spaces with hyphens', () => {
    expect(slugify('Getting Started')).toMatchInlineSnapshot(`"getting-started"`)
  })

  test('strips special characters', () => {
    expect(slugify('What is @playwriter?')).toMatchInlineSnapshot(`"what-is-playwriter"`)
  })

  test('collapses multiple hyphens', () => {
    expect(slugify('foo - - bar')).toMatchInlineSnapshot(`"foo-bar"`)
  })
})

/* ── extractText ─────────────────────────────────────────────────────── */

describe('extractText', () => {
  test('extracts from simple text nodes', () => {
    expect(extractText([{ type: 'text', value: 'hello world' }])).toMatchInlineSnapshot(`"hello world"`)
  })

  test('extracts from nested inline elements', () => {
    expect(
      extractText([
        { type: 'text', value: 'use ' },
        {
          type: 'emphasis',
          children: [{ type: 'text', value: 'page' }],
        },
        { type: 'text', value: ' object' },
      ]),
    ).toMatchInlineSnapshot(`"use page object"`)
  })
})

/* ── generateTocTree ─────────────────────────────────────────────────── */

describe('generateTocTree', () => {
  test('flat headings at same level become siblings', () => {
    const tree = generateTocTree(buildMdast([
      [2, 'Overview'],
      [2, 'Setup'],
      [2, 'API'],
    ]))
    expect(tree).toMatchInlineSnapshot(`
      [
        {
          "children": [],
          "href": "#overview",
          "label": "Overview",
          "type": "h2",
        },
        {
          "children": [],
          "href": "#setup",
          "label": "Setup",
          "type": "h2",
        },
        {
          "children": [],
          "href": "#api",
          "label": "API",
          "type": "h2",
        },
      ]
    `)
  })

  test('nested headings form parent-child tree', () => {
    const tree = generateTocTree(buildMdast([
      [2, 'Getting Started'],
      [3, 'Installation'],
      [3, 'Configuration'],
      [2, 'API Reference'],
      [3, 'Methods'],
      [4, 'execute()'],
    ]))
    expect(tree).toMatchInlineSnapshot(`
      [
        {
          "children": [
            {
              "children": [],
              "href": "#installation",
              "label": "Installation",
              "type": "h3",
            },
            {
              "children": [],
              "href": "#configuration",
              "label": "Configuration",
              "type": "h3",
            },
          ],
          "href": "#getting-started",
          "label": "Getting Started",
          "type": "h2",
        },
        {
          "children": [
            {
              "children": [
                {
                  "children": [],
                  "href": "#execute",
                  "label": "execute()",
                  "type": "h4",
                },
              ],
              "href": "#methods",
              "label": "Methods",
              "type": "h3",
            },
          ],
          "href": "#api-reference",
          "label": "API Reference",
          "type": "h2",
        },
      ]
    `)
  })

  test('skipped heading levels preserve depth', () => {
    const tree = generateTocTree(buildMdast([
      [2, 'Parent'],
      [4, 'Deep Child'],
      [3, 'Normal Child'],
    ]))
    expect(tree).toMatchInlineSnapshot(`
      [
        {
          "children": [
            {
              "children": [],
              "href": "#deep-child",
              "label": "Deep Child",
              "type": "h4",
            },
            {
              "children": [],
              "href": "#normal-child",
              "label": "Normal Child",
              "type": "h3",
            },
          ],
          "href": "#parent",
          "label": "Parent",
          "type": "h2",
        },
      ]
    `)
  })

  test('heading after deeper sibling pops back up', () => {
    const tree = generateTocTree(buildMdast([
      [2, 'A'],
      [3, 'A.1'],
      [4, 'A.1.a'],
      [2, 'B'],
    ]))
    expect(tree).toMatchInlineSnapshot(`
      [
        {
          "children": [
            {
              "children": [
                {
                  "children": [],
                  "href": "#a1a",
                  "label": "A.1.a",
                  "type": "h4",
                },
              ],
              "href": "#a1",
              "label": "A.1",
              "type": "h3",
            },
          ],
          "href": "#a",
          "label": "A",
          "type": "h2",
        },
        {
          "children": [],
          "href": "#b",
          "label": "B",
          "type": "h2",
        },
      ]
    `)
  })

  test('empty mdast produces empty tree', () => {
    const tree = generateTocTree({ type: 'root', children: [] })
    expect(tree).toMatchInlineSnapshot(`[]`)
  })

  test('ignores non-heading nodes', () => {
    const mdast: Root = {
      type: 'root',
      children: [
        { type: 'paragraph', children: [{ type: 'text', value: 'ignored' }] },
        { type: 'heading', depth: 2, children: [{ type: 'text', value: 'Heading' }] },
      ],
    }
    const tree = generateTocTree(mdast)
    expect(tree.length).toBe(1)
    expect(tree[0].label).toBe('Heading')
  })
})

/* ── flattenTocTree ──────────────────────────────────────────────────── */

describe('flattenTocTree', () => {
  test('single level headings — no prefixes', () => {
    const roots: TocTreeNode[] = [
      { label: 'A', href: '#a', type: 'h2', children: [] },
      { label: 'B', href: '#b', type: 'h2', children: [] },
      { label: 'C', href: '#c', type: 'h2', children: [] },
    ]
    const flat = flattenTocTree({ roots })
    expect(formatFlat(flat)).toMatchInlineSnapshot(`
      [
        "L0 A (#a)",
        "L0 B (#b)",
        "L0 C (#c)",
      ]
    `)
  })

  test('nested headings with correct prefixes', () => {
    const roots: TocTreeNode[] = [
      {
        label: 'Getting Started', href: '#getting-started', type: 'h3', children: [
          { label: 'Install', href: '#install', type: 'h4', children: [] },
          { label: 'Config', href: '#config', type: 'h4', children: [] },
        ],
      },
      {
        label: 'API', href: '#api', type: 'h3', children: [
          { label: 'Methods', href: '#methods', type: 'h4', children: [] },
        ],
      },
    ]
    const flat = flattenTocTree({ roots })
    expect(formatFlat(flat)).toMatchInlineSnapshot(`
      [
        "L1 "├─ " Getting Started (#getting-started)",
        "L2 "│ ├─ " Install (#install)",
        "L2 "│ └─ " Config (#config)",
        "L1 "└─ " API (#api)",
        "L2 "  └─ " Methods (#methods)",
      ]
    `)
  })

  test('page wrapping headings adds one depth level', () => {
    const roots: TocTreeNode[] = [{
      label: 'Docs', href: '/docs', type: 'page', children: [
        {
          label: 'Intro', href: '/docs#intro', type: 'h3', children: [
            { label: 'Background', href: '/docs#background', type: 'h4', children: [] },
          ],
        },
      ],
    }]
    const flat = flattenTocTree({ roots })
    expect(formatFlat(flat)).toMatchInlineSnapshot(`
      [
        "L0 Docs (/docs)",
        "L2 "└─ " Intro (/docs#intro)",
        "L3 "  └─ " Background (/docs#background)",
      ]
    `)
  })

  test('depth clamping — deeply nested pages flatten headings to level 3', () => {
    const roots: TocTreeNode[] = [{
      label: 'Docs', href: '/docs', type: 'page', children: [{
        label: 'Guides', href: '/guides', type: 'page', children: [{
          label: 'Auth', href: '/auth', type: 'page', children: [
            { label: 'Overview', href: '/auth#overview', type: 'h3', children: [] },
            {
              label: 'OAuth', href: '/auth#oauth', type: 'h4', children: [
                { label: 'Providers', href: '/auth#providers', type: 'h5', children: [] },
              ],
            },
          ],
        }],
      }],
    }]
    const flat = flattenTocTree({ roots })
    expect(formatFlat(flat)).toMatchInlineSnapshot(`
      [
        "L0 Docs (/docs)",
        "L1 "└─ " Guides (/guides)",
        "L2 "  └─ " Auth (/auth)",
        "L3 "    ├─ " Overview (/auth#overview)",
        "L3 "    ├─ " OAuth (/auth#oauth)",
        "L3 "    └─ " Providers (/auth#providers)",
      ]
    `)
  })

  test('mixed pages and headings at various depths', () => {
    const roots: TocTreeNode[] = [
      {
        label: 'Page A', href: '/a', type: 'page', children: [
          { label: 'Section 1', href: '/a#s1', type: 'h3', children: [] },
        ],
      },
      {
        label: 'Page B', href: '/b', type: 'page', children: [
          {
            label: 'Section 2', href: '/b#s2', type: 'h3', children: [
              { label: 'Detail', href: '/b#detail', type: 'h4', children: [] },
            ],
          },
        ],
      },
    ]
    const flat = flattenTocTree({ roots })
    expect(formatFlat(flat)).toMatchInlineSnapshot(`
      [
        "L0 Page A (/a)",
        "L2 "└─ " Section 1 (/a#s1)",
        "L0 Page B (/b)",
        "L2 "└─ " Section 2 (/b#s2)",
        "L3 "  └─ " Detail (/b#detail)",
      ]
    `)
  })

  test('parentHref and pageHref are set correctly', () => {
    const roots: TocTreeNode[] = [{
      label: 'Page', href: '/p', type: 'page', children: [
        {
          label: 'H2', href: '/p#h2', type: 'h3', children: [
            { label: 'H3', href: '/p#h3', type: 'h4', children: [] },
          ],
        },
      ],
    }]
    const flat = flattenTocTree({ roots })
    expect(flat.map((i) => {
      return { label: i.label, parentHref: i.parentHref, pageHref: i.pageHref }
    })).toMatchInlineSnapshot(`
      [
        {
          "label": "Page",
          "pageHref": "/p",
          "parentHref": null,
        },
        {
          "label": "H2",
          "pageHref": "/p",
          "parentHref": "/p",
        },
        {
          "label": "H3",
          "pageHref": "/p",
          "parentHref": "/p#h2",
        },
      ]
    `)
  })

  test('empty roots produce empty flat list', () => {
    expect(flattenTocTree({ roots: [] })).toMatchInlineSnapshot(`[]`)
  })

  test('skipped heading depths preserve visual level via type', () => {
    /* ## Parent → #### Deep Child (skips ###) */
    const roots: TocTreeNode[] = [{
      label: 'Parent', href: '#parent', type: 'h3', children: [
        { label: 'Deep Child', href: '#deep', type: 'h5', children: [] },
      ],
    }]
    const flat = flattenTocTree({ roots })
    expect(formatFlat(flat)).toMatchInlineSnapshot(`
      [
        "L1 "└─ " Parent (#parent)",
        "L3 "  └─ " Deep Child (#deep)",
      ]
    `)
  })
})

/* ── end-to-end: mdast → tree → flat ────────────────────────────────── */

describe('mdast → tree → flat pipeline', () => {
  test('typical markdown document', () => {
    const mdast = buildMdast([
      [2, 'Getting Started'],
      [3, 'Installation'],
      [3, 'Configuration'],
      [2, 'API'],
      [3, 'Methods'],
      [4, 'execute()'],
      [4, 'snapshot()'],
      [2, 'FAQ'],
    ])
    const tree = generateTocTree(mdast)
    const flat = flattenTocTree({ roots: tree })
    expect(formatFlat(flat)).toMatchInlineSnapshot(`
      [
        "L0 Getting Started (#getting-started)",
        "L1 "├─ " Installation (#installation)",
        "L1 "└─ " Configuration (#configuration)",
        "L0 API (#api)",
        "L1 "└─ " Methods (#methods)",
        "L2 "  ├─ " execute() (#execute)",
        "L2 "  └─ " snapshot() (#snapshot)",
        "L0 FAQ (#faq)",
      ]
    `)
  })

  test('skipped heading level in markdown', () => {
    const mdast = buildMdast([
      [2, 'Parent'],
      [4, 'Grandchild'],
      [3, 'Child'],
    ])
    const tree = generateTocTree(mdast)
    const flat = flattenTocTree({ roots: tree })
    expect(formatFlat(flat)).toMatchInlineSnapshot(`
      [
        "L0 Parent (#parent)",
        "L2 "└─ " Grandchild (#grandchild)",
        "L1 "└─ " Child (#child)",
      ]
    `)
  })
})
