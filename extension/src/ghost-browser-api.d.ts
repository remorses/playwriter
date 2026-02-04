/**
 * Ghost Browser Extension APIs Type Definitions
 *
 * Source: Extracted from Ghost Browser.app binary
 * https://ghostbrowser.com/
 *
 * These APIs are available in Playwriter's executor sandbox when running in Ghost Browser.
 * Use for multi-identity automation: managing multiple accounts, rotating proxies, isolated sessions.
 *
 * ## Quick Start
 *
 * ```js
 * // List all identities
 * const identities = await chrome.projects.getIdentitiesList();
 *
 * // Open tab in new temporary identity
 * await chrome.ghostPublicAPI.openTab({
 *   url: 'https://reddit.com',
 *   identity: chrome.ghostPublicAPI.NEW_TEMPORARY_IDENTITY
 * });
 *
 * // Open tab in specific identity
 * await chrome.ghostPublicAPI.openTab({
 *   url: 'https://twitter.com',
 *   identity: identities[0].id
 * });
 *
 * // List and assign proxies
 * const proxies = await chrome.ghostProxies.getList();
 * await chrome.ghostProxies.setTabProxy(tabId, proxies[0].id);
 * await chrome.ghostProxies.setIdentityProxy(identities[0].id, proxies[0].id);
 *
 * // Use direct connection (no proxy)
 * await chrome.ghostProxies.setTabProxy(tabId, chrome.ghostProxies.DIRECT_PROXY);
 * ```
 *
 * ## API Namespaces
 *
 * - `chrome.ghostPublicAPI` - Open tabs in specific identities
 * - `chrome.ghostProxies` - Manage and assign proxies per tab/identity/session (Pro plan only)
 * - `chrome.projects` - List/manage identities, sessions, workspaces
 *
 * ## Use Cases
 *
 * - Managing multiple social media accounts (Reddit, Twitter, etc.)
 * - Web scraping with rotating proxies per tab
 * - Testing with different user sessions simultaneously
 * - Automation requiring isolated cookies/storage per identity
 *
 * ## Plan Requirements
 *
 * - `chrome.ghostPublicAPI` and `chrome.projects` - All plans (including Free)
 * - `chrome.ghostProxies` methods - **Pro plan required** ($46/mo). Free plan only exposes
 *   constants (DIRECT_PROXY, SYSTEM_PROXY). Methods like getList(), add(), setTabProxy()
 *   throw "permission" error on Free/Basic plans.
 *
 * Note: These APIs only work in Ghost Browser. In regular Chrome, calls fail with "not available".
 */

declare namespace chrome {
  // ============================================================================
  // GHOST PUBLIC API (chrome.ghostPublicAPI)
  // ============================================================================

  export namespace ghostPublicAPI {
    /** Maximum number of temporary identities allowed */
    export const MAX_TEMPORARY_IDENTITIES: 25

    /** Use to open tab in new temporary identity. Value: "OpenInNewSession" */
    export const NEW_TEMPORARY_IDENTITY: 'OpenInNewSession'

    /** Empty string representing default identity. Value: "" */
    export const DEFAULT_IDENTITY: ''

    export interface OpenTabParams {
      /** URL to navigate to */
      url?: string
      /** Tab position (0-based index) */
      index?: number
      /** Whether tab should be active (default: true) */
      active?: boolean
      /** Whether tab should be pinned */
      pinned?: boolean
      /** Identity ID, NEW_TEMPORARY_IDENTITY, or DEFAULT_IDENTITY */
      identity?: string
    }

    /**
     * Opens a new tab with Ghost Browser identity support
     * @example
     * chrome.ghostPublicAPI.openTab({
     *   url: 'https://example.com',
     *   identity: chrome.ghostPublicAPI.NEW_TEMPORARY_IDENTITY
     * }, (tabId) => console.log('Opened tab:', tabId))
     */
    export function openTab(
      params: OpenTabParams,
      callback?: (tabId: number) => void
    ): Promise<number>
  }

  // ============================================================================
  // GHOST PROXIES API (chrome.ghostProxies)
  // **Requires Ghost Browser Pro plan.** Free/Basic plans only have constants.
  // ============================================================================

  export namespace ghostProxies {
    /** UUID for direct connection (no proxy) */
    export const DIRECT_PROXY: '8f513494-8cf5-41c7-b318-936392222104'

