# Voxel Ambient Occlusion 实现方案（InstancedMesh 版）

> 目标：在 **不放弃 InstancedMesh** 的前提下，实现类似 Minecraft / 0fps 的 **拐角渐变型 AO**，而不是整面变暗。

---

## 1. 背景与约束

### 当前引擎架构

- 体素数据：`TerrainContainer`
- 渲染方式：`THREE.InstancedMesh`
- 几何体：共享的 cube geometry
- 剔除：CPU 侧遮挡剔除（`isBlockObscured`）
- 不使用 greedy meshing

### 结论

| 方案 | 可行性 |
|----|----|
| 整面 AO（per-face） | ❌ 阴影生硬 |
| SSAO | ❌ 与体素结构无关 |
| 顶点 AO（0fps） | ✅ **目标方案** |
| Greedy + AO | ❌ 架构冲突 |

👉 **必须做到同一面 4 个顶点 AO 不同**

---

## 2. AO 效果目标

- 拐角最暗
- 边缘次之
- 完全暴露最亮
- 阴影自然渐变（由顶点插值产生）

对应 0fps 中的 AO 等级：

| AO 值 | 视觉效果 |
|----|----|
| 0 | 最暗 |
| 1 | 偏暗 |
| 2 | 偏亮 |
| 3 | 最亮 |

---

## 3. 核心方案概览

### 思路

1. **CPU**：为每个方块计算 `6 面 × 4 顶点 = 24 个 AO 值`
2. **GPU**：
   - 根据 `normal` 判断当前是哪个面
   - 根据 `position` 判断是该面的哪个角
   - 选用对应 AO 值并插值

### 数据流

```
TerrainContainer
  └─ computeAO()
       └─ block.ao[face][corner]
            ↓
InstancedBufferAttribute (6 × vec4)
            ↓
Vertex Shader (选择角)
            ↓
Fragment Shader (乘亮度)
```

---

## 4. AO 数据结构设计

### 每个 block

```ts
block.ao = {
  px: [a0, a1, a2, a3],
  nx: [a0, a1, a2, a3],
  py: [a0, a1, a2, a3],
  ny: [a0, a1, a2, a3],
  pz: [a0, a1, a2, a3],
  nz: [a0, a1, a2, a3],
}
```

### 顶点顺序约定（固定）

```
0: (-y, -z)
1: (-y, +z)
2: (+y, +z)
3: (+y, -z)
```

---

## 5. AO 计算规则（CPU）

### 顶点 AO 函数（0fps 原版）

```js
function vertexAO(side1, side2, corner) {
  if (side1 && side2)
    return 0
  return 3 - (side1 + side2 + corner)
}
```

### 以 +X 面为例

```ts
computeFaceAO_PX(x, y, z) {
  return [
    vertexAO(
      solid(x+1, y-1, z),
      solid(x+1, y,   z-1),
      solid(x+1, y-1, z-1)
    ),
    vertexAO(
      solid(x+1, y-1, z),
      solid(x+1, y,   z+1),
      solid(x+1, y-1, z+1)
    ),
    vertexAO(
      solid(x+1, y+1, z),
      solid(x+1, y,   z+1),
      solid(x+1, y+1, z+1)
    ),
    vertexAO(
      solid(x+1, y+1, z),
      solid(x+1, y,   z-1),
      solid(x+1, y+1, z-1)
    ),
  ]
}
```

其余 5 个方向按对称规则实现。

---

## 6. AO 计算时机

推荐插入点：

```
TerrainGenerator.generate()
 ├─ generateTerrain()
 ├─ generateResources()
 ├─ generateTrees()
 ├─ generatePlants()
 ├─ computeAO()   ← 新增
 └─ generateMeshes()
```

- 只在 **chunk 构建 / 重建** 时执行
- 方块更新时只重算局部 AO

---

## 7. AO 传入 GPU（InstancedMesh）

### InstancedBufferAttribute

为每个面创建一个 `vec4` attribute：

```js
geometry.setAttribute(
  'instanceAO_PX',
  new THREE.InstancedBufferAttribute(aoPXArray, 4)
)
```

共 6 个：

```
instanceAO_PX
instanceAO_NX
instanceAO_PY
instanceAO_NY
instanceAO_PZ
instanceAO_NZ
```

总计：**24 floats / instance**

---

## 8. Shader 实现要点

### Vertex Shader（核心逻辑）

```glsl
attribute vec4 instanceAO_PX;
attribute vec4 instanceAO_NX;
attribute vec4 instanceAO_PY;
attribute vec4 instanceAO_NY;
attribute vec4 instanceAO_PZ;
attribute vec4 instanceAO_NZ;

varying float vAO;

void main() {
  vec3 n = normal;
  vec4 ao;

  if (n.x > 0.5) ao = instanceAO_PX;
  else if (n.x < -0.5) ao = instanceAO_NX;
  else if (n.y > 0.5) ao = instanceAO_PY;
  else if (n.y < -0.5) ao = instanceAO_NY;
  else if (n.z > 0.5) ao = instanceAO_PZ;
  else ao = instanceAO_NZ;

  int corner =
      (position.y > 0.0 ? 2 : 0) +
      (position.z > 0.0 ? 1 : 0);

  vAO = ao[corner] / 3.0;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
```

### Fragment Shader

```glsl
float ao = mix(0.35, 1.0, vAO);
color.rgb *= ao;
```

---

## 9. 性能评估

- AO 数据：96 bytes / block
- 100k blocks ≈ 9.6 MB
- GPU：无额外 draw call
- CPU：O(n)，仅 chunk rebuild 时

👉 对 WebGL / Three.js **完全可接受**

---

## 10. 推荐实施顺序

1. ✅ 只实现 **PX 面 AO**（快速验证 shader）
2. 扩展到 6 面
3. 调整 AO → brightness 映射曲线
4. 局部更新 AO（方块增删）

---

## 11. 后续可扩展方向

- AO + 太阳光照（light propagation）
- AO + greedy meshing
- AO baking 到 lightmap
- SDF / cone-tracing AO

---

## 12. 参考

- 0fps: *Ambient Occlusion for Minecraft-like Worlds*
  https://0fps.net/2013/07/03/ambient-occlusion-for-minecraft-like-worlds/
