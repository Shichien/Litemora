<script setup>
import { useSettingsStore } from '@pinia/settingsStore.js'
import {
  buildWorldGenParams,
  DEFAULT_WORLDGEN_DRAFT,
  WORLDGEN_PRESET_IDS,
  WORLDGEN_PRESETS,
} from '@three/config/worldgen-presets.js'
import emitter from '@three/utils/event/event-bus.js'

import {
  clearAdminWorldConfig,
  DEFAULT_BACKEND_WORLD_CONFIG,
  loadBackendWorldConfig,
  normalizeBackendWorldConfig,
  saveAdminWorldConfig,
} from '@three/world/backend-world-config.js'
import schematicService from '@three/world/terrain/schematic-service.js'
import SchematicPreviewCanvas from '@ui-components/admin/SchematicPreviewCanvas.vue'

import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'

const ADMIN_PASSWORD = 'admin123'
const SEED_MAX = 2_000_000_000
const SEED_REGEX = /^\d+$/

const settingsStore = useSettingsStore()

const isAuthenticated = ref(false)
const passwordInput = ref('')
const authError = ref('')
const configDraft = ref(structuredClone(DEFAULT_BACKEND_WORLD_CONFIG))
const statusText = ref('')
const statusType = ref('neutral')
const isApplying = ref(false)
const isSaving = ref(false)

// 原理图导入状态
const schematicFile = ref(null)
const schematicPreview = ref(null)
const schematicModelData = ref(null)
const isParsingSchematic = ref(false)
const isBuildingSchematicPreview = ref(false)
const schematicOffsetX = ref(0)
const schematicOffsetY = ref(0)
const schematicOffsetZ = ref(0)
const schematicApplyProgress = ref(null)
const schematicImportLogs = ref([])

const worldGenSeedDraft = ref('')
const worldGenSeedError = ref('')
const isApplyingWorldGen = ref(false)
const adminWorldGenDraft = reactive({
  presetId: DEFAULT_WORLDGEN_DRAFT.presetId,
  magnitude: DEFAULT_WORLDGEN_DRAFT.magnitude,
  treeMinHeight: DEFAULT_WORLDGEN_DRAFT.treeMinHeight,
  treeMaxHeight: DEFAULT_WORLDGEN_DRAFT.treeMaxHeight,
  viewDistance: 2,
})

const cameraPresetOptions = ['off', 'default', 'cinematic', 'arcade']
const visualPresetOptions = ['off', 'default', 'cinematic', 'arcade']
const skyModeOptions = ['DayCycle', 'HDR']

const normalizedDraft = computed(() => {
  return normalizeBackendWorldConfig(configDraft.value)
})

const normalizedSnapshot = computed(() => {
  return JSON.stringify(normalizedDraft.value)
})

const lastSavedSnapshot = ref('')

const isDirty = computed(() => {
  return normalizedSnapshot.value !== lastSavedSnapshot.value
})

const schematicYStats = computed(() => {
  return schematicPreview.value?.yStats || null
})

const schematicProgressPercent = computed(() => {
  if (!schematicApplyProgress.value) {
    return 0
  }
  return Math.round((schematicApplyProgress.value.progress || 0) * 100)
})

const schematicProgressLabel = computed(() => {
  const phase = schematicApplyProgress.value?.phase
  if (!phase) {
    return ''
  }

  const labelMap = {
    'prepare': '准备中',
    'clearing-world': '清空世界',
    'placing-blocks': '写入方块',
    'rebuilding-chunks': '重建区块网格',
    'done': '完成',
  }

  return labelMap[phase] || phase
})

function onSchematicApplyProgress(payload) {
  schematicApplyProgress.value = payload
}

function setStatus(message, type = 'neutral') {
  statusText.value = message
  statusType.value = type
}

function markSaved(config) {
  configDraft.value = config
  lastSavedSnapshot.value = JSON.stringify(config)
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
  setStatus('已保存并应用', 'success')
  isApplying.value = false
}

