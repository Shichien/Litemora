# Skin System Design

玩家换肤系统设计：预设皮肤切换 + 3D 实时预览 + 动画展示

---

## 核心决策

| 决策项 | 选择 |
|--------|------|
| 皮肤类型 | 预设皮肤切换（多套预制皮肤供选择） |
| 技术方案 | 多模型方案（每套皮肤是独立 GLB 文件） |
| UI 交互 | 独立皮肤选择界面（从主菜单/暂停菜单进入） |
| 预览方式 | 3D 实时预览 + Idle 动画展示 |
| 持久化 | Pinia + LocalStorage |
| 初期规模 | 3 套皮肤（steve, alex, player） |

---

## 1. 数据结构

### 皮肤配置模型

```javascript
// src/js/config/skin-config.js

// 可用皮肤列表
export const SKIN_LIST = [
  {
    id: 'steve',
    name: 'Steve',
    nameKey: 'skin.steve', // i18n key
    modelPath: 'models/character/steve.glb',
    thumbnail: 'textures/skins/steve-thumb.png',
  },
  {
    id: 'alex',
    name: 'Alex',
    nameKey: 'skin.alex',
    modelPath: 'models/character/alex.glb',
    thumbnail: 'textures/skins/alex-thumb.png',
  },
  {
    id: 'player',
    name: 'Classic',
    nameKey: 'skin.player',
    modelPath: 'models/character/player.glb',
    thumbnail: 'textures/skins/player-thumb.png',
  },
]

// 默认皮肤
export const DEFAULT_SKIN_ID = 'steve'

// 动画控制按钮配置（左侧按钮组）
export const ANIMATION_BUTTONS = [
  { id: 'idle', icon: '🧍', labelKey: 'anim.idle', clip: 'idle' },
  { id: 'walk', icon: '🚶', labelKey: 'anim.walk', clip: 'walk_forward' },
  { id: 'run', icon: '🏃', labelKey: 'anim.run', clip: 'run_forward' },
  { id: 'attack', icon: '⚔️', labelKey: 'anim.attack', clip: 'straight_punch' },
  { id: 'block', icon: '🛡️', labelKey: 'anim.block', clip: 'block' },
]
```

### skinStore 状态

```javascript
// src/pinia/skinStore.js
const STORAGE_KEY = 'mc-player-skin'

const currentSkinId = ref(DEFAULT_SKIN_ID) // 当前选中的皮肤
const previewSkinId = ref(null) // 预览界面临时选中
const isLoading = ref(false) // 模型加载状态

// 持久化
function loadSkin() {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved && SKIN_LIST.find(s => s.id === saved)) {
    currentSkinId.value = saved
  }
}

function saveSkin() {
  localStorage.setItem(STORAGE_KEY, currentSkinId.value)
}
```

---

## 2. 架构设计

### 整体架构图

```
┌─────────────────────────────────────────────────────────┐
│                    skinStore (Pinia)                    │
│  - currentSkinId       当前选中的皮肤 ID                 │
│  - previewSkinId       预览中的皮肤 ID                   │
│  - isLoading           加载状态                         │
│  - getSkinConfig()     获取皮肤配置                      │
└─────────────────────────────────────────────────────────┘
           │                              │
           ▼                              ▼
┌─────────────────────┐       ┌─────────────────────────┐
│  SkinSelector.vue   │       │   Player.js (Three.js)  │
│  - 皮肤选择列表       │       │   - 监听皮肤变更事件     │
│  - 3D 预览区域        │       │   - switchModel()       │
│  - 应用/取消按钮      │       │   - 复用动画系统         │
└─────────────────────┘       └─────────────────────────┘
           │
           ▼
┌─────────────────────┐
│ SkinPreviewScene.js │
│  - 独立预览渲染器     │
│  - 预览模型管理       │
│  - Idle 动画播放      │
└─────────────────────┘
```

### 数据流

1. **初始化**：`skinStore.loadSkin()` 从 localStorage 读取皮肤 ID
2. **游戏启动**：`Player.js` 读取 `skinStore.currentSkinId` 加载对应模型
3. **打开皮肤界面**：`SkinSelector.vue` 初始化 `SkinPreviewScene`，显示当前皮肤预览
4. **切换预览**：用户点击皮肤卡片 → `previewSkinId` 更新 → 预览场景切换模型
5. **应用皮肤**：点击确认 → `currentSkinId = previewSkinId` → emit `skin:changed` → `Player.js` 切换模型
6. **持久化**：`saveSkin()` 写入 localStorage

