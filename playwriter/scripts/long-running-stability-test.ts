/**
 * Long-running Playwriter stability test.
 *
 * Creates a session, opens a single page, then loops for hours executing
 * various Playwright operations every 5 seconds. Tracks success/failure
 * counts and prints a summary on exit.
 *
 * Usage:
 *   bun playwriter/scripts/long-running-stability-test.ts
 *   bun playwriter/scripts/long-running-stability-test.ts --duration 2  # hours (default: 4)
 */

import { $ } from 'bun'

const INTERVAL_MS = 5_000
const DURATION_HOURS = (() => {
  const idx = process.argv.indexOf('--duration')
  return idx !== -1 ? Number(process.argv[idx + 1]) : 4
})()
const DURATION_MS = DURATION_HOURS * 60 * 60 * 1000

let totalRuns = 0
let successCount = 0
let errorCount = 0
const errors: { timestamp: string; iteration: number; operation: string; message: string }[] = []

function timestamp(): string {
  return new Date().toISOString()
}

function log(msg: string): void {
  console.log(`[${timestamp()}] ${msg}`)
}

function logError(iteration: number, operation: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err)
  errors.push({ timestamp: timestamp(), iteration, operation, message })
  errorCount++
  console.error(`[${timestamp()}] ERROR (iter ${iteration}, op: ${operation}): ${message}`)
}

async function pw(sessionId: string, code: string): Promise<string> {
  const result =
    await $`playwriter -s ${sessionId} --timeout 30000 -e ${code}`.text()
  return result.trim()
}

function printSummary(): void {
  const successRate = totalRuns > 0 ? ((successCount / totalRuns) * 100).toFixed(2) : '0.00'
  console.log('\n' + '='.repeat(60))
  console.log('PLAYWRITER LONG-RUNNING STABILITY TEST — SUMMARY')
  console.log('='.repeat(60))
  console.log(`Duration requested : ${DURATION_HOURS} hours`)
  console.log(`Total operations   : ${totalRuns}`)
  console.log(`Successful         : ${successCount}`)
  console.log(`Failed             : ${errorCount}`)
  console.log(`Success rate       : ${successRate}%`)
  if (errors.length > 0) {
    console.log(`\nFirst 20 errors:`)
    for (const e of errors.slice(0, 20)) {
      console.log(`  [${e.timestamp}] iter=${e.iteration} op=${e.operation}: ${e.message}`)
    }
    if (errors.length > 20) {
      console.log(`  ... and ${errors.length - 20} more`)
    }
  }
  console.log('='.repeat(60))
}

// Print summary on exit (Ctrl+C or natural end)
process.on('SIGINT', () => {
  log('Received SIGINT, shutting down...')
  printSummary()
  process.exit(0)
})
process.on('SIGTERM', () => {
  log('Received SIGTERM, shutting down...')
  printSummary()
  process.exit(0)
})

async function main(): Promise<void> {
  log(`Starting stability test (${DURATION_HOURS}h, interval ${INTERVAL_MS / 1000}s)`)

  // Create a session
  log('Creating session...')
  const sessionRaw = await $`playwriter session new`.text()
  const sessionMatch = sessionRaw.match(/Session\s+(\S+)\s+created/)
  if (!sessionMatch) {
    throw new Error(`Failed to parse session id from: ${sessionRaw.trim()}`)
  }
  const sessionId = sessionMatch[1]
  log(`Session created: ${sessionId}`)

  // Create a page (outside the loop — single page for entire test)
  log('Creating page...')
  await pw(sessionId, `await page.goto("https://example.com")`)
  log('Page ready at https://example.com')

  const startTime = Date.now()
  let iteration = 0

  while (Date.now() - startTime < DURATION_MS) {
    iteration++
    const elapsedMin = ((Date.now() - startTime) / 60_000).toFixed(1)
    log(`--- Iteration ${iteration} (${elapsedMin} min elapsed) ---`)

    // Operation 1: page.title()
    try {
      totalRuns++
      const title = await pw(sessionId, `return await page.title()`)
      log(`  title() => ${title}`)
      successCount++
    } catch (err) {
      logError(iteration, 'title', err)
    }

    // Operation 2: page.evaluate — read document.readyState
    try {
      totalRuns++
      const state = await pw(
        sessionId,
        `return await page.evaluate(() => { return document.readyState })`,
      )
      log(`  evaluate(readyState) => ${state}`)
      successCount++
    } catch (err) {
      logError(iteration, 'evaluate-readyState', err)
    }

    // Operation 3: page.evaluate — read body text length
    try {
      totalRuns++
      const len = await pw(
        sessionId,
        `return await page.evaluate(() => { return document.body.innerText.length })`,
      )
      log(`  evaluate(body.length) => ${len}`)
      successCount++
    } catch (err) {
      logError(iteration, 'evaluate-bodyLength', err)
    }

    // Operation 4: page.url()
    try {
      totalRuns++
      const url = await pw(sessionId, `return page.url()`)
      log(`  url() => ${url}`)
      successCount++
    } catch (err) {
      logError(iteration, 'url', err)
    }

    // Operation 5: snapshot
    try {
      totalRuns++
      const snap = await pw(
        sessionId,
        `const s = await snapshot({ page }); return s.substring(0, 80)`,
      )
      log(`  snapshot() => ${snap}...`)
      successCount++
    } catch (err) {
      logError(iteration, 'snapshot', err)
    }

    // Operation 6: page.evaluate — run a small computation
    try {
      totalRuns++
      const result = await pw(
        sessionId,
        `return await page.evaluate(() => { return Array.from({length: 100}, (_, i) => i).reduce((a, b) => a + b, 0) })`,
      )
      log(`  evaluate(sum 0..99) => ${result}`)
      successCount++
    } catch (err) {
      logError(iteration, 'evaluate-computation', err)
    }

    // Operation 7: page.locator count
    try {
      totalRuns++
      const count = await pw(
        sessionId,
        `return await page.locator("*").count()`,
      )
      log(`  locator("*").count() => ${count}`)
      successCount++
    } catch (err) {
      logError(iteration, 'locator-count', err)
    }

    // Operation 8: navigate away and back (heavier operation)
    try {
      totalRuns++
      await pw(sessionId, `await page.goto("https://example.com")`)
      log(`  goto(example.com) => ok`)
      successCount++
    } catch (err) {
      logError(iteration, 'goto', err)
    }

    // Print running stats every 10 iterations
    if (iteration % 10 === 0) {
      const rate = ((successCount / totalRuns) * 100).toFixed(2)
      log(`  [STATS] ${successCount}/${totalRuns} successful (${rate}%), ${errorCount} errors`)
    }

    // Wait before next iteration
    await Bun.sleep(INTERVAL_MS)
  }

  log('Duration elapsed, finishing up.')
  printSummary()
}

main().catch((err) => {
  console.error(`Fatal error: ${err}`)
  printSummary()
  process.exit(1)
})
