# 在后台录制回放

## simulateSwitchReplay(options)

这个函数在浏览器后台线程中加载 WASM、操作开关并收集变化。它自行初始化和释放模拟器。传入一个参数对象，返回 `Promise<{ packed, control, summary }>`。

| 参数字段 | 类型 | 含义 |
| --- | --- | --- |
| `buffer` | `ArrayBuffer`，必填 | 原理图原始文件。调用会将缓冲区的所有权转移给后台线程；想保留原文件时传 `buffer.slice(0)` |
| `fileName` | `string`，需提供 | 用后缀选择解析格式，支持 `.litematic` 和 `.schem` |
| `recording` | `'door'` 或 `'machine'` | 默认 `'door'`，录下可重复播放的开关门片段。`'machine'` 从初始状态录制指定时长 |
| `position` | `{ x, y, z }` | 预览中的开关坐标，每个分量为绝对值不超过 30,000,000 的整数。门模式必填；机器模式可省略，此时只让机器自行运行 |
| `initialState` | `'open'` 或 `'closed'` | 门在文件中保存时的状态，默认 `'closed'`。用于标记开门和关门的片段 |
| `durationTicks` | 整数 | 机器模式接受 40 至 2400 游戏刻，默认 200 刻。每秒 20 刻，末尾可能额外记录最多 20 刻以等候已开始的活塞运动完成 |
| `title` | `string`，可选 | 回放标题；省略时使用默认标题 |

## 录下示例门的开合

```javascript
const { simulateSwitchReplay } = await import('/sdk/litemora.js')
const response = await fetch('/redstone-archive/single-lever-piston-door-3x3.litematic')
if (!response.ok)
  throw new Error(`读取示例文件失败（HTTP ${response.status}）`)
const buffer = await response.arrayBuffer()
const { packed, control, summary } = await simulateSwitchReplay({
  buffer,
  fileName: 'single-lever-piston-door-3x3.litematic',
  position: { x: 3, y: 1, z: 0 },
  initialState: 'open',
})
console.log(control.segments, summary.totalTicks, summary.changeCount, packed.frameCount)
```

这份原理图得到关门区间 `{ fromTick: 12, toTick: 35 }` 和开门区间 `{ fromTick: 45, toTick: 82 }`。时间线到第 82 刻，共 334 条方块变化，压成 35 帧。有变化或操作的游戏刻才进入回放，所以帧数和游戏刻数可以不同。

## 读取返回值

| 字段 | 如何使用 |
| --- | --- |
| `control` | 门的 `type` 为 `'door'`，带有 `initialState`、`switchPosition`、`mode` 和 `segments`。模式为 `'toggle'` 时读取 `segments.open/close`，为 `'pulse'` 时读取 `segments.pulse`。机器返回 `{ type: 'machine', switchPosition }`，无开关时位置为 `null` |
| `summary` | `totalTicks` 和 `changeCount` 给出模拟时长和变化数。`switchType` 标识触发元件，无开关时为空字符串。`unsupportedBlocks` 按方块名计数，`unsupportedEvents` 列出遇到的未实现行为。另含 `minecraftVersion`、可为空的 `sourceRelease`、`mode`、`normalizedWireConnections` 和门模式的 `segments` |
| `packed` | 可直接读取的回放对象，内含元数据 `meta`、方块状态字符串表 `palette` 和按列存放的数值数组。第 `f` 帧的游戏刻为 `frameTicks[f]`，其变化下标从 `frameChangeStart[f]` 开始，到 `frameChangeStart[f + 1]` 之前结束 |

例如，拿到 `packed` 后，下面的代码读取第一条方块变化的坐标和新状态。多个变化可以共用一个位置，因此要先通过 `changePos` 找位置，再通过 `changeState` 查方块状态表。

```javascript
if (packed.changePos.length > 0) {
  const p = packed.changePos[0]
  const state = packed.palette[packed.changeState[0]]
  console.log(packed.posX[p], packed.posY[p], packed.posZ[p], state)
}
```

## 处理录制失败

Promise 拒绝时，读取异常的 `code` 和 `message`。`missing_source` 表示传入的不是 `ArrayBuffer`，`worker_unavailable` 表示后台线程不可用或未能启动。`invalid_switch` 表示坐标或机器录制时长无效，`not_a_switch` 表示该坐标没有可用的触发元件。门在静置时仍持续运转可能得到 `never_idle`，往返后没有回到原状可能得到 `not_reversible`。文件格式或引擎错误通常为 `simulation_failed`，具体原因见 `message`。
