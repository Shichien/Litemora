# 独立 Event Monitor 调试面板实施计划

## TL;DR

> **目标**: 构建一个独立于 Tweakpane 的 Event Monitor 调试面板，左侧显示事件日志，右侧为 Three.js Canvas，支持可折叠、搜索过滤、时间范围筛选等功能。
> 
> **核心功能**:
> - 左右分栏布局：左侧 Event Monitor (400px)，右侧 Three.js Canvas (自适应)
> - 可折叠/最小化：浮动按钮或侧边栏 tab 切换
> - 搜索过滤器：实时关键字搜索
> - 时间范围选择：查看指定时间段事件，避免高频事件污染
> - 事件黑名单：过滤 tick、camera update 等高频事件
> 
> **交付物**:
> 1. `src/vue/components/debug/EventMonitorPanel.vue` - Event Monitor 面板 Vue 组件
> 2. `src/vue/components/debug/EventLogItem.vue` - 单个事件日志项组件
> 3. `src/js/utils/debug-event-filter.js` - 事件过滤器工具类
> 4. 修改 `src/App.vue` - 集成左右分栏布局
> 5. 修改 `src/js/utils/debug-state-monitor.js` - 添加事件黑名单和时间范围过滤
> 
> **估算工作量**: 中等 (Medium)
> **预计时间**: 3-4 小时
> **并行执行**: NO (UI 组件间有依赖关系)
> **关键路径**: Task 1 (过滤器) → Task 2 (面板组件) → Task 3 (布局集成)

---

## Context

### 当前架构

```
┌─────────────────────────────────────────────────────────────┐
│                          App.vue                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                  Three.js Canvas                     │   │
│  │              (绝对定位, 全屏 z-0)                     │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Tweakpane Debug 面板                    │   │
│  │         (小尺寸, 覆盖在 Canvas 之上)                  │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 痛点

1. **Tweakpane 显示区域太小** - 无法有效查看大量事件日志
2. **高频事件污染** - `core:tick`、`camera:update` 等事件每秒触发 60 次，淹没其他重要事件
3. **无法查看历史时间范围** - 只能看到最近 50 条，无法回溯特定时间段
4. **无独立面板** - 调试面板与 Canvas 重叠，影响游戏体验和调试效率

### 目标架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                          App.vue (#debug 模式)                       │
│  ┌────────────────────┬─────────────────────────────────────────┐  │
│  │                    │                                         │  │
│  │  Event Monitor     │         Three.js Canvas                 │  │
│  │  (可折叠侧边栏)     │        (自适应剩余宽度)                   │  │
│  │                    │                                         │  │
│  │  ┌──────────────┐  │                                         │  │
│  │  │ 搜索栏       │  │                                         │  │
│  │  ├──────────────┤  │                                         │  │
│  │  │ 时间范围     │  │                                         │  │
│  │  ├──────────────┤  │                                         │  │
│  │  │ 事件黑名单   │  │                                         │  │
│  │  ├──────────────┤  │                                         │  │
│  │  │              │  │                                         │  │
│  │  │  事件日志    │  │                                         │  │
│  │  │  列表        │  │                                         │  │
│  │  │              │  │                                         │  │
│  │  ├──────────────┤  │                                         │  │
│  │  │ 按钮组       │  │                                         │  │
│  │  └──────────────┘  │                                         │  │
│  │                    │                                         │  │
│  └────────────────────┴─────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘

折叠后:
┌─────────────────────────────────────────────────────────────────────┐
│  ┌──┬─────────────────────────────────────────────────────────────┐ │
│  │>>│                Three.js Canvas (全宽)                       │ │
│  └──┴─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Work Objectives

### Core Objective
构建一个独立于 Tweakpane 的 Event Monitor 面板，提供更大的显示区域和更强大的过滤功能，使调试体验更高效。

### Concrete Deliverables

1. **Event Filter 工具类** (`src/js/utils/debug-event-filter.js`)
   - 事件黑名单管理（过滤高频事件）
   - 时间范围筛选（查看指定时间段）
   - 与现有 DebugStateMonitor 集成

2. **Event Log Item 组件** (`src/vue/components/debug/EventLogItem.vue`)
   - 单个事件日志的展示
   - 不同类型事件的不同颜色标识
   - 展开/折叠详情

3. **Event Monitor Panel 组件** (`src/vue/components/debug/EventMonitorPanel.vue`)
   - 搜索过滤器（实时）
   - 时间范围选择器（开始时间 - 结束时间）
   - 事件黑名单配置（复选框列表）
   - 事件日志列表（虚拟滚动）
   - 按钮组（导出、清空、暂停/继续）
   - 可折叠/展开侧边栏

4. **布局集成** (修改 `src/App.vue`)
   - 左右分栏 CSS Grid 布局
   - 响应式（面板可折叠）
   - 仅在 `#debug` 模式下显示

