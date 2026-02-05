# Debug Panel - Common Mistakes

Catalog of common errors and their correct patterns.

## ❌ Color Without view: 'color'

**Bad:**
```javascript
folder.addBinding(this.params, 'color', {
  label: '颜色',
})
// Displays as text input
```

**Good:**
```javascript
folder.addBinding(this.params, 'color', {
  label: '颜色',
  view: 'color',  // Required for color picker
})
```

## ❌ Direct debug.ui Extraction

**Bad:**
```javascript
// In constructor
this.debug = this.experience.debug.ui  // Wrong level
```

**Good:**
```javascript
this.debug = this.experience.debug     // Correct
// Access via this.debug.ui in debugInit()
```

## ❌ Missing debug.active Check

**Bad:**
```javascript
constructor() {
  this.debugInit()  // Crashes if #debug not active
}
```

**Good:**
```javascript
constructor() {
  if (this.debug.active) {
    this.debugInit()
  }
}
```

## ❌ Deep Nesting (>3 levels)

**Bad:**
```javascript
mainFolder.addFolder()
  .addFolder()
  .addFolder()
  .addFolder()  // Too deep!
```

**Good:**
```javascript
// Max 3 levels
const main = this.debug.ui.addFolder({ title: 'Main' })
const sub = main.addFolder({ title: 'Sub' })
const detail = sub.addFolder({ title: 'Detail' })
```

## ❌ All Panels Expanded

**Bad:**
```javascript
const f1 = this.debug.ui.addFolder({ expanded: true })
const f2 = this.debug.ui.addFolder({ expanded: true })
const f3 = this.debug.ui.addFolder({ expanded: true })
// Panel too long, hard to navigate
```

**Good:**
```javascript
const f1 = this.debug.ui.addFolder({ expanded: true })   // Common: open
const f2 = this.debug.ui.addFolder({ expanded: false })  // Secondary: closed
const f3 = this.debug.ui.addFolder({ expanded: false })  // Secondary: closed
```

## ❌ Anonymous Event Listeners

**Bad:**
```javascript
emitter.on('input:update', (data) => this.handle(data))
// Cannot remove listener later
```

**Good:**
```javascript
constructor() {
  this._boundHandler = this.handle.bind(this)
  emitter.on('input:update', this._boundHandler)
}

destroy() {
  emitter.off('input:update', this._boundHandler)
}
```
