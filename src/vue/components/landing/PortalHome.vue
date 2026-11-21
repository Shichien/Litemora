<script setup>
import { isLocalDevAuthSession } from '@three/auth/admin-auth.js'
import {
  checkSpaceNameAvailability,
  claimGallerySpace,
  fetchDiscoverProjectionFeed,
} from '@three/gallery/gallery-api.js'
import { getStaticThumbnailUrl, loadThumbnailManifest } from '@three/gallery/world-thumbnails.js'
import { normalizeThumbnailSky, THUMBNAIL_SKIES } from '@three/gallery/thumbnail-skies.js'
import { resolvePublicAssetUrl } from '@three/utils/public-asset-url.js'
import { buildSpaceUrl, isValidSpaceName, normalizeSpaceName } from '@three/utils/space-context.js'
import ProviderIcon from '@ui-components/auth/ProviderIcon.vue'
import IsoScene from '@ui-components/redstone/IsoScene.vue'
import RedstoneCredits from '@ui-components/redstone/RedstoneCredits.vue'
import { useGalleryAuth } from '@ui/composables/useGalleryAuth.js'
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { iconBlock, PLACEHOLDER_BUILD_COUNT } from './portal-scenes.js'
import PortalDiscoverCard from './PortalDiscoverCard.vue'
import PortalSignalSection from './PortalSignalSection.vue'

const PistonDoorPreview = defineAsyncComponent(() => import('./PistonDoorPreview.vue'))
const { t, te } = useI18n()
const authMenuOpen = ref(false)
const authMenuRef = ref(null)
const authTriggerRef = ref(null)
const {
  authProviders,
  authSession,
  isAuthenticating,
  authError,
  isLoggedIn,
  currentAccount,
  providerLabel,
  loginWithProvider,
  logout: signOut,
} = useGalleryAuth({
  onAuthenticated: () => {
    authMenuOpen.value = false
  },
})
const discoverFeedItems = ref([])
const thumbnailManifest = ref({})

function handleDocumentClick(event) {
  if (!authMenuRef.value?.contains?.(event.target)) {
    authMenuOpen.value = false
  }
}

function shuffleItems(items = []) {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    const current = copy[index]
    copy[index] = copy[swapIndex]
    copy[swapIndex] = current
  }
  return copy
}

async function loadDiscoverFeed() {
  try {
    const payload = await fetchDiscoverProjectionFeed(12)
    const items = Array.isArray(payload?.items) ? payload.items : []
    discoverFeedItems.value = shuffleItems(items).filter(item => item?.routeId && item?.space)
  }
  catch {
    discoverFeedItems.value = []
  }
}

async function loadThumbnails() {
  thumbnailManifest.value = await loadThumbnailManifest()
}

function handleGalleryChanged() {
  void loadDiscoverFeed()
}

// Auth State
const currentAccountName = computed(() => {
  const account = currentAccount.value
  return account?.name || account?.email || account?.id || 'Guest'
})
const currentAccountEmail = computed(() => {
  const account = currentAccount.value
  return account?.email || (isLocalDevAuthSession(authSession.value) ? 'local@litemora.dev' : '')
})
const currentAccountRole = computed(() => isLocalDevAuthSession(authSession.value) ? 'Admin' : 'Member')
const currentAccountAvatar = computed(() => currentAccount.value?.avatar || '')
const currentAccountInitial = computed(() => currentAccountName.value.slice(0, 1).toUpperCase() || 'L')

function logout() {
  signOut()
  authMenuOpen.value = false
}

function closeAuthMenu() {
  if (authMenuOpen.value) {
    authMenuOpen.value = false
    authTriggerRef.value?.focus()
  }
}

const inputSpaceName = ref('')
const errorText = ref('')
const isCheckingSpaceAvailability = ref(false)
const normalizedSpaceName = computed(() => normalizeSpaceName(inputSpaceName.value))
const canCreate = computed(() => isValidSpaceName(normalizedSpaceName.value))
const spaceUrlPreview = computed(() => `litemora.art/${normalizedSpaceName.value || 'your-space'}`)

async function handleSubmit() {
  errorText.value = ''

  if (!isLoggedIn.value) {
    errorText.value = t('home.create.error.loginRequired')
    return
  }

  if (!canCreate.value) {
    errorText.value = t('home.create.error.invalid')
    return
  }

  try {
    isCheckingSpaceAvailability.value = true
    const availability = await checkSpaceNameAvailability(normalizedSpaceName.value, authSession.value)
    if (!availability?.available) {
      errorText.value = t('home.create.error.duplicate')
      return
    }

    await claimGallerySpace({
      spaceName: normalizedSpaceName.value,
      displayName: normalizedSpaceName.value,
      session: authSession.value,
    })

    const targetUrl = buildSpaceUrl(normalizedSpaceName.value)
    window.location.href = targetUrl
  }
  catch {
    errorText.value = t('home.create.error.failed')
  }
  finally {
    isCheckingSpaceAvailability.value = false
  }
}

const defaultDiscoverSpaces = [
  { title: 'Brutalist Library', author: 'By Shichien', url: 'brutalist-library' },
  { title: 'Cyberpunk City', author: 'By Litemora Community', url: 'cyber-city' },
  { title: 'Medieval Castle', author: 'By BuilderXYZ', url: 'medieval' },
  { title: 'Zen Garden', author: 'By ArchD', url: 'zen-garden' },
  { title: 'Sky Island', author: 'By Aeria', url: 'sky-island' },
  { title: 'Deep Dark City', author: 'By Miner123', url: 'deep-dark' },
]

function hashString(value = '') {
  let hash = 0
  for (const char of String(value)) {
    hash = ((hash * 31) + char.charCodeAt(0)) | 0
  }
  return Math.abs(hash)
}

