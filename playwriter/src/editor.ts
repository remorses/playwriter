import type { ICDPSession } from './cdp-session.js'

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
  private cdp: ICDPSession
  private enabled = false
  private scripts = new Map<string, string>()
  private stylesheets = new Map<string, string>()
  private sourceCache = new Map<string, string>()

  constructor({ cdp }: { cdp: ICDPSession }) {
    this.cdp = cdp
    this.setupEventListeners()
  }

  private setupEventListeners() {
    this.cdp.on('Debugger.scriptParsed', (params) => {
      if (!params.url.startsWith('chrome') && !params.url.startsWith('devtools')) {
        const url = params.url || `inline://${params.scriptId}`
        this.scripts.set(url, params.scriptId)
        this.sourceCache.delete(params.scriptId)
      }
    })

    this.cdp.on('CSS.styleSheetAdded', (params) => {
      const header = params.header
      if (header.sourceURL?.startsWith('chrome') || header.sourceURL?.startsWith('devtools')) {
        return
      }
      const url = header.sourceURL || `inline-css://${header.styleSheetId}`
      this.stylesheets.set(url, header.styleSheetId)
      this.sourceCache.delete(header.styleSheetId)
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
    await this.cdp.send('Debugger.disable')
    await this.cdp.send('CSS.disable')
    this.scripts.clear()
    this.stylesheets.clear()
    this.sourceCache.clear()
    const resourcesReady = new Promise<void>((resolve) => {
      let timeout: ReturnType<typeof setTimeout>
      const listener = () => {
        clearTimeout(timeout)
        timeout = setTimeout(() => {
          this.cdp.off('Debugger.scriptParsed', listener)
          this.cdp.off('CSS.styleSheetAdded', listener)
          resolve()
        }, 100)
      }
      this.cdp.on('Debugger.scriptParsed', listener)
      this.cdp.on('CSS.styleSheetAdded', listener)
      timeout = setTimeout(() => {
        this.cdp.off('Debugger.scriptParsed', listener)
        this.cdp.off('CSS.styleSheetAdded', listener)
        resolve()
      }, 100)
    })
    await this.cdp.send('Debugger.enable')
    await this.cdp.send('DOM.enable')
    await this.cdp.send('CSS.enable')
    await resourcesReady
    this.enabled = true
  }

  private getIdByUrl(url: string): { scriptId: string } | { styleSheetId: string } {
    const scriptId = this.scripts.get(url)
    if (scriptId) {
      return { scriptId }
    }
    const styleSheetId = this.stylesheets.get(url)
    if (styleSheetId) {
      return { styleSheetId }
    }
    const allUrls = [...Array.from(this.scripts.keys()), ...Array.from(this.stylesheets.keys())]
    const available = allUrls.slice(0, 5)
    throw new Error(`Resource not found: ${url}\nAvailable: ${available.join(', ')}${allUrls.length > 5 ? '...' : ''}`)
  }

  /**
   * Lists available script and stylesheet URLs. Use pattern to filter by regex.
   * Automatically enables the editor if not already enabled.
   *
   * @param options - Options
   * @param options.pattern - Optional regex to filter URLs
   * @returns Array of URLs
   *
   * @example
   * ```ts
   * // List all scripts and stylesheets
   * const urls = await editor.list()
   *
   * // List only JS files
   * const jsFiles = await editor.list({ pattern: /\.js/ })
   *
   * // List only CSS files
   * const cssFiles = await editor.list({ pattern: /\.css/ })
   *
   * // Search for specific scripts
   * const appScripts = await editor.list({ pattern: /app/ })
   * ```
   */
  async list({ pattern }: { pattern?: RegExp } = {}): Promise<string[]> {
    await this.enable()
    const urls = [...Array.from(this.scripts.keys()), ...Array.from(this.stylesheets.keys())]

    if (!pattern) {
      return urls
    }
    return urls.filter((url) => {
      const matches = pattern.test(url)
      pattern.lastIndex = 0
      return matches
    })
  }

  /**
   * Reads a script or stylesheet's source code by URL.
   * Returns line-numbered content like Claude Code's Read tool.
   * For inline scripts, use the `inline://` URL from list() or grep().
   *
   * @param options - Options
   * @param options.url - Script or stylesheet URL (inline scripts have `inline://{id}` URLs)
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
   * // Read a CSS file
   * const { content } = await editor.read({ url: 'https://example.com/styles.css' })
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
    const id = this.getIdByUrl(url)
    const source = await this.getSource(id)

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

  private async getSource(id: { scriptId: string } | { styleSheetId: string }): Promise<string> {
    if ('styleSheetId' in id) {
      const cached = this.sourceCache.get(id.styleSheetId)
      if (cached) {
        return cached
      }
      const response = await this.cdp.send('CSS.getStyleSheetText', { styleSheetId: id.styleSheetId })
      this.sourceCache.set(id.styleSheetId, response.text)
      return response.text
    }
    const cached = this.sourceCache.get(id.scriptId)
    if (cached) {
      return cached
    }
    const response = await this.cdp.send('Debugger.getScriptSource', { scriptId: id.scriptId })
    this.sourceCache.set(id.scriptId, response.scriptSource)
    return response.scriptSource
  }

  /**
   * Edits a script or stylesheet by replacing oldString with newString.
   * Like Claude Code's Edit tool - performs exact string replacement.
   *
   * @param options - Options
   * @param options.url - Script or stylesheet URL (inline scripts have `inline://{id}` URLs)
   * @param options.oldString - Exact string to find and replace
   * @param options.newString - Replacement string
   * @param options.dryRun - If true, validate without applying (default false)
   * @returns Result with success status
   *
   * @example
   * ```ts
   * // Replace a string in JS
   * await editor.edit({
   *   url: 'https://example.com/app.js',
   *   oldString: 'const DEBUG = false',
   *   newString: 'const DEBUG = true'
   * })
   *
   * // Edit CSS
   * await editor.edit({
   *   url: 'https://example.com/styles.css',
   *   oldString: 'color: red',
   *   newString: 'color: blue'
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
    const id = this.getIdByUrl(url)
    const source = await this.getSource(id)

    const matchCount = source.split(oldString).length - 1
    if (matchCount === 0) {
      throw new Error(`oldString not found in ${url}`)
    }
    if (matchCount > 1) {
      throw new Error(`oldString found ${matchCount} times in ${url}. Provide more context to make it unique.`)
    }

    const newSource = source.replace(oldString, newString)
    return this.setSource(id, newSource, dryRun)
  }

  private async setSource(
    id: { scriptId: string } | { styleSheetId: string },
    content: string,
    dryRun = false,
  ): Promise<EditResult> {
    if ('styleSheetId' in id) {
      await this.cdp.send('CSS.setStyleSheetText', { styleSheetId: id.styleSheetId, text: content })
      if (!dryRun) {
        this.sourceCache.set(id.styleSheetId, content)
      }
      return { success: true }
    }

    // Chrome deprecated Debugger.setScriptSource in Chrome 142+ (Feb 2026)
    // Use Runtime.evaluate as fallback to re-execute the modified script
    // This works for scripts that define functions at global scope
    try {
      const response = await this.cdp.send('Debugger.setScriptSource', {
        scriptId: id.scriptId,
        scriptSource: content,
        dryRun,
      })
      if (!dryRun) {
        this.sourceCache.set(id.scriptId, content)
      }
      return { success: true, stackChanged: response.stackChanged }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      // Check if setScriptSource is deprecated/unavailable
      if (errorMessage.includes('setScriptSource') || errorMessage.includes('-32000')) {
        if (dryRun) {
          // For dry run, just validate the syntax by parsing
          await this.cdp.send('Runtime.compileScript', {
            expression: content,
            sourceURL: 'dry-run-validation',
            persistScript: false,
          })
          return { success: true }
        }

        // Re-execute the entire script to override global functions
        await this.cdp.send('Runtime.evaluate', {
          expression: content,
          returnByValue: false,
        })
        this.sourceCache.set(id.scriptId, content)
        return { success: true, stackChanged: true }
      }
      throw error
    }
  }

  /**
   * Searches for a regex across all scripts and stylesheets.
   * Like Claude Code's Grep tool - returns matching lines with context.
   *
   * @param options - Options
   * @param options.regex - Regular expression to search for in file contents
   * @param options.pattern - Optional regex to filter which URLs to search
   * @returns Array of matches with url, line number, and line content
   *
   * @example
   * ```ts
   * // Search all scripts and stylesheets for "color"
   * const matches = await editor.grep({ regex: /color/ })
   *
   * // Search only CSS files
   * const matches = await editor.grep({
   *   regex: /background-color/,
   *   pattern: /\.css/
   * })
   *
   * // Regex search for console methods in JS
   * const matches = await editor.grep({
   *   regex: /console\.(log|error|warn)/,
   *   pattern: /\.js/
   * })
   * ```
   */
  async grep({ regex, pattern }: { regex: RegExp; pattern?: RegExp }): Promise<SearchMatch[]> {
    await this.enable()

    const matches: SearchMatch[] = []
    const urls = await this.list({ pattern })

    for (const url of urls) {
      let source: string
      try {
        const id = this.getIdByUrl(url)
        source = await this.getSource(id)
      } catch {
        continue
      }

      const lines = source.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          matches.push({
            url,
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
   * Writes entire content to a script or stylesheet, replacing all existing code.
   * Use with caution - prefer edit() for targeted changes.
   *
   * @param options - Options
   * @param options.url - Script or stylesheet URL (inline scripts have `inline://{id}` URLs)
   * @param options.content - New content
   * @param options.dryRun - If true, validate without applying (default false, only works for JS)
   */
  async write({
    url,
    content,
    dryRun = false,
  }: {
    url: string
    content: string
    dryRun?: boolean
  }): Promise<EditResult> {
    await this.enable()
    const id = this.getIdByUrl(url)
    return this.setSource(id, content, dryRun)
  }
}
