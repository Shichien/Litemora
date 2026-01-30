import * as EssentialsPlugin from '@tweakpane/plugin-essentials'

import { Pane } from 'tweakpane'

export default class Debug {
  constructor() {
    this.active = window.location.hash === '#debug'

    if (this.active) {
      this.ui = new Pane(EssentialsPlugin)
    }
  }

  destroy() {
    if (this.ui) {
      this.ui.dispose()
      this.ui = null
    }
  }
}
