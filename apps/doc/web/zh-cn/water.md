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

重要属性：

| 属性 | 含义 |
| --- | --- |
| `gridScale` | clipmap 网格间距，单位为世界坐标 |
| `animationSpeed` | 波浪时间倍率 |
| `wireframe` | 以线框方式显示 clipmap 网格，便于调试 |
| `TAAStrength` | 水面材质使用的时间平滑强度 |
| `material.refractionScale` | 折射偏移的艺术缩放，1 为物理值，0 关闭折射 |
| `material.reflectionStrength` | Fresnel 反射率缩放，1 为物理值，调低可让水下内容更清晰 |

水下折射不再是沿法线推屏幕 UV，而是按 Snell 定律折射视线、追踪到水下物体、再把命中点重投影回屏幕。入射角、水深和透视缩放都由此自然得出，因此 `refractionScale` 只是风格化开关，默认值 1 已是物理正确的强度。

由于水面材质会使用场景颜色和场景深度，水面会参与主场景渲染流程。调试最终效果时，需要同时考虑透明物体和后处理。

## 水体介质

水体的颜色由**吸收**和**散射**两个系数决定。两者都是每米、每 RGB 通道的物理系数（单位 1/m）。

```ts
// 澄清的池水：吸收低、散射低，能看清池底。
water.material.absorption = new Vector3(0.08, 0.03, 0.02);
water.material.scattering = new Vector3(0.01, 0.02, 0.03);

// 浑浊的海水：高散射让水体呈雾状蓝色。
// water.material.absorption = new Vector3(0.4, 0.14, 0.09);
// water.material.scattering = new Vector3(0.06, 0.12, 0.15);
```

- **吸收**（`absorption`）决定光在水体中衰减的速度。吸收越高、水越深，透过的光越少，水体越暗。
- **散射**（`scattering`）决定光被水体甩回眼睛的量。散射越高，水体呈雾状、越不透明，但也越能从内部发光。
- `absorptionScale` / `scatteringScale` 是整体倍率，方便在不改 RGB 比例的前提下快速调节浑浊度。
- `mediumMode` 可设为 `physical`（默认，Beer-Lambert 物理介质）或 `ramp`（旧版渐变贴图，仅为兼容老场景）。

水体是被**介质穿过的**，所以折射、焦散、方向性散射、折射模糊都共享同一套介质系数——改变吸收/散射会同时影响这几项，而不是各自独立。

## 折射

折射负责把"水下的内容"正确地移到眼前。水面材质有 `refractionMode` 属性：

- **`march`（默认）**：按 Snell 定律折射视线，沿折射方向在场景深度缓冲上做 `REFRACT_MARCH_STEPS` 次**步进**，取第一个与场景的交点。命中点会正确跟随水下物体，物体不漂移、边界不撕裂。代价是每个水面像素要 `24` 次深度纹理读取。
- **`offset`（廉价模式）**：不做深度检索，直接用波法线偏移屏幕 UV。节省了所有步进，但折射到**错误的点**——水下物体的边缘会"糊开"而不是保持不动。适合无法承担 march 低端硬件。

```ts
// 低端设备：放弃深度检索，换取性能。
water.material.refractionMode = 'offset';
water.material.cheapRefractionDepth = 1;
```

`cheapRefractionDepth` 只在 `offset` 模式生效，表示水面假设的深度（米），决定廉价折射的偏移强度。它是**定值**而非到水底的真实距离——若用真实距离，跨越物体轮廓时会画出物体的第二份拷贝。

## 焦散

焦散是水体表面把阳光折射、聚焦到水下物体/池底的光斑网。需要**投影阴影的方向光**和 WebGL2/WebGPU 设备；缺少任一者会自动关闭。

```ts
water.causticsEnabled = true;
water.causticsDepth = 4;      // 焦散聚焦深度（米），应接近水下接收面（池底/海床）的深度
water.causticsRange = 60;     // 焦散贴图覆盖范围（米），贴图会拟合到该范围内可见的水面
water.causticsIntensity = 1;  // 焦散对比度，0 表示不调制光
```

