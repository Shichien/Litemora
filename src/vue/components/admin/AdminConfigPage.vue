<script setup>
import {
  clearAdminAuthSession,
  getAuthProviders,
  loadAdminAuthSession,
  signInWithPassword,
  signInWithProvider,
} from '@three/auth/admin-auth.js'
import {
  buildSpaceProjectionUrl,
  buildSpaceWorldsAdminUrl,
  buildSpaceWorldsUrl,
  getActiveProjectionId,
  getActiveSpaceName,
  isSpaceProjectionRoute,
} from '@three/utils/space-context.js'
import { navigateToUrl } from '@three/utils/navigation.js'
import {
  checkProjectionNameAvailability,
  createGalleryItem,
} from '@three/gallery/gallery-api.js'
import emitter from '@three/utils/event/event-bus.js'
import {
  ensureProjectionDisplayName,
  isValidProjectionName,
  sanitizeProjectionNameInput,
} from '@three/utils/projection-name.js'

import {
  DEFAULT_BACKEND_WORLD_CONFIG,
  loadBackendWorldConfig,
  normalizeBackendWorldConfig,
  saveBackendWorldConfigRemote,
  saveAdminWorldConfig,
} from '@three/world/backend-world-config.js'
import {
  clearAdminSchematicFile,
  loadAdminSchematicFile,
  saveAdminSchematicFile,
} from '@three/world/terrain/admin-schematic-storage.js'
import {
  clearMinecraftResourcePack,
  loadMinecraftResourcePack,
  saveMinecraftResourcePackFile,
} from '@three/world/terrain/minecraft-resource-pack-storage.js'
import schematicService from '@three/world/terrain/schematic-service.js'
import SchematicRendererCanvas from '@ui-components/admin/SchematicRendererCanvas.vue'

import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'

const DEFAULT_PROJECTION_SPAWN_LIFT = 2

const authProviders = getAuthProviders()
const authSession = ref(loadAdminAuthSession())
const isAuthenticating = ref(false)
const authError = ref('')
const tempAdminPassword = ref('')
const configDraft = ref(structuredClone(DEFAULT_BACKEND_WORLD_CONFIG))
const statusText = ref('')
const statusType = ref('neutral')
const isApplying = ref(false)

const currentAccount = computed(() => authSession.value?.account || null)
const currentAccountId = computed(() => currentAccount.value?.id || '')
const currentAccountDisplay = computed(() => {
  const account = currentAccount.value
  if (!account) {
    return ''
  }
  return account.name || account.email || account.id
})
const isAuthenticated = computed(() => !!currentAccount.value)

// 原理图导入状态
const schematicFile = ref(null)
const schematicSourceFile = ref(null)
const schematicObject = ref(null)
const schematicPreview = ref(null)
const schematicProjectionName = ref('')
const schematicVisibility = ref('public')
const isParsingSchematic = ref(false)
const schematicOffsetY = ref(0)
const schematicApplyProgress = ref(null)
const resourcePackInfo = ref(null)
const isSavingResourcePack = ref(false)
const schematicRendererCanvasRef = ref(null)

const cameraPresetOptions = ['off', 'default', 'cinematic', 'arcade']
const visualPresetOptions = ['off', 'default', 'cinematic', 'arcade']
const projectionVisibilityOptions = [
  { value: 'public', label: '公开' },
  { value: 'private', label: '私有' },
]

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

const schematicPlacedBounds = computed(() => {
  const bounds = schematicPreview.value?.bounds
  if (!bounds || bounds.minX === null || bounds.maxX === null) {
    return null
  }

  const yOffset = normalizeSchematicOffsetY(schematicOffsetY.value)
  return {
    ...bounds,
    minY: bounds.minY + yOffset,
    maxY: bounds.maxY + yOffset,
  }
})

const formattedProjectionSpawnPoint = computed(() => {
  const spawnPoint = configDraft.value?.player?.spawnPoint || {}
  const parts = ['x', 'y', 'z'].map((axis) => {
    const value = Number(spawnPoint[axis])
    if (!Number.isFinite(value)) {
      return '0'
    }
    return Number(value.toFixed(2)).toString()
  })
  return `(${parts.join(', ')})`
})

const sanitizedProjectionName = computed(() => sanitizeProjectionNameInput(schematicProjectionName.value))
const resourcePackSignature = computed(() => {
  const info = resourcePackInfo.value
  if (!info) {
    return 'built-in'
  }

  return [
    info.key || 'custom',
    info.fileName || 'resource-pack.zip',
    info.updatedAt || 0,
    info.size || 0,
  ].join(':')
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
    'building-minecraft-render-layer': '构建真实方块渲染',
    'rebuilding-chunks': '重建区块网格',
    'done': '完成',
  }

  return labelMap[phase] || phase
})

