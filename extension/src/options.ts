import {
  DEFAULT_RELAY_HOST,
  DEFAULT_RELAY_PORT,
  getRelayConfig,
  normalizeRelayConfig,
  setRelayConfig,
} from './relay-config'

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) {
    throw new Error(`Missing options form element: ${selector}`)
  }
  return element
}

const hostInput = requireElement<HTMLInputElement>('#relay-host')
const portInput = requireElement<HTMLInputElement>('#relay-port')
const tokenInput = requireElement<HTMLInputElement>('#relay-token')
const statusEl = requireElement<HTMLParagraphElement>('#status')
const form = requireElement<HTMLFormElement>('#relay-form')
const resetButton = requireElement<HTMLButtonElement>('#reset-defaults')

function setStatus(message: string, kind: 'success' | 'error' = 'success'): void {
  statusEl.textContent = message
  statusEl.dataset.kind = kind
}

async function populateForm(): Promise<void> {
  const relayConfig = await getRelayConfig()
  hostInput.value = relayConfig.host
  portInput.value = String(relayConfig.port)
  tokenInput.value = relayConfig.token || ''
}

form.addEventListener('submit', async (event) => {
  event.preventDefault()

  const config = normalizeRelayConfig({
    host: hostInput.value,
    port: portInput.value,
    token: tokenInput.value,
  })

  await setRelayConfig(config)
  hostInput.value = config.host
  portInput.value = String(config.port)
  tokenInput.value = config.token || ''
  setStatus(`Saved. Relay endpoint is ${config.host}:${config.port}.`)
})

resetButton.addEventListener('click', async () => {
  await setRelayConfig({ host: DEFAULT_RELAY_HOST, port: DEFAULT_RELAY_PORT, token: undefined })
  hostInput.value = DEFAULT_RELAY_HOST
  portInput.value = String(DEFAULT_RELAY_PORT)
  tokenInput.value = ''
  setStatus(`Reset to defaults (${DEFAULT_RELAY_HOST}:${DEFAULT_RELAY_PORT}).`)
})

void populateForm().catch((error) => {
  setStatus(`Failed to load settings: ${(error as Error).message}`, 'error')
})
