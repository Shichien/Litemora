<script setup>
import debugEventFilter, { DEFAULT_BLACKLIST } from '@three/utils/debug/debug-event-filter.js'
import debugStateMonitor from '@three/utils/debug/debug-state-monitor.js'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import EventLogItem from './EventLogItem.vue'

// 折叠状态
const isCollapsed = ref(false)
function toggleCollapse() {
  isCollapsed.value = !isCollapsed.value
}

// 暂停监控
const isPaused = ref(false)
function togglePause() {
  isPaused.value = !isPaused.value
  if (isPaused.value) {
    debugStateMonitor.isPaused = true
  }
  else {
    debugStateMonitor.isPaused = false
  }
}

// 搜索
const searchQuery = ref('')
watch(searchQuery, (val) => {
  debugStateMonitor.setSearchQuery(val)
})

// 黑名单
const enableBlacklist = ref(true)
const selectedBlacklist = ref([...DEFAULT_BLACKLIST])
const blacklistOptions = ['core:tick', 'core:resize', 'camera:', 'render:']

watch(enableBlacklist, (val) => {
  debugEventFilter.enableBlacklist = val
})

watch(selectedBlacklist, (val) => {
  debugEventFilter.setBlacklist(val)
}, { deep: true })

// 日志列表
const allLogs = ref([])

// 应用所有过滤器
const filteredLogs = computed(() => {
  let logs = [...allLogs.value]

  // 1. 应用黑名单过滤器
  logs = debugEventFilter.filterLogs(logs)

  // 2. 应用搜索过滤
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase()
    logs = logs.filter((log) => {
      const text = `${log.eventName} ${JSON.stringify(log.data)}`.toLowerCase()
      return text.includes(query)
    })
  }

  return logs
})

// 限制显示数量（避免性能问题）
const displayedLogs = computed(() => {
  return filteredLogs.value.slice(-100)
})

// 定时刷新
let refreshInterval = null

onMounted(() => {
  refreshInterval = setInterval(() => {
    if (!isPaused.value) {
      allLogs.value = [...debugStateMonitor.logs]
    }
  }, 500)
})

onUnmounted(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval)
  }
})

// 导出
function exportLogs() {
  const data = {
    timestamp: new Date().toISOString(),
    filters: {
      search: searchQuery.value,
      blacklist: selectedBlacklist.value,
      enableBlacklist: enableBlacklist.value,
    },
    summary: {
      totalLogs: allLogs.value.length,
      filteredLogs: filteredLogs.value.length,
    },
    logs: filteredLogs.value,
  }

  navigator.clipboard.writeText(JSON.stringify(data, null, 2))
    .then(() => {
      console.warn('[EventMonitor] Exported to clipboard')
    })
    .catch((err) => {
      console.error('[EventMonitor] Export failed:', err)
    })
}

// 清空
function clearLogs() {
  debugStateMonitor.clearLogs()
  allLogs.value = []
}

// 刷新
function refreshLogs() {
  allLogs.value = [...debugStateMonitor.logs]
}
</script>

