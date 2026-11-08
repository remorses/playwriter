import { describe, expect, it, test } from 'vitest'
import { aimOffset, isBotProtectedUrl } from './human-input.js'

test('auto human input matches bot-protected sites, their subdomains and country sites', () => {
  const urls = [
    'https://x.com/home',
    'https://mobile.twitter.com/',
    'https://www.amazon.com/dp/B0',
    'https://www.amazon.co.uk/',
    'https://www.amazon.com.au/',
    'https://accounts.google.com/signin',
    'https://www.google.de/search?q=1',
    'https://it.pinterest.com/pin/1',
    'https://www.pinterest.it/',
    'https://www.ebay.de/itm/1',
    'https://www.linkedin.com/feed',
    'https://max.com/',
    'https://amazonaws.com/',
    'https://amazon.example.org/',
    'https://google.github.io/',
    'https://xcom.dev/',
    'http://127.0.0.1:3000/',
    'about:blank',
    'not a url',
  ]
  expect(Object.fromEntries(urls.map((url) => [url, isBotProtectedUrl(url)]))).toMatchInlineSnapshot(`
    {
      "about:blank": false,
      "http://127.0.0.1:3000/": false,
      "https://accounts.google.com/signin": true,
      "https://amazon.example.org/": false,
      "https://amazonaws.com/": false,
      "https://google.github.io/": false,
      "https://it.pinterest.com/pin/1": true,
      "https://max.com/": false,
      "https://mobile.twitter.com/": true,
      "https://www.amazon.co.uk/": true,
      "https://www.amazon.com.au/": true,
      "https://www.amazon.com/dp/B0": true,
      "https://www.ebay.de/itm/1": true,
      "https://www.google.de/search?q=1": true,
      "https://www.linkedin.com/feed": true,
      "https://www.pinterest.it/": true,
      "https://x.com/home": true,
      "https://xcom.dev/": false,
      "not a url": false,
    }
  `)
})

describe('aimOffset', () => {
  it('stays inside a thin rotated element and skips other points', () => {
    // 200x4 px element rotated 45 degrees, as DOM.getContentQuads reports it
    const s = Math.SQRT1_2
    const corners = [
      [-100 * s + 2 * s, -100 * s - 2 * s],
      [100 * s + 2 * s, 100 * s - 2 * s],
      [100 * s - 2 * s, 100 * s + 2 * s],
      [-100 * s - 2 * s, -100 * s + 2 * s],
    ].map(([x, y]) => [x + 300, y + 300])
    const quad = corners.flat()
    const along = { x: s, y: s }
    const across = { x: -s, y: s }
    for (let i = 0; i < 2000; i++) {
      const offset = aimOffset({ point: { x: 300, y: 300 }, quads: [quad] })
      // Distance from the center along each element axis
      expect(Math.abs(offset.x * along.x + offset.y * along.y)).toBeLessThanOrEqual(10)
      expect(Math.abs(offset.x * across.x + offset.y * across.y)).toBeLessThanOrEqual(0.8 + 1e-9)
    }
    expect(aimOffset({ point: { x: 310, y: 300 }, quads: [quad] })).toEqual({ x: 0, y: 0 })
  })
})
