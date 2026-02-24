<script setup>
import emitter from '@three/utils/event/event-bus.js'
import {
  clearAdminWorldConfig,
  DEFAULT_BACKEND_WORLD_CONFIG,
  loadBackendWorldConfig,
  normalizeBackendWorldConfig,
  saveAdminWorldConfig,
} from '@three/world/backend-world-config.js'
import JsonTreeNode from '@ui-components/admin/JsonTreeNode.vue'
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue'

const configDraft = ref(structuredClone(DEFAULT_BACKEND_WORLD_CONFIG))
const statusText = ref('')
const statusType = ref('neutral')
const isApplying = ref(false)
const isSaving = ref(false)
const previewMode = ref('both')

const sectionOpen = reactive({
  player: true,
  world: true,
  environment: true,
  scene: true,
  pauseMenu: true,
  preview: true,
})

const navItems = [
  { id: 'player', label: 'Player' },
  { id: 'world', label: 'World' },
  { id: 'environment', label: 'Environment' },
  { id: 'scene', label: 'Scene' },
  { id: 'pause-menu', label: 'Pause Menu' },
  { id: 'preview', label: 'JSON Preview' },
]

const mainRef = ref(null)
const activeSection = ref('player')
const lastSavedSnapshot = ref('')

const cameraPresetOptions = ['off', 'default', 'cinematic', 'arcade']
const visualPresetOptions = ['off', 'default', 'cinematic', 'arcade']
const skyModeOptions = ['Image', 'HDR']

const normalizedDraft = computed(() => {
  return normalizeBackendWorldConfig(configDraft.value)
})

const previewJson = computed(() => {
  return JSON.stringify(normalizedDraft.value, null, 2)
})

const previewLines = computed(() => {
  return previewJson.value.split('\n')
})

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function highlightJsonLine(line) {
  const escaped = escapeHtml(line)
  const pattern = /("(?:\\u[a-fA-F\d]{4}|\\[^u]|[^\\"])*"\s*:?)|(\btrue\b|\bfalse\b)|(\bnull\b)|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)/g

  return escaped.replace(pattern, (match, stringToken, booleanToken, nullToken, numberToken) => {
    if (stringToken) {
      if (stringToken.endsWith(':')) {
        return `<span class="token-key">${stringToken.slice(0, -1)}</span><span class="token-punc">:</span>`
      }
      return `<span class="token-string">${stringToken}</span>`
    }
    if (booleanToken) {
      return `<span class="token-boolean">${booleanToken}</span>`
    }
    if (nullToken) {
      return `<span class="token-null">${nullToken}</span>`
    }
    if (numberToken) {
      return `<span class="token-number">${numberToken}</span>`
    }
    return match
  })
}

const normalizedSnapshot = computed(() => {
  return JSON.stringify(normalizedDraft.value)
})

const isDirty = computed(() => {
  return normalizedSnapshot.value !== lastSavedSnapshot.value
})

function setStatus(message, type = 'neutral') {
  statusText.value = message
  statusType.value = type
}

function markSaved(config) {
  configDraft.value = config
  lastSavedSnapshot.value = JSON.stringify(config)
}

async function loadCurrentConfig() {
  const loaded = await loadBackendWorldConfig()
  markSaved(loaded)
  setStatus('已读取当前生效配置', 'success')
}

function resetToDefaultTemplate() {
  configDraft.value = structuredClone(DEFAULT_BACKEND_WORLD_CONFIG)
  setStatus('已重置为默认模板（未保存）', 'warning')
}

async function saveConfig() {
  isSaving.value = true
  const saved = saveAdminWorldConfig(configDraft.value)
  markSaved(saved)
  setStatus('已保存到管理员本地配置', 'success')
  isSaving.value = false
}

async function applyConfig() {
  isApplying.value = true
  const saved = saveAdminWorldConfig(configDraft.value)
  markSaved(saved)
  emitter.emit('backend:config-updated', saved)
  setStatus('已保存并实时应用到场景', 'success')
  isApplying.value = false
}

async function clearLocalConfig() {
  clearAdminWorldConfig()
  await loadCurrentConfig()
  setStatus('已清空本地覆盖配置，回退到接口/默认值', 'warning')
}