<template>
  <div
    class="event-monitor-panel relative flex flex-col bg-gray-900/95 backdrop-blur-sm border-r border-gray-700/50 transition-all duration-300 ease-in-out h-screen overflow-hidden shadow-2xl"
    :class="{ collapsed: isCollapsed }"
    :style="{ width: isCollapsed ? '40px' : '400px' }"
  >
    <!-- 折叠/展开按钮 -->
    <button
      class="absolute -right-6 top-4 w-6 h-12 bg-gray-800 border border-l-0 border-gray-700 rounded-r flex items-center justify-center hover:bg-gray-700 transition-colors z-50 shadow-lg"
      :class="{ 'opacity-50': isCollapsed }"
      @click="toggleCollapse"
    >
      <span class="text-gray-400 text-xs">
        {{ isCollapsed ? '▶' : '◀' }}
      </span>
    </button>

    <!-- 最小化状态 -->
    <div v-if="isCollapsed" class="flex flex-col items-center py-4 h-full cursor-pointer hover:bg-gray-800/50 transition-colors" @click="toggleCollapse">
      <div class="text-gray-400 text-xs writing-mode-vertical whitespace-nowrap tracking-wider font-medium">
        🔍 Event Monitor
      </div>
      <div class="mt-2 w-1 h-8 bg-gray-700 rounded-full" />
    </div>

    <!-- 展开状态：完整面板 -->
    <template v-else>
      <!-- 标题栏 -->
      <div class="flex items-center justify-between px-4 py-3 border-b border-gray-700/50 bg-gray-900 shrink-0">
        <h3 class="text-gray-200 font-semibold text-sm">
          🔍 Event Monitor
        </h3>
        <button
          class="px-2 py-1 text-xs bg-gray-800 text-gray-300 rounded hover:bg-gray-700 transition-colors"
          @click="togglePause"
        >
          {{ isPaused ? '▶️' : '⏸️' }}
        </button>
      </div>

      <!-- 过滤器区域 -->
      <div class="px-4 py-3 space-y-3 border-b border-gray-700/50 bg-gray-900/50 shrink-0">
        <!-- 搜索栏 -->
        <div>
          <label class="text-xs text-gray-500 mb-1 block">搜索</label>
          <input
            v-model="searchQuery"
            type="text"
            placeholder="事件名或数据..."
            class="w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-colors"
          >
        </div>

        <!-- 事件黑名单 -->
        <div>
          <div class="flex items-center justify-between mb-2">
            <label class="text-xs text-gray-500">事件黑名单</label>
            <label class="flex items-center gap-1 text-xs text-gray-400 cursor-pointer hover:text-gray-300">
              <input v-model="enableBlacklist" type="checkbox" class="rounded border-gray-600">
              启用
            </label>
          </div>
          <div class="flex flex-wrap gap-1.5">
            <label
              v-for="item in blacklistOptions"
              :key="item"
              class="flex items-center gap-1 px-2 py-1 bg-gray-800 rounded text-xs text-gray-400 cursor-pointer hover:bg-gray-700 transition-colors"
              :class="{ 'opacity-50': !enableBlacklist }"
            >
              <input
                v-model="selectedBlacklist"
                type="checkbox"
                :value="item"
                class="rounded border-gray-600"
                :disabled="!enableBlacklist"
              >
              {{ item }}
            </label>
          </div>
        </div>
      </div>

      <!-- 统计信息 -->
      <div class="px-4 py-2 bg-gray-800/30 border-b border-gray-700/50 text-xs text-gray-500 shrink-0">
        显示 {{ filteredLogs.length }} / {{ allLogs.length }} 条日志
      </div>

      <!-- 事件列表 -->
      <div class="flex-1 overflow-y-auto min-h-0">
        <EventLogItem
          v-for="log in displayedLogs"
          :key="log.id"
          :log="log"
        />
        <div v-if="filteredLogs.length === 0" class="p-8 text-center text-gray-500 text-sm">
          <div class="mb-2">
            📭
          </div>
          <div>暂无匹配的事件日志</div>
          <div class="text-xs text-gray-600 mt-1">
            尝试调整过滤器或触发一些事件
          </div>
        </div>
      </div>

      <!-- 底部按钮组 -->
      <div class="p-4 border-t border-gray-700/50 space-y-2 bg-gray-900 shrink-0">
        <button
          class="w-full px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-500 transition-colors font-medium"
          @click="exportLogs"
        >
          📋 导出 JSON
        </button>
        <div class="flex gap-2">
          <button
            class="flex-1 px-4 py-2 bg-gray-800 text-gray-300 rounded text-sm hover:bg-gray-700 transition-colors"
            @click="clearLogs"
          >
            🗑️ 清空
          </button>
          <button
            class="flex-1 px-4 py-2 bg-gray-800 text-gray-300 rounded text-sm hover:bg-gray-700 transition-colors"
            @click="refreshLogs"
          >
            🔄 刷新
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.event-monitor-panel {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif !important;
}

.event-monitor-panel * {
  font-family: inherit !important;
}

.writing-mode-vertical {
  writing-mode: vertical-rl;
  text-orientation: mixed;
}

/* 自定义滚动条 */
.overflow-y-auto::-webkit-scrollbar {
  width: 6px;
}

.overflow-y-auto::-webkit-scrollbar-track {
  background: #1f2937;
}

.overflow-y-auto::-webkit-scrollbar-thumb {
  background: #4b5563;
  border-radius: 3px;
}

.overflow-y-auto::-webkit-scrollbar-thumb:hover {
  background: #6b7280;
}
</style>
