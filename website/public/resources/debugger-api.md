# Debugger API Reference

## Types

```ts
import type { ICDPSession } from './cdp-session.js';
export interface BreakpointInfo {
    id: string;
    file: string;
    line: number;
}
export interface LocationInfo {
    url: string;
    lineNumber: number;
    columnNumber: number;
    callstack: Array<{
        functionName: string;
        url: string;
        lineNumber: number;
        columnNumber: number;
    }>;
    sourceContext: string;
}
export interface EvaluateResult {
    value: unknown;
}
export interface ScriptInfo {
    scriptId: string;
    url: string;
}
/**
 * A class for debugging JavaScript code via Chrome DevTools Protocol.
 * Works with both Node.js (--inspect) and browser debugging.
 *
 * @example
 * ```ts
 * const cdp = await getCDPSessionForPage({ page, wsUrl })
 * const dbg = new Debugger({ cdp })
 *
 * await dbg.setBreakpoint({ file: 'https://example.com/app.js', line: 42 })
 * // trigger the code path, then:
 * const location = await dbg.getLocation()
 * const vars = await dbg.inspectLocalVariables()
 * await dbg.resume()
 * ```
 */
export declare class Debugger {
    private cdp;
    private debuggerEnabled;
    private paused;
    private currentCallFrames;
    private breakpoints;
    private scripts;
    private xhrBreakpoints;
    private blackboxPatterns;
    /**
     * Creates a new Debugger instance.
     *
     * @param options - Configuration options
     * @param options.cdp - A CDPSession instance for sending CDP commands (works with both
     *                      our CDPSession and Playwright's CDPSession)
     *
     * @example
     * ```ts
     * const cdp = await getCDPSessionForPage({ page, wsUrl })
     * const dbg = new Debugger({ cdp })
     * ```
     */
    constructor({ cdp }: {
        cdp: ICDPSession;
    });
    private setupEventListeners;
    /**
     * Enables the debugger and runtime domains. Called automatically by other methods.
     * Also resumes execution if the target was started with --inspect-brk.
     *
     * @example
     * ```ts
     * await dbg.enable()
     * ```
     */
    enable(): Promise<void>;
    /**
     * Sets a breakpoint at a specified URL and line number.
     * Use the URL from listScripts() to find available scripts.
     *
     * @param options - Breakpoint options
     * @param options.file - Script URL (e.g. https://example.com/app.js)
     * @param options.line - Line number (1-based)
     * @param options.condition - Optional JS expression; only pause when it evaluates to true
     * @returns The breakpoint ID for later removal
     *
     * @example
     * ```ts
     * const id = await dbg.setBreakpoint({ file: 'https://example.com/app.js', line: 42 })
     * // later:
     * await dbg.deleteBreakpoint({ breakpointId: id })
     *
     * // Conditional breakpoint - only pause when userId is 123
     * await dbg.setBreakpoint({
     *   file: 'https://example.com/app.js',
     *   line: 42,
     *   condition: 'userId === 123'
     * })
     * ```
     */
    setBreakpoint({ file, line, condition }: {
        file: string;
        line: number;
        condition?: string;
    }): Promise<string>;
    /**
     * Removes a breakpoint by its ID.
     *
     * @param options - Options
     * @param options.breakpointId - The breakpoint ID returned by setBreakpoint
     *
     * @example
     * ```ts
     * await dbg.deleteBreakpoint({ breakpointId: 'bp-123' })
     * ```
     */
    deleteBreakpoint({ breakpointId }: {
        breakpointId: string;
    }): Promise<void>;
    /**
     * Returns a list of all active breakpoints set by this debugger instance.
     *
     * @returns Array of breakpoint info objects
     *
     * @example
     * ```ts
     * const breakpoints = dbg.listBreakpoints()
     * // [{ id: 'bp-123', file: 'https://example.com/index.js', line: 42 }]
     * ```
     */
    listBreakpoints(): BreakpointInfo[];
    /**
     * Inspects local variables in the current call frame.
     * Must be paused at a breakpoint. String values over 1000 chars are truncated.
     * Use evaluate() for full control over reading specific values.
     *
     * @returns Record of variable names to values
     * @throws Error if not paused or no active call frames
     *
     * @example
     * ```ts
     * const vars = await dbg.inspectLocalVariables()
     * // { myVar: 'hello', count: 42 }
     * ```
     */
    inspectLocalVariables(): Promise<Record<string, unknown>>;
    /**
     * Returns global lexical scope variable names.
     *
     * @returns Array of global variable names
     *
     * @example
     * ```ts
     * const globals = await dbg.inspectGlobalVariables()
     * // ['myGlobal', 'CONFIG']
     * ```
     */
    inspectGlobalVariables(): Promise<string[]>;
    /**
     * Evaluates a JavaScript expression and returns the result.
     * When paused at a breakpoint, evaluates in the current stack frame scope,
     * allowing access to local variables. Otherwise evaluates in global scope.
     * Values are not truncated, use this for full control over reading specific variables.
     *
     * @param options - Options
     * @param options.expression - JavaScript expression to evaluate
     * @returns The result value
     *
     * @example
     * ```ts
     * // When paused, can access local variables:
     * const result = await dbg.evaluate({ expression: 'localVar + 1' })
     *
     * // Read a large string that would be truncated in inspectLocalVariables:
     * const full = await dbg.evaluate({ expression: 'largeStringVar' })
     * ```
     */
    evaluate({ expression }: {
        expression: string;
    }): Promise<EvaluateResult>;
    /**
     * Gets the current execution location when paused at a breakpoint.
     * Includes the call stack and surrounding source code for context.
     *
     * @returns Location info with URL, line number, call stack, and source context
     * @throws Error if debugger is not paused
     *
     * @example
     * ```ts
     * const location = await dbg.getLocation()
     * console.log(location.url)          // 'https://example.com/src/index.js'
     * console.log(location.lineNumber)   // 42
     * console.log(location.callstack)    // [{ functionName: 'handleRequest', ... }]
     * console.log(location.sourceContext)
     * // '  40: function handleRequest(req) {
     * //   41:   const data = req.body
     * // > 42:   processData(data)
     * //   43: }'
     * ```
     */
    getLocation(): Promise<LocationInfo>;
    /**
     * Steps over to the next line of code, not entering function calls.
     *
     * @throws Error if debugger is not paused
     *
     * @example
     * ```ts
     * await dbg.stepOver()
     * const newLocation = await dbg.getLocation()
     * ```
     */
    stepOver(): Promise<void>;
    /**
     * Steps into a function call on the current line.
     *
     * @throws Error if debugger is not paused
     *
     * @example
     * ```ts
     * await dbg.stepInto()
     * const location = await dbg.getLocation()
     * // now inside the called function
     * ```
     */
    stepInto(): Promise<void>;
    /**
     * Steps out of the current function, returning to the caller.
     *
     * @throws Error if debugger is not paused
     *
     * @example
     * ```ts
     * await dbg.stepOut()
     * const location = await dbg.getLocation()
     * // back in the calling function
     * ```
     */
    stepOut(): Promise<void>;
    /**
     * Resumes code execution until the next breakpoint or completion.
     *
     * @throws Error if debugger is not paused
     *
     * @example
     * ```ts
     * await dbg.resume()
     * // execution continues
     * ```
     */
    resume(): Promise<void>;
    /**
     * Returns whether the debugger is currently paused at a breakpoint.
     *
     * @returns true if paused, false otherwise
     *
     * @example
     * ```ts
     * if (dbg.isPaused()) {
     *   const vars = await dbg.inspectLocalVariables()
     * }
     * ```
     */
    isPaused(): boolean;
    /**
     * Configures the debugger to pause on exceptions.
     *
     * @param options - Options
     * @param options.state - When to pause: 'none' (never), 'uncaught' (only uncaught), or 'all' (all exceptions)
     *
     * @example
     * ```ts
     * // Pause only on uncaught exceptions
     * await dbg.setPauseOnExceptions({ state: 'uncaught' })
     *
     * // Pause on all exceptions (caught and uncaught)
     * await dbg.setPauseOnExceptions({ state: 'all' })
     *
     * // Disable pausing on exceptions
     * await dbg.setPauseOnExceptions({ state: 'none' })
     * ```
     */
    setPauseOnExceptions({ state }: {
        state: 'none' | 'uncaught' | 'all';
    }): Promise<void>;
    /**
     * Lists available scripts where breakpoints can be set.
     * Automatically enables the debugger if not already enabled.
     *
     * @param options - Options
     * @param options.search - Optional string to filter scripts by URL (case-insensitive)
     * @returns Array of up to 20 matching scripts with scriptId and url
     *
     * @example
     * ```ts
     * // List all scripts
     * const scripts = await dbg.listScripts()
     * // [{ scriptId: '1', url: 'https://example.com/app.js' }, ...]
     *
     * // Search for specific files
     * const handlers = await dbg.listScripts({ search: 'handler' })
     * // [{ scriptId: '5', url: 'https://example.com/handlers.js' }]
     * ```
     */
    listScripts({ search }?: {
        search?: string;
    }): Promise<ScriptInfo[]>;
    setXHRBreakpoint({ url }: {
        url: string;
    }): Promise<void>;
    removeXHRBreakpoint({ url }: {
        url: string;
    }): Promise<void>;
    listXHRBreakpoints(): string[];
    /**
     * Sets regex patterns for scripts to blackbox (skip when stepping).
     * Blackboxed scripts are hidden from the call stack and stepped over automatically.
     * Useful for ignoring framework/library code during debugging.
     *
     * @param options - Options
     * @param options.patterns - Array of regex patterns to match script URLs
     *
     * @example
     * ```ts
     * // Skip all node_modules
     * await dbg.setBlackboxPatterns({ patterns: ['node_modules'] })
     *
     * // Skip React and other frameworks
     * await dbg.setBlackboxPatterns({
     *   patterns: [
     *     'node_modules/react',
     *     'node_modules/react-dom',
     *     'node_modules/next',
     *     'webpack://',
     *   ]
     * })
     *
     * // Skip all third-party scripts
     * await dbg.setBlackboxPatterns({ patterns: ['^https://cdn\\.'] })
     *
     * // Clear all blackbox patterns
     * await dbg.setBlackboxPatterns({ patterns: [] })
     * ```
     */
    setBlackboxPatterns({ patterns }: {
        patterns: string[];
    }): Promise<void>;
    /**
     * Adds a single regex pattern to the blackbox list.
     *
     * @param options - Options
     * @param options.pattern - Regex pattern to match script URLs
     *
     * @example
     * ```ts
     * await dbg.addBlackboxPattern({ pattern: 'node_modules/lodash' })
     * await dbg.addBlackboxPattern({ pattern: 'node_modules/axios' })
     * ```
     */
    addBlackboxPattern({ pattern }: {
        pattern: string;
    }): Promise<void>;
    /**
     * Removes a pattern from the blackbox list.
     *
     * @param options - Options
     * @param options.pattern - The exact pattern string to remove
     */
    removeBlackboxPattern({ pattern }: {
        pattern: string;
    }): Promise<void>;
    /**
     * Returns the current list of blackbox patterns.
     */
    listBlackboxPatterns(): string[];
    private truncateValue;
    private formatPropertyValue;
    private processRemoteObject;
}
```

