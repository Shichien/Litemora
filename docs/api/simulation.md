# 运行完整的红石动画

## 关门，再开门

下方九格是示例活塞门的正面门洞。每次点击都在同一个 WASM 模拟器上运行一次完整操作，再按每秒 20 游戏刻播放返回的变化。

```{iframe} /docs/api/door-demo.html
:width: 100%
```

## 在代码中调用

```javascript
const { initRedstoneWasm, RedstoneSim } = await import('/sdk/litemora.js')
await initRedstoneWasm()
const response = await fetch('/redstone-archive/single-lever-piston-door-3x3.litematic')
if (!response.ok)
  throw new Error(`读取示例文件失败（HTTP ${response.status}）`)
const sim = new RedstoneSim(new Uint8Array(await response.arrayBuffer()), 'litematic', false)
try {
  const lever = { x: 3, y: 1, z: 0 }
  const close = sim.runAnimation(lever)
  console.log(close.settled, close.fromTick, close.toTick, sim.block_at(4, 6, 1))
  const open = sim.runAnimation(lever)
  console.log(open.settled, open.fromTick, open.toTick, sim.block_at(4, 6, 1))
}
finally {
  sim.free()
}
```

第一次调用从第 0 刻推进到第 33 刻，门洞中央变成 `minecraft:quartz_block`。第二次从第 33 刻推进到第 80 刻，中央恢复为 `minecraft:air`。两次的 `settled` 均为 `true`。

## runAnimation(position?)

传入模拟器坐标 `{ x, y, z }`，三个分量均为有符号 32 位整数。函数识别该处的输入元件并触发一次；按钮会经历按下和弹起，压力板会经历踩下和离开。省略参数时只推进当前世界，适合让已经触发的动作继续运行。第一次调用会自动初始化结构。

同步返回普通对象，可以直接读取以下字段。

| 字段 | 含义 |
| --- | --- |
| `fromTick`、`toTick` | 调用前后的绝对游戏刻。返回时实例已经处于 `toTick` 的状态，可以读取方块或触发下一个动作 |
| `frames` | 按时间排列的帧数组，保留每个游戏刻，包括没有变化的刻。首次初始化还会包含起始刻的初始变化。播放时，第 `frame.tick` 刻的变化应在开始后 `(frame.tick - fromTick) * 50` 毫秒应用 |
| `settled` | 连续 12 刻方块与辅助状态都保持稳定，并且待执行的计划刻和振动队列已清空时为 `true`。辅助状态包括容器、实体与比较器输出。结尾包含用于确认停稳的空帧 |

每个等待阶段最多推进 2400 刻。持续运转的机器达到上限会返回 `settled: false`，已经计算的帧和模拟器的当前位置仍可使用。需要接着算时调用 `sim.runAnimation()`；需要运行指定时长时用[后台机器录制](./recording.md)。坐标格式错误或该处没有可触发元件会在推进前抛出异常，错误码分别为 `invalid_switch` 和 `not_a_switch`。

例如，关门动画在第 1 刻返回了下面这条变化。后续帧还包含活塞和门板的移动。

```json
{
  "x": 3,
  "y": 1,
  "z": 0,
  "previousState": "minecraft:lever[face=wall,facing=north,powered=true]",
  "state": "minecraft:lever[face=wall,facing=north,powered=false]",
  "microStep": 2,
  "cause": "lever_use"
}
```

## 创建与释放

| 调用 | 输入 | 输出及作用 |
| --- | --- | --- |
| `await initRedstoneWasm()` | 默认从模块配套的资源目录加载。也可传 `{ module_or_path: bytes }` 指定 WASM 的二进制内容 | Promise 完成后得到底层 WASM 导出对象，此时即可创建实例。同一页面初始化一次即可 |
| `new RedstoneSim(bytes, format, strict)` | `bytes` 是原理图文件的 `Uint8Array`。`format` 传 `'litematic'`、`'schem'` 或原版结构 `'nbt'`。`strict` 为布尔值 | 同步返回独立模拟实例，初始游戏刻为 0。`true` 会对不支持的主动行为报错；`false` 允许已识别但未实现主动行为的方块留在结构中。损坏的文件或无法识别的方块状态仍会抛错 |
| `sim.free()` | 无参数 | 返回 `undefined`，释放该实例占用的 WASM 内存。用 `finally` 保证只释放一次，随后停止使用该实例 |

