# 运行时地形

> 本页代码为片段示意，省略了 import 与应用初始化。完整可运行示例见页内嵌入的实例。

`ClipmapTerrain` 根据高度图渲染大面积的室外地面：相机周围的网格是一个 clipmap，网格单元随距离变大，所以无论地形多大，绘制开销都差不多。地表由若干细节纹理层按 splat 贴图混合而成。每个地形还带有一个草地渲染器，支持纹理卡片草，在 WebGPU 上还支持程序化的几何草。

本页介绍如何在代码中使用地形。笔刷和绘制操作见[地形工具](zh-cn/editor/terrain-tools.md)。

---

## 创建地形

```ts
const terrain = new ClipmapTerrain(scene, 512, 512, 64);
terrain.position.setXYZ(0, 0, 0);
terrain.castShadow = true;
```

| 参数 | 含义 |
| --- | --- |
| `scene` | 地形所属的场景 |
| `sizeX` | 地形宽度（世界单位） |
| `sizeZ` | 地形深度（世界单位） |
| `clipMapTileSize` | clipmap 环的图块分辨率；越大，相机附近的三角形越多 |

地形从节点的 X/Z 位置开始，沿 +X/+Z 方向延伸 `sizeX * scale.x` 和 `sizeZ * scale.z`。高度来自高度图，并乘以节点的 Y 缩放。`terrain.worldRegion` 给出覆盖范围 (minX, minZ, maxX, maxZ)。

---

## 高度图

地形会自动创建一张 `sizeX × sizeZ` 的高度纹理，也可以换成加载的纹理：

```ts
terrain.heightMap = await getEngine().resourceManager.fetchTexture('/terrain/height.png', {
  linearColorSpace: true
});
terrain.setSize(1024, 1024);
```

