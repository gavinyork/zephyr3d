
# 反走样（Shadow Anti-Aliasing）

> 本页代码为片段示意，省略了 import 与应用初始化，完整可运行示例见页内嵌入的实例。

在 Zephyr3D 中，我们通过 **Shadow Map（阴影贴图）** 实现实时阴影。  
由于阴影贴图的分辨率有限，阴影边缘会出现明显的锯齿（aliasing），  
尤其在大型场景或低分辨率 ShadowMap 下更为突出。

为了获得平滑自然的阴影边缘，可以使用以下几种技术手段来减少或消除走样：

1. **提升 ShadowMap 分辨率**  
2. **使用滤波技术（PCF、PCSS、VSM、ESM）**
3. **采用分级阴影（CSM）**  
4. **优化阴影距离与生效范围**

下面详细介绍这些技术及其在 Zephyr3D 中的使用方式。

---

## 提高 ShadowMap 贴图分辨率

最直接的办法是增加阴影贴图的分辨率。  
ShadowMap 的分辨率越高，采样密度越大，阴影边缘越平滑；  
但同时会消耗更多显存和渲染时间。

可以通过设置 **`light.shadow.shadowMapSize`** 属性来调整阴影贴图大小。

```javascript
// 设置阴影贴图分辨率（单位像素）
light.shadow.shadowMapSize = 1024;
```

下面的示例可以通过按钮在 **256 像素** 和 **1024 像素** 阴影贴图之间切换。

<div class="showcase" case="tut-19" style="width:600px;height:500px"></div>

> 提示：
> - 提高分辨率虽能改善边缘质量，但会显著增加 GPU 负载。
> - 通常建议在性能和质量之间取得平衡，例如 1024–2048 像素较为常见。

---

## PCF（Percentage Closer Filtering）

**PCF** 是最常见的阴影反走样技术。  
它通过在阴影贴图中**多次采样**并取平均值来平滑边缘，  
本质上是一种**采样重叠模糊（filtering blur）**。

```javascript
// 使用 PCF
light.shadow.mode = 'pcf';
```

参数说明：

| 参数 | 作用 |
|------|------|
| `pcfKernelSize` | PCF 采样核尺寸，支持 `3`、`5`、`7`。数值越大，边缘越柔和，但采样开销更高，阴影也会更模糊。 |

示例：点击按钮可在 PCF 过滤阴影与常规硬边阴影之间切换。

<div class="showcase" case="tut-20" style="width:600px;height:500px"></div>

---

## PCSS（Percentage-Closer Soft Shadows）

**PCSS** 可以看作 PCF 的软阴影扩展。
它会先在阴影贴图中搜索遮挡物（blocker），再根据接收点与遮挡物的深度差估算半影大小，
最后使用可变半径进行滤波。这样可以得到接触处较硬、离遮挡物越远越柔和的阴影。

```javascript
// 启用 PCSS 阴影模式
light.shadow.mode = 'pcss';
```

参数说明：

| 参数 | 作用 |
|------|------|
| `pcssLightRadius` | 光源半径，以 ShadowMap texel 为单位。数值越大，半影越宽，阴影越柔和；设为 `0` 时基本退化为硬边过滤。 |
| `pcssBlockerSampleCount` | 遮挡物搜索采样数，范围为 `1` 到 `64`。数值越大，遮挡物估计越稳定，但查找阶段开销更高。 |
| `pcssFilterSampleCount` | 最终软阴影滤波采样数，范围为 `1` 到 `64`。数值越大，噪点越少、边缘越平滑，但片元着色成本更高。 |
| `pcssMaxFilterRadius` | 最大滤波半径，以 ShadowMap texel 为单位。用于限制半影扩张，避免阴影过度变宽或采样范围过大。 |
| `pcssTemporalJitter` | 是否随帧旋转 PCSS 采样图案，便于配合 TAA 累积出更平滑的软阴影；未使用 TAA 时可能带来轻微时间噪声。 |

示例：点击按钮可在 PCSS 软阴影和标准硬阴影之间切换。

<div class="showcase" case="tut-65" style="width:600px;height:500px"></div>

---

