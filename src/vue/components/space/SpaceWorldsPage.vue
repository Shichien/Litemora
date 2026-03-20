<script setup>
import {
  clearAdminAuthSession,
  getAuthProviders,
  isLocalDevAuthSession,
  loadAdminAuthSession,
  signInWithProvider,
} from '@three/auth/admin-auth.js'
import {
  claimGallerySpace,
  deleteGalleryItem,
  fetchGallery,
} from '@three/gallery/gallery-api.js'
import { navigateToUrl } from '@three/utils/navigation.js'
import { buildSpaceProjectionUrl, buildSpaceWorldsAdminUrl, buildSpaceWorldsUrl } from '@three/utils/space-context.js'
import SpaceNotFoundPage from '@ui-components/space/SpaceNotFoundPage.vue'
import SpaceProfileSettingsPage from '@ui-components/space/SpaceProfileSettingsPage.vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  spaceName: {
    type: String,
    default: '',
  },
})

const LITEMORA_REPOSITORY_URL = 'https://github.com/Shichien/Litemora'
const PROFILE_SETTINGS_HASH = '#profile-settings'

const authProviders = getAuthProviders()

const authSession = ref(loadAdminAuthSession())
const galleryProfile = ref(null)
const galleryItems = ref([])
const galleryViewer = ref({
  authenticated: false,
  account: null,
  canManage: false,
})

const isAuthenticating = ref(false)
const isLoading = ref(false)
const loadError = ref('')
const authError = ref('')
const actionMessage = ref('')
const actionTone = ref('neutral')
const pendingDeleteItemId = ref('')
const authMenuOpen = ref(false)
const authMenuRef = ref(null)
const isSavingProfile = ref(false)

let activeRssFeedUrl = ''

function resolveCurrentView() {
  return window.location.hash === PROFILE_SETTINGS_HASH ? 'profile-settings' : 'gallery'
}

const currentView = ref(resolveCurrentView())

function openAdminConfigPage() {
  if (!props.spaceName) {
    return
  }

  navigateToUrl(buildSpaceWorldsAdminUrl(props.spaceName))
}

const viewerDisplayName = computed(() => {
  const account = authSession.value?.account
  if (!account) {
    return ''
  }
  return account.name || account.email || account.id
})
const viewerEmail = computed(() => authSession.value?.account?.email || '')
const viewerRole = computed(() => isLocalDevSession.value ? 'Admin' : 'Member')
const viewerAvatar = computed(() => authSession.value?.account?.avatar || '')
const viewerInitial = computed(() => viewerDisplayName.value.slice(0, 1).toUpperCase() || 'L')

const isLocalDevSession = computed(() => isLocalDevAuthSession(authSession.value))
const isProfileSettingsView = computed(() => currentView.value === 'profile-settings')
const canEditProfileSettings = computed(() => {
  if (!authSession.value) {
    return false
  }

  if (!galleryProfile.value) {
    return galleryItems.value.length === 0
  }

  return !!galleryViewer.value?.canManage
})
const brandOwnerName = computed(() => {
  return String(
    galleryProfile.value?.ownerName
    || viewerDisplayName.value
    || props.spaceName
    || 'Litemora',
  ).trim()
})
const defaultBrandTitle = computed(() => {
  if (!brandOwnerName.value) {
    return 'Litemora Worlds'
  }

  if (/worlds$/iu.test(brandOwnerName.value)) {
    return brandOwnerName.value
  }

  return `${brandOwnerName.value}'s Worlds`
})
const brandTitle = computed(() => {
  const customTitle = String(galleryProfile.value?.title || '').trim()
  return customTitle || defaultBrandTitle.value
})
const brandSubtitle = computed(() => {
  if (isProfileSettingsView.value) {
    return `Profile Settings for ${props.spaceName}`
  }

  const itemLabel = galleryItems.value.length === 1 ? 'World' : 'Worlds'
  return `${galleryItems.value.length} ${itemLabel} in ${props.spaceName}`
})
const brandAvatar = computed(() => {
  if (canEditProfileSettings.value && viewerAvatar.value) {
    return viewerAvatar.value
  }

  return String(galleryProfile.value?.ownerAvatar || viewerAvatar.value || '').trim()
})
const brandAvatarInitial = computed(() => {
  return brandTitle.value.slice(0, 1).toUpperCase() || viewerInitial.value || 'L'
})

const canManageProjections = computed(() => {
  if (!authSession.value) {
    return false
  }

  return !!galleryViewer.value?.canManage
})
const isMissingSpace = computed(() => {
  return !galleryProfile.value && galleryItems.value.length === 0 && !canManageProjections.value
})

function resolveProjectionPreview(item) {
  if (!item || typeof item !== 'object') {
    return null
  }

  const preview = item.preview && typeof item.preview === 'object' ? item.preview : null
  const previewModel = item.previewModel && typeof item.previewModel === 'object' ? item.previewModel : null
  const schematic = item.schematic && typeof item.schematic === 'object' ? item.schematic : null

  return {
    totalSolidBlocks: Number(preview?.totalSolidBlocks || previewModel?.totalSolidBlocks || schematic?.blockCount || 0),
    bounds: preview?.bounds || previewModel?.bounds || schematic?.bounds || null,
  }
}

