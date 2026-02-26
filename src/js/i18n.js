import { createI18n } from 'vue-i18n'
import en from '../locales/en.json'
import zh from '../locales/zh.json'

// Get saved language or default to Chinese
function getDefaultLocale() {
  const saved = localStorage.getItem('mc-game-settings')
  if (saved) {
    try {
      const parsed = JSON.parse(saved)
      if (parsed.language) {
        return parsed.language
      }
    }
    catch (e) {
      console.warn('Failed to parse settings for language', e)
    }
  }

  return 'zh'
}

const i18n = createI18n({
  legacy: false, // Compulsory for Composition API
  locale: getDefaultLocale(),
  fallbackLocale: 'en',
  messages: {
    en,
    zh,
  },
})

export default i18n
