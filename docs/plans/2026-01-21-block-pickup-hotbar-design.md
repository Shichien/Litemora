# Block Pickup & Hotbar System Design

挖掘方块后的完整流程设计：物品飞行动画 → Hotbar 收集 → 放置消耗

---

## 核心决策

| 决策项 | 选择 |
|--------|------|
| 掉落物表现 | 无独立实体，方块缩小飞向玩家后直接入包 |
| 背包规模 | 仅 Hotbar（9 格），无额外背包界面 |
| 放置交互 | 选中格子的方块类型，放置后消耗数量 |
| 飞行动画 | 临时 BoxGeometry + 对应材质贴图 |
| 初始状态 | Slot 0 放置 30 个泥土 (dirt) |
| 堆叠上限 | 64 个/格 |
| 工具系统 | 无工具，Steve 双拳万能 |

---

## 1. 数据结构

### HotbarItem 模型

```typescript
interface HotbarItem {
  blockId: number   // 对应 blocks-config.js 中的 id
  count: number     // 1-64
}
```

### hudStore 状态

```javascript
const hotbarItems = ref([
  { blockId: 2, count: 30 },  // dirt
  null, null, null, null,
  null, null, null, null
])

const MAX_STACK = 64
```

---

## 2. 飞行动画模块

### 新文件：`src/js/interaction/item-pickup-animator.js`

**职责**：
1. 监听 `game:block-break-complete` 事件
2. 原位置生成临时小方块（BoxGeometry + 材质）
3. GSAP 动画：缩小 + 飞向玩家胸口
4. 动画完成后触发 `hud:add-item`

**动画参数**：

```javascript
{
  duration: 0.5,
  startScale: 0.6,
  endScale: 0.2,
  ease: 'power2.in',
  targetOffset: [0, 1, 0]  // 玩家胸口偏移
}
```

---

## 3. Hotbar 逻辑

### hudStore 新增函数

```javascript
// 添加物品到 Hotbar（优先堆叠同类型）
function addItemToHotbar(blockId, amount = 1) {
  // 1. 优先堆叠已有同类型
  for (let slot of hotbarItems.value) {
    if (slot?.blockId === blockId && slot.count < MAX_STACK) {
      const canAdd = Math.min(amount, MAX_STACK - slot.count)
      slot.count += canAdd
      amount -= canAdd
      if (amount <= 0) return true
    }
  }
  // 2. 找空格子
  for (let i = 0; i < 9; i++) {
    if (!hotbarItems.value[i] && amount > 0) {
      hotbarItems.value[i] = { blockId, count: Math.min(amount, MAX_STACK) }
      amount -= MAX_STACK
      if (amount <= 0) return true
    }
  }
  return false  // 满了
}

// 消耗当前选中格子物品
function consumeSelectedItem() {
  const item = hotbarItems.value[selectedSlot.value]
  if (!item) return false
  item.count--
  if (item.count <= 0) {
    hotbarItems.value[selectedSlot.value] = null
  }
  return true
}

// 获取当前选中方块类型
function getSelectedBlockId() {
  return hotbarItems.value[selectedSlot.value]?.blockId ?? null
}
```

---

## 4. Hotbar UI - CSS 3D 方块

### Vue 组件结构

```vue
<div class="slot-block-3d" v-if="item">
  <div class="block-face block-top" :style="topStyle" />
  <div class="block-face block-front" :style="sideStyle" />
  <div class="block-face block-right" :style="sideStyle" />
</div>
<span v-if="item?.count > 1" class="slot-count">{{ item.count }}</span>
```

### CSS 3D 变换

```scss
.slot-block-3d {
  width: 32px;
  height: 32px;
  transform-style: preserve-3d;
  transform: rotateX(-30deg) rotateY(45deg);

  .block-face {
    position: absolute;
    width: 100%;
    height: 100%;
    background-size: cover;
    image-rendering: pixelated;
  }

  .block-top   { transform: rotateX(90deg) translateZ(16px); }
  .block-front { transform: translateZ(16px); }
  .block-right { transform: rotateY(90deg) translateZ(16px); }
}

.slot-count {
  position: absolute;
  right: 2px;
  bottom: 2px;
  font-size: 12px;
  color: white;
  text-shadow: 1px 1px 0 #000;
}
```

---

## 5. 放置逻辑修改

### block-interaction-manager.js

```javascript
// _placeBlock() 修改：
const blockToPlace = hudStore.getSelectedBlockId()
if (!blockToPlace) return  // 没有选中方块

// 放置成功后：
hudStore.consumeSelectedItem()
```

---

## 6. 事件流程

```
挖掘完成
    │
    ▼
[BlockMiningController]
    │ emit: 'game:block-break-complete' { blockId, worldPos }
    ▼
[ItemPickupAnimator]
    │ 1. 创建临时 BoxGeometry
    │ 2. GSAP: scale + position → player
    │ 3. emit: 'hud:add-item' { blockId }
    ▼
[hudStore.addItemToHotbar()]
    ▼
[Hotbar.vue] 响应式更新
```

---

## 7. 涉及文件

| 操作 | 文件 |
|------|------|
| 新增 | `src/js/interaction/item-pickup-animator.js` |
| 修改 | `src/pinia/hudStore.js` |
| 修改 | `src/vue/components/hud/Hotbar.vue` |
| 修改 | `src/styles/hud.scss` |
| 修改 | `src/js/interaction/block-interaction-manager.js` |
| 修改 | `src/js/world/world.js` (初始化 animator) |

---

## 8. 验证计划

1. 挖掘方块 → 看到飞行动画
2. 检查 Hotbar UI 显示 CSS 3D 方块 + 数量
3. 同类型方块堆叠到 64
4. 放置方块 → 数量减少
5. 数量归零 → 格子清空
6. 空手状态无法放置
