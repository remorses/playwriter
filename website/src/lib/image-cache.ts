/*
 * Server-side image metadata cache.
 *
 * Generates and caches image dimensions (via image-size) and tiny 64px
 * placeholders (via sharp) as JSON files in website/.cache/images/.
 * Designed to run during SSR/SSG — not in client components.
 *
 * Cache invalidation: each JSON stores the source file's mtime. On cache
 * read, if the mtime differs the entry is regenerated.
 *
 * The placeholder is stored as a base64 data URI (PNG, ~2–4KB) that
 * PixelatedImage renders with CSS image-rendering: pixelated.
 */

import fs from 'node:fs'
import path from 'node:path'
import type { Root, RootContent } from 'mdast'

const PLACEHOLDER_WIDTH = 64
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

export type ImageMeta = {
  width: number
  height: number
  /** data:image/png;base64,... */
  placeholder: string
}

type CacheEntry = ImageMeta & {
  /** mtime of the source image when this cache was written */
  mtime: number
}

/** Walk mdast tree and collect all local image srcs. */
export function collectImageSrcs(root: Root): string[] {
  const srcs: string[] = []

  function walk(nodes: RootContent[]) {
    for (const node of nodes) {
      if (node.type === 'image' && node.url && !node.url.startsWith('http')) {
        srcs.push(node.url)
      }
      /* mdxJsxFlowElement with name PixelatedImage or img */
      if (
        node.type === 'mdxJsxFlowElement' &&
        'name' in node &&
        'attributes' in node
      ) {
        const name = (node as { name?: string }).name
        if (name === 'PixelatedImage' || name === 'img') {
          const attrs = (node as { attributes: Array<{ type: string; name?: string; value?: unknown }> }).attributes
          const srcAttr = attrs.find((a) => {
            return a.type === 'mdxJsxAttribute' && a.name === 'src'
          })
          if (srcAttr) {
            const val = getAttrStringValue(srcAttr.value)
            if (val && !val.startsWith('http')) {
              srcs.push(val)
            }
          }
        }
      }
      if ('children' in node && Array.isArray(node.children)) {
        walk(node.children as RootContent[])
      }
    }
  }

  walk(root.children)
  return [...new Set(srcs)]
}

/**
 * Build a manifest of image metadata for all local images in the mdast.
 * Reads from cache when valid, generates on miss.
 */
export async function buildImageManifest({
  mdast,
  publicDir,
  cacheDir,
}: {
  mdast: Root
  publicDir: string
  cacheDir: string
}): Promise<Record<string, ImageMeta>> {
  const srcs = collectImageSrcs(mdast)
  const manifest: Record<string, ImageMeta> = {}

  try {
    fs.mkdirSync(cacheDir, { recursive: true })
  } catch (e) {
    console.error('image-cache: cannot create cache dir (read-only fs?)', e)
  }

  await Promise.all(
    srcs.map(async (src) => {
      const meta = await getOrGenerateImageMeta({ src, publicDir, cacheDir })
      if (meta) {
        manifest[src] = meta
      }
    }),
  )

  return manifest
}

async function getOrGenerateImageMeta({
  src,
  publicDir,
  cacheDir,
}: {
  src: string
  publicDir: string
  cacheDir: string
}): Promise<ImageMeta | undefined> {
  /* Resolve src (e.g. "/screenshot@2x.png") to filesystem path */
  const srcPath = src.startsWith('/') ? src.slice(1) : src
  const filePath = path.join(publicDir, srcPath)

  if (!fs.existsSync(filePath)) {
    return undefined
  }

  const ext = path.extname(filePath).toLowerCase()
  if (!IMAGE_EXTENSIONS.has(ext)) {
    return undefined
  }

  const stat = fs.statSync(filePath)
  const cacheName = sanitizeCacheKey(src)
  const cachePath = path.join(cacheDir, `${cacheName}.json`)

  /* Check cache */
  if (fs.existsSync(cachePath)) {
    const cached: CacheEntry = JSON.parse(fs.readFileSync(cachePath, 'utf-8'))
    if (cached.mtime === stat.mtimeMs) {
      return {
        width: cached.width,
        height: cached.height,
        placeholder: cached.placeholder,
      }
    }
  }

  /* Cache miss — generate */
  const [{ imageSizeFromFile }, sharp] = await Promise.all([
    import('image-size/fromFile'),
    import('sharp').then((m) => {
      return m.default
    }),
  ])

  const [size, placeholderBuf] = await Promise.all([
    imageSizeFromFile(filePath),
    sharp(filePath)
      .resize(PLACEHOLDER_WIDTH)
      .png({ compressionLevel: 9 })
      .toBuffer(),
  ])

  const meta: ImageMeta = {
    width: size.width,
    height: size.height,
    placeholder: `data:image/png;base64,${placeholderBuf.toString('base64')}`,
  }

  /* Write cache — logs on failure (Vercel has read-only fs) */
  try {
    const entry: CacheEntry = { ...meta, mtime: stat.mtimeMs }
    fs.writeFileSync(cachePath, JSON.stringify(entry))
  } catch (e) {
    console.error(`image-cache: cannot write ${cachePath} (read-only fs?)`, e)
  }

  return meta
}

/** Extract string value from an mdxJsxAttribute value (string or expression). */
export function getAttrStringValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value
  }
  if (value && typeof value === 'object' && 'value' in value) {
    const v = (value as { value: string }).value
    /* Expression values may be quoted strings like "'foo'" or numbers like "1280" */
    if (typeof v === 'string') {
      /* Strip surrounding quotes if present */
      const unquoted = v.replace(/^['"]|['"]$/g, '')
      return unquoted
    }
  }
  return undefined
}

/** Get a named attribute from an mdxJsxFlowElement node. */
export function getJsxAttr(
  node: { attributes?: Array<{ type: string; name?: string; value?: unknown }> },
  name: string,
): string | undefined {
  const attr = node.attributes?.find((a) => {
    return a.type === 'mdxJsxAttribute' && a.name === name
  })
  if (!attr) {
    return undefined
  }
  return getAttrStringValue(attr.value)
}

function sanitizeCacheKey(src: string): string {
  return src.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^_+/, '')
}
