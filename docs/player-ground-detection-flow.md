# 玩家地面检测逻辑流程图

```mermaid
flowchart TD
    Start([每帧更新开始]) --> UpdatePhysics[PlayerMovementController.update]
    
    UpdatePhysics --> ComputeVelocity[计算水平速度与重力]
    ComputeVelocity --> PredictPosition[预测下一帧位置]
    PredictPosition --> BuildState[构建玩家状态 playerState<br/>isGrounded = false]
    
    BuildState --> BroadPhase[碰撞系统: broadPhase<br/>获取胶囊体AABB范围内的候选方块]
    BroadPhase --> NarrowPhase[碰撞系统: narrowPhase<br/>检测胶囊体与每个候选方块的碰撞]
    
    NarrowPhase --> CheckCollision{是否有碰撞?}
    CheckCollision -->|无碰撞| NoCollision[保持 isGrounded = false]
    CheckCollision -->|有碰撞| ResolveCollisions[resolveCollisions<br/>处理碰撞修正]
    
    ResolveCollisions --> ForEachCollision[遍历每个碰撞]
    ForEachCollision --> CapsuleContainsPoint[_capsuleContainsPoint<br/>检测点是否在胶囊体内]
    
    CapsuleContainsPoint --> CalcDistance[计算点到胶囊中心的距离]
    CalcDistance --> CheckDistance{距离 <= 半径?}
    CheckDistance -->|否| SkipCollision[跳过此碰撞]
    CheckDistance -->|是| CalcNormal[计算碰撞法线<br/>normal = 从方块指向胶囊中心]
    
    CalcNormal --> CheckGroundCondition{判断地面条件<br/>normal.y > 0.5<br/>且<br/>bottomProximity <= radius + 0.05}
    
    CheckGroundCondition -->|满足条件| SetGroundFlag[collision.ground = true]
    CheckGroundCondition -->|不满足| SetGroundFlag2[collision.ground = false]
    
    SetGroundFlag --> ResolvePosition[推离方块<br/>修正位置与速度]
    SetGroundFlag2 --> ResolvePosition
    
    ResolvePosition --> CheckGroundFlag{collision.ground == true?}
    CheckGroundFlag -->|是| SetGrounded[playerState.isGrounded = true<br/>清零下落速度 vy = 0]
    CheckGroundFlag -->|否| ContinueResolve[继续处理其他碰撞]
    
    SetGrounded --> ContinueResolve
    ContinueResolve --> MoreCollisions{还有碰撞?}
    MoreCollisions -->|是| ForEachCollision
    MoreCollisions -->|否| SyncState[同步状态<br/>this.isGrounded = playerState.isGrounded]
    
    NoCollision --> SyncState
    SkipCollision --> MoreCollisions
    
    SyncState --> End([更新完成])
    
    style Start fill:#e1f5ff
    style End fill:#c8e6c9
    style SetGrounded fill:#fff9c4
    style CheckGroundCondition fill:#ffe0b2
    style CapsuleContainsPoint fill:#f3e5f5
```

## 关键判断条件

### 1. 地面检测条件（`_capsuleContainsPoint` 方法）

```javascript
// 判断是否接地：法线朝上且接触点靠近胶囊底部球体
const bottomProximity = local.y + halfHeight  // 接触点到胶囊底部中心的相对高度
const ground = normal.y > 0.5 && bottomProximity <= radius + 0.05
```

**条件说明：**
- `normal.y > 0.5`：碰撞法线的 Y 分量必须大于 0.5（法线向上）
- `bottomProximity <= radius + 0.05`：接触点必须在胶囊底部球体附近（半径 + 0.05 的容差范围内）

### 2. 碰撞处理流程（`resolveCollisions` 方法）

1. **排序碰撞**：按重叠深度从小到大排序，优先处理浅层碰撞
2. **推离方块**：沿法线方向推离玩家，消除穿透
3. **速度修正**：去除沿法线方向的速度分量
4. **地面判定**：如果 `collision.ground == true`，则：
   - 设置 `playerState.isGrounded = true`
   - 清零下落速度 `worldVelocity.y = 0`

### 3. 状态同步

每帧更新完成后，将 `playerState.isGrounded` 同步到 `PlayerMovementController.isGrounded`，供其他系统（如动画系统、跳跃系统）使用。

## 相关文件

- `src/js/world/player/player-collision.js`：碰撞检测核心逻辑
- `src/js/world/player/player-movement-controller.js`：移动控制器，调用碰撞系统
- `src/js/world/player/player.js`：玩家主类，使用 `isGrounded` 状态
