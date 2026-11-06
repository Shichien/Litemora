<script setup>
import { useSettingsStore } from '@pinia/settingsStore.js'
import { useUiStore } from '@pinia/uiStore.js'
import { PRESET_LABELS, PRESET_NAMES } from '@three/config/settings-presets.js'
/**
 * SettingsMenu - Full settings panel with Camera, Visual, Environment controls
 * Supports preset switching and step sliders
 */
import { computed } from 'vue'
import McStepSlider from './ui/McStepSlider.vue'

const ui = useUiStore()
const settings = useSettingsStore()

// Shadow quality options
const shadowOptions = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
]

// Preset options for Camera/Visual
const presetOptions = PRESET_NAMES.map(value => ({ value, label: PRESET_LABELS[value] }))

// Sensitivity display (percentage)
const sensitivityPercent = computed(() => {
  return Math.round(settings.mouseSensitivity * 1000)
})

function adjustSensitivity(delta) {
  const newValue = Math.max(
    0.01,
    Math.min(0.1, settings.mouseSensitivity + delta),
  )
  settings.setMouseSensitivity(newValue)
}
</script>

<template>
  <div class="settings-menu mc-panel" role="dialog" aria-labelledby="settings-menu-title">
    <header class="mc-panel__head">
      <div class="mc-panel__heading">
        <span class="mc-panel__eyebrow" aria-hidden="true">Settings</span>
        <h2 id="settings-menu-title" class="menu-title mc-panel__title">
          {{ $t('settings.title') }}
        </h2>
      </div>
      <span class="mc-hint"><kbd class="rs-kbd">Esc</kbd>{{ $t('menu.back') }}</span>
    </header>

    <div class="settings-content rs-scroll">
      <!-- Camera Section -->
      <section class="settings-section">
        <h3 class="section-title">
          {{ $t('settings.camera') }}
        </h3>

        <!-- Camera Preset -->
        <div class="setting-row">
          <span class="setting-label">{{ $t('settings.cameraStyle') }}</span>
          <div class="setting-control option-group">
            <button
              v-for="opt in presetOptions"
              :key="opt.value"
              class="option-btn"
              :class="{ active: settings.cameraPreset === opt.value }"
              :aria-pressed="settings.cameraPreset === opt.value"
              @click="settings.applyCameraPreset(opt.value)"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>
      </section>

      <!-- World Section -->
      <section class="settings-section">
        <h3 class="section-title">
          {{ $t('settings.world') }}
        </h3>

        <!-- View Distance -->
        <McStepSlider
          :model-value="settings.chunkViewDistance"
          :min="1"
          :max="8"
          :step="1"
          :decimals="0"
          :label="$t('settings.viewDistance')"
          @change="settings.setChunkViewDistance($event)"
        />

        <!-- Unload Padding -->
        <McStepSlider
          :model-value="settings.chunkUnloadPadding"
          :min="0"
          :max="4"
          :step="1"
          :decimals="0"
          :label="$t('settings.unloadPadding')"
          @change="settings.setChunkUnloadPadding($event)"
        />
      </section>

      <!-- Visual Section -->
      <section class="settings-section">
        <h3 class="section-title">
          {{ $t('settings.visual') }}
        </h3>

        <!-- SpeedLines Preset -->
        <div class="setting-row">
          <span class="setting-label">{{ $t('settings.speedLines') }}</span>
          <div class="setting-control option-group">
            <button
              v-for="opt in presetOptions"
              :key="opt.value"
              class="option-btn"
              :class="{ active: settings.visualPreset === opt.value }"
              :aria-pressed="settings.visualPreset === opt.value"
              @click="settings.applyVisualPreset(opt.value)"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>
      </section>

      <!-- Environment Section -->
      <section class="settings-section">
        <h3 class="section-title">
          {{ $t('settings.environment') }}
        </h3>

        <!-- Sun Intensity -->
        <McStepSlider
          :model-value="settings.envSunIntensity"
          :min="0"
          :max="5"
          :step="0.25"
          :decimals="2"
          :label="$t('settings.sun')"
          @change="settings.setEnvSunIntensity($event)"
        />

        <!-- Ambient Intensity -->
        <McStepSlider
          :model-value="settings.envAmbientIntensity"
          :min="0"
          :max="3"
          :step="0.25"
          :decimals="2"
          :label="$t('settings.ambient')"
          @change="settings.setEnvAmbientIntensity($event)"
        />

        <!-- Fog Density -->
        <McStepSlider
          :model-value="settings.envFogDensity"
          :min="0"
          :max="0.05"
          :step="0.005"
          :decimals="3"
          :label="$t('settings.fog')"
          @change="settings.setEnvFogDensity($event)"
        />
      </section>

      <!-- Graphics Section -->
      <section class="settings-section">
        <h3 class="section-title">
          {{ $t('settings.graphics') }}
        </h3>

        <!-- Shadow Quality -->
        <div class="setting-row">
          <span class="setting-label">{{ $t('settings.shadowQuality') }}</span>
          <div class="setting-control option-group">
            <button
              v-for="opt in shadowOptions"
              :key="opt.value"
              class="option-btn"
              :class="{ active: settings.shadowQuality === opt.value }"
              :aria-pressed="settings.shadowQuality === opt.value"
              @click="settings.setShadowQuality(opt.value)"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>
      </section>

      <!-- Controls Section -->
      <section class="settings-section">
        <h3 class="section-title">
          {{ $t('settings.controls') }}
        </h3>

        <!-- Mouse Sensitivity -->
        <div class="setting-row">
          <span class="setting-label">{{ $t('settings.sensitivity') }}</span>
          <div class="setting-control slider-control">
            <button class="adjust-btn" aria-label="-" @click="adjustSensitivity(-0.005)">
              -
            </button>
            <span class="value-display">{{ sensitivityPercent }}%</span>
            <button class="adjust-btn" aria-label="+" @click="adjustSensitivity(0.005)">
              +
            </button>
          </div>
        </div>
      </section>
    </div>

    <!-- Buttons -->
    <footer class="mc-panel__foot">
      <div class="mc-menu double settings-actions">
        <button class="mc-button mc-button--ghost mc-button--center half" @click="settings.resetToDefaults()">
          <span class="title">{{ $t('settings.reset') }}</span>
        </button>
        <button class="mc-button mc-button--primary mc-button--center half" @click="ui.exitSettings()">
          <span class="title">{{ $t('settings.done') }}</span>
        </button>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.settings-menu {
  width: min(880px, calc(100vw - 32px));
  max-height: min(760px, calc(100vh - 32px));
}

