// The film's clock: voice line starts (from line durations and gaps) and every key event time, in
// seconds from film start.
// desk.html, outro.html and scripts/sfx.ts all read TIMELINE, so pictures and sounds land on the
// spoken word. Needs vo/lines.js (globalThis.VO_LINES, word times from scripts/voice.ts) loaded first.
;(function () {
  const lines = Object.fromEntries(globalThis.VO_LINES.map((l) => [l.id, l]))
  // silence after each line: longer where the picture needs time (the rewind, the click, typing the code)
  const GAP_AFTER = { l1: 0.4, l2: 0.6, l3: 1.4, l4: 0.5, l5: 0.5, l6: 0.9, l7: 0.9, l8: 1.2 }
  const START = {}
  let at = 0.6
  for (const id of Object.keys(lines)) {
    START[id] = Number(at.toFixed(3))
    at += lines[id].duration + (GAP_AFTER[id] ?? 0)
  }
  const FILM = Number((at + 2.2).toFixed(3))
  const HOSTS = { desk: [0, START.l9 + 0.1], outro: [START.l9 - 0.8, FILM] }
  // time of a spoken word: word('l6', 'front'); nth picks a repeated word
  function word(id, w, nth = 0) {
    const hit = lines[id].words.filter((x) => x.word === w)[nth]
    if (!hit) throw new Error(`no word "${w}" in ${id}`)
    return START[id] + hit.start
  }

  // the agent clicks Sign in on "signs in", after it typed the password
  const signinClick = Math.max(word('l1', 'signs'), 2.25 + 0.035 * 12 + 0.7)
  const verifyAt = signinClick + 0.35
  const steal = word('l3', 'front') - 0.15
  const rewind = word('l3', 'busy') + 0.35
  const linkClick = word('l6', 'click')
  const digitStart = word('l7', 'type')
  const digits = [0, 0.31, 0.27, 0.36, 0.25, 0.3].map((_, i, gaps) => digitStart + gaps.slice(0, i + 1).reduce((a, b) => a + b, 0))
  const got = word('l7', 'got') - 0.05
  // waitForHandoff shows "Got it" for 1.2 s, then removes the card
  const cleared = got + 1.2

  const EV = {
    agentIn: 0.5,
    emailClick: 1.3,
    email: { start: 1.45, gap: 0.045, text: 'tommy@hey.com' },
    pass: { start: 2.25, gap: 0.035, text: '••••••••••••' },
    signinMove: signinClick - 0.65,
    signinClick,
    verifyAt,
    waiting: word('l2', 'step'),
    notesA: { start: START.l3 + 0.4, gap: 0.09, text: 'write the ch' },
    steal,
    rewind,
    unsteal: rewind + 0.75,
    notesB: { start: rewind + 1.1, gap: 0.085, text: 'angelog' },
    notesC: { start: START.l4 + 0.7, gap: 0.11, text: '- email the beta testers' },
    cardIn: word('l4', 'card') - 0.1,
    scrollAway: START.l5 + 0.1,
    linkMsg: word('l5', 'link') - 0.25,
    linkHighlight: word('l5', 'localhost') - 0.1,
    youIn: START.l6 - 0.6,
    linkClick,
    front: linkClick + 0.2,
    // the focus page shows for a moment, focuses the handoff tab, then closes itself
    back: linkClick + 0.75,
    scrollBack: word('l6', 'scroll') - 0.1,
    digits,
    got,
    cleared,
    verifyClick: cleared + 1.0,
    verifiedMsg: word('l7', 'nothing') + 0.6,
    nextSite: START.l8 - 0.5,
    cornerIn: START.l8 + 0.3,
    xClick: word('l8', 'close'),
    askMsg: word('l8', 'asks') - 0.25,
    deskOut: START.l9 - 0.5,
    logo: word('l9', 'handoff'),
  }

  globalThis.TIMELINE = { START, FILM, HOSTS, EV, word, lines }
})()
