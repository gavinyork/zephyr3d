# 细节层次（LOD）

网格离相机越远，在屏幕上越小，用不着全部三角形。细节层次（Level of Detail，LOD）给网格准备几份逐级简化的版本，按网格在屏幕上的大小选用其中一份，以减少远处物体的顶点和三角形开销。

zephyr3d 的 LOD 是**离散 LOD 链**，与 UE 静态网格的 LOD 相同：

- 第 0 级是原始网格，后面各级三角形逐级减少。
- **各级共用同一份顶点缓冲**，每一级只是索引缓冲中的一段。所以带 LOD 的网格只多出几段索引，骨骼蒙皮和变形目标（Morph Target）在每一级都照常工作。
- 每一帧、每个视图分别为网格选一级，级与级之间直接切换。

LOD 一般在编辑器里生成，见[资产压缩](zh-cn/editor/asset-compression.md)中的“细节层次（LOD）”一节。生成后的网格无需任何代码，加载后自动按距离切换。

---

## 选级规则

**屏幕尺寸**：网格世界包围盒的外接球投影到屏幕上的**直径**，以半个屏幕为单位。物体正好占满屏幕高度时约为 2，占半屏时约为 1。透视投影下它与距离成反比，正交投影下与距离无关。

每一级 LOD 都有一个**切换尺寸**（`screenSize`）。引擎选用切换尺寸仍大于网格当前屏幕尺寸的最粗那一级；屏幕尺寸比所有切换尺寸都大时用第 0 级。

**滞回**：每一级还有一个滞回量（`hysteresis`），默认值为 0.02。从粗的一级切回细的一级时，要求屏幕尺寸再多长出这个量，这样网格停在临界距离附近时不会每帧来回跳。

---

## 控制选级

| 属性 | 作用 |
| --- | --- |
| `Mesh.forcedLod` | 固定使用某一级，0 最精细；-1（默认）按屏幕尺寸选。超出范围时取最粗一级 |
| `Mesh.minLod` | 按屏幕尺寸选级时允许的最精细一级，默认 0。调大后，网格在近处也保持简化版本 |
| `Camera.lodDistanceScale` | 该视图下所有切换尺寸的缩放，对应 UE 的 `r.StaticMeshLODDistanceScale`。大于 1 时在更近处就换到简化版本，小于 1 时更远处仍保持精细版本。默认 1 |

`forcedLod` 和 `minLod` 会随场景保存，在编辑器的属性面板里也能修改。`lodDistanceScale` 适合作为画质选项，例如低画质下设为 2：

```ts
camera.lodDistanceScale = lowQuality ? 2 : 1;
```

---

## 查看 LOD 效果

有两个调试视图，可以单独开，也可以同时开。调试视图只在引擎加载前设置了 `globalThis.__ZEPHYR3D_DEBUG_VIEWS__ = true`（或在构建时把 `__ZEPHYR3D_DEBUG_VIEWS__` 定义为 `true`）时可用。编辑器已经设置；发布的应用默认不设置，这时下面的属性没有效果，并会打印一次警告。

```html
<script>
  globalThis.__ZEPHYR3D_DEBUG_VIEWS__ = true;
</script>
```


- **线框**：`camera.wireframe = true` 把这个视图里的所有对象画成三角形的边，包括网格、BatchGroup、粒子、精灵、头发、地形、水体和草。线框跟随当前的 LOD，拉远拉近能直接看到三角形变少。带索引几何的线框需要从 GPU 读回索引后生成，打开后会晚几帧出现。阴影和拾取不受影响。
- **LOD 着色**：`camera.lodColoration = true` 把每个网格按当前所在的级别着色，配色与 UE 的 LOD Coloration 相同：

| LOD | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 颜色 | 白 | 红 | 绿 | 蓝 | 黄 | 品红 | 青 | 紫 |

没有 LOD 的网格显示为白色。打开 LOD 着色时网格不参与自动合批，draw call 会增加，只用于调试。

编辑器的 **View** 菜单中有 **Wireframe** 和 **LOD Coloration** 两项，作用于视口。

---

## 用代码设置 LOD

不经过编辑器时，也可以自己准备索引并设置 [Primitive.lods](/doc/markdown/./scene.primitive.lods)。做法是把各级索引依次存进同一个索引缓冲，第 0 级的范围由 `indexStart`、`indexCount` 给出，后面各级写在 `lods` 中：

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

需要按同样的规则判断网格大小时，可以用 `computeBoundsScreenSize(center, radius, camera)` 计算一个包围球的屏幕尺寸。

---

## 与合批的关系

- 自动实例化按“图元 + 材质”合批，同一个图元的不同 LOD 分别合批，各画各的索引段。
- `BatchGroup` 会缓存渲染队列。在 WebGPU 上，如果设备支持 `indirect-first-instance` 且 `gpuInstanceCulling` 开启（默认开启），合批网格的 LOD 在 GPU 上逐实例选取，与视锥剔除在同一个 compute pass 中完成，网格换级不会导致缓存重建。阴影视图和 CPU 路径一样按主相机选级。这条路径没有滞回（与 UE 静态网格相同），网格正好处在切换距离附近时，相机移动可能让它在两级之间来回切换。其他情况（WebGL、关闭剔除、开启 LOD 着色、不能合批的网格）仍由 CPU 为每个网格选级，有网格换级时缓存才重建；有滞回，这种情况很少发生。

---

## 当前限制

- 级与级之间直接切换，没有淡入淡出。
- 只有三角形列表（`triangle-list`）网格能生成 LOD。
- 只有经过编辑器派生管线的 `.zmsh` 才带 LOD。运行时直接加载的 glTF 不含 LOD，glTF 的 `MSFT_lod` 扩展暂不支持。
- 生成 LOD 时只考虑位置和法线，不考虑骨骼权重；关节处变形明显的蒙皮网格，低级别可能出现变形异常。骨骼数量不会减少。
- 地形、水面、头发和粒子有各自的细节控制，不使用网格 LOD。
