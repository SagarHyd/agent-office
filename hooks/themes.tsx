import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { INITIAL, transition, type SignalEvent } from './themes/shared/state.js'
import { INITIAL_THEME } from './themes/initial'
import { THEMES, type HostedTheme } from './themes/registry'

// agent-office hosts every installed theme's look and scene (hooks/themes/).
// A session shows one theme: the one last set with $.theme.set. So switching is
// one $.theme.set from this plugin, live in the running session: no plugin
// enable, no reload, no restart. This plugin's Backdrop hook then draws the
// chosen theme's scene, and the scene follows the same signal the theme mods use
// (working, asking, needs you).

const PANE = 'themes'
const STORE_KEY = 'theme'
const ASK_DELAY_MS = 1500

const activeTheme = atom({ plugin: 'agent-office', key: 'activeTheme' } as const, '', { shape: 'active-theme-1' })
const signal = atom({ plugin: 'agent-office', key: 'signal' } as const, INITIAL)

const seed = () => Math.floor(Math.random() * 2 ** 31)
const byId = (id: string) => THEMES.find(t => t.id === id)

// Every change of the scene's signal goes through the shared state machine.
async function send($: EngineInterface, event: SignalEvent) {
  const before = await read($, signal)
  if (transition(before, event) === before) return
  await update($, signal, state => transition(state, event))
}

async function apply($: EngineInterface, theme: HostedTheme): Promise<string> {
  if (theme.unpaintable !== undefined) $.ui.toast(theme.unpaintable)
  const set = await $.theme.set(theme.look)
  await update($, activeTheme, () => theme.id)
  return set.isDrawn ? `Theme: ${theme.name}.` : `${theme.name} is set, but this surface doesn't draw themes (${set.reason ?? 'no reason given'}).`
}

// target: a theme id, or null for no theme. Remembered for new sessions.
async function switchTo($: EngineInterface, target: string | null): Promise<string> {
  if (target === null) {
    await $.store.set(STORE_KEY, 'none')
    await update($, activeTheme, () => '')
    await $.theme.clear()
    return 'Theme off: the app has its own look again.'
  }
  const theme = byId(target)
  if (!theme) return `No theme called ${target}.`
  await $.store.set(STORE_KEY, theme.id)
  return apply($, theme)
}

// Called from agent-office's own session.start (a mod registers that event once):
// the /theme command, and the remembered theme put back.
export async function startThemes($: EngineInterface) {
  await $.command.register({
    name: 'theme',
    description: 'Switch theme live: /theme to pick, /theme <name>, /theme none',
  })
  const saved = await $.store.get(STORE_KEY)
  if (saved === 'none') return
  const theme = byId(typeof saved === 'string' ? saved : INITIAL_THEME)
  if (theme) await apply($, theme)
}

// Signal events, fed from agent-office's own turn and tool hooks.
export async function signalTurnStarted($: EngineInterface) {
  await send($, { type: 'turnStarted' })
}
export async function signalTurnEnded($: EngineInterface) {
  await send($, { type: 'turnEnded', seed: seed() })
}
export async function signalQuestionOpened($: EngineInterface) {
  await send($, { type: 'questionOpened', seed: seed() })
}
export async function signalQuestionAnswered($: EngineInterface) {
  await send($, { type: 'questionAnswered' })
}
export async function signalToolRan($: EngineInterface) {
  await send($, { type: 'toolRan' })
}

// What `/theme <words>` names: an exact id, or the one theme whose name holds the words.
function pick(words: string): HostedTheme[] {
  const w = words.toLowerCase().trim().replace(/\s+/g, '-')
  const exact = THEMES.filter(t => t.id === w)
  return exact.length > 0 ? exact : THEMES.filter(t => t.id.includes(w) || t.name.toLowerCase().includes(words.toLowerCase()))
}

export function registerThemes(on: Parameters<Register>[0]) {
  // The person's own /theme-<name> commands (~/.claude/commands) ran a script that
  // could not apply a theme live. Answer them here instead; no model turn spent.
  on('command.run', async ($, e, next) => {
    const m = /^theme-(.+)$/.exec(e.command)
    if (!m || !m[1]) return next(e)
    if (m[1] === 'off') return { text: await switchTo($, null) }
    if (!byId(m[1])) return next(e)
    return { text: await switchTo($, m[1]) }
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'theme' }, async ($, e) => {
    const words = e.args.trim()
    if (words === '') {
      await $.ui.open({ id: PANE, title: 'Themes' })
      return { text: 'Pick a theme in the Themes pane, or type /theme <name>.' }
    }
    if (/^(none|off|default)$/i.test(words)) return { text: await switchTo($, null) }
    const hits = pick(words)
    if (hits.length === 1 && hits[0]) return { text: await switchTo($, hits[0].id) }
    const names = THEMES.map(t => t.id).join(', ')
    return {
      text:
        hits.length === 0
          ? `No theme matches "${words}". Themes: ${names}.`
          : `"${words}" matches ${hits.map(h => h.name).join(', ')}. Be more specific.`,
    }
  })

  // Permission asks light the scene after a short wait (as the theme mods do).
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    const askId = e.tool_use_id
    const asksYou = e.approver === 'person' && verdict.decision === 'ask'
    const fromClaude = e.agentId === undefined && next.origin.plugin === 'engine'
    if (askId !== undefined && fromClaude && asksYou) {
      await send($, { type: 'askRaised', askId })
      $.clock.after(ASK_DELAY_MS, () => {
        send($, { type: 'askUnanswered', askId, seed: seed() }).catch(() => {})
      })
    }
    return verdict
  }).catch(($, e, next) => next(e))

  // The scene behind the conversation: drawn for the theme this plugin set.
  on('ui.render', { component: 'Backdrop' }, async ($, e, next) => {
    if (e.surface !== 'desktop' && e.surface !== 'mobile') return next(e)
    if (e.props.plugin !== $.plugin.name) return next(e)
    const theme = THEMES.find(t => t.scene === e.props.scene)
    if (!theme) return next(e)
    const now = await read($, signal)
    const { Svg } = $.ui.resolve(e)
    return theme.interactive ? (
      <Svg source={theme.sceneFor(now)} alt={theme.altFor(now)} isInteractive />
    ) : (
      <Svg source={theme.sceneFor(now)} alt={theme.altFor(now)} />
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const current = await read($, activeTheme)
    const name = byId(current)?.name
    return (
      <Box flexDirection="column" gap={1}>
        <Text dimColor>{`Current: ${name ?? 'none'} · click to switch, it applies straight away`}</Text>
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {THEMES.map(t => (
            <Button
              key={`theme-${t.id}`}
              label={t.id === current ? `● ${t.name}` : t.name}
              onPress={async () => {
                $.ui.toast(await switchTo($, t.id))
              }}
            />
          ))}
          <Button
            key="theme-none"
            label={name ? 'No theme' : '● No theme'}
            onPress={async () => {
              $.ui.toast(await switchTo($, null))
            }}
          />
        </Box>
      </Box>
    )
  })
}
