<script setup>
import { useSkinStore } from '@pinia/skinStore.js'
import { useUiStore } from '@pinia/uiStore.js'
import SkinPreviewScene from '@three/components/skin-preview-scene.js'
import { ANIMATION_BUTTONS, SKIN_LIST } from '@three/config/skin-config.js'
/**
 * SkinSelector - 皮肤选择界面
 * - 上方: 3D 预览区域（左侧动画按钮组 + 旋转控制）
 * - 下方: 皮肤卡片选择
 * - 底部: 取消/应用按钮
 */
import { onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'

const skinStore = useSkinStore()
const ui = useUiStore()

// 模板引用
const previewCanvas = ref(null)
const previewContainer = ref(null)

// 预览场景实例（Three.js 对象，不需要深层响应式）
const previewScene = shallowRef(null)

// 当前播放的动画 ID
const currentAnim = ref('idle')

// ----------------------------------------
// 动画播放
// ----------------------------------------

/**
 * 播放指定动画
 * @param {string} animId - 动画 ID
 */
function playAnimation(animId) {
  currentAnim.value = animId
  const btn = ANIMATION_BUTTONS.find(b => b.id === animId)
  if (btn && previewScene.value) {
    previewScene.value.playAnimation(btn.clip)
  }
}

// ----------------------------------------
// 旋转控制
// ----------------------------------------

function rotateLeft() {
  previewScene.value?.rotate(-Math.PI / 4)
}

function rotateRight() {
  previewScene.value?.rotate(Math.PI / 4)
}

function resetRotation() {
  previewScene.value?.resetRotation()
}

// ----------------------------------------
// 皮肤选择
// ----------------------------------------

/**
 * 选择皮肤（仅更新预览）
 * @param {string} skinId - 皮肤 ID
 */
function selectSkin(skinId) {
  skinStore.setPreviewSkin(skinId)
}

// ----------------------------------------
// 应用 / 取消
// ----------------------------------------

function apply() {
  skinStore.applySkin()
  ui.exitSkinSelector()
}

function cancel() {
  skinStore.cancelPreview()
  ui.exitSkinSelector()
}

// ----------------------------------------
// 尺寸调整
// ----------------------------------------

/**
 * 更新画布尺寸
 */
function updateCanvasSize() {
  if (!previewContainer.value || !previewScene.value)
    return

  const rect = previewContainer.value.getBoundingClientRect()
  previewScene.value.resize(rect.width, rect.height)
}

// ----------------------------------------
// 生命周期
// ----------------------------------------

onMounted(() => {
  // 初始化预览场景
  if (previewCanvas.value) {
    previewScene.value = new SkinPreviewScene(previewCanvas.value)

    // 初始化尺寸
    updateCanvasSize()

    // 监听窗口大小变化
    window.addEventListener('resize', updateCanvasSize)
  }

  // 初始化皮肤预览状态
  skinStore.initPreview()

  // 加载当前预览皮肤模型
  const skin = SKIN_LIST.find(s => s.id === skinStore.previewSkinId)
  if (skin && previewScene.value) {
    previewScene.value.loadModel(skin.modelPath)
  }
})

onUnmounted(() => {
  // 移除窗口事件监听
  window.removeEventListener('resize', updateCanvasSize)

  // ESC / 退出暂停时视同取消，未应用的预览不保留
  skinStore.cancelPreview()

  // 清理预览场景资源
  previewScene.value?.dispose()
})

// ----------------------------------------
// 监听预览皮肤变化
// ----------------------------------------

watch(
  () => skinStore.previewSkinId,
  (skinId) => {
    const skin = SKIN_LIST.find(s => s.id === skinId)
    if (skin && previewScene.value) {
      previewScene.value.loadModel(skin.modelPath)
      // 切换皮肤时重置动画到 idle
      currentAnim.value = 'idle'
    }
  },
)
</script>

<template>
  <div class="skin-selector rs-panel rs-panel--glass rs-panel--wired is-powered" role="dialog" aria-labelledby="skin-selector-title">
    <header class="rs-panel__head">
      <div class="rs-panel__heading">
        <span class="rs-eyebrow" aria-hidden="true">Skins</span>
        <h2 id="skin-selector-title" class="rs-panel__title">
          {{ $t('menu.selectSkin') }}
        </h2>
      </div>
      <span class="rs-panel__hint rs-faint"><kbd class="rs-kbd">Esc</kbd>{{ $t('menu.back') }}</span>
    </header>

    <div class="skin-body">
      <!-- 左侧动画按钮组 -->
      <div class="anim-buttons" role="toolbar">
        <button
          v-for="(btn, index) in ANIMATION_BUTTONS"
          :key="btn.id"
          class="anim-btn"
          :class="{ active: currentAnim === btn.id }"
          :title="$t(btn.labelKey)"
          :aria-label="$t(btn.labelKey)"
          :aria-pressed="currentAnim === btn.id"
          @click="playAnimation(btn.id)"
        >
          <span
            class="anim-icon"
            :style="{
              backgroundPositionX: `calc(${index} * 100% / 7)`,
            }"
          />
        </button>
      </div>

      <!-- 3D 预览区域 -->
      <div ref="previewContainer" class="skin-preview">
        <canvas ref="previewCanvas" />
        <div v-if="skinStore.isLoading" class="loading-spinner" />

        <!-- 旋转控制 -->
        <div class="rotate-controls">
          <button class="rotate-btn" :aria-label="$t('skin.rotateLeft')" :title="$t('skin.rotateLeft')" @click="rotateLeft">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5" /></svg>
          </button>
          <button class="rotate-btn reset" :aria-label="$t('skin.resetView')" :title="$t('skin.resetView')" @click="resetRotation">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8a4.5 4.5 0 1 0 1.4-3.3M4.5 2v3h3" /></svg>
          </button>
          <button class="rotate-btn" :aria-label="$t('skin.rotateRight')" :title="$t('skin.rotateRight')" @click="rotateRight">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5" /></svg>
          </button>
        </div>
      </div>

      <!-- 皮肤选择区域 -->
      <div class="skin-list">
        <button
          v-for="skin in SKIN_LIST"
          :key="skin.id"
          class="skin-card"
          :class="{
            selected: skin.id === skinStore.previewSkinId,
            equipped: skin.id === skinStore.currentSkinId,
          }"
          :aria-pressed="skin.id === skinStore.previewSkinId"
          @click="selectSkin(skin.id)"
        >
          <span class="skin-thumb">
            <img
              :src="skin.thumbnail"
              alt=""
              class="skin-thumbnail"
            >
          </span>
          <span class="skin-meta">
            <span class="skin-name">{{ $t(skin.nameKey) }}</span>
            <span
              v-if="skin.id === skinStore.currentSkinId"
              class="equipped-badge"
            >
              {{ $t('skin.equipped') }}
            </span>
          </span>
        </button>
      </div>
    </div>

    <footer class="rs-panel__foot">
      <!-- 皮肤作者致谢 -->
      <div class="skin-credits">
        <span class="credits-text">{{ $t('skin.credits') }}</span>
        <span class="credits-links">
          <a
            href="https://www.planetminecraft.com/member/hibiki_ekko/"
            target="_blank"
            rel="noopener noreferrer"
            class="credit-link"
          >hibiki_ekko</a>
          <span class="credits-separator">&amp;</span>
          <a
            href="https://www.minecraftskins.com/profile/5521971/holland0519"
            target="_blank"
            rel="noopener noreferrer"
            class="credit-link"
          >holland0519</a>
        </span>
      </div>

      <!-- 操作按钮 -->
      <div class="rs-panel__row skin-actions">
        <button class="rs-btn rs-btn--ghost rs-muted" @click="cancel">
          <span class="title">{{ $t('common.cancel') }}</span>
        </button>
        <button
          class="rs-btn rs-btn--primary"
          :disabled="skinStore.previewSkinId === skinStore.currentSkinId"
          @click="apply"
        >
          <span class="title">{{ $t('common.apply') }}</span>
        </button>
      </div>
    </footer>
  </div>
