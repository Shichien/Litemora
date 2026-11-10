<script setup>
import { isLocalDevAuthSession } from '@three/auth/admin-auth.js'
import {
  claimGallerySpace,
  deleteGalleryItem,
  fetchGallery,
} from '@three/gallery/gallery-api.js'
import { navigateToUrl } from '@three/utils/navigation.js'
import { buildSpaceProjectionUrl, buildSpaceWorldsAdminUrl, buildSpaceWorldsUrl } from '@three/utils/space-context.js'
import { getStaticThumbnailUrl, loadThumbnailManifest } from '@/js/gallery/world-thumbnails.js'
import IsoScene from '@ui-components/redstone/IsoScene.vue'
import { redstoneCircuitScene } from '@ui-components/redstone/iso-presets.js'
import RedstoneCredits from '@ui-components/redstone/RedstoneCredits.vue'
import SpaceBreadcrumbs from '@ui-components/space/SpaceBreadcrumbs.vue'
import SpaceNotFoundPage from '@ui-components/space/SpaceNotFoundPage.vue'
import SpaceProfileSettingsPage from '@ui-components/space/SpaceProfileSettingsPage.vue'
import SpaceWorldCard from '@ui-components/space/SpaceWorldCard.vue'
import { useGalleryAuth } from '@ui/composables/useGalleryAuth.js'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  spaceName: {
    type: String,
    default: '',
  },
})

const LITEMORA_REPOSITORY_URL = 'https://github.com/Shichien/Litemora'
const PROFILE_SETTINGS_HASH = '#profile-settings'

const {
  authProviders,
  authSession,
  isAuthenticating,
  authError,
  handleProviderAuth,
  logout: clearAuthSession,
} = useGalleryAuth({
  onAuthenticated: session => handleSignedIn(session),
  onSessionChange: () => handleAuthSessionChanged(),
})

const galleryProfile = ref(null)
const galleryItems = ref([])
const galleryViewer = ref({
  authenticated: false,
  account: null,
  canManage: false,
})

const isLoading = ref(false)
const loadError = ref('')
const actionMessage = ref('')
const actionTone = ref('neutral')
const pendingDeleteItemId = ref('')
const authMenuOpen = ref(false)
const authMenuRef = ref(null)
const isSavingProfile = ref(false)
const thumbnailManifest = ref({})

const { t, locale } = useI18n()
const heroScene = redstoneCircuitScene()
const SKELETON_CARDS = 4

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
const viewerAvatar = computed(() => authSession.value?.account?.avatar || '')
const viewerInitial = computed(() => viewerDisplayName.value.slice(0, 1).toUpperCase() || 'L')

function handleSignedIn() {
  setActionMessage(`已登录为 ${viewerDisplayName.value || '当前账户'}`, 'success')
  return loadWorlds()
}

function handleAuthSessionChanged() {
  authMenuOpen.value = false
  syncCurrentView()
  void loadWorlds()
}

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

const totalBlockCount = computed(() => {
  return galleryItems.value.reduce((sum, item) => sum + getProjectionBlockCount(item), 0)
})
const numberFormatter = computed(() => new Intl.NumberFormat(locale.value === 'zh' ? 'zh-CN' : 'en-US'))
const isArchivePowered = computed(() => !isLoading.value && galleryItems.value.length > 0)

function formatNumber(value) {
  return numberFormatter.value.format(Number(value) || 0)
}
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