function getProjectionRouteId(item) {
  return String(item?.projectionSlug || item?.id || '').trim()
}

function openProjectionSettings(item) {
  const routeId = getProjectionRouteId(item)
  if (!routeId || !props.spaceName) {
    return
  }

  navigateToUrl(buildSpaceWorldsAdminUrl(props.spaceName, routeId))
}

function resolveProjectionThumbnailAsset(item) {
  const imageUrl = String(item?.thumbnailDataUrl || '').trim()
  if (imageUrl) {
    return {
      imageUrl,
      generated: null,
    }
  }

  return {
    imageUrl: '',
    generated: generateProjectionThumbnailSvg(item),
  }
}

function generateProjectionThumbnailSvg(item) {
  const preview = resolveProjectionPreview(item)
  const bounds = preview?.bounds
  if (!bounds) {
    return null
  }

  const minX = bounds.minX ?? 0
  const maxX = bounds.maxX ?? 16
  const minY = bounds.minY ?? 0
  const maxY = bounds.maxY ?? 32
  const minZ = bounds.minZ ?? 0
  const maxZ = bounds.maxZ ?? 16

  const width = maxX - minX || 16
  const height = maxY - minY || 32
  const depth = maxZ - minZ || 16

  const maxDim = Math.max(width, height, depth)
  const scale = 20 / maxDim

  const displayWidth = width * scale
  const displayHeight = height * scale
  const displayDepth = depth * scale
  const safeGradientId = String(item?.id || 'projection')
    .replace(/[^a-z0-9_-]/giu, '')
    .slice(0, 48) || 'projection'

  const centerX = 12
  const centerY = 12
  const baseColor = '#7ebcd3'
  const highlightColor = '#a8d8ea'

  return {
    svg: `
      <svg width="100%" height="100%" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="grad-${safeGradientId}" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:${highlightColor};stop-opacity:0.8" />
            <stop offset="100%" style="stop-color:${baseColor};stop-opacity:0.6" />
          </linearGradient>
        </defs>
        <g transform="translate(${centerX - displayWidth / 2}, ${centerY - displayHeight / 2})">
          <path d="M0,${displayHeight * 0.2} L${displayWidth * 0.3},0 L${displayWidth},${displayHeight * 0.2} L${displayWidth * 0.7},${displayHeight * 0.4} Z"
                fill="${highlightColor}" fill-opacity="0.7" />
          <rect x="0" y="${displayHeight * 0.2}" width="${displayWidth}" height="${displayHeight * 0.6}"
                fill="url(#grad-${safeGradientId})" />
          <path d="M${displayWidth},${displayHeight * 0.2} L${displayWidth * 0.7},${displayHeight * 0.4} L${displayWidth * 0.7},${displayHeight} L${displayWidth},${displayHeight * 0.8} Z"
                fill="${baseColor}" fill-opacity="0.5" />
        </g>
      </svg>
    `,
    bounds: { width, height, depth },
  }
}

function setActionMessage(message, tone = 'neutral') {
  actionMessage.value = message
  actionTone.value = tone
}

function escapeXmlText(value = '') {
  return String(value || '').replace(/[<>&'"]/g, (char) => {
    return {
      '<': '&lt;',
      '>': '&gt;',
      '&': '&amp;',
      '\'': '&apos;',
      '"': '&quot;',
    }[char] || char
  })
}

function formatRssDate(value = 0) {
  const timestamp = Number(value || 0)
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return new Date().toUTCString()
  }

  return new Date(timestamp).toUTCString()
}

function buildRssFeedXml() {
  const feedUrl = buildSpaceWorldsUrl(props.spaceName)
  const channelTitle = `${brandTitle.value} RSS`
  const channelDescription = String(galleryProfile.value?.bio || `Recent projections from ${brandTitle.value}`).trim()
  const itemsXml = galleryItems.value.map((item) => {
    const routeId = getProjectionRouteId(item)
    const itemUrl = routeId ? buildSpaceProjectionUrl(props.spaceName, routeId) : feedUrl
    const itemTitle = item?.title || item?.schematic?.name || routeId || 'World'
    const itemDescription = item?.description || `${getProjectionBlockCount(item)} blocks`
    const itemDate = formatRssDate(item?.updatedAt || item?.createdAt)
    const guid = `${props.spaceName}:${routeId || item?.id || itemTitle}`

    return [
      '    <item>',
      `      <title>${escapeXmlText(itemTitle)}</title>`,
      `      <description>${escapeXmlText(itemDescription)}</description>`,
      `      <link>${escapeXmlText(itemUrl)}</link>`,
      `      <guid>${escapeXmlText(guid)}</guid>`,
      `      <pubDate>${escapeXmlText(itemDate)}</pubDate>`,
      '    </item>',
    ].join('\n')
  }).join('\n')

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    '  <channel>',
    `    <title>${escapeXmlText(channelTitle)}</title>`,
    `    <link>${escapeXmlText(feedUrl)}</link>`,
    `    <description>${escapeXmlText(channelDescription)}</description>`,
    `    <lastBuildDate>${escapeXmlText(formatRssDate(Date.now()))}</lastBuildDate>`,
    itemsXml,
    '  </channel>',
    '</rss>',
  ].filter(Boolean).join('\n')
}

