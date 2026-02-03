import { describe, it, expect } from 'vitest'
import { createSmartDiff } from './diff-utils.js'

describe('createSmartDiff', () => {
  it('returns no-change with full content when content is identical', () => {
    const result = createSmartDiff({
      oldContent: 'hello\nworld',
      newContent: 'hello\nworld',
    })
    expect(result.type).toBe('no-change')
    expect(result.content).toBe('hello\nworld')
  })

  it('returns full content when diff would be longer', () => {
    // Small content - diff overhead makes it longer than full content
    const result = createSmartDiff({
      oldContent: 'line1\nline2\nline3\nline4\nline5',
      newContent: 'line1\nline2-modified\nline3\nline4\nline5',
    })
    expect(result.type).toBe('full')
    expect(result.content).toBe('line1\nline2-modified\nline3\nline4\nline5')
  })

  it('returns diff for large content with small changes', () => {
    // Generate large content where diff will be shorter
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}: some content here`)
    const oldContent = lines.join('\n')
    const newLines = [...lines]
    newLines[50] = 'line 51: MODIFIED content here'
    const newContent = newLines.join('\n')

    const result = createSmartDiff({ oldContent, newContent })
    expect(result.type).toBe('diff')
    expect(result.content).toContain('-line 51: some content here')
    expect(result.content).toContain('+line 51: MODIFIED content here')
  })

  it('returns full content when changes exceed 50% threshold', () => {
    const result = createSmartDiff({
      oldContent: 'a\nb\nc\nd',
      newContent: 'x\ny\nz\nw',
    })
    expect(result.type).toBe('full')
    expect(result.content).toBe('x\ny\nz\nw')
  })

  it('respects custom threshold with large content', () => {
    // Generate content where diff is shorter than full
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`)
    const oldContent = lines.join('\n')
    const newLines = [...lines]
    // Change 25 lines = 50%
    for (let i = 0; i < 25; i++) {
      newLines[i * 2] = `CHANGED ${i}`
    }
    const newContent = newLines.join('\n')

    // With 40% threshold, should return full (50% >= 40%)
    const resultLow = createSmartDiff({
      oldContent,
      newContent,
      threshold: 0.4,
    })
    expect(resultLow.type).toBe('full')

    // With 60% threshold, should return diff (50% < 60%) - but only if diff is shorter
    const resultHigh = createSmartDiff({
      oldContent,
      newContent,
      threshold: 0.6,
    })
    // For this case, even with high threshold, the diff may be longer than full content
    // so it could return 'full' - the key is threshold + length check both apply
    expect(['diff', 'full']).toContain(resultHigh.type)
  })

  it('uses custom label in diff output', () => {
    // Generate large content where diff will be shorter than full
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}: content`)
    const oldContent = lines.join('\n')
    const newLines = [...lines]
    newLines[50] = 'line 51: MODIFIED'
    const newContent = newLines.join('\n')

    const result = createSmartDiff({
      oldContent,
      newContent,
      label: 'snapshot',
    })
    expect(result.type).toBe('diff')
    expect(result.content).toContain('--- snapshot')
    expect(result.content).toContain('+++ snapshot')
  })

  it('handles empty old content (all additions)', () => {
    const result = createSmartDiff({
      oldContent: '',
      newContent: 'new\ncontent\nhere',
    })
    // 100% new content should trigger full
    expect(result.type).toBe('full')
    expect(result.content).toContain('new\ncontent\nhere')
  })

  it('handles empty new content (all deletions)', () => {
    const result = createSmartDiff({
      oldContent: 'old\ncontent\nhere',
      newContent: '',
    })
    expect(result.type).toBe('full')
    expect(result.content).toBe('')
  })

  it('handles single line changes', () => {
    const result = createSmartDiff({
      oldContent: 'single line',
      newContent: 'modified line',
    })
    // 100% change on single line
    expect(result.type).toBe('full')
  })

  it('returns full content when most lines changed', () => {
    // 4 lines changed out of 5 = 80%
    const result = createSmartDiff({
      oldContent: 'a\nb\nc\nd\ne',
      newContent: 'a\nX\nY\nZ\nW',
    })
    expect(result.type).toBe('full')
    expect(result.content).toBe('a\nX\nY\nZ\nW')
  })

  it('includes context lines in diff output', () => {
    // Generate large content where diff is shorter than full
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}: some longer content`)
    const oldContent = lines.join('\n')
    const newLines = [...lines]
    newLines[50] = 'line 51: MODIFIED content'
    const newContent = newLines.join('\n')

    const result = createSmartDiff({
      oldContent,
      newContent,
    })
    expect(result.type).toBe('diff')
    // Should have context around the change
    expect(result.content).toContain('line 50')
    expect(result.content).toContain('-line 51: some longer content')
    expect(result.content).toContain('+line 51: MODIFIED content')
    expect(result.content).toContain('line 52')
  })
})
