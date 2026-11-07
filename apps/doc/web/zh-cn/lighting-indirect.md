
# 间接光照（Indirect Lighting）

本页介绍环境光（IBL、半球光）以及基于场景几何的动态漫反射全局光照 DDGI。

> 本页代码为片段示意，省略了 import 与应用初始化，完整可运行示例见页内嵌入的实例。

在 Zephyr3D 中，场景支持单一的**环境光源（Ambient Light）**，
它用于模拟来自周围环境的间接反射光照。

环境光通过 `scene.env.light` 属性进行设置，
其类型由 `scene.env.light.type` 决定。

目前有效取值为：

| 类型值 | 说明 |
|:--------|:------|
| `'ibl'` | 基于图像的光照（Image-Based Lighting, 适用于 PBR 材质） |
| `'hemisphere'` | 半球形天光（简单环境光近似） |
| `'constant'` | 纯色环境光，颜色由 `scene.env.light.ambientColor` 指定 |
| `'none'` | 无环境光照 |

默认值为 `'ibl'`。  
若设置为 `'none'`，场景中将完全关闭环境光照，仅保留直接光照（如方向光、点光等）。

`scene.env.light.strength` 是环境光的整体倍率，对所有类型都生效，设为 0 关闭环境光；`specularStrength` 单独缩放环境光的镜面反射部分。

---

## IBL（Image-Based Lighting，基于图像的间接光照）

**概念说明：**

IBL 以场景的天空作为光源，对天空进行球面积分，
预计算出环境反射（Radiance）与环境漫反射（Irradiance），  
进而在 PBR 材质中实现真实的间接光照和反射效果。

IBL 特点：
- 适用于 PBR 材质；
- 能够准确模拟物体与环境的光能交换；
- 光源就是当前的天空，天空盒和大气散射天空都可以驱动 IBL；
- 大气散射天空下，阳光方向或颜色变化时会自动重新烘焙，环境光随昼夜变化。

**使用步骤：**

1. 将 `scene.env.light.type` 设置为 `'ibl'`（默认值即为 `'ibl'`）；  
2. 设置天空类型，`scene.env.sky.skyType` 不能为 `'none'`：
   - `'scatter'`：大气散射天空，无需任何贴图，环境光由阳光方向实时决定；
   - `'skybox'`：天空盒，需要指定一张立方体贴图，可直接加载，也可以由 HDR 全景图转换而来。

使用大气散射天空时无需准备任何资源：

```javascript
scene.env.sky.skyType = 'scatter';
scene.env.light.type = 'ibl';
```

使用天空盒时，下例把 HDR 全景图转换为立方体贴图后作为天空盒：

```javascript
// 加载 HDR 全景图并生成 IBL 环境光
getEngine().resourceManager.fetchTexture('https://cdn.zephyr3d.org/doc/assets/images/Wide_Street.hdr')
  .then(tex => {
    // 创建立方体天空贴图 (512x512, RGBA16F 精度)
    const skyMap = myApp.device.createCubeTexture('rgba16f', 512);

    // 从全景图生成立方体贴图（等距投影 → Cubemap）
    panoramaToCubemap(tex, skyMap);

    // 设置天空模式为天空盒并应用贴图
    scene.env.sky.skyType = 'skybox';
    scene.env.sky.skyboxTexture = skyMap;

    // 启用 IBL 环境光照
    scene.env.light.type = 'ibl';
  });
```

> **注意事项：**
> - IBL 需要一个“天空源”（Sky Source）来计算环境反射，也就是说 `scene.env.sky.skyType` 不能为 `'none'`。
> - IBL 通常与 **PBRMetallicRoughnessMaterial** 一起使用。
> - 天空盒模式下动态更换天空贴图，或大气散射模式下改变阳光方向，环境光都会随之更新。

下面的示例可以通过左上角按钮开关 IBL 环境光。

<div class="showcase" case="tut-14" style="width:600px;height:500px;"></div>

---

## HemisphericLight（半球形天光）

