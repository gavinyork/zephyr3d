
# 反走样（Shadow Anti-Aliasing）

在 Zephyr3D 中，我们通过 **Shadow Map（阴影贴图）** 实现实时阴影。  
由于阴影贴图的分辨率有限，阴影边缘会出现明显的锯齿（aliasing），  
尤其在大型场景或低分辨率 ShadowMap 下更为突出。

为了获得平滑自然的阴影边缘，可以使用以下几种技术手段来减少或消除走样：

1. **提升 ShadowMap 分辨率**  
2. **使用滤波技术（PCF、VSM、ESM）**  
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

在下面的示例中：
- 上半部分的阴影贴图大小为 **256 像素**；
- 下半部分的阴影贴图大小为 **1024 像素**。

<div class="showcase" case="tut-19" style="width:600px;height:800px"></div>

> 提示：
> - 提高分辨率虽能改善边缘质量，但会显著增加 GPU 负载。
> - 通常建议在性能和质量之间取得平衡，例如 1024–2048 像素较为常见。

---

## PCF（Percentage Closer Filtering）

**PCF** 是最常见的阴影反走样技术。  
它通过在阴影贴图中**多次采样**并取平均值来平滑边缘，  
本质上是一种**采样重叠模糊（filtering blur）**。

```javascript

// 使用PCF
light.shadow.mode = 'pcf-opt';

```

示例：上半屏使用 PCF 模糊阴影，下半屏为常规硬边阴影。

<div class="showcase" case="tut-20" style="width:600px;height:800px"></div>

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

示例：上半屏启用 VSM，下半屏为传统 ShadowMap。

<div class="showcase" case="tut-21" style="width:600px;height:800px;"></div>

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

示例：上半屏使用 ESM，下半屏为标准硬阴影。

<div class="showcase" case="tut-22" style="width:600px;height:800px;"></div>

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

示例：

<div class="showcase" case="tut-23" style="width:600px;height:800px;"></div>

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

Zephyr3D 允许显式指定一个立方体区域（AABB），  
仅在该区域内计算阴影。  
这样可以进一步集中阴影贴图资源，用最低成本获得最佳质量。

```javascript
// 计算场景中所有可投射阴影网格的总体包围盒
const aabb = new AABB();
aabb.beginExtend();

scene.rootNode.iterate((node) => {
  if (node.isMesh() && node.castShadow) {
    const bbox = node.getWorldBoundingVolume().toAABB();
    aabb.extend(bbox.minPoint);
    aabb.extend(bbox.maxPoint);
  }
});

// 将阴影范围限制在此区域内
light.shadow.shadowRegion = aabb;
```

> **编辑器提示：**  
> 在 Zephyr3D 编辑器中可以通过可视化操作界面直接调整 ShadowRegion，  
> 以精确包围投射阴影的物体，从而避免不必要的阴影计算。

---

## 阴影反走样方法对比

| 技术 | 核心机制 | 优点 | 缺点 | 性能开销 |
|------|------------|------|------|------------|
| **提高分辨率** | 增加采样密度 | 简单直接 | 显存占用高 | 🟠 中等 |
| **PCF** | 多点平均采样平滑边界 | 通用、无额外存储 | 存在模糊 | 🟡 中等偏高 |
| **VSM** | 利用方差统计实现平滑 | 稳定自然、可模糊 | 可能光漏 | 🟡 中等 |
| **ESM** | 深度指数衰减 | 柔和、无噪点 | 参数敏感 | 🟢 高效 |
| **CSM** | 多层分级 ShadowMap | 近景细节高 | 管理复杂 | 🔵 较高 |