function normalizeSchematicOffsetY(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return 0
  }
  return Math.min(100, Math.max(0, Math.round(numeric)))
}

function onSchematicApplyProgress(payload) {
  schematicApplyProgress.value = payload
}

function setStatus(message, type = 'neutral') {
  statusText.value = message
  statusType.value = type
}

function getCurrentRouteScope() {
  return {
    spaceName: getActiveSpaceName(),
    projectionId: getActiveProjectionId(),
  }
}

function markSaved(config) {
  configDraft.value = config
  lastSavedSnapshot.value = JSON.stringify(config)
}

function backToGame() {
  const spaceName = getActiveSpaceName()
  if (spaceName && !isSpaceProjectionRoute()) {
    navigateToUrl(buildSpaceWorldsUrl(spaceName), { replace: true })
    return
  }

  window.location.hash = ''
}

async function restorePersistedSchematic() {
  const scopeId = currentAccountId.value || ''
  let persisted = await loadAdminSchematicFile(scopeId)
  let restoredFromScope = scopeId

  if (!persisted?.file && scopeId) {
    persisted = await loadAdminSchematicFile('')
    restoredFromScope = ''
  }

  if (!persisted?.file) {
    clearSchematicFile({ withStatus: false })
    return
  }

  isParsingSchematic.value = true
  try {
    const schematic = await schematicService.parseFile(persisted.file)
    schematicObject.value = schematic
    schematicFile.value = persisted.fileName || persisted.file.name || null
    schematicSourceFile.value = persisted.file
    schematicPreview.value = schematicService.getPreview()
    schematicOffsetY.value = normalizeSchematicOffsetY(schematicOffsetY.value)
    if (!sanitizedProjectionName.value) {
      schematicProjectionName.value = ensureProjectionDisplayName(
        schematic.name || persisted.fileName || persisted.file.name || '',
      )
    }
    if (scopeId && restoredFromScope !== scopeId) {
      await saveAdminSchematicFile({
        accountId: scopeId,
        file: persisted.file,
      })
    }
    setStatus(`已恢复投影文件: ${schematic.name} (${schematicPreview.value.blockCount} 方块)`, 'success')
  }
  catch (error) {
    clearSchematicFile({ withStatus: false })
    setStatus(`恢复投影文件失败: ${error.message}`, 'warning')
  }
  finally {
    isParsingSchematic.value = false
  }
}

async function hydrateCurrentAccountData() {
  if (!isAuthenticated.value) {
    return
  }

  await loadCurrentConfig()
  await restorePersistedSchematic()
  await loadCurrentResourcePackInfo()
}

async function handleProviderAuth(provider) {
  if (isAuthenticating.value) {
    return
  }

  isAuthenticating.value = true
  authError.value = ''
  try {
    const session = await signInWithProvider(provider)
    authSession.value = session
    setStatus(`已使用 ${session.account.provider} 登录: ${session.account.name || session.account.email || session.account.id}`, 'success')
    await hydrateCurrentAccountData()
  }
  catch (error) {
    authError.value = error?.message || '登录失败'
  }
  finally {
    isAuthenticating.value = false
  }
}

async function handlePasswordAuth() {
  if (isAuthenticating.value) {
    return
  }

  isAuthenticating.value = true
  authError.value = ''
  try {
    const session = await signInWithPassword(tempAdminPassword.value)
    authSession.value = session
    tempAdminPassword.value = ''
    setStatus('已使用临时密码登录', 'success')
    await hydrateCurrentAccountData()
  }
  catch (error) {
    authError.value = error?.message || '登录失败'
  }
  finally {
    isAuthenticating.value = false
  }
}

function logout() {
  clearAdminAuthSession()
  authSession.value = null
  tempAdminPassword.value = ''
  authError.value = ''
  clearSchematicFile({ withStatus: false })
  backToGame()
}

async function loadCurrentConfig() {
  const loaded = await loadBackendWorldConfig(currentAccountId.value, getCurrentRouteScope())
  markSaved(loaded)
  setStatus('已读取当前生效配置', 'success')
}

function formatTimeOfDayLabel(value) {
  const normalized = Math.min(1, Math.max(0, Number(value) || 0))
  const totalMinutes = Math.round(normalized * 24 * 60) % (24 * 60)
  const hours = String(Math.floor(totalMinutes / 60)).padStart(2, '0')
  const minutes = String(totalMinutes % 60).padStart(2, '0')
  return `${hours}:${minutes}`
}

async function loadCurrentResourcePackInfo() {
  resourcePackInfo.value = await loadMinecraftResourcePack(getCurrentRouteScope())
}

