import { createDebugPlugin } from '@pinia/debug-plugin.js'
import i18n from '@three/i18n.js'
import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import '@styles/main.scss'

const app = createApp(App)

// 创建 Pinia 实例并添加调试插件
const pinia = createPinia()
pinia.use(createDebugPlugin())

app.use(pinia)
app.use(i18n)
app.mount('#app')
