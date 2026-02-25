# Styles API Reference

The getStylesForLocator function inspects CSS styles applied to an element, similar to browser DevTools "Styles" panel.

## Types

```ts
import type { ICDPSession } from './cdp-session.js';
import type { Locator } from '@xmorse/playwright-core';
export interface StyleSource {
    url: string;
    line: number;
    column: number;
}
export type StyleDeclarations = Record<string, string>;
export interface StyleRule {
    selector: string;
    source: StyleSource | null;
    origin: 'regular' | 'user-agent' | 'injected' | 'inspector';
    declarations: StyleDeclarations;
    inheritedFrom: string | null;
}
export interface StylesResult {
    element: string;
    inlineStyle: StyleDeclarations | null;
    rules: StyleRule[];
}
export declare function getStylesForLocator({ locator, cdp: cdpSession, includeUserAgentStyles, }: {
    locator: Locator;
    cdp: ICDPSession;
    includeUserAgentStyles?: boolean;
}): Promise<StylesResult>;
export declare function formatStylesAsText(styles: StylesResult): string;
```

## Examples

```ts
import { page, getStylesForLocator, formatStylesAsText, console } from './debugger-examples-types.js'

// Example: Get styles for an element and display them
async function getElementStyles() {
  const loc = page.locator('.my-button')
  const styles = await getStylesForLocator({ locator: loc })
  console.log(formatStylesAsText(styles))
}

// Example: Inspect computed styles for a specific element
async function inspectButtonStyles() {
  const button = page.getByRole('button', { name: 'Submit' })
  const styles = await getStylesForLocator({ locator: button })

  console.log('Element:', styles.element)

  if (styles.inlineStyle) {
    console.log('Inline styles:', styles.inlineStyle)
  }

  for (const rule of styles.rules) {
    console.log(`${rule.selector}: ${JSON.stringify(rule.declarations)}`)
    if (rule.source) {
      console.log(`  Source: ${rule.source.url}:${rule.source.line}`)
    }
  }
}

// Example: Include browser default (user-agent) styles
async function getStylesWithUserAgent() {
  const loc = page.locator('input[type="text"]')
  const styles = await getStylesForLocator({
    locator: loc,
    includeUserAgentStyles: true,
  })
  console.log(formatStylesAsText(styles))
}

// Example: Find where a CSS property is defined
async function findPropertySource() {
  const loc = page.locator('.card')
  const styles = await getStylesForLocator({ locator: loc })

  const backgroundRule = styles.rules.find((r) => 'background-color' in r.declarations)
  if (backgroundRule) {
    console.log('background-color defined by:', backgroundRule.selector)
    if (backgroundRule.source) {
      console.log(`  at ${backgroundRule.source.url}:${backgroundRule.source.line}`)
    }
  }
}

// Example: Check inherited styles
async function checkInheritedStyles() {
  const loc = page.locator('.nested-text')
  const styles = await getStylesForLocator({ locator: loc })

  const inheritedRules = styles.rules.filter((r) => r.inheritedFrom)
  for (const rule of inheritedRules) {
    console.log(`Inherited from ${rule.inheritedFrom}: ${rule.selector}`)
    console.log('  Properties:', rule.declarations)
  }
}

// Example: Compare styles between two elements
async function compareStyles() {
  const primary = await getStylesForLocator({ locator: page.locator('.btn-primary') })
  const secondary = await getStylesForLocator({ locator: page.locator('.btn-secondary') })

  console.log('Primary button:')
  console.log(formatStylesAsText(primary))

  console.log('Secondary button:')
  console.log(formatStylesAsText(secondary))
}

export {
  getElementStyles,
  inspectButtonStyles,
  getStylesWithUserAgent,
  findPropertySource,
  checkInheritedStyles,
  compareStyles,
}

```