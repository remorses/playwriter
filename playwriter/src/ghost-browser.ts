/**
 * Ghost Browser API integration for Playwriter
 *
 * Shared code for both executor (Node.js) and extension (Chrome) environments.
 * See extension/src/ghost-browser-api.d.ts for full API documentation.
 */

// =============================================================================
// Constants - same values as in Ghost Browser
// =============================================================================

export const GHOST_PUBLIC_API_CONSTANTS = {
  NEW_TEMPORARY_IDENTITY: 'OpenInNewSession',
  DEFAULT_IDENTITY: '',
  MAX_TEMPORARY_IDENTITIES: 25,
} as const

export const GHOST_PROXIES_CONSTANTS = {
  DIRECT_PROXY: '8f513494-8cf5-41c7-b318-936392222104',
  SYSTEM_PROXY: '2485b989-7ffb-4442-a45a-d7f9a10c6171',
} as const

export const GHOST_PROJECTS_CONSTANTS = {
  PROJECT_ID_HOME: 'f0673216-13b9-48be-aa41-90763e229e78',
  PROJECT_ID_UNSAVED: 'fe061488-8a8e-40f0-9e5e-93a1a5e2c273',
  SESSIONS_MAX: 25,
  NEW_SESSION: 'OpenInNewSession',
  GLOBAL_SESSION: '',
} as const

// =============================================================================
// Types
// =============================================================================

export type GhostBrowserNamespace = 'ghostPublicAPI' | 'ghostProxies' | 'projects'

export type GhostBrowserCommandParams = {
  namespace: GhostBrowserNamespace
  method: string
  args: unknown[]
}

export type GhostBrowserCommandResult = { success: true; result: unknown } | { success: false; error: string }

/**
 * Function signature for sending ghost-browser commands.
 * In executor: sends via CDP session
 * In extension: calls chrome.* APIs directly
 */
export type SendGhostBrowserCommand = (
  namespace: GhostBrowserNamespace,
  method: string,
  args: unknown[],
) => Promise<unknown>

// =============================================================================
// Executor: Chrome object factory
// =============================================================================

/**
 * Creates a proxy object for a Ghost Browser API namespace.
 * Constants are returned directly, methods are forwarded via sendCommand.
 */
function createGhostBrowserProxy(
  namespace: GhostBrowserNamespace,
  constants: Record<string, unknown>,
  sendCommand: SendGhostBrowserCommand,
) {
  return new Proxy(constants, {
    get(target, prop: string) {
      // Return constants directly (no await needed)
      if (prop in target) {
        return target[prop]
      }
      // Return function that sends ghost-browser command
      return (...args: unknown[]) => sendCommand(namespace, prop, args)
    },
  })
}

/**
 * Creates the chrome object with Ghost Browser API namespaces for the executor sandbox.
 * Mirrors the exact shape of chrome.ghostPublicAPI, chrome.ghostProxies, chrome.projects.
 *
 * @param sendCommand - Function to send commands to the extension
 */
export function createGhostBrowserChrome(sendCommand: SendGhostBrowserCommand) {
  return {
    ghostPublicAPI: createGhostBrowserProxy('ghostPublicAPI', GHOST_PUBLIC_API_CONSTANTS, sendCommand),
    ghostProxies: createGhostBrowserProxy('ghostProxies', GHOST_PROXIES_CONSTANTS, sendCommand),
    projects: createGhostBrowserProxy('projects', GHOST_PROJECTS_CONSTANTS, sendCommand),
  }
}

// =============================================================================
// Extension: Command handler
// =============================================================================

/**
 * Handles ghost-browser commands in the extension.
 * Calls the appropriate chrome.* API and returns the result.
 *
 * @param params - Command parameters (namespace, method, args)
 * @param chromeApi - The chrome object (passed to avoid global dependency)
 * @returns Result object with success/error status
 */
export async function handleGhostBrowserCommand(
  params: GhostBrowserCommandParams,
  chromeApi: typeof chrome,
): Promise<GhostBrowserCommandResult> {
  const { namespace, method, args } = params

  try {
    const api = (chromeApi as any)[namespace]
    if (!api) {
      return {
        success: false,
        error: `chrome.${namespace} not available (not running in Ghost Browser?)`,
      }
    }

    const fn = api[method]
    if (typeof fn !== 'function') {
      // Check if it's a constant/property
      if (method in api) {
        return { success: true, result: api[method] }
      }
      return {
        success: false,
        error: `chrome.${namespace}.${method} is not a function or property`,
      }
    }

    // Ghost Browser APIs use callback pattern, wrap in Promise
    const result = await new Promise((resolve, reject) => {
      fn.call(api, ...args, (result: unknown) => {
        if (chromeApi.runtime.lastError) {
          reject(new Error(chromeApi.runtime.lastError.message))
        } else {
          resolve(result)
        }
      })
    })

    return { success: true, result }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}