.settings-content {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 18px 24px;
  columns: 2 360px;
  column-gap: 16px;
}

.settings-section {
  break-inside: avoid;
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0 0 16px;
  padding: 14px 16px 16px;
  border: 1px solid var(--rs-line);
  border-radius: var(--rs-radius);
  background: rgba(8, 9, 11, 0.42);
}

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 2px;
  color: var(--rs-text-2);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

/* Dust dot: the group label is a powered line on the circuit */
.section-title::before {
  content: '';
  width: 6px;
  height: 6px;
  background: var(--rs-red-hot);
  box-shadow: 0 0 4px rgba(255, 70, 40, 0.6);
}

.setting-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  min-height: 32px;
}

.setting-label {
  color: var(--rs-text);
  font-size: 14px;
}

.setting-control {
  display: flex;
  gap: 4px;
}

/* Segmented preset switch */
.option-group {
  gap: 0;
  padding: 2px;
  border: 1px solid var(--rs-line-strong);
  border-radius: var(--rs-radius);
  background: var(--rs-bg-0);
}

.option-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 2px;
  background: transparent;
  color: var(--rs-text-2);
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.option-btn:hover {
  background: var(--rs-bg-3);
  color: var(--rs-text);
}

.option-btn:focus-visible,
.adjust-btn:focus-visible {
  outline: 2px solid var(--rs-red-hot);
  outline-offset: 1px;
}

.option-btn.active {
  border-color: rgba(255, 74, 46, 0.55);
  background: linear-gradient(180deg, #3a1410, #2a0e0b);
  color: #fff;
}

.option-btn.active::before {
  content: '';
  width: 5px;
  height: 5px;
  background: var(--rs-red-hot);
  box-shadow: 0 0 4px rgba(255, 70, 40, 0.8);
}

.slider-control {
  align-items: center;
  gap: 8px;
}

.adjust-btn {
  width: 32px;
  height: 32px;
  border: 1px solid var(--rs-line-strong);
  border-radius: var(--rs-radius);
  background: linear-gradient(180deg, var(--rs-bg-4), var(--rs-bg-3));
  color: var(--rs-text);
  font: 600 16px/1 var(--rs-font-mono);
  cursor: pointer;
  transition: border-color 0.15s;
}

.adjust-btn:hover {
  border-color: rgba(255, 74, 46, 0.7);
}

.adjust-btn:active {
  transform: translateY(1px);
}

.value-display {
  min-width: 56px;
  color: var(--rs-text);
  font: 500 13px/1 var(--rs-font-mono);
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.settings-actions {
  width: 100%;
}

.placeholder-text {
  color: var(--rs-text-3);
  font-size: 12px;
  font-style: italic;
}

@media (max-width: 860px) {
  .settings-content {
    columns: 1;
  }
}

@media (max-height: 720px) {
  .settings-content {
    padding: 14px 24px;
  }

  .settings-section {
    gap: 8px;
    margin-bottom: 12px;
    padding: 12px 14px;
  }
}
</style>
