/**
 * Consolidated build script for all client-side JavaScript bundles.
 *
 * These bundles are injected into pages via CDP Runtime.evaluate or page.evaluate().
 * All bundles are built as browser-targeted IIFEs that expose their APIs on globalThis.
 *
 * Injection flow (see react-source.ts, page-markdown.ts for examples):
 * 1. Bundle is read from dist/*.js via fs.readFileSync (cached after first read)
 * 2. Check if already injected: `await page.evaluate(() => !!globalThis.__name)`
 * 3. If not present, inject: `await page.evaluate(code)` or `cdp.send('Runtime.evaluate', { expression: code })`
 * 4. Use the exposed global in subsequent evaluate calls: `globalThis.__readability`, `globalThis.__bippy`, etc.
 *
 * Each bundle uses a separate Bun.build() call (not multiple entrypoints in one call)
 * to ensure fully self-contained output with no shared chunks.
 *
 * Two types of bundles:
 * 1. Source file bundles - directly bundle a TypeScript source file
 * 2. Wrapper bundles - create entry code that imports from npm packages and exposes on globalThis
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.join(__dirname, '..', 'dist')
const srcDir = path.join(__dirname, '..', 'src')

interface SourceBundle {
  name: string
  type: 'source'
  entry: string // relative to src/
}

interface WrapperBundle {
  name: string
  type: 'wrapper'
  code: string
}

type BundleConfig = SourceBundle | WrapperBundle

const BUNDLES: BundleConfig[] = [
  // Source file bundles
  {
    name: 'a11y-client',
    type: 'source',
    entry: 'a11y-client.ts',
  },

  // Wrapper bundles (npm packages → globalThis)
  {
    name: 'selector-generator',
    type: 'wrapper',
    code: `
import { createSelectorGenerator, toLocator } from '@mizchi/selector-generator'

globalThis.__selectorGenerator = { createSelectorGenerator, toLocator }
`,
  },
  {
    name: 'bippy',
    type: 'wrapper',
    code: `
import { getFiberFromHostInstance, getDisplayName, traverseFiber, isCompositeFiber, isHostFiber } from 'bippy'
import { getSource, getOwnerStack, normalizeFileName, isSourceFile } from 'bippy/source'

globalThis.__bippy = {
  getFiberFromHostInstance,
  getDisplayName,
  traverseFiber,
  isCompositeFiber,
  isHostFiber,
  getSource,
  getOwnerStack,
  normalizeFileName,
  isSourceFile,
}
`,
  },
  {
    name: 'readability',
    type: 'wrapper',
    code: `
import { Readability, isProbablyReaderable } from '@mozilla/readability'

globalThis.__readability = { Readability, isProbablyReaderable }
`,
  },
]

async function buildBundle(config: BundleConfig): Promise<void> {
  const startTime = Date.now()
  const entryPathConfig: { entryPath: string; cleanupEntry: boolean } = (() => {
    if (config.type === 'source') {
      return {
        entryPath: path.join(srcDir, config.entry),
        cleanupEntry: false,
      }
    }

    // Create temporary entry file for wrapper bundles
    const entrySuffix = `${process.pid}-${Date.now()}`
    const entryPath = path.join(distDir, `_${config.name}-entry-${entrySuffix}.js`)
    fs.writeFileSync(entryPath, config.code)
    return {
      entryPath,
      cleanupEntry: true,
    }
  })()
  const { entryPath, cleanupEntry } = entryPathConfig

  const result = await Bun.build({
    entrypoints: [entryPath],
    target: 'browser',
    format: 'iife',
    define: {
      'process.env.NODE_ENV': '"development"',
    },
  })

  // Cleanup temporary entry file
  if (cleanupEntry && fs.existsSync(entryPath)) {
    fs.unlinkSync(entryPath)
  }

  if (!result.success) {
    console.error(`Bundle errors for ${config.name}:`, result.logs)
    throw new Error(`Failed to bundle ${config.name}`)
  }

  const bundledCode = await result.outputs[0].text()
  const outputPath = path.join(distDir, `${config.name}.js`)
  fs.writeFileSync(outputPath, bundledCode)

  const sizeKb = Math.round(bundledCode.length / 1024)
  const timeMs = Date.now() - startTime
  console.log(`  ${config.name}.js (${sizeKb}kb) [${timeMs}ms]`)
}

async function main() {
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true })
  }

  console.log('Building client bundles...')

  // Each buildBundle() call runs its own Bun.build() with a single entrypoint,
  // so parallel execution is safe - no shared chunks between bundles
  await Promise.all(BUNDLES.map(buildBundle))

  console.log(`Done! Built ${BUNDLES.length} bundles.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
