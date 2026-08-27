# 顺序无关的透明度渲染（Order‑Independent Transparency, OIT）

## 概述

在传统的渲染流水线中，**透明物体必须按照从远到近的顺序绘制**，  
否则会由于混合（Blending）顺序不一致而导致透明重叠错误。  
然而，在复杂场景或深度排序困难（如体积粒子、水面重叠、半透明模型互穿）的情况下，  
这种方式会显著增加 CPU 开销甚至无法正确排序。

为了解决这一问题，Zephyr3D 提供了 **顺序无关透明度渲染（Order‑Independent Transparency, OIT）** 技术。  
OIT 允许透明片元在无需显式排序的情况下正确混合，从而在性能与质量之间取得平衡。

我们的引擎支持以下三种 OIT 技术：

1. **Weighted Blended OIT** —— 基于加权平均的高性能透明度混合方案；  
2. **Per‑Pixel Linked List OIT（ABuffer OIT）** —— 精确排序的像素级链表方案；  
3. **Dual Depth Peeling OIT** —— 逐层剥离深度的方案，精度和兼容性介于两者之间。

> 本页代码为片段示意，省略了 import 与应用初始化，完整可运行示例见页内嵌入的实例。

---

## Weighted Blended OIT

### 原理简介

**Weighted Blended OIT** 是一种基于权重的透明度混合技术。  
它在片元着色阶段为每个片元计算颜色与透明度的加权值，  
随后在后期合成阶段对所有片元的结果进行加权平均，从而得到视觉上合理的透明效果。

该方法不需要构建链表或进行排序，因此性能极高，  
非常适合实时渲染、动态场景与资源受限的平台（如移动端或 WebGL 环境）。

### 优缺点

**优点：**
- 算法简单，性能优异；
- 可在复杂场景中保持较高的视觉质量；
- 支持多种后处理效果（Bloom、TAA 等）联合使用。

**缺点：**
- 属于近似算法，无法在所有情况下实现完全正确的排序；
- 当透明层重叠极多时，可能产生轻微的色偏或混合误差。

### 支持平台

支持 **WebGL / WebGL2 / WebGPU** 设备。

### 用法示例

```javascript  
// 为相机启用 Weighted Blended OIT 渲染透明物体  
camera.oit = new WeightedBlendedOIT();  
```

这种方法适用于大多数带有透明效果的物体（例如玻璃、水、植被、粒子等）。

> 提示  
> 在启用 Weighted Blended OIT 时，无需进行透明物体的排序处理。


---

## Per‑Pixel Linked List OIT（ABuffer OIT）

### 原理简介

**Per‑Pixel Linked List OIT**（又称 **ABuffer OIT**）是一种基于链表存储的高精度透明度算法。  
在渲染阶段，它为每个像素构建一个链表结构，链表中记录所有命中的透明片元的颜色与深度信息。  
随后在合成阶段对这些片元按深度顺序进行精确混合，由此获得完全正确的透明叠加结果。

### 优缺点

**优点：**
- 渲染结果与传统从远到近排序完全一致；
- 可在极其复杂的透明场景下保持正确并精确的视觉表现；
- 对光照、后期以及反射系统兼容性极佳。

**缺点：**
- 需要更多显存和 GPU 计算资源；
- 不适合在低端设备或性能敏感应用中使用。

### 支持平台

仅支持 **WebGPU** 设备。

### 用法示例

```javascript  
// 为相机启用 Per‑Pixel Linked List OIT（ABuffer OIT）渲染透明物体  
// 构造函数参数用于设定支持的最大透明层级数量，默认值为 16  
camera.oit = new ABufferOIT(20);  
```

> 建议  
> 在每像素透明层级较多（如体积特效、水雾、玻璃幕墙等）时，  
> 可适当提升层级数量（如 24 或 32）以获得更佳质量；  
> 但数值过大会显著提升内存与性能开销。

---

## Dual Depth Peeling OIT

### 原理简介

