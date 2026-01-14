import { startPlayWriterCDPRelayServer } from './cdp-relay.js'
import { createFileLogger } from './create-logger.js'

process.title = 'playwriter-ws-server'

const logger = createFileLogger()

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


export async function startServer({ port = 19988, host = '127.0.0.1', token, separateWindow = false }: { port?: number; host?: string; token?: string; separateWindow?: boolean } = {}) {
  const server = await startPlayWriterCDPRelayServer({ port, host, token, logger, separateWindow })

  console.log('CDP Relay Server running. Press Ctrl+C to stop.')
  console.log('Logs are being written to:', logger.logFilePath)

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

const separateWindow = !!process.env.PLAYWRITER_SEPARATE_WINDOW
startServer({ separateWindow }).catch(logger.error)
