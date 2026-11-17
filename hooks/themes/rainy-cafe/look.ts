// The look the mod sets once per session: the Desktop colors and the animated scene.

import type { ThemeSetArgs } from 'claude-code'

import { makeColors } from '../shared/make-colors.js'

// The scene name the Backdrop hook answers to.
export const SCENE_NAME = "rainy-cafe"

const { theme, problems } = makeColors({
  label: "Rainy café",
  only: 'dark',
  roles: { accent: "#e0a060", danger: '#e5484d', success: '#4caf50', warning: '#e0a526', pro: "#9ad1ff" },
  dark: {
    gray: {
      anchors: {
        'surface-0': "#100c0a",
        'surface-1': "#171210",
        'surface-2': "#1e1714",
        'surface-3': "#251d19",
        'text-primary': "#f6efe8",
        'text-secondary': "#d8cbbf",
        'text-muted': "#aa9a8c",
      },
    },
  },
})

// The one kind of color problem that stops Desktop painting the theme at all.
export const UNPAINTABLE = problems.find(line => line.startsWith("Desktop won't paint"))

export const LOOK: ThemeSetArgs = {
  colors: theme,
  backdrop: { scene: SCENE_NAME, glass: { blur: 6, tint: "#100c0a", opacity: 0.5 } },
  overrideColorScheme: 'dark',
}