async function clearLocalConfig() {
  clearAdminWorldConfig()
  await loadCurrentConfig()
  setStatus('已清空本地配置，回退到默认值', 'warning')
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
    isBuildingSchematicPreview.value = true
    schematicModelData.value = schematicService.buildPreviewModel({ maxBlocks: 30000 })
    const yInfo = schematicPreview.value?.yStats
    if (yInfo?.hasBlocksBelowZero) {
      setStatus(
        `已加载原理图: ${schematic.name} (${schematicPreview.value.blockCount} 方块)，检测到 Y<0 方块 ${yInfo.blocksBelowZero}`,
        'warning',
      )
    }
    else {
      setStatus(`已加载原理图: ${schematic.name} (${schematicPreview.value.blockCount} 方块)`, 'success')
    }
  }
  catch (error) {
    schematicPreview.value = null
    schematicModelData.value = null
    setStatus(`解析失败: ${error.message}`, 'warning')
  }
  finally {
    isBuildingSchematicPreview.value = false
    isParsingSchematic.value = false
  }
}

function clearSchematicFile() {
  schematicFile.value = null
  schematicPreview.value = null
  schematicModelData.value = null
  schematicOffsetX.value = 0
  schematicOffsetY.value = 0
  schematicOffsetZ.value = 0
  setStatus('已清除原理图', 'neutral')
}

function appendSchematicImportLog(entry) {
  const logEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    ...entry,
  }
  schematicImportLogs.value.unshift(logEntry)
  if (schematicImportLogs.value.length > 30) {
    schematicImportLogs.value.length = 30
  }
}

function clearSchematicImportLogs() {
  schematicImportLogs.value = []
}

async function applySchematic() {
  if (!schematicPreview.value) {
    setStatus('未装载原理图', 'warning')
    return
  }

  isApplying.value = true
  schematicApplyProgress.value = {
    phase: 'prepare',
    progress: 0,
    processedBlocks: 0,
    totalBlocks: schematicPreview.value?.blockCount || 0,
  }
  try {
    const offset = {
      x: Number(schematicOffsetX.value) || 0,
      y: Number(schematicOffsetY.value) || 0,
      z: Number(schematicOffsetZ.value) || 0,
    }

    const resultPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('原理图应用超时，请重试'))
      }, 120000)

      emitter.once('schematic:apply-result', (payload) => {
        clearTimeout(timeout)
        resolve(payload)
      })
    })

    emitter.emit('schematic:apply-request', {
      offset,
      options: {
        replaceWorld: true,
        persistModifications: true,
        keepSchematicOnlyMode: true,
      },
    })

    const payload = await resultPromise
    if (!payload?.ok) {
      throw new Error(payload?.error || '原理图应用失败')
    }

    const result = payload.result
    const shapeUsage = result?.importDiagnostics?.shapeUsage || { stairs: 0, slabs: 0, walls: 0 }
    const topTextures = result?.importDiagnostics?.topTextures || []
    const minPlacedY = (schematicPreview.value?.yStats?.minY ?? 0) + offset.y
    if (minPlacedY < 0) {
      setStatus(
        `应用完成：放置 ${result.placed}，替换 ${result.replaced}，楼梯 ${shapeUsage.stairs}，台阶 ${shapeUsage.slabs}，墙 ${shapeUsage.walls}，跳过 ${result.skipped}（其中越界 ${result.skippedOutOfHeight || 0}），注意最小Y=${minPlacedY} 低于 0`,
        'warning',
      )
      appendSchematicImportLog({
        level: 'warning',
        summary: `导入完成（Y 越界警告）: 楼梯 ${shapeUsage.stairs} / 台阶 ${shapeUsage.slabs} / 墙 ${shapeUsage.walls}`,
        details: {
          placed: result.placed,
          replaced: result.replaced,
          skipped: result.skipped,
          skippedOutOfHeight: result.skippedOutOfHeight || 0,
          touchedChunks: result.touchedChunks,
          topTextures,
        },
      })
      return
    }

    setStatus(
      `应用完成：放置 ${result.placed}，替换 ${result.replaced}，楼梯 ${shapeUsage.stairs}，台阶 ${shapeUsage.slabs}，墙 ${shapeUsage.walls}，跳过 ${result.skipped}，清空区块 ${result.worldClearedChunks || 0}，涉及 ${result.touchedChunks} 个区块`,
      'success',
    )
    appendSchematicImportLog({
      level: 'success',
      summary: `导入完成: 楼梯 ${shapeUsage.stairs} / 台阶 ${shapeUsage.slabs} / 墙 ${shapeUsage.walls}`,
      details: {
        placed: result.placed,
        replaced: result.replaced,
        skipped: result.skipped,
        touchedChunks: result.touchedChunks,
        topTextures,
      },
    })
  }
  catch (error) {
    setStatus(`应用失败: ${error.message}`, 'warning')
    appendSchematicImportLog({
      level: 'error',
      summary: `导入失败: ${error.message}`,
      details: null,
    })
  }
  finally {
    isApplying.value = false
    if (schematicApplyProgress.value) {
      schematicApplyProgress.value = {
        ...schematicApplyProgress.value,
        phase: 'done',
        progress: 1,
      }
    }

    setTimeout(() => {
      if (!isApplying.value) {
        schematicApplyProgress.value = null
      }
    }, 1200)
  }
}

