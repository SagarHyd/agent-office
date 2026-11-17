export type WorkerName = 'codex' | 'agy'

export type WorkerRun = {
  id: string
  worker: WorkerName
  model: string | null
  status: 'running' | 'done' | 'failed'
  start: number
  end: number | null
  tokens: number | null
  task: string | null
  output: string | null
  // A background run started without the wrapper: the engine's output file, polled for model, tokens and exit.
  outFile: string | null
}

export type Clock = { n: number; now: number }

// Background work that is not a worker run: a shell command or a subagent.
// exit: 0 ok, a positive code failed, -1 stopped, null not known.
export type BgTask = {
  id: string
  kind: 'shell' | 'agent'
  label: string
  outFile: string | null
  start: number
  end: number | null
  exit: number | null
}

export type Usage = { fiveHour: number | null; weekly: number | null }

// What a hosted theme's scene shows (the shared theme engine's signal).
export type Signal =
  // Claude is busy.
  | { mode: 'working' }
  // A permission ask is up but may still be settled by Auto mode.
  | { mode: 'asking'; askId: string }
  // Claude needs you.
  | { mode: 'waiting'; burst: number }

declare module 'claude-code' {
  interface PluginState {
    'agent-office': {
      clock: Shaped<Clock>
      fileRuns: Shaped<WorkerRun[]>
      liveRuns: Shaped<WorkerRun[]>
      usage: Shaped<Usage>
      claudeModel: Shaped<string>
      claudeActive: Shaped<boolean>
      bgTasks: Shaped<BgTask[]>
      // The hosted theme in force this session ("" for none).
      activeTheme: Shaped<string>
      // The theme scene's signal: working, asking, or needs-you.
      signal: Signal
    }
  }
}
