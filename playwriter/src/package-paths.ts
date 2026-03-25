import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export function getInstalledPlaywriterPackageDir(): string {
  const localPackageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const localPackageJsonPath = path.join(localPackageDir, 'package.json')
  if (fs.existsSync(localPackageJsonPath)) {
    return localPackageDir
  }

  const packageJsonPath = require.resolve('playwriter/package.json')
  return path.dirname(packageJsonPath)
}

export function getBundledExtensionPath(): string {
  const packageDir = getInstalledPlaywriterPackageDir()
  const candidates = [
    path.join(packageDir, 'dist', 'extension'),
    path.join(packageDir, '..', 'extension', 'dist'),
  ]

  for (const extensionPath of candidates) {
    const manifestPath = path.join(extensionPath, 'manifest.json')
    if (fs.existsSync(manifestPath)) {
      return extensionPath
    }
  }

  throw new Error(
    `Bundled Playwriter extension not found under ${packageDir}. Rebuild or reinstall the playwriter package.`,
  )
}
