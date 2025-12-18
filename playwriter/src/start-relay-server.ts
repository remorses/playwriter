import { startPlayWriterCDPRelayServer } from './extension/cdp-relay.js'
import { createFileLogger } from './create-logger.js'
import { getLogFilePath } from './utils.js'

const logFilePath = getLogFilePath()
process.title = 'playwriter-ws-server'

const logger = createFileLogger({ logFilePath })

process.on('uncaughtException', async (err) => {
  await logger.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', async (reason) => {
  await logger.error('Unhandled Rejection:', reason);
  process.exit(1);
});

process.on('exit', async (code) => {
  await logger.log(`Process exiting with code: ${code}`);
});


export async function startServer({ port = 19988 }: { port?: number } = {}) {
  const server = await startPlayWriterCDPRelayServer({ port, logger })

  console.log('CDP Relay Server running. Press Ctrl+C to stop.')
  console.log('Logs are being written to:', logFilePath)

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