function buildDiscoverCard(item, fallback = null) {
  if (!item || typeof item !== 'object') {
    return fallback
  }

  const routeId = String(item.routeId || item.projectionSlug || item.id || '').trim()
  const spaceName = String(item.space || '').trim()
  if (!routeId || !spaceName) {
    return fallback
  }

  const ownerName = String(item.ownerName || spaceName).trim()
  // Admin-uploaded thumbnail → static capture from the manifest → iso placeholder.
  const imageUrl = String(item.thumbnailDataUrl || '').trim()
    || getStaticThumbnailUrl(thumbnailManifest.value, spaceName, routeId)
  return {
    title: String(item.title || 'World').trim(),
    author: `By ${ownerName}`,
    url: `/${spaceName}/worlds/${routeId}`,
    imageUrl,
    thumbnailSky: normalizeThumbnailSky(item.thumbnailSky),
    ownerAvatar: String(item.ownerAvatar || '').trim(),
    ownerInitial: ownerName.slice(0, 1).toUpperCase() || 'L',
    spaceLabel: spaceName,
    variant: hashString(`${spaceName}/${routeId}`) % PLACEHOLDER_BUILD_COUNT,
  }
}

const discoverSpaces = computed(() => {
  if (!discoverFeedItems.value.length) {
    return defaultDiscoverSpaces.map((item, index) => ({
      ...item,
      url: `/${item.url}`,
      imageUrl: '',
      ownerAvatar: '',
      ownerInitial: item.author.slice(3, 4).toUpperCase() || 'L',
      spaceLabel: item.url,
      variant: index % PLACEHOLDER_BUILD_COUNT,
    }))
  }

  return discoverFeedItems.value
    .slice(0, 6)
    .map((item, index) => buildDiscoverCard(item, {
      ...defaultDiscoverSpaces[index % defaultDiscoverSpaces.length],
      variant: index % PLACEHOLDER_BUILD_COUNT,
    }))
    .filter(Boolean)
})

// ---------------------------------------------------------------------------
// Visuals: hero build, signal rail, section power
// ---------------------------------------------------------------------------
const BLOCK_DIR = 'minecraft-default-pack/assets/minecraft/textures/block/'
const blockTex = name => resolvePublicAssetUrl(`${BLOCK_DIR}${name}.png`)
const logoUrl = resolvePublicAssetUrl('logo.webp')
const lampOffUrl = blockTex('redstone_lamp')
const lampOnUrl = blockTex('redstone_lamp_on')
const rootStyle = {
  '--signal-dust': `url("${resolvePublicAssetUrl('homepage/redstone-rail.png')}")`,
  '--button-circuit': `url("${resolvePublicAssetUrl('homepage/redstone-button.png')}")`,
  '--portal-command-block': `url("${blockTex('command_block_front')}")`,
}

const stepIcons = [
  iconBlock('piston_side', { top: 'piston_top' }),
  iconBlock('crafting_table_front', { top: 'crafting_table_top' }),
  iconBlock('observer_front', { top: 'observer_top' }),
]

const prefersReducedMotion = typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// Page lighting is independent from the interactive door.
const leverOn = ref(true)
const doorOpen = ref(false)
const booted = ref(false)

// ---------------------------------------------------------------------------
// Logo easter egg: three quick clicks power the whole page by hand.
// ---------------------------------------------------------------------------
const LOGO_CLICK_WINDOW_MS = 900
const eggClicks = ref(0)
const eggActive = ref(false)
let eggClickTimer = 0
let eggResetTimer = 0

const heroPowered = computed(() => (booted.value && leverOn.value) || eggActive.value)

// Sections light in order as they scroll into view; the index never goes back.
const SECTION_ORDER = ['manifesto', 'features', 'create', 'discover', 'footer']
const reachedIndex = ref(-1)
function sectionPowered(name) {
  return heroPowered.value && reachedIndex.value >= SECTION_ORDER.indexOf(name)
}

const sectionEls = new Map()
function sectionRef(name) {
  return (component) => {
    const el = component?.$el || component
    if (el instanceof Element) {
      el.dataset.signal = name
      sectionEls.set(name, el)
    }
    else {
      sectionEls.delete(name)
    }
  }
}

const heroSection = ref(null)
const heroCta = ref(null)
const railTop = ref(0)
function measureRail() {
  const sectionEl = heroSection.value?.$el
  const ctaEl = heroCta.value
  if (!sectionEl || !ctaEl) {
    return
  }
  const sectionRect = sectionEl.getBoundingClientRect()
  const ctaRect = ctaEl.getBoundingClientRect()
  railTop.value = Math.round(ctaRect.top + ctaRect.height / 2 - sectionRect.top)
  // Keep the 16-texel pattern in phase across independently powered sections.
  const origin = sectionRect.top + railTop.value
  for (const el of sectionEls.values()) {
    el.style.setProperty('--dust-offset', `${Math.round(origin - el.getBoundingClientRect().top)}px`)
  }
}

function scrollToSection(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' })
}

// ---------------------------------------------------------------------------
// Logo easter egg: three quick clicks power the whole page by hand.
// ---------------------------------------------------------------------------
function handleLogoClick() {
  const now = Date.now()
  if (now - eggClickTimer > LOGO_CLICK_WINDOW_MS) {
    eggClicks.value = 0
  }
  eggClickTimer = now
  eggClicks.value += 1

  if (eggClicks.value < 3) {
    return
  }

  eggClicks.value = 0
  eggActive.value = true
  // The egg overrides the lever for a moment, then hands control back.
  leverOn.value = true
  window.clearTimeout(eggResetTimer)
  eggResetTimer = window.setTimeout(() => {
    eggActive.value = false
  }, 2600)
}

let sectionObserver = null
let resizeObserver = null
let bootTimer = 0

function markReached(name) {
  const index = SECTION_ORDER.indexOf(name)
  if (index > reachedIndex.value) {
    reachedIndex.value = index
  }
}

function setupObservers() {
  if (typeof IntersectionObserver === 'undefined') {
    reachedIndex.value = SECTION_ORDER.length - 1
    return
  }
  // A section counts as reached once its top passes 70% of the viewport height,
  // or once it is mostly visible (short sections at the very bottom of the page).
  sectionObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const name = entry.target.dataset.signal
      const passed = entry.boundingClientRect.top < window.innerHeight * 0.7
      if (entry.isIntersecting && (passed || entry.intersectionRatio > 0.6)) {
        markReached(name)
      }
      else if (!entry.isIntersecting && entry.boundingClientRect.bottom < 0) {
        markReached(name)
      }
    }
  }, { threshold: [0, 0.15, 0.3, 0.6, 1] })
  for (const el of sectionEls.values()) {
    sectionObserver.observe(el)
  }
}

