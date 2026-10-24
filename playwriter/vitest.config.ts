import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 60000, // 60 seconds for Chrome startup
    hookTimeout: 30000,
    exclude: ['dist', 'dist/**/*', 'node_modules/**'],
    setupFiles: ['./vitest.setup.ts'],

    env: {
      PLAYWRITER_NODE_ENV: 'development',
      PLAYWRITER_TELEMETRY: '0',
      // Keep test relays out of ~/.playwriter: a relay truncates its logs on start,
      // which would wipe the logs of the user's live relay (e.g. security.test.ts)
      PLAYWRITER_LOG_FILE_PATH: 'tmp/test-relay-server.log',
      PLAYWRITER_CDP_LOG_FILE_PATH: 'tmp/test-cdp.jsonl',
    },
  },
})