function resolveCardImageUrl(item) {
  // Admin-uploaded image first, then the static capture; '' means generated art.
  const uploaded = String(item?.thumbnailDataUrl || '').trim()
  if (uploaded) {
    return uploaded
  }

  return getStaticThumbnailUrl(thumbnailManifest.value, props.spaceName, getProjectionRouteId(item))
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

  clearAuthSession()
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

function handleGalleryChanged(event) {
  const detailSpaceName = String(event?.detail?.spaceName || '').trim().toLowerCase()
  if (!detailSpaceName || detailSpaceName !== String(props.spaceName || '').trim().toLowerCase()) {
    return
  }

  void loadWorlds()
}

onMounted(() => {
  window.addEventListener('gallery:changed', handleGalleryChanged)
  window.addEventListener('popstate', handleRouteChanged)
  window.addEventListener('hashchange', handleRouteChanged)
  document.addEventListener('click', handleDocumentClick)
  syncCurrentView()
  void loadWorlds()
  void loadThumbnailManifest().then((manifest) => {
    thumbnailManifest.value = manifest
  })
})

onBeforeUnmount(() => {
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

  <main v-else class="worlds-shell rs-bg-deepslate">
    <header class="worlds-topbar">
      <div class="worlds-topbar-inner">
        <SpaceBreadcrumbs
          class="topbar-crumbs"
          variant="inline"
          :space-name="spaceName"
          :current-label="isProfileSettingsView ? 'Profile Settings' : ''"
        />

        <div class="worlds-topbar-actions">
          <div class="brand-icon-row">
            <a
              class="brand-icon-button rs-btn rs-btn--ghost rs-btn--sm rs-btn--icon"
              :href="LITEMORA_REPOSITORY_URL"
              target="_blank"
              rel="noreferrer"
              title="Open GitHub repository"
              aria-label="Open GitHub repository"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                <path d="M12 .5a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.05c-3.34.73-4.04-1.42-4.04-1.42-.55-1.38-1.33-1.75-1.33-1.75-1.09-.74.08-.73.08-.73 1.2.08 1.83 1.23 1.83 1.23 1.07 1.84 2.81 1.31 3.49 1 .11-.78.42-1.31.76-1.61-2.66-.3-5.47-1.33-5.47-5.91 0-1.31.47-2.38 1.23-3.22-.12-.3-.53-1.52.12-3.17 0 0 1.01-.32 3.3 1.23a11.4 11.4 0 0 1 6 0c2.29-1.55 3.29-1.23 3.29-1.23.66 1.65.25 2.87.13 3.17.77.84 1.23 1.91 1.23 3.22 0 4.59-2.81 5.61-5.49 5.9.43.37.82 1.09.82 2.2v3.26c0 .32.22.7.83.58A12 12 0 0 0 12 .5Z" />
              </svg>
            </a>
            <button
              type="button"
              class="brand-icon-button rs-btn rs-btn--ghost rs-btn--sm rs-btn--icon"
              title="Open RSS feed"
              aria-label="Open RSS feed"
              @click="openRssFeed"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M4 11a9 9 0 0 1 9 9" />
                <path d="M4 4a16 16 0 0 1 16 16" />
                <circle cx="5" cy="19" r="1" />
              </svg>
            </button>
          </div>

          <div ref="authMenuRef" class="auth-popover">
            <button
              type="button"
              class="auth-trigger rs-btn rs-btn--sm"
              :class="{ 'active': authMenuOpen, 'has-account': !!authSession }"
              :aria-expanded="authMenuOpen ? 'true' : 'false'"
              aria-haspopup="true"
              @click.stop="toggleAuthMenu"
            >
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
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                    <path d="M12 .5a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.05c-3.34.73-4.04-1.42-4.04-1.42-.55-1.38-1.33-1.75-1.33-1.75-1.09-.74.08-.73.08-.73 1.2.08 1.83 1.23 1.83 1.23 1.07 1.84 2.81 1.31 3.49 1 .11-.78.42-1.31.76-1.61-2.66-.3-5.47-1.33-5.47-5.91 0-1.31.47-2.38 1.23-3.22-.12-.3-.53-1.52.12-3.17 0 0 1.01-.32 3.3 1.23a11.4 11.4 0 0 1 6 0c2.29-1.55 3.29-1.23 3.29-1.23.66 1.65.25 2.87.13 3.17.77.84 1.23 1.91 1.23 3.22 0 4.59-2.81 5.61-5.49 5.9.43.37.82 1.09.82 2.2v3.26c0 .32.22.7.83.58A12 12 0 0 0 12 .5Z" />
                  </svg>
                </span>
              </template>
            </button>

            <div v-if="authMenuOpen" class="auth-menu rs-panel rs-panel--stone">
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
                      <path d="M12 14a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
                      <path d="M4 20a8 8 0 0 1 16 0" />
                    </svg>
                  </span>
                  <span>Profile Settings</span>
                </button>

                <button type="button" class="auth-menu-item danger" @click="logout">
                  <span class="menu-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <path d="m16 17 5-5-5-5" />
                      <path d="M21 12H9" />
                    </svg>
                  </span>
                  <span>Log out</span>
                </button>
              </template>

              <template v-else>
                <div class="auth-menu-title">
                  选择登录方式
                </div>
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
                      <path d="M12 .5a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.05c-3.34.73-4.04-1.42-4.04-1.42-.55-1.38-1.33-1.75-1.33-1.75-1.09-.74.08-.73.08-.73 1.2.08 1.83 1.23 1.83 1.23 1.07 1.84 2.81 1.31 3.49 1 .11-.78.42-1.31.76-1.61-2.66-.3-5.47-1.33-5.47-5.91 0-1.31.47-2.38 1.23-3.22-.12-.3-.53-1.52.12-3.17 0 0 1.01-.32 3.3 1.23a11.4 11.4 0 0 1 6 0c2.29-1.55 3.29-1.23 3.29-1.23.66 1.65.25 2.87.13 3.17.77.84 1.23 1.91 1.23 3.22 0 4.59-2.81 5.61-5.49 5.9.43.37.82 1.09.82 2.2v3.26c0 .32.22.7.83.58A12 12 0 0 0 12 .5Z" />
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
      <div v-if="actionMessage" class="banner" :class="actionTone" role="status">
        {{ actionMessage }}
      </div>
      <div v-if="loadError" class="banner warning" role="alert">
        {{ loadError }}
      </div>
      <div v-if="authError" class="banner warning" role="alert">
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

      <template v-else>
        <section
          class="worlds-hero rs-panel rs-panel--stone rs-panel--wired"
          :class="{ 'is-powered': isArchivePowered }"
        >
          <div class="hero-copy">
            <span class="rs-eyebrow hero-eyebrow">Space / {{ spaceName }}</span>

            <div class="worlds-brand">
              <button
                type="button"
                class="brand-avatar-button"
                :class="{ disabled: !canEditProfileSettings }"
                :disabled="!canEditProfileSettings"
                :aria-label="canEditProfileSettings ? 'Profile Settings' : brandTitle"
                @click="openProfileSettings"
              >
                <span class="brand-avatar">
                  <img v-if="brandAvatar" :src="brandAvatar" :alt="brandTitle">
                  <span v-else class="brand-avatar-initial">{{ brandAvatarInitial }}</span>
                </span>
              </button>

              <div class="brand-copy">
                <h1 class="brand-heading">
                  <button
                    type="button"
                    class="brand-title-button"
                    :disabled="!isProfileSettingsView && !canEditProfileSettings"
                    @click="isProfileSettingsView ? closeProfileSettings() : openProfileSettings()"
                  >
                    <span class="title-text">{{ brandTitle }}</span>
                  </button>
                </h1>
                <p class="subtitle-text">
                  {{ brandSubtitle }}
                </p>
              </div>
            </div>

            <dl class="hero-stats">
              <div class="hero-stat">
                <dt>{{ t('space.hero.worlds') }}</dt>
                <dd class="rs-pixel stat-number">
                  <span v-if="isLoading" class="stat-pending">···</span>
                  <template v-else>{{ formatNumber(galleryItems.length) }}</template>
                </dd>
              </div>
              <div class="hero-stat">
                <dt>{{ t('space.hero.blocks') }}</dt>
                <dd class="rs-pixel stat-number">
                  <span v-if="isLoading" class="stat-pending">···</span>
                  <template v-else>{{ formatNumber(totalBlockCount) }}</template>
                </dd>
              </div>
              <div class="hero-stat">
                <dt>{{ t('space.hero.curator') }}</dt>
                <dd class="stat-text">
                  {{ brandOwnerName }}
                </dd>
              </div>
            </dl>

            <div v-if="canManageProjections || canEditProfileSettings" class="hero-actions">
              <button
                v-if="canManageProjections"
                type="button"
                class="rs-btn rs-btn--primary"
                @click="openAdminConfigPage"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                <span>创建新的投影</span>
              </button>
              <button
                v-if="canEditProfileSettings"
                type="button"
                class="rs-btn rs-btn--dot"
                @click="openProfileSettings"
              >
                Profile Settings
              </button>
            </div>
          </div>

          <div v-if="isLoading || galleryItems.length" class="hero-art" aria-hidden="true">
            <IsoScene :blocks="heroScene" :unit="30" :powered="isArchivePowered" />
          </div>
        </section>

        <div class="worlds-gallery">
          <div class="gallery-head">
            <h2>所有投影</h2>
            <span v-if="isLoading" class="loading-text">正在同步世界目录...</span>
            <span v-else class="rs-chip count-badge">{{ galleryItems.length }} Worlds</span>
            <span class="gallery-head-wire rs-wire-line" aria-hidden="true" />
          </div>

          <div v-if="isLoading" class="card-grid" aria-busy="true">
            <div v-for="n in SKELETON_CARDS" :key="n" class="skeleton-card" aria-hidden="true">
              <div class="skeleton-thumb" />
              <div class="skeleton-body">
                <span class="skeleton-line is-title" />
                <span class="skeleton-line" />
                <span class="skeleton-line is-short" />
              </div>
            </div>
          </div>

          <div
            v-else-if="galleryItems.length === 0 && !canManageProjections"
            class="empty-state rs-panel rs-panel--stone"
          >
            <div class="empty-art" aria-hidden="true">
              <IsoScene :blocks="heroScene" :unit="22" :powered="false" />
            </div>
            <span class="rs-eyebrow empty-eyebrow">No signal</span>
            <span class="empty-title">还没有任何世界</span>
            <span class="empty-desc">当前 Space 尚未公开任何投影。</span>
            <span class="empty-hint">{{ t('space.empty.hint') }}</span>
          </div>

          <div v-else class="card-grid">
            <SpaceWorldCard
              v-if="canManageProjections"
              create
              create-title="创建新的投影"
              :create-description="galleryItems.length
                ? '点击上传新的原理图投影，并为它配置公开性与世界参数'
                : '点击开始上传 .litematic 或 .schem，并创建这个 Space 的第一个投影'"
              @create="openAdminConfigPage"
            />

            <SpaceWorldCard
              v-for="item in galleryItems"
              :key="item.id"
              :item="item"
              :space-name="spaceName"
              :image-url="resolveCardImageUrl(item)"
              :can-manage="canManageProjections"
              :is-pending-delete="pendingDeleteItemId === item.id"
              @enter="enterProjection"
              @settings="openProjectionSettings"
              @request-delete="pendingDeleteItemId = $event"
              @confirm-delete="handleDeleteProjection"
            />
          </div>
        </div>
      </template>

      <footer class="worlds-footer">
        <RedstoneCredits />
      </footer>
    </section>
  </main>
</template>

<style scoped>
.worlds-shell {
  min-height: 100vh;
  color: var(--rs-text);
  font-family: var(--rs-font-body);
}

/* ---------------------------------------------------------------- topbar */

.worlds-topbar {
  position: sticky;
  top: 0;
  z-index: 50;
  border-bottom: 1px solid var(--rs-line);
  background: rgba(10, 11, 14, 0.84);
  backdrop-filter: blur(10px) saturate(1.1);
  -webkit-backdrop-filter: blur(10px) saturate(1.1);
}

.worlds-topbar-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  max-width: 1280px;
  height: 60px;
  margin: 0 auto;
  padding: 0 32px;
}

.topbar-crumbs {
  min-width: 0;
}

.worlds-topbar-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: none;
}

.brand-icon-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.brand-icon-button {
  color: var(--rs-text-2);
}

.auth-popover {
  position: relative;
}

.auth-trigger {
  gap: 8px;
}

.auth-trigger.has-account {
  padding-right: 5px;
}

.auth-trigger.active {
  border-color: rgba(255, 74, 46, 0.7);
}

.auth-trigger-label {
  font-weight: 600;
}

.auth-trigger-arrow {
  display: inline-flex;
  color: var(--rs-text-2);
}

.auth-avatar {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  overflow: hidden;
  border-radius: 2px;
  background: var(--rs-red-dim);
  color: #fff;
  font: 400 8px/1 var(--rs-font-pixel);
  -webkit-font-smoothing: none;
}

.auth-avatar > span {
  translate: 0 2px;
}

.auth-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.auth-menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 60;
  width: 264px;
  padding: 6px;
  border-color: var(--rs-line-strong);
}

