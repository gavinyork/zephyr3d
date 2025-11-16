
# 屏幕空间反射（Screen Space Reflections, SSR）

## 概述

**屏幕空间反射**（Screen Space Reflections，简称 SSR）是一种基于屏幕空间数据的实时反射技术。  
它通过分析 **当前帧缓冲（FrameBuffer）中的深度与法线信息**，对场景中可见的像素进行反射射线追踪，从而生成高质量的动态反射效果。

与传统的 **环境映射（Environment Mapping）** 或 **平面反射（Planar Reflection）** 不同，SSR 不需要额外的立方体贴图或反射摄像机。  
它完全基于屏幕可见数据运行，因此性能相对高效，并可在任意几何表面上实现**物理准确的实时反射**。

---

## 基础设置

### 启用/禁用 SSR

- **接口：** [Camera.SSR](/doc/markdown/./scene.camera.ssr)  
- **类型：** `boolean`  
- **默认值：** `false`

启用或关闭屏幕空间反射效果。

```javascript
// 开启SSR效果
camera.SSR = true;
```

### 启用 HiZ 加速

- **接口：** [Camera.HiZ](/doc/markdown/./scene.camera.hiz)  
- **类型：** `boolean`  
- **默认值：** `false`

开启 **HiZ（Hierarchical Z‑buffer）** 可显著提升屏幕空间反射或遮蔽计算性能。  
它使用层级深度金字塔结构加速屏幕空间光线追踪，仅支持 **WebGL2** 与 **WebGPU** 后端。

```javascript
// 启用HiZ加速以提升SSR性能
camera.HiZ = true;
```

> 当 HiZ 启用时，部分射线追踪属性（如 `ssrStride` 与 `ssrMaxDistance`）将被自动忽略。

---

## 表面属性与追踪控制

### 粗糙度控制

- **接口：** [Camera.ssrMaxRoughness](/doc/markdown/./scene.camera.ssrmaxroughness)  
- **取值范围：** `0.0 ~ 1.0`  
- **默认值：** `0.8`

设置允许 SSR 生效的表面粗糙度阈值。  
只有粗糙度低于该值的材质才会生成反射效果。

```javascript
// 粗糙度低于0.9的物体启用SSR
camera.ssrMaxRoughness = 0.9;
```

---

### 射线追踪参数

#### 单次步进距离

- **接口：** [Camera.ssrStride](/doc/markdown/./scene.camera.ssrstride)  
- **类型：** `number`  
- **默认值：** `2`

表示光线每次在屏幕空间前进的像素步长。  
步长越小，精度越高但性能下降。

```javascript
// 每次步进4个像素
camera.ssrStride = 4;
```

> 当 HiZ 启用时，此参数将被忽略。

---

#### 步进次数

- **接口：** [Camera.ssrIterations](/doc/markdown/./scene.camera.ssriterations)  
- **类型：** `number`  
- **默认值：** `120`

控制 SSR 光线的最大迭代次数。  
“步长 × 步进次数” 决定最大追踪深度，数值过大会降低性能。

```javascript
// 每条反射射线最多追踪200次
camera.ssrIterations = 200;
```

---

#### 最大追踪距离

- **接口：** [Camera.ssrMaxDistance](/doc/markdown/./scene.camera.ssrmaxdistance)  
- **类型：** `number`  
- **默认值：** `100`

控制摄像机空间中射线的最大反射距离。  
值越大，反射可涵盖更远的物体（性能损耗相应增加）。

```javascript
// 最大追踪500个单位距离
camera.ssrMaxDistance = 500;
```

---

#### 厚度阈值

- **接口：** [Camera.ssrThickness](/doc/markdown/./scene.camera.ssrthickness)  
- **类型：** `number`  
- **默认值：** `0.5`

定义物体表面相交检测时的厚度阈值，用于避免错误穿透。

```javascript
// 调整相交厚度阈值
camera.ssrThickness = 0.2;
```

