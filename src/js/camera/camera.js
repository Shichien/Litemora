import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js'

import Experience from '../experience.js'
import emitter from '../utils/event/event-bus.js'

const SETTINGS_MOUSE_SENSITIVITY_BASE = 0.03
const FIRST_PERSON_MOUSE_SENSITIVITY_RATIO = 0.002 / SETTINGS_MOUSE_SENSITIVITY_BASE

function dampScalar(current, target, lambda, dt) {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt))
}

export default class Camera {
  constructor() {
    this.experience = new Experience()
    this.sizes = this.experience.sizes
    this.scene = this.experience.scene
    this.canvas = this.experience.canvas
    this.debug = this.experience.debug
    this.debugActive = this.experience.debug.active
    this.time = this.experience.time

    this.rig = null
    this.cameraHelper = null
    this.cameraHelperVisible = false

    this.cameraModes = {
      FIRST_PERSON: 'first-person',
      THIRD_PERSON_BACK: 'third-person-back',
      THIRD_PERSON_FRONT: 'third-person-front',
      BIRD_PERSPECTIVE: 'bird-perspective',
    }
    this.currentMode = null
    this.previousMode = null
    this.allowPerspectiveToggle = true

    this.position = new THREE.Vector3(0, 0, 0)
    this.target = new THREE.Vector3(0, 0, 0)
    this._terrainInfo = this._getTerrainInfo()
    this._topViewConfig = {
      birdDistanceRatio: 1.6,
      birdHeightRatio: 1.2,
    }
    this._modeLabel = { current: '第一人称' }

    this.gameplayFov = 55
    this.baseGameplayFov = 55
    this.currentGameplayFov = 55
    this.sprintFovMultiplier = 1.1
    this.sprintFovSmoothing = 10
    this.gameplayPitch = 0
    this.gameplayPitchTarget = 0
    this.gameplayPitchMin = -Math.PI * 0.48
    this.gameplayPitchMax = Math.PI * 0.48
    this.gameplayPitchSmoothing = 24
    this.gameplayMouseSensitivity = 0.002
    this.thirdPersonDistance = 4
    this.thirdPersonFocusDistance = 16
    this._lookDirection = new THREE.Vector3(0, 0, -1)
    this._lookTarget = new THREE.Vector3()
    this._headPosition = new THREE.Vector3()
    this._desiredCameraPosition = new THREE.Vector3()
    this._clippedCameraPosition = new THREE.Vector3()
    this._segmentDirection = new THREE.Vector3()
    this._samplePoint = new THREE.Vector3()

    this.setInstances()
    this._createCameraHelper()
    this.setControls()
    this.switchMode(this.cameraModes.FIRST_PERSON)
    this.setDebug()

    emitter.on('input:toggle_camera_side', () => {
      this.toggleSide()
    })
    emitter.on('input:toggle_perspective', () => {
      if (!this.allowPerspectiveToggle) {
        return
      }
      this._cycleGameplayPerspective()
    })
    emitter.on('ui:control-permissions-changed', (payload = {}) => {
      if (payload.allowPerspectiveToggle !== undefined) {
        this.allowPerspectiveToggle = !!payload.allowPerspectiveToggle
      }
    })
    emitter.on('terrain:data-ready', () => {
      this._terrainInfo = this._getTerrainInfo()
      if (this.currentMode === this.cameraModes.BIRD_PERSPECTIVE) {
        this._applyTopViewPlacement()
      }
    })
    emitter.on('input:mouse_move', ({ movementY }) => {
      if (this.currentMode === this.cameraModes.BIRD_PERSPECTIVE) {
        return
      }

      this.gameplayPitchTarget = THREE.MathUtils.clamp(
        this.gameplayPitchTarget - movementY * this.gameplayMouseSensitivity,
        this.gameplayPitchMin,
        this.gameplayPitchMax,
      )
    })
    emitter.on('settings:mouse-sensitivity-changed', (value) => {
      const numericValue = Number(value)
      if (!Number.isFinite(numericValue)) {
        return
      }

      this.gameplayMouseSensitivity = Math.max(
        0.0001,
        numericValue * FIRST_PERSON_MOUSE_SENSITIVITY_RATIO,
      )
    })
    emitter.on('settings:camera-rig-changed', ({ fov } = {}) => {
      if (fov?.baseFov !== undefined) {
        const nextFov = Number(fov.baseFov)
        if (Number.isFinite(nextFov)) {
          this.baseGameplayFov = THREE.MathUtils.clamp(nextFov, 30, 120)
          this.gameplayFov = this.baseGameplayFov
          this.currentGameplayFov = this.baseGameplayFov
        }
      }
    })
    emitter.on('pointer:unlocked', () => {
      this.gameplayPitchTarget = this.gameplayPitch
    })
  }

