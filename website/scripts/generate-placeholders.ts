/*
 * Generate pixelated placeholder images for the website.
 *
 * Scans website/public/ for all image files (png, jpg, jpeg, webp) and
 * generates a tiny 64px-wide version into src/assets/placeholders/.
 * When displayed at full size with CSS `image-rendering: pixelated`
 * (nearest-neighbor / point sampling), these produce a crisp mosaic effect.
 *
 * Output goes to src/assets/placeholders/ (NOT public/) so that Vite's
 * asset pipeline processes them. Since all placeholders are < 4KB, Vite
 * automatically inlines them as base64 data URIs via assetsInlineLimit,
 * eliminating extra HTTP requests.
 *
 * Skips files that already have the `placeholder-` prefix.
 * Skips regeneration if the placeholder is newer than the source image.
 *
 * Usage: tsx website/scripts/generate-placeholders.ts
 */

import sharp from 'sharp'
import path from 'node:path'
import fs from 'node:fs'

const PUBLIC_DIR = path.resolve(import.meta.dirname, '../public')
const OUTPUT_DIR = path.resolve(import.meta.dirname, '../src/assets/placeholders')
const PLACEHOLDER_PREFIX = 'placeholder-'
const PLACEHOLDER_WIDTH = 64
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })

  const entries = fs.readdirSync(PUBLIC_DIR)

  const images = entries.filter((name) => {
    if (name.startsWith(PLACEHOLDER_PREFIX)) {
      return false
    }
    const ext = path.extname(name).toLowerCase()
    return IMAGE_EXTENSIONS.has(ext)
  })

  if (images.length === 0) {
    console.error('No images found in public/')
    return
  }

  for (const name of images) {
    const inputPath = path.join(PUBLIC_DIR, name)
    const ext = path.extname(name)
    const base = path.basename(name, ext)
    const outputPath = path.join(OUTPUT_DIR, `${PLACEHOLDER_PREFIX}${base}${ext}`)

    // Skip if placeholder already exists and is newer than source
    if (fs.existsSync(outputPath)) {
      const srcMtime = fs.statSync(inputPath).mtimeMs
      const outMtime = fs.statSync(outputPath).mtimeMs
      if (outMtime > srcMtime) {
        continue
      }
    }

    await sharp(inputPath).resize(PLACEHOLDER_WIDTH).png({ compressionLevel: 9 }).toFile(outputPath)

    const stats = fs.statSync(outputPath)
    console.error(`Generated ${PLACEHOLDER_PREFIX}${base}${ext} (${PLACEHOLDER_WIDTH}px wide, ${stats.size} bytes)`)
  }
}

main()
