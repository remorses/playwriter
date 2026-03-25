import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { EXTENSION_IDS } from './utils.js'
import { getBrowserLaunchArgs, getDefaultBrowserUserDataDir } from './browser-launch.js'

describe('getDefaultBrowserUserDataDir', () => {
  it('stores the managed browser profile under ~/.playwriter', () => {
    expect(getDefaultBrowserUserDataDir()).toBe(path.join(os.homedir(), '.playwriter', 'browser-profile'))
  })
})

describe('getBrowserLaunchArgs', () => {
  const extensionPath = '/extensions/playwriter'
  const userDataDir = '/profiles/playwriter'

  it('loads only the packaged extension and the dedicated profile', () => {
    const args = getBrowserLaunchArgs({
      extensionPath,
      userDataDir,
      headless: false,
    })

    expect(args).toContain(`--user-data-dir=${userDataDir}`)
    expect(args).toContain(`--disable-extensions-except=${extensionPath}`)
    expect(args).toContain(`--load-extension=${extensionPath}`)
    expect(args).toContain('--no-first-run')
    expect(args).toContain('--no-default-browser-check')
    expect(args).not.toContain('--headless=new')
  })

  it('adds headless and sandbox override flags when requested', () => {
    const args = getBrowserLaunchArgs({
      extensionPath,
      userDataDir,
      headless: true,
      noSandbox: true,
    })

    expect(args).toContain('--headless=new')
    expect(args).toContain('--no-sandbox')
    expect(args).toContain('--disable-setuid-sandbox')
  })

  it('includes recording-friendly allowlisted extension flags for all known ids', () => {
    const args = getBrowserLaunchArgs({
      extensionPath,
      userDataDir,
      headless: false,
    })

    expect(args).toContain('--auto-accept-this-tab-capture')
    for (const extensionId of EXTENSION_IDS) {
      expect(args).toContain(`--allowlisted-extension-id=${extensionId}`)
    }
  })
})