  attachRig(rig) {
    this.rig = rig
    if (this.debugActive && this.debugFolder && this.rig?.setDebug) {
      this.rig.setDebug(this.debugFolder)
    }
  }

  toggleSide() {
    if (this.currentMode === this.cameraModes.THIRD_PERSON_BACK) {
      this.switchMode(this.cameraModes.THIRD_PERSON_FRONT)
    }
    else if (this.currentMode === this.cameraModes.THIRD_PERSON_FRONT) {
      this.switchMode(this.cameraModes.THIRD_PERSON_BACK)
    }
  }

  setInstances() {
    this.perspectiveCamera = new THREE.PerspectiveCamera(
      this.gameplayFov,
      this.sizes.width / this.sizes.height,
      0.1,
      512,
    )
    this.perspectiveCamera.position.copy(this.position)
    this.perspectiveCamera.lookAt(this.target)

    this.instance = this.perspectiveCamera
    this.scene.add(this.perspectiveCamera)
  }

  setControls() {
    if (this.orbitControls) {
      this.orbitControls.dispose()
    }
    if (this.trackballControls) {
      this.trackballControls.dispose()
    }

    this.orbitControls = new OrbitControls(this.instance, this.canvas)
    this.orbitControls.enableDamping = true
    this.orbitControls.enableZoom = true
    this.orbitControls.enablePan = false
    this.orbitControls.enabled = false
    this.orbitControls.target.copy(this.target)
    this.orbitControls.maxPolarAngle = Math.PI / 2 - 0.05
    this.orbitControls.minDistance = 5

    this.trackballControls = new TrackballControls(this.instance, this.canvas)
    this.trackballControls.noRotate = true
    this.trackballControls.noPan = true
    this.trackballControls.noZoom = false
    this.trackballControls.zoomSpeed = 1
    this.trackballControls.enabled = false
    this.trackballControls.target.copy(this.target)
  }

  switchMode(mode) {
    if (!Object.values(this.cameraModes).includes(mode) || mode === this.currentMode) {
      return
    }

    this.previousMode = this.currentMode
    this.currentMode = mode
    this.instance = this.perspectiveCamera
    this.instance.fov = this.currentGameplayFov
    this.instance.updateProjectionMatrix()
    this.setControls()

    if (mode === this.cameraModes.BIRD_PERSPECTIVE) {
      this._configureBirdViewOrbit()
      this._applyTopViewPlacement()
    }
    else {
      this.orbitControls.enabled = false
      this.trackballControls.enabled = false
    }

    this._modeLabel.current = this._translateMode(mode)
    if (this._modeBinding) {
      this._modeBinding.refresh()
    }

    this._createCameraHelper()
    this._notifyRenderer()

    const payload = {
      mode,
      firstPerson: mode === this.cameraModes.FIRST_PERSON,
      thirdPerson: mode === this.cameraModes.THIRD_PERSON_BACK || mode === this.cameraModes.THIRD_PERSON_FRONT,
      thirdPersonFront: mode === this.cameraModes.THIRD_PERSON_FRONT,
      thirdPersonBack: mode === this.cameraModes.THIRD_PERSON_BACK,
    }
    emitter.emit('camera:perspective-changed', payload)
    emitter.emit('hud:camera-perspective-changed', payload)
  }

  _cycleGameplayPerspective() {
    if (this.currentMode === this.cameraModes.FIRST_PERSON) {
      this.switchMode(this.cameraModes.THIRD_PERSON_BACK)
      return
    }

    if (this.currentMode === this.cameraModes.THIRD_PERSON_BACK) {
      this.switchMode(this.cameraModes.THIRD_PERSON_FRONT)
      return
    }

    this.switchMode(this.cameraModes.FIRST_PERSON)
  }

  _configureBirdViewOrbit() {
    const info = this._terrainInfo
    const radius = info?.radius || 80
    const minDistance = Math.max(5, radius * 0.3)
    const maxDistance = radius * 4

    this.orbitControls.enabled = true
    this.orbitControls.enableRotate = true
    this.orbitControls.enablePan = false
    this.orbitControls.enableZoom = true
    this.orbitControls.minDistance = minDistance
    this.orbitControls.maxDistance = maxDistance
    this.orbitControls.minPolarAngle = Math.PI * 0.1
    this.orbitControls.maxPolarAngle = Math.PI / 2 - 0.05
    this.trackballControls.enabled = false
  }

  _applyTopViewPlacement() {
    const info = this._terrainInfo
    const center = info?.center || new THREE.Vector3(0, 0, 0)
    const radius = info?.radius || 80

    const distance = radius * this._topViewConfig.birdDistanceRatio
    const height = radius * this._topViewConfig.birdHeightRatio
    const offset = new THREE.Vector3(distance, height, distance)
    this.instance.position.copy(center).add(offset)
    this.instance.lookAt(center)
    this.orbitControls.target.copy(center)
  }