**概念说明：**

Hemispheric Light（半球环境光）是对真实环境光的一种简化模拟。  
它假设物体上方受到来自天空的蓝色漫射光，下方受到地面的反射光（通常偏灰或棕色），  
并根据物体法线方向在上下两种颜色之间进行插值，从而产生柔和的环境照明效果。

该方式计算简单、实时高效，适用于非 PBR 材质或对性能要求较高的场景。

**使用方式：**

```javascript
// 设置环境光类型为半球形天光
scene.env.light.type = 'hemisphere';

// 定义天空颜色 (ambientUp)：偏蓝，代表来自上方的光
scene.env.light.ambientUp = new Vector4(0.3, 0.6, 1.0, 1.0);

// 定义地面颜色 (ambientDown)：偏灰，代表地面反射光
scene.env.light.ambientDown = new Vector4(0.2, 0.2, 0.2, 1.0);
```

> **提示：**
> - 半球光照不依赖天空盒；
> - 它只影响物体的环境光分量；
> - 对于 PBR Material 来说，效果较为粗糙，如果需要更真实的反射建议使用 IBL。

下面的示例可以通过左上角按钮开关半球环境光。

<div class="showcase" case="tut-15" style="width:600px;height:500px;"></div>

---

## 关闭环境光照

如果希望场景中仅保留直接光源（例如方向光、点光、聚光）而无环境影响，
可直接关闭环境光照：

```javascript
scene.env.light.type = 'none';
```

关闭后：
- PBR 材质将不会接收反射与辐照贡献；
- 非 PBR 材质仅受直接光照影响；
- 场景整体对比将增强，适合表现纯粹的舞台光环境。

---

## 基于 SDF 的 DDGI

**概念说明：**

上面几种环境光都与场景几何无关：墙角不会更暗，红墙也不会把旁边的白墙映红。
DDGI（Dynamic Diffuse Global Illumination，动态漫反射全局光照）在场景中布置探针，
用场景 SDF 发射探针射线，再把探针的辐照度和可见性插值到表面，从而得到随光源和几何实时变化的漫反射间接光。
Zephyr3D 的实现由体素材质场和多级 probe clipmap 组成，适合动态摄像机和中等规模的室外/室内场景。

DDGI 不是 `scene.env.light` 的一个取值，而是与它配合：在探针覆盖的范围内，DDGI 的结果**取代**环境光的漫反射部分，范围之外回退到环境光。探针结果不受 `scene.env.light.strength` 缩放，亮度用 `scene.gi.intensity` 调节。`scene.env.light.type = 'none'` 时也能工作。

**示例：Cornell box**

下面的示例是一个经典的 Cornell box：约 20 m 的白色盒子，左墙红、右墙绿，只有天花板上一盏矩形面光源，
环境光和天空都关掉，所以画面里除了直接光之外的亮度全部来自 DDGI。用左上角按钮切换 GI，
可以看到打开后阴影区不再全黑，两侧方块和天花板分别被染上红色和绿色。

场景是在编辑器里搭建并发布的项目，页面只负责加载并启动它。场景属性里打开了 SDF 和 GI，
各个墙体和方块的 SDF 已在编辑器中通过 **Mesh Settings > Bake SDF** 预烘焙为 `.zsdf`（参见[网格 SDF 与全局 SDF](sdf.md)），
运行时直接流式加载，不需要再调用 `scene.sdf.bakeField()`。

```typescript
// Keep the probes running and only scale their light, so switching back is instant
const intensity = scene.gi.intensity > 0 ? scene.gi.intensity : 1;
const setGI = (enabled: boolean) => {
  scene.gi.intensity = enabled ? intensity : 0;
  // ...update the button state
};
btnOff.addEventListener('click', () => setGI(false));
btnOn.addEventListener('click', () => setGI(true));
```

<div class="showcase" case="tut-88"></div>

