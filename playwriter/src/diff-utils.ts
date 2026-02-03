import { structuredPatch } from 'diff'

export interface SmartDiffResult {
  type: 'diff' | 'full' | 'no-change'
  content: string
}

export interface CreateSmartDiffOptions {
  oldContent: string
  newContent: string
  /** Threshold ratio (0-1) above which full content is returned instead of diff. Default 0.5 (50%) */
  threshold?: number
  /** Label for the diff output */
  label?: string
}

/**
 * Creates a smart diff that returns full content when changes exceed threshold.
 * 
 * When more than `threshold` (default 50%) of lines have changed, showing a diff
 * is not useful - we return the full new content instead.
 */
export function createSmartDiff(options: CreateSmartDiffOptions): SmartDiffResult {
  const { oldContent, newContent, threshold = 0.5, label = 'content' } = options

  const patch = structuredPatch(label, label, oldContent, newContent, 'previous', 'current', {
    context: 3,
  })

  // Count added and removed lines
  let addedLines = 0
  let removedLines = 0
  for (const hunk of patch.hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith('+')) {
        addedLines++
      } else if (line.startsWith('-')) {
        removedLines++
      }
    }
  }

  // No changes - return full content
  if (addedLines === 0 && removedLines === 0) {
    return { type: 'no-change', content: newContent }
  }

  // Calculate change ratio: use max(added, removed) since a replacement counts as both
  // This ensures the ratio stays in 0-100% range
  const oldLineCount = oldContent.split('\n').length
  const newLineCount = newContent.split('\n').length
  const maxLines = Math.max(oldLineCount, newLineCount, 1) // Avoid division by zero
  const changedLines = Math.max(addedLines, removedLines)
  const changeRatio = Math.min(changedLines / maxLines, 1) // Cap at 100%

  // Build unified diff string from structured patch
  const diffLines: string[] = [
    `--- ${label} (previous)`,
    `+++ ${label} (current)`,
  ]
  for (const hunk of patch.hunks) {
    diffLines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`)
    diffLines.push(...hunk.lines)
  }
  const diffString = diffLines.join('\n')

  // Return full content if changes exceed threshold OR if diff is longer than full content
  if (changeRatio >= threshold || diffString.length >= newContent.length) {
    return { type: 'full', content: newContent }
  }

  return { type: 'diff', content: diffString }
}