---

#### 自动厚度计算

- **接口：** [Camera.ssrCalcThickness](/doc/markdown/./scene.camera.ssrcalcthickness)  
- **类型：** `boolean`  
- **默认值：** `false`

启用此功能后，将自动渲染双面深度缓冲以计算真实厚度。  
在某些复杂几何下可提升精度，但开销较大。  
当 HiZ 启用时，此选项被忽略。

```javascript
// 开启自动厚度计算
camera.ssrCalcThickness = true;
```

---

## 模糊与去噪控制

SSR 在粗糙表面或高采样场景中常伴随反射噪点，因此需要模糊滤波进行平滑处理。  
引擎支持高斯模糊与基于深度的双边滤波等多种策略。

### 模糊采样比例

- **接口：** [Camera.ssrBlurScale](/doc/markdown/./scene.camera.ssrblurscale)  
- **类型：** `number`  
- **默认值：** `0.05`

控制模糊影响范围。值越大模糊越强，细节丢失越多。

```javascript
camera.ssrBlurScale = 0.03;
```

---

### 深度阈值

- **接口：** [Camera.ssrBlurDepthCutoff](/doc/markdown/./scene.camera.ssrblurdepthcutoff)  
- **类型：** `number`  
- **默认值：** `2.0`

用于控制双边滤波时的深度敏感度。  
值越小，边缘保留效果越明显，模糊更“锐利”。

```javascript
camera.ssrBlurDepthCutoff = 4;
```

---

### 模糊核心大小

- **接口：** [Camera.ssrBlurKernelSize](/doc/markdown/./scene.camera.ssrblurkernelsize)  
- **类型：** `number`  
- **默认值：** `17`

定义用于模糊的核大小。  
较大的值产生更柔和的模糊，但性能开销更大。

```javascript
camera.ssrBlurKernelSize = 5;
```

---

### 模糊标准差

- **接口：** [Camera.ssrBlurStdDev](/doc/markdown/./scene.camera.ssrblurstddev)  
- **类型：** `number`  
- **默认值：** `10`

控制高斯权重曲线的分布范围，更高的值提供更强的模糊。

```javascript
camera.ssrBlurStdDev = 4;
```

---

## 综合建议

| 目标效果 | 参数建议 |
|-----------|----------|
| 高精度镜面反射（金属） | `stride = 2`, `iterations = 120`, `ssrMaxRoughness = 0.3`, 禁用自动厚度 |
| 柔和反射（水面、玻璃） | `blurScale = 0.05`, `blurKernelSize = 9`, `blurStdDev = 6` |
| 高性能模式（移动端） | 启用 `HiZ`，降低 `iterations` 至 `60`，关闭 `calcThickness` |
| 高质量桌面效果 | 启用 `HiZ`，`blurKernelSize = 17`，`ssrBlurDepthCutoff = 1.5` |

---

## 效果示例

```javascript
// 示例配置：金属反射 + 模糊去噪
camera.SSR = true;
camera.HiZ = true;
camera.ssrMaxRoughness = 0.6;
camera.ssrIterations = 150;
camera.ssrThickness = 0.4;
camera.ssrBlurScale = 0.05;
camera.ssrBlurKernelSize = 9;
camera.ssrBlurStdDev = 6;
```

<div class="showcase" case="tut-49"></div>

---

## 总结

屏幕空间反射无需离线反射贴图或多摄像机渲染即可提供实时的镜面反馈，  
在金属、玻璃、水面等材质中能显著提升视觉真实感。

- SSR 带来高质量实时反射，但受限于屏幕可见范围；  
- 可通过 **HiZ** 与 **模糊去噪** 平衡质量与性能；  
- 与 **TAA**、**Bloom** 等后处理配合使用可获得更自然的画面表现。

> 建议在动态反射频繁的场景（如雨地、写实镜面室内）启用 SSR，  
> 并结合适当的模糊与粗糙度调节以获得最佳视觉效果。
