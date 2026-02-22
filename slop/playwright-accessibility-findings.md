---
title: Playwright Accessibility Implementation Findings
description: Analysis of how Playwright implements accessibility snapshots and handles iframes
---

## Overview

This document contains findings from exploring the Playwright source code to understand:

1. How Playwright implements accessibility snapshots (ariaSnapshot)
2. Whether Playwright supports getting accessibility tree for iframes/child frames
3. How Playwright handles frame locators for accessibility
4. What CDP commands Playwright uses for accessibility

## Key Findings

### 1. Playwright's Accessibility Implementation Strategy

**Playwright does NOT use CDP Accessibility commands for ariaSnapshot**. Instead, it uses:

- **Browser-side JavaScript injection** via `InjectedScript` class
- The injected script traverses the DOM directly using browser APIs
- No CDP `Accessibility.getFullAXTree` or `Accessibility.getPartialAXTree` calls

#### Code Flow:

```typescript
// Server-side (packages/playwright-core/src/server/frames.ts:1371)
async ariaSnapshot(progress: Progress, selector: string): Promise<string> {
  return await this._retryWithProgressIfNotConnected(
    progress,
    selector,
    true,
    true,
    handle => progress.race(handle.ariaSnapshot())
  );
}

// Element handle (packages/playwright-core/src/server/dom.ts:757)
async ariaSnapshot(): Promise<string> {
  return await this.evaluateInUtility(
    ([injected, element]) => injected.ariaSnapshot(element, { mode: 'expect' }),
    {}
  );
}

// Injected script (packages/injected/src/injectedScript.ts:305)
ariaSnapshot(node: Node, options: AriaTreeOptions): string {
  return this.incrementalAriaSnapshot(node, options).full;
}

incrementalAriaSnapshot(node: Node, options: AriaTreeOptions & { track?: string }):
  { full: string, incremental?: string, iframeRefs: string[] } {
  if (node.nodeType !== Node.ELEMENT_NODE)
    throw this.createStacklessError('Can only capture aria snapshot of Element nodes.');
  const ariaSnapshot = generateAriaTree(node as Element, options);
  const full = renderAriaTree(ariaSnapshot, options);
  // ...
  return { full, incremental, iframeRefs: ariaSnapshot.iframeRefs };
}
```

### 2. How Playwright Handles IFrames in Accessibility Snapshots

**IFrames are recognized but their content is NOT included** in the accessibility tree.

#### Evidence:

From `packages/injected/src/ariaSnapshot.ts:217-232`:

```typescript
function toAriaNode(element: Element, options: InternalOptions): aria.AriaNode | null {
  const active = element.ownerDocument.activeElement === element
  if (element.nodeName === 'IFRAME') {
    const ariaNode: aria.AriaNode = {
      role: 'iframe',
      name: '',
      children: [], // ⚠️ Empty children - no content from iframe
      props: {},
      box: computeBox(element),
      receivesPointerEvents: true,
      active,
    }
    setAriaNodeElement(ariaNode, element)
    computeAriaRef(ariaNode, options)
    return ariaNode
  }
  // ...
}
```

**Key observations:**

- IFrame elements are detected and added to the tree with `role: 'iframe'`
- The `children` array is ALWAYS empty for iframes
- IFrame refs are tracked separately in `snapshot.iframeRefs` array
- The content document of the iframe is NEVER traversed
- No attempt is made to access `iframe.contentDocument` or `iframe.contentWindow`

### 3. AriaSnapshot Return Value Structure

```typescript
export type AriaSnapshot = {
  root: aria.AriaNode
  elements: Map<string, Element> // ref -> Element mapping
  refs: Map<Element, string> // Element -> ref mapping
  iframeRefs: string[] // List of iframe ref IDs
}
```

The `iframeRefs` array contains references to iframe elements but NOT their content.

### 4. CDP Accessibility Commands (Available but NOT Used)

The CDP protocol DOES support frame-specific accessibility queries:

```typescript
// From protocol.d.ts
export type getFullAXTreeParameters = {
  depth?: number
  frameId?: Page.FrameId // ⚠️ Supports frame-specific queries!
}

export type getPartialAXTreeParameters = {
  nodeId?: DOM.NodeId
  backendNodeId?: DOM.BackendNodeId
  objectId?: Runtime.RemoteObjectId
  fetchRelatives?: boolean
}
```

**However, Playwright does NOT use these CDP commands anywhere in the codebase.**

Search results show:

- CDP types defined in `protocol.d.ts`
- No actual usage in Chromium implementation files
- Firefox uses a custom `Accessibility.getFullAXTree` via Juggler protocol

### 5. Why Playwright Uses DOM Traversal Instead of CDP

**Advantages of DOM traversal approach:**

1. **Cross-browser compatibility** - Works in Firefox, WebKit, Chromium
2. **Full control** - Can customize what gets included/excluded
3. **Performance** - No serialization overhead for large trees
4. **Flexibility** - Can implement custom filtering (visibility, aria roles, etc.)

**Disadvantages:**

1. **Cannot access iframe content** - Browser security prevents cross-origin access
2. **Must execute in each frame separately** - No single command for entire page tree
3. **Slower for deep trees** - Must traverse DOM node-by-node

### 6. Current Iframe Handling Limitations

Based on code analysis:

**Playwright CANNOT get accessibility tree for iframe content because:**

