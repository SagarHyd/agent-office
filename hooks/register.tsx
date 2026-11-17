import { atom, read, update } from 'claude-code'
import type { ElementConstructor, EngineInterface, Register, SvgProps } from 'claude-code'

import type { BgTask, Clock, Usage, WorkerName, WorkerRun } from '../types'
import {
  registerThemes,
  signalQuestionAnswered,
  signalQuestionOpened,
  signalToolRan,
  signalTurnEnded,
  signalTurnStarted,
  startThemes,
} from './themes'

const PANE = 'agent-office'
const STATUS_FILE = 'out/worker-status.json'
const TICK_MS = 1000

const clock = atom({ plugin: 'agent-office', key: 'clock' } as const, { n: 0, now: 0 } as Clock, { shape: 'clock-1' })
const fileRuns = atom({ plugin: 'agent-office', key: 'fileRuns' } as const, [] as WorkerRun[], { shape: 'runs-3' })
const bgTasks = atom({ plugin: 'agent-office', key: 'bgTasks' } as const, [] as BgTask[], { shape: 'bg-1' })
const liveRuns = atom({ plugin: 'agent-office', key: 'liveRuns' } as const, [] as WorkerRun[], { shape: 'runs-3' })
const claudeActive = atom({ plugin: 'agent-office', key: 'claudeActive' } as const, false, { shape: 'active-1' })
const claudeModel = atom({ plugin: 'agent-office', key: 'claudeModel' } as const, '', { shape: 'model-1' })
const usage = atom({ plugin: 'agent-office', key: 'usage' } as const, { fiveHour: null, weekly: null } as Usage, {
  shape: 'usage-1',
})

const LOOK: Record<'claude' | WorkerName, { color: string; label: string }> = {
  claude: { color: '#e08a68', label: 'Claude' },
  codex: { color: '#5fc9ae', label: 'Codex' },
  agy: { color: '#8fb0ff', label: 'Antigravity' },
}
const OK = '#4ade80'
const BAD = '#f87171'
const INK = '#1d1d26'

// ---------- state ----------
type WorkerState = 'idle' | 'sleep' | 'running' | 'done' | 'failed'
type Mood = WorkerState | 'busy' | 'calm'
type WorkerView = { run: WorkerRun | null; state: WorkerState }

function viewOf(run: WorkerRun | null, now: number): WorkerView {
  if (!run) return { run, state: 'sleep' }
  if (run.status === 'running') return { run, state: 'running' }
  const since = now - (run.end ?? run.start)
  if (since < 10000) return { run, state: run.status === 'failed' ? 'failed' : 'done' }
  return { run, state: since > 120000 ? 'sleep' : 'idle' }
}

// ---------- vector scene ----------
// Every motion is CSS animation inside the SVG, so the surface plays it
// smoothly; the markup changes only when someone's state changes.
const POS = { claude: 10, codex: 118, agy: 224 } as const
const HAND = { x: 68, y: 30 } // where Claude's notes leave from

const CONFETTI = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
  .map(i => {
    const a = (i / 10) * Math.PI * 2
    const dx = Math.round(Math.cos(a) * 30)
    const dy = Math.round(Math.sin(a) * 26 - 6)
    return `@keyframes cf${i}{0%{transform:translate(0,0) rotate(0);opacity:1}100%{transform:translate(${dx}px,${dy}px) rotate(${i % 2 ? 300 : -300}deg);opacity:0}}`
  })
  .join('')

const CSS = `
.c{transform-box:fill-box;transform-origin:center}
@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
@keyframes breathe{0%,100%{transform:scale(1,1)}50%{transform:scale(1.04,.96)}}
@keyframes blink{0%,91%,100%{transform:scaleY(1)}94%{transform:scaleY(.1)}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes tap{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
@keyframes scroll{from{transform:translateY(0)}to{transform:translateY(-24px)}}
@keyframes rise{0%{transform:translate(0,0);opacity:0}20%{opacity:1}100%{transform:translate(4px,-24px);opacity:0}}
@keyframes flip{0%,25%{transform:scaleX(1)}65%,100%{transform:scaleX(-1)}}
@keyframes jump{0%,100%{transform:translateY(0)}35%{transform:translateY(-12px)}55%{transform:translateY(0)}}
@keyframes pop{0%{transform:scale(0)}70%{transform:scale(1.25)}100%{transform:scale(1)}}
@keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-3px)}40%,80%{transform:translateX(3px)}}
@keyframes wave{0%,100%{transform:rotate(0)}50%{transform:rotate(-28deg)}}
@keyframes clawdup{0%,100%{transform:translateY(0)}50%{transform:translateY(-.7px)}}
@keyframes cursor{0%,49%{opacity:1}50%,100%{opacity:0}}
@keyframes pulse{0%{transform:scale(.75);opacity:.55}100%{transform:scale(1.25);opacity:0}}
@keyframes glow{0%,100%{opacity:.35}50%{opacity:.6}}
@keyframes drop{0%{transform:translate(0,0);opacity:0}15%{opacity:1}100%{transform:translate(-3px,14px);opacity:0}}
@keyframes rain{0%{transform:translateY(0);opacity:0}20%{opacity:1}100%{transform:translateY(12px);opacity:0}}
@keyframes look{0%,40%,100%{transform:translateX(0)}50%,65%{transform:translateX(-2px)}75%,90%{transform:translateX(2px)}}
@keyframes sway{0%,100%{transform:rotate(-2deg)}50%{transform:rotate(2deg)}}
@keyframes sip{0%,60%,100%{transform:translate(0,0) rotate(0)}70%,85%{transform:translate(-6px,-10px) rotate(-25deg)}}
@keyframes dots{0%,100%{opacity:.25}50%{opacity:1}}
@keyframes armsup{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
${CONFETTI}
@keyframes shadow{0%,100%{transform:scale(1)}35%{transform:scale(.6)}55%{transform:scale(1)}}
`

const shadowEl = (state: Mood) =>
  `<ellipse class="c" cx="30" cy="82" rx="18" ry="3" fill="#000" opacity=".25" style="${state === 'done' ? 'animation:shadow .7s ease-in-out infinite' : ''}"/>`

const motion = (state: Mood, delay: number) =>
  state === 'done'
    ? 'animation:jump .7s ease-in-out infinite'
    : state === 'failed'
      ? 'animation:shake .7s ease-in-out infinite'
      : state === 'sleep'
        ? `animation:breathe 3.6s ease-in-out ${delay}s infinite`
        : state === 'running' || state === 'busy'
          ? `animation:jump .45s ease-in-out ${delay}s infinite`
          : `animation:sway 3.2s ease-in-out ${delay}s infinite`