onMounted(async () => {
  window.addEventListener('gallery:changed', handleGalleryChanged)
  document.addEventListener('click', handleDocumentClick)
  void loadDiscoverFeed()
  void loadThumbnails()

  await nextTick()
  measureRail()
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(measureRail)
    for (const el of [heroCta.value, heroSection.value.$el, ...sectionEls.values()]) {
      resizeObserver.observe(el)
    }
  }
  document.fonts?.ready?.then(measureRail)
  setupObservers()

  if (prefersReducedMotion) {
    booted.value = true
  }
  else {
    bootTimer = window.setTimeout(() => {
      booted.value = true
    }, 450)
  }
})

onBeforeUnmount(() => {
  window.clearTimeout(eggClickTimer)
  window.clearTimeout(eggResetTimer)
  window.removeEventListener('gallery:changed', handleGalleryChanged)
  document.removeEventListener('click', handleDocumentClick)
  sectionObserver?.disconnect()
  resizeObserver?.disconnect()
  window.clearTimeout(bootTimer)
})
</script>

<template>
  <main class="Litemora-home rs-bg-deepslate" :class="{ 'is-powered': heroPowered }" :style="rootStyle">
    <!-- Header -->
    <header class="home-header">
      <a class="header-brand" href="/">
        <img :src="logoUrl" alt="" width="26" height="26">
        Litemora
      </a>

      <nav ref="authMenuRef" class="nav-links" :aria-label="t('home.nav.account')" @keydown.esc="closeAuthMenu">
        <div class="auth-popover">
          <button
            ref="authTriggerRef"
            type="button"
            class="auth-trigger"
            :class="{ active: authMenuOpen }"
            :aria-expanded="authMenuOpen"
            :aria-label="isLoggedIn ? currentAccountName : t('home.nav.signIn')"
            :title="isLoggedIn ? currentAccountName : t('home.nav.signIn')"
            @click="authMenuOpen = !authMenuOpen"
          >
            <span v-if="isLoggedIn" class="auth-avatar">
              <img v-if="currentAccountAvatar" :src="currentAccountAvatar" alt="">
              <span v-else>{{ currentAccountInitial }}</span>
            </span>
            <ProviderIcon v-else provider="github" />
          </button>

          <div v-if="authMenuOpen" class="auth-menu">
            <template v-if="isLoggedIn">
              <div class="auth-menu-header">
                <div class="menu-account-copy">
                  <strong>{{ currentAccountName }}</strong>
                  <span>{{ currentAccountEmail || currentAccountRole }}</span>
                </div>
              </div>

              <button type="button" class="auth-menu-item placeholder" @click="authMenuOpen = false">
                <span class="menu-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 14a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
                    <path d="M4 20a8 8 0 0 1 16 0" />
                  </svg>
                </span>
                <span>Account Settings</span>
              </button>
              <button type="button" class="auth-menu-item placeholder" @click="authMenuOpen = false">
                <span class="menu-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82 2 2 0 1 1-2.83 2.83 1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51 2 2 0 1 1-4 0 1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33 2 2 0 1 1-2.83-2.83 1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1 2 2 0 1 1 0-4 1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82 2 2 0 1 1 2.83-2.83 1.65 1.65 0 0 0 1.82.33h.01A1.65 1.65 0 0 0 10 2.6a2 2 0 1 1 4 0 1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33 2 2 0 1 1 2.83 2.83 1.65 1.65 0 0 0-.33 1.82v.01A1.65 1.65 0 0 0 21.4 10a2 2 0 1 1 0 4 1.65 1.65 0 0 0-1.510 1Z" />
                  </svg>
                </span>
                <span>Preferences</span>
              </button>
              <button type="button" class="auth-menu-item danger" @click="logout">
                <span class="menu-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
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
                {{ t('home.nav.signIn') }}
              </div>
              <p v-if="!authProviders.length" class="auth-menu-error">
                {{ t('home.nav.unavailable') }}
              </p>
              <button
                v-for="provider in authProviders"
                :key="provider.id"
                type="button"
                class="auth-menu-item"
                :disabled="isAuthenticating"
                @click="loginWithProvider(provider.id)"
              >
                <span class="menu-icon" aria-hidden="true">
                  <ProviderIcon :provider="provider.id" />
                </span>
                <span>{{ isAuthenticating ? '登录中...' : providerLabel(provider) }}</span>
              </button>
              <p v-if="authError" class="auth-menu-error" role="alert">
                {{ authError }}
              </p>
            </template>
          </div>
        </div>
      </nav>
    </header>

    <!-- Hero -->
    <PortalSignalSection
      ref="heroSection"
      class="hero-content"
      marker="none"
      :powered="heroPowered"
      :rail-top="railTop"
      stub
    >
      <div class="hero-grid">
        <div class="hero-copy">
          <h1 class="hero-title">
            <button
              type="button"
              class="hero-title-badge"
              :class="{ 'is-egg': eggActive }"
              :aria-label="eggActive ? 'Litemora 彩蛋已触发' : 'Litemora'"
              @click="handleLogoClick"
            >
              <img :src="logoUrl" alt="" class="hero-title-icon">
            </button>
            <span class="hero-title-word">Litemora</span>
          </h1>

          <div class="hero-actions">
            <a
              ref="heroCta"
              href="#create-space"
              class="rs-btn rs-btn--primary rs-btn--lg"
              @click.prevent="scrollToSection('create-space')"
            >
              <span class="hero-cta-circuit" aria-hidden="true" />
              {{ t('home.hero.ctaCreate') }}
            </a>
            <a
              href="#discover"
              class="rs-btn rs-btn--lg"
              @click.prevent="scrollToSection('discover')"
            >
              <span class="hero-cta-circuit" aria-hidden="true" />
              {{ t('home.discover.title') }}
            </a>
          </div>
        </div>

        <div class="hero-art">
          <div class="hero-art__frame">
            <PistonDoorPreview :open="doorOpen" />
          </div>
          <button
            type="button"
            class="hero-lever"
            :class="{ 'is-on': doorOpen }"
            :aria-pressed="doorOpen ? 'true' : 'false'"
            :aria-label="doorOpen ? '关闭活塞门' : '打开活塞门'"
            @click="doorOpen = !doorOpen"
          >
            <span class="hero-lever__switch" aria-hidden="true"><span /></span>
            <span class="hero-lever__label">{{ doorOpen ? '关门' : '开门' }}</span>
            <span class="hero-lever__state rs-pixel">{{ doorOpen ? '已打开' : '已关闭' }}</span>
          </button>
        </div>
      </div>
    </PortalSignalSection>

    <!-- Quote & Stats -->
    <PortalSignalSection
      id="manifesto"
      :ref="sectionRef('manifesto')"
      class="quote-stats-section"
      :powered="sectionPowered('manifesto')"
    >
      <div class="quote-container">
        <h2>
          <span>{{ t('home.quote.line1') }}</span>
          <span class="quote-line2">{{ t('home.quote.line2') }}</span>
        </h2>
      </div>

      <div class="stats-row">
        <div class="stat-item">
          <img class="stat-lamp rs-tex" :src="sectionPowered('manifesto') ? lampOnUrl : lampOffUrl" alt="" draggable="false">
          <div>
            <h3>3+</h3>
            <p>{{ t('home.stats.formats') }}</p>
          </div>
        </div>
        <div class="stat-item">
          <img class="stat-lamp rs-tex" :src="sectionPowered('manifesto') ? lampOnUrl : lampOffUrl" alt="" draggable="false">
          <div>
            <h3>100%</h3>
            <p>{{ t('home.stats.nativeRendering') }}</p>
          </div>
        </div>
        <div class="stat-item">
          <img class="stat-lamp rs-tex" :src="sectionPowered('manifesto') ? lampOnUrl : lampOffUrl" alt="" draggable="false">
          <div>
            <h3>0</h3>
            <p>{{ t('home.stats.serverCost') }}</p>
          </div>
        </div>
      </div>
    </PortalSignalSection>

    <!-- Features Steps -->
    <PortalSignalSection
      :ref="sectionRef('features')"
      class="features-section"
      marker="none"
      :powered="sectionPowered('features')"
    >
      <div class="features-grid">
        <template v-for="step in 3" :key="step">
          <span v-if="step > 1" class="feature-link" aria-hidden="true">
            <span class="feature-link__wire" />
            <img class="feature-link__repeater rs-tex" :src="blockTex(sectionPowered('features') ? 'repeater_on' : 'repeater')" alt="" draggable="false">
            <span class="feature-link__wire" />
          </span>
          <div
            class="feature-card rs-panel rs-panel--stone rs-panel--wired"
            :class="{ 'is-powered': sectionPowered('features') }"
            :style="{ '--step-delay': `${(step - 1) * 0.35}s` }"
          >
            <div class="feature-card__top">
              <span class="feature-icon">
                <IsoScene :blocks="stepIcons[step - 1]" :unit="30" />
              </span>
              <span class="step-num rs-pixel">0{{ step }}</span>
            </div>
            <h4 class="step-title">{{ t(`home.features.step${step}.title`) }}</h4>
            <p v-if="te(`home.features.step${step}.desc`)" class="step-desc">
              {{ t(`home.features.step${step}.desc`) }}
            </p>
          </div>
        </template>
      </div>
    </PortalSignalSection>

    <!-- Create -->
    <PortalSignalSection
      id="create-space"
      :ref="sectionRef('create')"
      class="action-section"
      :powered="sectionPowered('create')"
    >
      <div class="action-grid">
        <div class="create-half">
          <h2 class="section-heading">
            <span>{{ t('home.create.title1') }}</span>
            <span class="section-heading__accent">{{ t('home.create.title2') }}</span>
          </h2>

          <form class="create-form command-block" :class="{ 'is-ready': canCreate }" @submit.prevent="handleSubmit">
            <div class="command-block__bar">
              <span class="command-block__icon" aria-hidden="true" />
              <span class="command-block__title">{{ t('home.create.blockTitle') }}</span>
              <span class="command-block__status" :class="{ 'is-ready': canCreate }">
                <span class="command-block__status-dot" aria-hidden="true" />
                {{ canCreate ? t('home.create.statusReady') : t('home.create.statusIdle') }}
              </span>
            </div>
            <div class="input-wrapper">
              <span class="command-block__prompt" aria-hidden="true">/create</span>
              <input
                v-model="inputSpaceName"
                type="text"
                :placeholder="t('home.create.placeholder')"
                :aria-label="t('home.create.placeholder')"
                maxlength="63"
                autocomplete="off"
                spellcheck="false"
              >
              <button
                type="submit"
                :disabled="!canCreate || isCheckingSpaceAvailability"
                class="submit-btn"
                :aria-label="t('home.create.submit')"
              >
                <svg viewBox="0 0 16 16" width="16" height="16" shape-rendering="crispEdges" aria-hidden="true">
                  <path d="M3 7h7V4h1v1h1v1h1v1h1v2h-1v1h-1v1h-1v1h-1V9H3z" fill="currentColor" />
                </svg>
              </button>
            </div>
            <div class="command-block__output" aria-live="polite">
              <p class="preview-url"><span class="command-block__caret" aria-hidden="true">&gt;</span>{{ spaceUrlPreview }}</p>
              <p v-if="errorText" class="error-text">{{ errorText }}</p>
            </div>
          </form>
        </div>

        <ul class="features-list-half">
          <li class="feature-item">
            <span class="feature-item__dot" aria-hidden="true" />
            <div>
              <h4>{{ t('home.create.benefits.b1Title') }}</h4>
              <p>{{ t('home.create.benefits.b1Desc') }}</p>
            </div>
          </li>
          <li class="feature-item">
            <span class="feature-item__dot" aria-hidden="true" />
            <div>
              <h4>{{ t('home.create.benefits.b2Title') }}</h4>
              <p>{{ t('home.create.benefits.b2Desc') }}</p>
            </div>
          </li>
          <li class="feature-item">
            <span class="feature-item__dot" aria-hidden="true" />
            <div>
              <h4>{{ t('home.create.benefits.b3Title') }}</h4>
              <p>{{ t('home.create.benefits.b3Desc') }}</p>
            </div>
          </li>
        </ul>
      </div>
    </PortalSignalSection>

    <!-- Discover -->
    <PortalSignalSection
      id="discover"
      :ref="sectionRef('discover')"
      class="discover-section"
      :powered="sectionPowered('discover')"
    >
      <h2 class="section-heading">{{ t('home.discover.title') }}</h2>

      <div class="discover-grid" :class="{ 'is-even': discoverSpaces.length === 4 }">
        <PortalDiscoverCard
          v-for="(space, index) in discoverSpaces"
          :key="space.url"
          :space="space"
          :sky="space.thumbnailSky || THUMBNAIL_SKIES[index % THUMBNAIL_SKIES.length]"
          :variant="space.variant"
        />
      </div>
    </PortalSignalSection>

    <!-- Footer -->
    <PortalSignalSection
      :ref="sectionRef('footer')"
      as="footer"
      class="home-footer"
      marker="lamp"
      end
      :powered="sectionPowered('footer')"
    >
      <RedstoneCredits class="home-credits" />
      <p>{{ t('home.footer') }}</p>
      <a class="rs-btn home-docs" href="/docs/api/">{{ t('home.documentation') }}</a>
    </PortalSignalSection>
  </main>
