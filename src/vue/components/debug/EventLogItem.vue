<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  log: {
    type: Object,
    required: true,
  },
})

const isExpanded = ref(false)

function toggleExpand() {
  isExpanded.value = !isExpanded.value
}

// Scope 颜色映射
const scopeColorMap = {
  ui: 'bg-blue-900/50 text-blue-300 border-blue-700',
  settings: 'bg-purple-900/50 text-purple-300 border-purple-700',
  game: 'bg-green-900/50 text-green-300 border-green-700',
  core: 'bg-gray-700/50 text-gray-300 border-gray-600',
  shadow: 'bg-yellow-900/50 text-yellow-300 border-yellow-700',
  pinia: 'bg-pink-900/50 text-pink-300 border-pink-700',
  other: 'bg-gray-800 text-gray-400 border-gray-700',
}

const scopeColorClass = computed(() => {
  return scopeColorMap[props.log.scope] || scopeColorMap.other
})

const hasData = computed(() => {
  return props.log.data && Object.keys(props.log.data).length > 0
})

const dataPreview = computed(() => {
  if (!props.log.data)
    return ''
  const str = JSON.stringify(props.log.data)
  return str.length > 60 ? `${str.substring(0, 60)}...` : str
})

const formattedData = computed(() => {
  return JSON.stringify(props.log.data, null, 2)
})

function formatTime(timestamp) {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}
</script>

<template>
  <div
    class="event-log-item px-3 py-2 border-b border-gray-700/50 hover:bg-gray-800/50 transition-colors cursor-pointer select-none"
    :class="{ 'bg-gray-800/30': isExpanded }"
    @click="toggleExpand"
  >
    <!-- 头部信息 -->
    <div class="flex items-center gap-2 text-sm">
      <!-- 时间戳 -->
      <span class="text-gray-500 text-xs font-mono w-16 shrink-0">
        {{ formatTime(log.timestamp) }}
      </span>

      <!-- Scope 标签 -->
      <span
        class="px-1.5 py-0.5 rounded text-xs font-semibold border shrink-0"
        :class="scopeColorClass"
      >
        {{ log.scope }}
      </span>

      <!-- 类型 -->
      <span class="text-gray-400 text-xs w-10 shrink-0">
        {{ log.type }}
      </span>

      <!-- 事件名 -->
      <span class="text-gray-200 font-medium truncate flex-1 min-w-0" :title="log.eventName">
        {{ log.eventName }}
      </span>

      <!-- 展开图标 -->
      <span class="text-gray-500 text-xs shrink-0">
        {{ isExpanded ? '▼' : '▶' }}
      </span>
    </div>

    <!-- 数据预览（未展开时） -->
    <div v-if="!isExpanded && hasData" class="mt-1 pl-24 text-xs text-gray-400 truncate">
      {{ dataPreview }}
    </div>

    <!-- 展开详情 -->
    <div v-if="isExpanded" class="mt-2 pl-24 space-y-1.5 text-xs">
      <div v-if="log.source" class="text-gray-500">
        <span class="text-gray-600">来源:</span>
        {{ log.source }}
      </div>
      <div v-if="log.listeners > 0" class="text-gray-500">
        <span class="text-gray-600">监听器:</span>
        {{ log.listeners }}
      </div>
      <div v-if="hasData" class="mt-2">
        <div class="text-gray-600 mb-1">
          数据:
        </div>
        <pre class="bg-gray-900 p-2 rounded overflow-x-auto text-gray-300 text-xs leading-relaxed">{{ formattedData }}</pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.event-log-item {
  transition: background-color 0.15s ease;
}

pre {
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
