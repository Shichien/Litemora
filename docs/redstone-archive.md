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
