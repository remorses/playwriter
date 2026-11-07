/**
 * Cross-platform process termination for a TCP port.
 *
 * This mirrors the approach used by the `kill-port-process` npm package:
 * https://github.com/hilleer/kill-port-process
 *
 * Notes:
 * - Windows: discover listeners via PowerShell/netstat and kill via taskkill.
 * - Unix: discover listeners via lsof (preferred) or fuser (fallback) and kill via
 *   process.kill(). This intentionally avoids shell pipelines (grep/awk/xargs).
 */

import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type KillPortSignal = 'SIGTERM' | 'SIGKILL'

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port > 0 && port <= 65535
}

function parsePids(output: string): number[] {
  const matches = output.match(/\d+/g) || []
  const pids = matches
    .map((text) => {
      return Number(text)
    })
    .filter((pid) => {
      return Number.isInteger(pid) && pid > 0
    })

  return [...new Set(pids)]
}

function parseUnixLsofPids(stdout: string): number[] {
  const pids = stdout
    .split(/\r?\n/g)
    .map((line) => {
      return line.trim()
    })
    .filter((line) => {
      // lsof output starts with a header row; lines we care about contain LISTEN.
      return Boolean(line) && !line.startsWith('COMMAND') && line.includes('LISTEN')
    })
    .map((line) => {
      const columns = line.split(/\s+/g)
      // `awk '{print $2}'` in kill-port-process extracts PID from 2nd column.
      return Number(columns[1] || '')
    })
    .filter((pid) => {
      return Number.isInteger(pid) && pid > 0
    })

  return [...new Set(pids)]
}

function parseWindowsNetstatPids(output: string, port: number): number[] {
  const rows = output
    .split(/\r?\n/g)
    .map((line) => {
      return line.trim()
    })
    .filter((line) => {
      return line.startsWith('TCP')
    })

  const pids = rows
    .map((row) => {
      const columns = row.split(/\s+/g)
      const localAddress = columns[1] || ''
      const state = columns[3] || ''
      const pid = columns[4] || ''
      const endsWithPort = localAddress.endsWith(`:${port}`)
      if (!endsWithPort || state !== 'LISTENING') {
        return NaN
      }
      return Number(pid)
    })
    .filter((pid) => {
      return Number.isInteger(pid) && pid > 0
    })

  return [...new Set(pids)]
}

async function getPidsForPortWindows(port: number): Promise<number[]> {
  const powerShellScript = [
    "$ErrorActionPreference='SilentlyContinue'",
    `@(Get-NetTCPConnection -LocalPort ${port} -State Listen | Select-Object -ExpandProperty OwningProcess -Unique) -join [Environment]::NewLine`,
  ].join('; ')

  try {
    const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command', powerShellScript])
    const pids = parsePids(stdout)
    if (pids.length > 0) {
      return pids
    }
  } catch {}

  try {
    const { stdout } = await execFileAsync('cmd', ['/d', '/s', '/c', 'netstat -ano -p tcp'])
    return parseWindowsNetstatPids(stdout, port)
  } catch {
    return []
  }
}

async function getPidsForPortUnix(port: number): Promise<number[]> {
  try {
    // Prefer lsof's built-in filtering and pid-only output.
    const { stdout } = await execFileAsync('lsof', ['-n', '-P', '-i', `TCP:${port}`, '-sTCP:LISTEN', '-t'])
    const pids = parsePids(stdout)
    return pids
  } catch {}

  try {
    // Compatibility fallback: some environments may have lsof but not support
    // the exact flags above. Parse the tabular output.
    const { stdout } = await execFileAsync('lsof', ['-i', `tcp:${port}`])
    const pids = parseUnixLsofPids(stdout)
    if (pids.length > 0) {
      return pids
    }
  } catch {}

  // Fallback for Linux environments that may not have `lsof`.
  try {
    const { stdout } = await execFileAsync('fuser', [`${port}/tcp`])
    return parsePids(stdout).filter((pid) => {
      return pid !== port
    })
  } catch {
    return []
  }
}

/**
 * Return PIDs (if any) that are currently LISTENing on the given TCP port.
 *
 * This is intentionally separate from killPortProcess(): callers sometimes need
 * to detect/diagnose EADDRINUSE before attempting to start a server.
 */
export async function getListeningPidsForPort({ port }: { port: number }): Promise<number[]> {
  if (!isValidPort(port)) {
    throw new Error(`Invalid port: ${port}`)
  }

  return os.platform() === 'win32' ? await getPidsForPortWindows(port) : await getPidsForPortUnix(port)
}

/**
 * Command line of a running process, or null if it exited or cannot be read.
 * process.title replaces it on Linux and macOS, so a renamed node process shows its title.
 */
export async function getProcessCommandLine({ pid }: { pid: number }): Promise<string | null> {
  try {
    if (os.platform() === 'win32') {
      const { stdout } = await execFileAsync('powershell', [
        '-NoProfile',
        '-Command',
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
      ])
      return stdout.trim() || null
    }
    if (os.platform() === 'linux') {
      const cmdline = await fs.promises.readFile(`/proc/${pid}/cmdline`, 'utf8')
      return cmdline.replace(/\0/g, ' ').trim() || null
    }
    const { stdout } = await execFileAsync('ps', ['-o', 'command=', '-p', String(pid)])
    return stdout.trim() || null
  } catch {
    return null
  }
}

/** Kill one pid. A process that already exited is ignored. */
export async function killPid({ pid, signal = 'SIGKILL' }: { pid: number; signal?: KillPortSignal }): Promise<void> {
  if (os.platform() === 'win32') {
    await terminatePidWindows(pid)
    return
  }
  try {
    process.kill(pid, signal)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
      return
    }
    throw new Error(`Failed to kill pid ${pid}`, { cause: toError(error) })
  }
}

function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value
  }
  return new Error(String(value))
}

async function terminatePidWindows(pid: number): Promise<void> {
  try {
    await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F'])
  } catch {}
}

/**
 * Kill any listening process bound to the provided TCP port.
 */
export async function killPortProcess({
  port,
  signal = 'SIGKILL',
}: {
  port: number
  signal?: KillPortSignal
}): Promise<void> {
  if (!isValidPort(port)) {
    throw new Error(`Invalid port: ${port}`)
  }

  const pids = await getListeningPidsForPort({ port })
  await Promise.all(
    pids
      .filter((pid) => {
        return pid !== process.pid
      })
      .map((pid) => {
        return killPid({ pid, signal })
      }),
  )
}
