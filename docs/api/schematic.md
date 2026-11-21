# 读取原理图统计

## inspectSchematic(buffer, fileName?)

读取方块数量、空间范围和文件信息时可以单独调用这个函数。它使用主站的原理图解析器，无需初始化红石 WASM。

| 参数 | 类型 | 传什么 |
| --- | --- | --- |
| `buffer` | `ArrayBuffer`，必填 | 整个原始文件的字节。支持 Litematic、Sponge `.schem`、旧 MCEdit `.schematic` 和 Axiom `.bp`。文件可以保留原始压缩格式 |
| `fileName` | `string`，可选，默认空字符串 | 原文件名。部分格式缺少作品名称时用它取名；格式由内容识别 |

这个函数返回 `Promise<object>`，读取后仍可继续使用同一份 `buffer`。输入类型错误、损坏的文件、无法识别的格式或旧版方块编号都会使 Promise 拒绝。

| 结果字段 | 类型和含义 |
| --- | --- |
| `format`、`dataVersion` | 格式标识 `litematic`、`schem`、`schematic` 或 `bp`；解析得到的 Minecraft 数据版本号，缺失时为 `null` |
| `name`、`author` | 作品名和作者字符串 |
| `size` | `{ x, y, z }`，分别为沿 X、Y、Z 轴的尺寸，单位为方块 |
| `regionCount`、`blockCount` | 区域个数，以及各区域非空气方块数的合计 |
| `bounds` | 非空气方块的最小和最大坐标，字段为 `minX/minY/minZ/maxX/maxY/maxZ`，包含两端。空结构的六个值均为 `null` |
| `yStats` | `minY`、`maxY` 为非空气方块的最低和最高坐标，空结构时为 `null`；`hasBlocksBelowZero` 和 `blocksBelowZero` 给出 Y 小于 0 的方块是否存在以及数量 |

例如，对单拉杆 3×3 活塞门的原始文件运行 `await inspectSchematic(buffer)`，部分输出如下。

```json
{
  "format": "litematic",
  "dataVersion": 4790,
  "size": { "x": 10, "y": 10, "z": 2 },
  "regionCount": 1,
  "blockCount": 80,
  "bounds": { "minX": 0, "minY": 0, "minZ": 0, "maxX": 9, "maxY": 9, "maxZ": 1 }
}
```
