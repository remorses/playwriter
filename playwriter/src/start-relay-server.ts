import { startPlayWriterCDPRelayServer } from './cdp-relay.js'
import { createFileLogger } from './create-logger.js'
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

export async function startServer({
  port = 19988,
  host = '127.0.0.1',
  token,
}: { port?: number; host?: string; token?: string } = {}) {
  const server = await startPlayWriterCDPRelayServer({ port, host, token, logger })

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

  return server
}
startServer().catch(logger.error)
