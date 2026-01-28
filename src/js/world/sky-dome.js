import skyFragmentShader from '@/shaders/sky/fragment.glsl'
import skyVertexShader from '@/shaders/sky/vertex.glsl'
import * as THREE from 'three'

import Experience from '../experience.js'

/**
 * SkyDome - 天空球组件
 * 使用双贴图混合实现平滑的天空过渡
 */
export default class SkyDome {
  constructor() {
    this.experience = new Experience()
    this.scene = this.experience.scene
    this.resources = this.experience.resources

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
        textureA: { value: null },
        textureB: { value: null },
        mixFactor: { value: 0.0 },
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
   * 设置当前和下一个贴图
   * @param {THREE.Texture} current - 当前时段贴图
   * @param {THREE.Texture} next - 下一时段贴图
   */
  setTextures(current, next) {
    this.material.uniforms.textureA.value = current
    this.material.uniforms.textureB.value = next
  }

  /**
   * 设置混合因子
   * @param {number} factor - 0-1 的混合比例
   */
  setMixFactor(factor) {
    this.material.uniforms.mixFactor.value = factor
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
