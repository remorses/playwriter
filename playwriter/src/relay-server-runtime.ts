import { startPlayWriterCDPRelayServer, type RelayServer } from './cdp-relay.js'
import type { Logger } from './create-logger.js'
import { waitForRelayVersion } from './relay-client.js'

export async function startRelayServer({
  port = 19988,
  host = '127.0.0.1',
  token: explicitToken,
  logger,
}: {
  port?: number
  host?: string
  token?: string
  logger: Pick<Logger, 'log' | 'error'>
}): Promise<RelayServer> {
  const token = explicitToken ?? process.env.PLAYWRITER_TOKEN
  try {
    return await startPlayWriterCDPRelayServer({ port, host, token, logger })
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
}
