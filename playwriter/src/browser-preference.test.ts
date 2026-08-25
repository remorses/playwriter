import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  clearDefaultBrowserKey,
  loadDefaultBrowserKey,
  loadPreferredBrowserKey,
  resolvePreferredBrowserKey,
  saveDefaultBrowserKey,
} from './browser-preference.js'

function createTestDirectory(prefix: string): string {
  const root = path.join(process.cwd(), 'tmp')
  fs.mkdirSync(root, { recursive: true })
  return fs.mkdtempSync(path.join(root, prefix))
}

describe('browser preference', () => {
  test('persists and clears a stable browser key', () => {
    const directory = createTestDirectory('browser-preference-')
    const preferencePath = path.join(directory, 'browser.json')

    try {
      expect(loadDefaultBrowserKey(preferencePath)).toBeUndefined()
      saveDefaultBrowserKey({ browser: ' install:Chrome:ordinary ', preferencePath })
      expect(loadDefaultBrowserKey(preferencePath)).toBe('install:Chrome:ordinary')
      expect(clearDefaultBrowserKey(preferencePath)).toBe(true)
      expect(clearDefaultBrowserKey(preferencePath)).toBe(false)
    } finally {
      fs.rmSync(directory, { recursive: true })
    }
  })

  test('uses CLI, environment, and stored keys in explicit priority order', () => {
    expect(resolvePreferredBrowserKey({
      cliKey: 'install:Chrome:cli',
      environmentKey: 'install:Chrome:environment',
      storedKey: 'install:Chrome:stored',
    })).toBe('install:Chrome:cli')
    expect(resolvePreferredBrowserKey({
      environmentKey: 'install:Chrome:environment',
      storedKey: 'install:Chrome:stored',
    })).toBe('install:Chrome:environment')
    expect(resolvePreferredBrowserKey({ storedKey: 'install:Chrome:stored' })).toBe('install:Chrome:stored')
    expect(resolvePreferredBrowserKey({})).toBeUndefined()
  })

  test('only reads a malformed preference when no higher-priority key exists', () => {
    const directory = createTestDirectory('browser-preference-invalid-')
    const preferencePath = path.join(directory, 'browser.json')

    try {
      fs.writeFileSync(preferencePath, JSON.stringify({ version: 1, browser: '' }))
      expect(loadPreferredBrowserKey({
        cliKey: 'install:Chrome:cli',
        environmentKey: 'install:Chrome:environment',
        preferencePath,
      })).toBe('install:Chrome:cli')
      expect(loadPreferredBrowserKey({
        environmentKey: 'install:Chrome:environment',
        preferencePath,
      })).toBe('install:Chrome:environment')
      expect(() => {
        return loadPreferredBrowserKey({ environmentKey: '', preferencePath })
      }).toThrow(`Invalid Playwriter browser preference: ${preferencePath}`)
    } finally {
      fs.rmSync(directory, { recursive: true })
    }
  })
})
