# 单拉杆 3×3 活塞门

作者：azazo1。来源：[redstone-rs v0.2.0](https://github.com/azazo1/redstone-rs/tree/v0.2.0/assets/schematics)，固定提交 `f073894710be4d898418e39de151603b3c02e388`。上游 Cargo 元数据声明 MIT；该版本没有独立 LICENSE 文件或原理图专属许可说明。保留上游归属，不将此第三方结构重新许可为 AGPL。

原始 NBT 与 Litematic 均从上游下载，来源 URL、校验和和许可证据见 [provenance](./single-lever-piston-door-3x3.provenance.json)。本站提供的 Litematic 由同一上游 NBT 使用 redstone-rs 转换，以保证结构与模拟初态一致；方块状态与原 NBT 相同，3 个方块实体补有格式所需的坐标字段。

## 使用

进入 `/redstonearchive/worlds/singleleverpistondoor3x3`。初始门已打开；点击面板的“关门”关闭并保持，再点“开门”打开并保持。唯一拉杆世界坐标为 **(3, 1, 0)**，也可靠近右键操作。门洞九格位于 x=3..5、y=5..7、z=1。F 切换飞行；这是悬空薄片机器，未额外搭建行走平台。

这是实际红石模拟所得的分段回放，不是浏览器实时求解任意改装电路。关闭播放 tick 99→122，打开播放 499→536；运动完成后停住。K 用于播放/暂停。

## 文件与验证

- [结构](./single-lever-piston-door-3x3.litematic)
- [1200 tick 回放](./single-lever-piston-door-3x3.replay.json.gz)
- [单拉杆场景及 70 项断言](./single-lever-piston-door-3x3.toml)
- [验证结果](./single-lever-piston-door-3x3.validation.json)

Java 26.1.2；仅对同一拉杆在 tick100/500/900 发送 pull_lever。已验证关→开→关，以及中间长时间保持状态。每个操作段的起止点均没有尚未完成运动的活塞。下载结构与场景到同一目录后可运行：

```sh
redstone test single-lever-piston-door-3x3.toml --engine interpreted
```
