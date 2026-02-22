# Aria Snapshot Implementation Analysis

## Overview

The aria snapshot feature in playwriter extracts an accessibility tree from the browser using Chrome DevTools Protocol (CDP). This document details how it works, its CDP interactions, and frame/iframe handling capabilities.

## Main Implementation File

**File:** `playwriter/src/aria-snapshot.ts` (1358 lines)

## How It Works

### High-Level Pipeline

```
1. Get CDP Session for Page
2. Enable DOM and Accessibility domains
3. Fetch DOM tree (with pierce: true for iframes)
4. Fetch Accessibility tree
5. Build raw snapshot tree
6. Filter tree (interactive-only or full)
7. Generate locators and refs
8. Return formatted snapshot + utilities
```

### Key Functions

#### `getAriaSnapshot()`

**Location:** Line 749-1033 in `aria-snapshot.ts`

Main entry point that returns `AriaSnapshotResult` containing:

- `snapshot`: String representation of the accessibility tree
- `tree`: Structured tree with nodes
- `refs`: Array of references to interactive elements
- `getSelectorForRef()`: Get CSS selector for a ref
- `getRefsForLocators()`: Get refs for Playwright locators

**Signature:**

```typescript
export async function getAriaSnapshot({
  page,
  locator,
  refFilter,
  wsUrl,
  interactiveOnly = false,
  cdp,
}: {
  page: Page
  locator?: Locator
  refFilter?: (info: { role: string; name: string }) => boolean
  wsUrl?: string
  interactiveOnly?: boolean
  cdp?: ICDPSession
}): Promise<AriaSnapshotResult>
```

## CDP Commands Used

### 1. DOM Domain

**Command:** `DOM.getFlattenedDocument`
**Location:** Line 772

```typescript
const { nodes: domNodes } = (await session.send('DOM.getFlattenedDocument', {
  depth: -1,
  pierce: true,
})) as Protocol.DOM.GetFlattenedDocumentResponse
```

**Parameters:**

- `depth: -1` - Get entire subtree
- `pierce: true` - **Traverses iframes and shadow roots**

**Purpose:** Get all DOM nodes to map accessibility nodes to their attributes (test IDs, etc.)

### 2. Accessibility Domain

**Command:** `Accessibility.getFullAXTree`
**Location:** Line 791

```typescript
const { nodes: axNodes } = await session.send('Accessibility.getFullAXTree')
  as Protocol.Accessibility.GetFullAXTreeResponse
```

**Parameters:** None specified (uses defaults)

- Default: Returns AX tree for root frame
- **Has optional `frameId` parameter** (not currently used)

**Purpose:** Get the complete accessibility tree with roles, names, and relationships

## Frame/Iframe Support

### Current Implementation

**DOM Level:** ✅ **FULL SUPPORT**

- `DOM.getFlattenedDocument` with `pierce: true` traverses all iframes and shadow roots
- All DOM nodes from all frames are included in the flattened document

**Accessibility Level:** ⚠️ **LIMITED**

- `Accessibility.getFullAXTree` is called **without `frameId` parameter**
- According to CDP spec, when `frameId` is omitted, **only the root frame is used**
- Cross-origin iframes may have additional restrictions

### CDP Spec Details

From `Accessibility.pdl`:

```
experimental command getFullAXTree
  parameters
    # The maximum depth at which descendants of the root node should be retrieved.
    # If omitted, the full tree is returned.
    optional integer depth
    # The frame for whose document the AX tree should be retrieved.
    # If omitted, the root frame is used.
    optional Page.FrameId frameId
  returns
    array of AXNode nodes
```

### Implications

1. **Same-origin iframes:** May be included in the root frame's AX tree
2. **Cross-origin iframes:** Likely **NOT included** due to security restrictions
3. **Shadow DOM:** Likely included (as `pierce: true` affects DOM and shadow roots are part of the same document)

### Evidence from Code

**Scope handling (Line 760-789):**

- Uses `data-pw-scope` attribute to scope snapshots to a locator
- Builds `allowedBackendIds` set from DOM tree traversal
- Filters AX nodes based on `backendDOMNodeId` membership in this set

**Node mapping:**

- Each AX node has `backendDOMNodeId` property linking to DOM node
- DOM nodes fetched with `pierce: true` include iframe contents
- But AX tree without `frameId` may not cover all frames

## Key Data Structures

### AriaSnapshotNode

```typescript
type AriaSnapshotNode = {
  role: string
  name: string
  locator?: string
  ref?: string
  shortRef?: string
  backendNodeId?: Protocol.DOM.BackendNodeId
  children: AriaSnapshotNode[]
}
```

### AriaRef

```typescript
interface AriaRef {
  role: string
  name: string
  ref: string // Full ref (testid or e1, e2, e3...)
  shortRef: string // Short ref (e1, e2, e3...)
  backendNodeId?: Protocol.DOM.BackendNodeId
}
```

## Locator Generation

**File:** Lines 209-242

Generates Playwright-compatible locators:

1. **Stable refs** (preferred):
   - `[data-testid="submit-btn"]`
   - `[id="login"]`
   - Test ID attributes: `data-testid`, `data-test-id`, `data-test`, `data-cy`, `data-pw`, `data-qa`, `data-e2e`, `data-automation-id`

2. **Role-based fallback**:
   - `role=button[name="Submit"]`
   - `role=link[name="Learn More"]`

3. **Nth handling**:
   - Duplicates get `>> nth=0`, `>> nth=1`, etc.

## Interactive Roles

**Location:** Lines 123-143

Only these roles get refs in interactive mode:

```typescript
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
```

## Executor Integration

**File:** `playwriter/src/executor.ts` (Lines 533-619)

The `accessibilitySnapshot()` function exposed to agents:

```typescript
const accessibilitySnapshot = async (options: {
  page: Page
  locator?: Locator
  search?: string | RegExp
  showDiffSinceLastCall?: boolean
  format?: SnapshotFormat
  interactiveOnly?: boolean
}) => {
  const { snapshot, refs, getSelectorForRef } = await getAriaSnapshot({
    page: targetPage,
    locator,
    wsUrl: getCdpUrl(this.cdpConfig),
    interactiveOnly,
  })

  // Store refs for refToLocator() function
  // Handle search filtering
  // Handle diff mode
  // Return formatted snapshot
}
```

## Screenshot with Labels

**Function:** `screenshotWithAccessibilityLabels()`
**Location:** Lines 1258-1354

Takes a screenshot with Vimium-style labels overlaid on interactive elements:

1. Calls `showAriaRefLabels()` to render labels
2. Takes screenshot with viewport clipping
3. Resizes to max 1568px (Claude token optimization)
4. Hides labels
5. Returns screenshot with snapshot

## Tests

**File:** `playwriter/src/aria-snapshot.test.ts`

Tests against real websites:

- Hacker News
- GitHub

**Coverage:**

- Snapshot generation
- Interactive-only mode
- Locator format validation
- No wrapper roles in output

**Note:** No explicit iframe tests found

## Limitations & Findings

### Frame Handling Limitations

1. **Root frame only:** `Accessibility.getFullAXTree()` without `frameId` only returns root frame AX tree
2. **No iframe iteration:** Code doesn't enumerate frames and call `getFullAXTree()` per frame
3. **Cross-origin restrictions:** Even if frames were enumerated, cross-origin iframes would be blocked

### Potential Issues

1. **Elements in iframes may not appear** in accessibility snapshot
2. **DOM includes iframe content** (via `pierce: true`) but AX tree may not
3. **Inconsistency:** `backendNodeId` from DOM may not have matching AX node for iframe elements

### Evidence of Limitation

- No `frameId` parameter passed to `Accessibility.getFullAXTree()`
- No frame enumeration logic
- No tests for iframe scenarios
- CDP spec clearly states "If omitted, the root frame is used"

## Possible Enhancements

To support iframes properly:

1. **Enumerate frames:**

   ```typescript
   const { frameTree } = await session.send('Page.getFrameTree')
   // Recursively collect all frame IDs
   ```

2. **Get AX tree per frame:**

   ```typescript
   for (const frameId of frameIds) {
     const { nodes } = await session.send('Accessibility.getFullAXTree', { frameId })
     // Merge nodes
   }
   ```

3. **Handle cross-origin frames:**
   - Detect cross-origin frames
   - Skip or show placeholder for restricted frames
   - Document limitation in output

4. **Test with iframes:**
   - Add test cases with same-origin iframes
   - Add test cases with cross-origin iframes
   - Validate behavior

## Summary

**File Paths:**

- Main implementation: `playwriter/src/aria-snapshot.ts`
- Executor integration: `playwriter/src/executor.ts` (lines 533-619)
- CDP session: `playwriter/src/cdp-session.ts`
- Tests: `playwriter/src/aria-snapshot.test.ts`

**CDP Commands:**

- `DOM.enable` - Enable DOM domain
- `DOM.getFlattenedDocument({ depth: -1, pierce: true })` - Get all DOM nodes including iframes
- `Accessibility.enable` - Enable accessibility domain
- `Accessibility.getFullAXTree()` - Get AX tree (root frame only by default)
- `DOM.getBoxModel({ backendNodeId })` - Get element positions for labels

**Frame Handling:**

- ✅ DOM tree includes iframe content (`pierce: true`)
- ⚠️ Accessibility tree likely **only root frame** (no `frameId` parameter)
- ❌ No frame enumeration or per-frame AX tree fetching
- ❌ No explicit iframe tests

**Key Insight:**
The current implementation may miss interactive elements inside iframes because:

1. `Accessibility.getFullAXTree()` without `frameId` only returns root frame
2. No iteration over child frames to collect their AX trees
3. Cross-origin iframes would be blocked anyway for security

For multi-browser support with Firefox/WebKit, this limitation would need to be addressed as those browsers may handle iframes differently in their accessibility trees.
