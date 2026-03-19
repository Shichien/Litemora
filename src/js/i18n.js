import { createI18n } from 'vue-i18n'
import en from '../locales/en.json'
import zh from '../locales/zh.json'

const i18n = createI18n({
  legacy: false, // Compulsory for Composition API
  locale: 'zh',
  fallbackLocale: 'zh',
  messages: {
    en,
    zh,
  },
})

export default i18n
