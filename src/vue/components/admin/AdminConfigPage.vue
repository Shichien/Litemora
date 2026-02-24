<script setup>
import emitter from '@three/utils/event/event-bus.js'

import {
  clearAdminWorldConfig,
  DEFAULT_BACKEND_WORLD_CONFIG,
  loadBackendWorldConfig,
  normalizeBackendWorldConfig,
  saveAdminWorldConfig,
} from '@three/world/backend-world-config.js'
import schematicService from '@three/world/terrain/schematic-service.js'
import JsonTreeNode from '@ui-components/admin/JsonTreeNode.vue'

import { computed, onMounted, ref } from 'vue'

const ADMIN_PASSWORD = 'admin123'

const isAuthenticated = ref(false)
const passwordInput = ref('')
const authError = ref('')
const configDraft = ref(structuredClone(DEFAULT_BACKEND_WORLD_CONFIG))
const statusText = ref('')
const statusType = ref('neutral')
const isApplying = ref(false)
const isSaving = ref(false)
const previewMode = ref('code')

// 原理图导入状态
const schematicFile = ref(null)
const schematicPreview = ref(null)
const isParsingSchematic = ref(false)
const schematicOffsetX = ref(0)
const schematicOffsetY = ref(0)
const schematicOffsetZ = ref(0)

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

const normalizedSnapshot = computed(() => {
  return JSON.stringify(normalizedDraft.value)
})

const lastSavedSnapshot = ref('')

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
        return `<span class=\"token-key\">${stringToken.slice(0, -1)}</span><span class=\"token-punc\">:</span>`
      }
      return `<span class=\"token-string\">${stringToken}</span>`
    }
    if (booleanToken) {
      return `<span class=\"token-boolean\">${booleanToken}</span>`
    }
    if (nullToken) {
      return `<span class=\"token-null\">${nullToken}</span>`
    }
    if (numberToken) {
      return `<span class=\"token-number\">${numberToken}</span>`
    }
    return match
  })
}

function backToGame() {
  window.location.hash = ''
}

function handleAuth() {
  if (passwordInput.value === ADMIN_PASSWORD) {
    isAuthenticated.value = true
    authError.value = ''
    passwordInput.value = ''
  }
  else {
    authError.value = '密码错误'
    passwordInput.value = ''
  }
}

function logout() {
  isAuthenticated.value = false
  passwordInput.value = ''
  authError.value = ''
  backToGame()
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
  setStatus('已保存并应用（不再强制传送玩家）', 'success')
  isApplying.value = false
}

async function clearLocalConfig() {
  clearAdminWorldConfig()
  await loadCurrentConfig()
  setStatus('已清空本地覆盖配置，回退到接口/默认值', 'warning')
}

