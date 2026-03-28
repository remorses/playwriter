/// <reference types="vitest/config" />
import fs from 'node:fs'
import { spiceflowPlugin } from 'spiceflow/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'

/**
 * Workaround for Vite 7 + @vitejs/plugin-rsc: the built-in vite:asset load
 * hook uses a regex `/(\?|&)raw(?:&|$)/` that doesn't match when query params
 * get normalized to `?raw=` (URLSearchParams.toString() adds the `=`).
 * This plugin runs first and handles ?raw imports for non-JS files explicitly.
 */
function rawImportPlugin(): Plugin {
  return {
    name: 'raw-import-fix',
    enforce: 'pre',
    load(id) {
      // Match ?raw or ?raw= (with optional trailing = from URL normalization)
      if (!/[?&]raw(?:=|&|$)/.test(id)) {
        return
      }
      const file = id.replace(/[?#].*$/, '')
      // Only handle non-JS files — let Vite handle JS/TS ?raw normally
      if (/\.[cm]?[jt]sx?$/.test(file)) {
        return
      }
      return `export default ${JSON.stringify(fs.readFileSync(file, 'utf-8'))}`
    },
  }
}

export default defineConfig({
  clearScreen: false,
  test: {
    pool: 'threads',
    exclude: ['**/dist/**', '**/esm/**', '**/node_modules/**', '**/e2e/**'],
    poolOptions: {
      threads: {
        isolate: false,
      },
    },
  },
  plugins: [
    rawImportPlugin(),
    spiceflowPlugin({ entry: './src/main.tsx' }),
    tsconfigPaths(),
    tailwindcss(),
  ],
})
