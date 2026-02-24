<script setup>
import { computed } from 'vue'

defineOptions({
  name: 'JsonTreeNode',
})

const props = defineProps({
  nodeKey: {
    type: String,
    default: '',
  },
  value: {
    type: null,
    required: true,
  },
  depth: {
    type: Number,
    default: 0,
  },
})

const isObject = computed(() => {
  return props.value !== null && typeof props.value === 'object'
})

const isArray = computed(() => {
  return Array.isArray(props.value)
})

const entries = computed(() => {
  if (!isObject.value) {
    return []
  }

  if (isArray.value) {
    return props.value.map((entry, index) => [String(index), entry])
  }

  return Object.entries(props.value)
})

const typeLabel = computed(() => {
  if (!isObject.value) {
    return ''
  }
  return isArray.value ? `Array(${entries.value.length})` : `Object(${entries.value.length})`
})

function getPrimitiveType(value) {
  if (value === null) {
    return 'null'
  }
  if (typeof value === 'string') {
    return 'string'
  }
  if (typeof value === 'number') {
    return 'number'
  }
  if (typeof value === 'boolean') {
    return 'boolean'
  }
  return 'unknown'
}

function formatPrimitive(value) {
  if (value === null) {
    return 'null'
  }
  if (typeof value === 'string') {
    return `"${value}"`
  }
  return String(value)
}
</script>

<template>
  <div class="json-node" :style="{ '--depth': depth }">
    <details v-if="isObject" :open="depth < 1">
      <summary>
        <span v-if="nodeKey" class="key">{{ nodeKey }}</span>
        <span v-if="nodeKey" class="sep">:</span>
        <span class="obj">{{ typeLabel }}</span>
      </summary>
      <div class="children">
        <JsonTreeNode
          v-for="([entryKey, entryValue], index) in entries"
          :key="`${entryKey}-${index}-${depth}`"
          :node-key="entryKey"
          :value="entryValue"
          :depth="depth + 1"
        />
      </div>
    </details>

    <div v-else class="leaf-row">
      <span v-if="nodeKey" class="key">{{ nodeKey }}</span>
      <span v-if="nodeKey" class="sep">:</span>
      <span class="value" :class="getPrimitiveType(value)">{{ formatPrimitive(value) }}</span>
    </div>
  </div>
</template>

<style scoped>
.json-node {
  margin-left: calc(var(--depth) * 14px);
  font-size: 12px;
  line-height: 1.5;
  color: #d4d4d4;
}

details {
  margin: 0;
}

summary {
  cursor: pointer;
  list-style: none;
}

summary::-webkit-details-marker {
  display: none;
}

summary::before {
  content: '▸';
  color: #9ca3af;
  margin-right: 6px;
}

details[open] > summary::before {
  content: '▾';
}

.children {
  margin-top: 2px;
}

.leaf-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.key {
  color: #9cdcfe;
}

.sep {
  color: #d4d4d4;
}

.obj {
  color: #4fc1ff;
}

.value.string {
  color: #ce9178;
}

.value.number {
  color: #b5cea8;
}

.value.boolean,
.value.null {
  color: #569cd6;
}
</style>