</template>

<style scoped>
/* rs-panel + rs-panel--glass give the surface + blur, rs-panel--wired.is-powered the lit strip.
   Scoped rules compile to `.skin-selector[data-v-…]`, so they outrank the global .rs-panel rules. */
.skin-selector {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: min(900px, calc(100vw - 32px));
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 72px - 16px);
  /* rs-panel--glass drops the deepslate tiles the in-game panels sit on; keep them under the glass. */
  background:
    linear-gradient(rgba(14, 16, 19, 0.84), rgba(14, 16, 19, 0.9)),
    var(--rs-tex-deepslate-tiles) 0 0 / 64px 64px;
  image-rendering: pixelated;
  /* rs-panel's edge is --rs-line; over a bright world the panel needs the stronger edge. */
  border-color: var(--rs-line-strong);
  /* rs-panel's --rs-shadow is a small elevation; a menu floating over the 3D scene needs a deeper one. */
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 24px 60px rgba(0, 0, 0, 0.55);
  pointer-events: auto;
}

/* Panel chrome comes from the .rs-panel__* primitives. */

/* rs-btn's default is 40px/14px; these footer slabs stay at the menu's 44px/15px. */
.rs-panel__row .rs-btn {
  --rs-btn-h: 44px;
  min-width: 128px;
  font-size: 15px;
}