---

## 3. 皮肤选择界面

### UI 布局（参考 PlanetMinecraft 风格）

采用**上下布局**：上方为 3D 预览区域（带左侧动画按钮组），下方为皮肤选择卡片。

```
┌─────────────────────────────────────────────────────────┐
│                      🎭 选择皮肤                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌────┐ ┌─────────────────────────────────────────────┐│
│  │ 🧍 │ │                                             ││
│  ├────┤ │                                             ││
│  │ 🚶 │ │            3D 预览区域                       ││
│  ├────┤ │         (景深模糊背景)                       ││
│  │ 🏃 │ │                                             ││
│  ├────┤ │              角色模型                        ││
│  │ ⚔️ │ │                                             ││
│  ├────┤ │                                             ││
│  │ 🛡️ │ │           ┌─────────────┐                   ││
│  └────┘ │           │  ◀  🔄  ▶  │                   ││
│  动画   │           └─────────────┘                   ││
│  按钮组  │             旋转控制                         ││
│         └─────────────────────────────────────────────┘│
│                                                         │
│  ┌─────────────────────────────────────────────────────┐│
│  │  ┌─────────┐   ┌─────────┐   ┌─────────┐          ││
│  │  │  Steve  │   │  Alex   │   │ Classic │          ││
│  │  │   ✓     │   │         │   │         │          ││
│  │  │  已装备  │   │         │   │         │          ││
│  │  └─────────┘   └─────────┘   └─────────┘          ││
│  └─────────────────────────────────────────────────────┘│
│                                                         │
│             [ 取消 ]              [ 应用 ]              │
└─────────────────────────────────────────────────────────┘
```

### 动画按钮组配置

```javascript
// 左侧动画控制按钮
const ANIMATION_BUTTONS = [
  { id: 'idle', icon: '🧍', label: 'Idle', clip: 'idle' },
  { id: 'walk', icon: '🚶', label: 'Walk', clip: 'walk_forward' },
  { id: 'run', icon: '🏃', label: 'Run', clip: 'run_forward' },
  { id: 'attack', icon: '⚔️', label: 'Attack', clip: 'straight_punch' },
  { id: 'block', icon: '🛡️', label: 'Block', clip: 'block' },
]
```

### Vue 组件结构

```vue
<!-- src/vue/components/menu/SkinSelector.vue -->
<script setup>
import { useSkinStore } from '@pinia/skinStore.js'
import { useUiStore } from '@pinia/uiStore.js'
import SkinPreviewScene from '@three/components/skin-preview-scene.js'
import { ANIMATION_BUTTONS, SKIN_LIST } from '@three/config/skin-config.js'
import { onMounted, onUnmounted, ref, watch } from 'vue'

const skinStore = useSkinStore()
const ui = useUiStore()

const previewCanvas = ref(null)
const previewScene = ref(null)
const currentAnim = ref('idle')

// 动画播放
function playAnimation(animId) {
  currentAnim.value = animId
  const btn = ANIMATION_BUTTONS.find(b => b.id === animId)
  if (btn && previewScene.value) {
    previewScene.value.playAnimation(btn.clip)
  }
}

// 旋转控制
function rotateLeft() {
  previewScene.value?.rotate(-Math.PI / 4)
}

function rotateRight() {
  previewScene.value?.rotate(Math.PI / 4)
}

function resetRotation() {
  previewScene.value?.resetRotation()
}

// 皮肤选择
function selectSkin(skinId) {
  skinStore.setPreviewSkin(skinId)
}

// 应用 / 取消
function apply() {
  skinStore.applySkin()
  ui.exitSkinSelector()
}

function cancel() {
  skinStore.cancelPreview()
  ui.exitSkinSelector()
}

// 生命周期
onMounted(() => {
  previewScene.value = new SkinPreviewScene(previewCanvas.value)
  skinStore.initPreview()
})

onUnmounted(() => {
  previewScene.value?.dispose()
})

// 监听预览皮肤变化
watch(() => skinStore.previewSkinId, (skinId) => {
  const skin = SKIN_LIST.find(s => s.id === skinId)
  if (skin) {
    previewScene.value?.loadModel(skin.modelPath)
  }
})
</script>

<template>
  <div class="skin-selector">
    <h2 class="skin-title">
      {{ $t('menu.selectSkin') }}
    </h2>

    <!-- 预览区域（上方） -->
    <div class="skin-preview-section">
      <!-- 左侧动画按钮组 -->
      <div class="anim-buttons">
        <button
          v-for="btn in ANIMATION_BUTTONS"
          :key="btn.id"
          class="anim-btn"
          :class="{ active: currentAnim === btn.id }"
          :title="btn.label"
          @click="playAnimation(btn.id)"
        >
          {{ btn.icon }}
        </button>
      </div>

      <!-- 3D 预览区域 -->
      <div ref="previewContainer" class="skin-preview">
        <canvas ref="previewCanvas" />
        <div v-if="skinStore.isLoading" class="loading-spinner" />

        <!-- 旋转控制 -->
        <div class="rotate-controls">
          <button class="rotate-btn" @click="rotateLeft">
            ◀
          </button>
          <button class="rotate-btn reset" @click="resetRotation">
            🔄
          </button>
          <button class="rotate-btn" @click="rotateRight">
            ▶
          </button>
        </div>
      </div>
    </div>

    <!-- 皮肤选择区域（下方） -->
    <div class="skin-list">
      <div
        v-for="skin in SKIN_LIST"
        :key="skin.id"
        class="skin-card"
        :class="{
          selected: skin.id === skinStore.previewSkinId,
          equipped: skin.id === skinStore.currentSkinId,
        }"
        @click="selectSkin(skin.id)"
      >
        <div class="skin-thumb">
          <img :src="skin.thumbnail" :alt="skin.name">
        </div>
        <span class="skin-name">{{ $t(skin.nameKey) }}</span>
        <span v-if="skin.id === skinStore.currentSkinId" class="equipped-badge">
          {{ $t('skin.equipped') }}
        </span>
      </div>
    </div>

    <!-- 操作按钮（最下方） -->
    <div class="skin-actions">
      <button class="btn btn-secondary" @click="cancel">
        {{ $t('common.cancel') }}
      </button>
      <button
        class="btn btn-primary"
        :disabled="skinStore.previewSkinId === skinStore.currentSkinId"
        @click="apply"
      >
        {{ $t('common.apply') }}
      </button>
    </div>
  </div>
</template>
```