设置 `heightMap` 时会更新用于剔除和包围盒的高度范围。如果代码直接写入高度纹理，之后需要调用 `terrain.updateBoundingBox()` 和 `terrain.updateHeightPyramid()`（高度金字塔用于草的遮挡剔除）；开启了[运行时虚拟纹理](#运行时虚拟纹理)时，还要对改动的区域调用 `terrain.invalidateRuntimeVirtualTexture()`，因为虚拟纹理的页中存有地表法线。

---

## 细节层与 splat 贴图

地表由多个细节层混合而成，每层是一张颜色纹理，可以再配一张法线贴图。splat 贴图记录每个位置上各层的占比，通常用编辑器的纹理笔刷绘制，也可以在代码中用 `material.setSplatMap()` 替换。

```ts
const material = terrain.material;
material.numDetailMaps = 2;

material.setDetailMap(0, await getEngine().resourceManager.fetchTexture('/terrain/grass.png'));
material.setDetailNormalMap(
  0,
  await getEngine().resourceManager.fetchTexture('/terrain/grass-n.png', { linearColorSpace: true })
);
material.setDetailMapUVScale(0, 24);
material.setDetailMapRoughness(0, 0.8);

material.setDetailMap(1, await getEngine().resourceManager.fetchTexture('/terrain/rock.png'));
material.setDetailMapUVScale(1, 12);
material.setDetailMapRoughness(1, 0.95);
```

`numDetailMaps` 的上限是 `terrain.MAX_DETAIL_MAP_COUNT`。不使用运行时虚拟纹理时，每个像素都要采样所有层，所以每多一层，整片地形的着色开销都会增加。

### 六边形平铺

一张纹理平铺在大片区域上，会看出明显的重复。六边形平铺（Mikkelsen，*Practical Real-Time Hex-Tiling*，2022）把每一层按六边形网格采样，每个六边形随机旋转和缩放，再平滑混合，使接缝不可见：

```ts
material.setDetailMapHexTiling(0, true);
// rotation、scale、contrast，取值都是 0 到 1（MaterialX hextiledimage 的输入）
material.setDetailMapHexParams(0, 1, 0.5, 0.5);
```

| 参数 | 效果 |
| --- | --- |
| rotation | 每块随机旋转的程度，1 为任意角度。有方向性的纹理（如岩层）应调低 |
| scale | 每块随机缩放的程度，1 为 0.5 到 2 倍 |
| contrast | 接缝处亮的一块占优的程度，越高过渡越清晰 |

六边形平铺每层要采样三次而不是一次。开启运行时虚拟纹理后，这部分开销按页只付一次，而不是每个像素都付，所以两者适合一起用。WebGL1 不支持。

---

## 运行时虚拟纹理

细节层多时，每帧在每个像素上混合所有层会成为地形的主要开销。运行时虚拟纹理（RVT）把各层预先混合到一张大虚拟纹理的页中，页里存放基础色、世界空间法线和粗糙度，地形着色时只需查找一次。只有相机需要的页才会被填充，并且按所需的分辨率填充；页下面的地表变化时会重新填充。

```ts
// 仅 WebGPU，其他后端忽略
terrain.runtimeVirtualTexture = true;

// 或者带选项
terrain.setRuntimeVirtualTexture({
  virtualSize: 32768, // 地形长边方向的纹素数
  pageSize: 128,
  atlasSize: 4096, // 物理页：4096² 纹素，两张 RGBA8，共 128 MB
  allocBudget: 16 // 每次更新填充的页数
});
```

编辑器中，在地形属性里开启 **RuntimeVirtualTexture**。用编辑器笔刷绘制时，受影响的页会自动重新填充。

适用场景与代价：

- 着色开销不再随层数和六边形平铺增长，层越多省得越多。
- `virtualSize` 决定混合后地表的清晰度：最精细一级上，地形长边对应这么多纹素。比这更密的细节纹理平铺会被页的分辨率模糊掉。
- 物理图集是预先分配的，默认 4096 时占 128 MB。显存紧张的设备应调低 `atlasSize`；图集太小时装不下一个视图所需的全部页，会退回使用较粗的页。
- 页的填充分摊在多帧中完成（每次更新 `allocBudget` 页）：镜头切换或快速移动后，地表可能短暂显示较粗的页。
- 直接写入 splat 贴图或高度图的代码，必须用改动的世界 XZ 矩形调用 `terrain.invalidateRuntimeVirtualTexture(x0, z0, x1, z1)`，不带参数则刷新整片地形。通过材质修改纹理或层参数会自动生效。
- `terrain.runtimeVirtualTextureData` 提供虚拟纹理本身，用于检查（`stats`、`renderDebugTexture()`）。

---

## 草地

每个地形都有一个 `grassRenderer`，其中包含若干草地层。层分两种：

| 类型 | 绘制内容 | 后端 | 适用于 |
| --- | --- | --- | --- |
| `'card'`（默认） | 带纹理、alpha 测试的卡片 | 全部 | 花、杂草、稀疏植被，以及任何靠纹理表现的东西 |
| `'blade'` | 程序化的几何草叶，逐叶弯曲、逐叶光照，不需要纹理 | 仅 WebGPU | 茂密的草坪和草甸 |

几何草每片草叶是一条三次贝塞尔曲线，由顶点着色器根据每叶的少量参数构建；草叶成簇分布，同簇共享高度、朝向和颜色，并随场景风场弯曲。与卡片不同，它不需要 alpha 测试，所以不会拖累深度预渲染的效率，近看也保持清晰。

### 密度图

两种层的放置方式相同。每层有一张**密度图**，每个纹素一个字节（0 表示无草，255 表示满密度），覆盖整片地形。草叶由密度图确定性地生成：相同的密度数据总是得到相同的分布，草叶自动贴合地形高度。

```ts
const grassTexture = await getEngine().resourceManager.fetchTexture('/terrain/grass-card.png');
const cards = terrain.grassRenderer.addLayer(0.12, 0.8, grassTexture);
const layer = terrain.grassRenderer.getLayer(cards);

// 写入密度，然后重新生成该区域
const w = layer.densityMapWidth;
for (let z = 10; z < 20; z++) {
  for (let x = 10; x < 20; x++) {
    layer.densityMap[z * w + x] = 255;
  }
}
layer.updateDensityRegion(10, 10, 20, 20);
```

密度纹素 (x, z) 覆盖地形区域 `[x/w..(x+1)/w, z/h..(z+1)/h]`。`cellsPerTexel` 是每个纹素在每个轴上的放置格数，一个纹素最多容纳它的平方个草叶。应把多次密度写入合并后只调用一次 `updateDensityRegion()`；`setDensityData(w, h, cellsPerTexel, data)` 替换整张密度图。

<div class="showcase" case="tut-69"></div>

### 几何草

```ts
// 草叶宽度和高度，不需要纹理
const blades = terrain.grassRenderer.addLayer(0.04, 0.6, null, 'blade');
const meadow = terrain.grassRenderer.getLayer(blades);

meadow.rootColor = new Vector4(0.12, 0.2, 0.05, 1);
meadow.tipColor = new Vector4(0.55, 0.65, 0.25, 1);
meadow.tilt = 0.3; // 草叶倾倒的程度
meadow.bend = 0.4; // 草叶弯曲的程度
meadow.clumpSize = 0.5; // 世界单位
meadow.clumpSameDirection = 0.6; // 同一簇朝同一方向梳理
meadow.lodDistance = 30; // 在此距离切换到低细节
```

所有参数都有默认值，默认就是一片合理的草坪。参数分为几组：

| 分组 | 属性 | 效果 |
| --- | --- | --- |
| 形状 | `tilt`、`bend`、`taper`、`tipDetail`、`heightRandomness`、`widthRandomness`、`tiltRandomness`、`bendRandomness` | 每片草叶的倾倒、弯曲、轮廓，以及它们的随机变化程度 |
| 成簇 | `clumpSize`、`clumpHeightVariation`、`clumpPull`、`clumpSameDirection`、`clumpFaceAway`、`clumpColorVariation` | 把草地分成一块块：草丛、被梳理过的区域、颜色变化 |
| 颜色与光照 | `rootColor`、`tipColor`、`colorMap`、`rootOcclusion`、`roundness`、`transmissionColor` | 从根到尖的渐变或纹理、根部变暗、模拟曲面的着色、逆光时草叶透光 |
| 距离 | `viewThickening`、`farNormalStart`、`farNormalEnd`、`farRoughness`、`lodDistance` | 低角度时草地依然饱满，远处不闪烁；`lodDistance` 处切换为四分之一数量、更宽的草叶 |
| 风 | `windFacing`、`windLean`、`swayAmplitude`、`swaySpeed` | 草叶对场景风的响应；卡片层也有 `windLean`、`swayAmplitude`、`swaySpeed` |

两种草都会随场景风场摆动：

```ts
const wind = scene.env.wind;
wind.direction = 45; // 地面上的角度，0 表示吹向 +X
wind.strength = 1;
wind.gustStrength = 0.5;
wind.gustScale = 20;
```

几何草会向太阳阴影贴图最近的两个级联投射阴影（`grassRenderer.castShadow`，默认开启；地形本身也要开启投影），并在后一个级联的最后 `grassRenderer.shadowFadeFraction` 范围内逐渐淡出。更远处的草不投射自身的阴影，如果开启了屏幕空间接触阴影和环境光遮蔽，会由它们压暗。

编辑器中，草地笔刷的 **Add Blade Layer** 按钮可以添加几何草层，选中该层后，参数显示在笔刷面板中。

### 绘制距离与剔除

| 设置 | 效果 |
| --- | --- |
| `layer.drawDistance` | 超过此距离不绘制（默认 150），并在最后四分之一距离内逐渐缩入地面；0 表示任意距离都绘制 |
| `layer.farDensity` | 卡片层：在绘制距离处仍保留的草叶比例（默认 0.25），剩下的草叶会变宽以保持覆盖 |
| `grassRenderer.occlusionCulling` | WebGPU：跳过被地形本身挡住的草（默认开启）。只有地形会遮挡，建筑不会 |
| `grassRenderer.occlusionDebug` | 把会被遮挡剔除的草画成红色，而不是跳过 |

在 WebGPU 上，草叶每帧在 GPU 上围绕相机根据密度图放置，同时做视锥剔除和地形遮挡剔除，没有逐图块的 CPU 开销。在 WebGL 上，卡片草在密度变化时以 CPU 图块生成，`farDensity` 只会把被淘汰的草叶缩小，而不会真正跳过它们。

### 如何选择

- 几何草需要 WebGPU。其他后端上几何草层不会绘制，控制台会给出警告；如果 WebGL 用户也需要草地，请为他们准备卡片层。
- 卡片的单叶开销更低，可以表现任意纹理，但 alpha 测试会让提前深度剔除失效，所以茂密的卡片草填充开销很高。大面积覆盖优先用几何草，稀疏的花和杂草用卡片。
- 卡片层不投射阴影。

---

## 调试

```ts
camera.wireframe = true; // 所有对象，包括地形；需要开启调试视图，见细节层次（LOD）
terrain.wireframe = true; // 只作用于地形，总是可用
terrain.material.debugMode = 'vertex_normal';
```

`TerrainDebugMode` 列出了可用的调试输出：`none`、`vertex_normal`、`detail_normal`、`tangent`、`uv`、`bitangent`、`albedo`。

---

## 序列化

`ClipmapTerrain`、它的材质（细节层、六边形平铺）、运行时虚拟纹理开关，以及高度图、splat 贴图、草地数据的资产 id，都会随场景序列化，编辑器中编辑的地形就是这样保存和恢复的。草地层会保留其类型和草叶参数。

运行时生成的地形，在保存场景前要为生成的高度、splat 和草地资源指定稳定的资产 id。

---

## 性能

- clipmap 让三角形数大致恒定；`clipMapTileSize` 在近处细节和顶点开销之间取舍。
- 细节层会成倍增加逐像素开销；在 WebGPU 上，层数较多或使用六边形平铺时应开启运行时虚拟纹理。
- 草地开销随密度和绘制距离增长。先调低 `drawDistance`，再调低密度；几何草层可以缩短 `lodDistance` 来减少远处的几何体。
- 高度图分辨率超过地形的世界尺寸后，通常看不出更多细节。

引擎层面的优化手段见[性能优化](zh-cn/performance.md)。
