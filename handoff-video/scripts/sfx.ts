// Writes the voiceover lines and one sound cue per visible action into index.html (AUDIO markers),
// and sets the scene hosts and the film length from the timeline.
// Times come from assets/timeline.js, the same table the scenes use. Each cue starts at `event - hit`
// so its loudest point lands on the event; volume comes from measured loudness (assets/sfx/analysis.json)
// and the targets in the sound-effects skill, a few dB lower than usual because the voice leads.
// Run: bun scripts/sfx.ts

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.join(import.meta.dirname, '..')
await import(path.join(ROOT, 'assets/vo/lines.js'))
await import(path.join(ROOT, 'assets/timeline.js'))
const { START, FILM, HOSTS, EV, lines } = (globalThis as any).TIMELINE

interface Analysis {
  file: string
  duration: number
  lufs: number
  hit: number
  character: 'low' | 'mid' | 'bright' | 'very bright'
}
const analysis = new Map<string, Analysis>(
  fs
    .readFileSync(path.join(ROOT, 'assets/sfx/analysis.json'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Analysis)
    .map((a) => [path.basename(a.file, '.mp3'), a]),
)
const VOICE_DUCK = -3
const TARGET = { low: -26 + VOICE_DUCK, mid: -28 + VOICE_DUCK, bright: -32 + VOICE_DUCK, 'very bright': -36 + VOICE_DUCK }

interface Cue {
  sound: string
  at: number
  note: string
  /** seconds to keep, for long files like typing */
  length?: number
  /** dB on top of the loudness target */
  gain?: number
  /** start the file at `at` instead of aligning its hit */
  fromStart?: boolean
}

const typed = (e: { start: number; gap: number; text: string }) => ({ at: e.start, length: e.gap * e.text.length + 0.1, fromStart: true })

// one different whoosh per camera move or transition
const CUES: Cue[] = [
  { sound: 'whoosh-riser', at: 0.35, note: 'desktop rises' },
  { sound: 'tap', at: EV.emailClick, note: 'agent clicks email', gain: -4 },
  { sound: 'typing', ...typed(EV.email), note: 'agent types email', gain: -3 },
  { sound: 'typing', ...typed(EV.pass), note: 'agent types password', gain: -3 },
  { sound: 'tap', at: EV.signinClick, note: 'agent clicks Sign in', gain: -4 },
  { sound: 'whoosh-soft', at: START.l3 + 0.5, note: 'camera pulls back to the desktop' },
  { sound: 'typing', ...typed(EV.notesA), note: 'you type in Notes', gain: -6 },
  { sound: 'thud', at: EV.steal + 0.05, note: 'Chrome jumps in front of Notes', gain: 3 },
  { sound: 'whoosh-digital', at: EV.rewind + 0.25, note: 'rewind', gain: -6 },
  { sound: 'typing', ...typed(EV.notesC), note: 'you keep typing in Notes', gain: -6 },
  { sound: 'card', at: EV.cardIn + 0.06, note: 'the real card slides in, ring draws' },
  { sound: 'whoosh-slide', at: EV.linkMsg + 0.3, note: 'camera to the chat' },
  { sound: 'text-tap-down4', at: EV.linkMsg + 0.1, note: 'chat: the link', gain: -4 },
  { sound: 'whoosh-air', at: EV.linkHighlight + 0.3, note: 'push in on the localhost link', gain: -3 },
  { sound: 'whoosh-zip', at: EV.youIn + 0.5, note: 'your cursor goes to the link', gain: -4 },
  { sound: 'tap', at: EV.linkClick, note: 'click the link', gain: 2 },
  { sound: 'whoosh-swing', at: EV.back + 0.05, note: 'handoff tab comes to the front' },
  { sound: 'whoosh-short', at: EV.scrollBack + 0.3, note: 'tab scrolls back to the field', gain: -4 },
  ...EV.digits.map((at: number, i: number) => ({ sound: 'tick', at, note: `digit ${i + 1}`, gain: 4 })),
  { sound: 'sparkle', at: EV.got + 0.05, note: 'Got it, carrying on.', gain: -2 },
  { sound: 'tap', at: EV.verifyClick, note: 'agent clicks Verify', gain: -4 },
  { sound: 'whoosh-sub', at: EV.verifyClick + 0.6, note: 'camera pulls back to the chat' },
  { sound: 'text-tap-down2', at: EV.verifiedMsg + 0.1, note: 'chat: verified', gain: -4 },
  { sound: 'whoosh-wipe', at: EV.nextSite + 0.3, note: 'camera to the acme tab', gain: -3 },
  { sound: 'card', at: EV.cornerIn + 0.06, note: 'corner card slides in', gain: -2 },
  { sound: 'tap', at: EV.xClick, note: 'click X', gain: 3 },
  { sound: 'text-tap-up2', at: EV.askMsg + 0.1, note: 'chat: what should I do instead?', gain: -4 },
  { sound: 'whoosh-deep', at: EV.deskOut + 0.4, note: 'desktop slides out' },
  { sound: 'impact', at: EV.logo + 0.04, note: 'mark lands', gain: 5 },
]

const tracks: number[] = [] // end time per track
function place(start: number, length: number) {
  let track = tracks.findIndex((end) => end <= start)
  if (track === -1) track = tracks.push(0) - 1
  tracks[track] = start + length + 0.01
  return 20 + track
}

const voice = Object.entries(START as Record<string, number>).map(([id, start]) => {
  const line = lines[id]
  if (start + line.duration > FILM) throw new Error(`${id} runs past the end of the film`)
  return [
    `      <!-- vo: ${line.text} -->`,
    `      <audio id="vo-${id}" src="assets/vo/${id}.wav" data-start="${start.toFixed(3)}" data-duration="${line.duration.toFixed(3)}" data-track-index="10" data-volume="1"></audio>`,
  ].join('\n')
})

const sfx = CUES.sort((x, y) => x.at - y.at).map((cue, i) => {
  const a = analysis.get(cue.sound)
  if (!a) throw new Error(`no analysis for ${cue.sound}`)
  const start = Math.max(0, cue.fromStart ? cue.at : cue.at - a.hit)
  const length = Math.min(cue.length ?? a.duration, a.duration)
  const volume = Math.min(1, 10 ** ((TARGET[a.character] + (cue.gain ?? 0) - a.lufs) / 20))
  const id = `sfx-${String(i + 1).padStart(2, '0')}`
  return [
    `      <!-- ${cue.note} -->`,
    `      <audio id="${id}" src="assets/sfx/${cue.sound}.mp3" data-start="${start.toFixed(3)}" data-duration="${length.toFixed(3)}" data-track-index="${place(start, length)}" data-volume="${volume.toFixed(3)}"></audio>`,
  ].join('\n')
})

const file = path.join(ROOT, 'index.html')
const html = fs.readFileSync(file, 'utf8')
// scene hosts and the root follow the timeline
const r = (n: number) => n.toFixed(3)
let synced = html.replace(/(id="root"[^>]*data-duration=")[\d.]+/, `$1${r(FILM)}`)
for (const [id, [start, end]] of Object.entries(HOSTS as Record<string, [number, number]>)) {
  synced = synced.replace(new RegExp(`(id="${id}"[^>]*data-start=")[\\d.]+(" data-duration=")[\\d.]+`), `$1${r(start)}$2${r(end - start)}`)
}
const next = synced.replace(/( *)<!-- AUDIO:BEGIN -->[\s\S]*?<!-- AUDIO:END -->/, (_, indent) => `${indent}<!-- AUDIO:BEGIN -->\n${[...voice, ...sfx].join('\n')}\n${indent}<!-- AUDIO:END -->`)
fs.writeFileSync(file, next)
console.log(`[sfx] wrote ${voice.length} voice lines and ${sfx.length} cues on ${tracks.length} tracks`)