function eyes(lx: number, rx: number, y: number, state: Mood, delay: number) {
  if (state === 'sleep')
    return `<path d="M${lx - 3} ${y} q3 3 6 0 M${rx - 3} ${y} q3 3 6 0" stroke="${INK}" stroke-width="2" fill="none" stroke-linecap="round"/>`
  if (state === 'failed')
    return `<path d="M${lx - 3} ${y - 3} l6 6 m0 -6 l-6 6 M${rx - 3} ${y - 3} l6 6 m0 -6 l-6 6" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>`
  if (state === 'done')
    return `<path d="M${lx - 3} ${y + 1} q3 -4 6 0 M${rx - 3} ${y + 1} q3 -4 6 0" stroke="${INK}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`
  const glance = state === 'idle' || state === 'calm' ? `animation:look 5s ease-in-out ${delay}s infinite` : ''
  return `<g style="${glance}"><g class="c" style="animation:blink 4.2s ${delay}s infinite"><ellipse cx="${lx}" cy="${y}" rx="2.8" ry="3.8" fill="${INK}"/><ellipse cx="${rx}" cy="${y}" rx="2.8" ry="3.8" fill="${INK}"/><circle cx="${lx + 1}" cy="${y - 1.4}" r="1" fill="#fff"/><circle cx="${rx + 1}" cy="${y - 1.4}" r="1" fill="#fff"/></g></g>`
}

const mouth = (cx: number, y: number, state: Mood) =>
  state === 'failed'
    ? `<path d="M${cx - 4} ${y + 2} q4 -4 8 0" stroke="${INK}" stroke-width="2" fill="none" stroke-linecap="round"/>`
    : state === 'sleep'
      ? `<ellipse cx="${cx}" cy="${y + 1}" rx="1.8" ry="1.4" fill="${INK}" opacity=".7"/>`
      : state === 'done'
        ? `<path d="M${cx - 5} ${y - 1} q5 7 10 0 z" fill="${INK}"/>`
        : `<path d="M${cx - 4} ${y} q4 4 8 0" stroke="${INK}" stroke-width="2" fill="none" stroke-linecap="round"/>`

const cheeks = (lx: number, rx: number, y: number) =>
  `<circle cx="${lx}" cy="${y}" r="3.4" fill="#ff8fa3" opacity=".45"/><circle cx="${rx}" cy="${y}" r="3.4" fill="#ff8fa3" opacity=".45"/>`

function badge(state: WorkerState) {
  if (state === 'done')
    return `<g transform="translate(54,14)"><g class="c" style="animation:pop .45s ease-out both"><circle r="8" fill="#22c55e"/><path d="M-4 0 l3 3 l5 -6" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g></g>`
  if (state === 'failed')
    return `<g transform="translate(54,14)"><g class="c" style="animation:pop .45s ease-out both"><circle r="8" fill="#ef4444"/><path d="M-3.5 -3.5 l7 7 m0 -7 l-7 7" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></g></g>`
  if (state === 'sleep')
    return [0, 1.2, 2.4]
      .map(
        (d, i) =>
          `<text x="${50 + i * 4}" y="${26 - i * 3}" font-family="sans-serif" font-weight="700" font-size="${11 + i * 3}" fill="#c7d2fe" style="animation:rise 3.6s ease-out ${d}s infinite;opacity:0">z</text>`,
      )
      .join('')
  return ''
}

const stateFilter = (state: WorkerState) =>
  state === 'sleep' ? ' filter="url(#fSleep)" opacity=".7"' : state === 'failed' ? ' filter="url(#fFail)"' : ''

const tilt = (state: WorkerState) => (state === 'sleep' ? 'translate(2,5) rotate(-14 30 70)' : '')

// Behind the character: a glow that says the state from across the room.
function under(state: WorkerState, color: string) {
  if (state === 'running')
    return `<circle class="c" cx="30" cy="46" r="30" fill="${color}" style="animation:pulse 1.1s ease-out infinite"/><circle cx="30" cy="46" r="26" fill="${color}" style="animation:glow 1.1s ease-in-out infinite"/>`
  if (state === 'done')
    return `<circle class="c" cx="30" cy="44" r="30" fill="#22c55e" style="animation:pulse .9s ease-out infinite"/>`
  if (state === 'failed')
    return `<circle cx="30" cy="46" r="28" fill="#ef4444" style="animation:glow 1.6s ease-in-out infinite"/>`
  return ''
}

// On the head, moving with it.
function onHead(state: WorkerState) {
  if (state === 'running')
    return `<g class="c" style="animation:spin .8s linear infinite"><circle cx="30" cy="9" r="6" fill="none" stroke="#ffd27a" stroke-width="2.6" stroke-dasharray="10 4.5" stroke-linecap="round"/></g><path d="M11 28 q-2 4 0 6 q2 -2 0 -6z" fill="#7dd3fc" style="animation:drop .9s ease-in infinite"/>`
  if (state === 'sleep')
    return `<path d="M12 30 Q24 2 54 16 Q44 22 48 30 Z" fill="#6366f1"/><rect x="11" y="27" width="38" height="5" rx="2.5" fill="#e0e7ff"/><circle cx="54" cy="16" r="3.6" fill="#e0e7ff"/>`
  return ''
}

// In front of everything.
function overFx(state: WorkerState, mugX: number, mugY: number) {
  if (state === 'done') {
    const colors = ['#f87171', '#fbbf24', '#4ade80', '#60a5fa', '#c084fc']
    const bits = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
      .map(
        i =>
          `<rect class="c" x="28" y="10" width="4" height="${i % 2 ? 4 : 2.4}" rx=".8" fill="${colors[i % 5]}" style="animation:cf${i} 1.1s ease-out infinite"/>`,
      )
      .join('')
    const arms = `<g style="animation:armsup .35s ease-in-out infinite"><circle cx="4" cy="34" r="4.5" fill="#fff" fill-opacity=".85"/><circle cx="56" cy="34" r="4.5" fill="#fff" fill-opacity=".85"/></g>`
    return bits + arms
  }
  if (state === 'failed') {
    const drops = [0, 1, 2]
      .map(
        i =>
          `<path d="M${22 + i * 8} 14 l-1.5 4" stroke="#7dd3fc" stroke-width="1.6" stroke-linecap="round" style="animation:rain .8s linear ${i * 0.27}s infinite"/>`,
      )
      .join('')
    return `<g><circle cx="22" cy="8" r="6" fill="#64748b"/><circle cx="31" cy="5" r="7.5" fill="#64748b"/><circle cx="40" cy="8" r="6" fill="#64748b"/><rect x="16" y="8" width="30" height="6" rx="3" fill="#64748b"/>${drops}</g>`
  }
  if (state === 'idle') return mug(mugX, mugY)
  return ''
}