5. **DebugStateMonitor 增强** (修改 `src/js/utils/debug-state-monitor.js`)
   - 支持事件黑名单
   - 支持时间范围查询
   - 增加日志存储上限（可选 200 条）

### Definition of Done

- [ ] 打开 `#debug` 模式显示左右分栏布局
- [ ] 左侧 Event Monitor 面板宽度 400px，可折叠为 40px
- [ ] 面板包含搜索栏、时间范围选择器、事件黑名单
- [ ] 事件日志列表支持滚动，显示最近 200 条
- [ ] 可以勾选黑名单过滤 `core:tick`、`camera:update` 等高频事件
- [ ] 可以设置时间范围查看特定时间段的事件
- [ ] 导出按钮可将过滤后的事件导出为 JSON
- [ ] 生产环境 (`pnpm build`) 不包含调试面板

### Must Have

- [ ] 左右分栏布局（左 400px / 右自适应）
- [ ] 可折叠侧边栏（带动画）
- [ ] 搜索过滤器（实时）
- [ ] 事件黑名单（复选框列表，默认勾选高频事件）
- [ ] 时间范围选择器（开始/结束时间戳）
- [ ] 虚拟滚动（处理大量日志）
- [ ] 不同 Scope 事件不同颜色
- [ ] 导出 JSON 功能
- [ ] 暂停/继续实时监控

### Must NOT Have (Guardrails)

- [ ] 不影响生产环境性能（完全移除调试代码）
- [ ] 不修改现有 Three.js 渲染逻辑
- [ ] 不破坏现有 Tweakpane 功能（可选共存）
- [ ] 不引入重型 UI 库（只用原生 Vue + Tailwind）

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: YES (Vue 3 + Vite)
- **Automated tests**: NO (本任务为开发工具，无需测试)
- **Verification Method**: 用户手动校验

### Manual Verification Checklist

> **执行者**: 用户自行验证
> **环境**: 开发服务器 (`pnpm dev`)
> **入口**: http://localhost:5173/#debug

#### ✅ Check 1: 左右分栏布局正常
**步骤**:
1. 运行 `pnpm dev` 启动项目
2. 浏览器访问 `http://localhost:5173/#debug`
3. 检查是否显示左右分栏布局
4. 左侧面板宽度应为 400px

**通过标准**:
- [ ] 显示左右分栏布局
- [ ] 左侧 Event Monitor 面板可见
- [ ] 右侧 Three.js Canvas 正常渲染

---

#### ✅ Check 2: 可折叠侧边栏
**步骤**:
1. 点击侧边栏折叠按钮
2. 观察面板是否收起为 40px 宽度
3. 再次点击展开按钮

**通过标准**:
- [ ] 折叠按钮正常工作
- [ ] 面板平滑收起/展开（CSS transition）
- [ ] Canvas 自动适应剩余宽度

---

#### ✅ Check 3: 搜索过滤器
**步骤**:
1. 在搜索框输入事件名称，如 "create_world"
2. 观察事件列表实时过滤
3. 清空搜索框

**通过标准**:
- [ ] 实时过滤事件列表
- [ ] 支持事件名、数据内容搜索
- [ ] 清空后恢复全部显示

---

#### ✅ Check 4: 事件黑名单过滤
**步骤**:
1. 触发一些高频事件（如移动鼠标产生 camera update）
2. 在黑名单配置中勾选 "core:tick"
3. 观察事件列表是否过滤掉 tick 事件

