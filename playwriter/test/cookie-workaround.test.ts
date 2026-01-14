/**
 * Cookie Workaround Integration Tests
 * 
 * Tests the CDP command interception for Storage.* → Network.* redirection.
 */
import { connectToPlaywriter, ensurePersistentRelay, waitForExtension } from '../src/index.js'
import type { Browser, BrowserContext, Page } from 'playwright-core'

async function main() {
  console.log('\n🍪 Cookie Workaround Integration Tests\n')
  
  await ensurePersistentRelay({ timeout: 15000 })
  await waitForExtension({ timeout: 5000 })
  const browser = await connectToPlaywriter({ timeout: 30000 })
  const context = browser.contexts()[0]
  const page = context.pages()[0]
  
  await page.goto('https://example.com', { waitUntil: 'domcontentloaded' })
  
  let passed = 0
  let failed = 0
  
  // Test 1: addCookies
  try {
    await context.addCookies([{
      name: 'test_cookie',
      value: 'test_value',
      domain: 'example.com',
      path: '/'
    }])
    console.log('  ✅ context.addCookies() works')
    passed++
  } catch (e: any) {
    console.log('  ❌ context.addCookies():', e.message)
    failed++
  }
  
  // Test 2: cookies (verify added cookie)
  try {
    const cookies = await context.cookies()
    if (!Array.isArray(cookies)) throw new Error('Should return array')
    const found = cookies.find(c => c.name === 'test_cookie')
    if (!found) throw new Error('Cookie not found')
    console.log('  ✅ context.cookies() returns added cookie')
    passed++
  } catch (e: any) {
    console.log('  ❌ context.cookies():', e.message)
    failed++
  }
  
  // Test 3: clearCookies
  try {
    await context.clearCookies()
    const after = await context.cookies()
    // Note: may have some cookies left from page, but test_cookie should be gone
    const foundAfter = after.find(c => c.name === 'test_cookie')
    if (foundAfter) throw new Error('Cookie still exists after clearCookies')
    console.log('  ✅ context.clearCookies() completes')
    passed++
  } catch (e: any) {
    console.log('  ❌ context.clearCookies():', e.message)
    failed++
  }
  
  // Test 4: storageState
  try {
    const state = await context.storageState()
    if (!state || typeof state !== 'object') throw new Error('Should return object')
    if (!('cookies' in state)) throw new Error('Should have cookies property')
    console.log('  ✅ context.storageState() works')
    passed++
  } catch (e: any) {
    console.log('  ❌ context.storageState():', e.message)
    failed++
  }
  
  console.log(`\n📊 Results: ${passed}/${passed + failed} passed\n`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(e => {
  console.error('Fatal:', e)
  process.exit(1)
})