### CSS 样式要点

```scss
// src/styles/_skin-selector.scss

.skin-selector {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.5rem;
  max-width: 600px;
  margin: 0 auto;
}

.skin-preview-section {
  display: flex;
  gap: 0.5rem;
}

// 左侧动画按钮组
.anim-buttons {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;

  .anim-btn {
    width: 40px;
    height: 40px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    background: rgba(0, 0, 0, 0.5);
    border-radius: 4px;
    font-size: 1.25rem;
    cursor: pointer;
    transition: all 0.2s;

    &:hover {
      background: rgba(255, 255, 255, 0.2);
    }

    &.active {
      border-color: #4ade80;
      background: rgba(74, 222, 128, 0.2);
    }
  }
}

// 3D 预览区域
.skin-preview {
  flex: 1;
  position: relative;
  aspect-ratio: 16 / 10;
  border-radius: 8px;
  overflow: hidden;
  background: linear-gradient(180deg, #87CEEB 0%, #3a8c3a 100%);

  canvas {
    width: 100%;
    height: 100%;
  }

  // 旋转控制
  .rotate-controls {
    position: absolute;
    bottom: 1rem;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 0.5rem;

    .rotate-btn {
      width: 36px;
      height: 36px;
      border: none;
      background: rgba(0, 0, 0, 0.6);
      color: white;
      border-radius: 4px;
      cursor: pointer;

      &:hover {
        background: rgba(0, 0, 0, 0.8);
      }

      &.reset {
        background: rgba(74, 222, 128, 0.6);
      }
    }
  }
}

// 皮肤选择卡片列表
.skin-list {
  display: flex;
  justify-content: center;
  gap: 1rem;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 8px;
}

.skin-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem;
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.4);
  cursor: pointer;
  transition: all 0.2s;
  min-width: 100px;

  &:hover {
    border-color: rgba(255, 255, 255, 0.5);
    transform: translateY(-2px);
  }

  &.selected {
    border-color: #4ade80;
    background: rgba(74, 222, 128, 0.15);
  }

  &.equipped .equipped-badge {
    display: block;
  }

  .skin-thumb {
    width: 64px;
    height: 64px;

    img {
      width: 100%;
      height: 100%;
      image-rendering: pixelated;
    }
  }

  .skin-name {
    font-size: 0.875rem;
    color: white;
  }

  .equipped-badge {
    display: none;
    font-size: 0.75rem;
    color: #4ade80;
    background: rgba(74, 222, 128, 0.2);
    padding: 0.125rem 0.5rem;
    border-radius: 4px;
  }
}

// 操作按钮
.skin-actions {
  display: flex;
  justify-content: center;
  gap: 1rem;
  padding-top: 0.5rem;
}
```