function releaseActiveRssFeedUrl() {
  if (activeRssFeedUrl) {
    URL.revokeObjectURL(activeRssFeedUrl)
    activeRssFeedUrl = ''
  }
}

function openRssFeed() {
  if (!props.spaceName) {
    return
  }

  releaseActiveRssFeedUrl()

  const xml = buildRssFeedXml()
  const blob = new Blob([xml], { type: 'application/rss+xml;charset=utf-8' })
  activeRssFeedUrl = URL.createObjectURL(blob)

  const openedWindow = window.open(activeRssFeedUrl, '_blank', 'noopener')
  if (!openedWindow) {
    const anchor = document.createElement('a')
    anchor.href = activeRssFeedUrl
    anchor.download = `${props.spaceName}-feed.xml`
    anchor.click()
  }

  setActionMessage('已生成当前 Space 的 RSS Feed', 'success')
}

function handleDocumentClick(event) {
  if (!authMenuRef.value?.contains?.(event.target)) {
    authMenuOpen.value = false
  }
}

function toggleAuthMenu() {
  authMenuOpen.value = !authMenuOpen.value
}

function syncCurrentView() {
  currentView.value = resolveCurrentView()
}

function openProfileSettings() {
  if (!canEditProfileSettings.value) {
    if (!authSession.value) {
      authMenuOpen.value = true
      setActionMessage('登录后可进入 Profile Settings', 'neutral')
    }
    else {
      setActionMessage('当前账号没有编辑这个 Space Profile 的权限', 'warning')
    }
    return
  }

  authMenuOpen.value = false
  navigateToUrl(`${buildSpaceWorldsUrl(props.spaceName)}${PROFILE_SETTINGS_HASH}`)
}

function closeProfileSettings() {
  authMenuOpen.value = false
  navigateToUrl(buildSpaceWorldsUrl(props.spaceName))
}

function openProfileSettingsFromMenu() {
  authMenuOpen.value = false
  openProfileSettings()
}

async function persistProfileTitle(nextTitle, { closeAfterSave = false } = {}) {
  if (!authSession.value || !canEditProfileSettings.value) {
    setActionMessage('当前账号无法保存这个 Space 的 Profile Title', 'warning')
    return
  }

  isSavingProfile.value = true

  try {
    const payload = await claimGallerySpace({
      spaceName: props.spaceName,
      displayName: galleryProfile.value?.ownerName || viewerDisplayName.value || props.spaceName,
      bio: galleryProfile.value?.bio || '',
      title: String(nextTitle || '').trim(),
      session: authSession.value,
    })

    if (payload?.profile) {
      galleryProfile.value = payload.profile
    }

    setActionMessage(
      String(nextTitle || '').trim()
        ? 'Profile Title 已保存'
        : '已恢复默认 Title',
      'success',
    )

    if (closeAfterSave) {
      closeProfileSettings()
    }
  }
  catch (error) {
    setActionMessage(error?.message || '保存 Profile Title 失败', 'warning')
  }
  finally {
    isSavingProfile.value = false
  }
}

function handleSaveProfileTitle(nextTitle) {
  void persistProfileTitle(nextTitle, { closeAfterSave: true })
}

function handleResetProfileTitle() {
  void persistProfileTitle('', { closeAfterSave: false })
}

function handleRouteChanged() {
  syncCurrentView()
  authMenuOpen.value = false
}

async function loadWorlds() {
  if (!props.spaceName) {
    return
  }

  isLoading.value = true
  loadError.value = ''

  try {
    const payload = await fetchGallery(props.spaceName, authSession.value)
    const safePayload = payload && typeof payload === 'object' ? payload : {}
    galleryProfile.value = safePayload.profile || null
    galleryItems.value = Array.isArray(safePayload.items) ? safePayload.items : []
    galleryViewer.value = safePayload.viewer || {
      authenticated: false,
      account: null,
      canManage: false,
    }
  }
  catch (error) {
    loadError.value = error?.message || '读取投影列表失败'
  }
  finally {
    isLoading.value = false
  }
}

async function handleProviderAuth(provider) {
  if (isAuthenticating.value) {
    return
  }

  isAuthenticating.value = true
  authError.value = ''

  try {
    authSession.value = await signInWithProvider(provider)
    setActionMessage(`已登录为 ${viewerDisplayName.value || '当前账户'}`, 'success')
    await loadWorlds()
  }
  catch (error) {
    authError.value = error?.message || '登录失败'
  }
  finally {
    isAuthenticating.value = false
  }
}

function getProjectionAuthor(item) {
  return item?.schematic?.author || 'Unknown'
}

function getProjectionBlockCount(item) {
  const preview = resolveProjectionPreview(item)
  return Number(preview?.totalSolidBlocks || item?.schematic?.blockCount || 0)
}

function logout() {
  if (isLocalDevSession.value) {
    setActionMessage('当前是本地开发会话，刷新页面后会自动重新启用。', 'neutral')
    authMenuOpen.value = false
    return
  }

  clearAdminAuthSession()
  authSession.value = null
  galleryProfile.value = null
  galleryItems.value = []
  galleryViewer.value = {
    authenticated: false,
    account: null,
    canManage: false,
  }
  authMenuOpen.value = false
  setActionMessage('已退出登录', 'neutral')

  if (isProfileSettingsView.value) {
    closeProfileSettings()
  }
}

