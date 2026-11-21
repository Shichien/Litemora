# 红石档案回放

Litemora 使用 redstone-rs 负责确定性红石模拟，浏览器继续使用现有原理图渲染、人物移动、碰撞和方块查看能力。

也可以在管理页直接导入 ReplayMod 原始 `.mcpr` 录像，播放录制中的方块与实体变化。支持版本、上传方式和画面范围见 [ReplayMod 原始录像播放](replaymod.md)。

## 数据链路

1. redstone-rs 读取场景和 Litematic，运行 Java 版红石规则并输出逐事件轨迹。
2. `scripts/generate-redstone-archive-replay.mjs` 读取初始结构、轨迹和对应版本的官方方块状态表。
3. 转换结果只保留初始状态、实际发生变化的方块和场景动作，写成 `litemora-redstone-replay-v1`。
4. 投影世界通过 `settings.redstoneArchive.replayUrl` 载入回放，时间线控制器把每刻变化批量写入现有运行时原理图。

## 生成官方状态表

Minecraft 26.1.2 的数据生成器需要 Java 25 或更新版本。

```powershell
pnpm redstone:registry -- --version 26.1.2 --output output/redstone-registry/26.1.2 --java D:\path\to\java.exe
```

生成结果位于 `output/redstone-registry/26.1.2/reports/blocks.json`。

## 生成回放

```powershell
pnpm redstone:replay -- `
  --redstone C:\path\to\redstone.exe `
  --scenario C:\path\to\scenario.toml `
  --structure C:\path\to\machine.litematic `
  --registry output\redstone-registry\26.1.2\reports\blocks.json `
  --output public\redstone-archive\machine.replay.json.gz `
  --minecraft-version 26.1.2 `
  --title 作品名称
