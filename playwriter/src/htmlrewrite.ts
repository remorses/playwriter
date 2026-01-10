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
    const tagsToRemove = [
        'hint',
        'style',
        'link',
        'script',
        'meta',
        'noscript',
        'svg',
        'head',
    ]

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
        // Test IDs (data-testid, data-test, data-cy are covered by data-* prefix)
        'testid',
        'test-id',
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
                        const shouldKeep =
                            attr.startsWith('data-') ||
                            attributesToKeep.includes(attr)

                        if (shouldKeep) {
                            // Truncate attribute values
                            newAttrs[attr] = typeof value === 'string'
                                ? truncate(value, maxAttrLen)
                                : value
                        }
                    }
                    node.attrs = newAttrs
                }

                // Process content recursively
                if (node.content && Array.isArray(node.content)) {
                    node.content = node.content
                        .map(processNode)
                        .filter(item => {
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
            return tree.map(processNode).filter(item => item !== null)
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
                    const nonWhitespaceChildren = node.content.filter(c => !isWhitespaceOnly(c))

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
                const hasContent = node.content && node.content.some(c =>
                    typeof c === 'string' ? c.trim().length > 0 : true
                )
                return !hasAttrs && !hasContent
            }

            const removeEmpty = (content) => {
                if (!content || !Array.isArray(content)) return content

                return content
                    .map(node => {
                        if (typeof node === 'string') return node
                        if (node.content) {
                            node.content = removeEmpty(node.content)
                        }
                        return node
                    })
                    .filter(node => !isEmptyElement(node))
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
        .use(removeEmptyElementsPlugin())
        .use(unwrapNestedWrappersPlugin())
        .use(beautify({
            rules: {
                indent: 1,          // 1-space indent
                blankLines: false,  // no extra blank lines
                maxlen: 100000      // effectively never wrap by content length
            },
            jsBeautifyOptions: {
                wrap_line_length: 0,     // disable js-beautify wrapping
                preserve_newlines: false // reduce stray newlines
            }
        }))

    // Process with await
    const result = await processor.process(html)

    return result.html
}
