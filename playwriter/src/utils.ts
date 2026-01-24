import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Playwriter extension IDs - used for validation and Chrome flag commands
export const EXTENSION_IDS = [
  'jfeammnjpkecdekppnclgkkffahnhfhe', // Production (Chrome Web Store)
  'elnnakgjclnapgflmidlpobefkdmapdm', // Dev (loaded unpacked)
]

export function getCdpUrl({ port = 19988, host = '127.0.0.1', token }: { port?: number; host?: string; token?: string } = {}) {
  const id = `${Math.random().toString(36).substring(2, 15)}_${Date.now()}`
  const queryString = token ? `?token=${token}` : ''
  return `ws://${host}:${port}/cdp/${id}${queryString}`
}

const LOG_BASE_DIR = os.platform() === 'win32' ? os.tmpdir() : '/tmp'
export const LOG_FILE_PATH = process.env.PLAYWRITER_LOG_FILE_PATH || path.join(LOG_BASE_DIR, 'playwriter', 'relay-server.log')
export const LOG_CDP_FILE_PATH = process.env.PLAYWRITER_CDP_LOG_FILE_PATH || path.join(path.dirname(LOG_FILE_PATH), 'cdp.jsonl')

const packageJsonPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json')
export const VERSION = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')).version as string

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