async function copyJson() {
  await navigator.clipboard.writeText(previewJson.value)
  setStatus('JSON 已复制到剪贴板', 'neutral')
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

async function handleSchematicFileSelect(event) {
  const file = event.target.files?.[0]
  if (!file) {
    return
  }

  if (!file.name.endsWith('.litematic')) {
    setStatus('请选择 .litematic 文件', 'warning')
    return
  }

  isParsingSchematic.value = true
  try {
    const schematic = await schematicService.parseFile(file)
    schematicFile.value = file.name
    schematicPreview.value = schematicService.getPreview()
    setStatus(`已加载原理图: ${schematic.name} (${schematicPreview.value.blockCount} 方块)`, 'success')
  }
  catch (error) {
    schematicPreview.value = null
    setStatus(`解析失败: ${error.message}`, 'warning')
  }
  finally {
    isParsingSchematic.value = false
  }
}

function clearSchematicFile() {
  schematicFile.value = null
  schematicPreview.value = null
  schematicOffsetX.value = 0
  schematicOffsetY.value = 0
  schematicOffsetZ.value = 0
  setStatus('已清除原理图', 'neutral')
}

async function applySchematic() {
  if (!schematicPreview.value) {
    setStatus('未装载原理图', 'warning')
    return
  }

  isApplying.value = true
  try {
    // TODO: 实现世界集成
    // const result = await schematicService.applyToWorld(
    //   world,
    //   schematicOffsetX.value,
    //   schematicOffsetY.value,
    //   schematicOffsetZ.value
    // )
    setStatus('原理图应用已触发（功能待实现世界集成）', 'warning')
  }
  catch (error) {
    setStatus(`应用失败: ${error.message}`, 'warning')
  }
  finally {
    isApplying.value = false
  }
}

onMounted(async () => {
  await loadCurrentConfig()
})
</script>

<template>
  <div class="admin-overlay" @click.self="backToGame">
    <!-- 认证守卫 -->
    <div v-if="!isAuthenticated" class="auth-modal">
      <div class="auth-container">
        <h2>管理后台</h2>
        <p>世界设置 - 需要密码访问</p>
        <input
          v-model="passwordInput"
          type="password"
          autofocus
          placeholder="输入管理员密码"
          @keydown.enter="handleAuth"
        >
        <p v-if="authError" class="error">
          {{ authError }}
        </p>
        <div class="auth-actions">
          <button class="btn primary" @click="handleAuth">
            进入
          </button>
          <button class="btn ghost" @click="backToGame">
            返回
          </button>
        </div>
      </div>
    </div>

    <!-- 管理后台界面 -->
    <div v-else class="admin-shell">
      <header class="admin-header">
        <div>
          <h2>管理后台 · 世界设置</h2>
          <p class="subtitle">
            仅管理员可见，普通玩家不开放
          </p>
        </div>
        <div class="header-right">
          <span class="dirty" :class="{ active: isDirty }">{{ isDirty ? '未保存' : '已保存' }}</span>
          <button class="btn ghost" @click="logout">
            登出
          </button>
          <button class="btn ghost" @click="backToGame">
            返回游戏
          </button>
        </div>
      </header>

      <div v-if="statusText" class="status" :class="statusType">
        {{ statusText }}
      </div>

      <div class="toolbar">
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

      <div class="settings-panel">
        <section class="setting-section">
          <h3>玩家设置</h3>
          <div class="setting-row grid-three">
            <label>Spawn X <input v-model.number="configDraft.player.spawnPoint.x" type="number"></label>
            <label>Spawn Y <input v-model.number="configDraft.player.spawnPoint.y" type="number"></label>
            <label>Spawn Z <input v-model.number="configDraft.player.spawnPoint.z" type="number"></label>
          </div>
        </section>

        <section class="setting-section">
          <h3>世界设置</h3>
          <div class="setting-row grid-three">
            <label>高度上限(16-256) <input v-model.number="configDraft.settings.chunk.height" min="16" max="256" type="number"></label>
            <label>视距 <input v-model.number="configDraft.settings.chunk.viewDistance" min="1" max="8" type="number"></label>
            <label>卸载缓冲 <input v-model.number="configDraft.settings.chunk.unloadPadding" min="0" max="8" type="number"></label>
          </div>
          <div class="setting-row">
            <span class="row-label">相机风格</span>
            <div class="option-group">
              <button
                v-for="option in cameraPresetOptions"
                :key="`camera-${option}`"
                class="option-btn"
                :class="{ active: configDraft.settings.cameraPreset === option }"
                @click="configDraft.settings.cameraPreset = option"
              >
                {{ option }}
              </button>
            </div>
          </div>
          <div class="setting-row">
            <span class="row-label">速度线</span>
            <div class="option-group">
              <button
                v-for="option in visualPresetOptions"
                :key="`visual-${option}`"
                class="option-btn"
                :class="{ active: configDraft.settings.visualPreset === option }"
                @click="configDraft.settings.visualPreset = option"
              >
                {{ option }}
              </button>
            </div>
          </div>
        </section>

        <section class="setting-section">
          <h3>环境设置</h3>
          <div class="setting-row">
            <span class="row-label">天空</span>
            <div class="option-group">
              <button
                v-for="option in skyModeOptions"
                :key="`sky-${option}`"
                class="option-btn"
                :class="{ active: configDraft.settings.environment.skyMode === option }"
                @click="configDraft.settings.environment.skyMode = option"
              >
                {{ option }}
              </button>
            </div>
          </div>
          <div class="setting-row grid-three">
            <label>阳光强度 <input v-model.number="configDraft.settings.environment.sunIntensity" step="0.1" type="number"></label>
            <label>环境光 <input v-model.number="configDraft.settings.environment.ambientIntensity" step="0.1" type="number"></label>
            <label>雾浓度 <input v-model.number="configDraft.settings.environment.fogDensity" step="0.001" type="number"></label>
          </div>
        </section>

        <section class="setting-section">
          <h3>场景模型</h3>
          <div class="setting-row">
            <label class="full">模型 URL <input v-model="configDraft.scene.modelUrl" placeholder="/models/xxx.glb" type="text"></label>
          </div>
          <div class="setting-row grid-three">
            <label>位置 X <input v-model.number="configDraft.scene.position.x" step="0.1" type="number"></label>
            <label>位置 Y <input v-model.number="configDraft.scene.position.y" step="0.1" type="number"></label>
            <label>位置 Z <input v-model.number="configDraft.scene.position.z" step="0.1" type="number"></label>
          </div>
          <div class="setting-row grid-three">
            <label>旋转 X <input v-model.number="configDraft.scene.rotation.x" step="0.01" type="number"></label>
            <label>旋转 Y <input v-model.number="configDraft.scene.rotation.y" step="0.01" type="number"></label>
            <label>旋转 Z <input v-model.number="configDraft.scene.rotation.z" step="0.01" type="number"></label>
          </div>
          <div class="setting-row grid-three">
            <label>缩放 X <input v-model.number="configDraft.scene.scale.x" step="0.1" type="number"></label>
            <label>缩放 Y <input v-model.number="configDraft.scene.scale.y" step="0.1" type="number"></label>
            <label>缩放 Z <input v-model.number="configDraft.scene.scale.z" step="0.1" type="number"></label>
          </div>
          <div class="setting-row toggles">
            <label><input v-model="configDraft.scene.castShadow" type="checkbox">投射阴影</label>
            <label><input v-model="configDraft.scene.receiveShadow" type="checkbox">接收阴影</label>
          </div>
        </section>

        <section class="setting-section">
          <h3>暂停菜单</h3>
          <div class="setting-row toggles">
            <label><input v-model="configDraft.ui.pauseMenu.showMainMenu" type="checkbox">显示主菜单按钮</label>
            <label><input v-model="configDraft.ui.pauseMenu.showSettings" type="checkbox">显示设置按钮</label>
            <label><input v-model="configDraft.ui.pauseMenu.showSkins" type="checkbox">显示皮肤按钮</label>
          </div>
        </section>

        <section class="setting-section">
          <h3>导入原理图</h3>
          <div class="setting-row">
            <span class="row-label">选择 .litematic 文件</span>
            <input
              type="file"
              accept=".litematic"
              @change="handleSchematicFileSelect"
            >
          </div>

          <div v-if="schematicFile" class="schematic-preview">
            <div class="preview-info">
              <div>
                <strong>文件:</strong> {{ schematicFile }}
              </div>
              <div v-if="schematicPreview">
                <strong>名称:</strong> {{ schematicPreview.name }}
              </div>
              <div v-if="schematicPreview">
                <strong>作者:</strong> {{ schematicPreview.author }}
              </div>
              <div v-if="schematicPreview">
                <strong>大小:</strong> {{ schematicPreview.size.x }} × {{ schematicPreview.size.y }} × {{ schematicPreview.size.z }}
              </div>
              <div v-if="schematicPreview">
                <strong>方块数:</strong> {{ schematicPreview.blockCount }}
              </div>
            </div>

            <div class="setting-row grid-three">
              <label>偏移 X <input v-model.number="schematicOffsetX" type="number"></label>
              <label>偏移 Y <input v-model.number="schematicOffsetY" type="number"></label>
              <label>偏移 Z <input v-model.number="schematicOffsetZ" type="number"></label>
            </div>

            <div class="preview-actions-right" style="margin-top: 12px;">
              <button class="btn primary" :disabled="isApplying" @click="applySchematic">
                {{ isApplying ? '应用中...' : '应用原理图' }}
              </button>
              <button class="btn ghost" @click="clearSchematicFile">
                清除
              </button>
            </div>
          </div>
        </section>

        <section class="setting-section">
          <h3>JSON Preview</h3>
          <div class="preview-actions">
            <div class="option-group small">
              <button class="option-btn" :class="{ active: previewMode === 'code' }" @click="previewMode = 'code'">
                Code
              </button>
              <button class="option-btn" :class="{ active: previewMode === 'tree' }" @click="previewMode = 'tree'">
                Tree
              </button>
              <button class="option-btn" :class="{ active: previewMode === 'both' }" @click="previewMode = 'both'">
                Both
              </button>
            </div>
            <div class="preview-actions-right">
              <button class="btn" @click="copyJson">
                复制 JSON
              </button>
              <button class="btn" @click="downloadConfig">
                导出 JSON
              </button>
              <button class="btn danger" @click="clearLocalConfig">
                清空覆盖
              </button>
            </div>
          </div>

          <div v-if="previewMode === 'code' || previewMode === 'both'" class="vscode-editor">
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
+</code></pre>
            </div>
          </div>

          <div v-if="previewMode === 'tree' || previewMode === 'both'" class="vscode-editor tree-viewer">
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
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.admin-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  z-index: 300;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 20px;
  font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}