    /** UUID for system proxy settings */
    export const SYSTEM_PROXY: '2485b989-7ffb-4442-a45a-d7f9a10c6171'

    export interface AddProxyParams {
      /** Display name for the proxy */
      name?: string
      /** Proxy URI (e.g., "http://host:port" or "socks5://host:port") */
      uri: string
      /** Authentication username */
      username?: string
      /** Authentication password */
      password?: string
      /** Timezone for this proxy */
      timezone?: string
      /** Tags for organization */
      tags?: string
    }

    export interface ModifyProxyParams {
      enabled?: boolean
      name?: string
      uri?: string
      username?: string
      password?: string
      timezone?: string
      tags?: string
    }

    export interface GhostProxy {
      id: string
      name: string
      uri: string
      username: string
      password: string
      timezone: string
      tags: string
      enabled: boolean
      index: number
      is_set: boolean
      is_null: boolean
    }

    // Proxy CRUD operations
    export function add(
      proxy: AddProxyParams,
      callback?: (proxy: GhostProxy) => void
    ): Promise<GhostProxy>

    export function import_(
      proxy: AddProxyParams,
      callback?: (proxy: GhostProxy) => void
    ): Promise<GhostProxy>

    export function remove(
      proxy_id: string,
      callback?: (success: boolean) => void
    ): Promise<boolean>

    export function removeAll(callback?: (success: boolean) => void): Promise<boolean>

    export function getList(callback?: (proxies: GhostProxy[]) => void): Promise<GhostProxy[]>

    export function get(
      proxy_id: string,
      callback?: (proxy: GhostProxy) => void
    ): Promise<GhostProxy>

    export function move(
      proxy_id: string,
      new_index: number,
      callback?: (success: boolean) => void
    ): Promise<boolean>

    export function modify(
      proxy_id: string,
      params: ModifyProxyParams,
      callback?: (proxy: GhostProxy) => void
    ): Promise<GhostProxy>

    // Set proxy at different levels
    export function setProjectProxy(
      proxy_id: string,
      keep_overrides: boolean,
      callback?: (success: boolean) => void
    ): Promise<boolean>

    export function setSessionProxy(
      session_id: string,
      proxy_id: string,
      keep_overrides: boolean,
      callback?: (success: boolean) => void
    ): Promise<boolean>

    export function setIdentityProxy(
      identity_id: string,
      proxy_id: string,
      callback?: (success: boolean) => void
    ): Promise<boolean>

    export function setTabProxy(
      tab_id: number,
      proxy_id: string,
      callback?: (success: boolean) => void
    ): Promise<boolean>

    // Get proxy at different levels
    export function getProjectProxy(callback?: (proxy: GhostProxy) => void): Promise<GhostProxy>

    export function getSessionProxy(
      session_id: string,
      callback?: (proxy: GhostProxy) => void
    ): Promise<GhostProxy>

    export function getIdentityProxy(
      identity_id: string,
      callback?: (proxy: GhostProxy) => void
    ): Promise<GhostProxy>

    export function getTabProxy(
      tab_id: number,
      callback?: (proxy: GhostProxy) => void
    ): Promise<GhostProxy>

    // Clear proxy at different levels
    export function clearProjectProxy(
      keep_overrides: boolean,
      callback?: (success: boolean) => void
    ): Promise<boolean>

    export function clearSessionProxy(
      session_id: string,
      keep_overrides: boolean,
      callback?: (success: boolean) => void
    ): Promise<boolean>

    export function clearIdentityProxy(
      identity_id: string,
      callback?: (success: boolean) => void
    ): Promise<boolean>

    export function clearTabProxy(
      tab_id: number,
      callback?: (success: boolean) => void
    ): Promise<boolean>

    // Events
    export const onAdded: chrome.events.Event<(proxy: GhostProxy) => void>
    export const onRemoved: chrome.events.Event<(proxy_id: string) => void>
    export const onChanged: chrome.events.Event<(proxy: GhostProxy) => void>
    export const onMoved: chrome.events.Event<(proxy: GhostProxy, old_index: number) => void>
    export const onProjectProxyChanged: chrome.events.Event<(proxy: GhostProxy) => void>
    export const onSessionProxyChanged: chrome.events.Event<
      (session_id: string, proxy: GhostProxy) => void
    >
    export const onTabProxyChanged: chrome.events.Event<
      (tab_id: number, proxy: GhostProxy) => void
    >
    export const onIdentityProxyChanged: chrome.events.Event<
      (identity_id: string, proxy: GhostProxy) => void
    >
  }

