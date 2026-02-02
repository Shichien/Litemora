# Debug Panel - Advanced Patterns

Complex panel structures and specialized use cases.

## Folder Hierarchy

```javascript
debugInit() {
  // Level 1: Component main folder
  const mainFolder = this.debug.ui.addFolder({
    title: 'Environment',
    expanded: false,
  })
  
  // Level 2: Feature groups
  const lightFolder = mainFolder.addFolder({
    title: 'Sun Light',
    expanded: true,  // Common features: open
  })
  
  const fogFolder = mainFolder.addFolder({
    title: 'Fog',
    expanded: false,  // Secondary: closed
  })
  
  // Level 3: Details (maximum depth)
  const shadowFolder = lightFolder.addFolder({
    title: 'Shadow Settings',
    expanded: false,
  })
}
```

## Complete Component Example

```javascript
debugInit() {
  // Main panel
  this.debugFolder = this.debug.ui.addFolder({
    title: 'Block Raycaster',
    expanded: false,
  })

  // Settings group
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
    min: 1, max: 30, step: 0.5,
  }).on('change', () => {
    this.raycaster.far = this.params.maxDistance
  })

  // Monitor group
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
  
  // Actions group
  const actions = this.debugFolder.addFolder({
    title: '快捷操作',
    expanded: false,
  })
  
  actions.addButton({ title: 'Reset' }).on('click', () => {
    this.reset()
  })
}
```

## Grouping Principles

| Principle | Implementation |
|-----------|----------------|
| By feature | Light / Fog / Shadow separate folders |
| Common expanded | `expanded: true` for frequently used |
| Secondary collapsed | `expanded: false` for occasional use |
| Max depth | Never exceed 3 nesting levels |

## Access Pattern Reference

```javascript
// Correct access sequence
constructor() {
  this.experience = new Experience()
  this.debug = this.experience.debug  // Get debug object
}

debugInit() {
  // Check active first
  if (!this.debug.active) return
  
  // Then access ui
  this.debugFolder = this.debug.ui.addFolder({
    title: 'My Component',
  })
}
```
