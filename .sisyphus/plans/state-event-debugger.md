# State & Event Debugger 实施计划

## TL;DR

> **目标**: 为现有的 Pinia + mitt 状态与通讯系统添加可视化调试能力
>
> **核心功能**:
> - 增强型 Event Bus：自动分类日志 (ui/settings/game/core/shadow/pinia)
> - Debug 面板：Tweakpane 集成的 State & Event Monitor
> - Scope 单选筛选：快速聚焦特定模块
> - 搜索过滤：实时关键字过滤
> - JSON 导出：一键复制日志到剪贴板
>
> **交付物**:
> 1. `src/js/utils/debug-state-monitor.js` - 核心调试监控类
> 2. `src/js/utils/debug-emitter.js` - 增强型事件总线
> 3. 修改 `src/js/utils/debug.js` - 集成监控面板
> 4. 修改 `src/pinia/*Store.js` - 添加状态追踪
> 5. 可选: `src/js/utils/event-bus.js` - 替换为 debug-emitter
>
> **估算工作量**: 中等 (Medium)
> **预计时间**: 2-3 小时
> **并行执行**: NO (组件间有依赖关系)
> **关键路径**: Task 1 → Task 2 → Task 3 → Task 4

---

## Context

### 当前架构

```
┌─────────────────────────────────────────────────────────────┐
│                         Vue UI Layer                         │
│  ┌─────────────────┐          ┌─────────────────┐           │
│  │   Components    │◄────────►│   Pinia Stores  │           │
│  └─────────────────┘          └────────┬────────┘           │
└────────────────────────────────────────┼────────────────────┘
                                         │ emitter.emit()
                                         ▼
┌─────────────────────────────────────────────────────────────┐
│                      mitt Event Bus                          │
└─────────────────────────────────────────────────────────────┘
                                         │ emitter.on()
                                         ▼
┌─────────────────────────────────────────────────────────────┐
│                      Three.js Layer                          │
│  ┌─────────────────┐          ┌─────────────────┐           │
│  │   Components    │◄────────►│   Experience    │           │
│  └─────────────────┘          └─────────────────┘           │
└─────────────────────────────────────────────────────────────┘
```

### 现有文件

| 文件 | 职责 |
|------|------|
| `src/js/utils/event-bus.js` | mitt 实例导出 |
| `src/js/utils/debug.js` | Tweakpane Debug 面板 |
| `src/pinia/uiStore.js` | UI 状态管理 |
| `src/pinia/settingsStore.js` | 设置状态管理 |
| `src/pinia/hudStore.js` | HUD 状态管理 |
| `src/pinia/skinStore.js` | 皮肤状态管理 |

### 痛点

1. 事件触发是"黑盒"，无法追踪 emit → on 的完整链路
2. Pinia 状态变更历史无法追溯
3. 跨层通信难以调试
4. 事件监听器泄漏难以发现

---

## Work Objectives

### Core Objective
实现一套开发环境专用的 State & Event 调试系统，让开发者可以实时查看：
- 所有 mitt 事件的触发和监听
- 所有 Pinia 状态的变更历史
- 按 Scope 分类筛选事件
- 搜索过滤特定事件

### Concrete Deliverables

1. **DebugStateMonitor 类** (`src/js/utils/debug-state-monitor.js`)
   - 日志存储 (最近 50 条)
   - Scope 分类逻辑
   - 搜索过滤
   - JSON 导出

2. **增强型 Event Bus** (`src/js/utils/debug-emitter.js`)
   - 包装 mitt
   - 自动识别 Scope
   - 记录调用栈
   - 开发环境才启用

3. **Pinia Store 订阅** (修改现有 stores)
   - $subscribe 监听状态变更
   - 记录状态 diff
   - 标记变更来源

4. **Debug 面板 UI** (修改 `src/js/utils/debug.js`)
   - Scope 单选按钮组 (all/ui/settings/game/core/shadow/pinia)
   - 实时日志列表
   - 搜索输入框
   - 导出按钮

### Definition of Done

- [ ] 打开 `#debug` 面板能看到 State & Event Monitor 标签页
- [ ] 触发事件后能在面板中看到带 scope 分类的日志
- [ ] 切换 scope 按钮能正确过滤日志
- [ ] 输入搜索词能实时过滤
- [ ] 点击导出按钮能将最近 50 条日志复制为 JSON
- [ ] 生产环境 (`pnpm build`) 不包含任何调试代码

### Must Have

