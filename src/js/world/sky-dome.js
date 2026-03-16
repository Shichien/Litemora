import skyFragmentShader from '@/shaders/sky/fragment.glsl'
import skyVertexShader from '@/shaders/sky/vertex.glsl'
import * as THREE from 'three'

import Experience from '../experience.js'

/**
 * SkyDome - 天空球组件
 * 使用程序化渐变、太阳/月亮和星空实现 Minecraft 风格昼夜天空。
 */
export default class SkyDome {
  constructor() {
    this.experience = new Experience()
    this.scene = this.experience.scene

    // 创建天空球几何体（完整球体）
    this.geometry = new THREE.SphereGeometry(
      150, // 半径
      64, // 水平分段
      32, // 垂直分段
      0, // phiStart
      Math.PI * 2, // phiLength (完整圆)
      0, // thetaStart
      Math.PI, // thetaLength (完整球)
    )

    // 创建混合着色器材质
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        zenithDayColor: { value: new THREE.Color('#7ab6ff') },
        horizonDayColor: { value: new THREE.Color('#dff0ff') },
        zenithNightColor: { value: new THREE.Color('#061120') },
        horizonNightColor: { value: new THREE.Color('#182744') },
        sunDirection: { value: new THREE.Vector3(0, 1, 0) },
        moonDirection: { value: new THREE.Vector3(0, -1, 0) },
        sunColor: { value: new THREE.Color('#fff1d6') },
        moonColor: { value: new THREE.Color('#dbe7ff') },
        dayFactor: { value: 1.0 },
        twilightFactor: { value: 0.0 },
        starsStrength: { value: 0.0 },
        sunDiscSize: { value: 0.028 },
        sunGlowSize: { value: 0.16 },
        moonDiscSize: { value: 0.022 },
        moonGlowSize: { value: 0.09 },
      },
      vertexShader: skyVertexShader,
      fragmentShader: skyFragmentShader,
      side: THREE.BackSide, // 从内部观看
      depthWrite: false, // 不写入深度缓冲
    })

    // 创建网格
    this.mesh = new THREE.Mesh(this.geometry, this.material)
    this.mesh.renderOrder = -1000 // 最先渲染
    this.scene.add(this.mesh)
  }

  /**
   * 设置当前天空状态
   * @param {object} state - 当前昼夜天空参数
   */
  setSkyState(state = {}) {
    const {
      zenithDayColor,
      horizonDayColor,
      zenithNightColor,
      horizonNightColor,
      sunDirection,
      moonDirection,
      sunColor,
      moonColor,
      dayFactor,
      twilightFactor,
      starsStrength,
      sunDiscSize,
      sunGlowSize,
      moonDiscSize,
      moonGlowSize,
    } = state

    if (zenithDayColor) this.material.uniforms.zenithDayColor.value.set(zenithDayColor)
    if (horizonDayColor) this.material.uniforms.horizonDayColor.value.set(horizonDayColor)
    if (zenithNightColor) this.material.uniforms.zenithNightColor.value.set(zenithNightColor)
    if (horizonNightColor) this.material.uniforms.horizonNightColor.value.set(horizonNightColor)
    if (sunDirection) this.material.uniforms.sunDirection.value.copy(sunDirection).normalize()
    if (moonDirection) this.material.uniforms.moonDirection.value.copy(moonDirection).normalize()
    if (sunColor) this.material.uniforms.sunColor.value.set(sunColor)
    if (moonColor) this.material.uniforms.moonColor.value.set(moonColor)
    if (Number.isFinite(dayFactor)) this.material.uniforms.dayFactor.value = dayFactor
    if (Number.isFinite(twilightFactor)) this.material.uniforms.twilightFactor.value = twilightFactor
    if (Number.isFinite(starsStrength)) this.material.uniforms.starsStrength.value = starsStrength
    if (Number.isFinite(sunDiscSize)) this.material.uniforms.sunDiscSize.value = sunDiscSize
    if (Number.isFinite(sunGlowSize)) this.material.uniforms.sunGlowSize.value = sunGlowSize
    if (Number.isFinite(moonDiscSize)) this.material.uniforms.moonDiscSize.value = moonDiscSize
    if (Number.isFinite(moonGlowSize)) this.material.uniforms.moonGlowSize.value = moonGlowSize
  }

  /**
   * 每帧更新：跟随相机位置
   * @param {THREE.Vector3} cameraPosition - 相机位置
   */
  update(cameraPosition) {
    if (cameraPosition) {
      this.mesh.position.copy(cameraPosition)
    }
  }

  /**
   * 销毁资源
   */
  destroy() {
    this.scene.remove(this.mesh)
    this.geometry.dispose()
    this.material.dispose()
  }
}
