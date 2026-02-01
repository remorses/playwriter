/**
 * Vitest setup - handles Playwright CDP disconnect race condition.
 * 
 * ROOT CAUSE (from Playwright source crConnection.ts:164):
 * 
 *   _onMessage(object: ProtocolResponse) {
 *     if (object.id && this._callbacks.has(object.id)) {
 *       // Handle response with matching callback
 *     } else if (object.id && object.error?.code === -32001) {
 *       // Closed session error - ignore
 *     } else {
 *       assert(!object.id);  // ← FAILS: expects event, got orphaned response
 *     }
 *   }
 * 
 * WHY IT HAPPENS:
 * 1. Relay sends CDP response to Playwright
 * 2. Playwright's messageWrap() schedules _onMessage for next task
 * 3. browser.close() is called
 * 4. _onClose() fires IMMEDIATELY and clears callbacks via dispose()
 * 5. Scheduled _onMessage finally runs
 * 6. Looks for callback → NOT FOUND → assertion fails
 * 
 * This is a race condition in Playwright's async message handling that we cannot
 * fix without patching Playwright. The assertion error during disconnect is benign
 * and expected - it just means a CDP response arrived after we stopped caring.
 * 
 * See: https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/chromium/crConnection.ts
 */

process.on('unhandledRejection', (reason: any) => {
  // Check if this is Playwright's CDP disconnect assertion error
  if (reason?.message === 'Assertion error') {
    const stack = reason?.stack || ''
    if (stack.includes('crConnection.js') || stack.includes('crSession')) {
      // Benign race condition during disconnect - suppress
      return
    }
  }
  
  // Re-throw other unhandled rejections to fail the test
  throw reason
})