- [ ] Scope 分类：ui/settings/game/core/shadow/pinia/all
- [ ] 日志限制：最近 50 条
- [ ] 搜索过滤：实时关键字匹配
- [ ] JSON 导出：到剪贴板
- [ ] 生产禁用：通过 `import.meta.env.DEV` 或 `window.location.hash`

### Must NOT Have (Guardrails)

- [ ] 不影响生产环境性能
- [ ] 不修改现有业务逻辑
- [ ] 不引入新的运行时依赖 (只使用现有 mitt/pinia)
- [ ] 不破坏现有 Tweakpane 面板

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: YES (Playwright E2E tests)
- **Automated tests**: NO (本任务为开发工具，无需测试)
- **Verification Method**: 用户手动校验

### Manual Verification Checklist

> **执行者**: 用户自行验证
> **环境**: 开发服务器 (`pnpm dev`)
> **入口**: http://localhost:5173/#debug

#### ✅ Check 1: Debug 面板正常显示
**步骤**:
1. 运行 `pnpm dev` 启动项目
2. 浏览器访问 `http://localhost:5173/#debug`
3. 检查 Tweakpane 面板是否出现 "State & Event Monitor" folder
4. 检查是否有 Scope 下拉菜单 (all/ui/settings/game/core/shadow/pinia)
5. 检查是否有搜索框和 Export JSON 按钮

**通过标准**: 面板正常加载，所有 UI 元素可见

---

#### ✅ Check 2: 事件日志正确记录
**步骤**:
1. 确保 Debug 面板已打开
2. 触发任意事件，例如：
   - 点击 "Create World" 按钮，或
   - 按 ESC 键切换暂停菜单
3. 查看日志列表

**通过标准**:
- [ ] 事件出现在日志列表中
- [ ] 显示正确的时间戳
- [ ] 显示正确的 scope 标签 (ui/game/settings 等)
- [ ] 显示事件名称和数据预览

---

#### ✅ Check 3: Scope 筛选正常工作
**步骤**:
1. 触发多种类型的事件 (创建世界、调整设置等)
2. 在 Scope 下拉菜单中选择 "settings"
3. 观察日志列表变化
4. 切换到 "ui" scope
5. 再切换到 "all" scope

**通过标准**:
- [ ] 选择 "settings" 只显示 settings:* 事件
- [ ] 选择 "ui" 只显示 ui:* 事件
- [ ] 选择 "all" 显示所有事件
- [ ] 切换时无延迟/卡顿

---

#### ✅ Check 4: 搜索过滤正常工作
**步骤**:
1. 在搜索框输入关键词，如 "pause"
2. 观察日志列表实时过滤
3. 清空搜索框

**通过标准**:
- [ ] 输入时实时过滤 (无需按回车)
- [ ] 只显示包含关键词的事件
- [ ] 清空后恢复显示所有事件
- [ ] 支持事件名和数据内容搜索

---

#### ✅ Check 5: Pinia 状态变更记录
**步骤**:
1. 触发 UI 状态变更 (如切换菜单)
2. 触发 Settings 状态变更 (如调整阴影质量)
3. 查看日志中的 pinia scope 条目

**通过标准**:
- [ ] 显示 "pinia" scope 的日志
- [ ] 显示 store 名称 (uiStore/settingsStore)
- [ ] 显示变更的 key
- [ ] 显示 oldValue → newValue

---

#### ✅ Check 6: JSON 导出到剪贴板
**步骤**:
1. 积累一些事件日志
2. 点击 "Export JSON" 按钮
3. 粘贴到文本编辑器查看

**通过标准**:
- [ ] 点击后有视觉反馈 (按钮高亮/提示)
- [ ] 剪贴板内容粘贴后为有效 JSON
- [ ] JSON 包含 `timestamp` 字段
- [ ] JSON 包含 `logs` 数组 (最近 50 条)
- [ ] JSON 包含 `snapshot` 对象 (当前状态)

---

#### ✅ Check 7: 生产环境禁用
**步骤**:
1. 运行 `pnpm build` 构建生产版本
2. 运行 `pnpm preview` 预览生产版本
3. 访问 `http://localhost:4173/#debug`

**通过标准**:
- [ ] 不加载 State & Event Monitor 面板
- [ ] 控制台无调试相关日志
- [ ] 页面性能正常 (无额外开销)
- [ ] 无 console.error/warn 报错

---

## Execution Strategy

### 任务依赖关系

```
Task 1: DebugStateMonitor 核心类
    │
    ▼
Task 2: 增强型 Event Bus
    │
    ▼
Task 3: Pinia Store 集成
    │
    ▼
Task 4: Debug 面板 UI
    │
    ▼
Task 5: 测试验证
```

