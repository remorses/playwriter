import type { CDPSession } from './cdp-session.js'

export interface ScriptInfo {
  url: string
  scriptId: string
}

export interface ReadResult {
  content: string
  totalLines: number
  startLine: number
  endLine: number
}

export interface SearchMatch {
  url: string
  lineNumber: number
  lineContent: string
}

export interface EditResult {
  success: boolean
  stackChanged?: boolean
}

/**
 * A class for viewing and editing web page scripts via Chrome DevTools Protocol.
 * Provides a Claude Code-like interface: list, read, edit, grep.
 *
 * Edits are in-memory only and persist until page reload. They modify the running
 * V8 instance but are not saved to disk or server.
 *
 * @example
 * ```ts
 * const cdp = await getCDPSession({ page })
 * const editor = new Editor({ cdp })
 * await editor.enable()
 *
 * // List available scripts
 * const scripts = editor.list({ search: 'app' })
 *
 * // Read a script
 * const { content } = await editor.read({ url: 'https://example.com/app.js' })
 *
 * // Edit a script
 * await editor.edit({
 *   url: 'https://example.com/app.js',
 *   oldString: 'console.log("old")',
 *   newString: 'console.log("new")'
 * })
 * ```
 */
export class Editor {
  private cdp: CDPSession
  private enabled = false
  private scripts = new Map<string, ScriptInfo>()
  private scriptsByUrl = new Map<string, ScriptInfo>()
  private sourceCache = new Map<string, string>()

  constructor({ cdp }: { cdp: CDPSession }) {
    this.cdp = cdp
    this.setupEventListeners()
  }

  private setupEventListeners() {
    this.cdp.on('Debugger.scriptParsed', (params) => {
      if (!params.url.startsWith('chrome') && !params.url.startsWith('devtools')) {
        const url = params.url || `inline://${params.scriptId}`
        const info: ScriptInfo = {
          url,
          scriptId: params.scriptId,
        }
        this.scripts.set(params.scriptId, info)
        this.scriptsByUrl.set(url, info)
        this.sourceCache.delete(params.scriptId)
      }
    })
  }

  /**
   * Enables the editor. Must be called before other methods.
   * Scripts are collected from Debugger.scriptParsed events.
   * Reload the page after enabling to capture all scripts.
   */
  async enable(): Promise<void> {
    if (this.enabled) {
      return
    }
    await this.cdp.send('Debugger.enable')
    this.enabled = true
  }

  private getScriptByUrl(url: string): ScriptInfo {
    const script = this.scriptsByUrl.get(url)
    if (!script) {
      const available = Array.from(this.scriptsByUrl.keys()).slice(0, 5)
      throw new Error(`Script not found: ${url}\nAvailable: ${available.join(', ')}${this.scriptsByUrl.size > 5 ? '...' : ''}`)
    }
    return script
  }

  /**
   * Lists available scripts. Use search to filter by URL substring.
   *
   * @param options - Options
   * @param options.search - Optional substring to filter URLs (case-insensitive)
   * @returns Array of scripts with url and scriptId
   *
   * @example
   * ```ts
   * // List all scripts
   * const scripts = editor.list()
   *
   * // Search for specific scripts
   * const appScripts = editor.list({ search: 'app' })
   * const reactScripts = editor.list({ search: 'react' })
   * ```
   */
  list({ search }: { search?: string } = {}): ScriptInfo[] {
    const scripts = Array.from(this.scripts.values())
    const filtered = search ? scripts.filter((s) => s.url.toLowerCase().includes(search.toLowerCase())) : scripts
    return filtered
  }

  /**
   * Reads a script's source code by URL.
   * Returns line-numbered content like Claude Code's Read tool.
   * For inline scripts, use the `inline://` URL from list() or grep().
   *
   * @param options - Options
   * @param options.url - Script URL (inline scripts have `inline://{id}` URLs)
   * @param options.offset - Line number to start from (0-based, default 0)
   * @param options.limit - Number of lines to return (default 2000)
   * @returns Content with line numbers, total lines, and range info
   *
   * @example
   * ```ts
   * // Read by URL
   * const { content, totalLines } = await editor.read({
   *   url: 'https://example.com/app.js'
   * })
   *
   * // Read inline script (URL from grep result)
   * const { content } = await editor.read({ url: 'inline://42' })
   *
   * // Read lines 100-200
   * const { content } = await editor.read({
   *   url: 'https://example.com/app.js',
   *   offset: 100,
   *   limit: 100
   * })
   * ```
   */
  async read({ url, offset = 0, limit = 2000 }: { url: string; offset?: number; limit?: number }): Promise<ReadResult> {
    await this.enable()
    const script = this.getScriptByUrl(url)

    let source = this.sourceCache.get(script.scriptId)
    if (!source) {
      const response = await this.cdp.send('Debugger.getScriptSource', { scriptId: script.scriptId })
      source = response.scriptSource
      this.sourceCache.set(script.scriptId, source)
    }

    const lines = source.split('\n')
    const totalLines = lines.length
    const startLine = Math.min(offset, totalLines)
    const endLine = Math.min(offset + limit, totalLines)
    const selectedLines = lines.slice(startLine, endLine)

    const content = selectedLines.map((line, i) => `${String(startLine + i + 1).padStart(5)}| ${line}`).join('\n')

    return {
      content,
      totalLines,
      startLine: startLine + 1,
      endLine,
    }
  }

