// Renders the film, mixes the music under the voiceover, and masters to -14 LUFS / -1 dBTP.
// The music ducks to MUSIC_UNDER_VOICE while anyone speaks (windows from assets/timeline.js, short gaps
// bridged so it does not pump) and rises to MUSIC_ALONE before the first and after the last line.
// A limiter on the mix leaves headroom, so the final gain stays linear and under -1 dBTP.
// Run: bun scripts/master.ts   → renders/playwriter-handoff.mp4 and renders/playwriter-handoff-web.mp4

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = path.join(import.meta.dirname, '..')
await import(path.join(ROOT, 'assets/vo/lines.js'))
await import(path.join(ROOT, 'assets/timeline.js'))
const { START, FILM, lines } = (globalThis as any).TIMELINE

const MUSIC_LUFS = -12 // measured, assets/music.mp3 (55 s, longer than the film; faded here)
const MUSIC_ALONE = -17 // LUFS when nobody speaks
const MUSIC_UNDER_VOICE = -30 // LUFS under the voice (-16), about 14 dB below it
const BRIDGE_S = 1.6 // gaps between lines shorter than this stay ducked
const DOWN_S = 0.4
const UP_S = 0.7
const FADE_S = 2.5 // music fades out at the end of the film

const run = (args: string[]) => execFileSync(args[0], args.slice(1), { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }).toString()
const log = (step: string) => console.log(`[master] ${step}`)

log('render')
execFileSync('npx', ['-y', 'hyperframes@0.9.40', 'render', '-o', 'renders/draft.mp4', '--quality', 'looks'], { cwd: ROOT, stdio: 'inherit' })

// voice windows, merged across short gaps
const windows: Array<[number, number]> = []
for (const [id, start] of Object.entries(START as Record<string, number>).sort((a, b) => a[1] - b[1])) {
  const end = start + lines[id].duration
  const last = windows.at(-1)
  if (last && start - last[1] < BRIDGE_S) last[1] = end
  else windows.push([start, end])
}
log(`duck windows ${windows.map(([a, b]) => `${a.toFixed(1)}-${b.toFixed(1)}`).join(', ')}`)

// gain(t) = alone * (1 - (1 - under/alone) * duck(t)), duck ramps down before a window and up after it
const alone = 10 ** ((MUSIC_ALONE - MUSIC_LUFS) / 20)
const under = 10 ** ((MUSIC_UNDER_VOICE - MUSIC_LUFS) / 20)
const ramp = ([a, b]: [number, number]) => `min(clip((t-${(a - DOWN_S).toFixed(3)})/${DOWN_S},0,1),clip((${(b + UP_S).toFixed(3)}-t)/${UP_S},0,1))`
const duck = windows.map(ramp).reduce((acc, w) => `max(${acc},${w})`)
const gain = `${alone.toFixed(4)}*(1-${(1 - under / alone).toFixed(4)}*${duck})`

log('mix music under the render')
run([
  'ffmpeg', '-loglevel', 'error', '-y', '-i', 'renders/draft.mp4', '-i', 'assets/music.mp3',
  '-filter_complex', `[1:a]volume='${gain}':eval=frame,afade=t=out:st=${(FILM - FADE_S).toFixed(3)}:d=${FADE_S}[m];[0:a][m]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.5:level=0[a]`,
  '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'pcm_s24le', 'renders/mixed.mov',
])

log('measure loudness')
// loudnorm prints its json on stderr
const json = JSON.parse(
  run(['sh', '-c', `ffmpeg -hide_banner -i renders/mixed.mov -af loudnorm=I=-14:TP=-1:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p'`]),
)
log(`input ${json.input_i} LUFS, ${json.input_tp} dBTP`)

log('master to -14 LUFS / -1 dBTP')
const loudnorm = `loudnorm=I=-14:TP=-1:LRA=11:linear=true:measured_I=${json.input_i}:measured_TP=${json.input_tp}:measured_LRA=${json.input_lra}:measured_thresh=${json.input_thresh}:offset=${json.target_offset}`
run(['ffmpeg', '-loglevel', 'error', '-y', '-i', 'renders/mixed.mov', '-af', loudnorm, '-ar', '48000', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', 'renders/playwriter-handoff.mp4'])

log('web copy')
run(['ffmpeg', '-loglevel', 'error', '-y', '-i', 'renders/playwriter-handoff.mp4', '-c:v', 'libx264', '-crf', '22', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', 'renders/playwriter-handoff-web.mp4'])
fs.rmSync(path.join(ROOT, 'renders/mixed.mov'))
log(`done: renders/playwriter-handoff.mp4, renders/playwriter-handoff-web.mp4 (${(fs.statSync(path.join(ROOT, 'renders/playwriter-handoff-web.mp4')).size / 1e6).toFixed(1)} MB)`)