.admin-overlay * {
  font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}

.auth-modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.8);
  backdrop-filter: blur(4px);
  z-index: 320;
  display: flex;
  justify-content: center;
  align-items: center;
}

.auth-container {
  background: rgba(18, 20, 24, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.14);
  box-shadow: 0 20px 80px rgba(0, 0, 0, 0.6);
  border-radius: 12px;
  padding: 32px;
  width: min(380px, 90vw);
  text-align: center;
  color: #e5e7eb;
}

.auth-container h2 {
  margin: 0 0 8px;
  font-size: 22px;
  font-weight: 600;
}

.auth-container p {
  margin: 0 0 24px;
  font-size: 13px;
  color: #cbd5e1;
}

.auth-container input {
  width: 100%;
  border: 1px solid rgba(255, 255, 255, 0.24);
  background: rgba(255, 255, 255, 0.06);
  color: #f8fafc;
  border-radius: 6px;
  padding: 10px 12px;
  font-size: 14px;
  margin-bottom: 12px;
}

.auth-container input::placeholder {
  color: #94a3b8;
}

.auth-container input:focus {
  outline: none;
  border-color: #5ecb95;
}

.error {
  color: #fca5a5;
  font-size: 12px;
  margin-bottom: 12px;
}

.auth-actions {
  display: flex;
  gap: 8px;
}