async function handleResourcePackFileSelect(event) {
  const file = event.target?.files?.[0]
  if (!file) {
    return
  }

  isSavingResourcePack.value = true
  try {
    resourcePackInfo.value = await saveMinecraftResourcePackFile(file, getCurrentRouteScope())
    emitter.emit('minecraft:resource-pack-changed', {
      ...getCurrentRouteScope(),
      fileName: resourcePackInfo.value?.fileName || file.name,
    })
    setStatus(`已激活资源包: ${resourcePackInfo.value?.fileName || file.name}`, 'success')
  }
  catch (error) {
    setStatus(`资源包导入失败: ${error?.message || 'unknown_error'}`, 'warning')
  }
  finally {
    isSavingResourcePack.value = false
    event.target.value = ''
  }
}

async function clearCurrentResourcePack() {
  await clearMinecraftResourcePack(getCurrentRouteScope())
  await loadCurrentResourcePackInfo()
  emitter.emit('minecraft:resource-pack-changed', getCurrentRouteScope())
  setStatus('已恢复内置 Minecraft 资源包', 'neutral')
}

function resetToDefaultTemplate() {
  configDraft.value = structuredClone(DEFAULT_BACKEND_WORLD_CONFIG)
  setStatus('已重置为默认模板（未保存）', 'warning')
}

async function applyConfig() {
  isApplying.value = true
  let saved = null

  try {
    saved = await saveBackendWorldConfigRemote(configDraft.value, currentAccountId.value, getCurrentRouteScope())
    setStatus('已保存并应用（服务端已持久化）', 'success')
  }
  catch {
    saved = saveAdminWorldConfig(configDraft.value, currentAccountId.value, getCurrentRouteScope())
    setStatus('服务端保存失败，已回退到本地保存并应用', 'warning')
  }

  markSaved(saved)
  emitter.emit('backend:config-updated', saved)
  isApplying.value = false
}

function formatSliderValue(value, digits = 0) {
  const num = Number(value)
  if (!Number.isFinite(num)) {
    return '-'
  }
  return digits > 0 ? num.toFixed(digits) : String(Math.round(num))
}

function formatSliderDisplay(value, max, digits = 0) {
  return `${formatSliderValue(value, digits)} / ${formatSliderValue(max, digits)}`
}

async function handleSchematicFileSelect(event) {
  const file = event.target.files?.[0]
  if (!file) {
    return
  }

  if (!/\.(litematic|schem)$/iu.test(file.name)) {
    setStatus('请选择 .litematic 或 .schem 文件', 'warning')
    event.target.value = ''
    return
  }

  isParsingSchematic.value = true
  try {
    const schematic = await schematicService.parseFile(file)
    schematicObject.value = schematic
    schematicFile.value = file.name
    schematicSourceFile.value = file
    schematicPreview.value = schematicService.getPreview()
    schematicProjectionName.value = ensureProjectionDisplayName(
      schematic.name || file.name.replace(/\.(litematic|schem)$/iu, ''),
    )
    schematicOffsetY.value = normalizeSchematicOffsetY(schematicOffsetY.value)
    await saveAdminSchematicFile({
      accountId: currentAccountId.value,
      file,
    })
    const yInfo = schematicPreview.value?.yStats
    if (yInfo?.hasBlocksBelowZero) {
      setStatus(
        `已加载原理图: ${schematic.name} (${schematicPreview.value.blockCount} 方块)，检测到 Y<0 方块 ${yInfo.blocksBelowZero}`,
        'warning',
      )
    }
    else {
      setStatus(`已加载原理图: ${schematic.name} (${schematicPreview.value.blockCount} 方块，${schematic.format || 'litematic'})`, 'success')
    }
  }
  catch (error) {
    schematicObject.value = null
    schematicPreview.value = null
    setStatus(`解析失败: ${error.message}`, 'warning')
  }
  finally {
    isParsingSchematic.value = false
  }
}

function clearSchematicFile({ withStatus = true } = {}) {
  schematicFile.value = null
  schematicSourceFile.value = null
  schematicObject.value = null
  schematicPreview.value = null
  schematicProjectionName.value = ''
  schematicVisibility.value = 'public'
  schematicOffsetY.value = 0
  clearAdminSchematicFile(currentAccountId.value || '')
  if (withStatus) {
    setStatus('已清除原理图', 'neutral')
  }
}

