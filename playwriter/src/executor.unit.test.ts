import { describe, it, expect } from 'vitest'
import {
  shouldAutoReturn,
  wrapCode,
  isPlaywrightChannelOwner,
  formatConsoleLogs,
  boundExecuteOutput,
  searchSnapshot,
} from './executor.js'

describe('searchSnapshot', () => {
  const snapshot = Array.from({ length: 40 }, (_, i) => `- button "Item ${i}"`).join('\n')

  it('finds every line with a /g regex and reports the match count', () => {
    expect(searchSnapshot({ snapshot: '- link "A"\n- link "B"\n- text: x\n- link "C"', search: /link/g }))
      .toMatchInlineSnapshot(`
        "3 matches
        - link "A"
        - link "B"
        - text: x
        - link "C""
      `)
  })

  it('matches strings case-insensitively and caps shown matches', () => {
    const out = searchSnapshot({ snapshot, search: 'BUTTON "item 1' })
    expect(out.split('\n')[0]).toMatchInlineSnapshot(`"11 matches (showing 10). Use a more specific search to see the rest."`)
  })

  it('reports no matches', () => {
    expect(searchSnapshot({ snapshot, search: 'checkbox' })).toBe('No matches found')
  })
})

describe('execute output', () => {
  it('folds identical consecutive log lines', () => {
    const logs = [
      ...Array.from({ length: 37 }, () => ({ method: 'log', args: ['tick', 1] })),
      { method: 'warn', args: [{ a: 1 }] },
      { method: 'log', args: ['tick', 1] },
    ]
    expect(formatConsoleLogs({ logs })).toMatchInlineSnapshot(`
      "Console output:
      [log] tick 1 (x37)
      [warn] { a: 1 }
      [log] tick 1

      "
    `)
  })

  it('keeps the return value when logs are long', () => {
    const before = Array.from({ length: 200 }, (_, i) => `[log] line ${i}`).join('\n') + '\n'
    const out = boundExecuteOutput({ before, after: '[return value] summary\n', maxLength: 200 })
    expect(out.length).toBeLessThanOrEqual(200)
    expect(out).toMatchInlineSnapshot(`
      "[log] line 0
      [log] line 1
      [log] line 2
      [log] line 3
      [log] line 4
      ... [2765 characters of logs omitted] ...
      [log] line 196
      [log] line 197
      [log] line 198
      [log] line 199
      [return value] summary
      "
    `)
  })

  it('splits the budget when both logs and return value are long', () => {
    const out = boundExecuteOutput({ before: 'L'.repeat(500), after: 'R'.repeat(500), maxLength: 200 })
    expect(out).toMatchInlineSnapshot(`
      "LLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLL
      ... [422 characters of logs omitted] ...
      LLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR
      [Truncated to 80 of 500 characters. Use snapshot({ search }), or write large data to a file and return a summary]"
    `)
  })

  it('returns short output unchanged', () => {
    expect(boundExecuteOutput({ before: 'a\n', after: 'b\n' })).toBe('a\nb\n')
  })
})

