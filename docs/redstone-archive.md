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

进入投影后，底部时间线支持播放、暂停、逐刻前后移动、倍速和拖动跳转。右键点击回放场景中登记过的按钮或拉杆，会从初始状态播放完整流程。

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

单台活塞只能带动一格，所以闸门高度固定为 1 格；要更高的门口需要用回拉式活塞门。拉杆直接贴在活塞背面，这也是经过验证的供电方式——红石粉指向活塞、或中继器对准活塞都不会给活塞供电。