function downloadConfig() {
  const blob = new Blob([previewJson.value], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'world-config.json'
  link.click()
  URL.revokeObjectURL(url)
  setStatus('已导出 world-config.json', 'neutral')
}

async function copyJson() {
  await navigator.clipboard.writeText(previewJson.value)
  setStatus('JSON 已复制到剪贴板', 'neutral')
}

function toggleSection(name) {
  sectionOpen[name] = !sectionOpen[name]
}

function scrollToSection(id) {
  const section = document.getElementById(id)
  if (!section || !mainRef.value)
    return

  activeSection.value = id
  section.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function updateActiveSectionByScroll() {
  if (!mainRef.value)
    return

  const mainRect = mainRef.value.getBoundingClientRect()
  let current = activeSection.value

  for (const item of navItems) {
    const section = document.getElementById(item.id)
    if (!section)
      continue

    const rect = section.getBoundingClientRect()
    if (rect.top - mainRect.top <= 140) {
      current = item.id
    }
  }

  activeSection.value = current
}

function handleBeforeUnload(event) {
  if (!isDirty.value)
    return

  event.preventDefault()
  event.returnValue = ''
}

onMounted(async () => {
  await loadCurrentConfig()
  await nextTick()

  if (mainRef.value) {
    mainRef.value.addEventListener('scroll', updateActiveSectionByScroll, { passive: true })
  }
  window.addEventListener('beforeunload', handleBeforeUnload)
})

onUnmounted(() => {
  if (mainRef.value) {
    mainRef.value.removeEventListener('scroll', updateActiveSectionByScroll)
  }
  window.removeEventListener('beforeunload', handleBeforeUnload)
})
</script>

<template>
  <div class="admin-page">
    <aside class="admin-sidebar">
      <div class="brand">
        <h1>Admin Console</h1>
        <p>World Admin Console</p>
      </div>

      <nav class="nav-group">
        <button
          v-for="item in navItems"
          :key="item.id"
          class="nav-btn"
          :class="{ active: activeSection === item.id }"
          @click="scrollToSection(item.id)"
        >
          {{ item.label }}
        </button>
      </nav>

      <a class="back-link" href="#">← 返回游戏</a>
    </aside>

    <main ref="mainRef" class="admin-main">
      <header class="main-header">
        <div>
          <h2>Site Settings</h2>
          <p>管理员配置页（仅内部使用）</p>
          <p class="dirty-tip" :class="{ dirty: isDirty }">
            {{ isDirty ? '存在未保存变更' : '所有变更已保存' }}
          </p>
        </div>
        <div class="header-actions">
          <button class="btn" @click="loadCurrentConfig">
            刷新
          </button>
          <button class="btn" @click="resetToDefaultTemplate">
            默认模板
          </button>
          <button class="btn" :disabled="isSaving" @click="saveConfig">
            {{ isSaving ? '保存中...' : '保存' }}
          </button>
          <button class="btn primary" :disabled="isApplying" @click="applyConfig">
            {{ isApplying ? '应用中...' : '保存并应用' }}
          </button>
        </div>
      </header>

      <p v-if="statusText" class="status-text" :class="statusType">
        {{ statusText }}
      </p>

      <section id="player" class="panel">
        <div class="panel-head">
          <h3>Player</h3>
          <button class="panel-toggle" @click="toggleSection('player')">
            {{ sectionOpen.player ? '收起' : '展开' }}
          </button>
        </div>
        <div v-if="sectionOpen.player" class="grid three">
          <label>
            Spawn X
            <input v-model.number="configDraft.player.spawnPoint.x" type="number">
          </label>
          <label>
            Spawn Y
            <input v-model.number="configDraft.player.spawnPoint.y" type="number">
          </label>
          <label>
            Spawn Z
            <input v-model.number="configDraft.player.spawnPoint.z" type="number">
          </label>
        </div>
      </section>

      <section id="world" class="panel">
        <div class="panel-head">
          <h3>World</h3>
          <button class="panel-toggle" @click="toggleSection('world')">
            {{ sectionOpen.world ? '收起' : '展开' }}
          </button>
        </div>

        <div v-if="sectionOpen.world" class="grid three">
          <label>
            Chunk Height (16-256)
            <input v-model.number="configDraft.settings.chunk.height" type="number" min="16" max="256">
          </label>
          <label>
            View Distance
            <input v-model.number="configDraft.settings.chunk.viewDistance" type="number" min="1" max="8">
          </label>
          <label>
            Unload Padding
            <input v-model.number="configDraft.settings.chunk.unloadPadding" type="number" min="0" max="8">
          </label>
        </div>

        <div v-if="sectionOpen.world" class="grid two">
          <label>
            Camera Preset
            <select v-model="configDraft.settings.cameraPreset">
              <option v-for="option in cameraPresetOptions" :key="option" :value="option">
                {{ option }}
              </option>
            </select>
          </label>
          <label>
            Visual Preset
            <select v-model="configDraft.settings.visualPreset">
              <option v-for="option in visualPresetOptions" :key="option" :value="option">
                {{ option }}
              </option>
            </select>
          </label>
        </div>
      </section>

      <section id="environment" class="panel">
        <div class="panel-head">
          <h3>Environment</h3>
          <button class="panel-toggle" @click="toggleSection('environment')">
            {{ sectionOpen.environment ? '收起' : '展开' }}
          </button>
        </div>

        <div v-if="sectionOpen.environment" class="grid four">
          <label>
            Sky Mode
            <select v-model="configDraft.settings.environment.skyMode">
              <option v-for="option in skyModeOptions" :key="option" :value="option">
                {{ option }}
              </option>
            </select>
          </label>
          <label>
            Sun Intensity
            <input v-model.number="configDraft.settings.environment.sunIntensity" type="number" step="0.1">
          </label>
          <label>
            Ambient Intensity
            <input v-model.number="configDraft.settings.environment.ambientIntensity" type="number" step="0.1">
          </label>
          <label>
            Fog Density
            <input v-model.number="configDraft.settings.environment.fogDensity" type="number" step="0.001">
          </label>
        </div>
      </section>

      <section id="scene" class="panel">
        <div class="panel-head">
          <h3>Scene Model</h3>
          <button class="panel-toggle" @click="toggleSection('scene')">
            {{ sectionOpen.scene ? '收起' : '展开' }}
          </button>
        </div>

        <div v-if="sectionOpen.scene" class="grid one">
          <label>
            Model URL
            <input v-model="configDraft.scene.modelUrl" type="text" placeholder="/models/xxx.glb">
          </label>
        </div>

        <div v-if="sectionOpen.scene" class="sub-grid">
          <div>
            <h4>Position</h4>
            <div class="grid three">
              <label>X <input v-model.number="configDraft.scene.position.x" type="number" step="0.1"></label>
              <label>Y <input v-model.number="configDraft.scene.position.y" type="number" step="0.1"></label>
              <label>Z <input v-model.number="configDraft.scene.position.z" type="number" step="0.1"></label>
            </div>
          </div>
          <div>
            <h4>Rotation</h4>
            <div class="grid three">
              <label>X <input v-model.number="configDraft.scene.rotation.x" type="number" step="0.01"></label>
              <label>Y <input v-model.number="configDraft.scene.rotation.y" type="number" step="0.01"></label>
              <label>Z <input v-model.number="configDraft.scene.rotation.z" type="number" step="0.01"></label>
            </div>
          </div>
          <div>
            <h4>Scale</h4>
            <div class="grid three">
              <label>X <input v-model.number="configDraft.scene.scale.x" type="number" step="0.1"></label>
              <label>Y <input v-model.number="configDraft.scene.scale.y" type="number" step="0.1"></label>
              <label>Z <input v-model.number="configDraft.scene.scale.z" type="number" step="0.1"></label>
            </div>
          </div>
        </div>

        <div v-if="sectionOpen.scene" class="toggle-row">
          <label><input v-model="configDraft.scene.castShadow" type="checkbox"> Cast Shadow</label>
          <label><input v-model="configDraft.scene.receiveShadow" type="checkbox"> Receive Shadow</label>
        </div>
      </section>

      <section id="pause-menu" class="panel">
        <div class="panel-head">
          <h3>Pause Menu</h3>
          <button class="panel-toggle" @click="toggleSection('pauseMenu')">
            {{ sectionOpen.pauseMenu ? '收起' : '展开' }}
          </button>
        </div>

        <div v-if="sectionOpen.pauseMenu" class="toggle-row">
          <label><input v-model="configDraft.ui.pauseMenu.showMainMenu" type="checkbox"> Show Main Menu</label>
          <label><input v-model="configDraft.ui.pauseMenu.showSettings" type="checkbox"> Show Settings</label>
          <label><input v-model="configDraft.ui.pauseMenu.showSkins" type="checkbox"> Show Skins</label>
        </div>
      </section>

      <section id="preview" class="panel">
        <div class="panel-head">
          <h3>JSON Preview</h3>
          <div class="panel-head-actions">
            <div class="view-switch">
              <button class="view-btn" :class="{ active: previewMode === 'code' }" @click="previewMode = 'code'">
                Code
              </button>
              <button class="view-btn" :class="{ active: previewMode === 'tree' }" @click="previewMode = 'tree'">
                Tree
              </button>
              <button class="view-btn" :class="{ active: previewMode === 'both' }" @click="previewMode = 'both'">
                Both
              </button>
            </div>
            <button class="panel-toggle" @click="toggleSection('preview')">
              {{ sectionOpen.preview ? '收起' : '展开' }}
            </button>
          </div>
        </div>

        <div v-if="sectionOpen.preview && (previewMode === 'code' || previewMode === 'both')" class="vscode-editor">
          <div class="editor-titlebar">
            <span class="dot red" />
            <span class="dot yellow" />
            <span class="dot green" />
            <span class="file-name">world-config.json</span>
          </div>
          <div class="editor-body">
            <div class="editor-gutter">
              <span v-for="(line, index) in previewLines" :key="`line-number-${index}`">{{ index + 1 }}</span>
            </div>
            <pre class="editor-code"><code><span v-for="(line, index) in previewLines" :key="`line-code-${index}`" v-html="highlightJsonLine(line)" />
</code></pre>
          </div>
        </div>

        <div v-if="sectionOpen.preview && (previewMode === 'tree' || previewMode === 'both')" class="vscode-editor tree-viewer">
          <div class="editor-titlebar">
            <span class="dot red" />
            <span class="dot yellow" />
            <span class="dot green" />
            <span class="file-name">world-config.tree</span>
          </div>
          <div class="tree-body">
            <JsonTreeNode node-key="root" :value="normalizedDraft" :depth="0" />
          </div>
        </div>

        <div v-if="sectionOpen.preview" class="header-actions">
          <button class="btn" @click="copyJson">
            复制 JSON
          </button>
          <button class="btn" @click="downloadConfig">
            导出 JSON
          </button>
          <button class="btn danger" @click="clearLocalConfig">
            清空本地配置
          </button>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.admin-page {
  width: 100vw;
  height: 100vh;
  position: fixed;
  inset: 0;
  background: #f4f6fb;
  color: #111827;
  display: flex;
  overflow: hidden;
  font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}

.admin-page * {
  font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}

.admin-sidebar {
  width: 240px;
  background: #0f172a;
  color: #cbd5e1;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  position: sticky;
  top: 0;
  height: 100vh;
  overflow-y: auto;
}

.brand h1 {
  margin: 0;
  color: #f8fafc;
  font-size: 18px;
}

.brand p {
  margin: 4px 0 0;
  color: #94a3b8;
  font-size: 13px;
}

.nav-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.nav-btn,
.back-link {
  border: none;
  background: transparent;
  text-align: left;
  color: #cbd5e1;
  text-decoration: none;
  font-size: 14px;
  cursor: pointer;
  padding: 6px 8px;
  border-radius: 8px;
}

.nav-btn.active {
  background: #1e293b;
  color: #fff;
}

.nav-btn:hover,
.back-link:hover {
  color: #fff;
}

.admin-main {
  flex: 1;
  min-height: 0;
  height: 100vh;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
}

.main-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  position: sticky;
  top: 0;
  z-index: 5;
  background: #f4f6fb;
  border-bottom: 1px solid #e2e8f0;
  padding-bottom: 12px;
}

.main-header h2 {
  margin: 0;
  font-size: 26px;
}

.main-header p {
  margin: 6px 0 0;
  color: #475569;
}

.dirty-tip {
  margin: 8px 0 0;
  color: #0f766e;
  font-size: 13px;
}

.dirty-tip.dirty {
  color: #b45309;
}

.header-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.btn {
  border: 1px solid #cbd5e1;
  background: #fff;
  color: #0f172a;
  padding: 7px 12px;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn.primary {
  background: #2563eb;
  color: #fff;
  border-color: #2563eb;
}

.btn.danger {
  background: #dc2626;
  color: #fff;
  border-color: #dc2626;
}

.status-text {
  margin: 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: #e2e8f0;
  color: #0f172a;
}

.status-text.success {
  background: #dcfce7;
  color: #166534;
}

.status-text.warning {
  background: #fef3c7;
  color: #92400e;
}

.status-text.neutral {
  background: #e2e8f0;
  color: #0f172a;
}

.panel {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.panel-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.panel-head-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.panel h3 {
  margin: 0;
  font-size: 18px;
}

.panel h4 {
  margin: 0 0 8px;
  color: #334155;
}

.panel-toggle {
  border: 1px solid #cbd5e1;
  background: #f8fafc;
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 12px;
  color: #1e293b;
  cursor: pointer;
}

.view-switch {
  display: inline-flex;
  background: #f1f5f9;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  overflow: hidden;
}

.view-btn {
  border: none;
  background: transparent;
  color: #334155;
  font-size: 12px;
  padding: 6px 10px;
  cursor: pointer;
}

.view-btn.active {
  background: #2563eb;
  color: #fff;
}

.grid {
  display: grid;
  gap: 10px;
}

.grid.one {
  grid-template-columns: 1fr;
}

.grid.two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.grid.three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.grid.four {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.sub-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: #334155;
}

input,
select {
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 14px;
  background: #fff;
  color: #0f172a;
}

.toggle-row {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}

.toggle-row label {
  flex-direction: row;
  align-items: center;
}

.vscode-editor {
  border: 1px solid #1f2937;
  border-radius: 10px;
  overflow: hidden;
  background: #1e1e1e;
}

.editor-titlebar {
  height: 34px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  background: #2d2d30;
  border-bottom: 1px solid #3e3e42;
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
}

.dot.red {
  background: #ff5f56;
}

.dot.yellow {
  background: #ffbd2e;
}

.dot.green {
  background: #27c93f;
}

.file-name {
  margin-left: 8px;
  font-size: 12px;
  color: #c5c5c5;
}

.editor-body {
  display: grid;
  grid-template-columns: auto 1fr;
  max-height: 360px;
  overflow: auto;
}

.editor-gutter {
  display: flex;
  flex-direction: column;
  background: #252526;
  border-right: 1px solid #3e3e42;
  color: #6b7280;
  font-size: 12px;
  line-height: 1.5;
  padding: 10px 10px 10px 12px;
  user-select: none;
  text-align: right;
}

.editor-code {
  margin: 0;
  padding: 10px 12px;
  color: #d4d4d4;
  font-size: 12px;
  line-height: 1.5;
  background: #1e1e1e;
}

.editor-code code {
  font-family: Consolas, 'Courier New', monospace;
  white-space: pre;
}

.tree-viewer {
  margin-top: 10px;
}

.tree-body {
  max-height: 360px;
  overflow: auto;
  padding: 12px;
  background: #1e1e1e;
}

.editor-code :deep(.token-key) {
  color: #9cdcfe;
}

.editor-code :deep(.token-string) {
  color: #ce9178;
}

.editor-code :deep(.token-number) {
  color: #b5cea8;
}

.editor-code :deep(.token-boolean) {
  color: #569cd6;
}

.editor-code :deep(.token-null) {
  color: #569cd6;
}

.editor-code :deep(.token-punc) {
  color: #d4d4d4;
}

@media (max-width: 1200px) {
  .grid.four {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .sub-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 900px) {
  .admin-page {
    flex-direction: column;
    overflow-y: auto;
  }

  .admin-sidebar {
    width: 100%;
    height: auto;
    position: static;
    overflow: visible;
  }

  .grid.three,
  .grid.two {
    grid-template-columns: 1fr;
  }

  .admin-main {
    height: auto;
    min-height: auto;
    overflow: visible;
  }

  .main-header {
    position: static;
  }
}
</style>
