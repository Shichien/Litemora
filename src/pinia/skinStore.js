import { DEFAULT_SKIN_ID, SKIN_LIST } from '@three/config/skin-config.js'
import emitter from '@three/utils/event/event-bus.js'
/**
 * Skin Store - 皮肤系统状态管理
 * 管理皮肤选择、预览状态和持久化
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'

// ========================================
// Constants
// ========================================
const STORAGE_KEY = 'mc-player-skin'

// ========================================
// Skin Store Definition
// ========================================
export const useSkinStore = defineStore('skin', () => {
  // ----------------------------------------
  // State
  // ----------------------------------------

  /** 当前选中的皮肤 ID */
  const currentSkinId = ref(DEFAULT_SKIN_ID)

  /** 预览界面临时选中的皮肤 ID */
  const previewSkinId = ref(null)

  /** 模型加载状态 */
  const isLoading = ref(false)

  // ----------------------------------------
  // Persistence
  // ----------------------------------------

  /**
   * 从 localStorage 加载皮肤设置
   */
  function loadSkin() {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && SKIN_LIST.find(s => s.id === saved)) {
      currentSkinId.value = saved
    }
  }

  /**
   * 保存当前皮肤到 localStorage
   */
  function saveSkin() {
    localStorage.setItem(STORAGE_KEY, currentSkinId.value)
  }

  // ----------------------------------------
  // Preview Actions
  // ----------------------------------------

  /**
   * 初始化预览（进入皮肤选择界面时调用）
   */
  function initPreview() {
    previewSkinId.value = currentSkinId.value
  }

  /**
   * 设置预览皮肤
   * @param {string} skinId - 皮肤 ID
   */
  function setPreviewSkin(skinId) {
    previewSkinId.value = skinId
  }

  /**
   * 应用皮肤（确认选择）
   * 仅当预览皮肤与当前皮肤不同时才触发更新
   */
  function applySkin() {
    if (previewSkinId.value && previewSkinId.value !== currentSkinId.value) {
      currentSkinId.value = previewSkinId.value
      saveSkin()
      emitter.emit('skin:changed', { skinId: currentSkinId.value })
    }
  }

  /**
   * 取消预览（返回时调用）
   */
  function cancelPreview() {
    previewSkinId.value = null
  }

  // ----------------------------------------
  // Helpers
  // ----------------------------------------

  /**
   * 获取皮肤配置
   * @param {string} skinId - 皮肤 ID
   * @returns {object|undefined} 皮肤配置对象
   */
  function getSkinConfig(skinId) {
    return SKIN_LIST.find(s => s.id === skinId)
  }

  // ----------------------------------------
  // Initialization
  // ----------------------------------------

  // 初始化时加载保存的皮肤
  loadSkin()

  // ----------------------------------------
  // Return Public API
  // ----------------------------------------
  return {
    // State
    currentSkinId,
    previewSkinId,
    isLoading,

    // Persistence
    loadSkin,
    saveSkin,

    // Preview Actions
    initPreview,
    setPreviewSkin,
    applySkin,
    cancelPreview,

    // Helpers
    getSkinConfig,
  }
})