async function applySchematic() {
  if (!schematicPreview.value) {
    setStatus('未装载原理图', 'warning')
    return
  }

  // 检查是否在投影视图中
  const spaceName = getActiveSpaceName()
  const projectionId = getActiveProjectionId()
  const isInProjection = isSpaceProjectionRoute()

  if (!isInProjection && spaceName && projectionId) {
    setStatus('当前在投影设置页，正在进入该投影以应用原理图...', 'neutral')
    navigateToUrl(`${buildSpaceProjectionUrl(spaceName, projectionId)}#admin-config`)
    return
  }

  // 如果不在投影视图，先创建 Gallery Item 然后跳转
  if (!isInProjection) {
    const session = loadAdminAuthSession()
    if (!session?.account?.id) {
      setStatus('请先登录再创建投影', 'warning')
      return
    }

    if (!isValidProjectionName(sanitizedProjectionName.value)) {
      setStatus('投影名称仅支持英文字母和数字', 'warning')
      return
    }

    const availability = await checkProjectionNameAvailability(
      spaceName,
      sanitizedProjectionName.value,
      session,
    )
    if (!availability?.available) {
      setStatus('已存在同名投影，请换一个名字', 'warning')
      return
    }

    setStatus('正在创建投影...', 'neutral')
    isApplying.value = true

    try {
      let thumbnailDataUrl = ''
      try {
        thumbnailDataUrl = await schematicRendererCanvasRef.value?.capturePreviewThumbnail?.({
          width: 640,
          height: 360,
          quality: 0.82,
        }) || ''
      }
      catch {
        thumbnailDataUrl = ''
      }

      // 创建 Gallery Item
      const payload = await createGalleryItem({
        spaceName,
        title: ensureProjectionDisplayName(schematicProjectionName.value, schematicPreview.value?.name || 'World'),
        description: '',
        file: schematicSourceFile.value,
        schematic: schematicPreview.value,
        previewModel: schematicPreview.value,
        placement: {
          offset: {
            x: 0,
            y: normalizeSchematicOffsetY(schematicOffsetY.value),
            z: 0,
          },
        },
        visibility: schematicVisibility.value,
        thumbnailDataUrl,
        projectionName: sanitizedProjectionName.value,
        session,
      })

      const projectionRouteId = payload?.item?.projectionSlug || payload?.item?.id
      if (projectionRouteId) {
        let savedProjectionConfig = null
        try {
          savedProjectionConfig = await saveBackendWorldConfigRemote(
            configDraft.value,
            currentAccountId.value,
            {
              spaceName,
              projectionId: projectionRouteId,
            },
          )
        }
        catch {
          savedProjectionConfig = saveAdminWorldConfig(
            configDraft.value,
            currentAccountId.value,
            {
              spaceName,
              projectionId: projectionRouteId,
            },
          )
        }

        if (savedProjectionConfig) {
          markSaved(savedProjectionConfig)
        }

        setStatus('投影已创建，可继续设置或稍后进入世界。', 'success')
        const targetUrl = buildSpaceWorldsAdminUrl(spaceName, projectionRouteId)
        navigateToUrl(targetUrl)
        return
      }
      else {
        throw new Error('创建投影失败')
      }
    }
    catch (error) {
      setStatus(
        error?.message === 'projection_name_exists'
          ? '已存在同名投影，请换一个名字'
          : `创建投影失败: ${error.message}`,
        'warning',
      )
      isApplying.value = false
      return
    }
  }

  // 下面是原有的应用原理图逻辑（投影视图中执行）
  isApplying.value = true
  schematicApplyProgress.value = {
    phase: 'prepare',
    progress: 0,
    processedBlocks: 0,
    totalBlocks: schematicPreview.value?.blockCount || 0,
  }
  try {
    const offset = {
      x: 0,
      y: normalizeSchematicOffsetY(schematicOffsetY.value),
      z: 0,
    }
    const runtimeConfig = normalizeBackendWorldConfig(configDraft.value)

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
      spawnPoint: {
        ...runtimeConfig.player.spawnPoint,
      },
      movePlayerToSpawn: true,
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
    const renderMode = result?.importDiagnostics?.renderMode || 'minecraft-native'
    const importedChunkCount = result?.importDiagnostics?.importedChunkCount || result?.touchedChunks || 0
    const persistenceSaved = result?.persistenceSaved !== false
    const minPlacedY = (schematicPreview.value?.yStats?.minY ?? 0) + offset.y
    if (minPlacedY < 0) {
      setStatus(
        `应用完成：放置 ${result.placed}，替换 ${result.replaced}，跳过 ${result.skipped}（其中越界 ${result.skippedOutOfHeight || 0}），渲染模式 ${renderMode}，注意最小Y=${minPlacedY} 低于 0`,
        'warning',
      )
      return
    }

    setStatus(
      `应用完成：放置 ${result.placed}，替换 ${result.replaced}，跳过 ${result.skipped}，清空区块 ${result.worldClearedChunks || 0}，涉及 ${result.touchedChunks} 个区块，渲染模式 ${renderMode}${result?.spawnPoint ? `，出生点 ${result.spawnPoint.x}, ${result.spawnPoint.y}, ${result.spawnPoint.z}` : ''}`,
      persistenceSaved ? 'success' : 'warning',
    )

    // 自动跳转到游戏视图
    if (spaceName && projectionId) {
      setTimeout(() => {
        const gameUrl = buildSpaceProjectionUrl(spaceName, projectionId)
        navigateToUrl(gameUrl)
      }, 500)
    }

    if (!persistenceSaved) {
      setStatus('应用完成但远端持久化失败（请检查 KV 写入限制/绑定）', 'warning')
    }
  }
  catch (error) {
    setStatus(`应用失败: ${error.message}`, 'warning')
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

function setProjectionSpawnPreset() {
  const bounds = schematicPlacedBounds.value
  if (!bounds) {
    setStatus('当前原理图还没有可用于计算出生点的边界', 'warning')
    return
  }

  const spawnPoint = {
    x: Number((((bounds.minX + bounds.maxX) * 0.5)).toFixed(2)),
    y: Number((bounds.maxY + 0.5 + DEFAULT_PROJECTION_SPAWN_LIFT).toFixed(2)),
    z: Number((((bounds.minZ + bounds.maxZ) * 0.5)).toFixed(2)),
  }

  configDraft.value.player.spawnPoint = spawnPoint
  setStatus(`已将出生点设置到投影顶部中心 (${spawnPoint.x}, ${spawnPoint.y}, ${spawnPoint.z})`, 'success')
}

function setProjectionSpawnFromPreviewBlock(payload) {
  const x = Number(payload?.x)
  const y = Number(payload?.y)
  const z = Number(payload?.z)

  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    setStatus('当前高亮方块没有可用坐标，暂时无法设置出生点', 'warning')
    return
  }

  const yOffset = normalizeSchematicOffsetY(schematicOffsetY.value)
  const spawnPoint = {
    x: Number(x.toFixed(2)),
    y: Number((y + yOffset + 0.5 + DEFAULT_PROJECTION_SPAWN_LIFT).toFixed(2)),
    z: Number(z.toFixed(2)),
  }

  configDraft.value.player.spawnPoint = spawnPoint
  setStatus(`已将出生点设置到方块 (${x}, ${y}, ${z}) 上方 (${spawnPoint.x}, ${spawnPoint.y}, ${spawnPoint.z})`, 'success')
}

onMounted(async () => {
  emitter.on('schematic:apply-progress', onSchematicApplyProgress)

  await restorePersistedSchematic()
  await loadCurrentResourcePackInfo()

  if (isAuthenticated.value) {
    await loadCurrentConfig()
  }
})

watch(currentAccountId, async (nextId, previousId) => {
  if (!nextId || nextId === previousId) {
    return
  }
  await hydrateCurrentAccountData()
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
        <p class="auth-tip">
          使用管理员 OAuth 账户登录，或输入临时密码
        </p>
        <div class="oauth-actions">
          <button
            v-for="provider in authProviders"
            :key="provider.id"
            class="btn primary oauth-btn"
            :disabled="isAuthenticating"
            @click="handleProviderAuth(provider.id)"
          >
            <span class="oauth-btn-inner">
              <span class="oauth-icon" :class="`is-${provider.id}`" aria-hidden="true">
                <svg v-if="provider.id === 'github'" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0.5C5.372 0.5 0 5.915 0 12.596C0 17.945 3.438 22.483 8.205 24.084C8.805 24.196 9.025 23.822 9.025 23.5C9.025 23.212 9.015 22.44 9.01 21.415C5.672 22.158 4.968 19.783 4.968 19.783C4.422 18.36 3.633 17.982 3.633 17.982C2.546 17.217 3.715 17.233 3.715 17.233C4.916 17.319 5.549 18.488 5.549 18.488C6.616 20.351 8.349 19.813 9.05 19.497C9.157 18.705 9.467 18.163 9.81 17.857C7.145 17.545 4.344 16.49 4.344 11.779C4.344 10.437 4.814 9.339 5.58 8.475C5.455 8.161 5.046 6.898 5.697 5.188C5.697 5.188 6.705 4.859 8.998 6.436C9.959 6.162 10.989 6.025 12.019 6.021C13.049 6.025 14.08 6.162 15.043 6.436C17.334 4.859 18.34 5.188 18.34 5.188C18.994 6.898 18.584 8.161 18.461 8.475C19.229 9.339 19.696 10.437 19.696 11.779C19.696 16.503 16.891 17.541 14.218 17.847C14.648 18.223 15.03 18.966 15.03 20.106C15.03 21.738 15.015 23.056 15.015 23.5C15.015 23.825 15.232 24.202 15.84 24.083C20.604 22.48 24 17.944 24 12.596C24 5.915 18.627 0.5 12 0.5Z" />
                </svg>
              </span>
              <span>{{ isAuthenticating ? '登录中...' : `使用 ${provider.label} 登录` }}</span>
            </span>
          </button>
        </div>
        <input
          v-model="tempAdminPassword"
          type="password"
          placeholder="临时密码"
          autocomplete="current-password"
          :disabled="isAuthenticating"
          @keydown.enter.prevent="handlePasswordAuth"
        >
        <p v-if="authError" class="error">
          {{ authError }}
        </p>
        <div class="auth-actions">
          <button class="btn primary" :disabled="isAuthenticating || !tempAdminPassword" @click="handlePasswordAuth">
            {{ isAuthenticating ? '登录中...' : '使用密码登录' }}
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
          <h2>控制台</h2>
          <p v-if="currentAccountDisplay" class="subtitle">
            当前账户: {{ currentAccountDisplay }}
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
        <button class="btn" @click="resetToDefaultTemplate">
          默认模板
        </button>
        <button class="btn primary" :disabled="isApplying" @click="applyConfig">
          {{ isApplying ? '应用中...' : '保存并应用' }}
        </button>
      </div>

      <div class="settings-panel">
        <section class="setting-section">
          <h3>界面设置</h3>
          <div class="setting-row toggles">
            <label><input v-model="configDraft.ui.pauseMenu.showSettings" type="checkbox">显示设置按钮</label>
            <label><input v-model="configDraft.ui.pauseMenu.showSkins" type="checkbox">显示皮肤按钮</label>
          </div>
        </section>

        <section class="setting-section">
          <h3>玩家设置</h3>
          <div class="setting-row">
            <label class="full">
              视距
              <div class="range-wrap range-wrap-compact">
                <input v-model.number="configDraft.settings.chunk.viewDistance" min="1" max="8" step="1" type="range">
                <span class="slider-value">{{ formatSliderDisplay(configDraft.settings.chunk.viewDistance, 8) }}</span>
              </div>
            </label>
          </div>
          <div class="setting-row toggles">
            <label><input v-model="configDraft.player.flight.ignoreMiningSlowdown" type="checkbox">飞行时忽略挖掘减速</label>
            <label><input v-model="configDraft.player.flight.groundWalkAnimationWhenMoving" type="checkbox">飞行移动模拟地面行走动画</label>
          </div>
          <div class="setting-row toggles">
            <label><input v-model="configDraft.ui.controls.allowFlightToggle" type="checkbox">允许切换飞行（F）</label>
            <label><input v-model="configDraft.ui.controls.allowPerspectiveToggle" type="checkbox">允许切换第一/第三人称（Y）</label>
          </div>
        </section>

        <section class="setting-section">
          <h3>世界设置</h3>
          <div class="setting-row grid-three">
            <label>
              高度上限(16-256)
              <div class="range-wrap">
                <input v-model.number="configDraft.settings.chunk.height" min="16" max="256" step="1" type="range">
                <span class="slider-value">{{ formatSliderDisplay(configDraft.settings.chunk.height, 256) }}</span>
              </div>
            </label>
            <label>
              视距
              <div class="range-wrap">
                <input v-model.number="configDraft.settings.chunk.viewDistance" min="1" max="8" step="1" type="range">
                <span class="slider-value">{{ formatSliderDisplay(configDraft.settings.chunk.viewDistance, 8) }}</span>
              </div>
            </label>
            <label>
              卸载缓冲
              <div class="range-wrap">
                <input v-model.number="configDraft.settings.chunk.unloadPadding" min="0" max="8" step="1" type="range">
                <span class="slider-value">{{ formatSliderDisplay(configDraft.settings.chunk.unloadPadding, 8) }}</span>
              </div>
            </label>
          </div>
          <div class="setting-row grid-three">
            <label>
              阳光强度
              <div class="range-wrap">
                <input v-model.number="configDraft.settings.environment.sunIntensity" min="0" max="5" step="0.05" type="range">
                <span class="slider-value">{{ formatSliderDisplay(configDraft.settings.environment.sunIntensity, 5, 2) }}</span>
              </div>
            </label>
            <label>
              当前时间
              <div class="range-wrap">
                <input v-model.number="configDraft.settings.environment.timeOfDay" min="0" max="1" step="0.001" type="range">
                <span class="slider-value">{{ formatTimeOfDayLabel(configDraft.settings.environment.timeOfDay) }}</span>
              </div>
            </label>
            <label>
              雾浓度
              <div class="range-wrap">
                <input v-model.number="configDraft.settings.environment.fogDensity" min="0" max="0.05" step="0.001" type="range">
                <span class="slider-value">{{ formatSliderDisplay(configDraft.settings.environment.fogDensity, 0.05, 3) }}</span>
              </div>
            </label>
          </div>
          <div class="setting-row grid-three">
            <label>
              环境光
              <div class="range-wrap">
                <input v-model.number="configDraft.settings.environment.ambientIntensity" min="0" max="3" step="0.05" type="range">
                <span class="slider-value">{{ formatSliderDisplay(configDraft.settings.environment.ambientIntensity, 3, 2) }}</span>
              </div>
            </label>
            <label class="toggle-field">
              时间流逝
              <span><input v-model="configDraft.settings.environment.timeAutoPlay" type="checkbox"> 自动推进昼夜循环</span>
            </label>
            <div />
          </div>
          <div class="setting-row setting-row-spacer-top setting-preset-row">
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
          <div class="setting-row setting-preset-row">
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

          <div class="subsection-title">
            Minecraft 资源包
          </div>
          <div class="setting-row">
            <input
              :disabled="isSavingResourcePack"
              accept=".zip,.mcpack,.pack"
              type="file"
              @change="handleResourcePackFileSelect"
            >
          </div>
          <div class="setting-row resource-pack-row">
            <div class="resource-pack-card">
              <strong>{{ resourcePackInfo?.fileName || '当前使用内置 Minecraft 资源包' }}</strong>
              <span v-if="resourcePackInfo">
                {{ ((resourcePackInfo.size || 0) / 1024 / 1024).toFixed(2) }} MB · {{ new Date(resourcePackInfo.updatedAt || Date.now()).toLocaleString('zh-CN', { hour12: false }) }}
              </span>
              <span v-else>
                上传后会同时影响管理页预览和进入世界后的建筑材质。
              </span>
            </div>
            <div class="preview-actions-right">
              <button class="btn ghost" :disabled="!resourcePackInfo" @click="clearCurrentResourcePack">
                恢复内置资源包
              </button>
            </div>
          </div>

          <div class="subsection-title">
            导入 Minecraft 投影文件
          </div>
          <div class="setting-row">
            <input
              type="file"
              accept=".litematic,.schem"
              @change="handleSchematicFileSelect"
            >
          </div>
          <p class="schematic-preview-hint">
            支持上传 `.litematic` 和 `.schem` 文件。
          </p>

          <div v-if="schematicFile" class="schematic-preview">
            <div class="preview-info">
              <div>
                <strong>文件:</strong> {{ schematicFile }}
              </div>
              <div>
                <strong>投影名:</strong>
                <input
                  v-model="schematicProjectionName"
                  maxlength="48"
                  placeholder="仅英文字母和数字"
                  type="text"
                  @input="schematicProjectionName = sanitizeProjectionNameInput(schematicProjectionName)"
                >
              </div>
              <div v-if="schematicPreview">
                <strong>作者:</strong> {{ schematicPreview.author }}
              </div>
              <div v-if="schematicPreview">
                <strong>方块数:</strong> {{ schematicPreview.blockCount }}
              </div>
            </div>

            <div class="setting-row">
              <span class="row-label">创建后可见性</span>
              <div class="option-group">
                <button
                  v-for="option in projectionVisibilityOptions"
                  :key="`projection-visibility-${option.value}`"
                  class="option-btn"
                  :class="{ active: schematicVisibility === option.value }"
                  @click="schematicVisibility = option.value"
                >
                  {{ option.label }}
                </button>
              </div>
              <div class="inline-help">
                <span class="inline-help-icon" aria-hidden="true">?</span>
                <span class="inline-help-tooltip">公开投影在退出登录后仍然可见。</span>
              </div>
            </div>

            <div class="setting-row schematic-preview-row">
              <div class="schematic-preview-stage">
                <div class="preview-offset-overlay">
                  <span class="preview-offset-label">偏移 Y</span>
                  <div class="preview-offset-slider">
                    <input
                      v-model.number="schematicOffsetY"
                      class="vertical-range"
                      min="0"
                      max="100"
                      step="1"
                      type="range"
                    >
                    <span class="preview-offset-value">{{ formatSliderValue(schematicOffsetY) }}</span>
                  </div>
                </div>
                <div class="preview-spawn-overlay">
                  <span class="preview-spawn-label">SpawnPoint</span>
                  <div class="preview-spawn-value">{{ formattedProjectionSpawnPoint }}</div>
                </div>
                <SchematicRendererCanvas
                  ref="schematicRendererCanvasRef"
                  v-if="schematicObject"
                  :resource-pack-signature="resourcePackSignature"
                  :schematic="schematicObject"
                  :source-file="schematicSourceFile"
                  :preview-offset="{ x: 0, y: schematicOffsetY, z: 0 }"
                  empty-label="真实渲染预览会显示在这里"
                  @block-picked="setProjectionSpawnFromPreviewBlock"
                />
                <div v-else class="schematic-preview-placeholder">
                  {{ isParsingSchematic ? '正在解析原理图...' : '暂无可渲染的原理图' }}
                </div>
              </div>
            </div>

            <p class="schematic-preview-hint">
              鼠标移到高亮方块后双击，可直接把该方块上方设置为出生点。
            </p>

            <div class="preview-actions-right" style="margin-top: 12px;">
              <button class="btn primary" :disabled="isApplying" @click="applySchematic">
                {{ isApplying ? '应用中...' : '应用原理图' }}
              </button>
              <button class="btn ghost" :disabled="!schematicPlacedBounds" @click="setProjectionSpawnPreset">
                使用投影顶部中心作为出生点
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

.auth-tip {
  margin-bottom: 12px;
}

.oauth-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.oauth-btn {
  width: 100%;
}

.oauth-btn-inner {
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
  width: 100%;
}

.oauth-icon {
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 18px;
}

.oauth-icon svg {
  width: 100%;
  height: 100%;
  display: block;
}

.oauth-icon.is-github {
  color: #111827;
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
  justify-content: center;
}

.auth-actions .btn {
  min-width: 120px;
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

.setting-row-spacer-top {
  margin-top: 14px;
}

.setting-preset-row {
  align-items: flex-start;
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
  width: 100%;
  padding: 0;
  margin: 0;
  border: none;
  background: transparent;
  flex: 1 1 auto;
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
  padding-top: 6px;
}

.setting-preset-row .option-group {
  flex: 1 1 auto;
}

.inline-help {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-left: 4px;
}

.inline-help-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: #f59e0b;
  color: #111827;
  font-size: 11px;
  font-weight: 700;
  cursor: help;
  box-shadow: 0 0 0 1px rgba(245, 158, 11, 0.35);
}

.inline-help-tooltip {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 10px);
  transform: translateX(-50%);
  width: max-content;
  max-width: 220px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid rgba(245, 158, 11, 0.35);
  background: rgba(15, 23, 42, 0.96);
  color: #f8fafc;
  font-size: 12px;
  line-height: 1.45;
  box-shadow: 0 16px 36px rgba(15, 23, 42, 0.35);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity 0.16s ease, visibility 0.16s ease;
}

.inline-help:hover .inline-help-tooltip,
.inline-help:focus-within .inline-help-tooltip {
  opacity: 1;
  visibility: visible;
}

.warning-text {
  margin: 0 0 10px;
  color: #fca5a5;
  font-size: 12px;
}

.range-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
}

.range-wrap-compact input[type='range'] {
  flex: 0 0 33.333%;
  max-width: 33.333%;
}

.slider-value {
  min-width: 92px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: #e2e8f0;
}

.subsection-title {
  margin: 8px 0 10px;
  font-size: 16px;
  font-weight: 600;
  color: #e2e8f0;
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

.toggle-field span {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #e2e8f0;
}

.resource-pack-row {
  align-items: stretch;
}

.resource-pack-card {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 68px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  background: rgba(15, 23, 42, 0.4);
}

.resource-pack-card strong {
  color: #e5e7eb;
  font-size: 14px;
}

.resource-pack-card span {
  color: #cbd5e1;
  font-size: 12px;
  line-height: 1.5;
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

.schematic-preview-stage {
  position: relative;
  width: min(100%, 960px);
  margin: 0 auto;
}

.preview-offset-overlay {
  position: absolute;
  top: 14px;
  left: 14px;
  z-index: 3;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 10px;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  background: rgba(15, 23, 42, 0.78);
  backdrop-filter: blur(10px);
}

.preview-offset-label {
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #cbd5e1;
}

.preview-offset-slider {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.preview-offset-slider input[type='range'].vertical-range {
  -webkit-appearance: none;
  appearance: none;
  writing-mode: vertical-lr;
  direction: rtl;
  width: 22px;
  height: 220px;
  flex: none;
}

.preview-offset-value {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: #f8fafc;
}

.preview-spawn-overlay {
  position: absolute;
  top: 14px;
  right: 14px;
  z-index: 3;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 180px;
  max-width: min(42vw, 280px);
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  background: rgba(15, 23, 42, 0.78);
  backdrop-filter: blur(10px);
}

.preview-spawn-label {
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #cbd5e1;
}

.preview-spawn-value {
  padding: 9px 10px;
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  background: rgba(2, 6, 23, 0.5);
  color: #f8fafc;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
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
  min-height: 320px;
  width: 100%;
  min-width: 0;
}

.schematic-preview-hint {
  margin: 10px 0 0;
  font-size: 12px;
  color: #cbd5e1;
}

.schematic-preview-hint.warning {
  color: #fbbf24;
  background: rgba(251, 191, 36, 0.1);
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid rgba(251, 191, 36, 0.2);
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
