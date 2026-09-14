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
water.material.refractionScale = 1;
water.material.reflectionStrength = 0.8;
water.TAAStrength = 0.4;
```

| 参数 | 含义 |
| --- | --- |
| `gridScale` | clipmap 网格间距，单位为世界坐标。在细节够用的前提下尽量取大 |
| `animationSpeed` | 波浪时间倍率 |
| `wireframe` | 以线框方式显示 clipmap 网格，便于调试 |
| `TAAStrength` | 水面使用的时间平滑强度。画面有噪点或闪烁时调高，出现拖影时调低 |
| `material.refractionScale` | 折射偏移的艺术缩放。1 为物理值，0 关闭折射，大于 1 为夸张 |
| `material.reflectionStrength` | Fresnel 反射率缩放。1 为物理值；掠射角下水面几乎全反射，调低可以牺牲反射换取水下内容的可见度 |

水面材质会使用场景颜色和场景深度，因此水面参与主场景渲染流程。调试最终效果时需要同时考虑透明物体和后处理。

## 水体介质

水体的颜色由**吸收**和**散射**两个系数决定，都是每米、每 RGB 通道的物理系数（单位 1/m）。

```ts
// 澄清的池水：吸收低、散射低，能看清池底。
water.material.absorption = new Vector3(0.08, 0.03, 0.02);
water.material.scattering = new Vector3(0.01, 0.02, 0.03);