.auth-menu-header {
  margin-bottom: 4px;
  padding: 10px 10px 12px;
  border-bottom: 1px solid var(--rs-line);
}

.menu-account-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.account-name {
  overflow: hidden;
  color: var(--rs-text);
  font-size: 14px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-email {
  overflow: hidden;
  color: var(--rs-text-2);
  font: 12px/1.3 var(--rs-font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.auth-menu-title {
  padding: 8px 10px 6px;
  color: var(--rs-text-2);
  font-size: 12px;
}

.auth-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 40px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--rs-radius);
  background: none;
  color: var(--rs-text);
  font: 500 14px/1 var(--rs-font-body);
  text-align: left;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.auth-menu-item:hover {
  background: var(--rs-red-soft);
}

.auth-menu-item:focus-visible {
  outline: 2px solid var(--rs-red-hot);
  outline-offset: -2px;
}

.auth-menu-item:disabled {
  opacity: 0.5;
  cursor: progress;
}

.auth-menu-item.danger {
  color: #ffb3a4;
}

.menu-icon {
  display: inline-flex;
  color: var(--rs-text-2);
}

/* ------------------------------------------------------------------ main */

.worlds-main {
  display: flex;
  flex-direction: column;
  gap: 28px;
  max-width: 1280px;
  margin: 0 auto;
  padding: 28px 32px 80px;
}

.banner {
  padding: 12px 16px;
  border: 1px solid var(--rs-line);
  border-left: 3px solid var(--rs-text-3);
  border-radius: var(--rs-radius);
  background: var(--rs-bg-2);
  color: var(--rs-text);
  font-size: 14px;
  line-height: 1.5;
}

.banner.success {
  border-left-color: var(--rs-emerald);
}

.banner.warning {
  border-left-color: var(--rs-red-hot);
  background: linear-gradient(90deg, rgba(92, 21, 16, 0.35), var(--rs-bg-2) 60%);
}

/* ---------------------------------------------------------------- footer */

.worlds-footer {
  display: flex;
  justify-content: center;
  padding-top: 4px;
}

/* ------------------------------------------------------------------ hero */

.worlds-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 32px;
  min-height: 300px;
  padding: 36px 40px;
  overflow: hidden;
}

.hero-copy {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 22px;
  min-width: 0;
}

.worlds-brand {
  display: flex;
  align-items: center;
  gap: 18px;
  min-width: 0;
  max-width: 100%;
}

.brand-avatar-button {
  flex: none;
  padding: 0;
  border: 0;
  border-radius: var(--rs-radius);
  background: none;
  cursor: pointer;
}

.brand-avatar-button.disabled {
  cursor: default;
}

.brand-avatar-button:focus-visible,
.brand-title-button:focus-visible {
  outline: 2px solid var(--rs-red-hot);
  outline-offset: 3px;
}

.brand-avatar {
  display: grid;
  place-items: center;
  width: 72px;
  height: 72px;
  overflow: hidden;
  border: 1px solid var(--rs-line-strong);
  border-radius: var(--rs-radius);
  background:
    linear-gradient(180deg, rgba(255, 90, 60, 0.28), rgba(80, 8, 0, 0.5)),
    var(--rs-tex-redstone-block) center / 36px 36px;
  image-rendering: pixelated;
  box-shadow: inset 0 1px 0 rgba(255, 200, 180, 0.25), 0 8px 18px rgba(0, 0, 0, 0.45);
  transition: border-color 0.15s, box-shadow 0.15s;
}

.brand-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  image-rendering: auto;
}

