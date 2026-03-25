import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from '@xmorse/playwright-core'

type BrowserLookupOptions = {
  browserPath?: string
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  homeDir?: string
  existsSync?: (filePath: string) => boolean
}

function expandHomeDirectory({ filePath, homeDir }: { filePath: string; homeDir: string }): string {
  if (!filePath.startsWith('~/')) {
    return filePath
  }
  return path.join(homeDir, filePath.slice(2))
}

function dedupePaths(pathsToCheck: string[]): string[] {
  return Array.from(new Set(pathsToCheck))
}

function getPlaywrightChromiumCandidate(): string[] {
  const executablePath = chromium.executablePath()
  if (!executablePath) {
    return []
  }
  return [executablePath]
}

function getPathEntries(env: NodeJS.ProcessEnv): string[] {
  const rawPath = env.PATH || env.Path || ''
  return rawPath
    .split(path.delimiter)
    .filter(Boolean)
    .map((entry) => {
      return entry.trim()
    })
}

function getExecutableNames(platform: NodeJS.Platform): string[] {
  if (platform === 'win32') {
    return ['chrome.exe', 'chromium.exe']
  }
  return ['chrome', 'chromium', 'chromium-browser']
}

function getPathExecutableCandidates({
  platform,
  env,
}: {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
}): string[] {
  const executableNames = getExecutableNames(platform)
  return getPathEntries(env).flatMap((entry) => {
    return executableNames.map((name) => {
      return path.join(entry, name)
    })
  })
}

export function getBrowserExecutableCandidates({
  platform = os.platform(),
  env = process.env,
  homeDir = os.homedir(),
}: Omit<BrowserLookupOptions, 'browserPath' | 'existsSync'> = {}): string[] {
  const platformCandidates = (() => {
    if (platform === 'darwin') {
      return [
        '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        '~/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '~/Applications/Chromium.app/Contents/MacOS/Chromium',
      ]
    }

    if (platform === 'win32') {
      const localAppData = env.LOCALAPPDATA || ''
      const programFiles = env.PROGRAMFILES || 'C:\\Program Files'
      const programFilesX86 = env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)'

      return [
        path.join(programFiles, 'Google', 'Chrome for Testing', 'Application', 'chrome.exe'),
        path.join(programFilesX86, 'Google', 'Chrome for Testing', 'Application', 'chrome.exe'),
        path.join(localAppData, 'Google', 'Chrome for Testing', 'Application', 'chrome.exe'),
        path.join(programFiles, 'Chromium', 'Application', 'chromium.exe'),
        path.join(programFilesX86, 'Chromium', 'Application', 'chromium.exe'),
        path.join(localAppData, 'Chromium', 'Application', 'chromium.exe'),
      ]
    }

    return [
      '/opt/google/chrome-for-testing/chrome',
      '/usr/local/bin/chrome',
      '/usr/bin/chrome',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
    ]
  })()

  const pathCandidates = getPathExecutableCandidates({ platform, env })
  return dedupePaths(
    [...platformCandidates, ...pathCandidates, ...getPlaywrightChromiumCandidate()].map((filePath) => {
      return expandHomeDirectory({ filePath, homeDir })
    }),
  )
}

export function resolveBrowserExecutablePath({
  browserPath,
  env = process.env,
  platform = os.platform(),
  homeDir = os.homedir(),
  existsSync = fs.existsSync,
}: BrowserLookupOptions = {}): string {
  const explicitPath = browserPath?.trim()
  if (explicitPath) {
    const resolvedExplicitPath = expandHomeDirectory({ filePath: explicitPath, homeDir })
    if (!existsSync(resolvedExplicitPath)) {
      throw new Error(`Browser binary not found at: ${resolvedExplicitPath}`)
    }
    return resolvedExplicitPath
  }

  const envPath = env.PLAYWRITER_BROWSER_PATH?.trim()
  if (envPath) {
    const resolvedEnvPath = expandHomeDirectory({ filePath: envPath, homeDir })
    if (!existsSync(resolvedEnvPath)) {
      throw new Error(`PLAYWRITER_BROWSER_PATH does not exist: ${resolvedEnvPath}`)
    }
    return resolvedEnvPath
  }

  const candidates = getBrowserExecutableCandidates({ platform, env, homeDir })
  const resolvedPath = candidates.find((candidate) => {
    return existsSync(candidate)
  })

  if (resolvedPath) {
    return resolvedPath
  }

  const searchedPathsText = candidates.map((candidate) => {
    return `- ${candidate}`
  })

  throw new Error(
    'Could not find a supported browser binary. Install Chrome for Testing or Chromium, or pass a binary path to `playwriter browser start`.' +
      `\n\nSearched paths:\n${searchedPathsText.join('\n')}`,
  )
}

export function shouldUseHeadlessByDefault({
  platform = os.platform(),
  env = process.env,
}: Omit<BrowserLookupOptions, 'browserPath' | 'homeDir' | 'existsSync'> = {}): boolean {
  if (platform !== 'linux') {
    return false
  }

  return !env.DISPLAY && !env.WAYLAND_DISPLAY
}

export function getBrowserExecutablePath(browserPath?: string): string {
  return resolveBrowserExecutablePath({ browserPath })
}
