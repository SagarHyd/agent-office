// The look the mod sets once per session: the Desktop colors and the animated scene.

import type { ThemeSetArgs } from 'claude-code'

import { makeColors } from '../shared/make-colors.js'

// The scene name the Backdrop hook answers to.
export const SCENE_NAME = "northern-lights"

const { theme, problems } = makeColors({
  label: "Northern lights",
  only: 'dark',
  roles: { accent: "#3dffb0", danger: '#e5484d', success: '#4caf50', warning: '#e0a526', pro: "#c46bff" },
  dark: {
    gray: {
      anchors: {
        'surface-0': "#030712",
        'surface-1': "#081020",
        'surface-2': "#0c162a",
        'surface-3': "#111c34",
        'text-primary': "#eaf6f4",
        'text-secondary': "#c2dcd8",
        'text-muted': "#8fb0aa",
      },
    },
  },
})

// The one kind of color problem that stops Desktop painting the theme at all.
export const UNPAINTABLE = problems.find(line => line.startsWith("Desktop won't paint"))

export const LOOK: ThemeSetArgs = {
  colors: theme,
  backdrop: { scene: SCENE_NAME, glass: { blur: 6, tint: "#030712", opacity: 0.5 } },
  overrideColorScheme: 'dark',
}
