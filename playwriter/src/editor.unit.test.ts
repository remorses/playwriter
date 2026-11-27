import { describe, expect, test } from 'vitest'
import type { ICDPSession } from './cdp-session.js'
import { Editor } from './editor.js'

const JS_URL = 'https://example.com/app.js'
const CSS_URL = 'https://example.com/app.css'

// Serves one script and one stylesheet and keeps the text the editor writes back.
function createEditor(sources: { js: string; css: string }) {
  const listeners = new Map<string, Set<(params: any) => void>>()
  const emit = (event: string, params: unknown) => {
    for (const listener of listeners.get(event) ?? []) {
      listener(params)
    }
  }
  const written: Record<string, string> = {}
  const cdp = {
    on(event: string, listener: (params: any) => void) {
      listeners.set(event, (listeners.get(event) ?? new Set()).add(listener))
      return cdp
    },
    off(event: string, listener: (params: any) => void) {
      listeners.get(event)?.delete(listener)
      return cdp
    },
    async send(method: string, params?: any) {
      switch (method) {
        case 'Debugger.enable':
          emit('Debugger.scriptParsed', { url: JS_URL, scriptId: '1' })
          return {}
        case 'CSS.enable':
          emit('CSS.styleSheetAdded', { header: { sourceURL: CSS_URL, styleSheetId: '2' } })
          return {}
        case 'Debugger.getScriptSource':
          return { scriptSource: sources.js }
        case 'CSS.getStyleSheetText':
          return { text: sources.css }
        case 'Debugger.setScriptSource':
          written[JS_URL] = params.scriptSource
          return {}
        case 'CSS.setStyleSheetText':
          written[CSS_URL] = params.text
          return {}
        default:
          return {}
      }
    },
  }
  return { editor: new Editor({ cdp: cdp as unknown as ICDPSession }), written }
}

describe('Editor.edit', () => {
  test.each([
    ['dollar helper', "return $('#' + id)", "return $$('#' + id)"],
    ['template literal', "return 'USD ' + price", 'return `$${price}`'],
    ['matched text', 'return MATCH', "return s.replace(/[.*]/g, '\\\\$&')"],
    ['text before and after', 'return MATCH', "return ['$`', \"$'\"]"],
  ])('writes newString as is: %s', async (_name, oldString, newString) => {
    const { editor, written } = createEditor({ js: `function f() {\n  ${oldString}\n}\n`, css: '' })

    await editor.edit({ url: JS_URL, oldString, newString })

    expect(written[JS_URL]).toBe(`function f() {\n  ${newString}\n}\n`)
  })

  test('writes newString as is in a stylesheet', async () => {
    const { editor, written } = createEditor({ js: '', css: 'a::before { content: "old" }' })

    await editor.edit({ url: CSS_URL, oldString: '"old"', newString: '"$$ $&"' })

    expect(written[CSS_URL]).toBe('a::before { content: "$$ $&" }')
    const { content } = await editor.read({ url: CSS_URL })
    expect(content).toContain('"$$ $&"')
  })
})
