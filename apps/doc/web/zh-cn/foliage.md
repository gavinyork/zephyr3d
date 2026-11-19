# 植被

`FoliageSystem` 把预制体或模型（树、灌木、岩石）的大量副本散布在地形上，并以实例化批次绘制。每个实例只保存地面上的位置、旋转和缩放，因此几万棵树也占用很少内存；地形被修改时，实例会跟着地面走。远处的实例可以换成烘焙好的 impostor 卡片，树叶可以透出背后的阳光。

草是另一套系统，归地形自己管理，见[运行时地形](zh-cn/terrain-runtime.md#草地)。有真实网格的物体用植被，大片地被用草。

> 本页代码取自下方嵌入的可运行示例（`tut-91`），省略了 import 与应用初始化；「碰撞」一节的代码为片段示意。

## 用代码创建植被

<div class="showcase" case="tut-91"></div>

示例在程序生成的地形上散布松树，成片的树林之间有空地，陡坡上不长树。滑块调节树的数量、剔除距离和淡入淡出带宽，复选框开关树的阴影；滑块松开后才生效。把视角转到太阳在树后的方向，可以看到树冠透亮。

植被系统是一个场景节点，放在 `ClipmapTerrain` 下面。每个图层散布一种资产，用它在 [VFS](zh-cn/vfs.md) 中的路径指定：

<<< @/../src/tut-91/main.js#foliage

`FoliageSystem` 和 `FOLIAGE_INSTANCE_STRIDE` 来自 `@zephyr3d/scene`。`TREE_PREFAB` 是 `/assets/pine/pine.zprefab`，由示例自己写出（见下文）。`addLayer` 返回新图层的索引，植被系统的其他方法都用这个索引指定图层。资产可以是预制体（`.zprefab`），也可以是 `.glb` 等模型文件。图层自己异步加载资产，加载完成后树才出现。资产中的每个网格都会为每个实例绘制一份，保持它相对资产根节点的位置。

实例用 `setInstances` 放置，每个实例 `FOLIAGE_INSTANCE_STRIDE`（5）个浮点数。`forestDensity` 是示例里的噪声函数，取值 0 到 1，在陡坡和空地处较低；`PRNG` 是 `@zephyr3d/base` 中带种子的随机数生成器：

<<< @/../src/tut-91/main.js#scatter

| 浮点数 | 含义 |
| --- | --- |
| 0、1 | x 和 z，位于植被系统的局部空间 |
| 2 | 离地高度，负值让实例下沉 |
| 3 | 绕竖直轴的旋转（弧度） |
| 4 | 统一缩放 |

`setInstances` 替换图层中放置的实例（`'manual'` 分组，见下文），`addInstances` 在其后追加。位置在植被系统的局部空间里，植被系统只应平移，不应旋转或缩放。实例的高度从它所在的地形读取；没有地形祖先时，离地高度就是高度本身。

实例按边长 `chunkSize`（默认 64 米）的方块分块绘制。每块是一个按需构建的 [BatchGroup](zh-cn/instancing-intro.md)，修改某个区域的实例只会重建它覆盖到的块。块越小剔除越精细，块越大绘制批次越少。

### 示例中的树资产

在项目里，资产来自编辑器：导入的模型，或由模型保存的预制体。示例没有资产文件，所以用形状拼出一棵树，保存为预制体，写进一个内存文件系统，并把这个文件系统设为引擎的 VFS：

<<< @/../src/tut-91/main.js#vfs

<<< @/../src/tut-91/main.js#prefab

`MemoryFS` 来自 `@zephyr3d/base`。预制体中的网格通过资产路径引用自己的图元和材质。所以先把形状和材质写成文件，格式是编辑器保存 `.zmsh` 和 `.zmtl` 时用的 `{ type: 'Default', data }`，并用 `setAssetId` 记下各自的路径；然后把节点树序列化成预制体格式 `{ type: 'SceneNode', data }`（见[序列化](zh-cn/serialization.md)）。没有资产路径的形状或材质不会写进预制体，用到它的网格加载后缺少图元或材质，会被图层跳过。

地形高度用 `setHeights` 设置：

<<< @/../src/tut-91/main.js#heights

植被系统从地形在 CPU 上的高度副本 `terrain.heightData` 读取高度。`setHeights` 接收半精度浮点数（`float2half` 来自 `@zephyr3d/base`），上传高度的同时保留这份副本，所以树能立即放到地面上（见下文「限制与坑」）。

## 绘制的实例与放置的实例

一个图层有两组实例：

| 分组 | 来源 | 由什么改变 |
| --- | --- | --- |
| 生成（绘制）的实例 | 图层的密度遮罩与 `generation` 设置 | 编辑器里的绘制、擦除、重新生成 |
| 手动（放置）的实例 | `setInstances` / `addInstances`，或编辑器的散布工具 | 实例方法与擦除 |

绘制的实例来自间距为 `generation.spacing` 的候选网格：每个候选点在格内随机偏移，并带有阈值、旋转和缩放，这些随机数只由所在格和 `generation.seed` 决定。某处绘制的密度高于候选点的阈值，且坡度和高度过滤都通过，该候选点就成为实例。所以加大密度只会增加新的树，不会挪动已有的树；同一张遮罩永远得到同一片森林。

生成在编辑器里进行（见[植被工具](zh-cn/editor/foliage-tools.md)），生成的实例随场景保存。运行时用代码放置实例走手动分组。`paintMask` 和 `fillMaskCircle` 只修改密度遮罩，本身不生成实例。

主要的 `generation` 设置：

| 设置 | 作用 |
| --- | --- |
| `spacing` | 大约是两个实例最近能靠多近。越小越密，实例也越多 |
| `scaleRange`、`randomYaw` | 副本之间的变化 |
| `slopeRange`、`heightRange` | 让树不长在悬崖上，或只长在水位线以上 |
| `surface` | `'terrain'` 跟随地面；`'any'` 落在下方任何带碰撞体的物体上（岩石、建筑），并保持那个高度 |
| `placeScript` | 可选的 `function place(p, api, input)`，决定每个候选点长出副本的概率 |

`alignToNormal` 让实例随坡度倾斜：0 让树保持直立，1 适合要贴地躺着的岩石。

## 距离：剔除、impostor 与淡入淡出

每个图层在 `cullDistance`（默认 300 米）之外不再绘制。在这个距离以内，`impostor` 会把远处的实例换成**八面体 impostor**：一张朝向相机的卡片，显示从多个方向烘焙的资产外观，带深度和法线，因此光照与网格一致。成片的 impostor 只有网格开销的零头，而网格留在最需要的近处。

| 设置 | 作用 |
| --- | --- |
| `impostorDistance` | 网格换成卡片的距离（默认 80 米）。越近绘制的网格越少，但切换越容易被看出来 |
| `impostorLod` | 烘焙卡片所用的 LOD 级别。选网格在 `impostorDistance` 附近显示的那一级，切换前后外观才一致 |
| `fadeDistance` | 实例以抖动方式过渡的带宽，作用于 impostor 切换处和剔除距离处（默认 10 米，0 表示立即切换）。阴影一起淡入淡出 |

impostor 由编辑器烘焙到 `/assets/.impostor/`，每个资产、每个 LOD 级别一个目录，随项目一起发布。还没有烘焙 impostor 的图层在任何距离都绘制网格。检查烘焙结果时，`forceImpostor` 让所有实例（包括近处）都显示为卡片，`impostorDebug` 显示某一项烘焙属性而不是光照后的颜色。

示例没有烘焙好的 impostor，所以只用到 `cullDistance` 和 `fadeDistance`。它的控件这样修改图层：

<<< @/../src/tut-91/main.js#settings

修改图层的设置，无论通过 `setLayerSettings` 还是图层自身的属性（`foliage.getLayer(index).cullDistance = 200`），都会重建植被系统的所有块：为每个实例的每个部件各建一个网格节点。修改实例只重建实例所在的块。树有几千棵时，一次重建会有明显的停顿，所以不要每帧修改设置，也不要在拖动滑块的过程中修改。

## 树叶：背光透射

阳光在叶子背后时，薄叶会透亮。PBR 材质用 `foliageTransmission` 打开这一效果，示例中的树冠就用了它：

<<< @/../src/tut-91/main.js#transmission

颜色是透过来的光，有 `foliageTransmissionTexture` 时再乘以贴图。透射不只来自太阳，叶子背后的天空光也算在内。树叶卡片是单层面片，还要把材质的 `cullMode` 设为 `'none'`，背面才会绘制。材质蓝图中改为连接 `SubsurfaceColor`。impostor 同样会烘焙透射，远处的树也保留这一效果。

## 碰撞

`collision` 让实例成为静态物理障碍，例如让车辆不能穿过树：

```ts
foliage.setLayerSettings(pines, {
  collision: { shape: 'capsule', radius: 0.3 }
});
```

尺寸以资产自身单位计，随每个实例的缩放变化。省略的尺寸会按资产网格的包围盒拟合，而树的包围盒是树冠，所以要给出树干半径。`shape: 'asset'` 时使用资产节点上自带的盒、球、胶囊和圆柱碰撞体。见[碰撞体](zh-cn/physics-colliders.md)。

## 限制与坑

- 逐实例的距离剔除、逐实例的 impostor 切换以及 `fadeDistance` 都依赖 GPU 实例剔除，只在 WebGPU 下可用（`device.type === 'webgpu'`）。WebGL2 下，整块实例都超过 `cullDistance` 后才整块隐藏，整块实例都超过 impostor 距离后才整块切换为卡片，实例会直接出现或消失，没有淡入淡出。
- 密集森林的开销主要在几何体上，主视图和每一级阴影级联都要画。优先降低 `cullDistance`、启用 impostor，小型植物关闭 `castShadow`。几万棵树需要独立显卡。
- 实例通过地形在 CPU 上的高度副本 `terrain.heightData` 落到地面上。从场景加载的地形和用 `setHeights` 设置的高度立即就有这份副本，其他 `r16f`/`rgba16f` 高度图通过 GPU 回读得到。其他格式的高度图（如 `r32f` 纹理或图片）无法回读，实例不会落到地面，而是停在植被系统局部空间里离地高度所给的位置。
- 资产中的蒙皮网格和带变形目标的网格会被跳过：既不散布，也不烘焙进 impostor。
- 实例位置相对于植被系统，不支持旋转或缩放植被系统。
- 修改 `maskCellSize` 会保留已绘制的数值，因此绘制的范围会随之缩放；修改后要重新生成图层。