async function handleDeleteProjection(itemOrId) {
  const item = itemOrId && typeof itemOrId === 'object' ? itemOrId : null
  const itemId = String(item?.id || itemOrId || '').trim()
  if (!itemId) {
    return
  }

  try {
    await deleteGalleryItem(props.spaceName, item || itemId, authSession.value)
    galleryItems.value = galleryItems.value.filter(item => item?.id !== itemId)
    pendingDeleteItemId.value = ''
    setActionMessage('投影已删除', 'success')
    await loadWorlds()
  }
  catch (error) {
    setActionMessage(error?.message || '删除投影失败', 'warning')
  }
}

function enterProjection(itemId) {
  if (!itemId || !props.spaceName) {
    return
  }

  navigateToUrl(buildSpaceProjectionUrl(props.spaceName, itemId))
}

function handleAuthChanged(event) {
  authSession.value = event?.detail?.session || loadAdminAuthSession()
  authMenuOpen.value = false
  syncCurrentView()
  void loadWorlds()
}

function handleGalleryChanged(event) {
  const detailSpaceName = String(event?.detail?.spaceName || '').trim().toLowerCase()
  if (!detailSpaceName || detailSpaceName !== String(props.spaceName || '').trim().toLowerCase()) {
    return
  }

  void loadWorlds()
}

onMounted(() => {
  window.addEventListener('admin-auth-changed', handleAuthChanged)
  window.addEventListener('gallery:changed', handleGalleryChanged)
  window.addEventListener('popstate', handleRouteChanged)
  window.addEventListener('hashchange', handleRouteChanged)
  document.addEventListener('click', handleDocumentClick)
  syncCurrentView()
  void loadWorlds()
})

onBeforeUnmount(() => {
  window.removeEventListener('admin-auth-changed', handleAuthChanged)
  window.removeEventListener('gallery:changed', handleGalleryChanged)
  window.removeEventListener('popstate', handleRouteChanged)
  window.removeEventListener('hashchange', handleRouteChanged)
  document.removeEventListener('click', handleDocumentClick)
  releaseActiveRssFeedUrl()
})

watch(
  () => props.spaceName,
  () => {
    syncCurrentView()
    void loadWorlds()
  },
)
</script>