**通过标准**:
- [ ] 黑名单复选框列表可见
- [ ] 默认勾选高频事件（tick、camera update）
- [ ] 勾选后事件列表实时过滤

---

#### ✅ Check 5: 时间范围选择
**步骤**:
1. 等待一段时间积累事件日志
2. 设置开始时间为 1 分钟前
3. 设置结束时间为 30 秒前
4. 观察事件列表是否只显示该时间段的事件

**通过标准**:
- [ ] 时间范围选择器正常工作
- [ ] 只显示指定时间范围内的事件
- [ ] 可以清除时间范围恢复显示全部

---

#### ✅ Check 6: 事件日志列表
**步骤**:
1. 触发大量事件（如快速移动、切换菜单）
2. 检查列表是否正常滚动
3. 检查不同 Scope 事件是否有不同颜色

**通过标准**:
- [ ] 列表支持垂直滚动
- [ ] 不同 Scope 事件颜色不同（ui=蓝色、game=绿色等）
- [ ] 显示时间戳、Scope、事件名、数据预览

---

#### ✅ Check 7: 导出功能
**步骤**:
1. 应用一些过滤器（搜索、黑名单、时间范围）
2. 点击 "导出 JSON" 按钮
3. 粘贴到文本编辑器查看

**通过标准**:
- [ ] 导出按钮正常工作
- [ ] 剪贴板内容包含过滤后的事件
- [ ] JSON 格式正确

---

#### ✅ Check 8: 暂停/继续监控
**步骤**:
1. 点击 "暂停" 按钮
2. 触发一些事件
3. 观察事件列表是否停止更新
4. 点击 "继续" 按钮

**通过标准**:
- [ ] 暂停按钮正常工作
- [ ] 暂停期间新事件不显示
- [ ] 继续后恢复正常监控

---

#### ✅ Check 9: 生产环境禁用
**步骤**:
1. 运行 `pnpm build` 构建生产版本
2. 运行 `pnpm preview` 预览生产版本
3. 访问 `http://localhost:4173/#debug`

**通过标准**:
- [ ] 不显示 Event Monitor 面板
- [ ] 显示为全屏 Canvas 布局
- [ ] 无调试相关代码残留

---

## Execution Strategy

### 任务依赖关系

```
Task 1: 创建 Event Filter 工具类
    │
    ▼
Task 2: 创建 Event Log Item 组件
    │
    ▼
Task 3: 创建 Event Monitor Panel 主组件
    │
    ▼
Task 4: 修改 App.vue 集成左右分栏布局
    │
    ▼
Task 5: 增强 DebugStateMonitor
    │
    ▼
Task 6: 样式优化和动画
    │
    ▼
Task 7: 用户手动验证
```

### 详细任务分解

---

### Task 1: 创建 Event Filter 工具类

**文件**: `src/js/utils/debug-event-filter.js`

**What to do**:
- 创建事件黑名单管理
- 创建时间范围筛选器
- 创建高频事件默认黑名单