## Examples

```ts
import { page, getCDPSession, createDebugger, console } from './debugger-examples-types.js'

// Example: List available scripts and set a breakpoint
async function listScriptsAndSetBreakpoint() {
  const cdp = await getCDPSession({ page })
  const dbg = createDebugger({ cdp })
  await dbg.enable()

  const scripts = await dbg.listScripts({ search: 'app' })
  console.log(scripts)

  if (scripts.length > 0) {
    const bpId = await dbg.setBreakpoint({ file: scripts[0].url, line: 100 })
    console.log('Breakpoint set:', bpId)
  }
}

// Example: Inspect state when paused at a breakpoint
async function inspectWhenPaused() {
  const cdp = await getCDPSession({ page })
  const dbg = createDebugger({ cdp })
  await dbg.enable()

  if (dbg.isPaused()) {
    const loc = await dbg.getLocation()
    console.log('Paused at:', loc.url, 'line', loc.lineNumber)
    console.log('Source:', loc.sourceContext)

    const vars = await dbg.inspectLocalVariables()
    console.log('Variables:', vars)

    const result = await dbg.evaluate({ expression: 'myVar.length' })
    console.log('myVar.length =', result.value)

    await dbg.stepOver()
  }
}

// Example: Step through code
async function stepThroughCode() {
  const cdp = await getCDPSession({ page })
  const dbg = createDebugger({ cdp })
  await dbg.enable()

  await dbg.setBreakpoint({ file: 'https://example.com/app.js', line: 42 })

  if (dbg.isPaused()) {
    await dbg.stepOver()
    await dbg.stepInto()
    await dbg.stepOut()
    await dbg.resume()
  }
}

// Example: Cleanup all breakpoints
async function cleanupBreakpoints() {
  const cdp = await getCDPSession({ page })
  const dbg = createDebugger({ cdp })

  const breakpoints = dbg.listBreakpoints()
  for (const bp of breakpoints) {
    await dbg.deleteBreakpoint({ breakpointId: bp.id })
  }
}

export { listScriptsAndSetBreakpoint, inspectWhenPaused, stepThroughCode, cleanupBreakpoints }

```