</template>

<style scoped>
.Litemora-home {
  --signal-inset: 32px;
  --signal-gutter: 72px;
  --signal-max: 1320px;
  --signal-pad-top: 128px;
  --signal-marker-top: 136px;
  position: relative;
  min-height: 100vh;
  overflow-x: clip;
  color: var(--rs-text);
  font-family: var(--rs-font-body);
  -webkit-font-smoothing: antialiased;
}

/* Warm light from the hero build, fading out down the page. */
.Litemora-home::before {
  content: '';
  position: absolute;
  inset: 0 0 auto;
  height: 1100px;
  background:
    radial-gradient(48% 44% at 72% 38%, rgba(255, 70, 40, 0.07), transparent 70%),
    linear-gradient(180deg, rgba(8, 9, 11, 0) 0%, rgba(8, 9, 11, 0.4) 100%);
  opacity: 0.6;
  transition: opacity 0.8s;
  pointer-events: none;
}

.Litemora-home.is-powered::before {
  opacity: 1;
}

.Litemora-home > * {
  position: relative;
}

/* The global `* { font-weight: 400; font-family: … }` reset reaches nested spans; restore inheritance where it matters. */
.section-heading > span,
.quote-container h2 > span,
.hero-lever__label,
.command-block__status,
.command-block__caret {
  font-weight: inherit;
}