  // ============================================================================
  // GHOST PROJECTS API (chrome.projects)
  // ============================================================================

  export namespace projects {
    /** Home project UUID */
    export const PROJECT_ID_HOME: 'f0673216-13b9-48be-aa41-90763e229e78'

    /** Unsaved project UUID */
    export const PROJECT_ID_UNSAVED: 'fe061488-8a8e-40f0-9e5e-93a1a5e2c273'

    /** Maximum sessions per project */
    export const SESSIONS_MAX: 25

    /** Value to create new session. Same as ghostPublicAPI.NEW_TEMPORARY_IDENTITY */
    export const NEW_SESSION: 'OpenInNewSession'

    /** Global/default session. Empty string. */
    export const GLOBAL_SESSION: ''

    export type ClearSessionDataType = 'all' | 'cookies' | 'storage'
    export type ClearIdentityDataType = 'all' | 'cookies' | 'storage'
    export type IdentitySortCondition = 'name' | 'date' | 'usage'

    export interface GhostProject {
      id: string
      name: string
      description: string
      locked: boolean
      enabled: boolean
      active: boolean
      index: number
    }

    export interface GhostSession {
      id: string
      project_id: string
      name: string
      color: string
      display_name: string
      display_color: string
      opened: boolean
      enabled: boolean
    }

    export interface GhostIdentity {
      id: string
      name: string
      color: string
      tag: string
      description: string
      /** URL dedication (site this identity is dedicated to) */
      dedication: string
      dedication_is_strict: boolean
      user_agent: string
      usage_rate: number
      creation_time: string
      index: number
      enabled: boolean
    }

    export interface GhostWindow {
      id: number
      project_id: string
      active: boolean
    }

    export interface GhostTab {
      id: number
      project_id: string
      identity_id: string
      session_id: string
      window_id: number
      index: number
      index_in_session: number
      tab_id: number
      url: string
      title: string
      favicon: string
      active: boolean
      pinned: boolean
    }

    export interface AddProjectDetails {
      project_name?: string
      project_description?: string
      clone_current?: boolean
      add_window?: boolean
    }

    export interface AddIdentityDetails {
      name: string
      color: string
      dedication: string
      dedication_is_strict: boolean
    }

    export interface TabInfo {
      url?: string
      title?: string
      favicon?: string
      active?: boolean
      pinned?: boolean
    }

    export interface AddTabDetails {
      project_id: string
      window_id: number
      index?: number
      session_id?: string
      identity_id?: string
      tab_info: TabInfo
    }

    export interface AddWindowDetails {
      project_id: string
      index?: number
      active?: boolean
    }

    export interface ArchivedProject {
      id: string
      name: string
      description: string
      index: number
    }

    export interface GhostMultiExtensionOption {
      id: string
      name: string
      value: number
      identity_id: string
    }

    // Project functions
    export function getProjectsList(
      callback?: (projects: GhostProject[]) => void
    ): Promise<GhostProject[]>

    export function getProject(
      project_id: string,
      callback?: (project: GhostProject) => void
    ): Promise<GhostProject>

    export function getActiveProject(
      callback?: (project: GhostProject) => void
    ): Promise<GhostProject>

    export function addProject(
      project: AddProjectDetails,
      callback?: () => void
    ): Promise<void>

    export function removeProject(project_id: string, callback?: () => void): Promise<void>

    export function moveProject(
      project_id: string,
      new_index: number,
      callback?: () => void
    ): Promise<void>

    export function renameProject(
      project_id: string,
      project_name: string,
      callback?: () => void
    ): Promise<void>

    export function setProjectDescription(
      project_id: string,
      project_description: string,
      callback?: () => void
    ): Promise<void>

    export function lockProject(project_id: string, callback?: () => void): Promise<void>
    export function unlockProject(project_id: string, callback?: () => void): Promise<void>
    export function openProject(project_id: string, callback?: () => void): Promise<void>

    // Archived projects
    export function getArchivedProjects(
      callback?: (projects: ArchivedProject[]) => void
    ): Promise<ArchivedProject[]>

    export function archiveProject(project_id: string, callback?: () => void): Promise<void>

    export function restoreArchivedProject(
      project_id: string,
      callback?: () => void
    ): Promise<void>

