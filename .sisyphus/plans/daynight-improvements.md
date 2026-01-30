# Day/Night Cycle 改进计划 - SkyDome + 光照优化

## Context

### Original Request
用户测试后反馈三个问题：
1. 天空盒太糊 - `scene.background` 渲染质量差
2. 时段切换生硬 - 到阈值瞬间跳变，没有过渡
3. 夜晚太黑 - midnight 时段几乎看不见场景

### Interview Summary
**技术决策**:
- 采用 **SkyDome + 双贴图混合 Shader** 方案
- 创建天空球几何体，使用 ShaderMaterial 实现平滑过渡
- 调整夜间光照参数，增加可见度

---

## Work Objectives

### Core Objective
修复昼夜循环系统的三个视觉问题：天空盒模糊、切换生硬、夜间过暗。

### Concrete Deliverables
1. `src/shaders/sky/vertex.glsl` - 天空球顶点着色器
2. `src/shaders/sky/fragment.glsl` - 双贴图混合片段着色器
3. `src/js/world/sky-dome.js` - SkyDome 类
4. `src/js/world/day-cycle.js` 修改 - 集成 SkyDome，调整光照参数

### Definition of Done
- [ ] 天空盒渲染清晰，无明显拉伸变形
- [ ] 时段切换时有平滑的交叉淡入淡出效果
- [ ] 夜间场景可见度提升，能看清地形和角色

### Must Have
- SkyDome 几何体 + ShaderMaterial
- 双贴图平滑混合
- 夜间光照参数调整

### Must NOT Have (Guardrails)
- ❌ 不修改现有 Environment 类的其他功能
- ❌ 不改变时段划分逻辑
- ❌ 不添加额外的视觉特效（星空、云等）

---

## Verification Strategy (MANDATORY)

### Test Decision
- **Infrastructure exists**: YES (Playwright)
- **User wants tests**: NO
- **QA approach**: 手动验证 — Tweakpane 调试 + 视觉检查

### Manual QA Procedures
1. 启动 `pnpm dev`，访问 `/#debug`
2. 在 Day Cycle 面板中拖动 Time of Day 滑块
3. 观察天空盒过渡效果是否平滑
4. 切换到 midnight 时段，确认场景可见度

---

## Task Flow

```
Task 1 (创建着色器文件)
    ↓
Task 2 (创建 SkyDome 类)
    ↓
Task 3 (修改 DayCycle 集成 SkyDome)
    ↓
Task 4 (调整夜间光照参数)
    ↓
Task 5 (验证效果)
```

## Parallelization

| Task | Depends On | Reason |
|------|------------|--------|
| 1 | - | 无依赖 |
| 2 | 1 | 需要着色器文件 |
| 3 | 2 | 需要 SkyDome 类 |
| 4 | 3 | 在同一文件中修改 |
| 5 | 4 | 最终验证 |

---

## TODOs

- [ ] 1. 创建天空球着色器文件

  **What to do**:
  - 创建 `src/shaders/sky/` 目录
  - 创建 `vertex.glsl` - 简单的顶点着色器，传递 UV 坐标
  - 创建 `fragment.glsl` - 双贴图混合着色器

  **Must NOT do**:
  - 不添加复杂的大气散射效果

  **Parallelizable**: NO

  **References**:
  - `src/shaders/` — 现有着色器目录结构
  - Three.js ShaderMaterial 文档

  **Vertex Shader 代码**:
  ```glsl
  // src/shaders/sky/vertex.glsl
  varying vec2 vUv;
  varying vec3 vWorldPosition;

  void main() {
    vUv = uv;
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
  ```

  **Fragment Shader 代码**:
  ```glsl
  // src/shaders/sky/fragment.glsl
  uniform sampler2D textureA;   // 当前时段贴图
  uniform sampler2D textureB;   // 下一时段贴图
  uniform float mixFactor;      // 混合因子 (0-1)

  varying vec2 vUv;

  void main() {
    vec4 colorA = texture2D(textureA, vUv);
    vec4 colorB = texture2D(textureB, vUv);
    vec4 finalColor = mix(colorA, colorB, mixFactor);
    gl_FragColor = finalColor;
  }
  ```

  **Acceptance Criteria**:
  - [ ] `src/shaders/sky/vertex.glsl` 文件存在
  - [ ] `src/shaders/sky/fragment.glsl` 文件存在
  - [ ] 代码无语法错误

  **Commit**: YES
  - Message: `feat(shaders): add sky dome shaders for texture blending`
  - Files: `src/shaders/sky/vertex.glsl`, `src/shaders/sky/fragment.glsl`

