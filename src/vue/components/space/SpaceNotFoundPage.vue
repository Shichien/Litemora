<script setup>
import IsoScene from '@ui-components/redstone/IsoScene.vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

defineProps({
  spaceName: {
    type: String,
    default: '',
  },
})

const { t } = useI18n()

const homeHref = computed(() => {
  if (typeof window === 'undefined') {
    return '/'
  }

  return `${window.location.origin}/`
})

// Broken circuit: lever + powered dust, a missing floor segment, then dead dust and an unlit lamp.
const DUST_OFF = '#4a0d08'
const DUST_ON = '#ff2a10'
function dust(x, z, lit) {
  return { x, y: 1, z, kind: 'plate', tex: 'redstone_dust_line0', rot: 90, tint: DUST_OFF, tintOn: DUST_ON, power: lit }
}
const brokenCircuit = (() => {
  const blocks = []
  for (let x = 0; x <= 7; x++) {
    for (let z = 0; z <= 2; z++) {
      if (x === 4) {
        continue
      }
      const cracked = (x === 3 || x === 5) && z !== 1
      blocks.push({ x, y: 0, z, tex: cracked ? 'cracked_deepslate_tiles' : 'deepslate_tiles' })
    }
  }
  blocks.push(
    { x: 0, y: 1, z: 1, tex: 'polished_deepslate' },
    { x: 0, y: 2, z: 1, kind: 'sprite', tex: 'lever' },
    dust(1, 1, true),
    dust(2, 1, true),
    dust(3, 1, true),
    dust(5, 1, false),
    dust(6, 1, false),
    { x: 7, y: 1, z: 1, tex: 'redstone_lamp' },
    { x: 7, y: 1, z: 0, tex: 'deepslate_bricks' },
    { x: 7, y: 2, z: 0, tex: 'deepslate_bricks' },
    { x: 7, y: 2, z: 1, tex: 'redstone_lamp' },
    { x: 1, y: 1, z: 0, tex: 'redstone_block', glow: true },
  )
  return blocks
})()
</script>

<template>
  <main class="missing-shell rs-bg-deepslate">
    <section class="missing-card rs-panel rs-panel--stone rs-panel--wired">
      <div class="missing-art" aria-hidden="true">
        <IsoScene :blocks="brokenCircuit" :unit="26" :powered="true" />
      </div>

      <p class="missing-kicker rs-eyebrow">
        Space Not Found
      </p>
      <h1>找不到这个创作者页面</h1>
      <p class="missing-copy">
        <span v-if="spaceName" class="missing-space rs-mono">{{ spaceName }}</span>
        <span v-if="spaceName"> 还没有对应的公开空间，或者这个地址并不存在。</span>
        <span v-else>这个地址还没有对应的公开空间。</span>
      </p>
      <p class="missing-hint">
        {{ t('space.notFound.hint') }}
      </p>
      <div class="missing-actions">
        <a class="primary-link rs-btn rs-btn--primary rs-btn--lg" :href="homeHref">返回 Litemora 首页</a>
      </div>
    </section>
  </main>
</template>

<style scoped>
.missing-shell {
  display: grid;
  place-items: center;
  min-height: 100vh;
  padding: 32px 20px;
  color: var(--rs-text);
  font-family: var(--rs-font-body);
}

.missing-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: min(600px, 100%);
  padding: 28px 40px 40px;
  text-align: center;
}

/* The wire strip stays dark: the signal never arrives. */
.missing-card.rs-panel--wired::before {
  background: var(--rs-red-off);
}

.missing-art {
  display: grid;
  place-items: center;
  width: 100%;
  height: 210px;
  margin-bottom: 18px;
}

.missing-kicker {
  margin: 0 0 14px;
}

.missing-card h1 {
  margin: 0;
  color: var(--rs-text);
  font-size: 28px;
  font-weight: 700;
  line-height: 1.3;
}

.missing-copy {
  margin: 14px 0 0;
  text-wrap: balance;
  color: var(--rs-text-2);
  font-size: 15px;
  line-height: 1.7;
}

.missing-space {
  display: inline-block;
  padding: 1px 7px;
  border: 1px solid var(--rs-line-strong);
  border-radius: 2px;
  background: var(--rs-bg-0);
  color: #ffb3a4;
  font-size: 13px;
  line-height: 1.5;
  word-break: break-all;
}

.missing-hint {
  margin: 6px 0 0;
  color: var(--rs-text-2);
  font-size: 14px;
  line-height: 1.6;
}

.missing-actions {
  margin-top: 28px;
}

@media (max-width: 640px) {
  .missing-card {
    padding: 20px 20px 28px;
  }

  .missing-art {
    height: 160px;
    transform: scale(0.78);
  }

  .missing-card h1 {
    font-size: 22px;
  }

  .missing-actions,
  .missing-actions .rs-btn {
    width: 100%;
  }
}
</style>