### 详细任务分解

---

### Task 1: 创建 DebugStateMonitor 核心类

**文件**: `src/js/utils/debug-state-monitor.js`

**What to do**:
- 实现日志存储结构 (环形缓冲区，最多 50 条)
- 实现 Scope 识别逻辑 (根据事件名前缀)
- 实现搜索过滤方法
- 实现 JSON 导出方法
- 实现状态快照记录

**代码结构**:
```javascript
class DebugStateMonitor {
  constructor() {
    this.enabled = import.meta.env.DEV && window.location.hash === '#debug'
    this.logs = [] // 最多 50 条
    this.maxLogs = 50
    this.currentScope = 'all'
    this.searchQuery = ''
    this.listeners = new Map() // 记录活跃的监听器
  }

  // Scope 识别
  getScope(eventName) {
    if (eventName.startsWith('ui:'))
      return 'ui'
    if (eventName.startsWith('settings:'))
      return 'settings'
    if (eventName.startsWith('game:'))
      return 'game'
    if (eventName.startsWith('core:'))
      return 'core'
    if (eventName.startsWith('shadow:'))
      return 'shadow'
    if (eventName.startsWith('pinia:'))
      return 'pinia'
    return 'other'
  }

  // 记录事件
  logEvent(type, eventName, data, source) {
    if (!this.enabled)
      return
    // 添加到 logs，保持 50 条限制
  }

  // 记录 Pinia 状态变更
  logPiniaChange(storeName, key, oldValue, newValue) {
    if (!this.enabled)
      return
    // 记录状态 diff
  }

  // 获取过滤后的日志
  getFilteredLogs() {
    // 根据 scope 和 searchQuery 过滤
  }

  // 导出 JSON
  exportToJSON() {
    const data = {
      timestamp: new Date().toISOString(),
      logs: this.logs,
      snapshot: this.getStateSnapshot()
    }
    navigator.clipboard.writeText(JSON.stringify(data, null, 2))
  }

  // 获取当前状态快照
  getStateSnapshot() {
    // 收集所有 Pinia stores 的当前状态
  }
}

export default new DebugStateMonitor()
```

**Must NOT do**:
- 不要在生产环境启用
- 不要修改现有业务逻辑
- 不要引入新依赖

**Recommended Agent Profile**:
- **Category**: `quick`
- **Skills**: []
- **Reason**: 纯工具类，逻辑简单

**Acceptance Criteria**:
- [ ] 代码能通过 `pnpm lint`
- [ ] 代码符合项目风格 (无分号, 单引号, 2空格缩进)
- [ ] 包含中文注释说明关键逻辑

---

### Task 2: 创建增强型 Event Bus

**文件**: `src/js/utils/debug-emitter.js`

**What to do**:
- 包装原有的 mitt
- 拦截 emit 方法，记录日志
- 拦截 on/off 方法，追踪监听器
- 添加调用栈记录 (开发环境)

**代码结构**:
```javascript
import mitt from 'mitt'
import debugStateMonitor from './debug-state-monitor.js'

// 基础 mitt 实例
const baseEmitter = mitt()

// 增强型 emitter
const debugEmitter = {
  // 代理 emit
  emit(eventName, data) {
    // 获取调用栈
    const stack = new Error().stack
    const source = extractSourceFromStack(stack)

    // 记录事件
    debugStateMonitor.logEvent('emit', eventName, data, source)

    // 调用原始 emit
    return baseEmitter.emit(eventName, data)
  },

  // 代理 on
  on(eventName, handler) {
    // 记录监听器注册
    debugStateMonitor.logListener('on', eventName, handler)

    return baseEmitter.on(eventName, handler)
  },

  // 代理 off
  off(eventName, handler) {
    debugStateMonitor.logListener('off', eventName, handler)

    return baseEmitter.off(eventName, handler)
  },

  // 代理 all
  get all() {
    return baseEmitter.all
  }
}

export default debugEmitter
```

**注意**:
- 保持 API 与原 mitt 完全一致
- 只在开发环境启用日志记录
- 不影响性能 (使用代理模式)

**Acceptance Criteria**:
- [ ] 可以作为 drop-in 替换现有 event-bus.js
- [ ] 所有现有 emitter.emit/on/off 调用正常工作
- [ ] 开发环境能看到事件日志

---

### Task 3: 修改 Pinia Stores

**文件**:
- `src/pinia/uiStore.js`
- `src/pinia/settingsStore.js`
- `src/pinia/hudStore.js`
- `src/pinia/skinStore.js`