describe('shouldAutoReturn', () => {
  it('returns true for simple expressions', () => {
    expect(shouldAutoReturn('1 + 2')).toBe(true)
    expect(shouldAutoReturn('page.title()')).toBe(true)
    expect(shouldAutoReturn('await page.title()')).toBe(true)
    expect(shouldAutoReturn('snapshot({ page })')).toBe(true)
    expect(shouldAutoReturn('accessibilitySnapshot({ page })')).toBe(true)
    expect(shouldAutoReturn('context.pages().map(p => p.url())')).toBe(true)
  })

  it('returns true for awaited expressions', () => {
    expect(shouldAutoReturn('await Promise.resolve(42)')).toBe(true)
    expect(shouldAutoReturn('await page.goto("https://example.com")')).toBe(true)
  })

  it('returns false for assignment expressions', () => {
    expect(shouldAutoReturn('state.page = await context.newPage()')).toBe(false)
    expect(shouldAutoReturn('const x = 1')).toBe(false)
    expect(shouldAutoReturn('let y = 2')).toBe(false)
    expect(shouldAutoReturn('x = 5')).toBe(false)
  })

  it('returns false for update expressions', () => {
    expect(shouldAutoReturn('x++')).toBe(false)
    expect(shouldAutoReturn('++x')).toBe(false)
    expect(shouldAutoReturn('x--')).toBe(false)
    expect(shouldAutoReturn('--x')).toBe(false)
  })

  it('returns false for delete expressions', () => {
    expect(shouldAutoReturn('delete obj.prop')).toBe(false)
  })

  it('returns false for multiple statements', () => {
    expect(shouldAutoReturn('const x = 1; x + 1')).toBe(false)
    expect(shouldAutoReturn('await page.click("button"); await page.title()')).toBe(false)
    expect(shouldAutoReturn('const a = 1\nconst b = 2')).toBe(false)
  })

  it('returns false for return statements', () => {
    expect(shouldAutoReturn('return 5')).toBe(false)
    expect(shouldAutoReturn('return await page.title()')).toBe(false)
  })

  it('returns false for non-expression statements', () => {
    expect(shouldAutoReturn('if (true) { x }')).toBe(false)
    expect(shouldAutoReturn('for (let i = 0; i < 10; i++) {}')).toBe(false)
    expect(shouldAutoReturn('function foo() {}')).toBe(false)
    expect(shouldAutoReturn('class Foo {}')).toBe(false)
  })

  it('returns false for invalid syntax', () => {
    expect(shouldAutoReturn('const')).toBe(false)
    expect(shouldAutoReturn('{')).toBe(false)
    expect(shouldAutoReturn('await')).toBe(false)
  })

  it('handles edge cases', () => {
    // Empty string
    expect(shouldAutoReturn('')).toBe(false)
    // Just whitespace
    expect(shouldAutoReturn('   ')).toBe(false)
    // Object literal (parsed as block)
    expect(shouldAutoReturn('{ foo: 1 }')).toBe(false)
    // Parenthesized object literal (expression)
    expect(shouldAutoReturn('({ foo: 1 })')).toBe(true)
    // Array literal
    expect(shouldAutoReturn('[1, 2, 3]')).toBe(true)
  })

  it('handles sequence expressions with assignments', () => {
    // Sequence with assignment should not auto-return
    expect(shouldAutoReturn('(x = 1, x + 1)')).toBe(false)
    // Sequence without assignment should auto-return
    expect(shouldAutoReturn('(1, 2, 3)')).toBe(true)
  })

  it('handles comments in code', () => {
    expect(shouldAutoReturn('// comment\npage.title()')).toBe(true)
    expect(shouldAutoReturn('page.title() // comment')).toBe(true)
    expect(shouldAutoReturn('/* block */ 42')).toBe(true)
  })

  it('handles template literals', () => {
    expect(shouldAutoReturn('`hello`')).toBe(true)
    expect(shouldAutoReturn('`hello ${name}`')).toBe(true)
  })

  it('returns true for expressions with trailing semicolons', () => {
    expect(shouldAutoReturn('await page.title();')).toBe(true)
    expect(shouldAutoReturn('page.title();')).toBe(true)
    expect(shouldAutoReturn('snapshot({ page });')).toBe(true)
    expect(shouldAutoReturn('await screenshotWithAccessibilityLabels({ page });')).toBe(true)
    // trailing whitespace after semicolon
    expect(shouldAutoReturn('await foo();   ')).toBe(true)
    // comment after semicolon
    expect(shouldAutoReturn('await foo(); // comment')).toBe(true)
    // double semicolons are two statements, not auto-return
    expect(shouldAutoReturn('await foo();;')).toBe(false)
  })
})

describe('wrapCode', () => {
  it('wraps single expressions with return await', () => {
    expect(wrapCode('await page.title()')).toBe(
      '(async () => { return await (await page.title()) })()',
    )
  })

  it('strips trailing semicolons to avoid SyntaxError (#58)', () => {
    // The bug: trailing semicolons inside return await (...;) produce invalid JS
    const wrapped = wrapCode('await screenshotWithAccessibilityLabels({ page });')
    expect(wrapped).toBe(
      '(async () => { return await (await screenshotWithAccessibilityLabels({ page })) })()',
    )
    // Verify it's valid JS by parsing it
    expect(() => new Function(wrapped)).not.toThrow()
  })

  it('produces valid JS for trailing semicolons on simple calls', () => {
    const wrapped = wrapCode('page.title();')
    expect(wrapped).toBe('(async () => { return await (page.title()) })()')
    expect(() => new Function(wrapped)).not.toThrow()
  })

  it('wraps multi-statement code without return', () => {
    const wrapped = wrapCode('const x = 1; console.log(x);')
    expect(wrapped).toBe('(async () => { const x = 1; console.log(x); })()')
  })

  it('wraps assignment expressions without return', () => {
    expect(wrapCode('x = 5')).toBe('(async () => { x = 5 })()')
  })
})

describe('isPlaywrightChannelOwner', () => {
  it('detects ChannelOwner-shaped objects', () => {
    const fakeResponse = {
      _type: 'Response',
      _guid: 'response@abc123',
      _connection: { _platform: { env: {} } },
    }
    expect(isPlaywrightChannelOwner(fakeResponse)).toBe(true)
  })

  it('rejects plain objects and primitives', () => {
    expect(isPlaywrightChannelOwner(null)).toBe(false)
    expect(isPlaywrightChannelOwner(undefined)).toBe(false)
    expect(isPlaywrightChannelOwner('string')).toBe(false)
    expect(isPlaywrightChannelOwner(42)).toBe(false)
    expect(isPlaywrightChannelOwner({})).toBe(false)
    expect(isPlaywrightChannelOwner([])).toBe(false)
    expect(isPlaywrightChannelOwner({ url: 'https://example.com', status: 200 })).toBe(false)
  })

  it('rejects partial matches missing required fields', () => {
    expect(isPlaywrightChannelOwner({ _type: 'Response' })).toBe(false)
    expect(isPlaywrightChannelOwner({ _guid: 'abc' })).toBe(false)
    expect(isPlaywrightChannelOwner({ _type: 'x', _guid: 'y' })).toBe(false)
    // Missing _connection
    expect(isPlaywrightChannelOwner({ _type: 'x', _guid: 'y' })).toBe(false)
    // _type must be a string
    expect(isPlaywrightChannelOwner({ _type: 123, _guid: 'y', _connection: {} })).toBe(false)
  })
})
