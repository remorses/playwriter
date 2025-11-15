import { startRelayServer } from '../src/extension/cdp-relay.js'

async function main() {
  const server = await startRelayServer({ port: 9988 })

  console.log('Server running. Press Ctrl+C to stop.')

}

main().catch(console.error)