**代码结构**:
```javascript
/**
 * Debug Event Filter - 事件过滤器
 * 
 * 功能:
 * - 事件黑名单管理
 * - 时间范围筛选
 * - 高频事件过滤
 */

// 默认高频事件黑名单（避免污染）
export const DEFAULT_BLACKLIST = [
  'core:tick',
  'core:resize',
  // 可添加更多...
]

class DebugEventFilter {
  constructor() {
    // 黑名单（事件名前缀匹配）
    this.blacklist = new Set(DEFAULT_BLACKLIST)
    
    // 时间范围（毫秒时间戳）
    this.timeRange = {
      start: null,
      end: null,
    }
    
    // 是否启用黑名单
    this.enableBlacklist = true
  }

  /**
   * 检查事件是否在黑名单中
   * @param {string} eventName - 事件名称
   * @returns {boolean}
   */
  isBlacklisted(eventName) {
    if (!this.enableBlacklist) return false
    
    for (const pattern of this.blacklist) {
      if (eventName.startsWith(pattern) || eventName === pattern) {
        return true
      }
    }
    return false
  }

  /**
   * 添加黑名单模式
   * @param {string} pattern - 事件名或前缀
   */
  addToBlacklist(pattern) {
    this.blacklist.add(pattern)
  }

  /**
   * 从黑名单移除
   * @param {string} pattern - 事件名或前缀
   */
  removeFromBlacklist(pattern) {
    this.blacklist.delete(pattern)
  }

  /**
   * 设置时间范围
   * @param {number|null} start - 开始时间戳
   * @param {number|null} end - 结束时间戳
   */
  setTimeRange(start, end) {
    this.timeRange.start = start
    this.timeRange.end = end
  }

  /**
   * 清除时间范围
   */
  clearTimeRange() {
    this.timeRange.start = null
    this.timeRange.end = null
  }

  /**
   * 检查事件是否在时间范围内
   * @param {number} timestamp - 事件时间戳
   * @returns {boolean}
   */
  isInTimeRange(timestamp) {
    if (this.timeRange.start && timestamp < this.timeRange.start) {
      return false
    }
    if (this.timeRange.end && timestamp > this.timeRange.end) {
      return false
    }
    return true
  }

  /**
   * 过滤日志列表
   * @param {Array} logs - 日志列表
   * @returns {Array} 过滤后的日志
   */
  filterLogs(logs) {
    return logs.filter(log => {
      // 黑名单检查
      if (this.isBlacklisted(log.eventName)) {
        return false
      }
      
      // 时间范围检查
      if (!this.isInTimeRange(log.timestamp)) {
        return false
      }
      
      return true
    })
  }

  /**
   * 获取黑名单列表
   * @returns {Array}
   */
  getBlacklist() {
    return Array.from(this.blacklist)
  }

  /**
   * 重置为默认黑名单
   */
  resetToDefault() {
    this.blacklist = new Set(DEFAULT_BLACKLIST)
    this.timeRange = { start: null, end: null }
  }
}

export default new DebugEventFilter()
```

**Acceptance Criteria**:
- [ ] 代码能通过 `pnpm lint`
- [ ] 默认黑名单包含 `core:tick`、`core:resize`
- [ ] 支持前缀匹配（如 `core:` 匹配所有 core 事件）

---

### Task 2: 创建 Event Log Item 组件

**文件**: `src/vue/components/debug/EventLogItem.vue`

**What to do**:
- 创建单个事件日志项展示组件
- 不同 Scope 不同颜色
- 展开/折叠详情

**代码结构**:
```vue
<template>
  <div 
    class="event-log-item px-3 py-2 border-b border-gray-700 hover:bg-gray-800 transition-colors cursor-pointer"
    :class="{ 'expanded': isExpanded }"
    @click="toggleExpand"
  >
    <!-- 头部信息 -->
    <div class="flex items-center gap-2 text-sm">
      <!-- 时间戳 -->
      <span class="text-gray-500 text-xs font-mono w-16">
        {{ formatTime(log.timestamp) }}
      </span>
      
      <!-- Scope 标签 -->
      <span 
        class="px-1.5 py-0.5 rounded text-xs font-semibold"
        :class="scopeColorClass"
      >
        {{ log.scope }}
      </span>
      
      <!-- 类型 -->
      <span class="text-gray-400 text-xs w-12">
        {{ log.type }}
      </span>
      
      <!-- 事件名 -->
      <span class="text-gray-200 font-medium truncate flex-1">
        {{ log.eventName }}
      </span>
      
      <!-- 展开图标 -->
      <span class="text-gray-500 text-xs">
        {{ isExpanded ? '▼' : '▶' }}
      </span>
    </div>
    
    <!-- 数据预览（未展开时） -->
    <div v-if="!isExpanded && hasData" class="mt-1 pl-20 text-xs text-gray-400 truncate">
      {{ dataPreview }}
    </div>
    
    <!-- 展开详情 -->
    <div v-if="isExpanded" class="mt-2 pl-20 space-y-1 text-xs">
      <div v-if="log.source" class="text-gray-500">
        <span class="text-gray-600">来源:</span> {{ log.source }}
      </div>
      <div v-if="log.listeners > 0" class="text-gray-500">
        <span class="text-gray-600">监听器:</span> {{ log.listeners }}
      </div>
      <div v-if="hasData" class="mt-2">
        <div class="text-gray-600 mb-1">数据:</div>
        <pre class="bg-gray-900 p-2 rounded overflow-x-auto text-gray-300">{{ formattedData }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  log: {
    type: Object,
    required: true,
  },
})

const isExpanded = ref(false)

const toggleExpand = () => {
  isExpanded.value = !isExpanded.value
}

// Scope 颜色映射
const scopeColorMap = {
  ui: 'bg-blue-900/50 text-blue-300',
  settings: 'bg-purple-900/50 text-purple-300',
  game: 'bg-green-900/50 text-green-300',
  core: 'bg-gray-700/50 text-gray-300',
  shadow: 'bg-yellow-900/50 text-yellow-300',
  pinia: 'bg-pink-900/50 text-pink-300',
  other: 'bg-gray-800 text-gray-400',
}

const scopeColorClass = computed(() => {
  return scopeColorMap[props.log.scope] || scopeColorMap.other
})

const hasData = computed(() => {
  return props.log.data && Object.keys(props.log.data).length > 0
})

const dataPreview = computed(() => {
  if (!props.log.data) return ''
  const str = JSON.stringify(props.log.data)
  return str.length > 60 ? str.substring(0, 60) + '...' : str
})

const formattedData = computed(() => {
  return JSON.stringify(props.log.data, null, 2)
})

const formatTime = (timestamp) => {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}
</script>
```