1. **Security restrictions**: JavaScript cannot access `iframe.contentDocument` for cross-origin iframes
2. **No CDP fallback**: Playwright doesn't use CDP Accessibility commands that could bypass this
3. **By design**: The `generateAriaTree` function explicitly skips iframe children

**To get iframe content accessibility tree, you would need to:**

1. Switch to the iframe's frame context
2. Call `ariaSnapshot()` again on that frame
3. Manually combine the results

Example:

```typescript
// Get main frame snapshot
const mainSnapshot = await page.locator('body').ariaSnapshot()

// Get iframe content
const frameElement = await page.frameLocator('iframe')
const frame = await frameElement.owner()
const frameSnapshot = await frame.contentFrame().locator('body').ariaSnapshot()

// Results are separate - no automatic merging
```

### 7. Alternative: Using CDP Accessibility Commands

**IF Playwriter wanted to support iframe content in accessibility snapshots**, it could:

1. Use `Accessibility.getFullAXTree({ frameId })` for each frame
2. Recursively call it for all child frames
3. Merge the results into a single tree

**CDP Command:**

```typescript
await session.send('Accessibility.getFullAXTree', {
  frameId: 'frame-id-here',
  depth: -1, // unlimited depth
})
```

This would return the full accessibility tree including iframe content, but:

- Only works in Chromium (not Firefox/WebKit)
- Returns CDP's AXNode format, not Playwright's AriaNode format
- Would need conversion logic

## Recommendations for Playwriter

### Option 1: Multi-Frame Snapshot Approach (Current Playwright Pattern)

Get accessibility tree for each frame separately:

```typescript
// Pseudo-code for MCP implementation
async function getAccessibilitySnapshot({ sessionId, includeFrames = false }) {
  const page = getPage(sessionId)

  // Get main frame snapshot
  const mainSnapshot = await page.evaluate(() => {
    return injected.ariaSnapshot(document.body, { mode: 'ai' })
  })

  if (!includeFrames) {
    return mainSnapshot
  }

  // Get all iframe snapshots
  const frames = page.frames()
  const frameSnapshots = await Promise.all(
    frames.slice(1).map(async (frame) => {
      return {
        frameId: frame.name() || frame.url(),
        snapshot: await frame.evaluate(() => {
          return injected.ariaSnapshot(document.body, { mode: 'ai' })
        }),
      }
    }),
  )

  return {
    main: mainSnapshot,
    frames: frameSnapshots,
  }
}
```

### Option 2: CDP-Based Approach (Chromium Only)

Use CDP `Accessibility.getFullAXTree` for each frame:

```typescript
async function getFullAccessibilityTree({ sessionId }) {
  const page = getPage(sessionId)
  const frames = page.frames()

  const trees = await Promise.all(
    frames.map(async (frame) => {
      const session = await frame._client // Get CDP session
      const { nodes } = await session.send('Accessibility.getFullAXTree', {
        frameId: frame._id,
      })
      return {
        frameId: frame.url(),
        nodes,
      }
    }),
  )

  // Convert CDP AXNode[] to Playwright AriaNode format
  return convertCDPtoAria(trees)
}
```

**Note:** This would only work for Chromium, not Firefox/WebKit.

### Option 3: Hybrid Approach (Recommended)

1. Use Playwright's existing `ariaSnapshot()` for the current frame
2. Detect iframes via `snapshot.iframeRefs`
3. Recursively get snapshots for each iframe's content frame
4. Mark iframe boundaries in the output

```typescript
async function getRecursiveSnapshot({ sessionId, maxDepth = 3 }) {
  const page = getPage(sessionId)

  async function getFrameSnapshot(frame, depth = 0) {
    if (depth >= maxDepth) return null

    // Get snapshot for this frame
    const result = await frame.evaluate(() => {
      return injected.incrementalAriaSnapshot(document.body, {
        mode: 'ai',
        refPrefix: `f${depth}_`,
      })
    })

    // Find iframe elements
    const iframeElements = await frame.$$('iframe')

    // Get snapshots for child frames
    const childSnapshots = await Promise.all(
      iframeElements.map(async (iframeEl) => {
        const childFrame = await iframeEl.contentFrame()
        if (!childFrame) return null
        return {
          iframeSrc: await iframeEl.getAttribute('src'),
          content: await getFrameSnapshot(childFrame, depth + 1),
        }
      }),
    )

    return {
      snapshot: result.full,
      iframes: childSnapshots.filter(Boolean),
    }
  }

  return await getFrameSnapshot(page.mainFrame())
}
```

## Summary

| Feature                                   | Playwright Support | Notes                                     |
| ----------------------------------------- | ------------------ | ----------------------------------------- |
| Accessibility snapshot for current frame  | ✅ Yes             | Via injected script DOM traversal         |
| Accessibility snapshot for iframe content | ❌ No              | Iframes detected but content not included |
| CDP Accessibility commands                | ❌ Not used        | Available but Playwright doesn't use them |
| Cross-browser support                     | ✅ Yes             | Works in all browsers via DOM traversal   |
| Frame-specific queries via CDP            | ⚠️ Available       | `frameId` parameter exists but unused     |
| Multi-frame snapshot                      | ⚠️ Manual          | Must query each frame separately          |

**Bottom line:** Playwright's `ariaSnapshot()` works on a single frame at a time. To get iframe content, you must:

1. Get the iframe element
2. Access its `contentFrame()`
3. Call `ariaSnapshot()` on that frame
4. Manually combine results

There is no built-in way to get a recursive accessibility tree that includes iframe content in a single call.
