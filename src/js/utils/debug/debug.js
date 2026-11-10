// tweakpane 只服务于 `#debug`，所以改成运行时动态 import，
// 避免整块调试面板被打进主包。代价是 Pane 的创建会晚于
// `new Experience()` 里的同步构造函数，因此这里提供一个
// 延迟节点：先把调用记录下来，等 Pane 就绪后按原顺序回放。

// 加载失败时队列不再有人消费，加个上限避免无限增长
const MAX_QUEUED_OPS = 4000

/**
 * 延迟面板节点。
 *
 * 未拿到真正的 Pane 之前，所有 `addFolder` / `addBinding` / `addButton`
 * 都会返回同样类型的延迟节点，`on` / `refresh` 等链式调用被记录到队列；
 * `init()` 完成后再把队列原样回放到真实对象上。
 */
class DeferredNode {
  constructor(recorder) {
    this._recorder = recorder
    this._real = null
  }

  _record(op) {
    if (this._recorder.length < MAX_QUEUED_OPS) {
      this._recorder.push(op)
    }
  }

  addFolder(params) {
    return this._spawn('addFolder', [params])
  }

  addBinding(target, key, options) {
    return this._spawn('addBinding', [target, key, options])
  }

  addButton(params) {
    return this._spawn('addButton', [params])
  }

  addBlade(params) {
    return this._spawn('addBlade', [params])
  }

  addTab(params) {
    return this._spawn('addTab', [params])
  }

  addSeparator(params) {
    return this._spawn('addSeparator', [params])
  }

  on(name, handler) {
    return this._invoke('on', [name, handler])
  }

  off(name, handler) {
    return this._invoke('off', [name, handler])
  }

  refresh() {
    return this._invoke('refresh', [])
  }

  dispose() {
    return this._invoke('dispose', [])
  }

  _spawn(method, args) {
    const child = new DeferredNode(this._recorder)

    // Pane 已就绪：直接建在真实父节点上，不再排队
    if (this._real && typeof this._real[method] === 'function') {
      try {
        child._real = this._real[method](...args)
      }
      catch (error) {
        console.warn(`[debug] ${method} 失败`, error)
      }
      return child
    }

    this._record({ kind: 'create', node: child, parent: this, method, args })

    return child
  }

  _invoke(method, args) {
    if (this._real && typeof this._real[method] === 'function') {
      this._real[method](...args)
      return this
    }

    this._record({ kind: 'call', node: this, method, args })

    return this
  }
}

export default class Debug {
  constructor() {
    this.active = window.location.hash === '#debug'
    this._ops = []
    this._pane = null
    this._destroyed = false

    if (this.active) {
      this.ui = new DeferredNode(this._ops)
    }
  }

  /**
   * 按需加载 tweakpane 并补上面板。
   * 调用方不需要 await：加载完成后会把之前记录的调用回放上去。
   */
  async init() {
    if (!this.active || this._pane || this._destroyed) {
      return
    }

    try {
      const [tweakpane, essentials] = await Promise.all([
        import('tweakpane'),
        import('@tweakpane/plugin-essentials'),
      ])

      if (this._destroyed) {
        return
      }

      const pane = new tweakpane.Pane()
      pane.registerPlugin(essentials)

      this._pane = pane

      if (this.ui) {
        this.ui._real = pane
        this._flush()
      }
    }
    catch (error) {
      console.warn('[debug] tweakpane 加载失败，调试面板不可用', error)
    }
  }

  _flush() {
    const ops = this._ops
    this._ops = []

    for (const op of ops) {
      if (op.kind === 'create') {
        const parent = op.parent._real
        if (!parent || typeof parent[op.method] !== 'function') {
          continue
        }

        try {
          op.node._real = parent[op.method](...op.args)
        }
        catch (error) {
          console.warn(`[debug] ${op.method} 失败`, error)
        }
        continue
      }

      if (op.node._real && typeof op.node._real[op.method] === 'function') {
        op.node._real[op.method](...op.args)
      }
    }
  }

  destroy() {
    this._destroyed = true
    this._ops = []

    if (this._pane) {
      this._pane.dispose()
      this._pane = null
    }

    if (this.ui) {
      this.ui._real = null
      this.ui = null
    }
  }
}