**What to do**:
- 在每个 store 中添加 $subscribe
- 记录状态变更到 DebugStateMonitor
- 标记变更来源

**修改示例** (以 uiStore.js 为例):
```javascript
import debugStateMonitor from '@three/utils/debug-state-monitor.js'

export const useUiStore = defineStore('ui', () => {
  // ... 原有代码 ...

  // 添加状态订阅 (仅在开发环境)
  if (import.meta.env.DEV) {
    const store = useUiStore()
    store.$subscribe((mutation, state) => {
      debugStateMonitor.logPiniaChange(
        'uiStore',
        mutation.events?.key || 'unknown',
        mutation.events?.oldValue,
        mutation.events?.newValue
      )
    })
  }

  return { /* ... */ }
})
```

**优化方案**:
创建一个 Pinia 插件统一处理：
```javascript
// src/pinia/debug-plugin.js
import debugStateMonitor from '@three/utils/debug-state-monitor.js'

export function createDebugPlugin() {
  if (!import.meta.env.DEV)
    return () => {}

  return ({ store }) => {
    store.$subscribe((mutation) => {
      debugStateMonitor.logPiniaChange(
        store.$id,
        mutation.events?.key || 'batch',
        mutation.events?.oldValue,
        mutation.events?.newValue
      )
    })
  }
}
```

然后在 pinia 初始化时使用：
```javascript
// main.js
import { createDebugPlugin } from './pinia/debug-plugin.js'

const pinia = createPinia()
pinia.use(createDebugPlugin())
```

**Acceptance Criteria**:
- [ ] Pinia 状态变更显示在 Debug 面板
- [ ] 显示正确的 store 名称和 key
- [ ] 显示 oldValue → newValue

---

### Task 4: 修改 Debug 面板

**文件**: `src/js/utils/debug.js`

**What to do**:
- 在构造函数中初始化 State & Event Monitor 面板
- 添加 Scope 单选按钮组
- 添加搜索输入框
- 添加日志列表显示
- 添加导出按钮

**代码结构**:
```javascript
import * as EssentialsPlugin from '@tweakpane/plugin-essentials'
import { Pane } from 'tweakpane'
import debugStateMonitor from './debug-state-monitor.js'

export default class Debug {
  constructor() {
    this.active = window.location.hash === '#debug'

    if (this.active) {
      this.ui = new Pane({
        title: 'Debug',
        expanded: true,
      })

      // 初始化 State & Event Monitor
      this.initStateMonitor()
    }
  }

  initStateMonitor() {
    const folder = this.ui.addFolder({
      title: 'State & Event Monitor',
      expanded: true,
    })

    // Scope 单选
    const scopeParams = { scope: 'all' }
    folder.addBinding(scopeParams, 'scope', {
      label: 'Scope',
      options: {
        All: 'all',
        UI: 'ui',
        Settings: 'settings',
        Game: 'game',
        Core: 'core',
        Shadow: 'shadow',
        Pinia: 'pinia',
      },
    }).on('change', (ev) => {
      debugStateMonitor.setScope(ev.value)
      this.refreshLogDisplay()
    })

    // 搜索框
    const searchParams = { query: '' }
    folder.addBinding(searchParams, 'query', {
      label: 'Search',
    }).on('change', (ev) => {
      debugStateMonitor.setSearchQuery(ev.value)
      this.refreshLogDisplay()
    })

    // 日志列表 (使用 addBlade 或自定义 UI)
    this.logBlade = folder.addBlade({
      view: 'list',
      label: 'Events',
      options: [],
    })

    // 导出按钮
    folder.addButton({
      title: 'Export JSON',
    }).on('click', () => {
      debugStateMonitor.exportToJSON()
    })

    // 定时刷新显示
    setInterval(() => this.refreshLogDisplay(), 500)
  }

  refreshLogDisplay() {
    const logs = debugStateMonitor.getFilteredLogs()
    // 更新 logBlade 显示
  }

  destroy() {
    if (this.ui) {
      this.ui.dispose()
      this.ui = null
    }
  }
}
```

**UI 注意事项**:
- Tweakpane 的 list blade 可能不够灵活，考虑使用文本区域或自定义元素
- 考虑使用 addBinding + 字符串数组来显示日志
- 确保刷新不会导致面板闪烁

**Acceptance Criteria**:
- [ ] 打开 #debug 能看到 State & Event Monitor folder
- [ ] Scope 下拉菜单有 7 个选项
- [ ] 搜索框能输入文字
- [ ] 事件实时显示在列表中
- [ ] 导出按钮点击后有反馈