.preview-url,
.command-block__caret {
  font-family: var(--rs-font-mono);
}

/* ---------------------------------------------------------------- Header */
.home-header {
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 56px;
  padding: 0 max(var(--signal-inset), calc((100% - var(--signal-max)) / 2 + var(--signal-inset)));
  border-bottom: 1px solid var(--rs-line);
  background: var(--rs-bg-1);
}

.header-brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--rs-text);
  font: 600 17px/1 var(--rs-font-body);
  text-decoration: none;
}

.header-brand img { image-rendering: pixelated; }
.auth-popover { position: relative; }

.auth-trigger {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--rs-radius);
  background: transparent;
  color: var(--rs-text);
  cursor: pointer;
}

.auth-trigger:hover,
.auth-trigger.active {
  background: var(--rs-bg-3);
  border-color: var(--rs-line-strong);
}

.auth-trigger:focus-visible,
.header-brand:focus-visible {
  outline: 2px solid var(--rs-red-hot);
  outline-offset: 2px;
}

.auth-avatar {
  display: grid;
  place-items: center;
  flex: none;
  width: 26px;
  height: 26px;
  overflow: hidden;
  border-radius: 2px;
  background: var(--rs-bg-4);
  font-weight: 700;
  font-size: 13px;
}

.auth-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.auth-menu {
  position: absolute;
  z-index: 30;
  top: calc(100% + 8px);
  right: 0;
  width: 280px;
  padding: 8px;
  border: 1px solid var(--rs-line-strong);
  border-radius: var(--rs-radius-lg);
  background: rgba(15, 17, 20, 0.97);
  box-shadow: var(--rs-shadow);
}

.auth-menu::before {
  content: '';
  position: absolute;
  left: 12px;
  right: 12px;
  top: -1px;
  height: 2px;
  background: var(--rs-red-hot);
  box-shadow: var(--rs-glow);
}

.auth-menu-title {
  padding: 8px 10px 10px;
  color: var(--rs-text-3);
  font-size: 12px;
  letter-spacing: 0.04em;
}

.auth-menu-header {
  padding: 10px 10px 12px;
  margin-bottom: 4px;
  border-bottom: 1px solid var(--rs-line);
}

.menu-account-copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.menu-account-copy strong {
  font-size: 14px;
}

.menu-account-copy span {
  color: var(--rs-text-3);
  font-size: 12px;
}

.auth-menu-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px;
  border: 0;
  border-radius: var(--rs-radius);
  background: transparent;
  color: var(--rs-text);
  font: 500 14px/1.2 var(--rs-font-body);
  text-align: left;
  cursor: pointer;
}

.auth-menu-item:hover:not(:disabled) {
  background: var(--rs-bg-3);
}

.auth-menu-item:focus-visible {
  outline: 2px solid var(--rs-red-hot);
  outline-offset: -2px;
}

.auth-menu-item:disabled {
  opacity: 0.55;
  cursor: wait;
}

.auth-menu-item.placeholder {
  color: var(--rs-text-2);
}

.auth-menu-item.danger {
  color: #ff8a78;
}

.menu-icon {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: var(--rs-radius);
  background: var(--rs-bg-0);
  box-shadow: inset 0 0 0 1px var(--rs-line);
}

