# 原理图三维模型导出

在空间的创建投影页面上传原理图，等待真实模型预览完成，预览下方的「导出三维模型」可以选择格式、设置缩放并下载。输入沿用现有解析器支持的 `.litematic`、`.schem`、`.schematic` 和 `.bp`，不包含 ReplayMod 录像动画。

| 选项 | 下载内容 | 特点 |
| --- | --- | --- |
| GLB | `.glb` | 推荐。单文件包含网格、UV、贴图及标准材质，Blender 可直接导入。默认一个方块为一米，支持缩放。 |
| STL | 二进制 `.stl` | 三角网格，不包含贴图/颜色。Z 轴向上，数值按毫米解释时，缩放值就是每方块毫米数。 |
| OBJ | `.obj` | 几何、UV、法线，不附带 MTL 和贴图。需要材质请选 GLB。 |
| Blender 转换包 | `.zip` | GLB、Python 转换脚本与操作说明；用本机 Blender 生成真正的 `.blend`。 |

导出的是整个已加载的原理图模型，不是画面截图；模型会在 X/Z 方向居中、底部落在零高度。导出使用独立快照，不会移动预览建筑。自定义渲染器的光照、屏幕效果、交互逻辑与红石动画不写入模型。

## Blender

浏览器没有原生 Blender，当前 Cloudflare Pages Functions 也不能启动 Blender 进程，因此界面明确提供 **Blender 转换包**，而不是声称直接生成 `.blend`。

解压 ZIP 后，按内附 README 的命令用本机 Blender 执行转换脚本。脚本导入 GLB、打包资源并保存为 `.blend`。也可在 Blender 中选择「文件 → 导入 → glTF 2.0」，导入 GLB 后保存工程。

若产品未来需要网页点击后直接下载 `.blend`，需独立部署安装 Blender 的转换服务，再接入任务队列、大小限制和结果下载；普通 Pages Functions 无法承担原生 Blender 转换。

## 打印与大模型

STL 导出不会自动执行实体布尔合并或网格修复。Minecraft 的树叶、玻璃、植物、栅栏与悬空结构可能不适合直接打印；在切片软件中检查非封闭表面、薄面、孤立组件与尺寸。导出器有模型规模限制，超出时会提示缩小原理图；实例展开会增加内存占用。STL 的标准格式没有材质槽、颜色或贴图，无法通过普通 STL 文件可靠携带材质；需要保留材质时应选 GLB 或 Blender 转换包。

GLB/Blender 包含当前资源包的贴图，分享这些模型时应遵循对应资源包的使用许可。

## 开源方案依据

- [Three.js r176 GLTFExporter](https://github.com/mrdoob/three.js/blob/r176/examples/jsm/exporters/GLTFExporter.js)、[STLExporter](https://github.com/mrdoob/three.js/blob/r176/examples/jsm/exporters/STLExporter.js)、[OBJExporter](https://github.com/mrdoob/three.js/blob/r176/examples/jsm/exporters/OBJExporter.js)：沿用项目的 Three.js，MIT 许可；STL/OBJ 需要先展开实例矩阵，避免遗漏复用方块。
- [Blender](https://www.blender.org/)：[glTF 导入 API](https://docs.blender.org/api/current/bpy.ops.import_scene.html)、[保存工程 API](https://docs.blender.org/api/current/bpy.ops.wm.html#bpy.ops.wm.save_as_mainfile)，通过原生程序生成 `.blend`。
- [Mineways](https://github.com/erich666/Mineways)：Minecraft 模型导出与打印的成熟桌面参考项目。本项目复用现有浏览器模型，不引入另一套地图解析流程。
- [Cubane](https://github.com/Schem-at/Cubane) 与 [schematic-renderer](https://github.com/Schem-at/schematic-renderer)：现有方块模型和原理图渲染基础，未因导出功能升级依赖版本。
- [Cloudflare Workers Node.js 支持说明](https://developers.cloudflare.com/workers/runtime-apis/nodejs/#non-functional-stub-modules)：`child_process` 为无功能占位模块，不能直接运行 Blender。