function mug(x: number, y: number) {
  const steam = [0, 1]
    .map(
      i =>
        `<path d="M${x + 2 + i * 4} ${y - 2} q-2 -3 0 -6 q2 -3 0 -6" stroke="#cbd5e1" stroke-width="1.3" fill="none" stroke-linecap="round" style="animation:rise 2.4s ease-out ${i * 1.2}s infinite;opacity:0"/>`,
    )
    .join('')
  return `<rect x="${x}" y="${y}" width="9" height="10" rx="2" fill="#f8fafc"/><path d="M${x + 9} ${y + 2.5} q4 0 4 3 q0 3 -4 3" stroke="#f8fafc" stroke-width="1.6" fill="none"/><rect x="${x + 1.5}" y="${y + 1.5}" width="6" height="2" rx="1" fill="#92400e"/>${steam}`
}

function speech() {
  const dots = [0, 1, 2]
    .map(i => `<circle cx="${7 + i * 6}" cy="7" r="2" fill="${INK}" style="animation:dots 1s ease-in-out ${i * 0.2}s infinite"/>`)
    .join('')
  return `<g transform="translate(46,2)"><path d="M0 4 q0 -4 4 -4 h18 q4 0 4 4 v6 q0 4 -4 4 h-12 l-5 5 v-5 h-1 q-4 0 -4 -4 z" fill="#fff"/>${dots}</g>`
}

// Claude's mood follows the workers: working beats failed beats done beats idle; asleep only when both are.
type ClaudeMood = 'busy' | 'failed' | 'done' | 'thinking' | 'idle' | 'sleep'

// A worker running beats a fresh failure beats a fresh success beats Claude's own work.
function claudeMood(views: Record<WorkerName, WorkerView>, active = false): ClaudeMood {
  const s = [views.codex.state, views.agy.state]
  if (s.includes('running')) return 'busy'
  if (s.includes('failed')) return 'failed'
  if (s.includes('done')) return 'done'
  if (active) return 'thinking'
  return s.every(x => x === 'sleep') ? 'sleep' : 'idle'
}

const CLAUDE_LABEL: Record<ClaudeMood, string> = {
  busy: 'orchestrating',
  failed: 'worried',
  done: 'cheering',
  thinking: 'thinking',
  idle: 'sipping tea',
  sleep: 'dozing',
}

function confetti(y: number) {
  const colors = ['#f87171', '#fbbf24', '#4ade80', '#60a5fa', '#c084fc']
  return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
    .map(
      i =>
        `<rect class="c" x="28" y="${y}" width="4" height="${i % 2 ? 4 : 2.4}" rx=".8" fill="${colors[i % 5]}" style="animation:cf${i} 1.1s ease-out infinite"/>`,
    )
    .join('')
}

function bubble(fill: string, inner: string) {
  return `<g transform="translate(46,2)"><path d="M0 4 q0 -4 4 -4 h18 q4 0 4 4 v6 q0 4 -4 4 h-12 l-5 5 v-5 h-1 q-4 0 -4 -4 z" fill="${fill}"/>${inner}</g>`
}

// A thought cloud with a ring turning inside: Claude working on its own.
function thought() {
  return `<circle cx="51" cy="29" r="2" fill="#fff"/><circle cx="56" cy="23" r="3" fill="#fff"/><g transform="translate(58,1)"><g style="animation:bob 2.4s ease-in-out infinite"><ellipse cx="7" cy="11" rx="7" ry="6" fill="#fff"/><ellipse cx="16" cy="8" rx="9" ry="7.5" fill="#fff"/><ellipse cx="25" cy="11" rx="7" ry="6" fill="#fff"/><rect x="5" y="9" width="22" height="8" rx="4" fill="#fff"/><g class="c" style="animation:spin 1.1s linear infinite"><circle cx="16" cy="11" r="4.2" fill="none" stroke="#e08a68" stroke-width="2" stroke-dasharray="7 3.2" stroke-linecap="round"/></g></g></g>`
}

// Claude is drawn as Clawd, exactly as the official startup glyph
//    ▐▛███▜▌
//   ▝▜█████▛▘
//     ▘▘ ▝▝
// Each block character is 2x2 pixels, and a terminal pixel is twice as tall as
// it is wide, so the grid is 16 wide by 5 tall with tall pixels:
//   row 0  body                 (cols 2-13)
//   row 1  body, eye slots      (holes at cols 4 and 11)
//   row 2  body and stub arms   (cols 0-15)
//   row 3  body                 (cols 2-13)
//   row 4  four legs            (cols 3, 5, 10, 12)
// One grid pixel is PW x PH scene units; (GX, GY) is the grid's corner.
const CLAWD = '#d97757'
const CLAWD_EYE = '#1b0f0a'
const PW = 4
const PH = 7.5
const GX = 6
const GY = 44.5
const EYES = [4, 11]

function clawdEyes(mood: ClaudeMood) {
  const line = `stroke="${CLAWD_EYE}" stroke-width="2.2" vector-effect="non-scaling-stroke" fill="none" stroke-linecap="round" stroke-linejoin="round"`
  if (mood === 'sleep') return EYES.map(x => `<path d="M${x - 0.2} 1.6 h1.4" ${line}/>`).join('')
  if (mood === 'done') return EYES.map(x => `<path d="M${x - 0.2} 1.8 L${x + 0.5} 1.15 L${x + 1.2} 1.8" ${line}/>`).join('')
  if (mood === 'failed') return EYES.map(x => `<path d="M${x - 0.1} 1.05 l1.2 .9 m0 -.9 l-1.2 .9" ${line}/>`).join('')
  const look = mood === 'busy' ? 'transform:translate(.35px,0);' : mood === 'thinking' ? 'transform:translate(.3px,-.25px);' : ''
  const glance = mood === 'idle' ? 'animation:look 5s ease-in-out .3s infinite;' : ''
  // The slots are cut out of the body, as in the glyph: drawn in the eye colour.
  return `<g style="${glance}${look}"><g class="c" style="animation:blink 4.2s .3s infinite">${EYES.map(
    x => `<rect x="${x}" y="1" width="1" height="1" fill="${CLAWD_EYE}"/>`,
  ).join('')}</g></g>`
}

function clawdArm(side: 'left' | 'right', mood: ClaudeMood) {
  const x = side === 'left' ? 0 : 14
  const lift =
    mood === 'done'
      ? `animation:clawdup .35s ease-in-out ${side === 'left' ? 0 : 0.17}s infinite`
      : mood === 'busy' && side === 'right'
        ? 'animation:clawdup .5s ease-in-out infinite'
        : (mood === 'thinking' && side === 'right') || mood === 'failed'
          ? 'transform:translateY(-.7px)'
          : ''
  return `<g style="${lift}"><rect x="${x}" y="2" width="2" height="1" fill="${CLAWD}"/></g>`
}

