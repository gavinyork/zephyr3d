# 运行时地形

`ClipmapTerrain` 是 Zephyr3D 的运行时地形节点。它使用 clipmap LOD 渲染大范围地形，支持高度图、splat map、detail 贴图、法线贴图，并内置草地渲染器。

本页介绍代码层面的运行时用法。编辑器笔刷工作流请参考编辑器地形工具页面。

## 创建地形

```ts
import { ClipmapTerrain } from '@zephyr3d/scene';

const terrain = new ClipmapTerrain(scene, 512, 512, 64);
terrain.parent = scene.rootNode;
terrain.position.setXYZ(0, 0, 0);
terrain.castShadow = true;
```

构造参数：

| 参数 | 含义 |
| --- | --- |
| `scene` | 地形所属场景 |
| `sizeX` | 地形宽度，单位为世界坐标 |
| `sizeZ` | 地形深度，单位为世界坐标 |
| `clipMapTileSize` | clipmap 渲染器使用的 tile 分辨率 |

地形区域从节点的 X/Z 位置开始，沿正 X/Z 方向覆盖 `sizeX * scale.x` 和 `sizeZ * scale.z` 的范围。高度来自高度图和节点 Y 轴缩放。

## 高度图

`ClipmapTerrain` 会自动创建高度纹理。你也可以替换为加载的纹理：

```ts
const heightMap = await getEngine().resourceManager.fetchTexture('/terrain/height.png', {
  linearColorSpace: true
});

terrain.heightMap = heightMap;
terrain.setSize(1024, 1024);
```

高度数据变化时，地形会更新用于裁剪和世界包围盒的 min/max 数据。如果你手动修改高度纹理，需要在改完纹理数据后触发对应的地形更新流程。

## Detail 贴图与 Splat Map

地形材质参数在 `terrain.material` 上。

```ts
const material = terrain.material;

material.numDetailMaps = 2;
material.setDetailMap(0, await getEngine().resourceManager.fetchTexture('/terrain/grass.png'));
material.setDetailNormalMap(0, await getEngine().resourceManager.fetchTexture('/terrain/grass-n.png', {
  linearColorSpace: true
}));
material.setDetailMapUVScale(0, 24);
material.setDetailMapRoughness(0, 0.8);

material.setDetailMap(1, await getEngine().resourceManager.fetchTexture('/terrain/rock.png'));
material.setDetailMapUVScale(1, 12);
material.setDetailMapRoughness(1, 0.95);
```

`numDetailMaps` 受 `terrain.MAX_DETAIL_MAP_COUNT` 限制。splat map 用于选择不同 detail 层在地形上的混合方式。splat map 通常由编辑器地形笔刷生成，也可以通过 `material.setSplatMap()` 在代码中设置。

## 调试

调试地形数据时，可以使用线框和材质 debug mode：

```ts
terrain.wireframe = true;
terrain.material.debugMode = 'vertex_normal';
```

可用模式由 `TerrainDebugMode` 定义：`none`、`vertex_normal`、`detail_normal`、`tangent`、`uv`、`bitangent` 和 `albedo`。构建工具时，可用它检查参与地形着色的数据。

## 草地渲染器

每个地形都有一个 `grassRenderer`。草地按 layer 保存，每个 layer 可以有自己的草叶尺寸和 albedo 贴图。

```ts
const grassTexture = await getEngine().resourceManager.fetchTexture('/terrain/grass-blade.png');
const layer = terrain.grassRenderer.addLayer(0.12, 0.8, grassTexture);

terrain.grassRenderer.addInstances(0, [
  { x: 1, y: 2, angle: 0.2 },
  { x: 2, y: 3, angle: 1.1 }
]);
```

草实例会按空间结构组织以便裁剪。添加或删除实例时应尽量批量操作，避免每帧频繁修改单根草。

常用方法：

| 方法 | 用途 |
| --- | --- |
| `addLayer(width, height, texture)` | 添加草地层 |
| `setGrassTexture(layer, texture)` | 修改 layer 贴图 |
| `setBladeSize(layer, width, height)` | 修改草叶几何尺寸 |
| `addInstances(layer, instances)` | 批量添加草实例 |
| `removeInstances(layer, minX, minZ, maxX, maxZ, count)` | 删除区域内的草实例 |

草实例字段是 `x`、`y` 和 `angle`；其中 `y` 表示地形平面上的 Z 坐标。

## 序列化

`ClipmapTerrain`、它的材质、高度图 asset id、splat map asset id 和草地 asset id 都属于序列化系统的一部分。这也是编辑器中编辑后的地形可以随场景保存和恢复的原因。

如果你在运行时工具中生成地形，保存场景前应为生成的高度、splat 和草地资源分配稳定的 asset id。

## 性能建议

大范围室外地表适合使用 clipmap terrain。小型静态表面使用普通 `Mesh` 往往更简单。

高度图分辨率应和地形尺寸、所需细节匹配。过多 detail 贴图会增加材质开销，过多草实例会增加绘制和裁剪成本。
