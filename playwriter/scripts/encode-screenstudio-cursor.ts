/**
 * Encodes the extracted Screen Studio cursor SVG as a data URL TS module.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const sourcePath = path.resolve(__dirname, '../src/assets/cursors/screen-studio/pointer-macos-tahoe.svg')
const outputPath = path.resolve(__dirname, '../src/assets/cursors/screen-studio/pointer-macos-tahoe-data-url.ts')

function main() {
  const svg = fs.readFileSync(sourcePath, 'utf-8').trim()
  const base64 = Buffer.from(svg, 'utf-8').toString('base64')
  const dataUrl = `data:image/svg+xml;base64,${base64}`

  const output = `/**\n * Generated from pointer-macos-tahoe.svg via scripts/encode-screenstudio-cursor.ts.\n */\n\nexport const SCREENSTUDIO_POINTER_MACOS_TAHOE_DATA_URL = '${dataUrl}'\n`
  fs.writeFileSync(outputPath, output)
  console.log(`Wrote ${outputPath}`)
}

main()
