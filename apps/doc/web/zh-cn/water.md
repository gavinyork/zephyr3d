# 水面

`Water` 是用于渲染大范围动态水面的场景节点。它会围绕摄像机使用 clipmap 网格，并通过 `WaterMaterial` 采样场景颜色和场景深度，用于折射和基于深度的水体着色。

它适合海洋、湖泊、水池、河流，或任何不适合直接铺满普通网格的大面积水面。

## 基本设置

```ts
import {
  FFTWaveGenerator,
  FBMWaveGenerator,
  GerstnerWaveGenerator,
  Water
} from '@zephyr3d/scene';
import { Vector2, Vector3 } from '@zephyr3d/base';

const water = new Water(scene);
water.parent = scene.rootNode;

// X/Z 缩放控制水面区域。
water.position.setXYZ(0, 0, 0);
water.scale.setXYZ(200, 1, 200);

water.gridScale = 1;
water.animationSpeed = 1;

const waves = new FBMWaveGenerator();
waves.amplitude = 0.8;
waves.frequency = 0.025;
waves.numOctaves = 5;
waves.wind = new Vector2(1, 0.35);

water.waveGenerator = waves;
```

`Water` 会根据节点变换计算水平区域。移动节点可改变水面中心，缩放 X/Z 可改变覆盖范围。

<div class="showcase" case="tut-66"></div>

## 材质控制

水面材质可通过 `water.material` 访问。

```ts
water.material.depthMulti = 0.08;
water.material.displace = 0.35;
water.material.refractionStrength = 0.25;
water.TAAStrength = 0.4;
```

重要属性：

| 属性 | 含义 |
| --- | --- |
| `gridScale` | clipmap 网格间距，单位为世界坐标 |
| `animationSpeed` | 波浪时间倍率 |
| `wireframe` | 以线框方式显示 clipmap 网格，便于调试 |
| `TAAStrength` | 水面材质使用的时间平滑强度 |
| `material.depthMulti` | 水体着色的深度衰减倍率 |
| `material.displace` | 折射扰动强度 |
| `material.refractionStrength` | 场景颜色折射强度 |

由于水面材质会使用场景颜色和场景深度，水面会参与主场景渲染流程。调试最终效果时，需要同时考虑透明物体和后处理。

## 波浪生成器

`waveGenerator` 属性控制顶点位移、法线计算、泡沫数据和水面反馈查询。

| 生成器 | 用途 |
| --- | --- |
| `FBMWaveGenerator` | 快速程序化波浪，适合作为默认选择 |
| `GerstnerWaveGenerator` | 多层方向波，可手动控制每一组波 |
| `FFTWaveGenerator` | 海洋谱模拟，适合大范围海面，开销更高 |

### FBM 波浪

```ts
const waves = new FBMWaveGenerator();
waves.amplitude = 1.2;
waves.frequency = 0.018;
waves.numOctaves = 6;
waves.wind = new Vector2(0.8, 0.4);

water.waveGenerator = waves;
```

### Gerstner 波浪

```ts
const waves = new GerstnerWaveGenerator();
waves.numWaves = 4;

waves.setWaveDirection(0, 0.2);
waves.setWaveAmplitude(0, 0.4);
waves.setWaveLength(0, 18);
waves.setWaveSteepness(0, 0.6);

water.waveGenerator = waves;
```

### FFT 海面

```ts
const waves = new FFTWaveGenerator();
waves.wind = new Vector2(32, 18);
waves.foamWidth = 0.4;
waves.foamContrast = 1.5;

water.waveGenerator = waves;
```

`FFTWaveGenerator` 会分配 GPU 资源，更适合大范围海面，而不是小水池。

## 查询水面高度

如果玩法或工具需要获取扰动后的水面高度和法线，可以使用 `getSurfacePoint()`。

```ts
const query = [new Vector3(10, 0, 12)];
const positions = [new Vector3()];
const normals = [new Vector3()];

await water.getSurfacePoint(query, positions, normals);

boat.position.y = positions[0].y;
// 如果物体需要随波浪倾斜，可在自己的控制逻辑中使用 normals[0]。
```

这个方法会在下一帧运行一次 GPU feedback pass，因此是异步的。应把多个查询点合并到一次调用中，而不是每个对象单独调用一次。

## 序列化

`Water` 已注册到序列化系统中，其中包含水面材质相关参数，以及内置 `FBMWaveGenerator` / `FFTWaveGenerator` 的设置。因此，通过编辑器创建的水面节点和保存后的水面参数，可以通过 `loadScene()` 或 `instantiatePrefab()` 恢复。

`GerstnerWaveGenerator` 可以在运行时使用，但它目前不是序列化水面节点时已注册的 wave-generator 类型。

如果给水面材质设置了自定义纹理，序列化前需要确保这些纹理在 `ResourceManager` 中有稳定的 asset id。

## 性能建议

在细节满足需求的前提下，尽量使用更大的 `gridScale`。水面区域应贴近实际可见范围，避免创建多个互相重叠的大范围水面节点。

小型装饰水面通常使用 `FBMWaveGenerator` 即可。只有当海浪谱本身是视觉目标时，再考虑 FFT 水面。
