import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

type BrowserPreference = {
  version: 1
  browser: string
}

export function getBrowserPreferencePath(): string {
  return process.env.PLAYWRITER_BROWSER_PREFERENCE_PATH || path.join(os.homedir(), '.playwriter', 'browser.json')
}

export function loadDefaultBrowserKey(preferencePath: string = getBrowserPreferencePath()): string | undefined {
  if (!fs.existsSync(preferencePath)) {
    return undefined
  }

  const parsed: unknown = JSON.parse(fs.readFileSync(preferencePath, 'utf8'))
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Invalid Playwriter browser preference: ${preferencePath}`)
  }

  const preference = parsed as Partial<BrowserPreference>
  if (preference.version !== 1 || typeof preference.browser !== 'string' || !preference.browser.trim()) {
    throw new Error(`Invalid Playwriter browser preference: ${preferencePath}`)
  }
  return preference.browser.trim()
}

export function loadPreferredBrowserKey({
  cliKey,
  environmentKey = process.env.PLAYWRITER_BROWSER,
  preferencePath = getBrowserPreferencePath(),
}: {
  cliKey?: string
  environmentKey?: string
  preferencePath?: string
}): string | undefined {
  const explicitKey = resolvePreferredBrowserKey({ cliKey, environmentKey })
  if (explicitKey) {
    return explicitKey
  }
  return loadDefaultBrowserKey(preferencePath)
}

export function saveDefaultBrowserKey({
  browser,
  preferencePath = getBrowserPreferencePath(),
}: {
  browser: string
  preferencePath?: string
}): void {
  const normalizedBrowser = browser.trim()
  if (!normalizedBrowser) {
    throw new Error('Browser key cannot be empty.')
  }

  fs.mkdirSync(path.dirname(preferencePath), { recursive: true })
  const temporaryPath = `${preferencePath}.${process.pid}.tmp`
  const preference: BrowserPreference = { version: 1, browser: normalizedBrowser }
  fs.writeFileSync(temporaryPath, `${JSON.stringify(preference, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporaryPath, preferencePath)
}

export function clearDefaultBrowserKey(preferencePath: string = getBrowserPreferencePath()): boolean {
  if (!fs.existsSync(preferencePath)) {
    return false
  }
  fs.unlinkSync(preferencePath)
  return true
}

export function resolvePreferredBrowserKey({
  cliKey,
  environmentKey = process.env.PLAYWRITER_BROWSER,
  storedKey,
}: {
  cliKey?: string
  environmentKey?: string
  storedKey?: string
}): string | undefined {
  return [cliKey, environmentKey, storedKey]
    .map((value) => {
      return value?.trim()
    })
    .find((value) => {
      return Boolean(value)
    })
}