  _getTerrainInfo() {
    const terrainRenderer = this.experience.world?.terrainRenderer
    if (terrainRenderer?.getBoundingInfo) {
      return terrainRenderer.getBoundingInfo()
    }

    return {
      center: new THREE.Vector3(0, 0, 0),
      width: 128,
      depth: 128,
      height: 10,
      radius: 90,
    }
  }

  attachRenderer(renderer) {
    this.rendererRef = renderer
    this._notifyRenderer()
  }

  _createCameraHelper() {
    if (this.cameraHelper) {
      this.scene.remove(this.cameraHelper)
      this.cameraHelper.geometry?.dispose?.()
      this.cameraHelper.material?.dispose?.()
    }

    this.cameraHelper = new THREE.CameraHelper(this.instance)
    this.cameraHelper.visible = this.cameraHelperVisible
    this.scene.add(this.cameraHelper)
  }

  _notifyRenderer() {
    if (this.rendererRef?.onCameraSwitched) {
      this.rendererRef.onCameraSwitched(this.instance)
    }
  }

  _translateMode(mode) {
    if (mode === this.cameraModes.FIRST_PERSON) {
      return '第一人称'
    }
    if (mode === this.cameraModes.THIRD_PERSON_BACK) {
      return '第三人称后视'
    }
    if (mode === this.cameraModes.THIRD_PERSON_FRONT) {
      return '第三人称前视'
    }
    return '鸟瞰透视'
  }

  setDebug() {
    if (!this.debugActive) {
      return
    }

    this.debugFolder = this.debug.ui.addFolder({
      title: 'Camera',
      expanded: false,
    })

    const modeFolder = this.debugFolder.addFolder({
      title: '视角切换',
      expanded: true,
    })

    this._modeBinding = modeFolder.addBinding(this._modeLabel, 'current', {
      label: '当前模式',
      readonly: true,
    })

    modeFolder.addButton({
      title: '第一人称',
    }).on('click', () => {
      this.switchMode(this.cameraModes.FIRST_PERSON)
    })

    modeFolder.addButton({
      title: '第三人称后视',
    }).on('click', () => {
      this.switchMode(this.cameraModes.THIRD_PERSON_BACK)
    })

    modeFolder.addButton({
      title: '第三人称前视',
    }).on('click', () => {
      this.switchMode(this.cameraModes.THIRD_PERSON_FRONT)
    })

    modeFolder.addButton({
      title: '鸟瞰透视',
    }).on('click', () => {
      this.switchMode(this.cameraModes.BIRD_PERSPECTIVE)
    })

    this.debugFolder.addBinding(this, 'cameraHelperVisible', {
      label: '显示相机助手',
    }).on('change', (ev) => {
      if (this.cameraHelper) {
        this.cameraHelper.visible = ev.value
        this.cameraHelper.update()
      }
    })
  }

  updateCamera() {
    this.instance.position.copy(this.position)
    this.instance.lookAt(this.target)
    this.orbitControls.target.copy(this.target)
    this.trackballControls.target.copy(this.target)
    this.orbitControls.update()
    this.trackballControls.update()
  }

  resize() {
    this.instance.aspect = this.sizes.width / this.sizes.height
    this.instance.updateProjectionMatrix()
    if (this.cameraHelper) {
      this.cameraHelper.update()
    }
    this.trackballControls.handleResize()
  }

