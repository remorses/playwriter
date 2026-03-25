import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const playwriterDir = path.join(__dirname, '..')
const repoRoot = path.join(playwriterDir, '..')
const extensionDir = path.join(repoRoot, 'extension')
const extensionOutDirName = 'dist-packaged'
const extensionOutDir = path.join(extensionDir, extensionOutDirName)
const bundledExtensionDir = path.join(playwriterDir, 'dist', 'extension')

function runCommand({
  command,
  args,
  cwd,
  env,
}: {
  command: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: 'inherit',
    })

    child.on('error', (error) => {
      reject(error)
    })

    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`Command failed with exit code ${code}: ${command} ${args.join(' ')}`))
    })
  })
}

async function main(): Promise<void> {
  const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

  await runCommand({
    command: pnpmCommand,
    args: ['build'],
    cwd: extensionDir,
    env: {
      ...process.env,
      PLAYWRITER_EXTENSION_DIST: extensionOutDirName,
      PLAYWRITER_OPEN_WELCOME_PAGE: '0',
    },
  })

  fs.rmSync(bundledExtensionDir, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(bundledExtensionDir), { recursive: true })
  fs.cpSync(extensionOutDir, bundledExtensionDir, { recursive: true })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
