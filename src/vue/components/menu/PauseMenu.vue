<script setup>
/**
 * PauseMenu - ESC menu when game is paused
 */
import { useUiStore } from '@pinia/uiStore.js'

const ui = useUiStore()

function enterAdmin() {
  window.location.hash = '#admin'
}
</script>

<template>
  <div class="pause-menu">
    <h2 class="menu-title">
      {{ $t('menu.paused') }}
    </h2>

    <div class="mc-menu">
      <button class="mc-button" @click="ui.toPlaying()">
        <span class="title">{{ $t('menu.resume') }}</span>
      </button>
      <button v-if="ui.pauseMenuConfig.showSettings" class="mc-button" @click="ui.toSettings('pauseMenu')">
        <span class="title">{{ $t('menu.settings') }}</span>
      </button>
      <button v-if="ui.pauseMenuConfig.showSkins" class="mc-button" @click="ui.toSkinSelector()">
        <span class="title">{{ $t('menu.skins') }}</span>
      </button>
      <button class="mc-button" @click="enterAdmin">
        <span class="title">Admin Console</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.pause-menu {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
}

.menu-title {
  color: #fff;
  font-size: 28px;
  text-shadow: 2px 2px #000;
}
</style>