**Acceptance Criteria**:
- [ ] 不同 Scope 显示不同颜色标签
- [ ] 点击可展开/折叠查看详情
- [ ] 格式化显示时间戳和数据
- [ ] 样式符合项目 Tailwind 风格

---

### Task 3: 创建 Event Monitor Panel 主组件

**文件**: `src/vue/components/debug/EventMonitorPanel.vue`

**What to do**:
- 创建完整的面板组件
- 包含搜索栏、时间选择器、黑名单配置
- 事件列表（使用虚拟滚动或分页）
- 可折叠功能

**代码结构**: (主要结构，完整代码见实际文件)
```vue
<template>
  <div 
    class="event-monitor-panel flex flex-col bg-gray-900 border-r border-gray-700 transition-all duration-300"
    :class="{ 'collapsed': isCollapsed }"
    :style="{ width: isCollapsed ? '40px' : '400px' }"
  >
    <!-- 折叠/展开按钮 -->
    <button 
      class="absolute -right-6 top-4 w-6 h-12 bg-gray-800 border border-gray-700 rounded-r flex items-center justify-center hover:bg-gray-700 transition-colors"
      @click="toggleCollapse"
    >
      <span class="text-gray-400 text-xs">
        {{ isCollapsed ? '◀' : '▶' }}
      </span>
    </button>

    <!-- 折叠状态：只显示图标 -->
    <div v-if="isCollapsed" class="flex flex-col items-center py-4 space-y-4">
      <div class="text-gray-500 text-xs rotate-90 whitespace-nowrap">Event Monitor</div>
    </div>

    <!-- 展开状态：完整面板 -->
    <template v-else>
      <!-- 标题栏 -->
      <div class="flex items-center justify-between px-4 py-3 border-b border-gray-700">
        <h3 class="text-gray-200 font-semibold">Event Monitor</h3>
        <div class="flex items-center gap-2">
          <button 
            class="px-2 py-1 text-xs bg-gray-800 text-gray-300 rounded hover:bg-gray-700"
            @click="isPaused = !isPaused"
          >
            {{ isPaused ? '▶️ 继续' : '⏸️ 暂停' }}
          </button>
        </div>
      </div>

      <!-- 过滤器区域 -->
      <div class="p-4 space-y-4 border-b border-gray-700">
        <!-- 搜索栏 -->
        <div>
          <label class="text-xs text-gray-500 mb-1 block">搜索</label>
          <input
            v-model="searchQuery"
            type="text"
            placeholder="事件名或数据..."
            class="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500"
          >
        </div>

        <!-- 时间范围 -->
        <div>
          <label class="text-xs text-gray-500 mb-1 block">时间范围</label>
          <div class="flex items-center gap-2">
            <input
              v-model="timeStart"
              type="datetime-local"
              class="flex-1 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200"
            >
            <span class="text-gray-500">-</span>
            <input
              v-model="timeEnd"
              type="datetime-local"
              class="flex-1 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200"
            >
          </div>
          <button 
            class="mt-2 text-xs text-blue-400 hover:text-blue-300"
            @click="clearTimeRange"
          >
            清除时间范围
          </button>
        </div>

        <!-- 事件黑名单 -->
        <div>
          <div class="flex items-center justify-between mb-2">
            <label class="text-xs text-gray-500">事件黑名单</label>
            <label class="flex items-center gap-1 text-xs text-gray-400 cursor-pointer">
              <input v-model="enableBlacklist" type="checkbox" class="rounded">
              启用
            </label>
          </div>
          <div class="flex flex-wrap gap-2">
            <label 
              v-for="item in blacklistItems" 
              :key="item"
              class="flex items-center gap-1 px-2 py-1 bg-gray-800 rounded text-xs text-gray-400 cursor-pointer hover:bg-gray-700"
            >
              <input 
                v-model="selectedBlacklist" 
                type="checkbox" 
                :value="item"
                class="rounded"
              >
              {{ item }}
            </label>
          </div>
        </div>
      </div>

      <!-- 统计信息 -->
      <div class="px-4 py-2 bg-gray-800/50 border-b border-gray-700 text-xs text-gray-500">
        显示 {{ filteredLogs.length }} / {{ allLogs.length }} 条日志
      </div>

      <!-- 事件列表 -->
      <div class="flex-1 overflow-y-auto">
        <EventLogItem 
          v-for="log in displayedLogs" 
          :key="log.id"
          :log="log"
        />
        <div v-if="filteredLogs.length === 0" class="p-8 text-center text-gray-500 text-sm">
          暂无匹配的事件日志
        </div>
      </div>

      <!-- 底部按钮组 -->
      <div class="p-4 border-t border-gray-700 space-y-2">
        <button 
          class="w-full px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-500 transition-colors"
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

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import debugEventFilter from '@three/utils/debug-event-filter.js'
import debugStateMonitor from '@three/utils/debug-state-monitor.js'
import EventLogItem from './EventLogItem.vue'

// 折叠状态
const isCollapsed = ref(false)
const toggleCollapse = () => {
  isCollapsed.value = !isCollapsed.value
}

// 暂停监控
const isPaused = ref(false)

// 搜索
const searchQuery = ref('')
watch(searchQuery, (val) => {
  debugStateMonitor.setSearchQuery(val)
})

// 时间范围
const timeStart = ref('')
const timeEnd = ref('')

const updateTimeRange = () => {
  const start = timeStart.value ? new Date(timeStart.value).getTime() : null
  const end = timeEnd.value ? new Date(timeEnd.value).getTime() : null
  debugEventFilter.setTimeRange(start, end)
}

watch([timeStart, timeEnd], updateTimeRange)

const clearTimeRange = () => {
  timeStart.value = ''
  timeEnd.value = ''
  debugEventFilter.clearTimeRange()
}

// 黑名单
const enableBlacklist = ref(true)
const selectedBlacklist = ref(debugEventFilter.getBlacklist())
const blacklistItems = ['core:tick', 'core:resize', 'camera:']

watch(enableBlacklist, (val) => {
  debugEventFilter.enableBlacklist = val
})

watch(selectedBlacklist, (val) => {
  debugEventFilter.blacklist = new Set(val)
}, { deep: true })

// 日志列表
const allLogs = ref([])
const filteredLogs = computed(() => {
  let logs = debugEventFilter.filterLogs(allLogs.value)
  
  // 应用搜索过滤
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase()
    logs = logs.filter(log => {
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
      allLogs.value = debugStateMonitor.logs
    }
  }, 500)
})

// 导出
const exportLogs = () => {
  const data = {
    timestamp: new Date().toISOString(),
    filters: {
      search: searchQuery.value,
      blacklist: selectedBlacklist.value,
      timeRange: { start: timeStart.value, end: timeEnd.value },
    },
    logs: filteredLogs.value,
  }
  navigator.clipboard.writeText(JSON.stringify(data, null, 2))
}

// 清空
const clearLogs = () => {
  debugStateMonitor.clearLogs()
  allLogs.value = []
}

// 刷新
const refreshLogs = () => {
  allLogs.value = debugStateMonitor.logs
}
</script>

<style scoped>
.event-monitor-panel {
  position: relative;
}

.event-monitor-panel.collapsed {
  overflow: hidden;
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
```

