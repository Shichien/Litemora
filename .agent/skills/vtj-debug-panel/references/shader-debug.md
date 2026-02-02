# Debug Panel - ShaderMaterial Integration

Patterns for debugging shader uniforms via Tweakpane.

## Required Pattern

All ShaderMaterial uniforms must have corresponding debug controls:

```javascript
// Material definition
this.material = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uIntensity: { value: 0.5 },
    uColor: { value: new THREE.Color('#ffffff') },
  },
  vertexShader,
  fragmentShader,
})

// Debug configuration
this.params = {
  intensity: 0.5,
  color: '#ffffff',
}
```

## Basic Shader Debug Panel

```javascript
debugInit() {
  const folder = this.debug.ui.addFolder({
    title: 'Shader Effect',
    expanded: true,
  })
  
  // Numeric uniform
  folder.addBinding(this.params, 'intensity', {
    label: '强度',
    min: 0, max: 1, step: 0.01,
  }).on('change', (ev) => {
    this.material.uniforms.uIntensity.value = ev.value
  })
  
  // Color uniform - must use view: 'color'
  folder.addBinding(this.params, 'color', {
    label: '颜色',
    view: 'color',
  }).on('change', (ev) => {
    if (typeof ev.value === 'object') {
      // RGB object format
      this.material.uniforms.uColor.value.setRGB(
        ev.value.r / 255,
        ev.value.g / 255,
        ev.value.b / 255,
      )
    } else {
      // String format
      this.material.uniforms.uColor.value.set(ev.value)
    }
  })
}
```

## Color Conversion Helpers

```javascript
// Helper for consistent color conversion
_setUniformColor(uniformName, colorValue) {
  const uniform = this.material.uniforms[uniformName]
  if (typeof colorValue === 'object') {
    uniform.value.setRGB(
      colorValue.r / 255,
      colorValue.g / 255,
      colorValue.b / 255,
    )
  } else {
    uniform.value.set(colorValue)
  }
}

// Usage in debugInit
folder.addBinding(this.params, 'glowColor', {
  view: 'color',
}).on('change', (ev) => {
  this._setUniformColor('uGlowColor', ev.value)
})
```

## Time-based Uniforms

```javascript
// In update(), not debugInit
update() {
  const elapsed = this.experience.time.elapsed
  this.material.uniforms.uTime.value = elapsed * 0.001
}
```

## Complete Shader Debug Setup

```javascript
class ShaderEffect {
  constructor() {
    this.experience = new Experience()
    this.debug = this.experience.debug
    
    this.config = {
      color: { r: 255, g: 255, b: 255 },
      intensity: 1.0,
      speed: 1.0,
    }
    
    this._createMaterial()
    
    if (this.debug.active) {
      this.debugInit()
    }
  }
  
  _createMaterial() {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(1, 1, 1) },
        uIntensity: { value: 1.0 },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
    })
  }
  
  debugInit() {
    const folder = this.debug.ui.addFolder({
      title: 'Shader Effect',
      expanded: false,
    })
    
    // Color with view: 'color'
    folder.addBinding(this.config, 'color', {
      label: 'Color',
      view: 'color',
    }).on('change', (ev) => {
      this.material.uniforms.uColor.value.setRGB(
        ev.value.r / 255,
        ev.value.g / 255,
        ev.value.b / 255,
      )
    })
    
    // Intensity slider
    folder.addBinding(this.config, 'intensity', {
      label: 'Intensity',
      min: 0, max: 2, step: 0.01,
    }).on('change', (ev) => {
      this.material.uniforms.uIntensity.value = ev.value
    })
  }
  
  update() {
    this.material.uniforms.uTime.value = this.experience.time.elapsed * 0.001
  }
  
  destroy() {
    this.material.dispose()
  }
}
```

## Uniform Type Mapping

| GLSL Type | JS Initial Value | Debug Control |
|-----------|------------------|---------------|
| `float` | `{ value: 1.0 }` | `addBinding` with min/max |
| `vec2` | `new THREE.Vector2(1, 1)` | `view: 'point2d'` or separate bindings |
| `vec3` (color) | `new THREE.Color(1, 1, 1)` | `view: 'color'` |
| `vec3` (position) | `new THREE.Vector3(1, 1, 1)` | `view: 'point3d'` |
| `sampler2D` | `{ value: texture }` | Reference selector (custom) |
