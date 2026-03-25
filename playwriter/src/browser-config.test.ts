import { describe, expect, it } from 'vitest'
import {
  getBrowserExecutableCandidates,
  resolveBrowserExecutablePath,
  shouldUseHeadlessByDefault,
} from './browser-config.js'

describe('getBrowserExecutableCandidates', () => {
  it('prefers Chrome for Testing over Chromium on macOS', () => {
    const candidates = getBrowserExecutableCandidates({
      platform: 'darwin',
      env: {},
      homeDir: '/Users/test',
    })

    expect(candidates[0]).toBe('/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')
    expect(candidates).toContain('/Applications/Chromium.app/Contents/MacOS/Chromium')
    expect(candidates).not.toContain('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
  })

  it('prefers Chrome for Testing over Chromium on Linux', () => {
    const candidates = getBrowserExecutableCandidates({
      platform: 'linux',
      env: {
        PATH: '/opt/google/chrome-for-testing:/usr/local/bin:/usr/bin',
      },
      homeDir: '/home/test',
    })

    expect(candidates[0]).toBe('/opt/google/chrome-for-testing/chrome')
    expect(candidates).toContain('/usr/bin/chromium')
    expect(candidates).not.toContain('/usr/bin/google-chrome')
  })
})

describe('resolveBrowserExecutablePath', () => {
  it('prefers explicit browser path over env and defaults', () => {
    const existingPaths = new Set<string>(['/custom/browser', '/from-env/browser'])
    const resolvedPath = resolveBrowserExecutablePath({
      browserPath: '/custom/browser',
      env: {
        PLAYWRITER_BROWSER_PATH: '/from-env/browser',
      },
      platform: 'linux',
      homeDir: '/home/test',
      existsSync: (filePath) => {
        return existingPaths.has(filePath)
      },
    })

    expect(resolvedPath).toBe('/custom/browser')
  })

  it('uses PLAYWRITER_BROWSER_PATH when explicit browser path is omitted', () => {
    const existingPaths = new Set<string>(['/from-env/browser'])
    const resolvedPath = resolveBrowserExecutablePath({
      env: {
        PLAYWRITER_BROWSER_PATH: '/from-env/browser',
      },
      platform: 'linux',
      homeDir: '/home/test',
      existsSync: (filePath) => {
        return existingPaths.has(filePath)
      },
    })

    expect(resolvedPath).toBe('/from-env/browser')
  })

  it('falls back to the first existing default candidate', () => {
    const existingPaths = new Set<string>(['/usr/bin/chromium'])
    const resolvedPath = resolveBrowserExecutablePath({
      env: {},
      platform: 'linux',
      homeDir: '/home/test',
      existsSync: (filePath) => {
        return existingPaths.has(filePath)
      },
    })

    expect(resolvedPath).toBe('/usr/bin/chromium')
  })

  it('throws a helpful error when no supported browser is found', () => {
    expect(() => {
      resolveBrowserExecutablePath({
        env: {},
        platform: 'linux',
        homeDir: '/home/test',
        existsSync: () => false,
      })
    }).toThrowError(/Searched paths:\n- \/opt\/google\/chrome-for-testing\/chrome/)
  })
})

describe('shouldUseHeadlessByDefault', () => {
  it('defaults to headless on Linux without a display server', () => {
    expect(
      shouldUseHeadlessByDefault({
        platform: 'linux',
        env: {},
      }),
    ).toBe(true)
  })

  it('does not default to headless when DISPLAY is present', () => {
    expect(
      shouldUseHeadlessByDefault({
        platform: 'linux',
        env: { DISPLAY: ':0' },
      }),
    ).toBe(false)
  })

  it('does not force headless on macOS', () => {
    expect(
      shouldUseHeadlessByDefault({
        platform: 'darwin',
        env: {},
      }),
    ).toBe(false)
  })
})