.auth-actions .btn {
  flex: 1;
}

.admin-shell {
  width: min(1080px, 96vw);
  max-height: calc(100vh - 40px);
  background: rgba(18, 20, 24, 0.86);
  border: 1px solid rgba(255, 255, 255, 0.14);
  box-shadow: 0 12px 60px rgba(0, 0, 0, 0.55);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  color: #e5e7eb;
  overflow: hidden;
}

.admin-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}

.admin-header h2 {
  margin: 0;
  font-size: 24px;
}

.subtitle {
  margin: 6px 0 0;
  font-size: 13px;
  color: #cbd5e1;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.dirty {
  font-size: 12px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  padding: 4px 8px;
  border-radius: 999px;
  color: #bbf7d0;
}

.dirty.active {
  color: #fbbf24;
}

.status {
  margin: 10px 18px 0;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 13px;
}

.status.success {
  background: rgba(16, 185, 129, 0.2);
  color: #bbf7d0;
}

.status.warning {
  background: rgba(245, 158, 11, 0.2);
  color: #fde68a;
}

.status.neutral {
  background: rgba(148, 163, 184, 0.2);
  color: #e2e8f0;
}

.toolbar {
  margin: 12px 18px 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.btn {
  border: 1px solid rgba(255, 255, 255, 0.24);
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  padding: 6px 12px;
  font-size: 13px;
  border-radius: 6px;
  cursor: pointer;
}

.btn:hover {
  background: rgba(255, 255, 255, 0.14);
}

.btn.primary {
  background: #5ecb95;
  border-color: #5ecb95;
  color: #092012;
}

.btn.primary:hover {
  background: #4fba86;
}

.btn.danger {
  background: rgba(220, 38, 38, 0.3);
  border-color: rgba(220, 38, 38, 0.65);
  color: #fecaca;
}

.btn.ghost {
  background: transparent;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.settings-panel {
  margin: 12px 18px 18px;
  overflow: auto;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding-top: 8px;
}

.setting-section {
  padding: 14px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}

.setting-section h3 {
  margin: 0 0 12px;
  font-size: 30px;
  font-weight: 700;
  color: #e2e8f0;
}

.setting-row {
  display: flex;
  gap: 10px;
  margin-bottom: 10px;
  align-items: center;
}

.setting-row:last-child {
  margin-bottom: 0;
}

.grid-three {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.full {
  width: 100%;
}

label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: #cbd5e1;
}

input,
select {
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.06);
  color: #f8fafc;
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 13px;
}

input::placeholder {
  color: #94a3b8;
}

.row-label {
  width: 110px;
  color: #e2e8f0;
  font-size: 14px;
  flex-shrink: 0;
}

.option-group {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.option-group.small .option-btn {
  padding: 5px 10px;
  font-size: 12px;
}

.option-btn {
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.08);
  color: #d1d5db;
  padding: 7px 14px;
  border-radius: 2px;
  font-size: 26px;
  cursor: pointer;
}

.option-btn.active {
  background: #5ecb95;
  border-color: #5ecb95;
  color: #082113;
}

.toggles {
  display: flex;
  flex-wrap: wrap;
}

.toggles label {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  margin-right: 16px;
}

.preview-actions {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 10px;
}

.preview-actions-right {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
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
  max-height: 320px;
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

.tree-viewer {
  margin-top: 10px;
}

.tree-body {
  max-height: 320px;
  overflow: auto;
  padding: 12px;
  background: #1e1e1e;
}

@media (max-width: 980px) {
  .admin-shell {
    width: 100%;
    max-height: 100vh;
    border-radius: 0;
  }

  .grid-three {
    grid-template-columns: 1fr;
  }

  .preview-actions {
    flex-direction: column;
  }
}

.schematic-preview {
  border: 1px solid rgba(94, 203, 149, 0.3);
  border-radius: 8px;
  padding: 12px;
  background: rgba(94, 203, 149, 0.05);
  margin-top: 12px;
}

.preview-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
  font-size: 13px;
  color: #cbd5e1;
}

.preview-info div {
  padding: 4px 0;
}

.preview-info strong {
  color: #5ecb95;
}

input[type='file'] {
  display: block;
  width: 100%;
  padding: 8px;
  border: 1px solid rgba(255, 255, 255, 0.24);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.06);
  color: #e5e7eb;
  font-size: 13px;
  cursor: pointer;
}

input[type='file']::file-selector-button {
  background: #1f2937;
  border: none;
  color: #e5e7eb;
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
  margin-right: 8px;
  font-size: 12px;
}

input[type='file']::file-selector-button:hover {
  background: #374151;
}
</style>