---

## 4. 3D 预览模块

### 新文件：`src/js/components/skin-preview-scene.js`

**职责**：
1. 创建独立的 WebGLRenderer 和场景（带景深模糊背景）
2. 加载预览模型并支持多种动画播放
3. 支持鼠标拖拽旋转角色 + 按钮旋转控制
4. 模型切换时平滑过渡

**核心实现**：

```javascript
// src/js/components/skin-preview-scene.js
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

export default class SkinPreviewScene {
  constructor(canvas) {
    this.canvas = canvas
    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
    this.loader = new GLTFLoader()

    // 模型相关
    this.currentModel = null
    this.animations = [] // 存储所有动画 clips
    this.mixer = null
    this.currentAction = null

    // 旋转控制
    this.modelRotation = Math.PI // 初始朝向
    this.targetRotation = Math.PI
    this.isDragging = false
    this.lastMouseX = 0

    this.clock = new THREE.Clock()
    this.animationFrameId = null

    this._setupScene()
    this._setupLights()
    this._setupBackground()
    this._setupDragControls()
    this._startRenderLoop()
  }

  /**
   * 初始化场景
   */
  _setupScene() {
    // 相机位置（正面稍偏上）
    this.camera.position.set(0, 1.2, 3.5)
    this.camera.lookAt(0, 0.9, 0)

    // 渲染器设置
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
  }

  /**
   * 设置灯光（模拟户外光照）
   */
  _setupLights() {
    // 主光源（太阳光）
    const sunLight = new THREE.DirectionalLight(0xFFFFFF, 1.5)
    sunLight.position.set(5, 10, 5)
    this.scene.add(sunLight)

    // 环境光
    const ambientLight = new THREE.AmbientLight(0x87CEEB, 0.6)
    this.scene.add(ambientLight)

    // 补光
    const fillLight = new THREE.DirectionalLight(0xFFFFFF, 0.3)
    fillLight.position.set(-3, 2, -3)
    this.scene.add(fillLight)
  }

  /**
   * 设置景深模糊背景（类似 PMC 风格）
   */
  _setupBackground() {
    // 渐变背景：天空蓝 → 草地绿
    const bgCanvas = document.createElement('canvas')
    bgCanvas.width = 256
    bgCanvas.height = 256
    const ctx = bgCanvas.getContext('2d')

    const gradient = ctx.createLinearGradient(0, 0, 0, 256)
    gradient.addColorStop(0, '#87CEEB') // 天空蓝
    gradient.addColorStop(0.6, '#5BA85B') // 草地绿
    gradient.addColorStop(1, '#3A7A3A') // 深绿

    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 256, 256)

    const bgTexture = new THREE.CanvasTexture(bgCanvas)
    this.scene.background = bgTexture
  }

  /**
   * 设置鼠标拖拽旋转
   */
  _setupDragControls() {
    this.canvas.addEventListener('mousedown', (e) => {
      this.isDragging = true
      this.lastMouseX = e.clientX
    })

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging)
        return
      const deltaX = e.clientX - this.lastMouseX
      this.targetRotation -= deltaX * 0.01
      this.lastMouseX = e.clientX
    })

    window.addEventListener('mouseup', () => {
      this.isDragging = false
    })
  }

  /**
   * 加载并显示皮肤模型
   * @param {string} modelPath - 模型路径
   * @returns {Promise<void>}
   */
  async loadModel(modelPath) {
    // 移除旧模型
    if (this.currentModel) {
      this.scene.remove(this.currentModel)
      if (this.mixer) {
        this.mixer.stopAllAction()
        this.mixer = null
      }
      this.currentModel = null
      this.animations = []
    }

    // 加载新模型
    const gltf = await this.loader.loadAsync(modelPath)
    this.currentModel = gltf.scene
    this.currentModel.rotation.y = this.modelRotation
    this.scene.add(this.currentModel)

    // 存储动画
    this.animations = gltf.animations

    // 初始化动画混合器
    if (this.animations.length > 0) {
      this.mixer = new THREE.AnimationMixer(this.currentModel)
      // 默认播放 idle
      this.playAnimation('idle')
    }
  }

  /**
   * 播放指定动画
   * @param {string} clipName - 动画名称（模糊匹配）
   */
  playAnimation(clipName) {
    if (!this.mixer || this.animations.length === 0)
      return

    // 查找匹配的动画 clip
    const clip = this.animations.find(a =>
      a.name.toLowerCase().includes(clipName.toLowerCase())
    ) || this.animations[0]

    // 停止当前动画，平滑过渡到新动画
    if (this.currentAction) {
      this.currentAction.fadeOut(0.3)
    }

    this.currentAction = this.mixer.clipAction(clip)
    this.currentAction.reset()
    this.currentAction.fadeIn(0.3)
    this.currentAction.play()
  }

  /**
   * 按钮控制旋转
   * @param {number} angle - 旋转角度（弧度）
   */
  rotate(angle) {
    this.targetRotation += angle
  }

  /**
   * 重置旋转
   */
  resetRotation() {
    this.targetRotation = Math.PI
  }

  /**
   * 渲染循环
   */
  _startRenderLoop() {
    const animate = () => {
      this.animationFrameId = requestAnimationFrame(animate)

      const delta = this.clock.getDelta()

      // 更新动画
      if (this.mixer) {
        this.mixer.update(delta)
      }

      // 平滑旋转
      if (this.currentModel) {
        this.modelRotation += (this.targetRotation - this.modelRotation) * 0.1
        this.currentModel.rotation.y = this.modelRotation
      }

      this.renderer.render(this.scene, this.camera)
    }

    animate()
  }

  /**
   * 调整画布大小
   */
  resize(width, height) {
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
  }

  /**
   * 清理资源
   */
  dispose() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId)
    }

    if (this.mixer) {
      this.mixer.stopAllAction()
    }

    this.renderer.dispose()
    this.scene.clear()
  }
}
```

