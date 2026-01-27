<script setup>
/**
 * InfoPanel - Top Right Info Display
 * Shows Time, Day, FPS, Player Count, Server info like typical MC mods
 */
import { useHudStore } from '@pinia/hudStore.js'

const hud = useHudStore()
</script>

<template>
  <div class="info-panel mc-text">
    <div class="info-line">
      <span class="info-icon icon-time" aria-hidden="true" />
      <span class="info-text">{{ hud.gameTime }}</span>
    </div>
    <div class="info-line">
      <span class="info-icon icon-day" aria-hidden="true" />
      <span class="info-text">Day {{ hud.gameDay }}</span>
    </div>
    <div class="info-line spacer" />
    <div class="info-line">
      <span class="info-icon icon-fps" aria-hidden="true" />
      <span class="info-text">{{ hud.fps }} FPS</span>
    </div>
    <div class="info-line">
      <span class="info-icon icon-players" aria-hidden="true" />
      <span class="info-text">{{ hud.playerCount }} player</span>
    </div>
    <div class="info-line">
      <span class="info-icon icon-server" aria-hidden="true" />
      <span class="info-text">{{ hud.serverName }}</span>
    </div>
  </div>
</template>

<style scoped>
.info-panel {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  text-align: right;
  gap: calc(1px * var(--hud-scale));
  pointer-events: none;
}

.info-line {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: flex-end;
  gap: calc(3px * var(--hud-scale));
  font-size: calc(6px * var(--hud-scale));
  line-height: 1.2;
}

.info-icon {
  flex-shrink: 0;
  width: calc(10px * var(--hud-scale));
  height: calc(10px * var(--hud-scale));
  background-image: url('/textures/hub/info_icon.png');
  background-size: 500% 80%;
  background-repeat: no-repeat;
}

/* 5 icons left-to-right: clock, sun, fps, players, sign */
.icon-time { background-position: 0 0; }
.icon-day { background-position: 25% 0; }
.icon-fps { background-position: 50% 0; }
.icon-players { background-position: 75% 0; }
.icon-server { background-position: 100% 0; }

.info-text {
  background: linear-gradient(to bottom, #e9b115, #fad64a, #fdf55f, #fad64a);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  text-shadow: 1px 1px 0 #3f3f3f;
}

.spacer {
  height: calc(4px * var(--hud-scale));
}
</style>
