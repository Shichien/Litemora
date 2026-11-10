# 方块渲染约定

游戏静态原理图、回放运动层和上传预览使用同一方块材质转换。纹理颜色作为 sRGB 解码，在线性空间执行材质计算，再由最终输出编码为 sRGB；不得额外加入 `pow(rgb, 2)` 之类的预览补偿。

默认关闭电影式 ACES 和 Bloom，保留原始像素贴图与透明度。方向面亮度参考 vanilla：顶部 1、底部 0.5、东西面 0.6、南北面 0.8，以世界法线计算，因此转动视角不改变面亮度。已有顶点 tint、alpha test、透明混合和资源包贴图须保留。静态及动态路径共用昼夜亮度，管理预览固定为日光。

当前日夜亮度是近似环境光，**并非完整的 Minecraft 天空光/方块光传播或逐顶点邻居 AO**。不能将方向变暗称为阴影遮挡，也不能声称此实现完全复现原版光照引擎。原版 AO 的参考实现可见 [Fabric Indigo AoCalculator](https://github.com/FabricMC/fabric/blob/1.21.5/fabric-renderer-indigo/src/client/java/net/fabricmc/fabric/impl/client/indigo/renderer/aocalc/AoCalculator.java)。

## 炼药锅兼容

Cubane 1.0.19 把以 `block/water`、`block/lava` 开头的模型误判为流体，导致 `water_cauldron_*`、`lava_cauldron` 跳过父模型解析并变成整格液体。应用层兼容补丁仅将这些炼药锅模型恢复为常规模型父链解析，不修改依赖包，不改变正常水或岩浆模型。静态原理图、回放模板和上传预览均在模型生成前安装补丁。

升级 Cubane 时运行真实资源包回归测试；若上游修复，可以移除兼容补丁。测试须覆盖空锅、水锅三级水位、岩浆锅、细雪锅，以及正常水/岩浆行为保持。
