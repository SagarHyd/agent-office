// The look the mod sets once per session: the Desktop colors and the animated scene.

import type { ThemeSetArgs } from 'claude-code'

import { makeColors } from '../shared/make-colors.js'

// The scene name the Backdrop hook answers to.
export const SCENE_NAME = "new-year-eve"

const { theme, problems } = makeColors({
  label: "New Year's Eve",
  only: 'dark',
  roles: { accent: "#ffd23d", danger: '#e5484d', success: '#4caf50', warning: '#e0a526', pro: "#ff4d8b" },
  dark: {
    gray: {
      anchors: {
        'surface-0': "#05050f",
        'surface-1': "#0b0b1c",
        'surface-2': "#101028",
        'surface-3': "#151534",
        'text-primary': "#f4f2ff",
        'text-secondary': "#cfcbe6",
        'text-muted': "#a19cc0",
      },
    },
  },
})

// The one kind of color problem that stops Desktop painting the theme at all.
export const UNPAINTABLE = problems.find(line => line.startsWith("Desktop won't paint"))

export const LOOK: ThemeSetArgs = {
  colors: theme,
  backdrop: { scene: SCENE_NAME, glass: { blur: 6, tint: "#05050f", opacity: 0.5 } },
  overrideColorScheme: 'dark',
}