---

- [ ] 2. 创建 SkyDome 类

  **What to do**:
  - 创建 `src/js/world/sky-dome.js`
  - 使用 SphereGeometry 创建天空球（半径 500，从内部观看）
  - 使用 ShaderMaterial 加载上一步的着色器
  - 实现 `setTextures(current, next)` 方法
  - 实现 `setMixFactor(factor)` 方法
  - 实现 `update(cameraPosition)` 方法让天空球跟随相机

  **Must NOT do**:
  - 不在此类中处理时间逻辑

  **Parallelizable**: NO (依赖 Task 1)

  **References**:
  - `src/js/world/environment.js` — 组件结构参考
  - `src/js/world/day-cycle.js` — 将调用此类

  **类代码**:
  ```javascript
  // src/js/world/sky-dome.js
  import * as THREE from 'three'

  import skyFragmentShader from '@/shaders/sky/fragment.glsl'
  import skyVertexShader from '@/shaders/sky/vertex.glsl'

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

      // 创建天空球几何体（大半球）
      this.geometry = new THREE.SphereGeometry(
        500,    // 半径
        64,     // 水平分段
        32,     // 垂直分段
        0,      // phiStart
        Math.PI * 2, // phiLength (完整圆)
        0,      // thetaStart
        Math.PI // thetaLength (完整球)
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
        depthWrite: false,    // 不写入深度缓冲
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
  ```

  **Acceptance Criteria**:
  - [ ] `src/js/world/sky-dome.js` 文件存在
  - [ ] SkyDome 类可被实例化
  - [ ] 天空球正确添加到场景中

  **Commit**: YES
  - Message: `feat(world): add SkyDome class with texture blending`
  - Files: `src/js/world/sky-dome.js`

---

- [ ] 3. 修改 DayCycle 集成 SkyDome

  **What to do**:
  - 在 DayCycle 构造函数中实例化 SkyDome
  - 修改 `_updateSkybox()` 方法：
    - 计算当前时段和下一时段
    - 计算混合因子（progress 转换为过渡曲线）
    - 调用 `skyDome.setTextures()` 和 `skyDome.setMixFactor()`
  - 在 `update()` 中调用 `skyDome.update(cameraPosition)`
  - 移除对 `scene.background` 的直接设置
  - 在 `destroy()` 中清理 SkyDome

  **Must NOT do**:
  - 不改变时段划分逻辑

  **Parallelizable**: NO (依赖 Task 2)

  **References**:
  - `src/js/world/day-cycle.js:240-255` — 现有 `_updateSkybox()` 方法

  **修改要点**:

  1. 导入 SkyDome:
  ```javascript
  import SkyDome from './sky-dome.js'
  ```

  2. 构造函数中初始化:
  ```javascript
  // 创建天空球
  this.skyDome = new SkyDome()
  
  // 初始化天空贴图
  this._initSkyTextures()
  ```

  3. 新增 `_initSkyTextures()` 方法:
  ```javascript
  _initSkyTextures() {
    // 设置初始贴图
    const { phase, nextPhase } = this._getPhaseInfo()
    const currentTex = this.skyTextures[phase]
    const nextTex = this.skyTextures[nextPhase]
    this.skyDome.setTextures(currentTex, nextTex)
    this.skyDome.setMixFactor(0)
  }
  ```

  4. 修改 `_updateSkybox()`:
  ```javascript
  _updateSkybox() {
    const { phase, progress, nextPhase } = this._getPhaseInfo()
    
    const currentTex = this.skyTextures[phase]
    const nextTex = this.skyTextures[nextPhase]
    
    // 设置贴图
    this.skyDome.setTextures(currentTex, nextTex)
    
    // 计算混合因子：使用 smoothstep 过渡曲线
    // progress 0.0-0.7: mixFactor = 0 (完全显示当前)
    // progress 0.7-1.0: mixFactor 0->1 (渐变到下一个)
    let mixFactor = 0
    if (progress > 0.7) {
      mixFactor = (progress - 0.7) / 0.3
      // smoothstep 平滑过渡
      mixFactor = mixFactor * mixFactor * (3 - 2 * mixFactor)
    }
    
    this.skyDome.setMixFactor(mixFactor)
  }
  ```

  5. 在 `update()` 中更新天空球位置:
  ```javascript
  // 更新天空球位置（跟随相机）
  if (this.skyDome) {
    const camera = this.experience.camera.instance
    this.skyDome.update(camera.position)
  }
  ```

  6. 删除 `scene.background` 相关代码

  **Acceptance Criteria**:
  - [ ] DayCycle 正确实例化 SkyDome
  - [ ] 天空过渡平滑，无跳变
  - [ ] 天空球跟随相机移动

  **Commit**: YES
  - Message: `feat(daycycle): integrate SkyDome with smooth transitions`
  - Files: `src/js/world/day-cycle.js`

