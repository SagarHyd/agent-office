// Rainy Window's look, from its register.ts (colours and glass unchanged).
import type { ThemeSetArgs } from 'claude-code'

import { makeColors } from './make-colors.js'

export const SCENE_NAME = 'rainy-window'

const { theme, problems } = makeColors({
  label: 'Rainy window',
  roles: { accent: '#5562C9', danger: '#C9553E', success: '#4E8B62', warning: '#D9892F', pro: '#7E5FC0' },
  light: {
    gray: {
      anchors: { 'surface-0': '#E9E3D6', 'surface-1': '#F0EBE1', 'surface-2': '#F6F2EA', 'text-primary': '#1F1F26', 'text-secondary': '#45444F', 'text-muted': '#5F5D68' },
    },
  },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#12142A',
        'surface-1': '#181B33',
        'surface-2': '#1D2140',
        'surface-3': '#22264A',
        'text-primary': '#EDE6D6',
        'text-secondary': '#CBC3B3',
        'text-muted': '#A8A192',
      },
    },
  },
})

export const UNPAINTABLE = problems.find(line => line.startsWith("Desktop won't paint"))

export const LOOK: ThemeSetArgs = { colors: theme, backdrop: { scene: SCENE_NAME, glass: { blur: 18, opacity: 0.62 } } }