<template>
  <SpaceNotFoundPage
    v-if="!isLoading && !loadError && isMissingSpace"
    :space-name="spaceName"
  />

  <main v-else class="worlds-shell">
    <header class="worlds-topbar">
      <div class="worlds-topbar-inner">
        <div class="worlds-brand">
          <button
            type="button"
            class="brand-avatar-button"
            :class="{ disabled: !canEditProfileSettings }"
            :disabled="!canEditProfileSettings"
            @click="openProfileSettings"
          >
            <span class="brand-avatar">
              <img v-if="brandAvatar" :src="brandAvatar" :alt="brandTitle">
              <span v-else>{{ brandAvatarInitial }}</span>
            </span>
          </button>

          <div class="brand-copy">
            <button
              type="button"
              class="brand-title-button"
              :disabled="!isProfileSettingsView && !canEditProfileSettings"
              @click="isProfileSettingsView ? closeProfileSettings() : openProfileSettings()"
            >
              <span class="title-text">{{ brandTitle }}</span>
              <span class="subtitle-text">{{ brandSubtitle }}</span>
            </button>
          </div>

          <div class="brand-icon-row">
            <a
              class="brand-icon-button"
              :href="LITEMORA_REPOSITORY_URL"
              target="_blank"
              rel="noreferrer"
              title="Open GitHub repository"
              aria-label="Open GitHub repository"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                <path d="M12 .5a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.05c-3.34.73-4.04-1.42-4.04-1.42-.55-1.38-1.33-1.75-1.33-1.75-1.09-.74.08-.73.08-.73 1.2.08 1.83 1.23 1.83 1.23 1.07 1.84 2.81 1.31 3.49 1 .11-.78.42-1.31.76-1.61-2.66-.3-5.47-1.33-5.47-5.91 0-1.31.47-2.38 1.23-3.22-.12-.3-.53-1.52.12-3.17 0 0 1.01-.32 3.3 1.23a11.4 11.4 0 0 1 6 0c2.29-1.55 3.29-1.23 3.29-1.23.66 1.65.25 2.87.13 3.17.77.84 1.23 1.91 1.23 3.22 0 4.59-2.81 5.61-5.49 5.9.43.37.82 1.09.82 2.2v3.26c0 .32.22.7.83.58A12 12 0 0 0 12 .5Z"></path>
              </svg>
            </a>
            <button
              type="button"
              class="brand-icon-button"
              title="Open RSS feed"
              aria-label="Open RSS feed"
              @click="openRssFeed"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M4 11a9 9 0 0 1 9 9"></path>
                <path d="M4 4a16 16 0 0 1 16 16"></path>
                <circle cx="5" cy="19" r="1"></circle>
              </svg>
            </button>
          </div>
        </div>

        <div ref="authMenuRef" class="worlds-topbar-actions">
          <div class="auth-popover">
            <button type="button" class="auth-trigger" :class="{ active: authMenuOpen }" @click.stop="toggleAuthMenu">
              <span class="auth-trigger-label">{{ authSession ? 'Account' : 'Login' }}</span>
              <template v-if="authSession">
                <span class="auth-account compact">
                  <span class="auth-avatar compact">
                    <img v-if="viewerAvatar" :src="viewerAvatar" :alt="viewerDisplayName">
                    <span v-else>{{ viewerInitial }}</span>
                  </span>
                </span>
              </template>
              <template v-else>
                <span class="auth-trigger-arrow">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                    <path d="M12 .5a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.05c-3.34.73-4.04-1.42-4.04-1.42-.55-1.38-1.33-1.75-1.33-1.75-1.09-.74.08-.73.08-.73 1.2.08 1.83 1.23 1.83 1.23 1.07 1.84 2.81 1.31 3.49 1 .11-.78.42-1.31.76-1.61-2.66-.3-5.47-1.33-5.47-5.91 0-1.31.47-2.38 1.23-3.22-.12-.3-.53-1.52.12-3.17 0 0 1.01-.32 3.3 1.23a11.4 11.4 0 0 1 6 0c2.29-1.55 3.29-1.23 3.29-1.23.66 1.65.25 2.87.13 3.17.77.84 1.23 1.91 1.23 3.22 0 4.59-2.81 5.61-5.49 5.9.43.37.82 1.09.82 2.2v3.26c0 .32.22.7.83.58A12 12 0 0 0 12 .5Z"></path>
                  </svg>
                </span>
              </template>
            </button>

            <div v-if="authMenuOpen" class="auth-menu">
              <template v-if="authSession">
                <div class="auth-menu-header">
                  <div class="menu-account-copy">
                    <span class="account-name">{{ viewerDisplayName }}</span>
                    <span class="account-email">{{ viewerEmail || 'local@litemora.dev' }}</span>
                  </div>
                </div>

                <button type="button" class="auth-menu-item" @click="openProfileSettingsFromMenu">
                  <span class="menu-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M12 14a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"></path>
                      <path d="M4 20a8 8 0 0 1 16 0"></path>
                    </svg>
                  </span>
                  <span>Profile Settings</span>
                </button>

                <button type="button" class="auth-menu-item danger" @click="logout">
                  <span class="menu-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                      <path d="m16 17 5-5-5-5"></path>
                      <path d="M21 12H9"></path>
                    </svg>
                  </span>
                  <span>Log out</span>
                </button>
              </template>

              <template v-else>
                <div class="auth-menu-title">选择登录方式</div>
                <button
                  v-for="provider in authProviders"
                  :key="provider.id"
                  type="button"
                  class="auth-menu-item"
                  :disabled="isAuthenticating"
                  @click="handleProviderAuth(provider.id)"
                >
                  <span class="menu-icon" aria-hidden="true">
                    <svg v-if="provider.id === 'github'" viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                      <path d="M12 .5a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.05c-3.34.73-4.04-1.42-4.04-1.42-.55-1.38-1.33-1.75-1.33-1.75-1.09-.74.08-.73.08-.73 1.2.08 1.83 1.23 1.83 1.23 1.07 1.84 2.81 1.31 3.49 1 .11-.78.42-1.31.76-1.61-2.66-.3-5.47-1.33-5.47-5.91 0-1.31.47-2.38 1.23-3.22-.12-.3-.53-1.52.12-3.17 0 0 1.01-.32 3.3 1.23a11.4 11.4 0 0 1 6 0c2.29-1.55 3.29-1.23 3.29-1.23.66 1.65.25 2.87.13 3.17.77.84 1.23 1.91 1.23 3.22 0 4.59-2.81 5.61-5.49 5.9.43.37.82 1.09.82 2.2v3.26c0 .32.22.7.83.58A12 12 0 0 0 12 .5Z"></path>
                    </svg>
                  </span>
                  <span>{{ isAuthenticating ? '登录中...' : `使用 ${provider.label} 登录` }}</span>
                </button>
              </template>
            </div>
          </div>
        </div>
      </div>
    </header>

    <section class="worlds-main">
      <div v-if="actionMessage" class="banner" :class="actionTone">
        {{ actionMessage }}
      </div>
      <div v-if="loadError" class="banner warning">
        {{ loadError }}
      </div>
      <div v-if="authError" class="banner warning">
        {{ authError }}
      </div>

      <SpaceProfileSettingsPage
        v-if="isProfileSettingsView"
        :space-name="spaceName"
        :title-value="galleryProfile?.title || ''"
        :preview-title="brandTitle"
        :display-name="brandOwnerName"
        :avatar-url="brandAvatar"
        :avatar-fallback="brandAvatarInitial"
        :is-authenticated="!!authSession"
        :can-edit="canEditProfileSettings"
        :is-saving="isSavingProfile"
        @back="closeProfileSettings"
        @save-title="handleSaveProfileTitle"
        @reset-title="handleResetProfileTitle"
        @open-rss="openRssFeed"
      />

      <div v-else class="worlds-gallery">
          <div class="gallery-head">
            <h2>所有投影</h2>
            <span class="count-badge">{{ galleryItems.length }} Worlds</span>
          </div>

          <div v-if="isLoading" class="empty-state">
            <span class="loading-text">正在同步世界目录...</span>
          </div>

          <div v-else-if="galleryItems.length === 0 && !canManageProjections" class="empty-state">
            <span class="empty-title">还没有任何世界</span>
            <span class="empty-desc">当前 Space 尚未公开任何投影。</span>
          </div>

          <div v-else-if="galleryItems.length === 0 && canManageProjections" class="card-grid">
            <article
              class="world-card placeholder-card"
              @click="openAdminConfigPage"
            >
              <div class="world-card-thumb placeholder-thumb">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="add-icon">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="8" x2="12" y2="16"></line>
                  <line x1="8" y1="12" x2="16" y2="12"></line>
                </svg>
              </div>
              <div class="world-card-content">
                <h3 class="world-title">创建新的投影</h3>
                <p class="world-desc">点击开始上传 .litematic 或 .schem，并创建这个 Space 的第一个投影</p>
              </div>
            </article>
          </div>

          <div v-else class="card-grid">
            <article
              v-if="canManageProjections"
              class="world-card placeholder-card"
              @click="openAdminConfigPage"
            >
              <div class="world-card-thumb placeholder-thumb">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="add-icon">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="8" x2="12" y2="16"></line>
                  <line x1="8" y1="12" x2="16" y2="12"></line>
                </svg>
              </div>
              <div class="world-card-content">
                <h3 class="world-title">创建新的投影</h3>
                <p class="world-desc">点击上传新的原理图投影，并为它配置公开性与世界参数</p>
              </div>
            </article>

            <article
              v-for="item in galleryItems"
              :key="item.id"
              class="world-card"
              @click="enterProjection(item.projectionSlug || item.id)"
            >
              <div class="world-card-thumb">
                <div
                  class="thumb-placeholder"
                  :class="{
                    'has-custom-thumb': !!resolveProjectionThumbnailAsset(item).generated,
                    'has-image-thumb': !!resolveProjectionThumbnailAsset(item).imageUrl,
                  }"
                >
                  <template v-if="resolveProjectionThumbnailAsset(item).imageUrl">
                    <img
                      class="thumb-image"
                      :src="resolveProjectionThumbnailAsset(item).imageUrl"
                      :alt="`${item.title} preview`"
                    >
                  </template>
                  <template v-else-if="resolveProjectionThumbnailAsset(item).generated">
                    <div class="custom-thumb" v-html="resolveProjectionThumbnailAsset(item).generated.svg" />
                  </template>
                  <template v-else>
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" class="thumb-icon">
                      <path fill-rule="evenodd" clip-rule="evenodd" d="M12 21.05L2.8 15.35V8.65L12 2.95L21.2 8.65V15.35L12 21.05ZM12 18.2917L18.8 14.075V9.925L12 5.70834L5.2 9.925V14.075L12 18.2917Z" fill="white" fill-opacity="0.1" />
                      <path d="M12 11V18" stroke="white" stroke-opacity="0.2" stroke-width="1.5" stroke-linecap="round" />
                      <path d="M5.5 8L12 11" stroke="white" stroke-opacity="0.2" stroke-width="1.5" stroke-linecap="round" />
                      <path d="M18.5 8L12 11" stroke="white" stroke-opacity="0.2" stroke-width="1.5" stroke-linecap="round" />
                    </svg>
                  </template>
                </div>
                <div class="thumb-overlay">
                  <div class="thumb-badges">
                    <span class="tag-badge version-tag">.LITEMATIC</span>
                    <span
                      v-if="canManageProjections"
                      class="tag-badge visibility-tag"
                      :class="{ private: item.visibility === 'private' }"
                    >
                      {{ item.visibility === 'private' ? '私有' : '公开' }}
                    </span>
                  </div>
                </div>
              </div>

              <div class="world-card-content">
                <h3 class="world-title">{{ item.title }}</h3>
                <p class="world-desc">{{ item.description || '点击此卡片可直接进入这个 3D 投影世界，并在浏览器中进行游览。' }}</p>

                <div class="world-meta">
                  <div class="meta-item">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                    <span>{{ getProjectionAuthor(item) }}</span>
                  </div>
                  <div class="meta-item">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
                    <span>{{ getProjectionBlockCount(item) }} Blocks</span>
                  </div>
                </div>

                <div v-if="canManageProjections" class="world-actions" @click.stop>
                  <button
                    type="button"
                    class="btn-settings"
                    title="世界设置"
                    @click.stop.prevent="openProjectionSettings(item)"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82 2 2 0 1 1-2.83 2.83 1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51 2 2 0 1 1-4 0 1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33 2 2 0 1 1-2.83-2.83 1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1 2 2 0 1 1 0-4 1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82 2 2 0 1 1 2.83-2.83 1.65 1.65 0 0 0 1.82.33h.01A1.65 1.65 0 0 0 10 2.6a2 2 0 1 1 4 0 1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33 2 2 0 1 1 2.83 2.83 1.65 1.65 0 0 0-.33 1.82v.01A1.65 1.65 0 0 0 21.4 10a2 2 0 1 1 0 4 1.65 1.65 0 0 0-1.51 1Z"></path></svg>
                    <span>设置</span>
                  </button>
                  <button
                    v-if="pendingDeleteItemId !== item.id"
                    type="button"
                    class="btn-delete"
                    title="删除"
                    @click.stop.prevent="pendingDeleteItemId = item.id"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                  </button>
                  <button
                    v-else
                    type="button"
                    class="btn-delete-confirm"
                    @click.stop.prevent="handleDeleteProjection(item)"
                  >
                    确认删除
                  </button>
                </div>
              </div>
            </article>
          </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