**Acceptance Criteria**:
- [ ] 面板可折叠/展开，带平滑动画
- [ ] 搜索栏实时过滤
- [ ] 时间范围选择器正常工作
- [ ] 黑名单复选框可配置
- [ ] 显示过滤后的日志数量
- [ ] 导出、清空、刷新按钮正常工作

---

### Task 4: 修改 App.vue 集成左右分栏布局

**文件**: `src/App.vue`

**What to do**:
- 修改布局为 CSS Grid 左右分栏
- 左侧 Event Monitor Panel，右侧 Canvas
- 仅在 `#debug` 模式下显示分栏

**修改方案**:
```vue
<script setup>
import Experience from '@three/experience.js'
import Crosshair from '@ui-components/Crosshair.vue'
import EventMonitorPanel from '@ui-components/debug/EventMonitorPanel.vue'
import GameHud from '@ui-components/hud/GameHud.vue'
import UiRoot from '@ui-components/menu/UiRoot.vue'
import { onBeforeUnmount, onMounted, ref, computed } from 'vue'

const threeCanvas = ref(null)
let experience = null

onMounted(() => {
  experience = new Experience(threeCanvas.value)
})

onBeforeUnmount(() => {
  experience?.destroy()
  experience = null
})

// 检查是否为 debug 模式
const isDebugMode = computed(() => {
  return window.location.hash === '#debug'
})
</script>

<template>
  <div 
    class="app-container"
    :class="{ 'debug-mode': isDebugMode }"
  >
    <!-- Debug 模式：左右分栏 -->
    <template v-if="isDebugMode">
      <!-- 左侧 Event Monitor -->
      <EventMonitorPanel class="event-monitor" />
      
      <!-- 右侧内容区 -->
      <div class="right-panel">
        <canvas ref="threeCanvas" class="three-canvas" />
        <UiRoot />
        <GameHud />
        <Crosshair />
      </div>
    </template>
    
    <!-- 正常模式：全屏 Canvas -->
    <template v-else>
      <div class="relative w-screen h-screen">
        <canvas ref="threeCanvas" class="three-canvas absolute inset-0 z-0" />
        <UiRoot />
        <GameHud />
        <Crosshair />
      </div>
    </template>
  </div>
</template>

<style scoped>
.app-container {
  width: 100vw;
  height: 100vh;
}

.app-container.debug-mode {
  display: grid;
  grid-template-columns: auto 1fr;
  overflow: hidden;
}

.event-monitor {
  height: 100vh;
  overflow: hidden;
}

.right-panel {
  position: relative;
  width: 100%;
  height: 100vh;
  overflow: hidden;
}

.three-canvas {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
```