function claudeSvg(mood: ClaudeMood) {
  const st: Mood = mood === 'busy' ? 'busy' : mood === 'idle' || mood === 'thinking' ? 'calm' : mood
  const centre = GX + 8 * PW
  const body = `<g transform="translate(${GX},${GY}) scale(${PW},${PH})" shape-rendering="crispEdges">
  <rect x="2" y="0" width="12" height="4" fill="${CLAWD}"/>
  ${clawdArm('left', mood)}${clawdArm('right', mood)}
  ${[3, 5, 10, 12].map(x => `<rect x="${x}" y="4" width="1" height="1" fill="${CLAWD}"/>`).join('')}
  ${clawdEyes(mood)}
</g>`
  // The effects were drawn for a taller character; shift them onto Clawd.
  const near = (dx: number, dy: number, inner: string) => `<g transform="translate(${dx},${dy})">${inner}</g>`
  const extra =
    mood === 'busy'
      ? near(6, 20, speech())
      : mood === 'failed'
        ? near(
            6,
            20,
            `${bubble('#ef4444', '<text x="13" y="11" text-anchor="middle" font-family="sans-serif" font-weight="800" font-size="10" fill="#fff">!?</text>')}<path d="M51 32 q-2 4 0 6 q2 -2 0 -6z" fill="#7dd3fc" style="animation:drop 1.1s ease-in infinite"/>`,
          )
        : mood === 'done'
          ? near(10, 22, confetti(4))
          : mood === 'thinking'
            ? near(-4, 20, thought())
            : mood === 'idle'
              ? `<g class="c" style="animation:sip 4s ease-in-out infinite">${mug(72, 58)}</g>`
              : near(14, 20, badge('sleep'))
  const backdrop =
    mood === 'done' ? near(8, 18, under('done', '')) : mood === 'failed' ? near(8, 18, under('failed', '')) : ''
  const filter = mood === 'sleep' ? stateFilter('sleep') : ''
  const cap = mood === 'sleep' ? near(4, 16, onHead('sleep')) : ''
  return `<g transform="translate(${POS.claude},0)"${filter}>
<ellipse class="c" cx="${centre}" cy="83" rx="28" ry="3" fill="#000" opacity=".25" style="${mood === 'done' ? 'animation:shadow .7s ease-in-out infinite' : ''}"/>${backdrop}
<g transform="${mood === 'sleep' ? 'translate(2,3) rotate(-10 38 82)' : ''}"><g class="c" style="${motion(st, 0)}">
${body}${cap}
</g></g>
${extra}</g>`
}

function codexSvg(state: WorkerState) {
  const working = state === 'running'
  const lines = [0, 1, 2, 3, 4, 5, 6, 7]
    .map(i => {
      const w = [26, 18, 32, 14][i % 4]!
      const x = [9, 13, 13, 9][i % 4]!
      const c = i % 4 === 2 ? '#7ad7ff' : '#5af78e'
      return `<rect x="${x}" y="${57 + i * 6}" width="${w}" height="2.6" rx="1.3" fill="${c}"/>`
    })
    .join('')
  const screen = working
    ? `<g clip-path="url(#scr)"><g style="animation:scroll 2.2s linear infinite">${lines}</g></g>`
    : `<rect x="9" y="58" width="22" height="2.6" rx="1.3" fill="#3b5266"/><rect x="9" y="64" width="14" height="2.6" rx="1.3" fill="#3b5266"/><rect x="9" y="70" width="5" height="2.6" fill="#5af78e" style="animation:cursor 1s step-end infinite"/>`
  const hands = working
    ? `<circle cx="18" cy="76" r="4.5" fill="#3fae93" style="animation:tap .32s ease-in-out infinite"/><circle cx="42" cy="76" r="4.5" fill="#3fae93" style="animation:tap .32s ease-in-out .16s infinite"/>`
    : `<circle cx="16" cy="77" r="4.5" fill="#3fae93"/><circle cx="44" cy="77" r="4.5" fill="#3fae93"/>`
  const symbols = working
    ? `<text x="54" y="34" font-family="monospace" font-weight="700" font-size="10" fill="#5af78e" style="animation:rise 1.8s ease-out infinite;opacity:0">{ }</text><text x="50" y="40" font-family="monospace" font-weight="700" font-size="9" fill="#7ad7ff" style="animation:rise 1.8s ease-out .9s infinite;opacity:0">&lt;/&gt;</text>`
    : ''
  return `<g transform="translate(${POS.codex},0)"${stateFilter(state)}>${shadowEl(state)}${under(state, LOOK.codex.color)}
<g transform="${tilt(state)}"><g class="c" style="${motion(state, 0.6)}">
  <rect x="10" y="22" width="40" height="44" rx="15" fill="url(#gX)"/>
  <path d="M13 34 Q30 8 47 34" stroke="#22303a" stroke-width="3.5" fill="none" stroke-linecap="round"/>
  <rect x="7" y="30" width="8" height="12" rx="4" fill="#22303a"/><rect x="45" y="30" width="8" height="12" rx="4" fill="#22303a"/>
  <path d="M49 41 Q48 49 40 50" stroke="#22303a" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="39" cy="50" r="2.2" fill="#22303a"/>
  ${eyes(24, 36, 40, state, 1.7)}
  ${mouth(30, 47, state)}
  ${onHead(state)}
</g></g>
<rect x="4" y="53" width="52" height="24" rx="4" fill="#1b2430"/>
${screen}
<rect x="0" y="77" width="60" height="4.5" rx="2.2" fill="#a3adb8"/>
${hands}${symbols}${overFx(state, 58, 66)}${badge(state)}</g>`
}

