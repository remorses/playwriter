// Helpers shared by every scene. Every visible value is a function of timeline time.
;(function () {
  // One tween over the whole scene that calls draw(t) on every seek.
  function everyFrame(tl, duration, draw) {
    const clock = { t: 0 }
    tl.fromTo(clock, { t: 0 }, { t: duration, duration, ease: 'none', onUpdate: () => draw(clock.t) }, 0)
  }

  const clamp01 = (x) => Math.min(1, Math.max(0, x))
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

  // Cubic bezier point at u.
  function bezier(p, u) {
    const v = 1 - u
    return {
      x: v * v * v * p[0].x + 3 * v * v * u * p[1].x + 3 * v * u * u * p[2].x + u * u * u * p[3].x,
      y: v * v * v * p[0].y + 3 * v * v * u * p[1].y + 3 * v * u * u * p[2].y + u * u * u * p[3].y,
    }
  }

  // A human mouse path: a curve that bows to one side of the straight line.
  function humanPath(from, to, bow = 0.22) {
    const dx = to.x - from.x
    const dy = to.y - from.y
    const nx = -dy * bow
    const ny = dx * bow
    return [from, { x: from.x + dx * 0.28 + nx, y: from.y + dy * 0.28 + ny }, { x: from.x + dx * 0.78 + nx * 0.6, y: from.y + dy * 0.78 + ny * 0.6 }, to]
  }

  const still = (p) => [p, p, p, p]

  // A cursor as a list of moves; position is a pure function of t and holds at the end of each move.
  function track(start) {
    const moves = [{ path: still(start), start: -1, duration: 1 }]
    return {
      move(path, startAt, duration) {
        moves.push({ path, start: startAt, duration })
      },
      at(t) {
        let m = moves[0]
        for (const move of moves) if (t >= move.start) m = move
        return bezier(m.path, easeInOut((t - m.start) / m.duration))
      },
    }
  }

  // The real Playwriter handoff card: DOM and CSS captured from handoff() (assets/card/card.js).
  // CSS animations run on wall time, so they are dropped; the scene tweens the card instead.
  function handoffCard(host, state) {
    const data = window.HANDOFF_CARD
    const root = host.attachShadow({ mode: 'open' })
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(`${data.css}\n.card { animation: none !important; transition: none !important; }`)
    root.adoptedStyleSheets = [sheet]
    root.innerHTML = data.html[state]
    return root.querySelector('.card')
  }

  const EXIT_S = 0.38

  window.Kit = { EXIT_S, everyFrame, easeInOut, camera, applyCamera, bezier, humanPath, still, track, handoffCard }
})()