.auth-menu-error {
  margin: 6px 10px 4px;
  color: #ff8a78;
  font-size: 12px;
  line-height: 1.5;
}

/* ---------------------------------------------------------------- Hero */
.hero-content {
  --signal-pad-top: 40px;
  padding-bottom: 72px;
}

.hero-grid {
  display: grid;
  grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
  align-items: center;
  gap: 48px;
  min-height: min(680px, calc(100vh - 160px));
}

.hero-copy {
  min-width: 0;
}

.hero-title {
  display: flex;
  align-items: center;
  gap: 20px;
  margin: 0;
  color: var(--rs-text);
  font-weight: 400;
}

/* Logo in an inventory slot. */
.hero-title-badge {
  display: grid;
  place-items: center;
  flex: none;
  width: 72px;
  height: 72px;
  padding: 0;
  border: 0;
  background: #1a1d21;
  box-shadow:
    inset 3px 3px 0 rgba(0, 0, 0, 0.55),
    inset -3px -3px 0 rgba(255, 255, 255, 0.08),
    0 0 0 2px #0a0b0d;
  cursor: pointer;
  transition: box-shadow 0.18s, transform 0.12s;
}

.hero-title-badge:active {
  transform: scale(0.96);
}

.hero-title-badge:focus-visible {
  outline: 2px solid var(--rs-red-hot);
  outline-offset: 3px;
}

/* Easter egg: the slot floods with redstone light for a moment. */
.hero-title-badge.is-egg {
  box-shadow:
    inset 3px 3px 0 rgba(0, 0, 0, 0.45),
    inset -3px -3px 0 rgba(255, 200, 180, 0.25),
    0 0 0 2px var(--rs-red-hot),
    var(--rs-glow);
  animation: hero-logo-egg 0.42s steps(2, end) 6;
}

.hero-title-badge.is-egg .hero-title-icon {
  filter: brightness(1.35) saturate(1.3) drop-shadow(0 0 10px rgba(255, 70, 40, 0.8));
}

@keyframes hero-logo-egg {
  0% { transform: translateY(0); }
  50% { transform: translateY(-2px); }
  100% { transform: translateY(0); }
}

.hero-title-icon {
  width: 62px;
  height: 62px;
  object-fit: contain;
}

.hero-title-word {
  font-family: var(--rs-font-pixel);
  font-size: 64px;
  line-height: 1;
  /* Minecraftia sits high in its line box. */
  padding-top: 14px;
  letter-spacing: 0.01em;
  text-shadow: 4px 4px 0 #2a0b08;
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-top: 40px;
}

.hero-actions .rs-btn {
  --rs-btn-h: 48px;
  gap: 12px;
  padding: 0 18px 0 0;
  font-size: 15px;
}

.hero-cta-circuit {
  display: grid;
  align-items: center;
  flex: none;
  align-self: stretch;
  padding-right: 8px;
  background: #211e20;
  border-right: 1px solid #110e0f;
  box-shadow: inset 0 1px #ffffff17, inset 0 -2px #0005;
}

.hero-cta-circuit::before {
  content: '';
  width: 48px;
  height: 16px;
  background: var(--button-circuit) left var(--circuit-frame, 0%) / 100% 400% no-repeat;
  image-rendering: pixelated;
  transition: background-position-y 300ms steps(3, end);
}

.hero-actions .rs-btn:is(:hover, :focus-visible, :active) {
  --circuit-frame: 100%;
}

.hero-actions .rs-btn:active .hero-cta-circuit::before {
  transition: none;
}

@media (prefers-reduced-motion: no-preference) {
  .hero-content.is-powered .hero-cta-circuit::before {
    animation: hero-circuit-start 900ms steps(3, end);
  }

  .hero-actions .rs-btn + .rs-btn .hero-cta-circuit::before {
    animation-delay: 150ms;
  }
}

@keyframes hero-circuit-start {
  0%, 100% { background-position-y: var(--circuit-frame, 0%); }
  35%, 70% { background-position-y: 100%; }
}

.hero-art {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
  min-width: 0;
}

.hero-art::before {
  /* Light pool under the build. */
  content: '';
  position: absolute;
  left: 8%;
  right: 8%;
  top: 22%;
  bottom: 6%;
  border-radius: 50%;
  background: radial-gradient(closest-side, rgba(255, 60, 30, 0.22), rgba(255, 60, 30, 0.06) 60%, transparent);
  opacity: 0.25;
  transition: opacity 0.6s;
  pointer-events: none;
}

.is-powered .hero-art::before {
  opacity: 1;
}

.hero-art__frame {
  position: relative;
  display: flex;
  justify-content: center;
  width: 100%;
}

/* Lever: switches the page's redstone on and off. */
.hero-lever {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  height: 36px;
  padding: 0 12px 0 8px;
  border: 1px solid var(--rs-line-strong);
  border-radius: var(--rs-radius);
  background: rgba(15, 17, 20, 0.8);
  color: var(--rs-text-2);
  font: 500 13px/1 var(--rs-font-body);
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}

.hero-lever:hover {
  border-color: rgba(255, 74, 46, 0.6);
  color: var(--rs-text);
}

.hero-lever:focus-visible {
  outline: 2px solid var(--rs-red-hot);
  outline-offset: 2px;
}

.hero-lever__switch {
  position: relative;
  width: 34px;
  height: 20px;
  border-radius: 2px;
  background: var(--rs-tex-polished-deepslate) center / 16px 16px;
  image-rendering: pixelated;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.6);
}

.hero-lever__switch span {
  position: absolute;
  top: 3px;
  left: 4px;
  width: 12px;
  height: 14px;
  background: #6b5a45;
  box-shadow: inset 0 -3px 0 rgba(0, 0, 0, 0.35), inset 0 3px 0 rgba(255, 255, 255, 0.15);
  transition: left 0.12s steps(2, end), background 0.15s;
}

.hero-lever.is-on .hero-lever__switch span {
  left: 18px;
  background: var(--rs-red-hot);
  box-shadow: inset 0 -3px 0 rgba(0, 0, 0, 0.3), 0 0 8px rgba(255, 60, 30, 0.7);
}