function agySvg(state: WorkerState) {
  const working = state === 'running'
  const flip = working
    ? `<path class="c" d="M30 64 Q41 58 52 62 L52 75 Q41 71 30 77 Z" fill="#fffdf6" stroke="#d6cfbf" stroke-width=".6" style="transform-origin:left center;animation:flip 1.5s ease-in-out infinite"/>`
    : ''
  const sparks = working
    ? `<text x="54" y="40" font-family="sans-serif" font-size="11" fill="#ffd27a" style="animation:rise 2s ease-out infinite;opacity:0">✦</text><text x="4" y="40" font-family="sans-serif" font-size="9" fill="#c7d2fe" style="animation:rise 2s ease-out 1s infinite;opacity:0">✦</text>`
    : ''
  return `<g transform="translate(${POS.agy},0)"${stateFilter(state)}>${shadowEl(state)}${under(state, LOOK.agy.color)}
<g transform="${tilt(state)}"><g class="c" style="${motion(state, 1.1)}">
  <path d="M22 26 Q26 16 31 24 Q35 15 39 25" fill="#6a8fe8"/>
  <circle cx="30" cy="47" r="23" fill="url(#gA)"/>
  ${eyes(23, 37, 44, state, 2.6)}
  <circle cx="23" cy="44" r="6.3" fill="#fff" fill-opacity=".16" stroke="#eef2ff" stroke-width="1.8"/>
  <circle cx="37" cy="44" r="6.3" fill="#fff" fill-opacity=".16" stroke="#eef2ff" stroke-width="1.8"/>
  <path d="M29.3 44 L30.7 44" stroke="#eef2ff" stroke-width="1.8"/>
  ${mouth(30, 54, state)}
  ${onHead(state)}
</g></g>
<path d="M6 63 Q18 57 30 63 Q42 57 54 63 L54 79 Q42 74 30 80 Q18 74 6 79 Z" fill="#c2410c"/>
<path d="M8 62 Q19 58 30 64 L30 77 Q19 71 8 75 Z" fill="#f4f1e8"/>
<path d="M30 64 Q41 58 52 62 L52 75 Q41 71 30 77 Z" fill="#f4f1e8"/>
<path d="M12 65 l13 2 M12 69 l13 2 M35 67 l13 -2 M35 71 l13 -2" stroke="#c9c1b1" stroke-width="1"/>
${flip}
<circle cx="8" cy="72" r="4.5" fill="#6a8fe8"/><circle cx="52" cy="72" r="4.5" fill="#6a8fe8"/>
${sparks}${overFx(state, 58, 62)}${badge(state)}</g>`
}

// A note flies from Claude to a worker when its run starts; the file flies
// back when it ends. Each plays once, because the markup stays the same until
// the state changes again.
function flights(views: Record<WorkerName, WorkerView>) {
  const css: string[] = []
  const els: string[] = []
  for (const w of ['codex', 'agy'] as const) {
    const s = views[w].state
    const dx = POS[w] + 4 - HAND.x
    const name = `fly-${w}`
    if (s === 'running') {
      css.push(
        `@keyframes ${name}{0%{transform:translate(0,0) rotate(0);opacity:0}10%{opacity:1}50%{transform:translate(${dx / 2}px,-22px) rotate(180deg)}85%{opacity:1}100%{transform:translate(${dx}px,6px) rotate(360deg);opacity:0}}`,
      )
    } else if (s === 'done' || s === 'failed') {
      css.push(
        `@keyframes ${name}{0%{transform:translate(${dx}px,6px);opacity:0}10%{opacity:1}50%{transform:translate(${dx / 2}px,-22px)}85%{opacity:1}100%{transform:translate(0,0);opacity:0}}`,
      )
    } else continue
    const tint = s === 'failed' ? BAD : s === 'done' ? OK : '#94a3b8'
    els.push(
      `<g transform="translate(${HAND.x},${HAND.y})"><g class="c" style="animation:${name} 1.6s ease-in-out both"><rect width="11" height="13" rx="1.5" fill="#fff"/><path d="M2.5 4 h6 M2.5 7 h6 M2.5 10 h4" stroke="${tint}" stroke-width="1.2"/></g></g>`,
    )
  }
  return { css: css.join(''), els: els.join('') }
}

// A crop shows one character's slice of the scene (same drawing, narrower viewBox).
const CROP = { claude: { x: 0, w: 100 }, codex: { x: 108, w: 92 }, agy: { x: 214, w: 86 } } as const

function sceneSvg(views: Record<WorkerName, WorkerView>, scale: number, crop = { x: 0, w: 300 }, active = false): string {
  const f = flights(views)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${crop.x} 0 ${crop.w} 88" width="${crop.w * scale}" height="${88 * scale}">
<defs>
<linearGradient id="gC" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3a585"/><stop offset="1" stop-color="#cf6d4c"/></linearGradient>
<linearGradient id="gX" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8ee6cd"/><stop offset="1" stop-color="#2f9e83"/></linearGradient>
<linearGradient id="gA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b4cbff"/><stop offset="1" stop-color="#5b7fe0"/></linearGradient>
<filter id="fSleep"><feColorMatrix type="saturate" values="0.12"/></filter>
<filter id="fFail"><feColorMatrix type="matrix" values="0.8 0.35 0.15 0 0.12  0.15 0.45 0.1 0 0  0.15 0.15 0.45 0 0  0 0 0 1 0"/></filter>
<clipPath id="scr"><rect x="7" y="56" width="46" height="18" rx="2"/></clipPath>
</defs>
<style>${CSS}${f.css}</style>
${claudeSvg(claudeMood(views, active))}${codexSvg(views.codex.state)}${agySvg(views.agy.state)}${f.els}
</svg>`
}

// ---------- data ----------
// The first file path under out\ a task mentions: what that run was asked to write.
function outputOf(text: string): string | null {
  return /\bout[\\/][\w.\-\\/]+\.[A-Za-z0-9]+/.exec(text)?.[0] ?? null
}

// The prompt a direct worker command carried, without the command around it.
function taskOf(command: string): string | null {
  const quoted = /(?:-p|--print|--prompt|exec[^"']*)\s+(["'])([\s\S]*?)\1/.exec(command)?.[2]
  return quoted ? quoted.slice(0, 400) : null
}

// One line of plain words: the task's first sentence, its "Save it to ..." tail dropped.
function summarize(task: string, max: number): string {
  const first = task.split(/(?<=[.!?])\s+/)[0] ?? task
  const s = first.replace(/\s*(and )?save (it|them) to\s+\S+.*$/i, '').trim()
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

// Every run newest first, a live run dropped when the status file has its twin.
function allRuns(file: WorkerRun[], live: WorkerRun[]): WorkerRun[] {
  const lone = live.filter(l => !file.some(f => f.worker === l.worker && Math.abs(f.start - l.start) < 5000))
  return [...file, ...lone].sort((a, b) => b.start - a.start)
}

function latest(worker: WorkerName, file: WorkerRun[], live: WorkerRun[]): WorkerRun | null {
  const all = [...file, ...live].filter(r => r.worker === worker).sort((a, b) => b.start - a.start)
  const top = all[0]
  if (!top) return null
  if (live.includes(top)) {
    const twin = file.find(f => f.worker === worker && Math.abs(f.start - top.start) < 5000)
    if (twin) return twin
  }
  return top
}

function parseStatus(text: string): WorkerRun[] {
  const data = JSON.parse(text.replace(/^﻿/, ''))
  const runs: unknown[] = Array.isArray(data?.runs) ? data.runs : data?.runs ? [data.runs] : []
  const out: WorkerRun[] = []
  for (const raw of runs) {
    const r = raw as Record<string, unknown>
    const worker = String(r.worker ?? '').toLowerCase()
    if (worker !== 'codex' && worker !== 'agy') continue
    const start = Date.parse(String(r.start ?? ''))
    if (Number.isNaN(start)) continue
    const end = r.end ? Date.parse(String(r.end)) : NaN
    const status = r.status === 'running' || r.status === 'failed' ? r.status : 'done'
    out.push({
      id: String(r.id ?? start),
      worker,
      model: r.model ? String(r.model) : null,
      status,
      start,
      end: Number.isNaN(end) ? null : end,
      tokens: typeof r.tokens === 'number' ? r.tokens : null,
      task: typeof r.task === 'string' ? r.task : null,
      output: typeof r.task === 'string' ? outputOf(r.task) : null,
      outFile: null,
    })
  }
  return out
}

const fmtTime = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
const fmtAgo = (ms: number) => {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}
const pct = (p: number | null) => (p === null ? '–' : `${Math.round(p)}%`)

const WORKER_CMD: Record<WorkerName, RegExp> = {
  codex: /\bcodex(\.exe)?\s+(exec|e)\b/i,
  agy: /\bagy(\.exe)?\s+(-p|--print|--prompt)\b/i,
}

async function sceneNow($: EngineInterface) {
  const { n, now } = await read($, clock)
  const file = await read($, fileRuns)
  const live = await read($, liveRuns)
  const u = await read($, usage)
  const active = await read($, claudeActive)
  const views = {
    codex: viewOf(latest('codex', file, live), now),
    agy: viewOf(latest('agy', file, live), now),
  }
  return { n, now, u, views, active, runs: allRuns(file, live) }
}

// "claude-opus-5-5[1m]" -> "Opus 5.5"; anything else passes through.
function prettyModel(id: string): string {
  const m = /claude-([a-z]+)-(\d+)-(\d+)/i.exec(id)
  if (!m) return id
  const [, family = '', major, minor] = m
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}.${minor}`
}