- `causticsDepth`：焦散最清晰的深度。光子被投到该深度的水平面上，偏离该深度的接收面会逐渐**失焦**而非位移，所以设为应显示最清晰花纹的池底/海床深度。
- `causticsRange`：从摄像机出发焦散贴图能覆盖的最远距离。是上限而非固定范围：贴图会拟合到该范围内实际有水面的部分。提高它可照亮更多场景，代价是分辨率下降。
- `causticsSceneDepth`：是否让光子落在场景上（而非固定深度平面）。默认 `true`，在 WebGPU 下复用太阳光的 shadow cascade 作为场景深度贴图，**开销为零**；在 WebGL2 下退化为平面，此时 `causticsDepth` 就是接收面的深度。注意：无论哪种后端，`causticsDepth` 都该设为大部分接收几何所在的深度。
- `causticsIntensity`：焦散对比度强度。0 表示完全不调制光；`1` 是默认的物理强度。
- `causticsFadeDistance`：贴图边缘淡出带宽度（米），`0` 自动从 `causticsRange` 推导。
- 若水面**高于**池壁（例如水面在 y=4、池底在 y=0），焦散会偏移 `depth / tan(太阳仰角)`，导致焦散边界与墙体阴影出现**空白带**。让水面贴着池沿、并让水面区覆盖到接收面的整片区域，可让焦散与阴影对齐。

## 方向性散射

方向性散射让水体具有**方向相关**的颜色：它按每个光源计算，因此影子落在水面上会同时变暗水体，低角度太阳会为水体染色。这是水体看起来有体积感的关键。

```ts
water.material.sunScatteringIntensity = 1;  // 1 = 介质系数隐含的物理强度，0 = 关闭
water.material.scatterAnisotropy = 0.7;     // 单次散射平均余弦，[0, 0.95]
```

- `sunScatteringIntensity`：阳光从水体内部散射到眼睛的强度。`1` 是介质系数隐含的物理值，提高即夸大效果。关闭后水体只由环境光照亮，失去方向感。
- `scatterAnisotropy`：单次散射的相位函数各向异性。`0` 各方向均匀；`0.7`（默认）接近海水的前向散射。随水体光学厚度增加会向各向同性混合（即多次散射的效果），所以**可见的各向异性总是小于这个值**。

## 折射模糊

随介质光学深度增加，透过水看的东西会模糊：散射让透射光线在每次散射事件中偏折一个小角度，到达水面的图像是这些事件卷积的结果。

```ts
water.material.refractionBlur = 1;  // 1 = 介质系数隐含的模糊量，0 = 保持背景锐利
```

模糊宽度由**散射系数**和路径长度导出，`refractionBlur` 是风格化倍率而非幅度本身。它不额外消耗：只是选择折射背景的 mip 级别（而该背景无论如何都会生成）。浑浊水体从水下几米处开始明显模糊，澄清池水几乎不模糊——这是两者视觉差异的重要来源。

## 泡沫

泡沫是破碎波峰前沿的水面**折叠**被渲染成漫反射白色层。`waveGenerator` 报告表面哪里折叠过，材质把折叠量映成覆盖率。

```ts
water.material.foamAmount = 1;      // 0 = 关闭泡沫
water.material.foamFalloff = 1.5;   // 大于 1 时，轻微折叠不产生泡沫，只有真正破碎的浪峰才显示
water.material.foamColor = new Vector3(0.92, 0.95, 0.97);
```

- `foamAmount`：折叠量到覆盖率的缩放，0 关闭泡沫。
- `foamFalloff`：应用于泡沫覆盖率的幂。大于 1 会把轻微折叠压向无泡沫，只有真正破碎的浪峰显示——避免强风海面整体发白。
- `foamColor`：泡沫的漫反射反照率。略偏白偏蓝（海水加空气），纯白会读起来像雪。
- 泡沫是**被光照亮的**：它抑制其下的高光，也抑制从水体中透出的颜色，并以类似磨砂表面的方式响应太阳与环境光。

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

`FFTWaveGenerator` 会分配 GPU 资源，更适合大范围海面，而不是小水池。它的波谱由三层级联（`setWaveLength` / `setWaveStrength` / `setWaveCroppiness`）控制；`foamWidth` / `foamContrast` 控制浮沫宽度与对比度。`FFTWaveGenerator` 在 WebGPU / WebGL2（支持半浮点颜色缓冲）下可用；其余设备会静默回退到没有波浪。

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
- **低端硬件**：把 `refractionMode` 设为 `offset`，关闭深度检索的 24 次步进。
- **焦散**：需要投影阴影的方向光。若不需要焦散，保持 `causticsEnabled = false` 可省去整套光子投放与时间累积。
- **折射模糊 / 方向性散射**：几乎无额外成本，是与介质系数联动的高性价比效果。