---

## 5. Player.js 皮肤切换

### 修改 `src/js/world/player/player.js`

```javascript
import { useSkinStore } from '@pinia/skinStore.js'
import { SKIN_LIST } from '../../config/skin-config.js'

export default class Player {
  constructor() {
    // ... existing code ...

    // 监听皮肤变更事件
    emitter.on('skin:changed', this._handleSkinChange.bind(this))
  }

  /**
   * 根据 skinId 获取模型资源
   * @param {string} skinId
   */
  _getModelResource(skinId) {
    const skinConfig = SKIN_LIST.find(s => s.id === skinId)
    if (!skinConfig)
      return this.resources.items.playerModel

    // 资源名称约定：skinId + 'Model' (如 steveModel, alexModel)
    const resourceName = `${skinId}Model`
    return this.resources.items[resourceName] || this.resources.items.playerModel
  }

  /**
   * 切换皮肤模型
   * @param {{ skinId: string }} payload
   */
  async _handleSkinChange({ skinId }) {
    const resource = this._getModelResource(skinId)

    // 移除旧模型
    this.movement.group.remove(this.model)

    // 设置新模型
    this.resource = resource
    this.setModel()

    // 重新初始化动画控制器
    this.animation.dispose()
    this.animation = new PlayerAnimationController(this.model, this.resource.animations)
  }
}
```

---

## 6. 资源加载配置

### 修改 `src/js/sources.js`

```javascript
// 玩家皮肤模型
{
  name: 'steveModel',
  type: 'gltfModel',
  path: 'models/character/steve.glb',
},
{
  name: 'alexModel',
  type: 'gltfModel',
  path: 'models/character/alex.glb',
},
{
  name: 'playerModel',
  type: 'gltfModel',
  path: 'models/character/player.glb',
},
```

---

## 7. UI Store 扩展

### 修改 `src/pinia/uiStore.js`

```javascript
/** Main menu sub-view: 'root' | 'worldSetup' | 'howToPlay' | 'skinSelector' */
const mainMenuView = ref('root')

/**
 * Enter Skin Selector view
 */
function toSkinSelector() {
  mainMenuView.value = 'skinSelector'
}

/**
 * Exit Skin Selector back to previous view
 */
function exitSkinSelector() {
  if (screen.value === 'pauseMenu') {
    // 从暂停菜单进入，返回暂停菜单
    mainMenuView.value = 'root'
  }
  else {
    backToMainRoot()
  }
}
```

---

## 8. 事件流程

### 应用皮肤流程

