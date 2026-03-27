/// <reference types="vitest/config" />
import { spiceflowPlugin } from 'spiceflow/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'

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
    spiceflowPlugin({ entry: './src/main.tsx' }),
    tsconfigPaths(),
    tailwindcss(),
  ],
})