## 查询状态与手动步进

下表中标注为 JSON 的返回值都是 **JavaScript 字符串**，请用 `JSON.parse(...)` 取得数组或对象。`block_at` 和两个指纹方法返回的字符串可以直接使用。

| 调用 | 输入 | 输出 |
| --- | --- | --- |
| `sim.info()` | 无 | JSON 对象。含当前 `tick`、非空气方块数 `blocks`、数据版本 `dataVersion`、识别出的兼容发行版 `sourceRelease`（可为 `null`）、坐标三元组 `min/max/regionMin`，以及按方块名计数的 `unsupported` |
| `sim.blocks()` | 无 | JSON 数组。每个非空气方块占一行 `[x, y, z, state]` |
| `sim.block_at(x, y, z)` | 三个有符号 32 位整数，单位为方块 | 完整方块状态字符串；空位置为 `minecraft:air` |
| `sim.initialize()` | 无 | 初次调用返回当前刻的 JSON 帧数组，刷新刚导入的电路但不推进时间。重复调用得到 `[]`。从原始结构重建回放时要应用初次返回的变化 |
| `sim.interact(x, y, z, kind)` | 模拟器坐标和一个动作字符串，见下表 | 执行动作并推进 **1 个游戏刻**，返回恰好一帧的 JSON 数组 |
| `sim.step(ticks)` | 非负的 32 位整数，表示要推进多少游戏刻 | 同步返回长度为 `ticks` 的 JSON 帧数组；`step(0)` 返回 `[]`。每刻都产生一帧，即使其中没有方块变化 |
| `sim.tick()` | 无 | 当前游戏刻，类型为 `number` |
| `sim.fingerprint()`、`sim.auxiliary_fingerprint()` | 无 | 用于比较可观察状态的字符串。前者包含方块及辅助状态，后者只考虑容器、实体、比较器输出等辅助状态。计划刻队列和随机数等不会完整计入 |

坐标采用结构导入模拟器后的坐标。`.schem` 文件可能保存了偏移；从预览的局部坐标调用底层方法时，请逐轴加上 `JSON.parse(sim.info()).regionMin`。[后台录制接口](./recording.md)已经完成这项换算。

## 交互动作

| `kind` | 传入的坐标表示什么 |
| --- | --- |
| `'lever'`、`'button'`、`'use'` | 对该位置拉动拉杆、按下按钮或使用方块 |
| `'target'` | 箭命中标靶上表面的中心 |
| `'step'`、`'lightning'` | 踩踏该方块，或使避雷针受到雷击 |
| `'plate_on'`、`'cart_on'` | 在该位置放入一个用于模拟触发的玩家或矿车 |
| `'plate_off'` | 移走上述占位实体。传入原触发位置即可，同一实例一次使用一个占位实体 |

## 每一帧的字段

| 字段 | 类型和含义 |
| --- | --- |
| `tick` | 游戏刻编号 |
| `changes` | 数组。每条变化含整数 `x/y/z`、旧状态 `previousState`、新状态 `state`、同一刻内的步骤 `microStep` 和原因字符串 `cause` |
| `unsupported` | 数组。每项含 `x/y/z` 和 `behavior`，记录这一刻触发但引擎未实现的行为 |
| `pendingScheduledTicks` | 仍待执行的计划刻与振动事件数量 |

无法加载 WASM 时初始化 Promise 会拒绝；遇到不支持的格式、动作或模拟错误时，构造函数或相应的实例方法会同步抛出异常。长时间模拟可以在 Worker 中运行，或直接调用后台录制接口。