function setWorldGenSeedDraft(value) {
  worldGenSeedDraft.value = value
  if (value.trim() !== '' && !SEED_REGEX.test(value.trim())) {
    worldGenSeedError.value = 'Seed must be numeric only'
  }
  else {
    worldGenSeedError.value = ''
  }
}

function randomizeWorldGenSeed() {
  const randomSeed = Math.floor(Math.random() * SEED_MAX)
  worldGenSeedDraft.value = String(randomSeed)
  worldGenSeedError.value = ''
}

function getOrCreateWorldGenSeed() {
  const trimmed = worldGenSeedDraft.value.trim()
  if (trimmed === '') {
    return Math.floor(Math.random() * SEED_MAX)
  }
  return Number.parseInt(trimmed, 10)
}

function applyWorldGenPresetInAdmin(presetId) {
  const preset = WORLDGEN_PRESETS[presetId]
  if (!preset) {
    return
  }

  adminWorldGenDraft.presetId = presetId
  adminWorldGenDraft.magnitude = preset.terrain.magnitude
  adminWorldGenDraft.treeMinHeight = preset.trees.minHeight
  adminWorldGenDraft.treeMaxHeight = preset.trees.maxHeight
}

async function applyAdminWorldGen() {
  if (worldGenSeedDraft.value.trim() !== '' && !SEED_REGEX.test(worldGenSeedDraft.value.trim())) {
    worldGenSeedError.value = 'Seed must be numeric only'
    setStatus('Seed 只能输入数字', 'warning')
    return
  }

  isApplyingWorldGen.value = true
  try {
    const seed = getOrCreateWorldGenSeed()
    const { terrain, trees } = buildWorldGenParams(adminWorldGenDraft.presetId, {
      magnitude: adminWorldGenDraft.magnitude,
      treeMinHeight: adminWorldGenDraft.treeMinHeight,
      treeMaxHeight: adminWorldGenDraft.treeMaxHeight,
    })

    settingsStore.setChunkViewDistance(adminWorldGenDraft.viewDistance)
    emitter.emit('game:reset_world', { seed, terrain, trees })

    setStatus(
      `已应用世界生成：Seed ${seed}，类型 ${WORLDGEN_PRESETS[adminWorldGenDraft.presetId]?.name || 'Default'}`,
      'success',
    )
  }
  catch (error) {
    setStatus(`应用世界生成失败: ${error?.message || 'Unknown error'}`, 'warning')
  }
  finally {
    isApplyingWorldGen.value = false
  }
}

onMounted(async () => {
  emitter.on('schematic:apply-progress', onSchematicApplyProgress)
  await loadCurrentConfig()
  adminWorldGenDraft.viewDistance = Number(settingsStore.chunkViewDistance) || 2
})

onBeforeUnmount(() => {
  emitter.off('schematic:apply-progress', onSchematicApplyProgress)
})
</script>

