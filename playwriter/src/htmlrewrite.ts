import posthtml from 'posthtml'
import beautify from 'posthtml-beautify'

export interface FormatHtmlOptions {
  html: string
  keepStyles?: boolean
  maxAttrLen?: number
  maxContentLen?: number
}

export async function formatHtmlForPrompt({
  html,
  keepStyles = false,
  maxAttrLen = 200,
  maxContentLen = 500,
}: FormatHtmlOptions) {
  const tagsToRemove = ['hint', 'style', 'link', 'script', 'meta', 'noscript', 'svg', 'head']

  const attributesToKeep = [
    // Standard descriptive attributes
    'label',
    'title',
    'alt',
    'href',
    'name',
    'value',
    'checked',
    'placeholder',
    'type',
    'role',
    'target',
    // Descriptive aria attributes (text content)
    'aria-label',
    'aria-placeholder',
    'aria-valuetext',
    'aria-roledescription',
    // Useful aria state attributes
    'aria-hidden',
    'aria-expanded',
    'aria-checked',
    'aria-selected',
    'aria-disabled',
    'aria-pressed',
    'aria-required',
    'aria-current',
    // Test IDs (data-testid, data-test, data-cy, data-qa are covered by data-* prefix)
    'testid',
    'test-id',
    'tid',
    'qa',
    'qa-id',
    'e2e',
    'e2e-id',
    'automation-id',
    'automationid',
    'selenium',
    'pw',
    'vimium-label',
    // Conditionally added: 'style', 'class'
  ]

  if (keepStyles) {
    attributesToKeep.push('style', 'class')
  }

  const truncate = (str: string, maxLen: number): string => {
    if (str.length <= maxLen) return str
    const remaining = str.length - maxLen
    return str.slice(0, maxLen) + `...${remaining} more characters`
  }

  // Create a custom plugin to remove tags and filter attributes
  const removeTagsAndAttrsPlugin = () => {
    return (tree) => {
      // Remove comments at root level
      tree = tree.filter((item) => {
        if (typeof item === 'string') {
          const trimmed = item.trim()
          return !(trimmed.startsWith('<!--') && trimmed.endsWith('-->'))
        }
        return true
      })

      // Process each node recursively
      const processNode = (node) => {
        if (typeof node === 'string') {
          // Truncate text content
          const trimmed = node.trim()
          if (trimmed.length === 0) return node
          return truncate(node, maxContentLen)
        }

        // Remove unwanted tags
        if (node.tag && tagsToRemove.includes(node.tag.toLowerCase())) {
          return null
        }

        // Filter attributes
        if (node.attrs) {
          const newAttrs: typeof node.attrs = {}
          for (const [attr, value] of Object.entries(node.attrs)) {
            const shouldKeep = attr.startsWith('data-') || attributesToKeep.includes(attr)

            if (shouldKeep) {
              // Truncate attribute values
              newAttrs[attr] = typeof value === 'string' ? truncate(value, maxAttrLen) : value
            }
          }
          node.attrs = newAttrs
        }

        // Process content recursively
        if (node.content && Array.isArray(node.content)) {
          node.content = node.content.map(processNode).filter((item) => {
            if (item === null) return false
            if (typeof item === 'string') {
              const trimmed = item.trim()
              return !(trimmed.startsWith('<!--') && trimmed.endsWith('-->'))
            }
            return true
          })
        }

        return node
      }

      // Process all root nodes
      return tree.map(processNode).filter((item) => item !== null)
    }
  }

  // Plugin to remove aria-hidden="true" subtrees entirely
  // These are hidden from assistive tech and usually decorative
  const removeAriaHiddenPlugin = () => {
    return (tree) => {
      const processNode = (node) => {
        if (typeof node === 'string') return node
        if (!node.tag) return node

        // Remove if aria-hidden="true"
        if (node.attrs?.['aria-hidden'] === 'true') {
          return null
        }

        // Process children recursively
        if (node.content && Array.isArray(node.content)) {
          node.content = node.content.map(processNode).filter((item) => item !== null)
        }

        return node
      }

      return tree.map(processNode).filter((item) => item !== null)
    }
  }

  // Plugin to remove images with empty alt text (purely decorative)
  // Runs before decorative subtree pruning so containers become empty
  const removeEmptyAltImagesPlugin = () => {
    return (tree) => {
      const processNode = (node) => {
        if (typeof node === 'string') return node
        if (!node.tag) return node

        // Remove img with empty or missing alt
        if (node.tag.toLowerCase() === 'img') {
          const alt = node.attrs?.alt
          if (alt === '' || alt === undefined) {
            return null
          }
        }

        // Process children recursively
        if (node.content && Array.isArray(node.content)) {
          node.content = node.content.map(processNode).filter((item) => item !== null)
        }

        return node
      }

      return tree.map(processNode).filter((item) => item !== null)
    }
  }

  // Plugin to remove decorative subtrees that have no useful content for agents
  // A subtree is decorative if it has:
  // - No text content (leaf text nodes)
  // - No actionable elements with meaningful attributes
  const removeDecorativeSubtreesPlugin = () => {
    const actionableTags = ['button', 'a', 'input', 'select', 'textarea']
    const meaningfulAttrs = ['aria-label', 'title', 'alt', 'value', 'placeholder', 'href', 'name']

    // Form elements are always actionable, keep unconditionally
    const formTags = ['input', 'select', 'textarea']

    // Check if a subtree has any useful content
    const hasUsefulContent = (node): boolean => {
      if (typeof node === 'string') {
        return node.trim().length > 0
      }
      if (!node.tag) return false

      // Form elements are always useful for agents to interact with
      if (formTags.includes(node.tag.toLowerCase())) {
        return true
      }

      // Images with non-empty alt text are useful (descriptive content)
      if (node.tag.toLowerCase() === 'img') {
        const alt = node.attrs?.alt
        if (typeof alt === 'string' && alt.trim().length > 0) {
          return true
        }
      }

      // Check if this is an actionable element with meaningful attributes
      if (actionableTags.includes(node.tag.toLowerCase())) {
        if (node.attrs) {
          for (const attr of meaningfulAttrs) {
            const value = node.attrs[attr]
            if (typeof value === 'string' && value.trim().length > 0) {
              return true
            }
          }
        }
      }

      // Check children recursively
      if (node.content && Array.isArray(node.content)) {
        for (const child of node.content) {
          if (hasUsefulContent(child)) {
            return true
          }
        }
      }

      return false
    }

    return (tree) => {
      const processNode = (node) => {
        if (typeof node === 'string') return node
        if (!node.tag) return node

        // First process children
        if (node.content && Array.isArray(node.content)) {
          node.content = node.content.map(processNode).filter((item) => item !== null)
        }

        // After processing children, check if this subtree is now decorative
        // Skip root-level semantic elements (body, main, etc.)
        const semanticTags = ['html', 'body', 'main', 'header', 'footer', 'nav', 'section', 'article', 'aside']
        if (semanticTags.includes(node.tag.toLowerCase())) {
          return node
        }

        // If no useful content in this subtree, remove it
        if (!hasUsefulContent(node)) {
          return null
        }

        return node
      }

      return tree.map(processNode).filter((item) => item !== null)
    }
  }

  // Plugin to unwrap unnecessary nested wrapper elements
  // e.g., <div><div><div><p>text</p></div></div></div> -> <div><p>text</p></div>
  const unwrapNestedWrappersPlugin = () => {
    return (tree) => {
      const isWhitespaceOnly = (node) => {
        return typeof node === 'string' && node.trim().length === 0
      }

      const hasNoAttrs = (node) => {
        return !node.attrs || Object.keys(node.attrs).length === 0
      }

      const unwrapNode = (node) => {
        if (typeof node === 'string') return node
        if (!node.tag) return node

        // First, recursively process children
        if (node.content && Array.isArray(node.content)) {
          node.content = node.content.map(unwrapNode)
        }

        // Check if this node is an unnecessary wrapper:
        // - has no attributes
        // - has exactly one non-whitespace child that is an element
        if (hasNoAttrs(node) && node.content && Array.isArray(node.content)) {
          const nonWhitespaceChildren = node.content.filter((c) => !isWhitespaceOnly(c))

          if (nonWhitespaceChildren.length === 1) {
            const onlyChild = nonWhitespaceChildren[0]
            // If the only child is also an element (not text), unwrap
            if (typeof onlyChild !== 'string' && onlyChild.tag) {
              // Replace this node with its child
              return onlyChild
            }
          }
        }

        return node
      }

      // Apply multiple passes until stable (handles deeply nested wrappers)
      let result = tree.map(unwrapNode)
      let prevJson = ''
      let currJson = JSON.stringify(result)
      while (prevJson !== currJson) {
        prevJson = currJson
        result = result.map(unwrapNode)
        currJson = JSON.stringify(result)
      }

      return result
    }
  }

  // Plugin to remove empty elements (no attrs, no content)
  // Runs repeatedly until no more empty elements exist
  const removeEmptyElementsPlugin = () => {
    return (tree) => {
      const isEmptyElement = (node) => {
        if (typeof node === 'string') return false
        if (!node.tag) return false
        const hasAttrs = node.attrs && Object.keys(node.attrs).length > 0
        const hasContent =
          node.content && node.content.some((c) => (typeof c === 'string' ? c.trim().length > 0 : true))
        return !hasAttrs && !hasContent
      }

      const removeEmpty = (content) => {
        if (!content || !Array.isArray(content)) return content

        return content
          .map((node) => {
            if (typeof node === 'string') return node
            if (node.content) {
              node.content = removeEmpty(node.content)
            }
            return node
          })
          .filter((node) => !isEmptyElement(node))
      }

      // Apply multiple passes until stable
      let result = removeEmpty(tree)
      let prevJson = ''
      let currJson = JSON.stringify(result)
      while (prevJson !== currJson) {
        prevJson = currJson
        result = removeEmpty(result)
        currJson = JSON.stringify(result)
      }

      return result
    }
  }

  // Process HTML
  const processor = posthtml()
    .use(removeTagsAndAttrsPlugin())
    .use(removeAriaHiddenPlugin())
    .use(removeEmptyAltImagesPlugin())
    .use(removeDecorativeSubtreesPlugin())
    .use(removeEmptyElementsPlugin())
    .use(unwrapNestedWrappersPlugin())
    .use(
      beautify({
        rules: {
          indent: 1, // 1-space indent
          blankLines: false, // no extra blank lines
          maxlen: 100000, // effectively never wrap by content length
        },
        jsBeautifyOptions: {
          wrap_line_length: 0, // disable js-beautify wrapping
          preserve_newlines: false, // reduce stray newlines
        },
      }),
    )

  // Process with await
  const result = await processor.process(html)

  return result.html
}