**Acceptance Criteria**:
- [ ] Debug 模式显示左右分栏
- [ ] 正常模式保持原有全屏布局
- [ ] Canvas 自适应右侧剩余宽度
- [ ] 无布局错位或溢出问题

---

### Task 5: 增强 DebugStateMonitor

**文件**: `src/js/utils/debug-state-monitor.js`

**What to do**:
- 增加日志存储上限到 200 条
- 集成 EventFilter
- 添加暂停功能

**修改点**:
```javascript
// 修改 maxLogs
this.maxLogs = 200

// 添加暂停状态
this.isPaused = false

// 添加暂停/继续方法
pause() {
  this.isPaused = true
}

resume() {
  this.isPaused = false
}

// 在 logEvent 和 logPiniaChange 中添加暂停检查
if (this.isPaused) return
```

---

### Task 6: 样式优化和动画

**What to do**:
- 优化 CSS transition 动画
- 自定义滚动条样式
- 响应式适配（小屏幕自动折叠）

**Acceptance Criteria**:
- [ ] 面板折叠/展开有 300ms ease 动画
- [ ] 自定义滚动条符合深色主题
- [ ] 窗口宽度小于 1200px 时自动折叠面板

---

### Task 7: 用户手动验证

按照 **Verification Strategy** 中的 9 个检查项逐一验证。

