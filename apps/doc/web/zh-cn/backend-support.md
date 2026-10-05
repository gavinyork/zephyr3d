# 后端支持

> 本页代码为示意，省略了 import 与应用初始化。

Zephyr3D 有两个渲染后端：**WebGPU** 和 **WebGL2**（WebGL1 已不再支持）。大部分功能在两个后端上效果相同；一部分依赖计算着色器、存储缓冲或间接绘制的功能只在 WebGPU 上可用，在 WebGL2 上会降级或关闭。本页列出所有这类功能，以及它们在 WebGL2 上的实际表现，方便你在选定目标后端前判断取舍。

## 选择与检测后端

优先使用 WebGPU、不支持时回退到 WebGL2 的写法见[第一个应用](zh-cn/first-app.md)。运行时用设备类型判断当前后端：

```ts
const isWebGPU = getDevice().type === 'webgpu';
```

在 WebGL2 上开启了下表中会改变画面的功能时，引擎会在控制台打一条警告，每个功能只打一次，格式为：

```
[zephyr3d] A-buffer OIT (Camera.oitMode) requires WebGPU; transparent objects fall back to sorted alpha blending.
```

看到这类警告就说明：当前画面与 WebGPU 上不同，原因写在警告里。

## 在 WebGL2 上画面不同的功能

| 功能 | 开启方式 | WebGL2 上的表现 |
| --- | --- | --- |
| A-buffer OIT | `camera.oitMode = 'abuffer'` | 退回按距离排序的普通透明混合 |
| 双深度剥离 OIT | `camera.oitMode = 'dual-depth'` | 取决于设备扩展：有 `OES_draw_buffers_indexed` 与 `EXT_float_blend` 时可用，否则退回排序混合 |
| 屏幕空间次表面扩散 | 使用 `SSSMaterial` | 不做扩散，皮肤按无扩散光照显示；**透射仍然有效** |
| 焦散落在场景深度上 | `WaterMaterial.causticsSceneDepth`（默认开启） | 焦散投射到 `causticsDepth` 处的平面上，不随水底起伏 |
| 地形运行时虚拟纹理 | `terrain.runtimeVirtualTexture = true` | 不生效（读回仍为 `false`），地形每帧直接着色 |
| 几何草叶片 | `GrassRenderer.addLayer(..., 'blade')` | 叶片层不绘制；卡片草正常 |
| 深度不透明度阴影（DOM） | `light.shadow.mode = 'dom'` | 改用 `'pcf'` |
| 头发 strand | `Hair` 节点 | 不绘制，节点与数据保留 |
| 头发动力学 | `hair.simulationEnabled = true` | 不模拟，发丝保持静止姿态（头发本身在 WebGL2 上也不绘制） |
| GPU 布料 | `GPUClothComponent` | 布料不运动；原因也可从组件的 `disabledReason` 读取 |
| 渲染图 GPU 计时 | 渲染图 profiling | 每个范围的状态都报告为 `'unsupported'` |

`new VirtualTexture()` 是唯一会直接抛异常的：它是显式创建的底层对象，在 WebGL2 上没有可回退的实现。

## 只影响性能的回退

下面这些功能在 WebGL2 上改由 CPU 或其他方式完成，**画面与 WebGPU 相同**，只是更慢，因此不打警告：

| 功能 | WebGPU | WebGL2 |
| --- | --- | --- |
| `BatchGroup` 实例剔除与逐实例 LOD（`gpuInstanceCulling`，默认开启） | GPU 逐实例剔除、选级 | CPU 按整批剔除，每个 LOD 级别一批 |
| 动画库调色板计算（`AnimationBankTrack`，`evaluation: 'auto'`） | 计算 pass | CPU |
| 卡片草的放置 | GPU | CPU 按 tile 生成 |
| 草地遮挡剔除（`GrassRenderer.occlusionCulling`） | 生效 | 不生效（卡片草在 WebGL2 上走 CPU 放置，不经过这一步） |
| FFT 海浪、Hi-Z 生成 | 计算着色器 | 片元着色器实现，结果相同 |

## 容量差异

聚簇光照在两个后端上都可用，但 WebGL2 的上限更低：场景中最多 255 个光源，每个 cluster 最多 16 个光源（WebGPU 上分别是 65535 个，以及不限长度的 cluster 光源列表）。超出时引擎按光源影响范围与亮度保留最重要的那些，其余静默丢弃，不打警告，因为光源数量每帧都可能变化。光源很多的场景如果要支持 WebGL2，应在 WebGL2 上实际检查效果。

## 限制与坑

- **不要只看有没有报错。** 上表中的降级都不会抛异常，场景照常渲染。确认效果请在目标后端上实际查看，并留意控制台里的 `[zephyr3d]` 警告。
- **序列化的设置不会被改写。** 例如在 WebGL2 上打开一个设置了 `oitMode = 'abuffer'` 的场景，属性值仍是 `'abuffer'`，只是实际渲染时降级；同一个场景换到 WebGPU 上会恢复原效果。
- 编辑器属性面板中标注"WebGPU only"的属性，在 WebGL2 上编辑同样会触发上述降级。