.worlds-shell {
  min-height: 100vh;
  background:
    radial-gradient(circle at top left, rgba(136, 194, 248, 0.16), transparent 34%),
    radial-gradient(circle at 85% 15%, rgba(126, 231, 191, 0.12), transparent 26%),
    linear-gradient(180deg, #081018 0%, #0d1419 48%, #10161d 100%);
  color: #edf4f7;
}

/* 顶部导航通栏化，去除顶部留白和粗重感 */
.worlds-topbar {
  width: 100%;
  position: relative;
  background: rgba(17, 19, 22, 0.96);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(112, 159, 197, 0.15);
  margin-bottom: 2rem;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
}

.worlds-topbar::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, rgba(90, 171, 255, 0.9) 0%, rgba(111, 210, 255, 0.7) 55%, rgba(90, 171, 255, 0.4) 100%);
}

.worlds-topbar-inner {
  width: min(1280px, calc(100% - 2rem));
  margin: 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  padding: 0.6rem 0;
}

.worlds-main {
  width: min(1280px, calc(100% - 2rem));
  margin: 0 auto;
  display: grid;
  gap: 1rem;
  padding-bottom: 3rem;
}

.worlds-brand {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.brand-avatar-button {
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
}

.brand-avatar-button.disabled {
  cursor: default;
}

.brand-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  overflow: hidden;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: linear-gradient(135deg, #213241 0%, #6a8da7 100%);
  border: 1px solid rgba(116, 181, 236, 0.25);
  color: #f4f8ff;
  font-weight: 600;
  font-size: 1.1rem;
}

.brand-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.brand-copy {
  min-width: 0;
}

.brand-title-button {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 0.1rem;
  padding: 0;
  border: none;
  background: transparent;
  text-align: left;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.brand-title-button:disabled {
  cursor: default;
}

.title-text {
  max-width: min(48vw, 400px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 1.05rem;
  letter-spacing: -0.02em;
  font-weight: 600;
}

.subtitle-text {
  color: #8da8b8;
  font-size: 0.75rem;
}

.brand-icon-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-left: 0.5rem;
}

.brand-icon-button {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  background: transparent;
  color: #a4b9c7;
  text-decoration: none;
  transition: all 0.2s ease;
}

.brand-icon-button:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(116, 181, 236, 0.24);
  color: #f4fbff;
}

.worlds-topbar-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-left: auto;
}

