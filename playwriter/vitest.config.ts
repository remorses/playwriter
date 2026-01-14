import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 60000, // 60 seconds for Chrome startup
    hookTimeout: 30000,
    exclude: ['dist', 'dist/**/*', 'node_modules/**'],
    
    // Run test files sequentially to avoid port conflicts with browser extension tests
    fileParallelism: false,

    env: {
      PLAYWRITER_NODE_ENV: 'development',
    },
  },
})