---

### Task 5: 可选 - 替换现有 Event Bus

**文件**: `src/js/utils/event-bus.js`

**What to do**:
- 将现有 event-bus.js 改为导出 debug-emitter

**修改**:
```javascript
// 原代码:
import mitt from 'mitt'
const emitter = mitt()
export default emitter

// 新代码:
import debugEmitter from './debug-emitter.js'
export default debugEmitter
```

**风险**:
- 需要全项目回归测试
- 建议作为最后一步，或保持两个文件并存

**替代方案**:
保留现有 event-bus.js，让 debug-emitter.js 作为增强版供未来使用。

---

## Success Criteria

### 功能验证清单

- [ ] **基础功能**
  - [ ] Debug 面板在 `#debug` 模式下可见
  - [ ] State & Event Monitor folder 展开正常
  - [ ] 触发事件后日志实时更新

- [ ] **Scope 筛选**
  - [ ] 单选 ui 只显示 ui:* 事件
  - [ ] 单选 settings 只显示 settings:* 事件
  - [ ] 单选 game 只显示 game:* 事件
  - [ ] 单选 pinia 只显示 Pinia 状态变更
  - [ ] 单选 all 显示所有事件

- [ ] **搜索过滤**
  - [ ] 输入关键字实时过滤
  - [ ] 清空搜索恢复全部显示
  - [ ] 支持事件名、数据内容搜索

- [ ] **Pinia 状态**
  - [ ] 状态变更显示在日志中
  - [ ] 显示 store 名称、key、old→new
  - [ ] 批量更新正确显示

- [ ] **导出功能**
  - [ ] 点击 Export JSON 按钮
  - [ ] 剪贴板包含有效 JSON
  - [ ] JSON 包含最近 50 条日志
  - [ ] JSON 包含当前状态快照

- [ ] **生产环境**
  - [ ] 生产构建不包含调试代码
  - [ ] 性能无影响
  - [ ] 无控制台报错

### 代码质量

- [ ] 通过 `pnpm lint` 检查
- [ ] 符合项目代码风格
- [ ] 包含中文注释
- [ ] 无 console.log 残留 (使用 console.debug)

---

## Commit Strategy

| 任务 | Commit Message | Files |
|------|----------------|-------|
| Task 1 | `feat(debug): add DebugStateMonitor core class` | `src/js/utils/debug-state-monitor.js` |
| Task 2 | `feat(debug): add enhanced debug-emitter with scope tracking` | `src/js/utils/debug-emitter.js` |
| Task 3 | `feat(debug): add Pinia state change tracking` | `src/pinia/debug-plugin.js`, `main.js` |
| Task 4 | `feat(debug): integrate State & Event Monitor into Debug panel` | `src/js/utils/debug.js` |
| Task 5 | `refactor(debug): replace event-bus with debug-emitter (optional)` | `src/js/utils/event-bus.js` |

---

## Appendix

### Scope 分类规则

| Scope | 前缀匹配 | 示例事件 |
|-------|----------|----------|
| `ui` | `ui:` | `ui:pause-changed` |
| `settings` | `settings:` | `settings:environment-changed` |
| `game` | `game:` | `game:create_world` |
| `core` | `core:` | `core:ready`, `core:tick` |
| `shadow` | `shadow:` | `shadow:quality-changed` |
| `pinia` | N/A (内部标记) | `pinia:uiStore.screen` |
| `all` | 显示所有 | - |

### 日志数据结构

```typescript
interface LogEntry {
  id: string // UUID
  timestamp: number // Date.now()
  type: 'emit' | 'on' | 'off' | 'pinia'
  scope: string // ui/settings/game/core/shadow/pinia
  eventName: string // 事件名或 storeKey
  data?: any // 事件数据或状态值
  oldValue?: any // Pinia 旧值
  newValue?: any // Pinia 新值
  source?: string // 调用来源 (文件名:行号)
  listeners?: number // 当前监听器数量
}
```

### JSON 导出格式

```json
{
  "timestamp": "2026-02-04T12:34:56.789Z",
  "logs": [
    {
      "id": "uuid-1",
      "timestamp": 1738670096789,
      "type": "emit",
      "scope": "ui",
      "eventName": "ui:pause-changed",
      "data": false,
      "source": "uiStore.js:165"
    }
  ],
  "snapshot": {
    "uiStore": {
      "screen": "playing",
      "isPaused": false
    },
    "settingsStore": {
      "shadowQuality": "high"
    }
  }
}
```