.auth-popover {
  position: relative;
}

.auth-trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0.35rem 0.3rem 0.7rem;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.03);
  color: #edf4f7;
  cursor: pointer;
  height: 36px;
  transition: background 0.2s ease;
}

.auth-trigger:hover,
.auth-trigger.active {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(126, 188, 211, 0.2);
}

.auth-account {
  display: inline-flex;
  align-items: center;
}

.auth-trigger-label {
  font-size: 0.85rem;
  font-weight: 500;
}

.auth-trigger-arrow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #a5b9c7;
  margin-right: 0.25rem;
}

.auth-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  overflow: hidden;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: linear-gradient(135deg, #233445 0%, #5f8191 100%);
  color: #f4f7fb;
  font-size: 0.85rem;
  font-weight: 600;
}

.auth-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.auth-menu {
  position: absolute;
  top: calc(100% + 0.5rem);
  right: 0;
  width: 240px;
  padding: 0.5rem;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(22, 28, 33, 0.98);
  backdrop-filter: blur(14px);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.3);
  z-index: 20;
}

.auth-menu-header {
  padding: 0.5rem 0.5rem 0.8rem;
  margin-bottom: 0.25rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.menu-account-copy {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.15rem;
}

.account-name {
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.9rem;
  font-weight: 500;
  color: #edf4f7;
}

.account-email {
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #728b9c;
  font-size: 0.75rem;
}

.auth-menu-title {
  padding: 0.5rem 0.5rem 0.4rem;
  color: rgba(255, 255, 255, 0.4);
  font-size: 0.8rem;
}

.auth-menu-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.6rem;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #edf4f7;
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
  transition: background 0.2s ease;
}

.auth-menu-item:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
}

.auth-menu-item:disabled {
  opacity: 0.6;
  cursor: wait;
}

.auth-menu-item.danger {
  color: #ff695f;
  margin-top: 0.25rem;
}

.auth-menu-item.danger:hover:not(:disabled) {
  background: rgba(255, 105, 95, 0.1);
}

.menu-icon {
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: currentColor;
  flex-shrink: 0;
}

.banner {
  padding: 0.8rem 1rem;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.06);
  font-size: 0.9rem;
}

.banner.success {
  background: rgba(68, 180, 119, 0.12);
  color: #a4f2c5;
}

.banner.warning {
  background: rgba(227, 172, 83, 0.12);
  color: #ffe3b1;
}

.worlds-gallery {
  display: grid;
  gap: 1.25rem;
  align-content: start;
}

.gallery-head {
  display: flex;
  align-items: center;
  gap: 0.8rem;
}

.gallery-head h2 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.count-badge {
  background: rgba(255, 255, 255, 0.06);
  padding: 0.25rem 0.5rem;
  border-radius: 999px;
  font-size: 0.75rem;
  color: #8da4b4;
}

