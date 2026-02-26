import * as THREE from 'three'
import Experience from '../../experience.js'
import PlantRenderer from './plant-renderer.js'
import TerrainContainer from './terrain-container.js'
import TerrainGenerator from './terrain-generator.js'
import TerrainRenderer from './terrain-renderer.js'

const WATER_COLOR = 0x3399CC

const WATER_Y_EPSILON = 2.4

export default class TerrainChunk {
  /**
   * @param {{
   *  chunkX:number,
   *  chunkZ:number,
   *  chunkWidth:number,
   *  chunkHeight:number,
   *  seed:number,
   *  terrain?: { scale?:number, magnitude?:number, offset?:number, rockExpose?: { maxDepth?:number, slopeThreshold?:number } },
   *  biomeSource?: string,
   *  forcedBiome?: string,
   * }} options
   */
  constructor(options) {
    const {
      chunkX,
      chunkZ,
      chunkWidth,
      chunkHeight,
      seed,
      terrain,
      sharedRenderParams,
      sharedTerrainParams,
      sharedTreeParams,
      sharedWaterParams,
      sharedBiomeGenerator, // STEP 2: 共享群系生成器
      biomeSource,
      forcedBiome,
      schematicOnlyMode = false,
    } = options

    this._sharedRenderParams = sharedRenderParams
    this._sharedWaterParams = sharedWaterParams
    this._chunkWidth = chunkWidth
    this._chunkHeight = chunkHeight
    this._schematicOnlyMode = !!schematicOnlyMode

    this.experience = new Experience()
    this.resources = this.experience.resources

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

    this.generator = new TerrainGenerator({
      size: { width: chunkWidth, height: chunkHeight },
      container: this.container,
      seed,
      terrain,
      sharedTerrainParams,
      sharedTreeParams,
      sharedWaterParams,
      sharedBiomeGenerator,
      originX: this.originX,
      originZ: this.originZ,
      biomeSource,
      forcedBiome,
      autoGenerate: false,
      broadcast: false,
      debugEnabled: false,
    })

    this.renderer = new TerrainRenderer(this.container, {
      sharedParams: sharedRenderParams,
      debugEnabled: false,
      listenDataReady: false,
      chunkName: `${this.chunkX}, ${this.chunkZ}`,
    })
    this.renderer.group.position.set(this.originX, 0, this.originZ)
    this.renderer.group.userData.chunkX = this.chunkX
    this.renderer.group.userData.chunkZ = this.chunkZ
    this.renderer.group.userData.originX = this.originX
    this.renderer.group.userData.originZ = this.originZ

    this.renderer.group.scale.setScalar(sharedRenderParams?.scale ?? 1)

    this.plantRenderer = new PlantRenderer(this.container, {
      sharedParams: sharedRenderParams,
      chunkName: `${this.chunkX}, ${this.chunkZ}`,
    })
    this.plantRenderer.group.position.set(this.originX, 0, this.originZ)
    this.plantRenderer.group.scale.setScalar(sharedRenderParams?.scale ?? 1)

    this.waterMesh = null
    if (!this._schematicOnlyMode) {
      this._createWaterMesh()
    }
  }

  _createWaterMesh() {
    if (this._schematicOnlyMode) {
      return
    }

    const waterOffset = this._sharedWaterParams?.waterOffset ?? 8
    const heightScale = this._sharedRenderParams?.heightScale ?? 1

    const geometry = new THREE.PlaneGeometry(this._chunkWidth, this._chunkWidth)
    geometry.rotateX(-Math.PI / 2)

    const waterTexture = this.resources.items.water_Texture
    if (waterTexture) {
      waterTexture.wrapS = THREE.RepeatWrapping
      waterTexture.wrapT = THREE.RepeatWrapping
      waterTexture.repeat.set(this._chunkWidth, this._chunkWidth)
    }

    const material = new THREE.MeshLambertMaterial({
      map: waterTexture,
      color: WATER_COLOR,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
    })

    this.waterMesh = new THREE.Mesh(geometry, material)

    this.waterMesh.renderOrder = 3
    this.waterMesh.raycast = () => {}
    this.waterMesh.userData.noRaycast = true
    this.waterMesh.userData.isWater = true

    this.waterMesh.position.set(
      this._chunkWidth / 2,
      waterOffset * heightScale + WATER_Y_EPSILON,
      this._chunkWidth / 2,
    )

    this.renderer.group.add(this.waterMesh)
  }

  refreshWater() {
    if (!this.waterMesh)
      return

    const waterOffset = this._sharedWaterParams?.waterOffset ?? 8
    const heightScale = this._sharedRenderParams?.heightScale ?? 1

    this.waterMesh.position.y = waterOffset * heightScale + WATER_Y_EPSILON
  }

  setSchematicOnlyMode(enabled = true) {
    const nextMode = !!enabled
    if (this._schematicOnlyMode === nextMode) {
      return
    }

    this._schematicOnlyMode = nextMode

    if (this._schematicOnlyMode) {
      this._disposeWaterMesh()
      return
    }

    this._createWaterMesh()
  }

  _disposeWaterMesh() {
    if (!this.waterMesh)
      return

    this.waterMesh.geometry?.dispose()
    this.waterMesh.material?.dispose()
    this.renderer?.group?.remove(this.waterMesh)
    this.waterMesh = null
  }

  generateData() {
    if (this.state === 'disposed')
      return false
    if (this.state !== 'init')
      return false

    this.generator.generate()
    this.state = 'dataReady'
    return true
  }

  regenerate(params = {}) {
    if (this.state === 'disposed')
      return

    this.generator.updateParams(params)

    this.generator.generate()
    this.state = 'dataReady'

    this.buildMesh()

    this.refreshWater()
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
    // 构建植物 mesh
    this.plantRenderer.build(this.generator.plantData)
    this.state = 'meshReady'
    return true
  }

  /**
   * 每帧更新：转发到 renderer 更新动画材质
   */
  update() {
    if (this.state !== 'meshReady')
      return
    this.renderer?.update()
    this.plantRenderer?.update()
  }

  /**
   * 释放当前 chunk 的渲染资源（用于动态卸载）
   * 注意：必须幂等，避免重复 dispose 报错
   */
  dispose() {
    if (this.state === 'disposed')
      return

    this.state = 'disposed'

    // 释放水面 mesh
    this._disposeWaterMesh()

    if (this.plantRenderer) {
      this.plantRenderer.dispose()
      this.plantRenderer = null
    }

    if (this.renderer) {
      this.renderer.dispose()
      this.renderer = null
    }
    // container/generator 目前不持有 WebGL 资源，无需 dispose
  }
}
