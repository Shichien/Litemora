import TerrainContainer from './terrain-container.js'
import TerrainRenderer from './terrain-renderer.js'

/**
 * 一个 chunk 只承载玩家放置的经典方块；世界内容全部来自原理图，不做程序化生成。
 */
export default class TerrainChunk {
  /**
   * @param {{
   *  chunkX:number,
   *  chunkZ:number,
   *  chunkWidth:number,
   *  chunkHeight:number,
   *  sharedRenderParams?: object,
   *  blockVisibilityFilter?: Function | null,
   * }} options
   */
  constructor(options) {
    const {
      chunkX,
      chunkZ,
      chunkWidth,
      chunkHeight,
      sharedRenderParams,
      blockVisibilityFilter = null,
    } = options

    this.chunkX = chunkX
    this.chunkZ = chunkZ
    this.userData = { x: chunkX, z: chunkZ }

    this.state = 'init'

    this.originX = chunkX * chunkWidth
    this.originZ = chunkZ * chunkWidth

    this.container = new TerrainContainer(
      { width: chunkWidth, height: chunkHeight },
      { useSingleton: false },
    )

    this.renderer = new TerrainRenderer(this.container, {
      sharedParams: sharedRenderParams,
      chunkName: `${this.chunkX}, ${this.chunkZ}`,
      visibilityFilter: blockVisibilityFilter,
    })
    this.renderer.group.position.set(this.originX, 0, this.originZ)
    this.renderer.group.userData.chunkX = this.chunkX
    this.renderer.group.userData.chunkZ = this.chunkZ
    this.renderer.group.userData.originX = this.originX
    this.renderer.group.userData.originZ = this.originZ

    this.renderer.group.scale.setScalar(sharedRenderParams?.scale ?? 1)
  }

  /**
   * 构建 mesh（依赖数据 ready）
   */
  buildMesh() {
    if (this.state === 'disposed')
      return false
    if (this.state !== 'dataReady')
      return false

    this.renderer._rebuildFromContainer()
    this.state = 'meshReady'
    return true
  }

  /**
   * Refresh the current mesh in place after visibility-only changes.
   * - dataReady: build the chunk for the first time
   * - meshReady: rebuild the existing renderer from the container
   */
  refreshMesh() {
    if (this.state === 'disposed') {
      return false
    }

    if (this.state === 'dataReady') {
      return this.buildMesh()
    }

    if (this.state === 'meshReady') {
      this.renderer?._rebuildFromContainer?.()
      return true
    }

    return false
  }

  /**
   * 每帧更新：转发到 renderer 更新动画材质
   */
  update() {
    if (this.state !== 'meshReady')
      return
    this.renderer?.update()
  }

  /**
   * 释放当前 chunk 的渲染资源（用于动态卸载）
   * 注意：必须幂等，避免重复 dispose 报错
   */
  dispose() {
    if (this.state === 'disposed')
      return

    this.state = 'disposed'

    if (this.renderer) {
      this.renderer.dispose()
      this.renderer = null
    }
  }
}