<template>
  <div class="admin-overlay">
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
        <button class="btn danger" @click="clearLocalConfig">
          清空覆盖
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
          <div class="setting-row toggles">
            <label><input v-model="configDraft.player.flight.ignoreMiningSlowdown" type="checkbox">飞行时忽略挖掘减速</label>
            <label><input v-model="configDraft.player.flight.groundWalkAnimationWhenMoving" type="checkbox">飞行移动模拟地面行走动画</label>
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
              <div v-if="schematicYStats">
                <strong>Y 范围:</strong> {{ schematicYStats.minY ?? '-' }} ~ {{ schematicYStats.maxY ?? '-' }}
              </div>
              <div v-if="schematicYStats?.hasBlocksBelowZero">
                <strong>Y &lt; 0 方块:</strong> {{ schematicYStats.blocksBelowZero }}
              </div>
            </div>

            <div class="setting-row grid-three">
              <label>偏移 X <input v-model.number="schematicOffsetX" type="number"></label>
              <label>偏移 Y <input v-model.number="schematicOffsetY" type="number"></label>
              <label>偏移 Z <input v-model.number="schematicOffsetZ" type="number"></label>
            </div>

            <div class="setting-row schematic-preview-row">
              <SchematicPreviewCanvas
                v-if="schematicModelData"
                :model-data="schematicModelData"
              />
              <div v-else class="schematic-preview-placeholder">
                {{ isBuildingSchematicPreview ? '正在生成预览模型...' : '暂无预览模型' }}
              </div>
            </div>

            <div class="preview-actions-right" style="margin-top: 12px;">
              <button class="btn primary" :disabled="isApplying" @click="applySchematic">
                {{ isApplying ? '应用中...' : '应用原理图' }}
              </button>
              <button class="btn ghost" @click="clearSchematicFile">
                清除
              </button>
            </div>

            <div v-if="schematicApplyProgress" class="schematic-progress">
              <div class="schematic-progress-head">
                <span>{{ schematicProgressLabel }}</span>
                <span>{{ schematicProgressPercent }}%</span>
              </div>
              <div class="schematic-progress-track">
                <div class="schematic-progress-fill" :style="{ width: `${schematicProgressPercent}%` }" />
              </div>
              <div class="schematic-progress-meta">
                {{ schematicApplyProgress.processedBlocks || 0 }} / {{ schematicApplyProgress.totalBlocks || 0 }}
              </div>
            </div>

            <div class="schematic-console">
              <div class="schematic-console-head">
                <strong>导入控制台</strong>
                <div class="preview-actions-right">
                  <span class="schematic-console-count">{{ schematicImportLogs.length }} 条</span>
                  <button class="btn ghost" @click="clearSchematicImportLogs">
                    清空日志
                  </button>
                </div>
              </div>

              <div v-if="!schematicImportLogs.length" class="schematic-console-empty">
                还没有导入日志，应用原理图后会在这里显示楼梯/台阶/墙统计和贴图命中信息。
              </div>

              <div v-else class="schematic-console-list">
                <div
                  v-for="log in schematicImportLogs"
                  :key="log.id"
                  class="schematic-console-item"
                  :class="`is-${log.level}`"
                >
                  <div class="schematic-console-item-head">
                    <span class="time">{{ log.timestamp }}</span>
                    <span class="level">{{ log.level }}</span>
                  </div>
                  <div class="summary">
                    {{ log.summary }}
                  </div>
                  <div v-if="log.details" class="details">
                    放置 {{ log.details.placed || 0 }} · 替换 {{ log.details.replaced || 0 }} · 跳过 {{ log.details.skipped || 0 }} · 区块 {{ log.details.touchedChunks || 0 }}
                  </div>
                  <div v-if="log.details?.topTextures?.length" class="textures">
                    TOP 贴图：
                    <span
                      v-for="item in log.details.topTextures.slice(0, 6)"
                      :key="`${log.id}-${item.name}`"
                      class="texture-chip"
                    >
                      {{ item.name }} ({{ item.count }})
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="setting-section">
          <h3>创建世界</h3>
          <div class="setting-row">
            <label class="full">
              Seed
              <input
                type="text"
                inputmode="numeric"
                pattern="\d*"
                :value="worldGenSeedDraft"
                placeholder="留空以使用随机种子"
                @input="setWorldGenSeedDraft($event.target.value)"
              >
            </label>
          </div>
          <div v-if="worldGenSeedError" class="warning-text">
            {{ worldGenSeedError }}
          </div>

          <div class="setting-row">
            <span class="row-label">世界类型</span>
            <div class="option-group">
              <button
                v-for="presetId in WORLDGEN_PRESET_IDS"
                :key="`wg-preset-${presetId}`"
                class="option-btn"
                :class="{ active: adminWorldGenDraft.presetId === presetId }"
                @click="applyWorldGenPresetInAdmin(presetId)"
              >
                {{ WORLDGEN_PRESETS[presetId].name }}
              </button>
            </div>
          </div>

          <div class="setting-row grid-three">
            <label>地形高度 <input v-model.number="adminWorldGenDraft.magnitude" min="0" max="32" type="number"></label>
            <label>树最小高 <input v-model.number="adminWorldGenDraft.treeMinHeight" min="1" max="16" type="number"></label>
            <label>树最大高 <input v-model.number="adminWorldGenDraft.treeMaxHeight" min="1" max="32" type="number"></label>
          </div>

          <div class="setting-row">
            <label class="full">视距 <input v-model.number="adminWorldGenDraft.viewDistance" min="1" max="8" type="range"></label>
          </div>

          <div class="preview-actions-right" style="margin-top: 12px;">
            <button class="btn" @click="randomizeWorldGenSeed">
              随机种子
            </button>
            <button class="btn primary" :disabled="isApplyingWorldGen" @click="applyAdminWorldGen">
              {{ isApplyingWorldGen ? '应用中...' : '创建/重置世界' }}
            </button>
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
  scrollbar-width: thin;
  scrollbar-color: rgba(148, 163, 184, 0.5) rgba(15, 23, 42, 0.65);
}

