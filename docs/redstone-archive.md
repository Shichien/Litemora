# 红石档案回放

Litemora 使用 redstone-rs 负责确定性红石模拟，浏览器继续使用现有原理图渲染、人物移动、碰撞和方块查看能力。

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

进入已配置回放的投影后，底部面板明确标为「预计算红石回放」。点击「一键运行」从第 0 刻重新播放完整流程，K 播放 / 暂停；仍可逐刻前后、倍速和拖动跳转。这不是浏览器实时红石引擎，未配置回放的普通原理图不会出现或承诺此启动功能。

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