  update() {
    if (this.currentMode === this.cameraModes.BIRD_PERSPECTIVE) {
      this.orbitControls.update()
      this.trackballControls.update()
      return
    }

    const player = this.rig?.target
    if (!player) {
      return
    }

    const dt = this.time.delta / 1000
    this.gameplayPitch = dampScalar(
      this.gameplayPitch,
      this.gameplayPitchTarget,
      this.gameplayPitchSmoothing,
      dt,
    )

    const playerPos = player.getPosition()
    const eyeHeight = player.getEyeHeight?.() ?? 1.62
    const facingAngle = player.getFacingAngle()
    const isGameplayPerspective = this.currentMode === this.cameraModes.FIRST_PERSON
      || this.currentMode === this.cameraModes.THIRD_PERSON_BACK
      || this.currentMode === this.cameraModes.THIRD_PERSON_FRONT
    const shouldUseSprintFov = isGameplayPerspective
      && (player.isSprinting?.() || player.getHorizontalSpeed?.() >= 5.55)
    const targetGameplayFov = shouldUseSprintFov
      ? this.baseGameplayFov * this.sprintFovMultiplier
      : this.baseGameplayFov

    this.currentGameplayFov = dampScalar(
      this.currentGameplayFov,
      targetGameplayFov,
      this.sprintFovSmoothing,
      dt,
    )

    this._headPosition.set(
      playerPos.x,
      playerPos.y + eyeHeight,
      playerPos.z,
    )

    const horizontalFactor = Math.cos(this.gameplayPitch)
    this._lookDirection.set(
      -Math.sin(facingAngle) * horizontalFactor,
      Math.sin(this.gameplayPitch),
      -Math.cos(facingAngle) * horizontalFactor,
    ).normalize()

    this.instance.fov = this.currentGameplayFov
    this.instance.updateProjectionMatrix()

    if (this.currentMode === this.cameraModes.FIRST_PERSON) {
      this.instance.position.copy(this._headPosition)
      this._lookTarget.copy(this._headPosition).add(this._lookDirection)
      this.instance.lookAt(this._lookTarget)
      this.orbitControls.target.copy(this._lookTarget)
      this.trackballControls.target.copy(this._lookTarget)
      return
    }

    const distanceSign = this.currentMode === this.cameraModes.THIRD_PERSON_FRONT ? 1 : -1
    this._desiredCameraPosition.copy(this._headPosition).addScaledVector(
      this._lookDirection,
      this.thirdPersonDistance * distanceSign,
    )

    this._resolveThirdPersonCameraPosition(this._headPosition, this._desiredCameraPosition, this._clippedCameraPosition)
    this.instance.position.copy(this._clippedCameraPosition)

    if (this.currentMode === this.cameraModes.THIRD_PERSON_FRONT) {
      this._lookTarget.copy(this._headPosition)
    }
    else {
      this._lookTarget.copy(this._headPosition).addScaledVector(this._lookDirection, this.thirdPersonFocusDistance)
    }

    this.instance.lookAt(this._lookTarget)
    this.orbitControls.target.copy(this._lookTarget)
    this.trackballControls.target.copy(this._lookTarget)
  }

  _resolveThirdPersonCameraPosition(origin, desired, target) {
    const provider = this.experience.terrainDataManager
    if (!provider?.getCollisionBoxesWorld) {
      target.copy(desired)
      return target
    }

    this._segmentDirection.subVectors(desired, origin)
    const distance = this._segmentDirection.length()

    if (distance <= 1e-4) {
      target.copy(origin)
      return target
    }

    this._segmentDirection.normalize()

    const stepLength = 0.15
    let lastClearDistance = 0

    for (let sampleDistance = stepLength; sampleDistance <= distance; sampleDistance += stepLength) {
      this._samplePoint.copy(origin).addScaledVector(this._segmentDirection, sampleDistance)
      if (this._isCameraPointBlocked(this._samplePoint)) {
        const clippedDistance = Math.max(0, lastClearDistance - 0.08)
        target.copy(origin).addScaledVector(this._segmentDirection, clippedDistance)
        return target
      }
      lastClearDistance = sampleDistance
    }

    target.copy(desired)
    return target
  }

  _isCameraPointBlocked(point) {
    const provider = this.experience.terrainDataManager
    if (!provider?.getCollisionBoxesWorld) {
      return false
    }

    const centerX = Math.floor(point.x + 0.5)
    const centerY = Math.floor(point.y + 0.5)
    const centerZ = Math.floor(point.z + 0.5)

    for (let worldX = centerX - 1; worldX <= centerX + 1; worldX++) {
      for (let worldY = centerY - 1; worldY <= centerY + 1; worldY++) {
        for (let worldZ = centerZ - 1; worldZ <= centerZ + 1; worldZ++) {
          const boxes = provider.getCollisionBoxesWorld(worldX, worldY, worldZ)
          if (!Array.isArray(boxes) || !boxes.length) {
            continue
          }

          for (const box of boxes) {
            if (
              point.x >= box.minX && point.x <= box.maxX
              && point.y >= box.minY && point.y <= box.maxY
              && point.z >= box.minZ && point.z <= box.maxZ
            ) {
              return true
            }
          }
        }
      }
    }

    return false
  }

  destroy() {
    if (this.orbitControls) {
      this.orbitControls.dispose()
      this.orbitControls = null
    }
    if (this.trackballControls) {
      this.trackballControls.dispose()
      this.trackballControls = null
    }

    if (this.cameraHelper) {
      this.scene.remove(this.cameraHelper)
      this.cameraHelper.geometry?.dispose()
      this.cameraHelper.material?.dispose()
      this.cameraHelper = null
    }

    if (this.perspectiveCamera) {
      this.scene.remove(this.perspectiveCamera)
    }

    this.rig = null
    this.rendererRef = null
  }
}
