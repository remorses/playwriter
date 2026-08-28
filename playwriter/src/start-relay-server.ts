import { createFileLogger } from './create-logger.js'
import { startRelayServer } from './relay-server-runtime.js'
import { LOG_CDP_FILE_PATH } from './utils.js'

process.title = 'playwriter-ws-server'

const logger = createFileLogger()

process.on('uncaughtException', async (err) => {
  await logger.error('Uncaught Exception:', err)
  process.exit(1)
})

process.on('unhandledRejection', async (reason) => {
  await logger.error('Unhandled Rejection:', reason)
  process.exit(1)
})

process.on('exit', async (code) => {
  await logger.log(`Process exiting with code: ${code}`)
})

async function run(): Promise<void> {
  const server = await startRelayServer({ logger })

  console.log('CDP Relay Server running. Press Ctrl+C to stop.')
  console.log('Logs are being written to:', logger.logFilePath)
  console.log('CDP logs are being written to:', LOG_CDP_FILE_PATH)

  process.on('SIGINT', () => {
    console.log('\nShutting down...')
    server.close()
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    console.log('\nShutting down...')
    server.close()
    process.exit(0)
  })
}

run().catch(logger.error)
