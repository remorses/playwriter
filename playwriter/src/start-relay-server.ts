import { startPlayWriterCDPRelayServer, type RelayServer } from './cdp-relay.js'
import { createFileLogger } from './create-logger.js'
import { installProcessGuard } from './process-guard.js'
import { defaultSessionCatalogPath } from './session-catalog.js'
import { RELAY_PORT, waitForRelayVersion } from './relay-client.js'
import { flushTelemetry, startRelayTelemetry } from './telemetry.js'
import { LOG_CDP_FILE_PATH } from './utils.js'

process.title = 'playwriter-ws-server'

const logger = createFileLogger()

installProcessGuard({ logger })

export async function startServer({
  port = RELAY_PORT,
  host = '127.0.0.1',
  token,
}: { port?: number; host?: string; token?: string } = {}) {
  let server: RelayServer | undefined
  const shutdown = async () => {
    console.log('\nShutting down...')
    server?.close()
    await flushTelemetry()
    process.exit(0)
  }
  try {
    server = await startPlayWriterCDPRelayServer({
      port,
      host,
      token,
      logger,
      sessionsFile: defaultSessionCatalogPath(port),
      // A newer CLI drained this relay to replace it.
      onDrained: () => void shutdown(),
    })
  } catch (err: unknown) {
    // When two relay processes race to start (issue #75), the loser gets
    // EADDRINUSE. Check if the winner is a valid relay and exit cleanly
    // instead of crashing with a scary error in the logs.
    const errWithCode = err as NodeJS.ErrnoException
    if (errWithCode?.code === 'EADDRINUSE') {
      // The winner may have bound the port but not be ready to answer /version
      // yet, so poll for up to 2 seconds before giving up.
      const version = await waitForRelayVersion({ port })
      if (version) {
        await logger.log(`Another relay (v${version}) already bound to port ${port}, exiting gracefully`)
        process.exit(0)
      }
      await logger.error(`Port ${port} is in use by a non-relay process`)
      process.exit(1)
    }
    throw err
  }

  console.log('CDP Relay Server running. Press Ctrl+C to stop.')
  console.log('Logs are being written to:', logger.logFilePath)
  console.log('CDP logs are being written to:', LOG_CDP_FILE_PATH)

  startRelayTelemetry()

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  return server
}
startServer({ token: process.env.PLAYWRITER_TOKEN }).catch((error) => {
  void logger.error('Failed to start relay server:', error)
  process.exit(1)
})
