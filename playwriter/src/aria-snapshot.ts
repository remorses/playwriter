// Accessibility snapshot pipeline: build raw AX tree, filter to a
// tree (interactive-only, labels/contexts, wrapper hoisting, ignored
// indent preservation), then render lines and locators.
import type { Page, Locator, ElementHandle, Frame, FrameLocator } from '@xmorse/playwright-core'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Protocol } from 'devtools-protocol'
import { Sema } from 'async-sema'
import type { ICDPSession } from './cdp-session.js'
import { getCDPSessionForPage } from './cdp-session.js'

// Import sharp at module level - resolves to null if not available
const sharpPromise = import('sharp')
  .then((m) => {
    return m.default
  })
  .catch(() => {
    return null
  })

// ============================================================================
// Snapshot Format Types
// ============================================================================

export type SnapshotFormat = 'raw'

export const DEFAULT_SNAPSHOT_FORMAT: SnapshotFormat = 'raw'

// ============================================================================
// A11y Client Code Loading
// ============================================================================

let a11yClientCode: string | null = null

function getA11yClientCode(): string {
  if (a11yClientCode) {
    return a11yClientCode
  }
  const currentDir = path.dirname(fileURLToPath(import.meta.url))
  const a11yClientPath = path.join(currentDir, '..', 'dist', 'a11y-client.js')
  a11yClientCode = fs.readFileSync(a11yClientPath, 'utf-8')
  return a11yClientCode
}

async function ensureA11yClient(page: Page): Promise<void> {
  const hasA11y = await page.evaluate(() => !!(globalThis as any).__a11y)
  if (!hasA11y) {
    const code = getA11yClientCode()
    await page.evaluate(code)
  }
}

// ============================================================================
// Types
// ============================================================================

export interface AriaRef {
  role: string
  name: string
  ref: string
  shortRef: string
  backendNodeId?: Protocol.DOM.BackendNodeId
}

type AriaRefDraft = Omit<AriaRef, 'shortRef'> & { selector?: string }

export type AriaSnapshotNode = {
  role: string
  name: string
  locator?: string
  ref?: string
  shortRef?: string
  backendNodeId?: Protocol.DOM.BackendNodeId
  children: AriaSnapshotNode[]
}

export interface ScreenshotResult {
  path: string
  base64: string
  mimeType: 'image/jpeg'
  snapshot: string
  labelCount: number
}

export interface AriaSnapshotResult {
  snapshot: string
  tree: AriaSnapshotNode[]
  refs: AriaRef[]
  refToElement: Map<string, { role: string; name: string; shortRef: string }>
  refToSelector: Map<string, string>
  /**
   * Get a CSS selector for a ref. Use with page.locator().
   * For stable test IDs, returns [data-testid="..."] or [id="..."]
   * For fallback refs, returns a role-based selector.
   */
  getSelectorForRef: (ref: string) => string | null
  getRefsForLocators: (locators: Array<Locator | ElementHandle>) => Promise<Array<AriaRef | null>>
  getRefForLocator: (locator: Locator | ElementHandle) => Promise<AriaRef | null>
  getRefStringForLocator: (locator: Locator | ElementHandle) => Promise<string | null>
}

type LabelBox = {
  x: number
  y: number
  width: number
  height: number
}

type AriaLabel = {
  ref: string
  role: string
  box: LabelBox
}

export function buildShortRefMap({ refs }: { refs: Array<{ ref: string }> }): Map<string, string> {
  const map = new Map<string, string>()
  refs.forEach((entry, index) => {
    map.set(entry.ref, `e${index + 1}`)
  })
  return map
}

// Roles that represent interactive elements
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'combobox',
  'searchbox',
  'checkbox',
  'radio',
  'slider',
  'spinbutton',
  'switch',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'tab',
  'treeitem',
  'img',
  'video',
  'audio',
])

const LABEL_ROLES = new Set(['labeltext'])

const MAX_LABEL_POSITION_CONCURRENCY = 24
const BOX_MODEL_TIMEOUT_MS = 5000

const CONTEXT_ROLES = new Set([
  'navigation',
  'main',
  'contentinfo',
  'banner',
  'form',
  'section',
  'region',
  'list',
  'listitem',
  'table',
  'rowgroup',
  'row',
  'cell',
])

const SKIP_WRAPPER_ROLES = new Set(['generic', 'group', 'none', 'presentation'])

const TEST_ID_ATTRS = [
  'data-testid',
  'data-test-id',
  'data-test',
  'data-cy',
  'data-pw',
  'data-qa',
  'data-e2e',
  'data-automation-id',
]

type DomNodeInfo = {
  nodeId: Protocol.DOM.NodeId
  parentId?: Protocol.DOM.NodeId
  backendNodeId: Protocol.DOM.BackendNodeId
  nodeName: string
  attributes: Map<string, string>
}

function toAttributeMap(attributes?: string[]): Map<string, string> {
  const result = new Map<string, string>()
  if (!attributes) {
    return result
  }
  for (let i = 0; i < attributes.length; i += 2) {
    const name = attributes[i]
    const value = attributes[i + 1]
    if (name) {
      result.set(name, value ?? '')
    }
  }
  return result
}

function getStableRefFromAttributes(attributes: Map<string, string>): { value: string; attr: string } | null {
  // Test IDs first: they are explicitly placed by developers for automation
  // and more stable than id which is often auto-generated by frameworks
  for (const attr of TEST_ID_ATTRS) {
    const value = attributes.get(attr)
    if (value) {
      return { value, attr }
    }
  }
  const id = attributes.get('id')
  if (id) {
    return { value: id, attr: 'id' }
  }
  return null
}

function escapeLocatorValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function buildLocatorFromStable(stable: { value: string; attr: string }): string {
  const escaped = escapeLocatorValue(stable.value)
  return `[${stable.attr}="${escaped}"]`
}

