# Debug Panel - Control Types

Detailed control type configurations for Tweakpane.

## Numeric Slider

```javascript
folder.addBinding(this.params, 'intensity', {
  label: '强度',
  min: 0,
  max: 10,
  step: 0.1,
})
```

## Color Picker

**Required: always use `view: 'color'`**

```javascript
// String format
this.params = { color: '#ff0000' }
folder.addBinding(this.params, 'color', {
  label: '颜色',
  view: 'color',
})

// RGB object format
this.params = { color: { r: 255, g: 128, b: 0 } }
folder.addBinding(this.params, 'color', {
  label: '颜色',
  view: 'color',
})
```

## 3D Point/Vector

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

## Boolean Toggle

```javascript
folder.addBinding(this.params, 'enabled', {
  label: '启用',
})
```

## Dropdown Select

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

## Read-only Monitor

```javascript
folder.addBinding(this.debugInfo, 'fps', {
  label: 'FPS',
  readonly: true,
})

// Multiline text
folder.addBinding(this.debugInfo, 'log', {
  label: '状态',
  readonly: true,
  multiline: true,
  rows: 4,
})
```

## Button

```javascript
folder.addButton({ title: 'Reset' }).on('click', () => {
  this.reset()
})

folder.addButton({ title: '⏸️ Pause' }).on('click', () => {
  this.params.paused = !this.params.paused
})
```

## Change Handlers

### Method 1: Inline callback

```javascript
folder.addBinding(this.params, 'intensity', {
  min: 0, max: 1,
}).on('change', (ev) => {
  this.material.uniforms.uIntensity.value = ev.value
})
```

### Method 2: Bind to class method

```javascript
folder.addBinding(this.params, 'color', {
  view: 'color',
}).on('change', this.updateColor.bind(this))

updateColor() {
  this.light.color.set(this.params.color)
}
```

### Method 3: Direct object binding

```javascript
// Binds directly to Three.js object properties
folder.addBinding(this.mesh, 'visible', { label: '显示' })
folder.addBinding(this.helper, 'visible', { label: 'Helper' })
```