> 首次打开需要等待资源加载、体素化和探针收敛，最初的画面不是最终效果。默认 `probeHysteresis` 为 0.97，探针每次更新只吸收约 3% 的新结果；如果几何体在探针开始更新之后才就位，残留的旧光照可能要几十秒甚至更久才散去。

**启用与参数：**

```ts
scene.sdf.enabled = true; // 先提供网格字段
scene.gi.enabled = true;

scene.gi.probeSpacing = 1;
scene.gi.probeGrid = [32, 16, 32];
scene.gi.probeLevels = 4;
scene.gi.probeRays = 128;
scene.gi.probeBudget = 4096;
```

`scene.gi.enabled` 会自动保持 `scene.sdf` 开启。只有带 SDF 字段（烘焙资源或 `bakeField()`）的静态网格会进入体素材质场；场景中的地形会自动参与，反照率取自地形本身，无需额外设置。

**收敛与画质：**

`probeSpacing` 决定最近一级的探针间距，`probeGrid` 是每一级的探针数。探针按 clipmap 分级，每级的间距和覆盖范围是上一级的两倍；`probeLevels` 是级数，上限和默认值都是 4，所以默认设置下不能再靠它扩大覆盖范围，需要更大范围时应增大 `probeSpacing` 或 `probeGrid`。默认设置下最近一级覆盖 32×16×32 单位，最远一级约 256×128×256 单位。`probeRays` 提高单探针的采样质量，`probeBudget` 决定每帧更新多少探针。

修改 `probeSpacing`、`probeGrid`、`probeLevels`、`probeRays`、`probeBudget` 会销毁探针体并从零重新收敛，不要在运行时频繁改动；`probeHysteresis`、`intensity`、`probeNormalBias`、`probeViewBias` 可以实时调整。提高 `probeHysteresis` 能减少闪烁，但会让光照变化更慢。漏光时先增大 `probeNormalBias` 或 `probeViewBias`，再检查 SDF 是否闭合和尺度是否正确。

动态场景保持默认的 `updateMode = 'continuous'`。场景稳定后可导出并冻结探针状态：

```ts
const state = await scene.gi.exportProbeState();
scene.gi.importProbeState(state); // 导入后自动切换为 frozen
scene.gi.updateMode = 'frozen';
```

> **限制与诊断：**
> - DDGI、全局 SDF 和体素光照仅 WebGPU；WebGL2 上 `scene.gi.enabled` 不会构建光照。
> - 探针间距和覆盖范围、全局 SDF（约相机周围 ±128 单位）都按场景单位计算，不随 `scene.metersPerUnit` 换算。以厘米为单位的场景需要相应放大 `probeSpacing`。
> - 首次启用需要等待 SDF 流式加载、体素化和探针收敛，不能把第一帧当作最终画质。
> - 用 `scene.gi.getStats()` 检查 `supported`、体素和 probe 的更新计数；用 `scene.sdf.getStats()` 检查缺失或未驻留的字段。
> - `atlasSize`、`voxelizeBudget` 和 `lightingSlicesPerFrame` 是显存与更新开销的主要旋钮。

---

## 小结

| 环境光类型 | 特征 | 适用材质 | 适合场景 | 性能 |
|-------------|--------|------------|------------|--------|
| **IBL** | 基于天空（天空盒或大气散射）的高精度反射与漫射光 | PBR | 写实、反射性场景 | 较高 |
| **Hemispheric** | 上下半球颜色插值的简化照明 | 受光照材质（Lambert、Blinn、PBR 等） | 低性能设备或卡通风格 | 高 |
| **Constant** | 单一颜色的均匀环境光 | 受光照材质 | 简单场景、调试 | 高 |
| **None** | 不计算间接光，仅保留直射光 | 任意 | 特效、暗场或特殊视觉风格 | 最高 |

DDGI 可与以上任一模式配合，在探针覆盖范围内取代其漫反射部分，提供随场景几何变化的漫反射间接光，仅 WebGPU，开销最高。

---

通过合理选择环境光模式，你可以在 Zephyr3D 中轻松平衡**视觉真实度**与**性能成本**。