// 浑浊的海水：高散射让水体呈雾状蓝色。
// water.material.absorption = new Vector3(0.4, 0.14, 0.09);
// water.material.scattering = new Vector3(0.06, 0.12, 0.15);
```

| 参数 | 含义 |
| --- | --- |
| `absorption` | 光在水体中衰减的速度。越高、水越深，透过的光越少，水体越暗 |
| `scattering` | 光被水体甩回眼睛的量。越高水体越呈雾状、越不透明，同时也越能从内部发光 |
| `absorptionScale` / `scatteringScale` | 整体倍率，用于在不改动 RGB 比例的前提下快速调节浑浊度 |
| `mediumMode` | `physical`（默认）或 `ramp`。`ramp` 是旧版渐变贴图路径，仅为兼容按它调过的老场景 |

这两个系数是**共享的**：折射、焦散、方向性散射、折射模糊都读同一组值，改动会同时影响这几项。

## 折射

`refractionMode` 决定水下内容如何定位。

| 取值 | 效果与代价 |
| --- | --- |
| `march`（默认） | 水下物体的位置正确：物体不漂移、轮廓不撕裂。代价是每个水面像素约 24 次深度纹理采样 |
| `offset` | 不做深度检索，折射的方向和量级大致正确但落点错误，水下物体的边缘会糊开而不是保持不动。适合无法承担 `march` 的低端硬件 |

```ts
// 低端设备：放弃深度检索，换取性能。
water.material.refractionMode = 'offset';
water.material.cheapRefractionDepth = 1;
```

`cheapRefractionDepth`（米）只在 `offset` 模式生效，表示廉价模式假设的水深，决定扭曲的强度。

## 焦散

焦散是水面把阳光折射、聚焦到水下物体和池底的光斑网。它需要**投射阴影的方向光**和 WebGL2/WebGPU 设备，缺少任一者会自动关闭。

```ts
water.causticsEnabled = true;
water.causticsDepth = 4;
water.causticsRange = 60;
water.causticsIntensity = 1;
```

| 参数 | 含义 |
| --- | --- |
| `causticsEnabled` | 总开关。不需要焦散时保持 `false`，可省去整套光子投放与时间累积 |
| `causticsDepth` | 焦散最清晰的深度（米）。偏离该深度的接收面会逐渐**失焦**而不是发生位移，因此应设为池底/海床等主要接收几何所在的深度 |
| `causticsRange` | 焦散贴图从摄像机出发覆盖的最远距离（米）。这是上限而非固定范围，贴图会拟合到范围内实际有水面的部分。调大可照亮更多场景，代价是分辨率下降 |
| `causticsIntensity` | 焦散对比度。0 表示完全不调制光照，1 为默认的物理强度 |
| `causticsSceneDepth` | 让光子落在真实场景上而不是固定深度平面。默认 `true`；WebGPU 下无额外开销，WebGL2 下会退化为平面，此时 `causticsDepth` 就是接收面深度 |
| `causticsFadeDistance` | 贴图边缘淡出带的宽度（米）。0 表示自动从 `causticsRange` 推导 |

## 方向性散射

方向性散射让水体具有**方向相关**的颜色：它按光源计算，因此阴影落在水面上会同时压暗水体，低角度的太阳会为水体染色。关闭后水体只由环境光照亮，会失去方向感。

```ts
water.material.sunScatteringIntensity = 1;
water.material.scatterAnisotropy = 0.7;
```

| 参数 | 含义 |
| --- | --- |
| `sunScatteringIntensity` | 阳光从水体内部散射到眼睛的强度。1 是介质系数隐含的物理值，0 关闭，更大即为夸张 |
| `scatterAnisotropy` | 单次散射的相位各向异性，取值 [0, 0.95]。0 为各方向均匀，0.7（默认）接近海水的前向散射。水体越厚会越向各向同性靠拢，因此**实际可见的各向异性总是小于这个值** |

## 水下渲染

把摄像机移到水面以下，水就会接管整个画面：介质作用于整个场景、天空被水体取代、水面本身也改为从下方观察。无需手动开启——摄像机进入水面区域即自动生效。

```ts
water.underwaterEnabled = true;
water.underwaterAmbientIntensity = 1;
water.underwaterGodRays = true;
```

| 参数 | 含义 |
| --- | --- |
| `underwaterEnabled` | 总开关，默认 `true`。对于摄像机不会进入的水体可关闭 |
| `underwaterAmbientIntensity` | 充满水体的天空下行光缩放。远处的水最终收敛到这个颜色，因此它也决定了水下雾气的亮度 |
| `underwaterGodRays` | 穿过水体的阳光光柱，默认 `true` |
| `underwaterGodRayIntensity` | 光柱强度，1 为介质隐含的物理值 |
| `underwaterGodRaySteps` | 每条视线的采样数，默认 24。当光柱看起来像颗粒而不是光束时调大 |
| `underwaterGodRayShadow` | 让立在水中的几何体遮断光柱。默认 `false`；每个 march 步额外一次 shadow map 采样 |
| `underwaterHysteresis` | 入水判定在水面附近的迟滞带半宽（米） |

> 水下介质只作用于**不透明几何**。
>
> 入水判定针对水体的**静止平面**而非位移后的水面，因此当摄像机与水面的距离在一个波高以内时，判定可能与实际波形不符。

## 折射模糊

水越浑浊、越深，透过水看到的东西越模糊。

```ts
water.material.refractionBlur = 1;
```

`refractionBlur` 是这一模糊量的倍率：1 为介质系数隐含的物理量，0 让背景在任何深度都保持锐利。模糊的宽度由散射系数和路径长度决定，因此改动 `scattering` 也会改变模糊。这个效果几乎不额外消耗性能。澄清池水基本不模糊，浑浊水体在水下几米处就糊成一片——这是两者观感差异的主要来源之一。

## 波峰泡沫

波峰泡沫来自破碎浪尖的水面折叠，由 `waveGenerator` 提供折叠数据，材质将其映射为覆盖率。

```ts
water.material.foamAmount = 1;
water.material.foamFalloff = 1.5;
water.material.foamColor = new Vector3(0.92, 0.95, 0.97);
```

| 参数 | 含义 |
| --- | --- |
| `foamAmount` | 折叠量到覆盖率的缩放，0 关闭波峰泡沫 |
| `foamFalloff` | 覆盖率的幂次。大于 1 会把轻微折叠压向无泡沫，只让真正破碎的浪尖显示，避免强风海面整体发白 |
| `foamColor` | 泡沫的漫反射反照率，与近岸泡沫共用。略偏白偏蓝（水加空气），纯白会读起来像雪 |

泡沫是**被光照亮的**：它会抑制其下的高光和从水体中透出的颜色，并像磨砂表面一样响应太阳和环境光。

## 近岸泡沫

近岸泡沫是水面靠近固体时聚集的白沫：浅滩的水线，以及桥墩、船体、礁石与水面相交处的一圈。它与波峰泡沫彼此独立，可以单独开关。

**默认关闭**，且需要 WebGL2 或 WebGPU，在 WebGL1 上参数不生效。

```ts
water.shoreFoamAmount = 1;
water.shoreFoamDepth = 0.5;
water.shoreFoamWashAmount = 0.5;
```

| 参数 | 含义 |
| --- | --- |
| `shoreFoamAmount` | 覆盖强度，0 关闭（默认）。关闭时该特性的额外开销也一并省去 |
| `shoreFoamDepth` | 泡沫带从固体表面伸出的距离（米）。在水底上它是水深，在桥墩、船体这类竖直表面上它是到侧面的水平距离，同一个值同时管这两种情况。实际在画面上有多宽取决于几何：陡坡上是一条细线，缓滩上则是一大片 |
| `shoreFoamFalloff` | 带内的衰减指数。大于 1 把覆盖率压向贴近接触线的一侧，让外缘更薄、更碎 |
| `shoreFoamScale` | 泡沫团块的大小，以**横跨带宽的周期数**计。2.5 表示带上有两三个团块。因为是相对带宽而非绝对频率，同一个值在几米宽的海滩和一巴掌宽的桥墩圈上观感一致 |
| `shoreFoamWashAmount` | 水线来回冲刷的幅度，按 `shoreFoamDepth` 的比例计。0 是一条静止的白边；这个值是让它读起来像涌浪而非贴纸的关键。大于 1 时带会在周期低谷处完全闭合，看起来像泡沫在闪灭 |
| `shoreFoamWashSpeed` | 冲刷频率（次/秒）。这是涌浪而非风浪的节奏，通常远小于 1 |
| `shoreFoamWashScale` | 冲刷相位沿岸变化的空间频率（周期/米）。0 会让整条水线同步涨落，读起来像水位在升降；每几十米一个周期可以把长岸线打散成互不同步的段落 |

颜色由 `material.foamColor` 控制，与波峰泡沫共用。

这一效果依据摄像机看得到的画面内容推算，因此有以下限制：

- 物体移出画面后，它附近的泡沫会消失
- 被前景挡住的物体不产生泡沫
- 在画面上比几个像素还细的物体（缆绳、栏杆）可能完全不产生泡沫。调小 `shoreFoamDepth` 可以缓解

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

`FFTWaveGenerator` 会分配 GPU 资源，更适合大范围海面而不是小水池。它的波谱由三层级联（`setWaveLength` / `setWaveStrength` / `setWaveCroppiness`）控制，`foamWidth` / `foamContrast` 控制浮沫的宽度与对比度。它在 WebGPU 和 WebGL2（需支持半浮点颜色缓冲）下可用，其余设备会静默回退到没有波浪的平面。

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

- **小型装饰水面**：用 `FBMWaveGenerator` 即可。
- **海面 / 大范围波浪**：用 `FFTWaveGenerator`，尤其是在需要浮沫或浪尖折叠时。它会分配多张 FFT 纹理并每帧更新，GPU 成本随分辨率显著上升。
- **低端硬件**：把 `refractionMode` 设为 `offset`，省去每像素 24 次深度采样。
- **焦散**：需要投射阴影的方向光。不需要时保持 `causticsEnabled = false`。
- **近岸泡沫**：开启后每个水面像素增加十余次深度采样，并让场景的深度金字塔多一个通道。不需要时保持 `shoreFoamAmount = 0`。
- **折射模糊 / 方向性散射**：几乎无额外成本，是与介质系数联动的高性价比效果。
- **水下渲染**：摄像机在水面之上时零成本——该 pass 根本不会被构建进帧。入水后是两次全屏绘制；开启光柱时每像素额外增加 `underwaterGodRaySteps` 次焦散贴图采样，再打开 `underwaterGodRayShadow` 则再增加同样次数的 shadow map 采样。优先调小采样数，而不是直接关闭光柱。
