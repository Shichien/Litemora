# Litemora 浏览器 API

## 按要做的事选择函数

| 想做什么 | 传入 | 得到 |
| --- | --- | --- |
| [一次跑完整段红石动画](./simulation.md) | 给 `sim.runAnimation` 传开关的 `{ x, y, z }`，或省略参数让当前动作继续 | 动画的起止刻、所有中间帧、是否停稳。模拟器保留结束时的世界 |
| [读取原理图统计](./schematic.md) | 给 `inspectSchematic` 传文件的 `ArrayBuffer` | 一个 Promise，结果包含格式、尺寸、非空气方块数和边界 |
| [在后台录制整台机器](./recording.md) | 给 `simulateSwitchReplay` 传文件、开关位置和录制方式 | 一个 Promise，结果包含回放数据、播放区间和统计 |

## 一次关上活塞门

在本手册所在页面打开浏览器开发者工具，把下面这段代码粘贴到控制台。示例读取站内的单拉杆 3×3 活塞门文件；之后的解析和模拟都在浏览器本机完成。

```javascript
const { initRedstoneWasm, RedstoneSim } = await import('/sdk/litemora.js')
await initRedstoneWasm()
const response = await fetch('/redstone-archive/single-lever-piston-door-3x3.litematic')
if (!response.ok)
  throw new Error(`读取示例文件失败（HTTP ${response.status}）`)
const sim = new RedstoneSim(new Uint8Array(await response.arrayBuffer()), 'litematic', false)
try {
  const animation = sim.runAnimation({ x: 3, y: 1, z: 0 })
  console.log(animation.settled, animation.fromTick, animation.toTick, sim.block_at(4, 6, 1))
}
finally {
  sim.free()
}
```

输出为 `true, 0, 33, 'minecraft:quartz_block'`。门洞中央已经被石英块封住。`animation.frames` 保存了从拨杆到门板落位的全过程。释放实例前，再用同一坐标调用一次就能把门打开。详细返回值和可操作的示例见[运行完整动画](./simulation.md)。

## 在自己的网页中使用

1. 在 Litemora 仓库运行 `pnpm install` 和 `pnpm sdk:build`。
2. 将生成的整个 `dist/sdk/` 目录复制到自己网站的 `/sdk/`，保留其中的 `assets/`。里面有配套的 WASM、后台线程脚本和解析器。
3. 在 `<script type="module">` 中用 `import { inspectSchematic } from '/sdk/litemora.js'` 导入需要的函数。通过 HTTP 或 HTTPS 打开页面，确保服务器将 `.wasm` 作为 `application/wasm` 提供。自己的网页与后台线程应当同源。

模块也可以整体放到其他目录，只需改入口的导入路径。示例原理图是 Litemora 站点的资源，自建页面可以使用自己的文件。主站的 `pnpm build` 会同时生成模块和这本手册。
