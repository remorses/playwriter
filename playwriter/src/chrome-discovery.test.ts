import { describe, test, expect } from 'vitest'
import { parseDevToolsActivePort } from './chrome-discovery.js'

describe('parseDevToolsActivePort', () => {
  test('parses valid contents', () => {
    const result = parseDevToolsActivePort('9222\n/devtools/browser/abc-123-def\n')
    expect(result).toMatchInlineSnapshot(`
      {
        "port": 9222,
        "wsPath": "/devtools/browser/abc-123-def",
      }
    `)
  })

  test('parses with extra whitespace', () => {
    const result = parseDevToolsActivePort('  9222  \n  /devtools/browser/abc  \n')
    expect(result).toMatchInlineSnapshot(`
      {
        "port": 9222,
        "wsPath": "/devtools/browser/abc",
      }
    `)
  })

  test('returns null for single line', () => {
    expect(parseDevToolsActivePort('9222')).toBeNull()
  })

  test('returns null for empty string', () => {
    expect(parseDevToolsActivePort('')).toBeNull()
  })

  test('returns null for invalid port', () => {
    expect(parseDevToolsActivePort('abc\n/devtools/browser/123')).toBeNull()
  })

  test('returns null for port 0', () => {
    expect(parseDevToolsActivePort('0\n/devtools/browser/123')).toBeNull()
  })

  test('returns null for port > 65535', () => {
    expect(parseDevToolsActivePort('99999\n/devtools/browser/123')).toBeNull()
  })

  test('returns null for invalid ws path', () => {
    expect(parseDevToolsActivePort('9222\n/some/other/path')).toBeNull()
  })
})


