---
name: vtj-debug-panel
description: Use when adding Tweakpane debug panels to 3D components. Covers folder structure, addBinding patterns, color controls, point3d views, buttons, and change handlers.
---

# vite-threejs Debug Panel (Tweakpane)

## Overview

所有 3D 组件使用 **Tweakpane** 创建调试面板。面板通过 `#debug` URL hash 激活，用于实时调整参数、监控状态。

**核心原则**：每个可调参数都应有对应控件，颜色必须用 `view: 'color'`，面板结构清晰分组。

## When to Use

- 创建新 3D 组件时添加调试面板
- 为 ShaderMaterial 的 uniform 添加控件
- 需要实时监控组件状态
- 添加快捷操作按钮

## 激活方式

```
https://your-site.com/#debug
```

调试系统定义在 `src/js/utils/debug.js`：

```javascript
// Debug 类结构
class Debug {
  constructor() {
    this.active = window.location.hash === '#debug'
    if (this.active) {
      this.ui = new Pane()  // Tweakpane 实例
    }
  }
}
```

## 基本结构

```javascript
// 在构造函数中
constructor() {
  this.experience = new Experience()
  this.debug = this.experience.debug
  
  // 组件参数（用于绑定）
  this.params = {
    intensity: 1.0,
    color: '#ffffff',
    enabled: true,
  }
  
  if (this.debug.active) {
    this.debugInit()
  }
}

debugInit() {
  // 创建主文件夹
  this.debugFolder = this.debug.ui.addFolder({
    title: 'Component Name',
    expanded: false,  // 默认折叠，避免面板过长
  })
  
  // 添加控件...
}
```

## 控件类型

### 数值滑块

```javascript
folder.addBinding(this.params, 'intensity', {
  label: '强度',
  min: 0,
  max: 10,
  step: 0.1,
})
```

### 颜色选择器

**颜色必须使用 `view: 'color'`**：

```javascript
// 字符串颜色
this.params = { color: '#ff0000' }

folder.addBinding(this.params, 'color', {
  label: '颜色',
  view: 'color',
})

// RGB 对象颜色
this.params = { color: { r: 255, g: 128, b: 0 } }

folder.addBinding(this.params, 'color', {
  label: '颜色',
  view: 'color',
})
```

### 3D 点/向量

```javascript
this.params = { position: { x: 0, y: 10, z: 0 } }

folder.addBinding(this.params, 'position', {
  label: '位置',
  view: 'point3d',
  x: { step: 1 },
  y: { min: 0, max: 100, step: 1 },
  z: { step: 1 },
})
```

### 布尔开关

```javascript
folder.addBinding(this.params, 'enabled', {
  label: '启用',
})
```

### 下拉选择

```javascript
folder.addBinding(this.params, 'mode', {
  label: '模式',
  options: {
    '模式A': 'modeA',
    '模式B': 'modeB',
    '模式C': 'modeC',
  },
})
```

### 只读监控

```javascript
folder.addBinding(this.debugInfo, 'fps', {
  label: 'FPS',
  readonly: true,
})

// 多行文本监控
folder.addBinding(this.debugInfo, 'log', {
  label: '状态',
  readonly: true,
  multiline: true,
  rows: 4,
})
```

### 按钮

```javascript
folder.addButton({ title: 'Reset' }).on('click', () => {
  this.reset()
})

folder.addButton({ title: '⏸️ Pause' }).on('click', () => {
  this.params.paused = !this.params.paused
})
```

## 变更处理

### 方式一：on('change') 回调

```javascript
folder.addBinding(this.params, 'intensity', {
  label: '强度',
  min: 0,
  max: 1,
}).on('change', (ev) => {
  this.material.uniforms.uIntensity.value = ev.value
})
```

### 方式二：绑定到方法

```javascript
folder.addBinding(this.params, 'color', {
  label: '颜色',
  view: 'color',
}).on('change', this.updateColor.bind(this))

// 在类中定义更新方法
updateColor() {
  this.light.color.set(this.params.color)
}
```

### 方式三：直接绑定对象属性

```javascript
// 直接绑定 Three.js 对象（自动同步）
folder.addBinding(this.mesh, 'visible', {
  label: '显示',
})

folder.addBinding(this.helper, 'visible', {
  label: 'Helper',
})
```

## 面板分组

### 层级结构

```javascript
debugInit() {
  // 一级：组件主文件夹
  const mainFolder = this.debug.ui.addFolder({
    title: 'Environment',
    expanded: false,
  })
  
  // 二级：功能分组
  const lightFolder = mainFolder.addFolder({
    title: 'Sun Light',
    expanded: true,  // 常用的展开
  })
  
  const fogFolder = mainFolder.addFolder({
    title: 'Fog',
    expanded: false,  // 次要的折叠
  })
  
  // 三级：细分（如需要）
  const shadowFolder = lightFolder.addFolder({
    title: 'Shadow Settings',
    expanded: false,
  })
}
```

### 分组原则

| 原则 | 说明 |
|------|------|
| 按功能分组 | Light / Fog / Shadow 各一组 |
| 常用的展开 | `expanded: true` |
| 次要的折叠 | `expanded: false` |
| 最多三级 | 避免嵌套过深 |