    export function deleteArchivedProject(
      project_id: string,
      callback?: () => void
    ): Promise<void>

    // Session functions
    export function getSessionsList(
      project_id: string,
      callback?: (sessions: GhostSession[]) => void
    ): Promise<GhostSession[]>

    export function getSession(
      project_id: string,
      session_id: string,
      callback?: (session: GhostSession) => void
    ): Promise<GhostSession>

    export function renameSession(
      project_id: string,
      session_id: string,
      session_name: string,
      callback?: () => void
    ): Promise<void>

    export function changeSessionColor(
      project_id: string,
      session_id: string,
      session_color: string,
      callback?: () => void
    ): Promise<void>

    export function clearSessionData(
      project_id: string,
      session_id: string,
      type: ClearSessionDataType,
      callback?: () => void
    ): Promise<void>

    // Identity functions
    export function getIdentitiesList(
      callback?: (identities: GhostIdentity[]) => void
    ): Promise<GhostIdentity[]>

    export function sortIdentitiesList(
      condition: IdentitySortCondition,
      desc: boolean,
      callback?: (identities: GhostIdentity[]) => void
    ): Promise<GhostIdentity[]>

    export function getIdentity(
      identity_id: string,
      callback?: (identity: GhostIdentity) => void
    ): Promise<GhostIdentity>

    export function addIdentity(
      identity: AddIdentityDetails,
      callback?: (identity: GhostIdentity) => void
    ): Promise<GhostIdentity>

    export function removeIdentity(identity_id: string, callback?: () => void): Promise<void>

    export function moveIdentity(
      identity_id: string,
      new_index: number,
      callback?: () => void
    ): Promise<void>

    export function renameIdentity(
      identity_id: string,
      identity_name: string,
      callback?: () => void
    ): Promise<void>

    export function changeIdentityColor(
      identity_id: string,
      identity_color: string,
      callback?: () => void
    ): Promise<void>

    export function setIdentityTag(
      identity_id: string,
      identity_tag: string,
      callback?: () => void
    ): Promise<void>

    export function setIdentityDescription(
      identity_id: string,
      identity_description: string,
      callback?: () => void
    ): Promise<void>

    export function setIdentityDedication(
      identity_id: string,
      identity_dedication: string,
      callback?: () => void
    ): Promise<void>

    export function setIdentityDedicationIsStrict(
      identity_id: string,
      identity_dedication_is_strict: boolean,
      callback?: () => void
    ): Promise<void>

    export function setIdentityUserAgent(
      identity_id: string,
      user_agent: string,
      callback?: () => void
    ): Promise<void>

    export function resetIdentity(
      identity_id: string,
      callback?: (identity: GhostIdentity) => void
    ): Promise<GhostIdentity>

    export function clearIdentityData(
      identity_id: string,
      type: ClearIdentityDataType,
      callback?: () => void
    ): Promise<void>

    export function getIdentityTabsList(
      project_id: string,
      identity_id: string,
      callback?: (tabs: GhostTab[]) => void
    ): Promise<GhostTab[]>

    /** Opens a new tab in a new identity */
    export function newIdentityOpenTab(): void

    /** Duplicates current tab into a new identity */
    export function newIdentityDuplicateTab(): void

    // Window functions
    export function getWindowsList(
      project_id: string,
      callback?: (windows: GhostWindow[]) => void
    ): Promise<GhostWindow[]>

    export function getWindowTabsList(
      project_id: string,
      window_id: number,
      callback?: (tabs: GhostTab[]) => void
    ): Promise<GhostTab[]>

    export function addWindow(window: AddWindowDetails, callback?: () => void): Promise<void>

    export function removeWindow(
      project_id: string,
      window_id: number,
      callback?: () => void
    ): Promise<void>

    // Tab functions
    export function getSessionTabsList(
      project_id: string,
      session_id: string,
      callback?: (tabs: GhostTab[]) => void
    ): Promise<GhostTab[]>

    export function getTab(
      project_id: string,
      tab_id: number,
      callback?: (tab: GhostTab) => void
    ): Promise<GhostTab>

    export function addTab(tab: AddTabDetails, callback?: () => void): Promise<void>

    export function removeTab(
      project_id: string,
      tab_id: number,
      callback?: () => void
    ): Promise<void>

