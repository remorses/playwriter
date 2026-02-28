import { describe, it, expect } from 'vitest'
import { shouldAutoReturn, wrapCode } from './executor.js'

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