## ShaderMaterial 调试

**所有 ShaderMaterial 的关键 uniform 必须有调试控件**：

```javascript
// 材质定义
this.material = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uIntensity: { value: 0.5 },
    uColor: { value: new THREE.Color('#ffffff') },
  },
  vertexShader,
  fragmentShader,
})

// 调试面板
debugInit() {
  const folder = this.debug.ui.addFolder({
    title: 'Shader Effect',
    expanded: true,
  })
  
  // 强度
  folder.addBinding(this.params, 'intensity', {
    label: '强度',
    min: 0,
    max: 1,
    step: 0.01,
  }).on('change', (ev) => {
    this.material.uniforms.uIntensity.value = ev.value
  })
  
  // 颜色（必须 view: 'color'）
  folder.addBinding(this.params, 'color', {
    label: '颜色',
    view: 'color',
  }).on('change', (ev) => {
    // 处理 RGB 对象转 Three.js Color
    if (typeof ev.value === 'object') {
      this.material.uniforms.uColor.value.setRGB(
        ev.value.r / 255,
        ev.value.g / 255,
        ev.value.b / 255
      )
    } else {
      this.material.uniforms.uColor.value.set(ev.value)
    }
  })
}
```

## 完整示例

```javascript
debugInit() {
  // ===== 主控制面板 =====
  this.debugFolder = this.debug.ui.addFolder({
    title: 'Block Raycaster',
    expanded: false,
  })

  // ----- 设置分组 -----
  const settings = this.debugFolder.addFolder({ 
    title: '设置', 
    expanded: true 
  })

  settings.addBinding(this.params, 'enabled', { 
    label: '启用' 
  }).on('change', () => {
    if (!this.params.enabled) this._clear()
  })

  settings.addBinding(this.params, 'maxDistance', {
    label: '最大距离',
    min: 1,
    max: 30,
    step: 0.5,
  }).on('change', () => {
    this.raycaster.far = this.params.maxDistance
  })

  // ----- 监控分组 -----
  const monitor = this.debugFolder.addFolder({ 
    title: '拾取监控', 
    expanded: true 
  })

  monitor.addBinding(this.debugInfo, 'log', {
    label: '实时状态',
    readonly: true,
    multiline: true,
    rows: 6,
  })
  
  // ----- 快捷操作 -----
  const actions = this.debugFolder.addFolder({
    title: '快捷操作',
    expanded: false,
  })
  
  actions.addButton({ title: 'Reset' }).on('click', () => {
    this.reset()
  })
}
```

## Common Mistakes

### ❌ 颜色不使用 view: 'color'

```javascript
// BAD: 显示为文本输入
folder.addBinding(this.params, 'color', {
  label: '颜色',
})

// GOOD: 显示颜色选择器
folder.addBinding(this.params, 'color', {
  label: '颜色',
  view: 'color',  // ✅ 必须
})
```

### ❌ 直接访问 debug.ui 提取

```javascript
// BAD: 在构造函数中直接提取 ui
this.debug = this.experience.debug.ui  // ❌

// GOOD: 提取 debug 对象
this.debug = this.experience.debug     // ✅
// 然后通过 this.debug.ui 访问
```

### ❌ 没有检查 debug.active

```javascript
// BAD: 直接调用（#debug 未激活时报错）
this.debugInit()

// GOOD: 条件调用
if (this.debug.active) {
  this.debugInit()
}
```

### ❌ 面板嵌套过深

```javascript
// BAD: 4+ 层嵌套
mainFolder.addFolder().addFolder().addFolder().addFolder()

// GOOD: 最多 3 层
mainFolder → subFolder → detailFolder
```

### ❌ 所有面板默认展开

```javascript
// BAD: 全部 expanded: true
const folder1 = this.debug.ui.addFolder({ expanded: true })
const folder2 = this.debug.ui.addFolder({ expanded: true })
const folder3 = this.debug.ui.addFolder({ expanded: true })
// 面板过长，难以查找

// GOOD: 只展开常用的
const folder1 = this.debug.ui.addFolder({ expanded: true })   // 常用
const folder2 = this.debug.ui.addFolder({ expanded: false })  // 次要
const folder3 = this.debug.ui.addFolder({ expanded: false })  // 次要
```

## Quick Reference

| 控件类型 | 关键配置 |
|----------|----------|
| 数值 | `min`, `max`, `step` |
| 颜色 | `view: 'color'` （必须） |
| 3D点 | `view: 'point3d'`, `x/y/z: { step }` |
| 选择 | `options: { label: value }` |
| 只读 | `readonly: true` |
| 多行 | `multiline: true`, `rows: N` |
| 按钮 | `addButton({ title })` |

| 访问方式 | 代码 |
|----------|------|
| Debug 对象 | `this.debug = this.experience.debug` |
| 检查激活 | `if (this.debug.active)` |
| Tweakpane UI | `this.debug.ui.addFolder(...)` |
| 方法命名 | `debugInit()` （统一） |