```

输出路径以 `.gz` 结尾时，转换器写出 gzip 压缩文件，浏览器按文件头自动解压。Cloudflare Pages 单个静态文件上限为 25 MiB，长回放必须使用压缩格式。未压缩的 `.replay.json` 仍可正常载入。

场景和结构必须描述同一个初始世界。转换器会校验回放中出现的每个状态编号，版本不匹配时直接失败。

转换器会在场景设定的 `max_ticks` 之后继续模拟一小段尾部，只等待截止时已经开始运动的活塞写出真实稳定状态，之后新启动的周期不会混入回放。这样连续运行的飞行器也能在完整运动边界封口，不会由浏览器猜测缺失终态；若持续扩展仍找不到完整边界，生成会明确失败。

## 投影配置

在投影的世界设置中填写回放文件地址，例如：

```json
{
  "player": {
    "spawnPoint": { "x": 4, "y": 2, "z": -8 },
    "view": { "yaw": 180, "pitch": -10 }
  },
  "settings": {
    "redstoneArchive": {
      "replayUrl": "/redstone-archive/machine.replay.json.gz"
    }
  }
}
```

`player.view` 使用角度制。`yaw` 控制水平朝向，`pitch` 控制上下视角，负值向下看。这样每个馆藏可以把初始画面稳定对准结构，同时仍允许访客进入后自由转动和漫游。

进入已配置回放的投影后，底部面板明确标为「预计算红石回放」。点击「一键运行」从第 0 刻重新播放完整流程，K 播放 / 暂停；仍可逐刻前后、倍速和拖动跳转。预计算回放不会在浏览器里重新计算电路；没有配置回放、也没有配置机器或开关（见下文「上传原理图并运行红石」）的普通原理图不会出现这个面板。

展开「真实开关」可查看拉杆 / 按钮数量与世界坐标（已加投影放置偏移）。仅列出时间线动作目标中，初始状态确为 `minecraft:lever` 或 `minecraft:*_button` 的位置。动作目标也含 `set_block`，例如飞行器脚本放置方块的位置不是拉杆。走近登记的真实开关并右键，可重播完整流程；面板不传送玩家。

### 单开关门的已验证正向片段

可选的投影条目字段 `redstoneControl` 指定真实回放内的稳定开 / 关段，不能凭视觉猜测端点。当前已验证的 3×3 门使用下面配置（开关坐标是回放局部坐标）：

```json
{
  "redstoneControl": {
    "type": "door",
    "switchPosition": { "x": 3, "y": 1, "z": 0 },
    "initialState": "open",
    "segments": {
      "close": { "fromTick": 99, "toTick": 122 },
      "open": { "fromTick": 499, "toTick": 536 }
    }
  }
}
```

这两个方向都来自 Rust 的正向模拟轨迹。面板显示「关门 / 开门」，右键登记的门拉杆执行相同操作；到第 122 / 536 刻暂停保持，下一次操作从对应片段开始，不倒放动画。运行中的重复开关被忽略；K 可暂停与续播。拖动到其他进度会标记「自定义进度」，先点「恢复初始状态」再操作。无效元数据（非拉杆位置、越界或倒序片段）不会启用门模式。

## 上传原理图并运行红石

在创建投影的预览里选择红石模拟模式。

- **开关门**适合能复位的机关。点击标记开关，再双击原理图中的输入元件。
- **运行机器**适合时钟、飞行器、合成、装盒或一次性机关。选择 10、30、60 或 120 秒，标记输入元件，或点击从原始状态启动。进入投影后，点击一键运行即可播放。同一段可以反复播放，每次都从上传时的状态开始。

标靶的标记动作是箭中靶心，感测体是脚步，避雷针是雷击。元件也会响应电路本身的动作，例如发射器的箭可以命中远处的标靶。各模块及已验证的用途见[红石元件支持表](./redstone-components.md)。

门在条目中保存开关的局部坐标和初始门状态。

```json
{
  "redstoneSwitch": {
    "position": { "x": 3, "y": 1, "z": 0 },
    "initialState": "open"
  }
}
```

机器模式保存 `recording: "machine"`，从原始状态启动时 `position` 为 `null`。非默认时长保存在 `durationTicks`，每秒 20 游戏刻。访客进入投影后用浏览器里的 redstone-rs 模拟原文件。门模式还会检查以下步骤。

1. 刷新新导入结构的初始红石状态，保留初始化产生的变化，再空跑到机器停稳。停稳检查同时观察方块与容器等辅助状态，记下方块、规范化容器库存、实体与比较器实际输出的指纹。
2. 操作一次开关，跑到再次停稳。指纹回到起点的是**脉冲**（一段，播完自动复位）；没回到起点就再操作一次，这次回到起点的是**开 / 关**（两段，按钮也可能控制这种门）。旧格式转换有时缺少红石线连接信息；只有往返差异完全限于红石线的四个连接方向、所有电量与门板位置都恢复、容器等辅助状态也未变化时，才丢弃这次预热、从稳定状态重新录制一次，仍要求完整指纹精确往返。
3. 检查存在开关以外的门板或活塞运动；只亮红石线或只有开关自身动作会被拒绝。往返检查没有门洞范围信息，不能证明门洞完全打开，上传者仍需进入投影检查。
4. 结果转成 `litemora-redstone-replay-v1` 和一份等价于 `redstoneControl` 的门控制，交给同一个时间线控制器播放。面板标为「浏览器内红石模拟」。

压力板按「踩上去，等机器停稳，再离开」模拟。

门模式标记时会当场跑一遍同样的模拟，下面这些情况不会记录开关，并说明原因：选中的方块没有可模拟的输入动作、不操作时机器也停不下来（时钟电路）、操作后 2400 刻内停不下来、操作开关没有任何反应、只有开关/接线变化而没有门板运动、操作两次后回不到初始状态。

动态门板使用独立的逻辑方块覆盖层参与单点与批量碰撞查询；开门、关门、跳转和重置会同步碰撞状态。活塞动画使用终态体素形状，不模拟移动过程中的连续碰撞或推玩家。

限制：

- 浏览器采用 Java 26.1.2 的红石规则。26.2 和 26.3 正式版的原理图（DataVersion 4903 和 5023）也能导入，上传试运行会显示原理图版本和模拟规则版本。其他高于 4790 的数据版本尚未验证。
- 只支持 `.litematic` 和 `.schem`，旧版 `.schematic` 不支持。文件中缺省的方块属性按官方默认值补齐，非法属性值和未知方块仍然报错。未压缩的 NBT 在传给预览和世界渲染器时包装为 gzip；源文件、NBT 内容和版本号保持不变，模拟的版本检查仍然生效。
- 开关动作能往返不等于门洞完全让开：电路内部的活塞也可能往返，而门板不动。上传者需检查实际门洞；只有开关坐标无法自动判定门洞范围。
- 门板碰撞随播放同步；移动活塞不会推玩家。
- 灵魂沙和岩浆块能在连续水源中形成气泡柱，盔甲架会随柱上升或下沉。水平水流传播、生物生成和作物生长尚未模拟。红石矿石支持亮起后由随机刻熄灭。
- 上传试运行会列出模拟器报告的未知行为。回放只呈现方块和活塞变化，依赖实体画面的机构可用探测铁轨、压力板或红石灯观察输出。
- 原理图中的容器物品会导入并参与模拟；没有保存物品的文件无法恢复原作者的库存。库存检查使用模拟器规范化后的有效字段，不能只看载入时保留的原始 `Items`。
- 初始刷新可能修正文件中已经失效的红石状态，甚至使活塞先移动；初始门状态仍需上传者实看确认。Litematic 的 `PendingBlockTicks` / `PendingFluidTicks` 未恢复，不能精确续接运行中保存的世界。
- 往返指纹包含方块、容器、实体与比较器输出，不包含全部私有调度状态或随机数状态，不能当作原版 Minecraft 全状态等价证明。
- 连续飞行器适合运行机器模式。选择真实启动开关，或从文件保存的状态启动。到达所选时长时，已开始的活塞运动会继续到落位。
- 模拟的是原理图源文件；访客之后在世界里改动的方块不参与模拟。
- 条目同时配置了预计算回放时，使用预计算回放，不做模拟。

WASM 文件按需在后台线程加载，静态投影无需下载。

### 重新构建 WASM

下面的 PowerShell 命令从 Litemora 根目录运行。将 `$engine` 指向干净的 redstone-rs v0.2.0 检出，将 `$client` 指向 Java 26.1.2 官方客户端 JAR。配方、碰撞和爆炸抗性由固定版本的数据生成。需要 Python 3.9 或更高版本、Rust 的 `wasm32-unknown-unknown` 目标、wasm-bindgen-cli 0.2.126，以及本项目的 pnpm 依赖。

```powershell
$engine = (Resolve-Path ../redstone-rs).Path
$client = (Resolve-Path ../client-26.1.2.jar).Path
$patches = (Resolve-Path scripts/redstone-wasm).Path
$data = Join-Path $engine 'crates/redstone-java-26/data/26.1.2'
foreach ($patch in @('redstone-rs-v0.2.0-wasm.patch', 'shulker-lifecycle.patch', 'rail-scheduled-updates.patch', 'redstone-components.patch', 'redstone-entity-devices.patch')) {
    git -C $engine apply --whitespace=nowarn (Join-Path $patches $patch)
    if ($LASTEXITCODE -ne 0) { throw "git apply failed for $patch" }
}
Copy-Item -Recurse -LiteralPath "$patches/crate" -Destination "$engine/crates/redstone-wasm"
pnpm redstone:registry --version 26.1.2
$reports = (Resolve-Path output/redstone-registry/26.1.2/reports).Path
New-Item -Force -ItemType Directory "$data/reports/minecraft/components" | Out-Null
Copy-Item -Recurse -LiteralPath "$reports/minecraft/components/item" -Destination "$data/reports/minecraft/components"
python scripts/redstone-wasm/crafting-data.py $client "$data/crafting.json"
python scripts/redstone-wasm/physics-data.py "$reports/blocks.json" "$data/physics.json"
cargo build --manifest-path "$engine/Cargo.toml" -p redstone-wasm --release --target wasm32-unknown-unknown
wasm-bindgen "$engine/target/wasm32-unknown-unknown/release/redstone_wasm.wasm" --target web --no-typescript --out-dir src/js/world/redstone-sim/pkg
```

补齐默认资源包中的陈列架、各氧化程度的避雷针和铜箱模型，可执行 `python scripts/redstone-wasm/component-assets.py $client public`。两个数据生成器、模型来源和复现实验都对应 26.1.2。

要单独验证矿车和盔甲架，在按上面步骤准备好的 redstone-rs 源码目录运行 `cargo test -p redstone-java-26 --test suite entity_devices`。这些用例直接运行 Rust 引擎，检查货车到站、盔甲架触线、气泡柱升降和探测铁轨读数。

## 红石门

`scripts/generate-redstone-door-litematics.mjs` 一次生成一批可点击开合的红石门，包含结构和场景；`scripts/verify-redstone-doors.mjs` 在回放上逐刻重放，校验门洞确实打开再封上；`scripts/verify-door-click-targets.mjs` 确认每个可点目标都落在真实的拉杆方块上；`scripts/install-redstone-doors.mjs` 把结果装进 `public/redstone-archive`、dev gallery 和投影世界配置。

```powershell
pnpm redstone:doors           # 生成结构与场景
pnpm redstone:doors:verify    # 逐刻校验门洞开合
pnpm redstone:doors:install   # 装进站点
```

目前提供两种结构：

- **回拉式活塞门**（`piston-pull-door-2x2` / `2x3` / `2x4`）：门口左右各一台粘性活塞，初始伸出顶着门板。拨动拉杆断电后活塞收回，把门板拉进侧墙暗格，门口整片让开。
- **地面闸门**（`piston-lift-gate-3` / `piston-lift-gate-5`）：门洞正上方一排朝下的粘性活塞，把门板压在地面那格。拨动拉杆后活塞收回，门板被提上去一格，通道让开。

这些旧门示例由场景脚本按时间操作多个拉杆，演示完整开合序列，并不是玩家只拨一次总开关就能驱动的单开关电路。右键任一登记拉杆重播整段脚本，不等于独立控制该活塞。

旧地面闸门示例的门板只上下移动一格，所以该结构的净通道高度为 1 格；这不是“活塞只能带动一格”的通用规则。红石粉和中继器可以为活塞供电，是否触发取决于供电方向、连接、方块更新与具体布局；此前“红石粉指向活塞或中继器对准活塞都不会供电”的说法错误。旧生成器采用拉杆直接供电，是该示例的布局选择，不能据此断言其他供电方式无效。