function workerModel(v: WorkerView): string {
  if (!v.run) return ''
  const m = v.run.model
  return m === 'default' ? 'default model' : m ? m : v.state === 'running' ? 'model…' : ''
}

const fmtTokens = (t: number) => (t >= 1000 ? `${(t / 1000).toFixed(1)}k tok` : `${t} tok`)

// Line two: a live timer while working; afterwards how long it took and its tokens.
function activity(v: WorkerView, now: number): { text: string; color: string | undefined } {
  const r = v.run
  if (!r) return { text: 'no runs yet', color: undefined }
  if (v.state === 'running') return { text: `● working ${fmtTime(now - r.start)}`, color: OK }
  const took = `${Math.max(1, Math.round(((r.end ?? r.start) - r.start) / 1000))}s`
  const tokens = r.tokens !== null ? ` · ${fmtTokens(r.tokens)}` : ''
  const mark = r.status === 'failed' ? '✗ failed' : '✓'
  return {
    text: `${mark} ${took}${tokens}`,
    color: v.state === 'failed' ? BAD : v.state === 'done' ? OK : undefined,
  }
}

const stateColor = (v: WorkerView) =>
  v.state === 'running' || v.state === 'done' ? OK : v.state === 'failed' ? BAD : undefined

// ---------- module ----------
export const register: Register = on => {
  let ticking = false

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'office', description: 'Open the animated agent office pane' })
    await startThemes($)

    if (!ticking) {
      ticking = true
      let n = 0
      $.clock.every(TICK_MS, async () => {
        n++
        const now = await $.clock.now()
        await update($, clock, () => ({ n, now }))
        try {
          if (await $.fs.exists(STATUS_FILE)) {
            const runs = parseStatus(String(await $.fs.read(STATUS_FILE)))
            await update($, fileRuns, () => runs)
          }
        } catch {
          // a half-written or missing file: keep the last good reading
        }
        if (n % 30 === 1) {
          try {
            const { rateLimits } = await $.session.usage()
            const pick = (re: RegExp) => rateLimits.find(r => re.test(r.kind))?.percentUsed ?? null
            await update($, usage, () => ({ fiveHour: pick(/five|5h|hour/i), weekly: pick(/seven|week|7d/i) }))
          } catch {
            // usage unavailable here
          }
        }
        if (n % 2 === 0) {
          try {
            await pollBackground($)
          } catch {
            // best effort
          }
        }
        if (n % 5 === 1) {
          try {
            const m = await $.session.model()
            await update($, claudeModel, prev => (prev === m ? prev : m))
          } catch {
            // model unavailable here
          }
        }
      })
    }
    return next(e)
  })

  on('command.run', { command: 'office' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Agent office' })
    return { text: 'Agent office opened.' }
  })

  on('turn.start', async ($, e, next) => {
    if ((e as { agentId?: string }).agentId === undefined) {
      await update($, claudeActive, () => true)
      await signalTurnStarted($)
    }
    return next(e)
  })
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if ((e as { agentId?: string }).agentId === undefined) {
      await update($, claudeActive, () => false)
      await signalTurnEnded($)
    }
    return done
  })

  // /theme: switch theme mods mid-session (hooks/themes.tsx).
  registerThemes(on)

  renderPane(on)
  renderBand(on)

  const shellInput = (e: unknown) => {
    const x = e as { command?: string; description?: string; run_in_background?: boolean }
    return { command: String(x.command ?? ''), label: String(x.description ?? ''), background: Boolean(x.run_in_background) }
  }
  on('tool.call', { tool: 'PowerShell' }, ($, e, next) => watch($, shellInput(e), () => next(e))).catch(($, e, next) =>
    next(e),
  )
  on('tool.call', { tool: 'Bash' }, ($, e, next) => watch($, shellInput(e), () => next(e))).catch(($, e, next) => next(e))

  // A stopped background task never writes its exit line: mark it here.
  on('tool.call', async ($, e, next) => {
    // The theme scene's signal: a question to you lights it; any other tool of
    // Claude's own finishing means it is working again.
    const counts = e.agentId === undefined && next.origin.plugin === 'engine'
    const question = counts && e.tool === 'AskUserQuestion'
    if (question) await signalQuestionOpened($)
    if (e.tool !== 'TaskStop') {
      const result = await next(e)
      if (counts) await (question ? signalQuestionAnswered($) : signalToolRan($))
      return result
    }
    const ran = await next(e)
    if (counts) await signalToolRan($)
    const x = e as unknown as { task_id?: string; shell_id?: string }
    const id = x.task_id ?? x.shell_id
    if (id && !ran.isError) {
      const now = await $.clock.now()
      await update($, bgTasks, list => list.map(t => (t.id === id && t.end === null ? { ...t, end: now, exit: -1 } : t)))
    }
    return ran
  }).catch(($, e, next) => next(e))
}