  /**
   * Edits a script by replacing oldString with newString.
   * Like Claude Code's Edit tool - performs exact string replacement.
   *
   * @param options - Options
   * @param options.url - Script URL (inline scripts have `inline://{id}` URLs)
   * @param options.oldString - Exact string to find and replace
   * @param options.newString - Replacement string
   * @param options.dryRun - If true, validate without applying (default false)
   * @returns Result with success status
   *
   * @example
   * ```ts
   * // Replace a string
   * await editor.edit({
   *   url: 'https://example.com/app.js',
   *   oldString: 'const DEBUG = false',
   *   newString: 'const DEBUG = true'
   * })
   *
   * // Edit inline script
   * await editor.edit({
   *   url: 'inline://42',
   *   oldString: 'old code',
   *   newString: 'new code'
   * })
   * ```
   */
  async edit({
    url,
    oldString,
    newString,
    dryRun = false,
  }: {
    url: string
    oldString: string
    newString: string
    dryRun?: boolean
  }): Promise<EditResult> {
    await this.enable()
    const script = this.getScriptByUrl(url)

    let source = this.sourceCache.get(script.scriptId)
    if (!source) {
      const response = await this.cdp.send('Debugger.getScriptSource', { scriptId: script.scriptId })
      source = response.scriptSource
      this.sourceCache.set(script.scriptId, source)
    }

    const matchCount = source.split(oldString).length - 1
    if (matchCount === 0) {
      throw new Error(`oldString not found in ${url}`)
    }
    if (matchCount > 1) {
      throw new Error(`oldString found ${matchCount} times in ${url}. Provide more context to make it unique.`)
    }

    const newSource = source.replace(oldString, newString)

    const response = await this.cdp.send('Debugger.setScriptSource', {
      scriptId: script.scriptId,
      scriptSource: newSource,
      dryRun,
    })

    if (!dryRun) {
      this.sourceCache.set(script.scriptId, newSource)
    }

    return {
      success: true,
      stackChanged: response.stackChanged,
    }
  }

  /**
   * Searches for a regex across all scripts.
   * Like Claude Code's Grep tool - returns matching lines with context.
   *
   * @param options - Options
   * @param options.regex - Regular expression to search for
   * @param options.include - Optional URL substring to filter which scripts to search
   * @returns Array of matches with url, line number, and line content
   *
   * @example
   * ```ts
   * // Search all scripts for "fetchUser"
   * const matches = await editor.grep({ regex: /fetchUser/ })
   *
   * // Search only in app scripts
   * const matches = await editor.grep({
   *   regex: /TODO/i,
   *   include: 'app'
   * })
   *
   * // Regex search for console methods
   * const matches = await editor.grep({
   *   regex: /console\.(log|error|warn)/
   * })
   * ```
   */
  async grep({ regex, include }: { regex: RegExp; include?: string }): Promise<SearchMatch[]> {
    await this.enable()

    const matches: SearchMatch[] = []
    const scripts = include ? this.list({ search: include }) : this.list()

    for (const script of scripts) {
      let source = this.sourceCache.get(script.scriptId)
      if (!source) {
        try {
          const response = await this.cdp.send('Debugger.getScriptSource', { scriptId: script.scriptId })
          source = response.scriptSource
          this.sourceCache.set(script.scriptId, source)
        } catch {
          continue
        }
      }

      const lines = source.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          matches.push({
            url: script.url,
            lineNumber: i + 1,
            lineContent: lines[i].trim().slice(0, 200),
          })
          regex.lastIndex = 0
        }
      }
    }

    return matches
  }

  /**
   * Writes entire content to a script, replacing all existing code.
   * Use with caution - prefer edit() for targeted changes.
   *
   * @param options - Options
   * @param options.url - Script URL (inline scripts have `inline://{id}` URLs)
   * @param options.content - New script content
   * @param options.dryRun - If true, validate without applying (default false)
   */
  async write({ url, content, dryRun = false }: { url: string; content: string; dryRun?: boolean }): Promise<EditResult> {
    await this.enable()
    const script = this.getScriptByUrl(url)

    const response = await this.cdp.send('Debugger.setScriptSource', {
      scriptId: script.scriptId,
      scriptSource: content,
      dryRun,
    })

    if (!dryRun) {
      this.sourceCache.set(script.scriptId, content)
    }

    return {
      success: true,
      stackChanged: response.stackChanged,
    }
  }
}