.skin-body {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) 232px;
  gap: 16px;
  min-height: 0;
  padding: 18px 24px;
}

/* 动画按钮 */
.anim-buttons {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.anim-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 1px solid var(--rs-line-strong);
  border-radius: var(--rs-radius);
  background: linear-gradient(180deg, var(--rs-bg-4), var(--rs-bg-3));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.07), inset 0 -2px 0 rgba(0, 0, 0, 0.35);
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
}

.anim-btn:hover {
  border-color: rgba(255, 74, 46, 0.7);
}

.anim-btn:active {
  transform: translateY(1px);
}

.anim-btn.active {
  border-color: var(--rs-red-hot);
  background: linear-gradient(180deg, #3a1410, #24100d);
  box-shadow: inset 0 0 0 1px rgba(255, 74, 46, 0.35), var(--rs-glow-soft);
}

.anim-icon {
  width: 28px;
  height: 28px;
  background-image: url('/textures/btns/buttons.webp');
  background-repeat: no-repeat;
  background-size: 900% 100%;
  image-rendering: pixelated;
  opacity: 0.85;
  pointer-events: none;
}

.anim-btn.active .anim-icon,
.anim-btn:hover .anim-icon {
  opacity: 1;
}

/* 3D 预览 */
.skin-preview {
  position: relative;
  /* Fixed height (not aspect-ratio) so the frame fills its column; the scene re-fits its camera on mount. */
  height: clamp(300px, calc(100vh - 72px - 16px - 210px), 480px);
  overflow: hidden;
  border: 1px solid var(--rs-line-strong);
  border-radius: var(--rs-radius);
  background: var(--rs-bg-1);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.6);
}

.skin-preview canvas {
  width: 100%;
  height: 100%;
  display: block;
}

.rotate-controls {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--rs-line-strong);
  border-radius: var(--rs-radius);
  background: rgba(14, 16, 19, 0.82);
}

.rotate-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 30px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 2px;
  background: transparent;
  color: var(--rs-text-2);
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.rotate-btn svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: square;
}

.rotate-btn:hover {
  border-color: rgba(255, 74, 46, 0.6);
  background: var(--rs-bg-3);
  color: #fff;
}

/* 皮肤卡片：选中 = 通电 */
.skin-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.skin-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 12px 10px 18px;
  border: 1px solid var(--rs-line-strong);
  border-radius: var(--rs-radius);
  background: rgba(22, 25, 29, 0.85);
  color: var(--rs-text);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
}

/* Dust strip on the left edge */
.skin-card::before {
  content: '';
  position: absolute;
  left: 6px;
  top: 10px;
  bottom: 10px;
  width: 4px;
  background: var(--rs-red-off);
  transition: background 0.15s, box-shadow 0.15s;
}