---

- [ ] 4. 调整夜间光照参数

  **What to do**:
  - 修改 `phaseConfig` 中的夜间时段参数
  - 增加 `moonIntensity` 默认值

  **Must NOT do**:
  - 不改变白天时段的参数

  **Parallelizable**: NO (在 Task 3 同一文件中)

  **References**:
  - `src/js/world/day-cycle.js:40-95` — phaseConfig 定义

  **参数调整**:
  ```javascript
  // 在 phaseConfig 中修改以下时段:
  dusk: {
    texture: 'sky_duskTexture',
    sunIntensity: 0.4,          // 原 0.3
    sunColor: '#9988aa',
    ambientIntensity: 0.4,      // 原 0.3
    ambientColor: '#7788aa',
    fog: { color: '#5c6080', density: 0.015 },
  },
  midnight: {
    texture: 'sky_midnightTexture',
    sunIntensity: 0.1,          // 原 0.0
    sunColor: '#334455',        // 原 '#222244'
    ambientIntensity: 0.35,     // 原 0.2
    ambientColor: '#445566',    // 原 '#334466'
    fog: { color: '#1a1a2e', density: 0.018 }, // density 原 0.02
  },
  
  // 在 this.params 中修改:
  moonIntensity: 0.5,           // 原 0.3
  ```

  **Acceptance Criteria**:
  - [ ] dusk 时段 ambientIntensity >= 0.4
  - [ ] midnight 时段 ambientIntensity >= 0.35
  - [ ] moonIntensity >= 0.5
  - [ ] 夜间场景明显比之前亮

  **Commit**: YES (与 Task 3 合并提交)
  - Message: `feat(daycycle): integrate SkyDome with smooth transitions`

---

- [ ] 5. 验证效果

  **What to do**:
  - 运行 `pnpm dev` 启动开发服务器
  - 访问 `/#debug` 模式
  - 验证所有改进效果

  **Must NOT do**:
  - 不在此阶段添加新功能

  **Parallelizable**: NO (最终验证任务)

  **Full Verification Checklist**:
  - [ ] **天空清晰度**: 天空球渲染无明显拉伸或模糊
  - [ ] **过渡平滑**: 拖动 Time of Day 滑块，时段切换有渐变效果
  - [ ] **夜间可见度**: 切换到 midnight (0.0)，能看清地形和角色
  - [ ] **天空跟随相机**: 移动角色时天空球始终包围视野
  - [ ] **性能**: 帧率稳定，无卡顿

  **Commit**: YES
  - Message: `feat(daynight): improve sky rendering and night visibility`

---

## Commit Strategy

| After Task | Message | Files |
|------------|---------|-------|
| 1 | `feat(shaders): add sky dome shaders for texture blending` | `src/shaders/sky/*` |
| 2 | `feat(world): add SkyDome class with texture blending` | `src/js/world/sky-dome.js` |
| 3+4 | `feat(daycycle): integrate SkyDome with smooth transitions` | `src/js/world/day-cycle.js` |
| 5 | N/A (验证无修改) | - |

---

## Success Criteria

### Verification Commands
```bash
pnpm dev          # 启动开发服务器
pnpm lint         # 代码检查通过
```

### Final Checklist
- [ ] 天空盒渲染清晰，无拉伸变形
- [ ] 时段切换平滑过渡（约 30% 时间用于渐变）
- [ ] 夜间场景可见度明显提升
- [ ] 代码符合项目规范（ESLint 通过）