.brand-avatar-initial {
  color: #fff;
  font: 400 32px/1 var(--rs-font-pixel);
  text-shadow: 0 2px 0 rgba(60, 0, 0, 0.7);
  -webkit-font-smoothing: none;
  translate: 0 4px;
}

.brand-avatar-button:not(:disabled):hover .brand-avatar {
  border-color: #ff8a6a;
  box-shadow: inset 0 1px 0 rgba(255, 200, 180, 0.35), var(--rs-glow-soft);
}

.brand-copy {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.brand-heading {
  margin: 0;
  min-width: 0;
}

.brand-title-button {
  max-width: 100%;
  padding: 0;
  border: 0;
  background: none;
  color: var(--rs-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.brand-title-button:disabled {
  cursor: default;
}

.title-text {
  display: block;
  overflow: hidden;
  font: 700 36px/1.15 var(--rs-font-body);
  letter-spacing: -0.01em;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-decoration-color: transparent;
  text-decoration-line: underline;
  text-decoration-thickness: 2px;
  text-underline-offset: 7px;
  transition: text-decoration-color 0.15s;
}

.brand-title-button:not(:disabled):hover .title-text {
  text-decoration-color: var(--rs-red-hot);
}

.subtitle-text {
  margin: 0;
  color: var(--rs-text-2);
  font: 13px/1.4 var(--rs-font-mono);
}

.hero-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 14px 0;
  margin: 0;
}

.hero-stat {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 0 28px;
  border-left: 1px solid var(--rs-line-strong);
}

.hero-stat:first-child {
  padding-left: 0;
  border-left: 0;
}

.hero-stat dt {
  color: var(--rs-text-2);
  font-size: 12px;
  font-weight: 500;
}

.hero-stat dd {
  margin: 0;
}

.stat-number {
  color: var(--rs-text);
  font-size: 24px;
  line-height: 32px;
  height: 32px;
}

.stat-pending {
  color: var(--rs-text-3);
  font: 700 22px/32px var(--rs-font-body);
  letter-spacing: 0.1em;
}

.stat-text {
  max-width: 20ch;
  overflow: hidden;
  color: var(--rs-text);
  font-size: 17px;
  font-weight: 600;
  line-height: 32px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.hero-art {
  position: relative;
  display: grid;
  place-items: center;
  width: 400px;
  height: 260px;
  margin: -12px -8px -12px 0;
}

.hero-art::before {
  content: '';
  position: absolute;
  inset: 10% 6%;
  border-radius: 50%;
  background: radial-gradient(closest-side, rgba(255, 60, 30, 0.14), transparent);
  opacity: 0;
  transition: opacity 0.6s;
}

.worlds-hero.is-powered .hero-art::before {
  opacity: 1;
}

/* --------------------------------------------------------------- gallery */

.worlds-gallery {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.gallery-head {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.gallery-head h2 {
  margin: 0;
  flex: none;
  color: var(--rs-text);
  font-size: 20px;
  font-weight: 700;
}

.count-badge {
  flex: none;
}

.loading-text {
  flex: none;
  color: var(--rs-text-2);
  font-size: 13px;
}

.gallery-head-wire {
  flex: 1;
  min-width: 24px;
}

.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(272px, 1fr));
  gap: 20px;
}

/* Loading skeleton with the same footprint as a card. */
.skeleton-card {
  overflow: hidden;
  border: 1px solid var(--rs-line);
  border-radius: var(--rs-radius-lg);
  background: var(--rs-bg-2);
}

.skeleton-thumb {
  aspect-ratio: 16 / 10;
  background: #0b0c0f;
  border-bottom: 2px solid var(--rs-red-off);
}

.skeleton-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  min-height: 150px;
}

.skeleton-line {
  height: 10px;
  width: 100%;
  border-radius: 2px;
  background: linear-gradient(90deg, var(--rs-bg-3) 0%, var(--rs-bg-4) 50%, var(--rs-bg-3) 100%);
  background-size: 200% 100%;
  animation: worlds-shimmer 1.4s linear infinite;
}

.skeleton-line.is-title {
  height: 16px;
  width: 60%;
  margin-bottom: 4px;
}

.skeleton-line.is-short {
  width: 40%;
}

@keyframes worlds-shimmer {
  from { background-position: 100% 0; }
  to { background-position: -100% 0; }
}

/* Visitor empty state: the circuit is built but nothing powers it yet. */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 40px 24px 48px;
  text-align: center;
}

.empty-art {
  display: grid;
  place-items: center;
  height: 190px;
  margin-bottom: 8px;
  opacity: 0.92;
}

.empty-eyebrow {
  color: var(--rs-text-2);
}

.empty-title {
  color: var(--rs-text);
  font-size: 20px;
  font-weight: 700;
}

.empty-desc,
.empty-hint {
  max-width: 44ch;
  color: var(--rs-text-2);
  font-size: 14px;
  line-height: 1.6;
}

/* ------------------------------------------------------------ responsive */

@media (max-width: 1080px) {
  .hero-art {
    width: 300px;
    height: 220px;
    transform: scale(0.8);
    transform-origin: center right;
  }
}

@media (max-width: 860px) {
  .worlds-hero {
    grid-template-columns: minmax(0, 1fr);
    min-height: 0;
  }

  .hero-art {
    display: none;
  }
}

@media (max-width: 640px) {
  .worlds-topbar-inner {
    height: 56px;
    padding: 0 16px;
    gap: 10px;
  }

  .worlds-topbar-actions {
    gap: 6px;
  }

  .brand-icon-row {
    gap: 0;
  }

  .worlds-main {
    gap: 22px;
    padding: 18px 16px 56px;
  }

  .worlds-hero {
    padding: 26px 20px 24px;
  }

  .hero-copy {
    gap: 18px;
  }

  .worlds-brand {
    gap: 14px;
  }

  .brand-avatar {
    width: 56px;
    height: 56px;
  }

  .brand-avatar-initial {
    font-size: 24px;
    translate: 0 3px;
  }

  .title-text {
    font-size: 24px;
    white-space: normal;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  .subtitle-text {
    font-size: 12px;
  }

  .hero-stat {
    padding: 0 16px;
  }

  .stat-number {
    font-size: 16px;
    line-height: 24px;
    height: 24px;
  }

  .stat-text {
    max-width: 12ch;
    font-size: 15px;
    line-height: 24px;
  }

  .hero-actions,
  .hero-actions .rs-btn {
    width: 100%;
  }

  .card-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .skeleton-line {
    animation: none;
  }

  .hero-art::before {
    transition: none;
  }
}
</style>