## VSM（Variance Shadow Mapping）

**VSM** 利用**统计学原理**降低阴影边缘的锯齿现象。  
它在阴影贴图中同时存储深度值的**均值与平方均值**，  
从而能根据方差推导出像素的阴影概率，实现平滑过渡。

```javascript
// 启用 VSM 阴影模式
light.shadow.mode = 'vsm';
```

特性：
- 阴影过渡自然无噪点；
- 在高亮镜面区域更稳定；
- 支持模糊半径调整；
- 可能出现**光漏现象（Light Bleeding）**，可通过阈值调节。

参数说明：

| 参数 | 作用 |
|------|------|
| `vsmBlurKernelSize` | VSM 后处理模糊核尺寸。较大的核会产生更平滑的边缘，但会增加模糊 pass 的采样成本。 |
| `vsmBlurRadius` | VSM 模糊半径。数值越大，阴影过渡带越宽；过大会削弱接触阴影细节。 |
| `vsmDarkness` | VSM 阴影暗度和光漏抑制强度。数值越高，阴影越深并能减少光漏；过高会压缩柔和过渡。 |

示例：点击按钮可在 VSM 阴影和传统硬边 ShadowMap 之间切换。

<div class="showcase" case="tut-21" style="width:600px;height:500px;"></div>

---

## ESM（Exponential Shadow Mapping）

**ESM** 使用**指数函数**对深度差进行建模。  
通过对阴影深度施加指数衰减，可在边界产生柔和且稳定的过渡效果。

```javascript
// 启用 ESM 阴影模式
light.shadow.mode = 'esm';
```

优点：
- 显著柔化阴影边缘；
- 几乎无噪点；
- 计算效率高。

注意：  
指数函数的参数需要视场景调节，以避免阴影过宽或过浅。

参数说明：

| 参数 | 作用 |
|------|------|
| `esmDepthScale` | 指数深度缩放系数。数值越大，阴影衰减越陡，边缘更锐利、阴影更强；数值较小时过渡更宽但可能显得偏浅。 |
| `esmBlur` | 是否启用 ESM 后处理模糊。开启后可以进一步柔化边缘，关闭后保留更直接的指数阴影结果。 |
| `esmLogSpace` | 是否在对数空间执行 ESM 模糊。开启后通常更稳定，能降低指数值过大或过小带来的数值问题。 |
| `esmBlurKernelSize` | ESM 模糊核尺寸，仅在 `esmBlur` 为 `true` 时生效。较大的核更平滑，但采样成本更高。 |
| `esmBlurRadius` | ESM 模糊半径，仅在 `esmBlur` 为 `true` 时生效。数值越大，阴影边缘越宽、越柔和。 |

示例：点击按钮可在 ESM 阴影和标准硬阴影之间切换。

<div class="showcase" case="tut-22" style="width:600px;height:500px;"></div>

---

## CSM（Cascaded Shadow Map）

**CSM（分级阴影贴图）** 是针对摄像机视锥（Camera Frustum）距离范围不同，
使用多级 ShadowMap 分片以提升近景细节精度的技术。

实现方式：
- 将视锥体沿深度方向分割为多个区间（通常 3–4 段）；  
- 每段单独渲染一张 ShadowMap；  
- 近处阴影分辨率更高，远处分辨率较低。

CSM 适用于：
- 大型地形、户外场景；
- 摄像机运动幅度较大的应用，如第三人称视角游戏。

示例：点击按钮可在 4 级 CSM 和单级硬阴影之间切换。

<div class="showcase" case="tut-23" style="width:600px;height:500px;"></div>

---

## 限制阴影距离（Shadow Distance）

如果阴影覆盖范围过大，
即使使用 CSM 也可能由于深度分配不均而产生锯齿失真。  
一种常见的优化方式是**限制阴影有效距离**，  
在超过该距离时平滑过渡至无阴影状态。

```javascript
// 限制阴影作用范围（单位：世界空间距离）
light.shadow.shadowDistance = 500;
```

此方法常用于：
- 大型户外场景；
- 提升性能、减小 ShadowMap 浪费；
- 让远处对象自动忽略阴影计算。

