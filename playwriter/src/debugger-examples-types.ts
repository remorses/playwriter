import type { Page } from 'playwright-core'
import type { CDPSession } from './cdp-session.js'
import type { Debugger } from './debugger.js'
import type { Editor } from './editor.js'

export declare const page: Page
export declare const getCDPSession: (options: { page: Page }) => Promise<CDPSession>
export declare const createDebugger: (options: { cdp: CDPSession }) => Debugger
export declare const createEditor: (options: { cdp: CDPSession }) => Editor
export declare const console: { log: (...args: unknown[]) => void }
