# 体积云

大气散射天空支持两种云层：默认的 `procedural` 2D 云层，以及 WebGPU 上通过 ray marching 绘制的 `volumetric` 体积云。体积云有真实的层厚、自阴影和多次散射近似，代价是需要额外的噪声体和天空缓存更新。

## 启用

```ts
const sky = scene.env.sky;
sky.skyType = 'scatter';
sky.cloudMode = 'volumetric';

const clouds = sky.volumetricCloud;
clouds.layerBottomAltitude = 5000;
clouds.layerHeight = 10000;
clouds.coverage = 0.45;
clouds.density = 0.03;
clouds.wind.setXY(10, 0);
clouds.framesPerUpdate = 64;
clouds.cacheResolution = 768;
```

所有距离使用米。`coverage` 控制云量，`density` 控制厚度，`baseHeightVariation`、`formation` 和噪声缩放控制形状。`viewSampleCountScale` 和 `shadowSampleCountScale` 提高射线采样质量，也会线性增加开销。

## 资源与缓存

默认情况下引擎生成 weather、base noise 和 detail noise。需要固定艺术方向时，可把切片图集分别赋给 `sky.cloudWeatherMap`、`sky.cloudBaseNoise` 和 `sky.cloudDetailNoise`。天空缓存按 `framesPerUpdate` 分帧更新；降低该值能更快响应参数变化，但会增加每帧成本。

调试资源可设置：

```ts
sky.cloudDebugView = 'weather'; // 也可用 baseNoise、detailNoise、densityXY 等
```

## 限制

- `volumetric` 仅 WebGPU。其他后端会通过 `effectiveCloudMode` 自动退回 `procedural`，不会显示体积云。
- 需要 `skyType = 'scatter'` 才会绘制；天空盒模式只保留天空盒。
- 体积云不是场景几何体，不参与 Mesh LOD、SDF 或物理碰撞。
- 云层高度和 `scene.metersPerUnit` 必须使用一致的世界尺度；尺度不一致会导致云层过薄或过厚。