.skin-card:hover {
  border-color: rgba(255, 74, 46, 0.55);
  background: rgba(31, 35, 40, 0.92);
}

.skin-card:hover::before {
  background: var(--rs-red-dim);
}

.skin-card.selected {
  border-color: var(--rs-red-hot);
  background: linear-gradient(90deg, rgba(255, 74, 46, 0.16), rgba(22, 25, 29, 0.9) 70%);
  box-shadow: var(--rs-glow-soft);
}

.skin-card.selected::before {
  background: var(--rs-red-hot);
  box-shadow: var(--rs-glow);
}

.skin-thumb {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  border: 1px solid var(--rs-line);
  border-radius: 2px;
  background: var(--rs-bg-0);
}

.skin-thumbnail {
  width: 44px;
  height: 44px;
  object-fit: contain;
  image-rendering: pixelated;
}

.skin-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  min-width: 0;
}

.skin-name {
  color: var(--rs-text);
  font-size: 15px;
  font-weight: 600;
}

/* Equipped = the lamp is on */
.equipped-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 20px;
  padding: 0 7px;
  border: 1px solid rgba(255, 195, 90, 0.45);
  border-radius: 2px;
  background: rgba(60, 40, 8, 0.6);
  color: var(--rs-lamp);
  font: 500 11px/1 var(--rs-font-body);
}

.equipped-badge::before {
  content: '';
  width: 6px;
  height: 6px;
  background: var(--rs-lamp);
  box-shadow: 0 0 6px rgba(255, 195, 90, 0.8);
}

.anim-btn:focus-visible,
.rotate-btn:focus-visible,
.skin-card:focus-visible,
.credit-link:focus-visible {
  outline: 2px solid var(--rs-red-hot);
  outline-offset: 2px;
}

/* Footer */
.skin-credits {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  min-width: 0;
  color: var(--rs-text-3);
  font-size: 12px;
}

.credits-links {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.credit-link {
  color: var(--rs-text-2);
  text-decoration: underline;
  text-decoration-color: rgba(255, 255, 255, 0.2);
  text-underline-offset: 3px;
  transition: color 0.15s, text-decoration-color 0.15s;
}

.credit-link:hover {
  color: var(--rs-text);
  text-decoration-color: var(--rs-red-hot);
}

.skin-actions {
  flex: none;
}

/* Loading: a pulsing redstone dot */
.loading-spinner {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 12px;
  height: 12px;
  margin: -6px 0 0 -6px;
  background: var(--rs-red-hot);
  box-shadow: var(--rs-glow);
  animation: rs-pulse 1s ease-in-out infinite;
}

@media (max-height: 720px) {
  .rs-panel__head {
    padding: 16px 24px 12px;
  }

  .rs-panel__foot {
    padding: 12px 24px 14px;
  }

  .skin-body {
    padding: 14px 24px;
  }

  .anim-buttons {
    gap: 4px;
  }

  .anim-btn {
    width: 40px;
    height: 40px;
  }

  .skin-body {
    grid-template-columns: 40px minmax(0, 1fr) 232px;
  }
}

@media (max-width: 760px) {
  .skin-body {
    grid-template-columns: minmax(0, 1fr);
  }

  .anim-buttons {
    flex-direction: row;
    flex-wrap: wrap;
    order: 2;
  }

  .skin-list {
    flex-direction: row;
    order: 3;
  }

  .skin-card {
    flex-direction: column;
    padding: 14px 8px 10px;
  }

  .skin-card::before {
    left: 10px;
    right: 10px;
    top: 5px;
    bottom: auto;
    width: auto;
    height: 3px;
  }

  .skin-meta {
    align-items: center;
  }

  .rs-panel__foot {
    flex-direction: column;
    align-items: stretch;
  }
}

@media (prefers-reduced-motion: reduce) {
  .loading-spinner {
    animation: none;
  }

  /* rs-btn always animates; the menu buttons used to go still under reduced motion. */
  .skin-selector .rs-btn {
    transition: none;
  }
}
</style>