    export function updateTab(
      project_id: string,
      tab_id: number,
      tab_info: TabInfo,
      callback?: () => void
    ): Promise<void>

    // Multi-extension options
    export function isMultiExtensionEnabled(
      callback?: (enabled: boolean) => void
    ): Promise<boolean>

    export function getMultiExtensionOptions(
      identity_id: string,
      callback?: (options: GhostMultiExtensionOption[]) => void
    ): Promise<GhostMultiExtensionOption[]>

    export function setMultiExtensionOption(
      identity_id: string,
      id: string,
      value: number,
      callback?: (success: boolean) => void
    ): Promise<boolean>

    export function clearMultiExtensionOptions(
      identity_id: string,
      callback?: (success: boolean) => void
    ): Promise<boolean>

    // Events
    export const onProjectWillOpen: chrome.events.Event<
      (project_id: string, first_time: boolean) => void
    >
    export const onProjectOpened: chrome.events.Event<
      (project_id: string, first_time: boolean) => void
    >
    export const onProjectClosed: chrome.events.Event<(project_id: string) => void>
    export const onProjectAdded: chrome.events.Event<(project: GhostProject) => void>
    export const onProjectRemoved: chrome.events.Event<(project_id: string) => void>
    export const onProjectNameChanged: chrome.events.Event<
      (project_id: string, new_name: string) => void
    >
    export const onProjectDescriptionChanged: chrome.events.Event<
      (project_id: string, description: string) => void
    >
    export const onProjectLockStateChanged: chrome.events.Event<
      (project_id: string, locked: boolean) => void
    >

    export const onIdentityAdded: chrome.events.Event<(identity: GhostIdentity) => void>
    export const onIdentityRemoved: chrome.events.Event<(identity_id: string) => void>
    export const onIdentityNameChanged: chrome.events.Event<
      (identity_id: string, identity_name: string) => void
    >
    export const onIdentityColorChanged: chrome.events.Event<
      (identity_id: string, identity_color: string) => void
    >
    export const onIdentityUserAgentChanged: chrome.events.Event<
      (identity_id: string, identity_user_agent: string) => void
    >
    export const onIdentitiesChanged: chrome.events.Event<() => void>

    export const onSessionAdded: chrome.events.Event<(session: GhostSession) => void>
    export const onSessionRemoved: chrome.events.Event<
      (project_id: string, session_id: string) => void
    >
    export const onSessionNameChanged: chrome.events.Event<
      (project_id: string, session_id: string, new_name: string) => void
    >
    export const onSessionColorChanged: chrome.events.Event<
      (project_id: string, session_id: string, session_color: string) => void
    >

    export const onTabAdded: chrome.events.Event<(tab: GhostTab) => void>
    export const onTabRemoved: chrome.events.Event<
      (project_id: string, window_id: number, tab_id: number, is_window_closing: boolean) => void
    >
    export const onTabUpdated: chrome.events.Event<(project_id: string, tab_id: number) => void>

    export const onWindowAdded: chrome.events.Event<(window: GhostWindow) => void>
    export const onWindowRemoved: chrome.events.Event<
      (project_id: string, window_id: number) => void
    >
  }

  // ============================================================================
  // EXTENDED CHROME.TABS (Ghost Browser additions)
  // ============================================================================

  export namespace tabs {
    export interface ProjectInfo {
      project_id?: string
      session_id?: string
      tab_id?: number
    }

    export interface ProxyInfo {
      proxy_id: string
      proxy_has_effect: boolean
    }

    export interface GhostTabPublicAPI {
      workspace_id: string
      identity_id: string
      is_temporary_identity: boolean
    }

    // Extended Tab interface with Ghost Browser properties
    export interface Tab {
      /** Ghost Browser project info */
      projectInfo?: ProjectInfo
      /** Ghost Browser proxy info */
      proxyInfo?: ProxyInfo
      /** Identity ID (also available in ghostPublicAPI) */
      identity_id?: string
      /** Ghost Browser public API properties */
      ghostPublicAPI?: GhostTabPublicAPI
    }

    // Extended CreateProperties for chrome.tabs.create()
    export interface CreateProperties {
      /** Session ID to open tab in */
      session_id?: string
      /** Identity ID to open tab in */
      identity_id?: string
    }

    // Extended QueryInfo for chrome.tabs.query()
    export interface QueryInfo {
      /** Filter by session ID */
      session_id?: string
    }
  }
}