.hero-lever__state {
  min-width: 26px;
  color: var(--rs-text-3);
  font-size: 8px;
  line-height: 1;
  padding-top: 3px;
}

.hero-lever.is-on .hero-lever__state {
  color: var(--rs-red-hot);
}

/* ---------------------------------------------------------------- Shared headings */
.section-heading {
  display: flex;
  flex-direction: column;
  margin: 0;
  color: var(--rs-text);
  font-size: clamp(30px, 3vw, 42px);
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: -0.01em;
}

.section-heading__accent {
  color: var(--rs-red-hot);
}

/* ---------------------------------------------------------------- Manifesto */
.quote-stats-section {
  --signal-marker-top: calc(var(--signal-pad-top) + 10px);
}

.quote-container h2 {
  display: flex;
  flex-direction: column;
  margin: 0;
  color: var(--rs-text);
  font-size: clamp(32px, 3.6vw, 52px);
  font-weight: 700;
  line-height: 1.22;
  letter-spacing: -0.015em;
}

.quote-line2 {
  color: var(--rs-text-3);
  transition: color 0.6s;
}

.quote-stats-section.is-powered .quote-line2 {
  color: var(--rs-text-2);
}

.stats-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  margin-top: 56px;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 20px 22px;
  border: 1px solid var(--rs-line);
  border-radius: var(--rs-radius-lg);
  background: rgba(22, 25, 29, 0.72);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

.stat-lamp {
  flex: none;
  width: 48px;
  height: 48px;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.5), 0 0 0 1px #0a0b0d;
  transition: box-shadow 0.4s;
}

.quote-stats-section.is-powered .stat-lamp {
  box-shadow: 0 0 0 1px #0a0b0d, 0 0 22px rgba(255, 190, 90, 0.35);
}

.stat-item h3 {
  margin: 0;
  color: var(--rs-text);
  font-family: var(--rs-font-pixel);
  font-size: 32px;
  font-weight: 400;
  line-height: 1;
  padding-top: 8px;
}

.stat-item p {
  margin: 6px 0 0;
  color: var(--rs-text-2);
  font-size: 14px;
}

/* ---------------------------------------------------------------- Features */
.features-section {
  --signal-pad-top: 72px;
}

.features-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 64px minmax(0, 1fr) 64px minmax(0, 1fr);
  align-items: stretch;
}

.feature-card {
  padding: 26px 24px 28px;
}

.feature-card.rs-panel--wired::before {
  transition-delay: var(--step-delay, 0s);
}

.feature-card__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 22px;
}

.feature-icon {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
}

.step-num {
  color: var(--rs-red-dim);
  font-size: 16px;
  line-height: 1;
  transition: color 0.2s, text-shadow 0.2s;
  transition-delay: var(--step-delay, 0s);
}

.feature-card.is-powered .step-num {
  color: var(--rs-red-hot);
  text-shadow: 0 0 8px rgba(255, 60, 30, 0.6);
}

.step-title {
  margin: 0;
  color: var(--rs-text);
  font-size: 22px;
  font-weight: 700;
  line-height: 1.3;
}

.step-desc {
  margin: 8px 0 0;
  color: var(--rs-text-2);
  font-weight: 400;
  font-size: 14px;
  line-height: 1.6;
}

/* Wire + repeater between step cards. */
.feature-link {
  display: flex;
  align-items: center;
  align-self: center;
}

.feature-link__wire {
  flex: 1;
  height: 4px;
  background: var(--rs-red-off);
  transition: background 0.2s, box-shadow 0.2s;
}

.features-section.is-powered .feature-link__wire {
  background: var(--rs-red-hot);
  box-shadow: 0 0 6px rgba(255, 60, 30, 0.6);
}

.feature-link__repeater {
  flex: none;
  width: 32px;
  height: 32px;
  transform: rotate(90deg);
}

/* ---------------------------------------------------------------- Create */
.action-section {
  --signal-marker-top: calc(var(--signal-pad-top) + 6px);
}

.action-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
  align-items: start;
  gap: 72px;
}

/* Command block terminal */
.command-block {
  margin-top: 36px;
  border: 1px solid #6e4a34;
  border-radius: var(--rs-radius-lg);
  background: #0b0c0e;
  box-shadow: 0 0 0 1px #000, inset 0 1px 0 rgba(255, 255, 255, 0.04), var(--rs-shadow);
  overflow: hidden;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.command-block:focus-within {
  border-color: var(--rs-copper);
  box-shadow: 0 0 0 1px #000, 0 0 0 4px rgba(212, 122, 79, 0.16), var(--rs-shadow);
}

.command-block__bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid #3a2a20;
  background: linear-gradient(180deg, #2a1f18, #1d1612);
}

.command-block__icon {
  flex: none;
  width: 24px;
  height: 24px;
  background-image: var(--portal-command-block);
  background-size: 24px 96px;
  background-position: 0 0;
  image-rendering: pixelated;
  box-shadow: 0 0 0 1px #000;
}

.command-block__title {
  color: #e9b796;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.command-block__status {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin-left: auto;
  color: var(--rs-text-3);
  font: 500 12px/1 var(--rs-font-mono);
}

.command-block__status-dot {
  width: 7px;
  height: 7px;
  background: #3a2a20;
  transition: background 0.15s, box-shadow 0.15s;
}

.command-block__status.is-ready {
  color: var(--rs-emerald);
}

.command-block__status.is-ready .command-block__status-dot {
  background: var(--rs-emerald);
  box-shadow: 0 0 8px rgba(63, 212, 122, 0.7);
}

.input-wrapper {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 14px 10px 18px;
}

.command-block__prompt {
  flex: none;
  color: var(--rs-copper);
  font: 600 16px/1 var(--rs-font-mono);
}

.input-wrapper input {
  flex: 1;
  min-width: 0;
  height: 44px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--rs-text);
  font: 500 17px/1 var(--rs-font-mono);
  caret-color: var(--rs-red-hot);
}

.input-wrapper input::placeholder {
  color: var(--rs-text-3);
}

