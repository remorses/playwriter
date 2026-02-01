import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.join(__dirname, '..', 'dist')
const srcDir = path.join(__dirname, '..', 'src')

async function main() {
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true })
  }

  console.log('Bundling a11y-client...')

  const result = await Bun.build({
    entrypoints: [path.join(srcDir, 'a11y-client.ts')],
    target: 'browser',
    format: 'iife',
    define: {
      'process.env.NODE_ENV': '"development"',
    },
  })

  if (!result.success) {
    console.error('Bundle errors:', result.logs)
    process.exit(1)
  }

  const bundledCode = await result.outputs[0].text()
  const outputPath = path.join(distDir, 'a11y-client.js')
  fs.writeFileSync(outputPath, bundledCode)
  console.log(`Saved to ${outputPath} (${Math.round(bundledCode.length / 1024)}kb)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
