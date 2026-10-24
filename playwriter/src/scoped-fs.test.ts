/**
 * Regression tests for session-scoped filesystem resolution and session cwd reporting.
 */

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  ExecutorManager,
  type SessionMetadata,
  isWindowsAbsolutePath,
  resolveSessionCwd,
} from './executor.js'
import { createScopedFS } from './scoped-fs.js'

function createTempDir(prefix: string): string {
  const tempRoot = path.join(process.cwd(), 'tmp')
  fs.mkdirSync(tempRoot, { recursive: true })
  return fs.mkdtempSync(path.join(tempRoot, prefix))
}

describe('ScopedFS', () => {
  test('resolves relative paths from the session cwd instead of the relay cwd', () => {
    const sessionDir = createTempDir('scoped-fs-session-')
    const relayDir = createTempDir('scoped-fs-relay-')
    const originalCwd = process.cwd()

    try {
      process.chdir(relayDir)

      const scopedFs = createScopedFS([sessionDir], sessionDir)
      scopedFs.writeFileSync('note.txt', 'hello from session')

      expect(fs.readFileSync(path.join(sessionDir, 'note.txt'), 'utf-8')).toBe('hello from session')
      expect(fs.existsSync(path.join(relayDir, 'note.txt'))).toBe(false)
    } finally {
      process.chdir(originalCwd)
      fs.rmSync(sessionDir, { recursive: true, force: true })
      fs.rmSync(relayDir, { recursive: true, force: true })
    }
  })
})

describe('ScopedFS EPERM message', () => {
  test('includes allowed directories in the error message', () => {
    const sessionDir = createTempDir('scoped-fs-eperm-')
    try {
      const scopedFs = createScopedFS([sessionDir], sessionDir)
      expect(() => {
        scopedFs.readFileSync('/etc/passwd')
      }).toThrow(new RegExp(`allowed: .*${sessionDir.replace(/[/\\]/g, '.')}`))
    } finally {
      fs.rmSync(sessionDir, { recursive: true, force: true })
    }
  })
})

describe('isWindowsAbsolutePath', () => {
  test('detects Windows absolute paths', () => {
    expect(isWindowsAbsolutePath('C:\\Users\\me')).toBe(true)
    expect(isWindowsAbsolutePath('D:/foo/bar')).toBe(true)
    expect(isWindowsAbsolutePath('c:\\lower')).toBe(true)
    expect(isWindowsAbsolutePath('Z:/end')).toBe(true)
  })

  test('rejects non-Windows paths', () => {
    expect(isWindowsAbsolutePath('/home/user')).toBe(false)
    expect(isWindowsAbsolutePath('./relative')).toBe(false)
    expect(isWindowsAbsolutePath('file.txt')).toBe(false)
    expect(isWindowsAbsolutePath('')).toBe(false)
  })
})

describe('resolveSessionCwd', () => {
  test('returns null cwd and null warning for undefined input', () => {
    expect(resolveSessionCwd(undefined)).toEqual({ cwd: null, warning: null })
  })

  test('resolves POSIX absolute paths directly', () => {
    const result = resolveSessionCwd('/home/user/project')
    expect(result.cwd).toBe('/home/user/project')
    expect(result.warning).toBeNull()
  })

  test('returns warning for Windows paths on POSIX without WSL mount', () => {
    // On macOS/Linux without WSL, /mnt/x won't exist for most drive letters
    // Use an unlikely drive letter to ensure no false positive
    const result = resolveSessionCwd('X:\\Users\\me\\project')
    if (process.platform === 'win32') {
      // On Windows, Windows paths are native and should resolve normally
      expect(result.cwd).toBeTruthy()
      expect(result.warning).toBeNull()
    } else {
      // On POSIX without /mnt/x, should fall back to null with warning
      expect(result.cwd).toBeNull()
      expect(result.warning).toContain('Windows path')
      expect(result.warning).toContain('/mnt/x')
    }
  })

  test('returns warning for relative paths', () => {
    const result = resolveSessionCwd('relative/path')
    // On any platform, a bare relative path is suspicious for a session cwd
    // On POSIX it's not absolute, on Windows it's not absolute either
    if (path.isAbsolute('relative/path')) {
      // Shouldn't happen, but guard
      expect(result.cwd).toBeTruthy()
    } else {
      expect(result.cwd).toBeNull()
      expect(result.warning).toContain('not an absolute path')
    }
  })
})

describe('ExecutorManager.listSessions', () => {
  test('includes the resolved cwd for each session', () => {
    const sessionDir = createTempDir('executor-session-')
    const sessionMetadata: SessionMetadata = {
      extensionId: 'profile:test',
      browser: 'Chrome',
      profile: { email: 'test@example.com', id: 'profile-1' },
    }

    try {
      const manager = new ExecutorManager({
        cdpConfig: { port: 19988 },
        logger: {
          log: () => {},
          error: () => {},
        },
      })

      manager.getExecutor({
        sessionId: '7',
        cwd: sessionDir,
        sessionMetadata,
      })

      expect(manager.listSessions()).toEqual([
        {
          id: '7',
          stateKeys: [],
          extensionId: 'profile:test',
          browser: 'Chrome',
          profile: { email: 'test@example.com', id: 'profile-1' },
          cwd: sessionDir,
          tabGroup: null,
          tabGroupColor: null,
          createdAt: expect.any(Number),
          lastActivityAt: null,
        },
      ])
    } finally {
      fs.rmSync(sessionDir, { recursive: true, force: true })
    }
  })
})