.input-wrapper input:focus {
  outline: none;
}

.submit-btn {
  display: grid;
  place-items: center;
  flex: none;
  width: 44px;
  height: 44px;
  border: 1px solid #ff5a3c;
  border-radius: var(--rs-radius);
  background:
    linear-gradient(180deg, rgba(255, 90, 60, 0.35), rgba(120, 10, 0, 0.35)),
    var(--rs-tex-redstone-block) center / 32px 32px;
  image-rendering: pixelated;
  color: #fff;
  cursor: pointer;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.25), inset 0 -2px 0 rgba(0, 0, 0, 0.35), var(--rs-glow-soft);
  transition: box-shadow 0.15s, filter 0.15s, transform 0.05s;
}

.submit-btn:hover:not(:disabled) {
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.3), inset 0 -2px 0 rgba(0, 0, 0, 0.35), var(--rs-glow);
}

.submit-btn:active:not(:disabled) {
  transform: translateY(1px);
}

.submit-btn:focus-visible {
  outline: 2px solid var(--rs-red-hot);
  outline-offset: 2px;
}

.submit-btn:disabled {
  border-color: var(--rs-line-strong);
  background: var(--rs-bg-3);
  color: var(--rs-text-3);
  box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.35);
  cursor: not-allowed;
}

.command-block__output {
  padding: 0 18px 16px;
  font: 400 13px/1.6 var(--rs-font-mono);
}

.preview-url {
  margin: 0;
  color: var(--rs-text-2);
}

.command-block__caret {
  margin-right: 8px;
  color: var(--rs-text-3);
}

.command-block.is-ready .preview-url {
  color: var(--rs-emerald);
}

.error-text {
  margin: 6px 0 0;
  color: #ff8a78;
  font-family: var(--rs-font-body);
}

.features-list-half {
  display: flex;
  flex-direction: column;
  gap: 28px;
  margin: 0;
  padding: 8px 0 0;
  list-style: none;
}

.feature-item {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  gap: 16px;
  padding-bottom: 28px;
  border-bottom: 1px solid var(--rs-line);
}

.feature-item:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}

.feature-item__dot {
  width: 10px;
  height: 10px;
  margin-top: 8px;
  background: var(--rs-red-off);
  transition: background 0.2s, box-shadow 0.2s;
}

.action-section.is-powered .feature-item__dot {
  background: var(--rs-red-hot);
  box-shadow: 0 0 8px rgba(255, 60, 30, 0.6);
}

.feature-item h4 {
  margin: 0;
  color: var(--rs-text);
  font-size: 18px;
  font-weight: 650;
  line-height: 1.4;
}

.feature-item p {
  margin: 6px 0 0;
  color: var(--rs-text-2);
  font-size: 15px;
  line-height: 1.65;
}

/* ---------------------------------------------------------------- Discover */
.discover-section {
  --signal-marker-top: calc(var(--signal-pad-top) + 4px);
}

.discover-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
  margin-top: 40px;
}

/* Four cards read better as 2×2 than 3 + 1. */
.discover-grid.is-even {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

/* ---------------------------------------------------------------- Footer */
.home-footer {
  --signal-pad-top: 112px;
  --signal-marker-top: 104px;
  padding-bottom: 56px;
}

.home-footer p {
  margin: 0;
  padding-top: 8px;
  color: var(--rs-text-2);
  font-size: 13px;
  line-height: 1.6;
}

.home-footer .home-credits {
  margin-bottom: 10px;
  /* Re-state the box padding: `.home-footer p` above is more specific than the
     component's own rule and would otherwise strip it down to a top padding. */
  padding: 10px 14px;
}

.home-docs {
  margin-top: 16px;
}

/* ---------------------------------------------------------------- Responsive */
@media (max-width: 1100px) {
  .hero-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 40px;
    min-height: 0;
  }

  .hero-art {
    order: 0;
  }

  .features-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
  }

  .feature-link {
    display: none;
  }

  .action-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 48px;
  }

  .discover-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .Litemora-home {
    --signal-inset: 12px;
    --signal-gutter: 36px;
    --signal-pad-top: 88px;
    --signal-marker-top: 92px;
  }

  .auth-menu {
    width: min(280px, calc(100vw - 1.5rem));
  }

  .hero-content {
    --signal-pad-top: 32px;
    padding-bottom: 48px;
  }

  .hero-title {
    gap: 14px;
  }

  .hero-title-badge {
    width: 52px;
    height: 52px;
  }

  .hero-title-icon {
    width: 44px;
    height: 44px;
  }

  .hero-title-word {
    font-size: 40px;
    padding-top: 9px;
    text-shadow: 3px 3px 0 #2a0b08;
  }

  .hero-actions {
    margin-top: 28px;
    gap: 10px;
  }

  .hero-actions .rs-btn {
    --rs-btn-h: 46px;
    flex: 1 1 auto;
    justify-content: flex-start;
    gap: 8px;
    padding-right: 12px;
  }

  .stats-row {
    grid-template-columns: minmax(0, 1fr);
    gap: 10px;
    margin-top: 36px;
  }

  .stat-item {
    padding: 14px 16px;
  }

  .stat-lamp {
    width: 32px;
    height: 32px;
  }

  .stat-item h3 {
    font-size: 24px;
    padding-top: 6px;
  }

  .features-section {
    --signal-pad-top: 48px;
  }

  .input-wrapper {
    padding: 10px 10px 8px 14px;
  }

  .command-block__prompt {
    font-size: 14px;
  }

  .input-wrapper input {
    font-size: 16px;
  }

  .command-block__output {
    padding: 0 14px 14px;
  }

  .discover-grid,
  .discover-grid.is-even {
    grid-template-columns: minmax(0, 1fr);
    gap: 14px;
    margin-top: 28px;
  }

  .home-footer {
    --signal-pad-top: 80px;
    --signal-marker-top: 76px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .Litemora-home::before,
  .hero-cta-circuit::before,
  .hero-art::before,
  .quote-line2,
  .stat-lamp,
  .step-num,
  .feature-card.rs-panel--wired::before {
    transition: none;
  }
}
</style>
