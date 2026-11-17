// Rainy Window draws one scene that animates on its own, whatever the signal.
import type { Signal } from '../../../types'

import { SCENE_ALT, sceneSvg } from './scene'

export const sceneFor = (_signal: Signal): string => sceneSvg()
export const altFor = (_signal: Signal): string => SCENE_ALT