**Dual Depth Peeling** 每一趟渲染同时剥离当前最近和最远的一层透明片元，因此一趟能处理两层，
迭代若干趟后再把前向和后向累积的颜色合成起来。相比 ABuffer 不需要为每像素分配链表存储，
相比 Weighted Blended 又能得到按层精确混合的结果。

层数由构造参数决定，超出层数的片元不会被正确混合，所以它的精度取决于给定的迭代次数。

### 支持平台

需要设备同时具备：多渲染目标（至少 3 个）、逐目标混合、min/max 混合方程、
可混合的浮点颜色缓冲。**WebGL1 不满足条件**；WebGL2 视具体实现而定，WebGPU 通常都支持。

能力不足时 `supportDevice()` 返回 false，透明物体会**自动退回按排序的普通 alpha 混合**，
不会报错——所以在目标平台上要实际确认它是否生效。

### 用法示例

```javascript
// 参数为初始化 pass 之后的剥离迭代次数，默认 8
camera.oit = new DualDepthPeelingOIT(8);
```

也可以通过 `camera.oitMode` 用字符串选择，三种模式分别对应
`'weighted'`、`'abuffer'` 和 `'dual-depth'`（`'none'` 表示关闭）：

```javascript
camera.oitMode = 'dual-depth';
```

---

## 效果对比

下面的演示中有多个相互穿插的透明球体和圆环，它们的混合顺序随动画持续变化。
可以在四种模式之间切换对比：关闭 OIT 时能明显看到混合顺序错误产生的瑕疵。

该示例会优先创建 WebGPU 设备，不支持则依次回退到 WebGL2 和 WebGL，并在界面上显示当前设备类型。**当前设备不支持的模式会被置灰**——例如在 WebGL2 上 ABuffer 不可用。

<div class="showcase" case="tut-67"></div>

---

## 资源管理与释放

当camera被释放时会自行释放其持有的OIT资源

---

## 性能与使用建议

| 技术类型 | `oitMode` | 精度 | 性能表现 | 适用平台 | 建议 |
|-----------|-----------|-------|------------|------------|------|
| **Weighted Blended OIT** | `'weighted'` | 近似 | 极佳（高帧率） | WebGL / WebGL2 / WebGPU | 默认推荐使用 |
| **Dual Depth Peeling OIT** | `'dual-depth'` | 按层精确，受层数限制 | 中等（趟数越多越慢） | WebGL2 / WebGPU（依赖能力检测） | 需要比加权更准、又不便用 ABuffer 时 |
| **Per‑Pixel Linked List OIT** | `'abuffer'` | 精确 | 较高（显存开销大） | WebGPU | 对质量要求极高时使用 |

> 推荐实践：  
> 1. 优先使用 **Weighted Blended OIT**，在性能与效果间取得最佳平衡。  
> 2. 若平台支持 WebGPU，且场景包含大量重叠透明层，可启用 **ABuffer OIT**。  
> 3. 介于两者之间的需求可以试 **Dual Depth Peeling**，但要注意它在能力不足时会静默退回排序混合。  
> 4. 若与 **几何体实例化** 结合使用透明对象，请务必启用 OIT 以避免排序误差。  
> 5. 可与 **TAA**、**Bloom**、**SSR** 等后处理协同使用，增强最终视觉质量。

---

## 总结

顺序无关透明度渲染（OIT）是现代实时渲染中不可或缺的关键技术。  
它消除了透明物体渲染对前后顺序的依赖，使渲染系统可在保持高帧率的同时获得正确的透明组合效果。

- **Weighted Blended OIT**：性能优先，近似混合，适合大多数透明场景；  
- **Dual Depth Peeling OIT**：按层剥离，精度取决于迭代趟数，能力不足会静默退回排序混合；  
- **ABuffer（Per‑Pixel Linked List）OIT**：质量优先，像素精确混合，用于复杂或高端项目。

通过 OIT，Zephyr3D 的透明度渲染在 **精度、性能与易用性** 之间达成理想平衡。