.settings-panel::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

.settings-panel::-webkit-scrollbar-track {
  background: rgba(15, 23, 42, 0.65);
  border-radius: 999px;
}

.settings-panel::-webkit-scrollbar-thumb {
  background: rgba(148, 163, 184, 0.45);
  border-radius: 999px;
  border: 2px solid rgba(15, 23, 42, 0.65);
}

.settings-panel::-webkit-scrollbar-thumb:hover {
  background: rgba(148, 163, 184, 0.65);
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
  width: 100%;
  max-width: 100%;
}

.setting-row:last-child {
  margin-bottom: 0;
}

.grid-three {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  width: 100%;
}

.grid-three > label {
  min-width: 0;
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
  box-sizing: border-box;
}

input[type='number'],
input[type='text'] {
  width: min(100%, 260px);
}

label.full input[type='number'],
label.full input[type='text'] {
  width: 100%;
}

input[type='range'] {
  width: min(100%, 320px);
}

input[type='checkbox'] {
  width: auto;
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

.warning-text {
  margin: 0 0 10px;
  color: #fca5a5;
  font-size: 12px;
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
  padding: 6px 12px;
  border-radius: 10px;
  font-size: 14px;
  line-height: 1.2;
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
  white-space: nowrap;
}

.preview-actions-right {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
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

.schematic-preview-row {
  margin-top: 12px;
}

.schematic-progress {
  margin-top: 10px;
  padding: 8px 10px;
  border: 1px solid rgba(94, 203, 149, 0.35);
  border-radius: 8px;
  background: rgba(16, 185, 129, 0.08);
}

.schematic-progress-head {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #bbf7d0;
}

.schematic-progress-track {
  margin-top: 6px;
  width: 100%;
  height: 8px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.25);
  overflow: hidden;
}

.schematic-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #34d399 0%, #22c55e 100%);
  transition: width 0.15s linear;
}

.schematic-progress-meta {
  margin-top: 6px;
  font-size: 12px;
  color: #cbd5e1;
}

.schematic-preview-placeholder {
  border: 1px dashed rgba(148, 163, 184, 0.5);
  border-radius: 8px;
  color: #94a3b8;
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 640px;
  width: 100%;
}

.schematic-console {
  margin-top: 12px;
  border: 1px solid rgba(148, 163, 184, 0.35);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.45);
  padding: 10px;
}

.schematic-console-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #e2e8f0;
}

.schematic-console-count {
  font-size: 12px;
  color: #cbd5e1;
}

.schematic-console-empty {
  margin-top: 8px;
  color: #94a3b8;
  font-size: 12px;
}

.schematic-console-list {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 260px;
  overflow: auto;
  padding-right: 4px;
}

.schematic-console-item {
  border: 1px solid rgba(148, 163, 184, 0.25);
  border-radius: 8px;
  padding: 8px;
  background: rgba(30, 41, 59, 0.45);
}

.schematic-console-item.is-success {
  border-color: rgba(34, 197, 94, 0.45);
}

.schematic-console-item.is-warning {
  border-color: rgba(245, 158, 11, 0.55);
}

.schematic-console-item.is-error {
  border-color: rgba(239, 68, 68, 0.55);
}

.schematic-console-item-head {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #94a3b8;
}

.schematic-console-item-head .level {
  text-transform: uppercase;
}

.schematic-console-item .summary {
  margin-top: 4px;
  font-size: 13px;
  color: #e2e8f0;
}

.schematic-console-item .details {
  margin-top: 4px;
  font-size: 12px;
  color: #cbd5e1;
}

.schematic-console-item .textures {
  margin-top: 6px;
  font-size: 12px;
  color: #cbd5e1;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.texture-chip {
  display: inline-flex;
  align-items: center;
  border: 1px solid rgba(148, 163, 184, 0.35);
  background: rgba(15, 23, 42, 0.5);
  border-radius: 999px;
  padding: 2px 8px;
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