// A worker started straight into the background (no wrapper, any project):
// a live run whose output file says the model, the tokens and how it ended.
async function trackWorkerBackground(
  $: EngineInterface,
  ran: { text?: string; result?: unknown },
  worker: WorkerName,
  label: string,
  command: string,
) {
  const text = ran.text ?? ''
  const id =
    (ran.result as { backgroundTaskId?: string } | undefined)?.backgroundTaskId ??
    /background with ID: ([A-Za-z0-9_-]+)/.exec(text)?.[1]
  const outFile = /Output is being written to: (.+?\.output)/.exec(text)?.[1] ?? null
  if (!id || !outFile) return
  const start = await $.clock.now()
  const model = worker === 'codex' ? (/\s(?:-m|--model)\s+(\S+)/.exec(command)?.[1] ?? null) : (/--model\s+(\S+)/.exec(command)?.[1] ?? 'default')
  const run: WorkerRun = {
    id: `bg-${id}`,
    worker,
    model,
    status: 'running',
    start,
    end: null,
    tokens: null,
    task: taskOf(command) ?? (label || command.slice(0, 160)),
    output: outputOf(command),
    outFile,
  }
  await update($, liveRuns, list => [...list.filter(r => r.id !== run.id), run].slice(-20))
}

// What a worker's output says so far: its model, its tokens, how it ended.
function readWorkerOutput(out: string) {
  const model = /^\s*model:\s*(\S+)/m.exec(out)?.[1] ?? null
  const codexTokens = /tokens used\s*\r?\n(?:.*\r?\n){0,4}?\s*([\d,]+)\s*\r?$/m.exec(out)?.[1]
  const agyTokens = /"total_tokens"\s*:\s*(\d+)/.exec(out)?.[1]
  const raw = codexTokens ?? agyTokens
  const exit = /\[exited with code (-?\d+)\]\s*$/.exec(out)?.[1]
  return {
    model,
    tokens: raw ? Number(raw.replace(/,/g, '')) : null,
    ended: exit !== undefined || /\[killed\]\s*$/.test(out),
    ok: exit === '0',
  }
}

// A background shell call answers at once with its task id and output file; remember both.
async function trackBackground($: EngineInterface, ran: { text?: string; result?: unknown }, label: string, command: string) {
  const text = ran.text ?? ''
  const id =
    (ran.result as { backgroundTaskId?: string } | undefined)?.backgroundTaskId ??
    /background with ID: ([A-Za-z0-9_-]+)/.exec(text)?.[1]
  if (!id) return
  const outFile = /Output is being written to: (.+?\.output)/.exec(text)?.[1] ?? null
  const start = await $.clock.now()
  const entry: BgTask = { id, kind: 'shell', label: label || command.slice(0, 80), outFile, start, end: null, exit: null }
  await update($, bgTasks, list => [...list.filter(t => t.id !== id), entry].slice(-30))
}

// Every couple of seconds: has a shell written its exit line, has a subagent stopped?
async function pollBackground($: EngineInterface) {
  const now = await $.clock.now()
  const runs = await read($, liveRuns)
  const seen = new Map<string, Partial<WorkerRun>>()
  for (const r of runs) {
    if (r.status !== 'running' || !r.outFile) continue
    try {
      const o = readWorkerOutput(String(await $.fs.read(r.outFile)))
      const patch: Partial<WorkerRun> = {}
      if (o.model && !r.model) patch.model = o.model
      if (o.tokens !== null) patch.tokens = o.tokens
      if (o.ended) Object.assign(patch, { status: o.ok ? 'done' : 'failed', end: now })
      if (Object.keys(patch).length > 0) seen.set(r.id, patch)
    } catch {
      if (!(await $.fs.exists(r.outFile).catch(() => true))) seen.set(r.id, { status: 'failed', end: now })
    }
  }
  if (seen.size > 0) await update($, liveRuns, list => list.map(r => (seen.has(r.id) ? { ...r, ...seen.get(r.id) } : r)))
  const list = await read($, bgTasks)
  const changes = new Map<string, Partial<BgTask>>()
  for (const t of list) {
    if (t.kind !== 'shell' || t.end !== null || !t.outFile) continue
    try {
      const out = String(await $.fs.read(t.outFile))
      // The engine ends the file with "[exited with code N]", or "[killed]" when stopped.
      const m = /\[exited with code (-?\d+)\]\s*$/.exec(out)
      if (m) changes.set(t.id, { end: now, exit: Number(m[1]) })
      else if (/\[killed\]\s*$/.test(out)) changes.set(t.id, { end: now, exit: -1 })
    } catch {
      if (!(await $.fs.exists(t.outFile).catch(() => true))) changes.set(t.id, { end: now, exit: null })
    }
  }
  let agents: { id: string; description: string; type: string; status: string }[] = []
  try {
    agents = (await $.agent.list()) as typeof agents
  } catch {
    // no agent listing here
  }
  const live = new Set(['pending', 'running', 'waiting'])
  await update($, bgTasks, prev => {
    let next = prev.map(t => (changes.has(t.id) ? { ...t, ...changes.get(t.id) } : t))
    for (const a of agents) {
      const id = `agent:${a.id}`
      const known = next.find(t => t.id === id)
      if (live.has(a.status) && !known)
        next = [...next, { id, kind: 'agent' as const, label: a.description || a.type, outFile: null, start: now, end: null, exit: null }]
      else if (!live.has(a.status) && known && known.end === null)
        next = next.map(t => (t.id === id ? { ...t, end: now, exit: a.status === 'completed' ? 0 : a.status === 'killed' ? -1 : 1 } : t))
    }
    // Forget what ended over a minute ago.
    return next.filter(t => t.end === null || now - t.end < 60000).slice(-30)
  })
}

async function watch<R extends { isError?: boolean; text?: string; result?: unknown }>(
  $: EngineInterface,
  call: { command: string; label: string; background: boolean },
  run: () => Promise<R>,
): Promise<R> {
  const { command, label, background } = call
  const worker = (['codex', 'agy'] as const).find(w => WORKER_CMD[w].test(command))
  const isWorkerRun = Boolean(worker) || /run-worker\.ps1/i.test(command)
  // Background calls return at once. Worker runs are tracked by the wrapper's
  // status file; any other background shell is followed here.
  if (background) {
    const ran = await run()
    if (ran.isError) return ran
    if (worker && !/run-worker\.ps1/i.test(command)) await trackWorkerBackground($, ran, worker, label, command)
    else if (!isWorkerRun) await trackBackground($, ran, label, command)
    return ran
  }
  // A foreground direct worker call is followed live; anything else just runs.
  if (!worker || /run-worker\.ps1/i.test(command)) return run()
  const start = await $.clock.now()
  const id = `live-${start}`
  const model = worker === 'codex' ? null : (/--model\s+(\S+)/.exec(command)?.[1] ?? 'default')
  await update($, liveRuns, list =>
    [...list, { id, worker, model, status: 'running' as const, start, end: null, tokens: null, task: taskOf(command) ?? command.slice(0, 160), output: outputOf(command), outFile: null }].slice(-20),
  )
  const ran = await run()
  const end = await $.clock.now()
  await update($, liveRuns, list =>
    list.map(r => (r.id === id ? { ...r, status: ran.isError ? ('failed' as const) : ('done' as const), end } : r)),
  )
  return ran
}