function buildBaseLocator({
  role,
  name,
  stable,
}: {
  role: string
  name: string
  stable: { value: string; attr: string } | null
}): string {
  if (stable) {
    return buildLocatorFromStable(stable)
  }
  const trimmedName = name.trim()
  if (trimmedName.length > 0) {
    const escapedName = escapeLocatorValue(trimmedName)
    return `role=${role}[name="${escapedName}"]`
  }
  return `role=${role}`
}

function getAxValueString(value?: Protocol.Accessibility.AXValue): string {
  if (!value) {
    return ''
  }
  const raw = value.value
  if (typeof raw === 'string') {
    return raw
  }
  if (raw === undefined || raw === null) {
    return ''
  }
  return String(raw)
}

function getAxRole(node: Protocol.Accessibility.AXNode): string {
  const role = getAxValueString(node.role)
  return role.toLowerCase()
}

export type SnapshotLine = {
  text: string
  baseLocator?: string
  hasChildren?: boolean
  role?: string
  name?: string
  indent?: number
}

export type SnapshotNode = {
  role: string
  name: string
  baseLocator?: string
  ref?: string
  backendNodeId?: Protocol.DOM.BackendNodeId
  indentOffset?: number
  ignored?: boolean
  children: SnapshotNode[]
}

function buildSnapshotLine({
  role,
  name,
  baseLocator,
  indent,
  hasChildren,
}: {
  role: string
  name: string
  baseLocator?: string
  indent: number
  hasChildren: boolean
}): SnapshotLine {
  const prefix = '  '.repeat(indent)
  let text = `${prefix}- ${role}`
  if (name) {
    const escapedName = name.replace(/"/g, '\\"')
    text += ` "${escapedName}"`
  }
  return { text, baseLocator, hasChildren, role, name, indent }
}

function buildTextLine(text: string, indent: number): SnapshotLine {
  const prefix = '  '.repeat(indent)
  const escaped = text.replace(/"/g, '\\"')
  return { text: `${prefix}- text: "${escaped}"` }
}

export function buildSnapshotLines(nodes: SnapshotNode[], indent = 0): SnapshotLine[] {
  return nodes.flatMap((node) => {
    const nodeIndent = indent + (node.indentOffset ?? 0)
    const line =
      node.role === 'text'
        ? buildTextLine(node.name, nodeIndent)
        : buildSnapshotLine({
            role: node.role,
            name: node.name,
            baseLocator: node.baseLocator,
            indent: nodeIndent,
            hasChildren: node.children.length > 0,
          })
    return [line, ...buildSnapshotLines(node.children, nodeIndent + 1)]
  })
}

function shiftIndent(nodes: SnapshotNode[], offset: number): SnapshotNode[] {
  return nodes.map((node) => {
    return { ...node, indentOffset: (node.indentOffset ?? 0) + offset }
  })
}

export function buildRawSnapshotTree(options: {
  nodeId: Protocol.Accessibility.AXNodeId
  axById: Map<Protocol.Accessibility.AXNodeId, Protocol.Accessibility.AXNode>
  isNodeInScope: (node: Protocol.Accessibility.AXNode) => boolean
}): SnapshotNode | null {
  const node = options.axById.get(options.nodeId)
  if (!node) {
    return null
  }

  const role = getAxRole(node)
  const name = getAxValueString(node.name).trim()
  const children = (node.childIds ?? [])
    .map((childId) => {
      return buildRawSnapshotTree({
        nodeId: childId,
        axById: options.axById,
        isNodeInScope: options.isNodeInScope,
      })
    })
    .filter(isTruthy)

  const inScope = options.isNodeInScope(node) || children.length > 0
  if (!inScope) {
    return null
  }

  return {
    role,
    name,
    backendNodeId: node.backendDOMNodeId,
    ignored: node.ignored,
    children,
  }
}

export function filterInteractiveSnapshotTree(options: {
  node: SnapshotNode
  ancestorNames: string[]
  labelContext: boolean
  refFilter?: (entry: { role: string; name: string }) => boolean
  domByBackendId: Map<Protocol.DOM.BackendNodeId, DomNodeInfo>
  createRefForNode: (options: {
    backendNodeId?: Protocol.DOM.BackendNodeId
    role: string
    name: string
  }) => string | null
}): { nodes: SnapshotNode[]; names: Set<string> } {
  const role = options.node.role
  const name = options.node.name
  const hasName = name.length > 0
  const nextAncestors = hasName ? [...options.ancestorNames, name] : options.ancestorNames

  const isLabel = LABEL_ROLES.has(role)
  const nextLabelContext = options.labelContext || isLabel

  const childResults = options.node.children.map((child) => {
    return filterInteractiveSnapshotTree({
      node: child,
      ancestorNames: nextAncestors,
      labelContext: nextLabelContext,
      refFilter: options.refFilter,
      domByBackendId: options.domByBackendId,
      createRefForNode: options.createRefForNode,
    })
  })
  const childNodes = childResults.flatMap((result) => {
    return result.nodes
  })
  const childNames = childResults.reduce((acc, result) => {
    result.names.forEach((childName) => {
      acc.add(childName)
    })
    return acc
  }, new Set<string>())

  if (options.node.ignored) {
    return { nodes: shiftIndent(childNodes, 1), names: childNames }
  }

  if (isTextRole(role)) {
    if (!hasName) {
      return { nodes: childNodes, names: childNames }
    }
    if (!options.labelContext) {
      return { nodes: childNodes, names: childNames }
    }
    const isRedundantText = options.ancestorNames.some((ancestor) => {
      return ancestor.includes(name) || name.includes(ancestor)
    })
    if (isRedundantText) {
      return { nodes: childNodes, names: childNames }
    }
    const names = new Set(childNames)
    names.add(name)
    const textNode: SnapshotNode = { role: 'text', name, children: [] }
    return { nodes: [textNode], names }
  }

  const hasChildren = childNodes.length > 0
  const nameToUse = hasName && (childNames.has(name) || isSubstringOfAny(name, childNames)) ? '' : name
  const hasNameToUse = nameToUse.length > 0
  const isWrapper = SKIP_WRAPPER_ROLES.has(role)
  const isInteractive = INTERACTIVE_ROLES.has(role)
  const isContext = CONTEXT_ROLES.has(role)
  const passesRefFilter = !options.refFilter || options.refFilter({ role, name })
  const includeInteractive = isInteractive && passesRefFilter
  const shouldInclude = includeInteractive || isLabel || isContext || hasChildren
  if (!shouldInclude) {
    return { nodes: childNodes, names: childNames }
  }

  if (!includeInteractive && !isLabel && !isContext) {
    if (!hasChildren) {
      return { nodes: [], names: childNames }
    }
    return { nodes: childNodes, names: childNames }
  }

  if (isWrapper && !hasNameToUse) {
    if (!hasChildren) {
      return { nodes: [], names: childNames }
    }
    return { nodes: childNodes, names: childNames }
  }

  let baseLocator: string | undefined
  let ref: string | null = null
  if (includeInteractive) {
    const domInfo = options.node.backendNodeId ? options.domByBackendId.get(options.node.backendNodeId) : undefined
    const stable = domInfo ? getStableRefFromAttributes(domInfo.attributes) : null
    baseLocator = buildBaseLocator({ role, name, stable })
    ref = options.createRefForNode({ backendNodeId: options.node.backendNodeId, role, name })
  }

  const nodeEntry: SnapshotNode = {
    role,
    name: nameToUse,
    baseLocator,
    ref: ref ?? undefined,
    backendNodeId: options.node.backendNodeId,
    children: childNodes,
  }
  const names = new Set(childNames)
  if (hasNameToUse) {
    names.add(nameToUse)
  }
  return { nodes: [nodeEntry], names }
}

export function filterFullSnapshotTree(options: {
  node: SnapshotNode
  ancestorNames: string[]
  refFilter?: (entry: { role: string; name: string }) => boolean
  domByBackendId: Map<Protocol.DOM.BackendNodeId, DomNodeInfo>
  createRefForNode: (options: {
    backendNodeId?: Protocol.DOM.BackendNodeId
    role: string
    name: string
  }) => string | null
}): { nodes: SnapshotNode[]; names: Set<string> } {
  const role = options.node.role
  const name = options.node.name
  const hasName = name.length > 0
  const nextAncestors = hasName ? [...options.ancestorNames, name] : options.ancestorNames

  const childResults = options.node.children.map((child) => {
    return filterFullSnapshotTree({
      node: child,
      ancestorNames: nextAncestors,
      refFilter: options.refFilter,
      domByBackendId: options.domByBackendId,
      createRefForNode: options.createRefForNode,
    })
  })
  const childNodes = childResults.flatMap((result) => {
    return result.nodes
  })
  const childNames = childResults.reduce((acc, result) => {
    result.names.forEach((childName) => {
      acc.add(childName)
    })
    return acc
  }, new Set<string>())

  if (options.node.ignored) {
    return { nodes: shiftIndent(childNodes, 1), names: childNames }
  }

  if (isTextRole(role)) {
    if (!hasName) {
      return { nodes: childNodes, names: childNames }
    }
    const isRedundantText = options.ancestorNames.some((ancestor) => {
      return ancestor.includes(name) || name.includes(ancestor)
    })
    if (isRedundantText) {
      return { nodes: childNodes, names: childNames }
    }
    const names = new Set(childNames)
    names.add(name)
    const textNode: SnapshotNode = { role: 'text', name, children: [] }
    return { nodes: [textNode], names }
  }

  const hasChildren = childNodes.length > 0
  const nameToUse = hasName && (childNames.has(name) || isSubstringOfAny(name, childNames)) ? '' : name
  const hasNameToUse = nameToUse.length > 0
  const isWrapper = SKIP_WRAPPER_ROLES.has(role)
  const isInteractive = INTERACTIVE_ROLES.has(role)
  const passesRefFilter = !options.refFilter || options.refFilter({ role, name })
  const includeInteractive = isInteractive && passesRefFilter
  const shouldInclude = includeInteractive || hasNameToUse || hasChildren
  if (!shouldInclude) {
    return { nodes: childNodes, names: childNames }
  }

  if (isWrapper && !hasNameToUse) {
    if (!hasChildren) {
      return { nodes: [], names: childNames }
    }
    return { nodes: childNodes, names: childNames }
  }

  let baseLocator: string | undefined
  let ref: string | null = null
  if (includeInteractive) {
    const domInfo = options.node.backendNodeId ? options.domByBackendId.get(options.node.backendNodeId) : undefined
    const stable = domInfo ? getStableRefFromAttributes(domInfo.attributes) : null
    baseLocator = buildBaseLocator({ role, name, stable })
    ref = options.createRefForNode({ backendNodeId: options.node.backendNodeId, role, name })
  }

  const nodeEntry: SnapshotNode = {
    role,
    name: nameToUse,
    baseLocator,
    ref: ref ?? undefined,
    backendNodeId: options.node.backendNodeId,
    children: childNodes,
  }
  const names = new Set(childNames)
  if (hasNameToUse) {
    names.add(nameToUse)
  }
  return { nodes: [nodeEntry], names }
}

function buildLocatorLineText({ line, locator }: { line: SnapshotLine; locator: string }): string {
  const prefix = '  '.repeat(line.indent ?? 0)
  const role = line.role ?? ''
  const name = line.name ?? ''
  const escapedName = name.replace(/"/g, '\\"')

  const hasRoleInLocator = role ? locator.includes(role) : false
  const hasNameInLocator = name ? locator.includes(escapedName) : false

  const parts: string[] = []
  if (role && !hasRoleInLocator) {
    parts.push(role)
  }
  if (name && !hasNameInLocator) {
    parts.push(`"${escapedName}"`)
  }

  const base = parts.length > 0 ? `${prefix}- ${parts.join(' ')}` : `${prefix}-`
  return `${base} ${locator}`
}

export function finalizeSnapshotOutput(
  lines: SnapshotLine[],
  nodes: SnapshotNode[],
  shortRefMap: Map<string, string>,
): { snapshot: string; tree: AriaSnapshotNode[] } {
  const locatorCounts = lines.reduce<Map<string, number>>((acc, line) => {
    if (!line.baseLocator) {
      return acc
    }
    acc.set(line.baseLocator, (acc.get(line.baseLocator) ?? 0) + 1)
    return acc
  }, new Map<string, number>())

  const locatorIndices = new Map<string, number>()
  const locatorSequence = lines.reduce<string[]>((acc, line) => {
    if (!line.baseLocator) {
      return acc
    }
    const count = locatorCounts.get(line.baseLocator) ?? 0
    const index = locatorIndices.get(line.baseLocator) ?? 0
    locatorIndices.set(line.baseLocator, index + 1)
    const locator = count > 1 ? `${line.baseLocator} >> nth=${index}` : line.baseLocator
    acc.push(locator)
    return acc
  }, [])

  let lineLocatorIndex = 0
  const snapshot = lines
    .map((line) => {
      let text = line.text
      if (line.baseLocator) {
        const locator = locatorSequence[lineLocatorIndex]
        lineLocatorIndex += 1
        text = buildLocatorLineText({ line, locator })
      }
      if (line.hasChildren) {
        text += ':'
      }
      return text
    })
    .join('\n')

  let nodeLocatorIndex = 0
  const applyLocators = (items: SnapshotNode[]): AriaSnapshotNode[] => {
    return items.map((item) => {
      const locator = item.baseLocator ? locatorSequence[nodeLocatorIndex++] : undefined
      const children = applyLocators(item.children)
      return {
        role: item.role,
        name: item.name,
        locator,
        ref: item.ref,
        shortRef: item.ref ? (shortRefMap.get(item.ref) ?? item.ref) : undefined,
        backendNodeId: item.backendNodeId,
        children,
      }
    })
  }

  return { snapshot, tree: applyLocators(nodes) }
}

function buildDomIndex(nodes: Protocol.DOM.Node[]): {
  domById: Map<Protocol.DOM.NodeId, DomNodeInfo>
  domByBackendId: Map<Protocol.DOM.BackendNodeId, DomNodeInfo>
  childrenByParent: Map<Protocol.DOM.NodeId, Protocol.DOM.NodeId[]>
} {
  const domById = new Map<Protocol.DOM.NodeId, DomNodeInfo>()
  const domByBackendId = new Map<Protocol.DOM.BackendNodeId, DomNodeInfo>()
  const childrenByParent = new Map<Protocol.DOM.NodeId, Protocol.DOM.NodeId[]>()

  for (const node of nodes) {
    const info: DomNodeInfo = {
      nodeId: node.nodeId,
      parentId: node.parentId,
      backendNodeId: node.backendNodeId,
      nodeName: node.nodeName,
      attributes: toAttributeMap(node.attributes),
    }
    domById.set(node.nodeId, info)
    domByBackendId.set(node.backendNodeId, info)
    if (node.parentId) {
      if (!childrenByParent.has(node.parentId)) {
        childrenByParent.set(node.parentId, [])
      }
      childrenByParent.get(node.parentId)!.push(node.nodeId)
    }
  }

  return { domById, domByBackendId, childrenByParent }
}

function findScopeRootNodeId(
  nodes: Protocol.DOM.Node[],
  attrName: string,
  attrValue: string,
): Protocol.DOM.NodeId | null {
  for (const node of nodes) {
    if (!node.attributes) {
      continue
    }
    for (let i = 0; i < node.attributes.length; i += 2) {
      const name = node.attributes[i]
      const value = node.attributes[i + 1]
      if (name === attrName && value === attrValue) {
        return node.nodeId
      }
    }
  }
  return null
}

function buildBackendIdSet(
  rootNodeId: Protocol.DOM.NodeId,
  childrenByParent: Map<Protocol.DOM.NodeId, Protocol.DOM.NodeId[]>,
  domById: Map<Protocol.DOM.NodeId, DomNodeInfo>,
): Set<Protocol.DOM.BackendNodeId> {
  const result = new Set<Protocol.DOM.BackendNodeId>()
  const stack: Protocol.DOM.NodeId[] = [rootNodeId]
  while (stack.length > 0) {
    const current = stack.pop()
    if (current === undefined) {
      continue
    }
    const node = domById.get(current)
    if (node) {
      result.add(node.backendNodeId)
    }
    const children = childrenByParent.get(current)
    if (children && children.length > 0) {
      stack.push(...children)
    }
  }
  return result
}

function isTextRole(role: string): boolean {
  return role === 'statictext' || role === 'inlinetextbox'
}

function isSubstringOfAny(needle: string, haystack: Set<string>): boolean {
  for (const str of haystack) {
    if (str.includes(needle)) {
      return true
    }
  }
  return false
}

// ============================================================================
// Frame Resolution
// ============================================================================

/**
 * Resolve a FrameLocator to an actual Frame object. FrameLocator (returned by
 * locator.contentFrame()) is a scoping helper that doesn't have CDP methods like
 * frameId(). We need the real Frame from page.frames() for OOPIF session attachment.
 *
 * If a Frame is passed directly, it's returned as-is.
 * If a FrameLocator is passed, we find the matching Frame by locating the iframe
 * element and matching its src URL against page.frames().
 */
async function resolveFrame({ frame, page }: { frame?: Frame | FrameLocator; page: Page }): Promise<Frame | undefined> {
  if (!frame) {
    return undefined
  }
  // Frame has frameId(), FrameLocator does not
  if (typeof (frame as Frame).frameId === 'function') {
    return frame as Frame
  }
  // It's a FrameLocator — resolve to a Frame via the owner iframe element.
  // Use elementHandle().contentFrame() which returns the actual Frame object
  // directly from the <iframe> element, avoiding ambiguity when multiple
  // frames share the same origin (e.g. framer plugin iframes).
  const frameLocator = frame as FrameLocator
  const owner = frameLocator.owner()
  const handle = await owner.elementHandle()
  if (!handle) {
    throw new Error('Could not resolve FrameLocator to a Frame: iframe element not found')
  }
  const resolved = await handle.contentFrame()
  if (!resolved) {
    throw new Error('Could not resolve FrameLocator to a Frame: contentFrame() returned null')
  }
  return resolved
}

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Get an accessibility snapshot with utilities to look up refs for elements.
 * Uses the browser accessibility tree (CDP) and maps nodes to DOM attributes.
 *
 * Refs are generated from stable test IDs when available (data-testid, data-test-id, etc.)
 * or fall back to e1, e2, e3...
 *
 * @param page - Playwright page
 * @param locator - Optional locator to scope the snapshot to a subtree
 * @param refFilter - Optional filter for which elements get refs
 *
 * @example
 * ```ts
 * const { snapshot, getSelectorForRef } = await getAriaSnapshot({ page })
 * // Snapshot shows locators like [id="submit-btn"] or role=button[name="Submit"]
 * const selector = getSelectorForRef('submit-btn')
 * await page.locator(selector).click()
 * ```
 */
export async function getAriaSnapshot({
  page,
  frame,
  locator,
  refFilter,
  interactiveOnly = false,
  cdp,
}: {
  page: Page
  frame?: Frame | FrameLocator
  locator?: Locator
  refFilter?: (info: { role: string; name: string }) => boolean
  interactiveOnly?: boolean
  cdp?: ICDPSession
}): Promise<AriaSnapshotResult> {
  const session = cdp || (await getCDPSessionForPage({ page }))

  // Resolve FrameLocator to an actual Frame. FrameLocator (from locator.contentFrame())
  // is a scoping helper without CDP access. We need the real Frame from page.frames()
  // which has frameId() for OOPIF session attachment.
  const resolvedFrame = await resolveFrame({ frame, page })

  // For cross-origin iframes (OOPIFs), we need to attach to the iframe's target
  // to get a separate CDP session. Same-origin iframes can use frameId directly.
  let oopifSessionId: string | null = null
  const frameId = resolvedFrame?.frameId() ?? null

  if (frameId) {
    const { targetInfos } = (await session.send('Target.getTargets')) as Protocol.Target.GetTargetsResponse
    const frameUrl = resolvedFrame!.url()
    const iframeTarget = targetInfos.find((t) => {
      return t.type === 'iframe' && t.url === frameUrl
    })
    if (iframeTarget) {
      const { sessionId } = (await session.send('Target.attachToTarget', {
        targetId: iframeTarget.targetId,
        flatten: true,
      })) as Protocol.Target.AttachToTargetResponse
      oopifSessionId = sessionId
      await session.send('Runtime.runIfWaitingForDebugger', undefined, oopifSessionId)
    }
  }

  await session.send('DOM.enable', undefined, oopifSessionId)
  await session.send('Accessibility.enable', undefined, oopifSessionId)
  const scopeAttr = 'data-pw-scope'
  const scopeValue = crypto.randomUUID()
  let scopeApplied = false
  const scopeLocator = locator

  try {
    if (scopeLocator) {
      await scopeLocator.evaluate(
        (element, data) => {
          element.setAttribute(data.attr, data.value)
        },
        { attr: scopeAttr, value: scopeValue },
      )
      scopeApplied = true
    }

    const { nodes: domNodes } = (await session.send(
      'DOM.getFlattenedDocument',
      { depth: -1, pierce: true },
      oopifSessionId,
    )) as Protocol.DOM.GetFlattenedDocumentResponse
    const { domById, domByBackendId, childrenByParent } = buildDomIndex(domNodes)

    let scopeRootNodeId: Protocol.DOM.NodeId | null = null
    let scopeRootBackendId: Protocol.DOM.BackendNodeId | null = null
    if (scopeLocator) {
      scopeRootNodeId = findScopeRootNodeId(domNodes, scopeAttr, scopeValue)
      if (scopeRootNodeId) {
        const scopeNode = domById.get(scopeRootNodeId)
        if (scopeNode) {
          scopeRootBackendId = scopeNode.backendNodeId
        }
      }
    }

    const allowedBackendIds = scopeRootNodeId ? buildBackendIdSet(scopeRootNodeId, childrenByParent, domById) : null

    const axParams = !oopifSessionId && frameId ? { frameId } : undefined
    const { nodes: axNodes } = (await session.send(
      'Accessibility.getFullAXTree',
      axParams,
      oopifSessionId,
    )) as Protocol.Accessibility.GetFullAXTreeResponse

    const axById = new Map<Protocol.Accessibility.AXNodeId, Protocol.Accessibility.AXNode>()
    for (const node of axNodes) {
      axById.set(node.nodeId, node)
    }

    const findRootAxNodeId = (): Protocol.Accessibility.AXNodeId | null => {
      if (scopeRootBackendId) {
        const scoped = axNodes.find((node) => {
          return node.backendDOMNodeId === scopeRootBackendId
        })
        if (scoped) {
          return scoped.nodeId
        }
      }
      const rootWebArea = axNodes.find((node) => {
        return getAxRole(node) === 'rootwebarea'
      })
      if (rootWebArea) {
        return rootWebArea.nodeId
      }
      const webArea = axNodes.find((node) => {
        return getAxRole(node) === 'webarea'
      })
      if (webArea) {
        return webArea.nodeId
      }
      const topLevel = axNodes.find((node) => {
        return !node.parentId
      })
      return topLevel ? topLevel.nodeId : null
    }

    const rootAxNodeId = findRootAxNodeId()

    const refCounts = new Map<string, number>()
    let fallbackCounter = 0
    const refs: AriaRefDraft[] = []

    const createRefForNode = (options: {
      backendNodeId?: Protocol.DOM.BackendNodeId
      role: string
      name: string
    }): string | null => {
      if (!INTERACTIVE_ROLES.has(options.role)) {
        return null
      }

      const domInfo = options.backendNodeId ? domByBackendId.get(options.backendNodeId) : undefined
      const stable = domInfo ? getStableRefFromAttributes(domInfo.attributes) : null
      let baseRef = stable?.value
      if (!baseRef) {
        fallbackCounter += 1
        baseRef = `e${fallbackCounter}`
      }

      const count = refCounts.get(baseRef) ?? 0
      refCounts.set(baseRef, count + 1)
      const ref = count === 0 ? baseRef : `${baseRef}-${count + 1}`

      let selector: string | undefined
      if (stable && count === 0) {
        selector = buildLocatorFromStable(stable)
      }

      refs.push({ ref, role: options.role, name: options.name, selector, backendNodeId: options.backendNodeId })
      return ref
    }

    const isNodeInScope = (node: Protocol.Accessibility.AXNode): boolean => {
      if (!allowedBackendIds) {
        return true
      }
      if (!node.backendDOMNodeId) {
        return false
      }
      return allowedBackendIds.has(node.backendDOMNodeId)
    }

    let snapshotNodes: SnapshotNode[] = []
    if (rootAxNodeId) {
      const rootNode = axById.get(rootAxNodeId)
      const rootRole = rootNode ? getAxRole(rootNode) : ''
      const rawRoots =
        rootNode && (rootRole === 'rootwebarea' || rootRole === 'webarea') && rootNode.childIds
          ? rootNode.childIds
              .map((childId) => {
                return buildRawSnapshotTree({ nodeId: childId, axById, isNodeInScope })
              })
              .filter(isTruthy)
          : [buildRawSnapshotTree({ nodeId: rootAxNodeId, axById, isNodeInScope })].filter(isTruthy)

      const filtered = rawRoots.flatMap((rawNode) => {
        if (interactiveOnly) {
          return filterInteractiveSnapshotTree({
            node: rawNode,
            ancestorNames: [],
            labelContext: false,
            refFilter,
            domByBackendId,
            createRefForNode,
          }).nodes
        }
        return filterFullSnapshotTree({
          node: rawNode,
          ancestorNames: [],
          refFilter,
          domByBackendId,
          createRefForNode,
        }).nodes
      })
      snapshotNodes = filtered
    }

    const snapshotLines = buildSnapshotLines(snapshotNodes)

    const shortRefMap = buildShortRefMap({ refs })
    const finalized = finalizeSnapshotOutput(snapshotLines, snapshotNodes, shortRefMap)
    const refsWithShortRef: Array<AriaRef & { selector?: string }> = refs.map((entry) => {
      return {
        ...entry,
        shortRef: shortRefMap.get(entry.ref) ?? entry.ref,
      }
    })
    const result = { snapshot: finalized.snapshot, tree: finalized.tree, refs: refsWithShortRef }

    // Build refToElement map
    const refToElement = new Map<string, { role: string; name: string; shortRef: string }>()
    const refToSelector = new Map<string, string>()
    for (const { ref, role, name, shortRef } of result.refs) {
      if (!refFilter || refFilter({ role, name })) {
        refToElement.set(ref, { role, name, shortRef })
      }
    }

    for (const { ref, selector } of result.refs) {
      if (!selector) {
        continue
      }
      refToSelector.set(ref, selector)
    }

    const snapshot = result.snapshot

    const getSelectorForRef = (ref: string): string | null => {
      const mapped = refToSelector.get(ref)
      if (mapped) {
        return mapped
      }
      const info = refToElement.get(ref)
      if (!info) {
        return null
      }
      const escapedName = info.name.replace(/"/g, '\\"')
      return `role=${info.role}[name="${escapedName}"]`
    }

    const getRefsForLocators = async (locators: Array<Locator | ElementHandle>): Promise<Array<AriaRef | null>> => {
      if (locators.length === 0) {
        return []
      }

      const targetHandles = await Promise.all(
        locators.map(async (loc) => {
          try {
            return 'elementHandle' in loc
              ? await (loc as Locator).elementHandle({ timeout: 1000 })
              : (loc as ElementHandle)
          } catch {
            return null
          }
        }),
      )

      const matchingRefs = await page.evaluate(
        ({ targets, refData }) => {
          return targets.map((target) => {
            if (!target) {
              return null
            }

            const testIdAttrs = [
              'data-testid',
              'data-test-id',
              'data-test',
              'data-cy',
              'data-pw',
              'data-qa',
              'data-e2e',
              'data-automation-id',
            ]
            for (const attr of testIdAttrs) {
              const value = target.getAttribute(attr)
              if (value) {
                const match = refData.find((ref) => {
                  return ref.ref === value || ref.ref.startsWith(value)
                })
                if (match) {
                  return match.ref
                }
              }
            }

            const id = target.getAttribute('id')
            if (id) {
              const match = refData.find((ref) => {
                return ref.ref === id || ref.ref.startsWith(id)
              })
              if (match) {
                return match.ref
              }
            }

            return null
          })
        },
        {
          targets: targetHandles,
          refData: result.refs,
        },
      )

      return matchingRefs.map((ref) => {
        if (!ref) {
          return null
        }
        const info = refToElement.get(ref)
        return info ? { ...info, ref } : null
      })
    }

    return {
      snapshot,
      tree: result.tree,
      refs: result.refs,
      refToElement,
      refToSelector,
      getSelectorForRef,
      getRefsForLocators,
      getRefForLocator: async (loc) => (await getRefsForLocators([loc]))[0],
      getRefStringForLocator: async (loc) => (await getRefsForLocators([loc]))[0]?.ref ?? null,
    }
  } finally {
    if (scopeApplied && scopeLocator) {
      await scopeLocator.evaluate((element, attr) => {
        element.removeAttribute(attr)
      }, scopeAttr)
    }
    if (oopifSessionId) {
      await session.send('Target.detachFromTarget', { sessionId: oopifSessionId }).catch(() => {})
    }
    if (!cdp) {
      await session.detach()
    }
  }
}

function buildBoxFromQuad(quad?: number[]): LabelBox | null {
  if (!quad || quad.length < 8) {
    return null
  }
  const xs = [quad[0], quad[2], quad[4], quad[6]]
  const ys = [quad[1], quad[3], quad[5], quad[7]]
  const left = Math.min(...xs)
  const right = Math.max(...xs)
  const top = Math.min(...ys)
  const bottom = Math.max(...ys)
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  }
}

function isTruthy<T>(value: T): value is NonNullable<T> {
  return Boolean(value)
}

async function getLabelBoxesForRefs({
  page,
  refs,
  maxConcurrency = MAX_LABEL_POSITION_CONCURRENCY,
  logger,
  cdp,
}: {
  page: Page
  refs: AriaRef[]
  maxConcurrency?: number
  logger?: { info?: (...args: unknown[]) => void; error?: (...args: unknown[]) => void }
  cdp?: ICDPSession
}): Promise<AriaLabel[]> {
  const log = logger?.info ?? logger?.error ?? console.error
  const session = cdp || (await getCDPSessionForPage({ page }))
  const sema = new Sema(maxConcurrency)
  const labelRefs = refs.filter((ref) => {
    return Boolean(ref.backendNodeId) && INTERACTIVE_ROLES.has(ref.role)
  })

  log(`[getLabelBoxesForRefs] processing ${labelRefs.length} interactive refs (concurrency: ${maxConcurrency})`)
  const startTime = Date.now()
  let completed = 0
  let timedOut = 0
  let failed = 0

  try {
    const labels = await Promise.all(
      labelRefs.map(async (ref) => {
        if (!ref.backendNodeId) {
          return null
        }
        await sema.acquire()
        try {
          const response = await Promise.race([
            session.send('DOM.getBoxModel', {
              backendNodeId: ref.backendNodeId,
            }) as Promise<Protocol.DOM.GetBoxModelResponse>,
            new Promise<null>((resolve) => {
              setTimeout(() => {
                resolve(null)
              }, BOX_MODEL_TIMEOUT_MS)
            }),
          ])
          completed++
          if (completed % 50 === 0 || completed === labelRefs.length) {
            log(
              `[getLabelBoxesForRefs] progress: ${completed}/${labelRefs.length} (${timedOut} timeouts, ${failed} errors) - ${Date.now() - startTime}ms`,
            )
          }
          if (!response) {
            timedOut++
            return null
          }
          const box = buildBoxFromQuad(response.model.border)
          if (!box) {
            return null
          }
          return { ref: ref.ref, role: ref.role, box }
        } catch (error) {
          completed++
          failed++
          return null
        } finally {
          sema.release()
        }
      }),
    )
    log(
      `[getLabelBoxesForRefs] done: ${completed} completed, ${timedOut} timeouts, ${failed} errors - ${Date.now() - startTime}ms`,
    )
    return labels.filter(isTruthy)
  } finally {
    if (!cdp) {
      await session.detach()
    }
  }
}

/**
 * Show Vimium-style labels on interactive elements.
 * Labels are colored badges positioned above each element showing the ref.
 * Use with screenshots so agents can see which elements are interactive.
 *
 * Labels auto-hide after 30 seconds to prevent stale labels.
 * Call this function again if the page HTML changes to get fresh labels.
 *
 * @param page - Playwright page
 * @param locator - Optional locator to scope labels to a subtree
 * @param interactiveOnly - Only show labels for interactive elements (default: true)
 *
 * @example
 * ```ts
 * const { snapshot, labelCount } = await showAriaRefLabels({ page })
 * await page.screenshot({ path: '/tmp/screenshot.png' })
 * // Agent sees [submit-btn] label on "Submit" button
 * await page.locator('[data-testid="submit-btn"]').click()
 * ```
 */
export async function showAriaRefLabels({
  page,
  locator,
  interactiveOnly = true,
  logger,
}: {
  page: Page
  locator?: Locator
  interactiveOnly?: boolean
  logger?: { info?: (...args: unknown[]) => void; error?: (...args: unknown[]) => void }
}): Promise<{
  snapshot: string
  labelCount: number
}> {
  const startTime = Date.now()
  const log = logger?.info ?? logger?.error ?? console.error

  log(`[showAriaRefLabels] starting...`)
  await ensureA11yClient(page)
  log(`[showAriaRefLabels] ensureA11yClient: ${Date.now() - startTime}ms`)

  const cdpStart = Date.now()
  const cdp = await getCDPSessionForPage({ page })
  log(`[showAriaRefLabels] getCDPSessionForPage: ${Date.now() - cdpStart}ms`)

  try {
    const snapshotStart = Date.now()
    const { snapshot, refs } = await getAriaSnapshot({ page, locator, interactiveOnly, cdp })
    const shortRefMap = new Map(
      refs.map((entry) => {
        return [entry.ref, entry.shortRef]
      }),
    )
    const interactiveRefs = refs.filter((ref) => Boolean(ref.backendNodeId) && INTERACTIVE_ROLES.has(ref.role))
    log(
      `[showAriaRefLabels] getAriaSnapshot: ${Date.now() - snapshotStart}ms (${refs.length} refs, ${interactiveRefs.length} interactive)`,
    )

    const rootHandle = locator ? await locator.elementHandle() : null

    const labelsStart = Date.now()
    const labels = await getLabelBoxesForRefs({ page, refs, logger, cdp })
    const shortLabels = labels.map((label) => {
      return {
        ...label,
        ref: shortRefMap.get(label.ref) ?? label.ref,
      }
    })
    log(`[showAriaRefLabels] getLabelBoxesForRefs: ${Date.now() - labelsStart}ms (${labels.length} boxes)`)

    const renderStart = Date.now()
    const labelCount = await page.evaluate(
      ({ entries, root, interactiveOnly: intOnly }) => {
        const a11y = (
          globalThis as {
            __a11y?: {
              renderA11yLabels?: (labels: typeof entries) => number
              computeA11ySnapshot?: (options: { root: unknown; interactiveOnly: boolean; renderLabels: boolean }) => {
                labelCount: number
              }
            }
          }
        ).__a11y
        if (a11y?.renderA11yLabels) {
          return a11y.renderA11yLabels(entries)
        }
        if (a11y?.computeA11ySnapshot) {
          const rootElement = root || document.body
          return a11y.computeA11ySnapshot({ root: rootElement, interactiveOnly: intOnly, renderLabels: true })
            .labelCount
        }
        throw new Error('a11y client not loaded')
      },
      { entries: shortLabels, root: rootHandle, interactiveOnly },
    )

    log(`[showAriaRefLabels] renderA11yLabels: ${Date.now() - renderStart}ms (${labelCount} labels)`)
    log(`[showAriaRefLabels] total: ${Date.now() - startTime}ms`)

    return { snapshot, labelCount }
  } finally {
    await cdp.detach()
  }
}

/**
 * Remove all aria ref labels from the page.
 */
export async function hideAriaRefLabels({ page }: { page: Page }): Promise<void> {
  await page.evaluate(() => {
    const a11y = (globalThis as any).__a11y
    if (a11y) {
      a11y.hideA11yLabels()
    } else {
      // Fallback if client not loaded
      const doc = document
      const win = window as any
      const timerKey = '__playwriter_labels_timer__'
      if (win[timerKey]) {
        win.clearTimeout(win[timerKey])
        win[timerKey] = null
      }
      doc.getElementById('__playwriter_labels__')?.remove()
    }
  })
}

/**
 * Take a screenshot with accessibility labels overlaid on interactive elements.
 * Shows Vimium-style labels, captures the screenshot, then removes the labels.
 * The screenshot is automatically included in the MCP response.
 *
 * @param page - Playwright page
 * @param locator - Optional locator to scope labels to a subtree
 * @param collector - Array to collect screenshots (passed by MCP execute tool)
 *
 * @example
 * ```ts
 * await screenshotWithAccessibilityLabels({ page })
 * // Screenshot is automatically included in the MCP response
 * // Use ref from the snapshot to interact with elements
 * await page.locator('[data-testid="submit-btn"]').click()
 * ```
 */
export async function screenshotWithAccessibilityLabels({
  page,
  locator,
  interactiveOnly = true,
  collector,
  logger,
}: {
  page: Page
  locator?: Locator
  interactiveOnly?: boolean
  collector: ScreenshotResult[]
  logger?: { info?: (...args: unknown[]) => void; error?: (...args: unknown[]) => void }
}): Promise<void> {
  const log = logger?.info ?? logger?.error
  const showLabelsStart = Date.now()
  const { snapshot, labelCount } = await showAriaRefLabels({ page, locator, interactiveOnly, logger })
  if (log) {
    log(`showAriaRefLabels: ${Date.now() - showLabelsStart}ms`)
  }

  // Generate unique filename with timestamp
  const timestamp = Date.now()
  const random = Math.random().toString(36).slice(2, 6)
  const filename = `playwriter-screenshot-${timestamp}-${random}.jpg`

  // Use ./tmp folder (gitignored) instead of system temp
  const tmpDir = path.join(process.cwd(), 'tmp')
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true })
  }
  const screenshotPath = path.join(tmpDir, filename)

  // Get viewport size to clip screenshot to visible area
  const viewport = (await page.evaluate('({ width: window.innerWidth, height: window.innerHeight })')) as {
    width: number
    height: number
  }

  // Max 1568px on any edge (larger gets auto-resized by Claude, adding latency)
  // Token formula: tokens = (width * height) / 750
  const MAX_DIMENSION = 1568

  // Check if sharp is available for resizing
  const sharp = await sharpPromise

  // Clip dimensions: if sharp unavailable, limit capture area to MAX_DIMENSION
  const clipWidth = sharp ? viewport.width : Math.min(viewport.width, MAX_DIMENSION)
  const clipHeight = sharp ? viewport.height : Math.min(viewport.height, MAX_DIMENSION)

  // Take viewport screenshot with scale: 'css' to ignore device pixel ratio
  const screenshotStart = Date.now()
  const rawBuffer = await page.screenshot({
    type: 'jpeg',
    quality: 80,
    scale: 'css',
    clip: { x: 0, y: 0, width: clipWidth, height: clipHeight },
  })
  if (log) {
    log(`page.screenshot: ${Date.now() - screenshotStart}ms`)
  }

  // Resize with sharp if available, otherwise use clipped raw buffer
  const resizeStart = Date.now()
  const buffer = await (async () => {
    if (!sharp) {
      logger?.error?.('[playwriter] sharp not available, using clipped screenshot (max', MAX_DIMENSION, 'px)')
      return rawBuffer
    }
    try {
      return await sharp(rawBuffer)
        .resize({
          width: MAX_DIMENSION,
          height: MAX_DIMENSION,
          fit: 'inside', // Scale down to fit, preserving aspect ratio
          withoutEnlargement: true, // Don't upscale small images
        })
        .jpeg({ quality: 80 })
        .toBuffer()
    } catch (err) {
      logger?.error?.('[playwriter] sharp resize failed, using raw buffer:', err)
      return rawBuffer
    }
  })()
  if (log) {
    log(`screenshot resize: ${Date.now() - resizeStart}ms`)
  }

  // Save to file
  fs.writeFileSync(screenshotPath, buffer)

  // Convert to base64
  const base64 = buffer.toString('base64')

  // Hide labels
  await hideAriaRefLabels({ page })

  // Add to collector array
  collector.push({
    path: screenshotPath,
    base64,
    mimeType: 'image/jpeg',
    snapshot,
    labelCount,
  })
}

// Re-export for backward compatibility
export { getAriaSnapshot as getAriaSnapshotWithRefs }