```
用户点击 "应用" 按钮
    │
    ▼
[SkinSelector.vue]
    │ skinStore.applySkin(previewSkinId)
    ▼
[skinStore]
    │ 1. currentSkinId = previewSkinId
    │ 2. saveSkin() → localStorage
    │ 3. emitter.emit('skin:changed', { skinId })
    ▼
[Player.js]
    │ _handleSkinChange({ skinId })
    │ 1. 获取新模型资源
    │ 2. 移除旧模型
    │ 3. 设置新模型
    │ 4. 重建动画控制器
    ▼
[SkinSelector.vue]
    │ ui.exitSkinSelector()
    ▼
返回上一界面
```

### 预览切换流程

```
用户点击皮肤卡片
    │
    ▼
[SkinSelector.vue]
    │ skinStore.setPreviewSkin(skinId)
    ▼
[skinStore]
    │ previewSkinId = skinId
    ▼
[SkinPreviewScene]
    │ loadModel(skinConfig.modelPath)
    ▼
3D 预览区域显示新皮肤 + Idle 动画
```

---

## 9. i18n 本地化

### 修改 `src/locales/en.json`

```json
{
  "menu": {
    "selectSkin": "Select Skin",
    "skins": "Skins"
  },
  "skin": {
    "steve": "Steve",
    "alex": "Alex",
    "player": "Classic",
    "equipped": "Equipped"
  },
  "anim": {
    "idle": "Idle",
    "walk": "Walk",
    "run": "Run",
    "attack": "Attack",
    "block": "Block"
  },
  "common": {
    "cancel": "Cancel",
    "apply": "Apply"
  }
}
```

### 修改 `src/locales/zh.json`

```json
{
  "menu": {
    "selectSkin": "选择皮肤",
    "skins": "皮肤"
  },
  "skin": {
    "steve": "史蒂夫",
    "alex": "艾利克斯",
    "player": "经典",
    "equipped": "已装备"
  },
  "anim": {
    "idle": "站立",
    "walk": "行走",
    "run": "奔跑",
    "attack": "攻击",
    "block": "格挡"
  },
  "common": {
    "cancel": "取消",
    "apply": "应用"
  }
}
```

---

## 10. 涉及文件

| 操作 | 文件 |
|------|------|
| 新增 | `src/js/config/skin-config.js` |
| 新增 | `src/pinia/skinStore.js` |
| 新增 | `src/vue/components/menu/SkinSelector.vue` |
| 新增 | `src/js/components/skin-preview-scene.js` |
| 修改 | `src/js/sources.js` |
| 修改 | `src/js/world/player/player.js` |
| 修改 | `src/pinia/uiStore.js` |
| 修改 | `src/vue/components/menu/UiRoot.vue` |
| 修改 | `src/vue/components/menu/MainMenu.vue` |
| 修改 | `src/vue/components/menu/PauseMenu.vue` |
| 修改 | `src/locales/en.json` |
| 修改 | `src/locales/zh.json` |
| 修改 | `src/styles/hud.scss` (新增皮肤选择器样式) |

---

## 11. 验证计划

1. **基础功能**
   - [ ] 从主菜单进入皮肤选择界面
   - [ ] 从暂停菜单进入皮肤选择界面
   - [ ] 皮肤列表正确显示 3 套皮肤（上下布局）

2. **预览功能**
   - [ ] 3D 预览区域显示角色模型（带景深背景）
   - [ ] 角色默认播放 Idle 动画
   - [ ] 点击不同皮肤卡片切换预览
   - [ ] 鼠标拖拽旋转角色

3. **动画控制**
   - [ ] 左侧动画按钮组显示正确（5 个按钮）
   - [ ] 点击按钮切换对应动画（Idle/Walk/Run/Attack/Block）
   - [ ] 动画切换平滑过渡
   - [ ] 当前播放动画按钮高亮

4. **旋转控制**
   - [ ] ◀ 按钮向左旋转 45°
   - [ ] ▶ 按钮向右旋转 45°
   - [ ] 🔄 按钮重置旋转角度

5. **应用功能**
   - [ ] 点击 "应用" 后游戏中角色切换皮肤
   - [ ] 动画系统正常工作（行走、跳跃、攻击）
   - [ ] 皮肤选择持久化（刷新后保持）

6. **边界情况**
   - [ ] 选择当前已装备皮肤时 "应用" 按钮禁用
   - [ ] 点击 "取消" 不保存更改
   - [ ] ESC 键返回上一界面

7. **性能**
   - [ ] 预览场景独立渲染，不影响主游戏帧率
   - [ ] 模型/动画切换无明显卡顿

---

## 12. 后续扩展

- 皮肤解锁系统（成就/商店）
- 自定义皮肤上传
- 皮肤配件系统（帽子、披风等）
- 皮肤动画预览（播放指定动作）
