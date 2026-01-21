import gsap from 'gsap'
import * as THREE from 'three'

import Experience from '../experience.js'
import emitter from '../utils/event-bus.js'
import { blocks as blocksConfig } from '../world/terrain/blocks-config.js'

/**
 * ItemPickupAnimator
 * - Listens to 'game:block-break-complete' event
 * - Creates a temporary mini-block at the break position
 * - Animates it flying toward the player
 * - Emits 'hud:add-item' when animation completes
 */
export default class ItemPickupAnimator {
  constructor() {
    this.experience = new Experience()
    this.scene = this.experience.scene
    this.resources = this.experience.resources

    // Animation parameters (debug-tunable)
    this.params = {
      duration: 0.2,
      startScale: 0.3,
      endScale: 0.1,
      ease: 'power2.in',
      targetOffsetY: 0.1, // Fly toward player chest height
    }

    // Active animations tracking
    this.activeItems = []

    // Bind and listen to block break event
    this._onBlockBreakComplete = this._onBlockBreakComplete.bind(this)
    emitter.on('game:block-break-complete', this._onBlockBreakComplete)

    // Debug setup
    if (this.experience.debug?.active) {
      this.debugInit()
    }
  }

  /**
   * Handle block break complete event
   * @param {{ blockId: number, worldPos: { x, y, z } }} data
   */
  _onBlockBreakComplete({ blockId, worldPos }) {
    // Get block config
    const blockConfig = this._getBlockConfigById(blockId)
    if (!blockConfig) {
      // Still add item even if we can't show animation
      emitter.emit('hud:add-item', { blockId, amount: 1 })
      return
    }

    // Create temporary mini-block
    const mesh = this._createMiniBlock(blockConfig, worldPos)
    if (!mesh) {
      emitter.emit('hud:add-item', { blockId, amount: 1 })
      return
    }

    this.scene.add(mesh)
    this.activeItems.push({ mesh, blockId })

    // Get player position for target
    const player = this.experience.world?.player
    if (!player) {
      this._cleanupItem(mesh, blockId)
      return
    }

    const playerPos = player.getPosition()
    const targetPos = {
      x: playerPos.x,
      y: playerPos.y + this.params.targetOffsetY,
      z: playerPos.z,
    }

    // Animate: scale down + fly to player
    gsap.to(mesh.scale, {
      x: this.params.endScale,
      y: this.params.endScale,
      z: this.params.endScale,
      duration: this.params.duration,
      ease: this.params.ease,
    })

    gsap.to(mesh.position, {
      x: targetPos.x,
      y: targetPos.y,
      z: targetPos.z,
      duration: this.params.duration,
      ease: this.params.ease,
      onComplete: () => {
        this._cleanupItem(mesh, blockId)
      },
    })
  }

  /**
   * Get block config by ID
   */
  _getBlockConfigById(blockId) {
    for (const key of Object.keys(blocksConfig)) {
      if (blocksConfig[key].id === blockId) {
        return blocksConfig[key]
      }
    }
    return null
  }

  /**
   * Create a temporary mini BoxGeometry mesh with block texture
   * Following blocks-config.js material creation pattern
   */
  _createMiniBlock(blockConfig, worldPos) {
    const geometry = new THREE.BoxGeometry(1, 1, 1)
    const textureKeys = blockConfig.textureKeys

    if (!textureKeys) {
      geometry.dispose()
      return null
    }

    // Helper to get texture with pixelated filtering
    const getTexture = (key) => {
      const tex = this.resources.items[key]
      if (tex) {
        tex.magFilter = THREE.NearestFilter
        tex.minFilter = THREE.NearestFilter
      }
      return tex
    }

    // Create material from texture
    const makeMaterial = (tex) => {
      if (!tex)
        return null
      return new THREE.MeshBasicMaterial({
        map: tex,
        transparent: false,
      })
    }

    let materials

    // Six-face texture block (has side, top, bottom)
    if (textureKeys.side && textureKeys.top && textureKeys.bottom) {
      const sideTex = getTexture(textureKeys.side)
      const topTex = getTexture(textureKeys.top)
      const bottomTex = getTexture(textureKeys.bottom)

      if (!sideTex || !topTex || !bottomTex) {
        geometry.dispose()
        return null
      }

      // BoxGeometry face order: right, left, top, bottom, front, back
      materials = [
        makeMaterial(sideTex), // right
        makeMaterial(sideTex), // left
        makeMaterial(topTex), // top
        makeMaterial(bottomTex), // bottom
        makeMaterial(sideTex), // front
        makeMaterial(sideTex), // back
      ]
    }
    else {
      // Single texture for all faces
      const allTex = getTexture(textureKeys.all)
      if (!allTex) {
        geometry.dispose()
        return null
      }
      materials = makeMaterial(allTex)
    }

    const mesh = new THREE.Mesh(geometry, materials)

    // Position at block center (offset by 0.5 since block coords are corner-based)
    mesh.position.set(
      worldPos.x + 0.5,
      worldPos.y + 0.5,
      worldPos.z + 0.5,
    )

    // Start at initial scale
    mesh.scale.setScalar(this.params.startScale)

    return mesh
  }

  /**
   * Cleanup animated item and emit add event
   */
  _cleanupItem(mesh, blockId) {
    // Remove from scene
    this.scene.remove(mesh)

    // Dispose resources
    mesh.geometry.dispose()

    // Handle both single material and material array
    if (Array.isArray(mesh.material)) {
      mesh.material.forEach(mat => mat.dispose())
    }
    else {
      mesh.material.dispose()
    }

    // Remove from tracking
    const index = this.activeItems.findIndex(item => item.mesh === mesh)
    if (index !== -1) {
      this.activeItems.splice(index, 1)
    }

    // Emit add item event
    emitter.emit('hud:add-item', { blockId, amount: 1 })
  }

  /**
   * Debug panel
   */
  debugInit() {
    this.debugFolder = this.experience.debug.ui.addFolder({
      title: 'Item Pickup Animator',
      expanded: false,
    })

    this.debugFolder.addBinding(this.params, 'duration', {
      label: 'Duration (s)',
      min: 0.1,
      max: 2.0,
      step: 0.1,
    })

    this.debugFolder.addBinding(this.params, 'startScale', {
      label: 'Start Scale',
      min: 0.1,
      max: 1.0,
      step: 0.1,
    })

    this.debugFolder.addBinding(this.params, 'endScale', {
      label: 'End Scale',
      min: 0.05,
      max: 0.5,
      step: 0.05,
    })

    this.debugFolder.addBinding(this.params, 'targetOffsetY', {
      label: 'Target Offset Y',
      min: 0,
      max: 2,
      step: 0.1,
    })
  }

  /**
   * Destroy
   */
  destroy() {
    emitter.off('game:block-break-complete', this._onBlockBreakComplete)

    // Cleanup any active items
    for (const item of this.activeItems) {
      this.scene.remove(item.mesh)
      item.mesh.geometry.dispose()
      item.mesh.material.dispose()
    }
    this.activeItems = []
  }
}
