/**
 * Download and install Chrome for Testing into ~/.playwriter/browsers/.
 * Similar to agent-browser's install command: fetches the latest stable
 * Chrome for Testing build from Google's official automation channel.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { execFileSync } from 'node:child_process'

const LAST_KNOWN_GOOD_URL =
  'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json'

export function getBrowsersDir(): string {
  return path.join(os.homedir(), '.playwriter', 'browsers')
}

function getPlatformKey(): string {
  const platform = os.platform()
  const arch = os.arch()
  if (platform === 'darwin' && arch === 'arm64') {
    return 'mac-arm64'
  }
  if (platform === 'darwin' && arch === 'x64') {
    return 'mac-x64'
  }
  if (platform === 'linux' && arch === 'x64') {
    return 'linux64'
  }
  if (platform === 'win32' && arch === 'x64') {
    return 'win64'
  }
  throw new Error(
    `Unsupported platform for Chrome for Testing download: ${platform}/${arch}. ` +
      `Install Chromium manually and use PLAYWRITER_BROWSER_PATH to point to it.`,
  )
}

/**
 * Find the Chrome binary inside a downloaded Chrome for Testing directory.
 */
function findChromeBinaryInDir(dir: string): string | null {
  const platform = os.platform()

  if (platform === 'darwin') {
    const candidates = [
      path.join(dir, 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
      path.join(dir, `chrome-${getPlatformKey()}/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`),
    ]
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate
      }
    }
  }

  if (platform === 'linux') {
    const candidates = [
      path.join(dir, 'chrome'),
      path.join(dir, 'chrome-linux64/chrome'),
    ]
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate
      }
    }
  }

  if (platform === 'win32') {
    const candidates = [
      path.join(dir, 'chrome.exe'),
      path.join(dir, 'chrome-win64/chrome.exe'),
    ]
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate
      }
    }
  }

  return null
}

/**
 * Find Chrome installed by `playwriter install` in ~/.playwriter/browsers/.
 * Returns the path to the Chrome binary, or null if not found.
 */
export function findInstalledChrome(): string | null {
  const browsersDir = getBrowsersDir()
  if (!fs.existsSync(browsersDir)) {
    return null
  }

  const entries = fs.readdirSync(browsersDir, { withFileTypes: true })
    .filter((e) => {
      return e.isDirectory() && e.name.startsWith('chrome-')
    })
    .sort((a, b) => {
      // Sort descending so newest version is first
      return b.name.localeCompare(a.name)
    })

  for (const entry of entries) {
    const dir = path.join(browsersDir, entry.name)
    const binary = findChromeBinaryInDir(dir)
    if (binary) {
      return binary
    }
  }

  return null
}

interface VersionInfo {
  version: string
  downloadUrl: string
}

async function fetchDownloadUrl(): Promise<VersionInfo> {
  const response = await fetch(LAST_KNOWN_GOOD_URL, {
    signal: AbortSignal.timeout(30000),
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch Chrome version info: HTTP ${response.status}`)
  }

  const data = (await response.json()) as {
    channels: {
      Stable: {
        version: string
        downloads: {
          chrome: Array<{ platform: string; url: string }>
        }
      }
    }
  }

  const channel = data.channels?.Stable
  if (!channel) {
    throw new Error('No Stable channel found in Chrome for Testing version info')
  }

  const platformKey = getPlatformKey()
  const download = channel.downloads?.chrome?.find((d) => {
    return d.platform === platformKey
  })
  if (!download) {
    throw new Error(`No Chrome for Testing download found for platform: ${platformKey}`)
  }

  return { version: channel.version, downloadUrl: download.url }
}

async function downloadFile(url: string, destPath: string): Promise<void> {
  // 5-minute timeout per attempt, 3 retries for transient errors
  const maxAttempts = 3
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await downloadFileAttempt(url, destPath)
      return
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      // Don't retry on 4xx (permanent errors)
      if (lastError.message.includes('HTTP 4')) {
        throw lastError
      }
      if (attempt < maxAttempts) {
        const delay = attempt * 2000
        console.log(`  Download attempt ${attempt} failed, retrying in ${delay / 1000}s...`)
        await new Promise((resolve) => {
          return setTimeout(resolve, delay)
        })
      }
    }
  }
  throw lastError!
}

async function downloadFileAttempt(url: string, destPath: string): Promise<void> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(300_000), // 5 minute timeout
  })
  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status} for ${url}`)
  }
  if (!response.body) {
    throw new Error('Download failed: no response body')
  }

  const totalBytes = Number(response.headers.get('content-length') || 0)
  let downloadedBytes = 0
  let lastPct = 0

  const progressStream = new TransformStream({
    transform(chunk, controller) {
      downloadedBytes += chunk.byteLength
      if (totalBytes > 0) {
        const pct = Math.floor((downloadedBytes / totalBytes) * 100)
        if (pct >= lastPct + 5) {
          lastPct = pct
          const mb = (downloadedBytes / 1_048_576).toFixed(0)
          const totalMb = (totalBytes / 1_048_576).toFixed(0)
          process.stderr.write(`\r  ${mb}/${totalMb} MB (${pct}%)`)
        }
      }
      controller.enqueue(chunk)
    },
  })

  const readableStream = response.body.pipeThrough(progressStream)
  const nodeReadable = Readable.fromWeb(readableStream as any)
  const writeStream = fs.createWriteStream(destPath)
  await pipeline(nodeReadable, writeStream)
  process.stderr.write('\n')
}

function extractZip(zipPath: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true })
  const platform = os.platform()

  if (platform === 'win32') {
    execFileSync('powershell', [
      '-Command',
      `Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force`,
    ], { stdio: 'pipe' })
  } else {
    execFileSync('unzip', ['-o', '-q', zipPath, '-d', destDir], { stdio: 'pipe' })
  }
}

export async function installChrome(): Promise<{ version: string; binaryPath: string }> {
  console.log('Fetching latest Chrome for Testing version...')
  const { version, downloadUrl } = await fetchDownloadUrl()

  const browsersDir = getBrowsersDir()
  const destDir = path.join(browsersDir, `chrome-${version}`)

  // Check if already installed
  const existingBinary = findChromeBinaryInDir(destDir)
  if (existingBinary) {
    console.log(`Chrome ${version} is already installed.`)
    console.log(`  Location: ${existingBinary}`)
    return { version, binaryPath: existingBinary }
  }

  console.log(`Downloading Chrome ${version} for ${getPlatformKey()}...`)
  console.log(`  ${downloadUrl}`)

  // Private random folder: a fixed /tmp path lets other users on the machine swap the zip
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'playwriter-chrome-'))
  const tmpZip = path.join(tmpDir, `chrome-${version}.zip`)
  try {
    await downloadFile(downloadUrl, tmpZip)
    console.log('Extracting...')
    extractZip(tmpZip, destDir)
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }

  const binaryPath = findChromeBinaryInDir(destDir)
  if (!binaryPath) {
    // Clean up failed extraction
    fs.rmSync(destDir, { recursive: true, force: true })
    throw new Error('Chrome was downloaded but the binary could not be found in the extracted archive.')
  }

  // Ensure binary is executable on Unix
  if (os.platform() !== 'win32') {
    fs.chmodSync(binaryPath, 0o755)
  }

  console.log(`Chrome ${version} installed successfully.`)
  console.log(`  Location: ${binaryPath}`)
  return { version, binaryPath }
}
