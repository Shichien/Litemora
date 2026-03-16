<script setup>
import { buildSpaceUrl, isValidSpaceName, normalizeSpaceName } from '@three/utils/space-context.js'
import { computed, ref, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const { t, locale } = useI18n()

// Theme State
const isDarkMode = ref(true)

// Load saved settings
onMounted(() => {
  const saved = localStorage.getItem('mc-game-settings')
  if (saved) {
    try {
      const parsed = JSON.parse(saved)
      if (parsed.language) {
        locale.value = parsed.language
      }
      if (parsed.theme === 'light') {
        isDarkMode.value = false
      }
    } catch (e) {
      console.warn('Failed to parse settings', e)
    }
  }
  updateThemeClass()
})

// Save settings when they change
const saveSettings = () => {
  const saved = localStorage.getItem('mc-game-settings')
  let parsed = {}
  if (saved) {
    try {
      parsed = JSON.parse(saved)
    } catch(e){}
  }
  parsed.language = locale.value
  parsed.theme = isDarkMode.value ? 'dark' : 'light'
  localStorage.setItem('mc-game-settings', JSON.stringify(parsed))
}

watch(locale, () => { saveSettings() })
watch(isDarkMode, () => {
  saveSettings()
  updateThemeClass()
})

function updateThemeClass() {
  const el = document.documentElement
  if (isDarkMode.value) {
    el.classList.add('dark-theme')
    el.classList.remove('light-theme')
  } else {
    el.classList.add('light-theme')
    el.classList.remove('dark-theme')
  }
}

// Dummy Auth State
const isLoggedIn = ref(false)

function loginWithGithub() {
  // Mock OAuth flow
  setTimeout(() => {
    isLoggedIn.value = true
  }, 500)
}

function toggleTheme() {
  isDarkMode.value = !isDarkMode.value
}

function toggleLanguage() {
  locale.value = locale.value === 'en' ? 'zh' : 'en'
}

const inputSpaceName = ref('')
const errorText = ref('')
const normalizedSpaceName = computed(() => normalizeSpaceName(inputSpaceName.value))
const canCreate = computed(() => isValidSpaceName(normalizedSpaceName.value))
const spaceUrlPreview = computed(() => `litemora.art/${normalizedSpaceName.value || 'your-space'}`)

function handleSubmit() {
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
    const targetUrl = buildSpaceUrl(normalizedSpaceName.value)
    window.location.href = targetUrl
  } catch {
    errorText.value = t('home.create.error.failed')
  }
}