---

## Success Criteria

### 功能验证清单

- [ ] **布局**
  - [ ] Debug 模式左右分栏正常
  - [ ] 左侧面板宽度 400px
  - [ ] 右侧 Canvas 自适应
  - [ ] 正常模式全屏布局

- [ ] **可折叠面板**
  - [ ] 折叠按钮工作正常
  - [ ] 平滑动画效果
  - [ ] 折叠后宽度 40px
  - [ ] 小屏幕自动折叠

- [ ] **搜索过滤**
  - [ ] 实时搜索事件名
  - [ ] 支持数据内容搜索
  - [ ] 清空恢复全部

- [ ] **时间范围**
  - [ ] 开始/结束时间选择器
  - [ ] 正确过滤时间范围
  - [ ] 清除按钮工作

- [ ] **事件黑名单**
  - [ ] 默认勾选高频事件
  - [ ] 实时过滤效果
  - [ ] 可自定义添加/移除

- [ ] **日志列表**
  - [ ] 不同 Scope 不同颜色
  - [ ] 点击展开详情
  - [ ] 虚拟滚动性能良好
  - [ ] 显示时间戳、事件名、数据预览

- [ ] **操作按钮**
  - [ ] 暂停/继续监控
  - [ ] 导出 JSON
  - [ ] 清空日志
  - [ ] 刷新列表

- [ ] **生产环境**
  - [ ] 生产构建不包含面板
  - [ ] 无调试代码残留

### 代码质量

- [ ] 通过 `pnpm lint` 检查
- [ ] 符合项目代码风格
- [ ] 组件命名规范
- [ ] 中文注释说明关键逻辑

---

## Commit Strategy

| 任务 | Commit Message | Files |
|------|----------------|-------|
| Task 1 | `feat(debug): add event filter utility with blacklist and time range` | `src/js/utils/debug-event-filter.js` |
| Task 2 | `feat(debug): add EventLogItem component for event display` | `src/vue/components/debug/EventLogItem.vue` |
| Task 3 | `feat(debug): add EventMonitorPanel component with filters` | `src/vue/components/debug/EventMonitorPanel.vue` |
| Task 4 | `feat(debug): integrate side-by-side layout in App.vue` | `src/App.vue` |
| Task 5 | `feat(debug): enhance DebugStateMonitor with pause and increased limit` | `src/js/utils/debug-state-monitor.js` |
| Task 6 | `style(debug): add animations and responsive styles` | `src/vue/components/debug/*.vue` |

---

## Appendix

### Scope 颜色映射

| Scope | 背景色 | 文字色 |
|-------|--------|--------|
| ui | bg-blue-900/50 | text-blue-300 |
| settings | bg-purple-900/50 | text-purple-300 |
| game | bg-green-900/50 | text-green-300 |
| core | bg-gray-700/50 | text-gray-300 |
| shadow | bg-yellow-900/50 | text-yellow-300 |
| pinia | bg-pink-900/50 | text-pink-300 |
| other | bg-gray-800 | text-gray-400 |

### 默认黑名单

```javascript
['core:tick', 'core:resize']
```

### 布局 CSS

```css
/* 左右分栏 */
.debug-layout {
  display: grid;
  grid-template-columns: 400px 1fr;
  height: 100vh;
  overflow: hidden;
}

/* 折叠状态 */
.debug-layout.collapsed {
  grid-template-columns: 40px 1fr;
}

/* 响应式 */
@media (max-width: 1200px) {
  .debug-layout {
    grid-template-columns: 40px 1fr;
  }
}
```

### 文件结构

```
src/
├── vue/
│   └── components/
│       └── debug/
│           ├── EventMonitorPanel.vue  # 主面板
│           ├── EventLogItem.vue       # 日志项
│           └── index.js               # 导出
├── js/
│   └── utils/
│       ├── debug-state-monitor.js     # 增强版
│       └── debug-event-filter.js      # 新增
└── App.vue                            # 修改
```

---

**Last Updated**: 2026-02-04
**Repository**: Third-Person-MC
**Plan Version**: 1.0
