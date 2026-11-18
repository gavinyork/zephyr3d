# 植被工具

植被节点把树、灌木和岩石散布在地形上。你绘制的是**哪里长东西、长多密**；每个图层的生成规则再把它变成实例。概念与运行时 API 见[植被](zh-cn/foliage.md)。

---

## 创建植被节点

- 主菜单选择 `Add → Foliage`，在地形上放置。植被节点需要放在地形下面：实例的高度取自地形，地形被修改时实例跟着走。
- 在属性面板的 `Layers` 列表里为每种物体添加一项，把预制体或模型（`.zprefab`、`.glb`、`.gltf`、`.fbx`、`.obj`）从资源浏览器拖到它的 `Asset` 上。

---

## 植被笔刷

选中植被节点，点击工具栏中的编辑按钮，打开 `Foliage Brush` 面板：

| 控件 | 作用 |
|---|---|
| `Layer` | 要绘制的图层 |
| `Mode` | `Paint` 提高密度，`Erase` 降低密度。绘制时按住 Shift 也是擦除 |
| `Radius`、`Strength`、`Falloff` | 笔刷大小、密度增长速度、向边缘衰减的柔和程度 |
| `Erase placed instances too` | 擦除时连散布工具直接放置的实例一起擦，越靠近笔刷边缘擦得越稀 |
| `Erase every layer` | 擦除所有图层，例如在混合林里清出一条路 |
| `Regenerate layer` | 修改生成设置后重新生成整个图层 |

拖动鼠标绘制，`[` 和 `]` 调整笔刷大小。面板上会显示绘制出的实例数和直接放置的实例数。

绘制结果是稳定的：加大密度只会长出新的树，不会挪动已有的树；擦掉一片再重新绘制，长回来的还是同样的树。想换一种排布，修改 `Seed` 再重新生成。

---

## 图层设置

**生成**：绘制的副本如何排布。

| 属性 | 作用 |
|---|---|
| `Spacing` | 大约是两个副本最近能靠多近，单位米 |
| `ScaleRange`、`RandomYaw` | 副本之间的变化 |
| `SlopeRange` | 副本只长在这个坡度范围内：0° 为平地，90° 为垂直墙面 |
| `LimitHeight`、`HeightRange` | 副本只长在两个高度之间，例如水位线以上 |
| `YOffset` | 离地高度，负值让根部埋进地里 |
| `Surface` | `Terrain` 跟随地面；`Any surface` 让副本落在下方任何带碰撞体的物体上，包括岩石和建筑 |
| `PlaceScript` | 可选的 `function place(p, api, input)`，决定每个点长出副本的概率，约定与散布工具相同 |

修改这些设置不会移动已有实例，重新生成图层后才生效。

**绘制：**

| 属性 | 作用 |
|---|---|
| `CullDistance` | 超过这个距离的副本消失 |
| `CastShadow` | 小型植物可以关掉，节省阴影渲染时间 |
| `AlignToNormal` | 0 保持直立，1 随坡度倾斜 |
| `FadeDistance` | 副本在这个宽度内以抖动方式过渡，而不是突然出现或消失（仅 WebGPU） |

**Impostor**：远处副本用烘焙卡片绘制。

| 属性 | 作用 |
|---|---|
| `Impostor` | 启用 impostor。勾选时编辑器会烘焙一次，资产变化后会重新烘焙 |
| `ImpostorDistance` | 网格换成卡片的距离 |
| `ImpostorLod` | 烘焙卡片所用的 LOD 级别：选树在 impostor 距离附近显示的那一级 |
| `ForceImpostor`、`ImpostorDebug` | 让所有副本都显示为卡片，或显示某一项烘焙属性，用于检查烘焙结果。不会保存 |

也可以手动烘焙：在资源浏览器中右键点击预制体或模型，选择 `Bake Impostor`。烘焙结果保存在 `/assets/.impostor/` 下，随项目一起发布。

**碰撞**：`CollisionShape` 让副本成为静态物理障碍。省略的尺寸按资产包围盒拟合，而树的包围盒是树冠，所以要把 `CollisionRadius` 设为树干半径。

**系统**：植被节点自身的 `ChunkSize` 是实例分块绘制和剔除的方块大小，`MaskCellSize` 是绘制密度的分辨率。

---

## 道路与植被

贴合地形后的道路会清除沿线的植被（见[编辑道路](zh-cn/editor/road-tools.md)）。

## AI 与脚本

桌面版编辑器的 MCP 服务提供 `foliage_get_info`、`foliage_set_layers`、`foliage_paint`、`foliage_erase`、`foliage_regenerate` 和 `foliage_scatter`，智能体或外部工具可以用它们布置森林。见[桌面版编辑器](zh-cn/editor/desktop.md)。

> 提示：密集森林开销很大。大面积用 impostor 覆盖并设置适中的 `CullDistance`；分批绘制，每批之后保存。