.empty-state {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 3.5rem 2rem;
  text-align: center;
  background: rgba(255, 255, 255, 0.02);
  border: 1px dashed rgba(255, 255, 255, 0.08);
  border-radius: 16px;
}

.loading-text, .empty-title {
  color: #edf4f7;
  font-size: 1rem;
  font-weight: 500;
}

.empty-desc {
  color: #728b9c;
  font-size: 0.85rem;
}

.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 1.25rem;
}

.world-card {
  display: flex;
  flex-direction: column;
  background: rgba(15, 21, 27, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 16px;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.3s ease;
}

.world-card:hover {
  transform: translateY(-2px);
  border-color: rgba(255, 255, 255, 0.12);
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.2);
}

.world-card-thumb {
  position: relative;
  aspect-ratio: 16 / 9;
  background: radial-gradient(circle at top right, #1f2a35, #0a1118);
  overflow: hidden;
}

.thumb-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.4s ease;
}

.thumb-placeholder.has-custom-thumb {
  background: radial-gradient(circle at 30% 30%, #2a3f50, #0d1419);
}

.thumb-placeholder.has-image-thumb {
  background:
    radial-gradient(circle at 20% 20%, rgba(126, 189, 228, 0.2), transparent 40%),
    linear-gradient(180deg, #091018 0%, #0c1620 100%);
}

.thumb-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.custom-thumb {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.custom-thumb svg {
  max-width: 75%;
  max-height: 75%;
}

.world-card:hover .thumb-placeholder {
  transform: scale(1.03);
}

.thumb-icon {
  width: 54px;
  height: 54px;
}

.thumb-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(0deg, rgba(8, 16, 24, 0.7) 0%, transparent 50%);
  padding: 0.8rem;
  display: flex;
  align-items: flex-end;
  justify-content: flex-start;
}

.thumb-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.tag-badge {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(4px);
  color: #fff;
  font-size: 0.6rem;
  font-weight: 600;
  padding: 0.2rem 0.4rem;
  border-radius: 4px;
}

.version-tag {
  background: rgba(121, 203, 167, 0.15);
  color: #bbf4d9;
}

.visibility-tag {
  background: rgba(119, 175, 255, 0.12);
  color: #cfe0ff;
}

.visibility-tag.private {
  background: rgba(255, 159, 67, 0.12);
  color: #ffd7a8;
}

.world-card-content {
  position: relative;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  flex: 1;
}

.world-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 500;
  color: #fff;
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.world-desc {
  margin: 0.5rem 0 0;
  font-size: 0.8rem;
  color: #728b9c;
  line-height: 1.5;
  flex: 1;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.world-meta {
  margin-top: 1rem;
  display: flex;
  gap: 0.8rem;
  color: #5c7485;
  font-size: 0.75rem;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 0.3rem;
}

.world-actions {
  position: absolute;
  top: 1rem;
  right: 1rem;
  display: flex;
  gap: 0.4rem;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.world-card:hover .world-actions {
  opacity: 1;
}

.btn-settings,
.btn-delete {
  background: rgba(22, 33, 43, 0.9);
  color: #c4d9e6;
  border: 1px solid rgba(255, 255, 255, 0.08);
  height: 28px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
  backdrop-filter: blur(8px);
}

.btn-settings {
  gap: 0.3rem;
  padding: 0 0.6rem;
  font-size: 0.75rem;
}

.btn-settings:hover {
  background: rgba(32, 48, 62, 0.95);
  color: #fff;
  border-color: rgba(255, 255, 255, 0.15);
}

.btn-delete {
  background: rgba(220, 53, 69, 0.1);
  color: #ff6b7b;
  border: 1px solid rgba(220, 53, 69, 0.15);
  width: 28px;
  padding: 0;
}

.btn-delete:hover {
  background: rgba(220, 53, 69, 0.2);
  color: #ff8e9b;
}

.btn-delete-confirm {
  background: #dc3545;
  color: #fff;
  border: none;
  height: 28px;
  padding: 0 0.6rem;
  border-radius: 6px;
  font-size: 0.75rem;
  cursor: pointer;
}

.placeholder-card {
  border: 1px dashed rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.02);
}

.placeholder-card:hover {
  border-color: rgba(126, 189, 228, 0.3);
  background: rgba(126, 189, 228, 0.04);
}

.placeholder-thumb {
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
}

.add-icon {
  color: rgba(255, 255, 255, 0.15);
  transition: transform 0.2s ease, color 0.2s ease;
}

.placeholder-card:hover .add-icon {
  transform: scale(1.05);
  color: rgba(126, 189, 228, 0.6);
}

@media (max-width: 960px) {
  .card-grid {
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  }
}

@media (max-width: 760px) {
  .worlds-topbar {
    margin-bottom: 1.5rem;
  }

  .worlds-topbar-inner {
    padding: 0.5rem 0;
  }

  .title-text {
    max-width: 100%;
    white-space: normal;
  }

  .brand-icon-row {
    margin-left: 0;
  }

  .auth-trigger {
    padding: 0.25rem 0.3rem 0.25rem 0.6rem;
    height: 32px;
  }

  .auth-avatar {
    width: 24px;
    height: 24px;
  }

  .auth-menu {
    width: min(280px, calc(100vw - 1rem));
  }

  .world-actions {
    opacity: 1;
  }
}
</style>