function renderBand(on: Parameters<Register>[0]) {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const els = $.ui.resolve(e) as unknown as { Svg?: ElementConstructor<SvgProps> }
    const Svg = e.surface !== 'terminal' ? els.Svg : undefined
    const { now, views, active, runs } = await sceneNow($)
    const cModel = prettyModel(await read($, claudeModel))

    // Two caption lines per agent: who and which model, then what is happening.
    const who: Record<'claude' | WorkerName, string> = {
      claude: cModel,
      codex: workerModel(views.codex),
      agy: workerModel(views.agy),
    }
    const what = (k: 'claude' | WorkerName) =>
      k === 'claude' ? { text: CLAUDE_LABEL[claudeMood(views, active)], color: undefined } : activity(views[k], now)

    const column = (k: 'claude' | WorkerName) => {
      const act = what(k)
      return (
        <Box flexDirection="column" alignItems="center" flexShrink={0}>
          {Svg ? (
            <Svg
              source={sceneSvg(views, 1, CROP[k], active)}
              alt={`${LOOK[k].label}: ${act.text}`}
              height={60}
            />
          ) : null}
          <Text size="caption">
            <Text color={LOOK[k].color} bold>
              {LOOK[k].label}
            </Text>
            <Text dimColor>{who[k] ? ` · ${who[k]}` : ''}</Text>
          </Text>
          <Text size="caption" color={act.color} dimColor={!act.color}>
            {act.text}
          </Text>
        </Box>
      )
    }

    // The feed: everything still running in the background, newest last;
    // what just ended lingers 10 s with its outcome.
    type Row = { key: string; mark: string; color: string; who: string; whoColor: string; time: string; label: string; ended: boolean }
    const bg = await read($, bgTasks)
    const rows: Row[] = []
    for (const r of [...runs].reverse()) {
      const ended = r.status !== 'running'
      if (ended && (r.end === null || now - r.end > 10000)) continue
      if (!ended && views[r.worker].run?.id !== r.id) continue
      rows.push({
        key: r.id,
        mark: ended ? (r.status === 'failed' ? '✗' : '✓') : '●',
        color: r.status === 'failed' ? BAD : OK,
        who: LOOK[r.worker].label,
        whoColor: LOOK[r.worker].color,
        time: ended ? `${Math.max(1, Math.round(((r.end ?? r.start) - r.start) / 1000))}s` : fmtTime(now - r.start),
        label: r.task ? summarize(r.task, 90) : 'task not recorded',
        ended,
      })
    }
    for (const t of bg) {
      const ended = t.end !== null
      if (ended && now - (t.end ?? 0) > 10000) continue
      rows.push({
        key: t.id,
        mark: !ended ? (t.kind === 'agent' ? '◆' : '⚙') : t.exit === 0 ? '✓' : t.exit === -1 ? '■' : '✗',
        color: !ended || t.exit === 0 ? OK : t.exit === -1 ? '#94a3b8' : BAD,
        who: t.kind === 'agent' ? 'Agent' : 'Shell',
        whoColor: t.kind === 'agent' ? '#c084fc' : '#94a3b8',
        time: ended ? (t.exit === -1 ? 'stopped' : `${Math.max(1, Math.round(((t.end ?? t.start) - t.start) / 1000))}s`) : fmtTime(now - t.start),
        label: t.label,
        ended,
      })
    }
    const running = rows.filter(r => !r.ended)
    const shown = [...running, ...rows.filter(r => r.ended)].slice(0, 4)
    const hidden = rows.length - shown.length
    const row = (r: Row) => (
      <Box flexDirection="row" key={r.key}>
        <Text size="caption" wrap="truncate-end" dimColor={r.ended}>
          <Text color={r.color}>{`${r.mark} `}</Text>
          <Text color={r.whoColor} bold>
            {r.who}
          </Text>
          <Text dimColor>{` ${r.time} · `}</Text>
          <Text>{r.label}</Text>
        </Text>
      </Box>
    )

    return (
      <Box flexDirection="row" alignItems="flex-end" gap={3}>
        {column('claude')}
        {column('codex')}
        {column('agy')}
        <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0} gap={0}>
          <Text size="caption" dimColor>
            {running.length > 0 ? `Running in background · ${running.length}` : 'Nothing running in background'}
          </Text>
          {shown.map(row)}
          {hidden > 0 ? (
            <Text size="caption" dimColor>
              {`+${hidden} more`}
            </Text>
          ) : null}
        </Box>
      </Box>
    )
  })
}

function renderPane(on: Parameters<Register>[0]) {
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const els = $.ui.resolve(e) as unknown as { Svg?: ElementConstructor<SvgProps> }
    const Svg = e.surface !== 'terminal' ? els.Svg : undefined
    const { now, u, views, active } = await sceneNow($)

    const line = (w: WorkerName) => {
      const v = views[w]
      const r = v.run
      let what = 'asleep, no runs yet'
      if (r) {
        const model = r.model ? ` · ${r.model}` : ''
        const tokens = r.tokens !== null ? ` · ${r.tokens.toLocaleString()} tokens` : ''
        if (v.state === 'running') what = `working ${fmtTime(now - r.start)}${model}`
        else
          what = `${r.status === 'failed' ? 'failed' : 'finished'} ${fmtAgo(now - (r.end ?? r.start))} · took ${fmtTime((r.end ?? r.start) - r.start)}${model}${tokens}`
      }
      return (
        <Text>
          <Text color={LOOK[w].color} bold>
            {LOOK[w].label.padEnd(12)}
          </Text>
          <Text color={stateColor(v)} dimColor={v.state === 'sleep'}>
            {what}
          </Text>
        </Text>
      )
    }

    return (
      <Box flexDirection="column">
        {Svg ? <Svg source={sceneSvg(views, 2, undefined, active)} alt="Claude, Codex and Antigravity at work" /> : <Text dimColor>Open this pane in the desktop app to see the characters.</Text>}
        <Text> </Text>
        <Text>
          <Text color={LOOK.claude.color} bold>
            {'Claude '}
          </Text>
          <Text>{CLAUDE_LABEL[claudeMood(views, active)]}</Text>
          <Text dimColor>{` · weekly ${pct(u.weekly)} · 5h ${pct(u.fiveHour)}`}</Text>
        </Text>
        {line('codex')}
        {line('agy')}
      </Box>
    )
  })
}
