import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { getInstalledPlaywriterPackageDir } from './package-paths.js'

describe('getInstalledPlaywriterPackageDir', () => {
  it('resolves the current package directory when running from source', () => {
    const packageDir = getInstalledPlaywriterPackageDir()

    expect(fs.existsSync(path.join(packageDir, 'package.json'))).toBe(true)
    expect(path.basename(packageDir)).toBe('playwriter')
  })
})