---

## 指定阴影范围（Shadow Region）

`ShadowRegion` 用于收紧方向光阴影贴图的世界空间覆盖范围。  
渲染时使用的最终范围是 `shadowRegion.region`，它由以下几部分取并集：

- `manualRegion`：通过 `setRegion(aabb)` 手动指定的 AABB；
- `staticRegion`：通过 `addStaticCaster(node)` 添加的静态投影体包围盒快照；
- `dynamicRegion`：通过 `addDynamicCaster(node)` 添加并随 `bvchanged` 事件更新的动态投影体包围盒。

如果最终范围为空，方向光阴影会退回使用整个场景包围盒。  
合理限制该区域可以让同样尺寸的 ShadowMap 覆盖更小的世界空间，从而提升阴影边缘精度。

```javascript
// 计算场景中所有可投射阴影节点的总体包围盒
const aabb = new AABB();
aabb.beginExtend();

scene.rootNode.iterate((node) => {
  if ((node.isMesh() || node.isClipmapTerrain()) && node.castShadow) {
    const bbox = node.getWorldBoundingVolume()?.toAABB();
    if (bbox) {
      aabb.extend(bbox.minPoint);
      aabb.extend(bbox.maxPoint);
    }
  }
});

// 将阴影范围限制在此区域内
light.shadow.shadowRegion.setRegion(aabb);
```

对于不会移动的物体，可以把当前世界包围盒作为静态快照加入；对于会移动或包围盒会变化的物体，应使用动态投影体：

`addStaticCaster()` 和 `addDynamicCaster()` 只接受 Mesh 或 ClipmapTerrain 节点；实际渲染阴影时，节点仍需要启用 `castShadow`。

```javascript
const shadowRegion = light.shadow.shadowRegion;

// 静态投影体：只记录添加时的世界包围盒
shadowRegion.addStaticCaster(building);

// 动态投影体：包围盒变化时自动更新 ShadowRegion
shadowRegion.addDynamicCaster(character);

// 移除单个投影体，或清空投影体列表
shadowRegion.removeCaster(character);
shadowRegion.clearCasters();
```

> **编辑器提示：**  
> 在 Zephyr3D 编辑器中可以通过可视化操作界面调整 ShadowRegion 的手动 AABB，  
> 以精确包围需要方向光阴影的区域，从而避免不必要的阴影贴图浪费。

---

## 阴影反走样方法对比

| 技术 | 核心机制 | 优点 | 缺点 | 性能开销 |
|------|------------|------|------|------------|
| **提高分辨率** | 增加采样密度 | 简单直接 | 显存占用高 | 🟠 中等 |
| **PCF** | 多点平均采样平滑边界 | 通用、无额外存储 | 存在模糊 | 🟡 中等偏高 |
| **PCSS** | 遮挡物搜索 + 可变半径 PCF | 接触处硬、远处软，更接近面积光阴影 | 采样次数多，可能需要 TAA 稳定 | 🔵 较高 |
| **VSM** | 利用方差统计实现平滑 | 稳定自然、可模糊 | 可能光漏 | 🟡 中等 |
| **ESM** | 深度指数衰减 | 柔和、无噪点 | 参数敏感 | 🟢 高效 |
| **CSM** | 多层分级 ShadowMap | 近景细节高 | 管理复杂 | 🔵 较高 |
| **hard** | 单次采样，不做过滤 | 开销最低 | 边缘锯齿明显 | 🟢 最低 |
| **dom** | 记录穿过介质的部分遮挡 | 头发等细密几何的柔和透光 | **仅 WebGPU**，其他后端回退 `pcf` | 🔵 较高 |

> `mode` 还可以取 `'hard'`（无过滤）和 `'dom'`（Deep Opacity Map，用于头发，
> 见[头发渲染](zh-cn/material-hair.md)）。另有 `'pcf-pd'` 和 `'pcf-opt'` 两个取值**已废弃**，
> 请改用 `'pcf'`。
>
> `light.shadow.applyQualityPreset(preset)` 可以一次性配好一组参数，预设有
> `'character-small'` 和 `'outdoor-large'` 两种。
