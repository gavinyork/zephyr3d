# 细节层次（LOD）

网格离相机越远，在屏幕上越小，用不着全部三角形。细节层次（Level of Detail，LOD）给网格准备几份逐级简化的版本，按网格在屏幕上的大小选用其中一份，以减少远处物体的顶点和三角形开销。

zephyr3d 的 LOD 是**离散 LOD 链**：

- 第 0 级是原始网格，后面各级三角形逐级减少。
- **各级共用同一份顶点缓冲**，每一级只是索引缓冲中的一段。所以带 LOD 的网格只多出几段索引，骨骼蒙皮和变形目标（Morph Target）在每一级都照常工作。
- 每一帧、每个视图分别为网格选一级，级与级之间直接切换。

LOD 一般在编辑器里生成，见[资产压缩](zh-cn/editor/asset-compression.md)中的“细节层次（LOD）”一节。生成后的网格无需任何代码，加载后自动按距离切换。不使用编辑器时，也可以在加载模型时生成，见[加载时生成](#加载时生成)。

## 示例

下面是一片共用两个形状的网格：球体和圆环在创建选项中带上了 `lod`，创建时自动生成 LOD，每个网格再按自己在屏幕上的大小选级。页面打开时已经开着 LOD 着色，离相机越远的网格级别越高、颜色越靠后（颜色对照见[查看 LOD 效果](#查看-lod-效果)）。拖动、缩放视角，可以看到网格在各级之间切换。面板下方显示每个形状实际生成了几级，以及当前画出的三角形数与全部用第 0 级时的对比；每个网格当前的级别用 `Mesh.selectLod(camera)` 查询。

<div class="showcase" case="tut-89"></div>

生成 LOD 只需要在形状的创建选项里加上 `lod`：

<<< @/../src/tut-89/main.js#shapes

- `lodMinTriangles`、`lodReduction`、`lodPixelError` 分别对应编辑器网格设置中的 **Min Triangles**、**Triangles Per Level**、**Pixel Error**。
- Pixel Error 决定切换距离：它越小，每一级越晚换上，画面越接近原始网格，画出的三角形也越多。示例用 2 而不是编辑器默认的 8，是为了让整片网格里能看到所有级别；在面板上把它改成 8，各级会明显提前切换。
- 精简器的 WebAssembly 模块第一次使用时才初始化，LOD 会比形状晚一点出现，在此之前网格都按第 0 级绘制。

面板上的其他选项直接对应下面这些属性，作用见[控制选级](#控制选级)和[查看 LOD 效果](#查看-lod-效果)：

<<< @/../src/tut-89/main.js#view

其中 `lodColoration` 和 `wireframe` 是调试视图，示例在 `index.html` 里打开了调试视图的开关。

---

## 在编辑器中生成

导入 GLB、FBX 或 OBJ 时，在导入选项中勾选 **Generate LODs**，设置 **Min Triangles**、**Triangles Per Level** 和 **Pixel Error**，点击 **OK**。导入进度中的 `Generating levels of detail...` 完成后，派生网格即可使用。

已有网格可在 Content Browser 中右键 `.zmsh`，选择 **Mesh Settings...**，勾选 **Generate LODs**，调整上述参数并点击 **OK**。派生副本在后台生成；状态显示 **in use in the editor** 后，重新打开场景即可确认视口已使用新副本。设置保存在网格旁的 `.zmeta` 文件中，源文件不会被修改。

编辑器只为 triangle-list 网格生成 LOD。发布时由 **Build Project** 将派生副本写入构建产物。

---

## 选级规则

**屏幕尺寸**：网格世界包围盒的外接球投影到屏幕上的**直径**，与屏幕较短一边（横屏时为高度）之比。外接球正好占满屏幕高度时约为 1，占半屏时约为 0.5。透视投影下它与距离成反比，正交投影下与距离无关。

每一级 LOD 都有一个**切换尺寸**（`screenSize`）。引擎选用切换尺寸仍大于网格当前屏幕尺寸的最粗那一级；屏幕尺寸比所有切换尺寸都大时用第 0 级。

**滞回**：每一级还有一个滞回量（`hysteresis`），编辑器生成的各级为 0.02。从粗的一级切回细的一级时，要求屏幕尺寸再多长出这个量，这样网格停在临界距离附近时不会每帧来回跳。

---

## 控制选级

| 属性 | 作用 |
| --- | --- |
| `Mesh.forcedLod` | 固定使用某一级，0 最精细；-1（默认）按屏幕尺寸选。超出范围时取最粗一级 |
| `Mesh.minLod` | 按屏幕尺寸选级时允许的最精细一级，默认 0。调大后，网格在近处也保持简化版本 |
| `Camera.lodDistanceScale` | 该视图下所有切换尺寸的缩放。大于 1 时在更近处就换到简化版本，小于 1 时更远处仍保持精细版本。默认 1 |

`forcedLod` 和 `minLod` 会随场景保存，在编辑器的属性面板里也能修改。`lodDistanceScale` 适合作为画质选项，例如低画质下设为 2：

```ts
camera.lodDistanceScale = lowQuality ? 2 : 1;
```

---

## 查看 LOD 效果

有两个调试视图，可以单独开，也可以同时开。调试视图只在引擎加载前设置了 `globalThis.__ZEPHYR3D_DEBUG_VIEWS__ = true`（或在构建时把 `__ZEPHYR3D_DEBUG_VIEWS__` 定义为 `true`）时可用。编辑器已经设置；发布的应用默认不设置，这时下面的属性没有效果，并会打印一次警告。示例的 `index.html` 在加载引擎的模块脚本之前设置它：

<<< @/../src/tut-89/index.html#debug-views

- **线框**：`camera.wireframe = true` 把这个视图里的所有对象画成三角形的边，包括网格、BatchGroup、粒子、精灵、头发、地形、水体和草。线框跟随当前的 LOD，拉远拉近能直接看到三角形变少。带索引几何的线框需要从 GPU 读回索引后生成，打开后会晚几帧出现。阴影和拾取不受影响。
- **LOD 着色**：`camera.lodColoration = true` 把每个网格按当前所在的级别着色：

| LOD | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 颜色 | 白 | 红 | 绿 | 蓝 | 黄 | 品红 | 青 | 紫 |

没有 LOD 的网格显示为白色。打开 LOD 着色时网格不参与自动合批，draw call 会增加，只用于调试。

编辑器的 **View** 菜单中有 **Wireframe** 和 **LOD Coloration** 两项，作用于视口。

---

## 用代码设置 LOD

### 加载时生成

不经过编辑器时，用 `@zephyr3d/loaders` 的导入器（glTF、FBX、OBJ 等）加载的模型，可以在加载时生成 LOD，生成方式与编辑器相同：

```ts
// 通过资源管理器加载，导入器已用 setModelLoader() 注册
const model = await getEngine().resourceManager.fetchModel('/models/tree.glb', scene, {
  generateLods: true // 或 { lodMinTriangles: 200, lodReduction: 0.5, lodPixelError: 8 }
});

// 或直接使用导入器（GLTFImporter 来自 @zephyr3d/loaders），得到的是 SharedModel
const sharedModel = await new GLTFImporter().loadModel('/models/tree.glb', undefined, { generateLods: true });
```

`generateLods: true` 使用编辑器的默认设置：每级至少 100 个三角形，每级保留上一级一半的三角形，Pixel Error 为 8。各项设置的含义与编辑器的网格设置相同（见[资产压缩](zh-cn/editor/asset-compression.md)）。

已经加载成 `SharedModel` 的模型，可以在创建场景节点之前调用 `SharedModel.generateLods()` 生成 LOD：

```ts
await sharedModel.generateLods({ lodMinTriangles: 200 });
```

生成使用引擎自带的 meshoptimizer 精简器（`getMeshoptSimplifier()`），在主线程进行，大模型会比较耗时；经过编辑器处理的模型直接带着 LOD 发布，没有这项开销。

### 参数化形状

内置形状（`SphereShape`、`TorusShape`、`CylinderShape` 等）在创建选项中带上 `lod` 时，会自动生成 LOD，写法见上文的[示例](#示例)。

形状每次重建时都会重新生成 LOD，所以修改选项后 LOD 始终与之一致；保存时只存设置。示例在面板上修改 Pixel Error 时，就是重设两个形状的选项，用到它们的网格随之更新：

<<< @/../src/tut-89/main.js#rebuild

编辑器里，形状资产的属性中会显示 **GenerateLODs**、**LODMinTriangles**、**LODReduction**、**LODPixelError** 四项。第一次使用时，要等精简器的 WebAssembly 模块加载完，LOD 会在形状创建后稍晚出现。

三角形太少的形状不会生成 LOD：简化后不足 `lodMinTriangles` 个三角形的级别不会加入，按默认设置（100、0.5），形状至少要有 200 个三角形才有第 1 级。`BoxShape` 只有 12 个三角形，不会有 LOD；其他形状要先调高细节选项，例如 `SphereShape` 的 `verticalDetail` 和 `horizonalDetail`。注意后者的拼写是 `horizonal`，在 JavaScript 里写成 `horizontalDetail` 不会报错，只会被忽略。

### 手动设置

如果 LOD 由其他工具生成，也可以自己准备索引并设置 [Primitive.lods](/doc/markdown/./scene.primitive.lods)。做法是把各级索引依次存进同一个索引缓冲，第 0 级的范围由 `indexStart`、`indexCount` 给出，后面各级写在 `lods` 中：

```ts
// 索引缓冲依次存放：第 0 级 3000 个索引，第 1 级 1500 个，第 2 级 750 个
primitive.createAndSetIndexBuffer(allIndices);
primitive.indexStart = 0;
primitive.indexCount = 3000;
primitive.lods = [
  { indexStart: 3000, indexCount: 1500, screenSize: 0.5, hysteresis: 0.02 },
  { indexStart: 4500, indexCount: 750, screenSize: 0.25, hysteresis: 0.02 }
];
```

`lods` 按从细到粗排列，切换尺寸应逐级递减。各级的索引可以用 [meshoptimizer](https://github.com/zeux/meshoptimizer) 的 `simplify` 生成：它只输出新的索引，引用的仍是原来的顶点，正好符合这种布局。

引擎没有公开计算屏幕尺寸的函数。需要按同样的规则判断网格大小时，透视投影下可以自己计算 `max(|m00|, |m11|) × r / d`：`m00`、`m11` 取自 `camera.getProjectionMatrix()`，`r` 是包围球半径，`d` 是球心到相机的距离。

---

## 与合批的关系

- 自动实例化按“图元 + 材质”合批，同一个图元的不同 LOD 分别合批，各画各的索引段。
- `BatchGroup` 会缓存渲染队列。在 WebGPU 上，如果设备支持 `indirect-first-instance` 且 `gpuInstanceCulling` 开启（默认开启），合批网格的 LOD 在 GPU 上逐实例选取，与视锥剔除在同一个 compute pass 中完成，网格换级不会导致缓存重建。阴影视图和 CPU 路径一样按主相机选级。这条路径没有滞回，网格恰好停在切换距离附近时，可能随相机移动在两级之间来回切换。其他情况（WebGL2、关闭 GPU 剔除、打开 LOD 着色、未合批的网格）下每个网格在 CPU 上选级，有网格换级时缓存会重建，滞回让这种情况很少发生。

---

## 当前限制

- 级与级之间直接切换，没有淡入淡出。
- 只有三角形列表（`triangle-list`）网格能生成 LOD。
- LOD 来自编辑器的派生管线，或在加载时用 `generateLods` 生成。glTF 的 `MSFT_lod` 扩展暂不支持。
- 生成 LOD 时只考虑位置和法线，不考虑骨骼权重；关节处变形明显的蒙皮网格，低级别可能出现变形异常。骨骼数量不会减少。
- 地形、水面、头发和粒子有各自的细节控制，不使用网格 LOD。
