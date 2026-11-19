# 网格 SDF 与全局 SDF

符号距离场（SDF）在空间中每一点记录到最近网格表面的距离，在物体内部为负。它为探针 GI（DDGI）、近岸浪与水体交互、调试可视化（`renderSceneSDFView()`、`SDFDebugMaterial`），以及自定义材质中的空间查询（`ShaderHelper.declareSceneSDF`）提供统一的几何表示。直接光照的阴影不使用 SDF，仍由阴影贴图负责。SDF 系统默认关闭；上述功能读取的全局 SDF 由计算着色器构建，因此需要 WebGPU。

## 可运行示例

下面的示例用代码创建几个形状，在运行时烘焙它们的距离场，并用 **Distance field** 开关切换距离场调试视图：打开时画面显示全局 SDF 本身，关闭时显示正常渲染的场景。面板中实时显示 `scene.sdf.getStats()` 的计数。WebGL2 下没有全局字段，开关不可用（见[限制](#限制)）。

<div class="showcase" case="tut-93"></div>

首先开启场景 SDF：

<<< @/../src/tut-93/main.js#enable

开启后，场景会跟踪所有 `sdfMode` 最终不为 `none` 的网格，把摄像机 `scene.sdf.streamRadius`（默认 256 单位）范围内网格的字段按由近到远的顺序流式放入一张共享的半精度 atlas，每帧最多上传 `scene.sdf.uploadBudget` 字节（默认 4 MB）。atlas 默认 512×256×256 体素（约 64 MB）；这个场景用不了这么多，所以把 `atlasSize` 调小了。

在编辑器中导入的网格从烘焙好的 `.zsdf` 文件读取字段（见[在编辑器中烘焙](#在编辑器中烘焙)）。代码创建的形状没有这类文件，而没有字段的网格不会参与 SDF。示例在加载时烘焙它们：

<<< @/../src/tut-93/main.js#bake

`scene.sdf.bakeField(primitive, options)` 从 GPU 读回图元最高细节级别的三角形，在 CPU（主线程）上烘焙字段，再交给 `scene.sdf.setField()`。每个图元调用一次即可，不要每帧调用。字段位于图元的局部空间，并以图元为键，因此任何场景中使用该图元的网格都共享同一个字段：示例中的四根柱子只占一个字段。运行时提供的字段优先于烘焙好的 `.zsdf`。

选项与 `bakeMeshSDF` 相同：`resolutionScale`（分辨率倍率，默认 1）、`unitScale`（一个局部单位对应的世界单位，默认 1）、`twoSided`（树叶、帆等开放薄片，默认 false），以及 `signSamples`、`padding`、`maxResolution`、`minResolution`。若不想让大网格的烘焙占用主线程，可以用 `readPrimitiveTriangles()` 读出三角形，在 Worker 中运行 `bakeMeshSDF()`，再把结果交给 `setField()`：

```ts
scene.sdf.setField(primitive, sdfData); // sdfData：bakeMeshSDF() 生成的 MeshSDFData
```

### 距离场调试视图

调试视图由 `renderSceneSDFView()`（来自 `@zephyr3d/scene`）绘制，编辑器的 **View > Distance Field** 用的也是它。它要在相机渲染完场景之后调用，示例把它放在渲染层的 `afterRender` 钩子里（见[渲染层与渲染顺序](zh-cn/first-app.md#渲染层与渲染顺序)）：

<<< @/../src/tut-93/main.js#view

它从相机出发，逐像素在全局字段中做球面追踪（sphere tracing），结果覆盖整个画面：命中表面的像素为灰色，未命中的为蓝色，两者都随追踪步数增多而变亮，所以掠射的轮廓会发亮。动态网格也会画出来。因为追踪的是全局字段而不是网格，这个视图显示的正是 DDGI、近岸浪等功能实际"看到"的几何：缺字段的网格不会出现，离相机较远、落在粗级别里的物体会变得圆钝。

第三个参数选择视图模式。`'distance'` 只需要 SDF；`'albedo'`、`'emissive'`、`'radiance'`、`'skyVisibility'`、`'irradiance'` 显示 GI 体素场景或探针在命中点的数据，需要开启 `scene.gi`，数据不可用时退回 `'distance'`。没有全局字段（SDF 未开启或在 WebGL2 下）时它什么也不画，返回 false。

要看字段在某个平面上的数值，可以把 `SDFDebugMaterial` 赋给一个平面：几何体外部为暖色、内部为冷色，每隔 `isoSpacing` 单位（默认 0.25）画一条等值线，表面处为白线，没有字段可读时显示品红。这样的平面应设为 `sdfMode = 'none'`，否则它会被计为一个永远不会 ready 的参与实例。

### 静态与动态

金色圆环每帧由代码移动，因此设为 `dynamic`：

<<< @/../src/tut-93/main.js#ring

打开调试视图，把 **Ring sdfMode** 切换为 `auto` 或 `static`，观察 **Bricks last frame**：此时圆环每移动一次，clipmap 都要重建它周围的区域。再把 **Brick budget** 设为 32：粗级别先用完预算，最细一级跟不上，调试视图里圆环经过的位置会留下残影。取消勾选 **Move ring** 可让它追上。`none` 会把圆环从字段中去掉：调试视图里圆环消失，正常画面中它仍然可见。

### 统计

面板中的读数来自 `scene.sdf.getStats()` 和全局字段自己的 `getStats()`：

<<< @/../src/tut-93/main.js#stats

`instances` 是参与的网格数，`assets` 是它们用到的不同字段数，`readyInstances` 是字段已进入 atlas 并上传完成的网格数。代码创建的网格在字段设置之前也计入 instances，但不会变为 ready。`assetsMissing` 是没有烘焙文件的网格资产数，`atlasFull` 是字段放不下的次数。`pendingUploads` 是等待上传的字段个数，不是字节数。

## 在编辑器中烘焙

导入模型时勾选 **Bake Distance Fields**，会为本次导入的每个网格使用默认参数生成 `.zsdf`，导入进度中显示 `Baking distance fields...`。该选项只应用于本次导入的新网格。

对已有 `.zmsh` 网格，在 Content Browser 中右键选择 **Mesh Settings...**。设置 **SDF Resolution**（分辨率倍率）、**SDF Unit Scale**（一个网格局部单位对应的世界单位）和 **SDF Two Sided**（树叶、布、地形裙边等开放薄片），然后点击 **Bake SDF**。状态显示 `Baked ...` 后，结果即可供运行时加载。网格或设置改变后需要重新烘焙；`Mesh.sdfMode` 只控制运行时参与方式，不会触发烘焙。

网格字段的精度按世界尺寸计算：默认每个世界单位 20 个体素（经 SDF Unit Scale 换算），每个轴最多 128 个体素（含两侧各 2 个体素的边距；分辨率倍率大于 1 时为 256）。很大的网格会因此被降低精度，必要时可拆成几块再烘焙。`bakeField()` 遵循同样的规则。

## 网格参与模式

```ts
mesh.sdfMode = 'static';  // 适合不移动的建筑和地形道具
mesh.sdfMode = 'dynamic'; // 每帧按当前变换查询
mesh.sdfMode = 'none';    // 排除
mesh.sdfMode = 'auto';    // 默认：按节点和动画状态推断
```

`auto` 会把蒙皮网格、Morph 网格，以及自身或任一祖先节点带有非静态刚体（dynamic 或 kinematic）或角色控制器的网格判定为 `dynamic`，其余网格判定为 `static`。`mesh.effectiveSDFMode` 返回推断结果。隐藏的网格和不在场景中的网格不参与。

静态实例会合成进全局字段；动态实例不进入全局字段，而是在读取字段时按各自的当前变换合并进来，并且只合并离摄像机最近的 16 个动态网格。

注意：由脚本、关键帧动画或代码直接移动的网格不在上述判断范围内，`auto` 会把它们判为 `static`。这类网格要手动设为 `'dynamic'`，如示例中的圆环。

## 全局 SDF

`scene.sdf.global` 是围绕摄像机移动的多级 clipmap，在 GPU 上由静态字段和地形（场景中第一个 `ClipmapTerrain`）合成。它固定为 4 级、每级 128³ 体素：最细一级的体素为 0.25 单位，覆盖摄像机周围 ±16 单位，之后每一级体素尺寸和覆盖范围都翻倍，最粗一级约 ±128 单位。所有尺寸按场景单位计算，不随 `scene.metersPerUnit` 换算。最细一级窗口之外字段会变粗：在示例中打开调试视图并把镜头拉远，物体的形状会变得圆钝、不再精确。

字段以 8³ 体素的砖块为单位更新：摄像机移动时，新进入某一级窗口的砖块需要重建；静态网格出现、移动或移除时，它周围的砖块在每一级都需要重建。每帧最多合成 `brickBudget` 个砖块（默认 512），从最粗的一级开始。全局字段的 `getStats()` 给出上一次更新合成的砖块数（`lastBricks`）和仍在等待的砖块数（`dirtyBricks`）。

<<< @/../src/tut-93/main.js#budget

## 调参与取舍

- `streamRadius` 在 atlas 驻留量与覆盖范围之间取舍：半径越大，缺字段的网格越少，但需要更多 atlas 空间。
- `uploadBudget` 和 `brickBudget` 在收敛时间与每帧开销之间取舍：调高后，加载或镜头快速移动后字段更快稳定，代价是上传带宽和 GPU 时间。
- `atlasSize` 设置共享 atlas 每个轴的体素数。放不下的字段会被丢弃，并打印一条说明需求量的警告；可以调大 `atlasSize`、调小 `streamRadius`，或以较低的分辨率倍率烘焙。修改 `atlasSize` 会清空 atlas 并重新上传。

## 限制

- 网格字段需要预烘焙的 `.zsdf`，或通过 `bakeField()`/`setField()` 提供的字段；材质透明区域不等于几何孔洞。
- 全局字段以及所有读取它的功能（DDGI、近岸浪、`renderSceneSDFView()`、`SDFDebugMaterial`、`ShaderHelper.declareSceneSDF`）仅支持 WebGPU。在 WebGL2 下字段仍会流式进入 atlas，`getStats()` 也会照常统计，但 `scene.sdf.global` 为 null，没有任何功能读取这些字段。依赖它之前先检查 `scene.sdf.global`（或 `device.type === 'webgpu'`）。
- 不要让移动的几何体保持 `static`：每次移动都会让新旧位置周围的砖块在全部四级中重建，每帧消耗砖块预算；预算不够时，较细的级别会保留网格的过时副本。
