<script setup>
/**
 * PauseMenu - ESC menu when game is paused
 */
import { useUiStore } from '@pinia/uiStore.js'
import { navigateToUrl } from '@three/utils/navigation.js'
import { buildSpaceWorldsUrl, getActiveSpaceName } from '@three/utils/space-context.js'
import RedstoneTorch from '@ui-components/redstone/RedstoneTorch.vue'

const ui = useUiStore()

function exitWorld() {
  const activeSpaceName = getActiveSpaceName()
  if (!activeSpaceName) {
    return
  }

  ui.toPlaying({ requestPointerLock: false })
  navigateToUrl(buildSpaceWorldsUrl(activeSpaceName))
}
</script>

<template>
  <div class="pause-menu mc-panel" role="dialog" aria-labelledby="pause-menu-title">
    <header class="mc-panel__head">
      <div class="mc-panel__heading">
        <span class="mc-panel__eyebrow" aria-hidden="true">Paused</span>
        <h2 id="pause-menu-title" class="menu-title mc-panel__title">
          {{ $t('menu.paused') }}
        </h2>
      </div>
      <RedstoneTorch :size="32" class="pause-torch" />
    </header>

    <div class="mc-menu mc-panel__body">
      <button class="mc-button mc-button--primary" @click="ui.toPlaying()">
        <span class="title">{{ $t('menu.resume') }}</span>
        <kbd class="rs-kbd">Esc</kbd>
      </button>
      <button v-if="ui.pauseMenuConfig.showSettings" class="mc-button" @click="ui.toSettings()">
        <span class="title">{{ $t('menu.settings') }}</span>
      </button>
      <button v-if="ui.pauseMenuConfig.showSkins" class="mc-button" @click="ui.toSkinSelector()">
        <span class="title">{{ $t('menu.skins') }}</span>
      </button>
      <div class="pause-divider" aria-hidden="true" />
      <button class="mc-button mc-button--ghost" @click="exitWorld">
        <span class="title">{{ $t('menu.exitWorld') }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.pause-menu {
  width: min(360px, calc(100vw - 32px));
}

.pause-torch {
  margin-bottom: -2px;
}

.pause-divider {
  height: 1px;
  margin: 6px 0;
  background: var(--rs-line);
}
</style>
