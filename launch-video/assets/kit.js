// Helpers shared by every scene. Every visible value is a function of timeline time.
;(function () {
  // "Infinite Dimensions" Udio extension v2, one continuous excerpt from 12.831489 s.
  // 113.97 BPM; the original drop lands on beat 8. No repeated sections.
  const BEAT = 0.52643

  // Seconds of a global beat inside a scene whose host starts at global beat `origin`.
  function beats(origin) {
    return (b) => (b - origin) * BEAT
  }

  // One tween over the whole scene that calls draw(t) on every seek.
  function everyFrame(tl, duration, draw) {
    const clock = { t: 0 }
    tl.fromTo(clock, { t: 0 }, { t: duration, duration, ease: 'none', onUpdate: () => draw(clock.t) }, 0)
  }

  // Deterministic PRNG (mulberry32).
  function random(seed) {
    let a = seed
    return () => {
      a = (a + 0x6d2b79f5) | 0
      let r = Math.imul(a ^ (a >>> 15), 1 | a)
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296
    }
  }

  const clamp01 = (x) => Math.min(1, Math.max(0, x))
  const smooth = (x) => {
    const k = clamp01(x)
    return k * k * (3 - 2 * k)
  }
  const easeInOut = (x) => {
    const k = clamp01(x)
    return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2
  }

  // Camera through keys { t, x, y, z }: world point (x, y) sits at the screen anchor with zoom z.
  // Each segment eases in and out, so the camera never stops dead at a key and never jerks.
  // A slow handheld drift rides on top.
  function camera(keys, t, { ax = 960, ay = 540, drift = 1 } = {}) {
    let a = keys[0]
    let b = keys[0]
    for (let i = 1; i < keys.length; i++) {
      if (t < keys[i].t) {
        a = keys[i - 1]
        b = keys[i]
        break
      }
      a = b = keys[i]
    }
    const k = a === b ? 0 : easeInOut((t - a.t) / (b.t - a.t))
    const lerp = (p) => a[p] + (b[p] - a[p]) * k
    const z = lerp('z') * (1 + 0.004 * t)
    const x = lerp('x') + Math.sin(t * 0.9) * 6 * drift
    const y = lerp('y') + Math.cos(t * 0.7) * 4 * drift
    const rot = Math.sin(t * 0.6) * 0.25 * drift
    return { tx: ax - x * z, ty: ay - y * z, z, rot }
  }

  function applyCamera(el, cam) {
    el.style.transform = `translate(${cam.tx}px, ${cam.ty}px) scale(${cam.z}) rotate(${cam.rot}deg)`
  }

  // Splits el's text into one span per character and reveals them at the given times.
  // gaps: seconds between keys (number or array). Returns the time the last key lands.
  function typeText(tl, el, at, gaps = 0.035) {
    const text = el.textContent
    el.textContent = ''
    let t = at
    const spans = [...text].map((ch, i) => {
      const s = document.createElement('span')
      s.textContent = ch
      s.style.opacity = '0'
      el.appendChild(s)
      tl.set(s, { opacity: 1 }, t)
      const last = i === text.length - 1
      if (!last) t += Array.isArray(gaps) ? gaps[i % gaps.length] : gaps
      return s
    })
    return { end: t, spans }
  }

  // Words arrive one by one: blur to sharp, no translate (hyperframes title style).
  function blurWords(tl, el, at, { stagger = 0.07, duration = 0.32 } = {}) {
    const words = el.textContent.split(' ')
    el.textContent = ''
    const spans = words.map((w, i) => {
      const s = document.createElement('span')
      s.textContent = w
      s.style.display = 'inline-block'
      el.appendChild(s)
      if (i < words.length - 1) el.appendChild(document.createTextNode(' '))
      return s
    })
    tl.fromTo(
      spans,
      { opacity: 0, filter: 'blur(10px)' },
      { opacity: 1, filter: 'blur(0px)', duration, stagger, ease: 'expo.out' },
      at,
    )
    return spans
  }

  // Cubic bezier point at u.
  function bezier(p, u) {
    const v = 1 - u
    return {
      x: v * v * v * p[0].x + 3 * v * v * u * p[1].x + 3 * v * u * u * p[2].x + u * u * u * p[3].x,
      y: v * v * v * p[0].y + 3 * v * v * u * p[1].y + 3 * v * u * u * p[2].y + u * u * u * p[3].y,
    }
  }

  // A human mouse path: a curve that bows to one side of the straight line, like Patchright's.
  function humanPath(from, to, bow = 0.22) {
    const dx = to.x - from.x
    const dy = to.y - from.y
    const nx = -dy * bow
    const ny = dx * bow
    return [
      from,
      { x: from.x + dx * 0.28 + nx, y: from.y + dy * 0.28 + ny },
      { x: from.x + dx * 0.78 + nx * 0.6, y: from.y + dy * 0.78 + ny * 0.6 },
      to,
    ]
  }

  function pathD(p) {
    return `M${p[0].x} ${p[0].y} C${p[1].x} ${p[1].y} ${p[2].x} ${p[2].y} ${p[3].x} ${p[3].y}`
  }

  const EXIT_S = 0.38
  const ENTER_S = 0.9

  // The intro's ghost cursor, shared by intro.html (draws it) and field.html (the ASCII field
  // lights up in its wake and ripples from its click). Screen coords, seconds from film start.
  const intro = (() => {
    const b = (n) => n * BEAT
    const PEN0 = { x: 452, y: 470 } // left end of the wordmark
    const PEN1 = { x: 1408, y: 452 } // right end
    const VERSION = { x: 1452, y: 556 } // where it clicks: "0.11" pops out here
    const T = {
      enter: 0.05,
      write: b(1.6),
      written: b(3.5),
      click: b(4),
      lift: b(4.25),
      flicks: [b(6.4), b(6.8)],
      exit: b(8) - 0.42,
    }
    const enterPath = humanPath({ x: 1800, y: 1160 }, PEN0, 0.3)
    const toVersion = humanPath(PEN1, VERSION, -0.6)
    const away = humanPath(VERSION, { x: 1240, y: 820 }, 0.35)

    // pen tip while writing: steady left to right, with the up and down of script letters
    function write(u) {
      const x = PEN0.x + (PEN1.x - PEN0.x) * u
      const loops = Math.sin(u * Math.PI * 2 * 6.5) * 46 + Math.sin(u * Math.PI * 2 * 2.3 + 1) * 14
      return { x, y: PEN0.y + (PEN1.y - PEN0.y) * u - loops * Math.sin(Math.PI * Math.min(1, u * 1.15)) }
    }

    // writing progress 0..1 (fast start, soft end, like a signature)
    function writeU(t) {
      const k = clamp01((t - T.write) / (T.written - T.write))
      return 1 - Math.pow(1 - k, 1.6)
    }

    function cursorAt(t) {
      if (t < T.write) return bezier(enterPath, easeInOut((t - T.enter) / (T.write - T.enter)))
      if (t < T.written) return write(writeU(t))
      if (t < T.click) return bezier(toVersion, easeInOut((t - T.written) / (T.click - T.written - 0.04)))
      const leave = T.click + 0.35
      return bezier(away, easeInOut((t - leave) / 1.1))
    }

    // how far the intro page has been scrolled by the wheel flicks and the final exit
    function scrollAt(t) {
      const out = (k) => 1 - Math.pow(1 - clamp01(k), 3)
      const inn = (k) => Math.pow(clamp01(k), 3)
      return out((t - T.flicks[0]) / 0.32) * 70 + out((t - T.flicks[1]) / 0.32) * 120 + inn((t - T.exit) / 0.4) * 1400
    }

    return { T, PEN0, PEN1, VERSION, writeU, cursorAt, scrollAt }
  })()

  window.Kit = {
    intro,
    BEAT,
    EXIT_S,
    ENTER_S,
    beats,
    everyFrame,
    random,
    clamp01,
    smooth,
    easeInOut,
    camera,
    applyCamera,
    typeText,
    blurWords,
    bezier,
    humanPath,
    pathD,
  }
})()