function scrollToSection(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const discoverSpaces = [
  { title: 'Brutalist Library', author: 'By Shichien', url: 'brutalist-library', img: '/textures/background/afternoon.png' },
  { title: 'Cyberpunk City', author: 'By Litemora Community', url: 'cyber-city', img: '/textures/background/midnight.png' },
  { title: 'Medieval Castle', author: 'By BuilderXYZ', url: 'medieval', img: '/textures/background/sunset.png' },
  { title: 'Zen Garden', author: 'By ArchD', url: 'zen-garden', img: '/textures/background/morning.png' },
  { title: 'Sky Island', author: 'By Aeria', url: 'sky-island', img: '/textures/background/noon.png' },
  { title: 'Deep Dark City', author: 'By Miner123', url: 'deep-dark', img: '/textures/background/dusk.png' },
]
</script>

<template>
  <main class="afilmory-home">
    <!-- Hero Grid Background -->
    <div class="hero-grid-bg">
      <div class="grid-layer" :style="{ opacity: isDarkMode ? 0.4 : 0.15 }">
        <img src="/textures/background/morning.png" class="grid-img img-1" />
        <img src="/textures/background/noon.png" class="grid-img img-2" />
        <img src="/textures/background/afternoon.png" class="grid-img img-3" />
        <img src="/textures/background/sunset.png" class="grid-img img-4" />
        <img src="/textures/background/dusk.png" class="grid-img img-5" />
        <img src="/textures/background/midnight.png" class="grid-img img-6" />
        <img src="/textures/background/sunrise.png" class="grid-img img-7" />
        <img src="/textures/background/afternoon.png" class="grid-img img-8" />
      </div>
      <div class="gradient-overlay"></div>
    </div>

    <!-- Header -->
    <header class="home-header">
      <div class="header-left">
        <button @click="toggleTheme" class="icon-btn" :title="isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'">
          <span v-if="isDarkMode">☀️</span>
          <span v-else>🌙</span>
        </button>
        <button @click="toggleLanguage" class="icon-btn lang-btn" title="Toggle Language">
          {{ locale === 'en' ? '中' : 'EN' }}
        </button>
      </div>
      
      <div class="logo-container">
        <img src="/logo.png" alt="Litemora Logo" class="brand-logo" />
        <div class="logo-text">Litemora</div>
      </div>
      
      <nav class="nav-links">
        <a href="https://github.com/shichien/Litemora" target="_blank" rel="noopener noreferrer" class="icon-btn github-link" title="GitHub">
          <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
          </svg>
        </a>
        <div class="divider"></div>
        <button v-if="isLoggedIn" class="sign-in-btn" @click="scrollToSection('create-space')">{{ t('home.nav.create') }}</button>
        <button v-else class="sign-in-btn github-login" @click="loginWithGithub">{{ t('home.nav.loginGithub') }}</button>
      </nav>
    </header>

    <!-- Hero Content -->
    <section class="hero-content">
      <h1 class="hero-title">Litemora</h1>
      <p class="hero-subtitle">{{ t('home.hero.subtitle') }}</p>
    </section>

    <!-- Quote & Stats -->
    <section class="quote-stats-section" id="manifesto">
      <div class="quote-container">
        <h2>{{ t('home.quote.line1') }}<br/>{{ t('home.quote.line2') }}</h2>
        <p>{{ t('home.quote.desc') }}</p>
      </div>
      
      <div class="stats-row">
        <div class="stat-item">
          <h3>3+</h3>
          <p>{{ t('home.stats.formats') }}</p>
        </div>
        <div class="stat-item">
          <h3>100%</h3>
          <p>{{ t('home.stats.nativeRendering') }}</p>
        </div>
        <div class="stat-item">
          <h3>0</h3>
          <p>{{ t('home.stats.serverCost') }}</p>
        </div>
      </div>
    </section>

    <!-- Features Steps -->
    <section class="features-section">
      <div class="features-grid">
        <div class="feature-card">
          <span class="step-num">01</span>
          <h4 class="step-title">{{ t('home.features.step1.title') }}</h4>
          <p class="step-desc">{{ t('home.features.step1.subtitle') }}<br/><span class="muted">{{ t('home.features.step1.desc') }}</span></p>
        </div>
        <div class="feature-card">
          <span class="step-num">02</span>
          <h4 class="step-title">{{ t('home.features.step2.title') }}</h4>
          <p class="step-desc">{{ t('home.features.step2.subtitle') }}<br/><span class="muted">{{ t('home.features.step2.desc') }}</span></p>
        </div>
        <div class="feature-card">
          <span class="step-num">03</span>
          <h4 class="step-title">{{ t('home.features.step3.title') }}</h4>
          <p class="step-desc">{{ t('home.features.step3.subtitle') }}<br/><span class="muted">{{ t('home.features.step3.desc') }}</span></p>
        </div>
      </div>
    </section>

    <!-- Create & Discover (Split Section) -->
    <section class="action-section" id="create-space">
      <div class="create-half">
        <h2 class="section-heading">{{ t('home.create.title1') }}<br/>{{ t('home.create.title2') }}</h2>
        <p class="section-desc">{{ t('home.create.desc') }}</p>
        
        <form class="create-form" @submit.prevent="handleSubmit">
          <div class="input-wrapper">
            <input type="text" v-model="inputSpaceName" :placeholder="t('home.create.placeholder')" maxlength="63" />
            <button type="submit" :disabled="!canCreate" class="submit-btn">→</button>
          </div>
          <p class="preview-url">{{ spaceUrlPreview }}</p>
          <p v-if="errorText" class="error-text">{{ errorText }}</p>
        </form>
      </div>
      
      <div class="features-list-half">
        <div class="feature-item">
          <h4>{{ t('home.create.benefits.b1Title') }}</h4>
          <p>{{ t('home.create.benefits.b1Desc') }}</p>
        </div>
        <div class="feature-item">
          <h4>{{ t('home.create.benefits.b2Title') }}</h4>
          <p>{{ t('home.create.benefits.b2Desc') }}</p>
        </div>
        <div class="feature-item">
          <h4>{{ t('home.create.benefits.b3Title') }}</h4>
          <p>{{ t('home.create.benefits.b3Desc') }}</p>
        </div>
      </div>
    </section>

    <!-- Discover Section -->
    <section class="discover-section">
      <h2 class="section-heading" style="color: var(--text-main);">{{ t('home.discover.title') }}</h2>
      <p class="section-desc">{{ t('home.discover.desc') }}</p>
      
      <div class="discover-grid">
        <a v-for="space in discoverSpaces" :key="space.url" :href="`/${space.url}`" class="discover-card">
          <img :src="space.img" :alt="space.title" class="discover-img" />
          <div class="discover-info">
            <div class="avatar-placeholder"></div>
            <div class="author-info">
              <h4>{{ space.title }}</h4>
              <p>{{ space.author }}</p>
            </div>
          </div>
        </a>
      </div>
    </section>
    
    <!-- Footer -->
    <footer class="home-footer">
      <p>{{ t('home.footer') }}</p>
    </footer>
  </main>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;1,400&family=Inter:wght@300;400;500&display=swap');

/* Default (Dark) CSS Variables */
:global(.dark-theme) {
  --bg: #040404;
  --text-main: #f5f5f5;
  --text-muted: #888888;
  --line-color: rgba(255, 255, 255, 0.15);
  --accent: #d4af37;
  --gradient-overlay: linear-gradient(to bottom, rgba(4, 4, 4, 0.1) 0%, rgba(4, 4, 4, 0.6) 40%, rgba(4, 4, 4, 0.95) 80%, #040404 100%);
  --card-bg: rgba(255, 255, 255, 0.02);
  --card-border: rgba(255, 255, 255, 0.05);
  --card-hover-bg: rgba(255, 255, 255, 0.04);
}

/* Light Mode CSS Variables */
:global(.light-theme) {
  --bg: #f5f3ef; /* Cream/off-white */
  --text-main: #111111;
  --text-muted: #666666;
  --line-color: rgba(0, 0, 0, 0.15);
  --accent: #b58900; /* Darker gold for contrast */
  --gradient-overlay: linear-gradient(to bottom, rgba(245, 243, 239, 0.3) 0%, rgba(245, 243, 239, 0.8) 40%, rgba(245, 243, 239, 0.98) 80%, #f5f3ef 100%);
  --card-bg: #ffffff;
  --card-border: rgba(0, 0, 0, 0.08);
  --card-hover-bg: rgba(0, 0, 0, 0.02);
}

/* Fallback default if no class is present on html/body */
.afilmory-home {
  --bg: #040404;
  --text-main: #f5f5f5;
  --text-muted: #888888;
  --line-color: rgba(255, 255, 255, 0.15);
  --accent: #d4af37;
  --gradient-overlay: linear-gradient(to bottom, rgba(4, 4, 4, 0.1) 0%, rgba(4, 4, 4, 0.6) 40%, rgba(4, 4, 4, 0.95) 80%, #040404 100%);
  --card-bg: rgba(255, 255, 255, 0.02);
  --card-border: rgba(255, 255, 255, 0.05);
  --card-hover-bg: rgba(255, 255, 255, 0.04);
}

:global(.dark-theme) .afilmory-home {
  --bg: #040404;
  --text-main: #f5f5f5;
  --text-muted: #888888;
  --line-color: rgba(255, 255, 255, 0.15);
  --accent: #d4af37;
  --gradient-overlay: linear-gradient(to bottom, rgba(4, 4, 4, 0.1) 0%, rgba(4, 4, 4, 0.6) 40%, rgba(4, 4, 4, 0.95) 80%, #040404 100%);
  --card-bg: rgba(255, 255, 255, 0.02);
  --card-border: rgba(255, 255, 255, 0.05);
  --card-hover-bg: rgba(255, 255, 255, 0.04);
}

:global(.light-theme) .afilmory-home {
  --bg: #f5f3ef;
  --text-main: #111111;
  --text-muted: #666666;
  --line-color: rgba(0, 0, 0, 0.15);
  --accent: #b58900;
  --gradient-overlay: linear-gradient(to bottom, rgba(245, 243, 239, 0.3) 0%, rgba(245, 243, 239, 0.8) 40%, rgba(245, 243, 239, 0.98) 80%, #f5f3ef 100%);
  --card-bg: #ffffff;
  --card-border: rgba(0, 0, 0, 0.08);
  --card-hover-bg: rgba(0, 0, 0, 0.02);
}

.afilmory-home {
  background-color: var(--bg);
  color: var(--text-main);
  font-family: 'Inter', sans-serif;
  min-height: 100vh;
  position: relative;
  overflow-x: hidden;
  font-weight: 300;
  transition: background-color 0.4s ease, color 0.4s ease;
}

h1, h2, h3, h4, .hero-title, .logo, .step-num {
  font-family: 'Playfair Display', serif;
  font-weight: 400;
}

/* Background Grid Setup */
.hero-grid-bg {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 110vh;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
}

.grid-layer {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  grid-auto-rows: 30vh;
  gap: 4px;
  transform: scale(1.05);
  transition: opacity 0.4s ease;
}

.grid-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: grayscale(40%) brightness(0.8);
}

.gradient-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: var(--gradient-overlay);
  transition: background 0.4s ease;
}

/* Layout Utilities */
header, section, footer {
  position: relative;
  z-index: 10;
  max-width: 1400px;
  margin: 0 auto;
  padding: 0 4vw;
}

/* Header */
.home-header {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  padding-top: 2rem;
  padding-bottom: 2rem;
}

.header-left {
  display: flex;
  gap: 1rem;
  align-items: center;
}

.logo-container {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.8rem;
}

.brand-logo {
  height: 32px;
  width: auto;
  object-fit: contain;
  transition: filter 0.3s;
}

/* Base logo is dark so we invert it for dark mode */
:global(.dark-theme) .brand-logo {
  filter: invert(1) brightness(0.9);
}

.logo-text {
  font-size: 1.5rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  font-family: 'Playfair Display', serif;
}

.nav-links {
  display: flex;
  gap: 1.5rem;
  align-items: center;
  justify-content: flex-end;
}

.nav-links button,
.nav-links .nav-anchor {
  background: none;
  border: none;
  color: var(--text-muted);
  font-family: 'Inter', sans-serif;
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  cursor: pointer;
  transition: color 0.3s, background-color 0.3s, border-color 0.3s;
  text-decoration: none;
}

.nav-links button:hover,
.nav-links .nav-anchor:hover {
  color: var(--text-main);
}

.sign-in-btn {
  color: var(--bg) !important;
  background-color: var(--text-main) !important;
  padding: 0.6rem 1.2rem;
  border-radius: 2px;
  font-weight: 500;
}

.sign-in-btn:hover {
  background-color: var(--accent) !important;
}

.github-login {
  background-color: #2b3137 !important;
  color: #fff !important;
}

.github-login:hover {
  background-color: #24292e !important;
}

.divider {
  width: 1px;
  height: 16px;
  background-color: var(--line-color);
  margin: 0 0.2rem;
}

.icon-btn {
  font-size: 1.2rem !important;
  color: var(--text-main) !important;
  padding: 0.2rem;
  background: none;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.github-link {
  color: var(--text-muted) !important;
  transition: color 0.3s;
}

.github-link:hover {
  color: var(--text-main) !important;
}

.lang-btn {
  font-weight: 500;
  font-family: 'Inter', sans-serif;
  font-size: 0.95rem !important;
}

/* Hero Content */
.hero-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 60vh;
  text-align: center;
}

.hero-title {
  font-size: clamp(4rem, 10vw, 8.5rem);
  margin: 0;
  letter-spacing: 0.02em;
  line-height: 1;
}

.hero-subtitle {
  font-size: clamp(1rem, 2vw, 1.3rem);
  color: var(--text-muted);
  margin-top: 1.5rem;
  font-style: italic;
  font-family: 'Playfair Display', serif;
}

/* Quote & Stats */
.quote-stats-section {
  padding-top: 8rem;
  padding-bottom: 8rem;
  border-bottom: 1px solid var(--line-color);
}

.quote-container {
  max-width: 800px;
  margin: 0 auto;
  text-align: left;
}

.quote-container h2 {
  font-size: clamp(2rem, 4vw, 3.5rem);
  line-height: 1.2;
  margin-bottom: 2rem;
  color: var(--text-main);
}

.quote-container p {
  font-size: 1rem;
  color: var(--accent);
  max-width: 70%;
  line-height: 1.6;
}

.stats-row {
  display: flex;
  justify-content: flex-start;
  gap: 15%;
  margin-top: 6rem;
  max-width: 800px;
  margin-left: auto;
  margin-right: auto;
}

.stat-item h3 {
  font-size: 2.5rem;
  margin: 0 0 0.5rem 0;
}

.stat-item p {
  color: var(--text-muted);
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0;
}

/* Features Steps */
.features-section {
  padding: 6rem 4vw;
  border-bottom: 1px solid var(--line-color);
}

.features-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 3rem;
  max-width: 1200px;
  margin: 0 auto;
}

.feature-card {
  display: flex;
  flex-direction: column;
}

.step-num {
  font-size: 3.5rem;
  color: var(--text-muted);
  opacity: 0.5;
  border-bottom: 1px solid var(--line-color);
  padding-bottom: 1rem;
  margin-bottom: 2rem;
}

.step-title {
  font-size: 1.5rem;
  margin: 0 0 1rem 0;
  font-family: 'Inter', sans-serif;
  font-weight: 400;
}

.step-desc {
  font-size: 0.95rem;
  line-height: 1.6;
  margin: 0;
}
.step-desc .muted {
  color: var(--text-muted);
  display: block;
  margin-top: 0.5rem;
}

/* Create & Discover Block */
.action-section {
  padding: 10rem 4vw;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6rem;
  align-items: center;
  border-bottom: 1px solid var(--line-color);
}

.section-heading {
  font-size: clamp(2.5rem, 5vw, 4.5rem);
  line-height: 1.1;
  margin: 0 0 1.5rem 0;
  color: var(--accent);
}

.section-desc {
  color: var(--text-muted);
  font-size: 1.1rem;
  line-height: 1.6;
  max-width: 80%;
  margin-bottom: 3rem;
}

.create-form {
  max-width: 400px;
}

.input-wrapper {
  display: flex;
  border-bottom: 1px solid var(--text-main);
  padding-bottom: 0.5rem;
}

.input-wrapper input {
  flex: 1;
  background: transparent;
  border: none;
  color: var(--text-main);
  font-size: 1.2rem;
  font-family: 'Inter', sans-serif;
  outline: none;
}

.input-wrapper input::placeholder {
  color: var(--text-muted);
  opacity: 0.5;
}

.submit-btn {
  background: transparent;
  border: none;
  color: var(--text-main);
  font-size: 1.5rem;
  cursor: pointer;
  transition: transform 0.3s;
}

.submit-btn:hover:not(:disabled) {
  transform: translateX(5px);
}

.submit-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.preview-url {
  font-size: 0.85rem;
  color: var(--text-muted);
  margin-top: 1rem;
}

.error-text {
  color: #ff6b6b;
  font-size: 0.85rem;
  margin-top: 0.5rem;
}

.features-list-half {
  display: flex;
  flex-direction: column;
  gap: 3rem;
  border-left: 1px solid var(--line-color);
  padding-left: 4rem;
}

.feature-item h4 {
  font-size: 1.2rem;
  margin: 0 0 0.5rem 0;
  font-family: 'Inter', sans-serif;
  font-weight: 500;
}

.feature-item p {
  color: var(--text-muted);
  margin: 0;
  font-size: 0.95rem;
  line-height: 1.5;
}

/* Discover Section */
.discover-section {
  padding: 8rem 4vw;
}

.discover-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 2rem;
  margin-top: 4rem;
}

.discover-card {
  display: block;
  text-decoration: none;
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  transition: transform 0.3s ease, background 0.3s ease;
  overflow: hidden;
}

.discover-card:hover {
  transform: translateY(-5px);
  background: var(--card-hover-bg);
}

.discover-img {
  width: 100%;
  height: 200px;
  object-fit: cover;
  filter: grayscale(20%);
  transition: filter 0.3s ease;
}

.discover-card:hover .discover-img {
  filter: grayscale(0%);
}

.discover-info {
  display: flex;
  align-items: center;
  padding: 1.5rem;
  gap: 1rem;
}

.avatar-placeholder {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--text-muted);
  opacity: 0.2;
}

.author-info h4 {
  color: var(--text-main);
  margin: 0;
  font-size: 1rem;
  font-family: 'Inter', sans-serif;
}

.author-info p {
  color: var(--text-muted);
  margin: 0.3rem 0 0 0;
  font-size: 0.8rem;
}

/* Footer */
.home-footer {
  text-align: center;
  padding: 3rem;
  border-top: 1px solid var(--line-color);
  color: var(--text-muted);
  font-size: 0.85rem;
}

/* Responsive */
@media (max-width: 1024px) {
  .features-grid {
    grid-template-columns: 1fr;
    gap: 4rem;
  }
  
  .action-section {
    grid-template-columns: 1fr;
    gap: 4rem;
  }
  
  .features-list-half {
    border-left: none;
    padding-left: 0;
  }
}

@media (max-width: 768px) {
  .hero-title {
    font-size: 3.5rem;
  }
  
  .quote-container h2 {
    font-size: 2rem;
  }
  
  .stats-row {
    flex-direction: column;
    gap: 2rem;
    margin-top: 3rem;
  }
}
</style>
