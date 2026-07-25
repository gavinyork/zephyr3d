# 屏幕空间全局光照（SSGI）

SSGI 使用屏幕空间深度、法线和上一帧的线性 HDR 场景颜色估算漫反射间接光。它保存的是入射 irradiance；表面的 albedo、metallic 和 Fresnel 仍由下一帧的材质 Lighting/BRDF 应用，因此不需要额外的 SceneAlbedo MRT。

## 启用

SSGI 需要相机和 IBL 环境光同时允许：

```ts
scene.env.light.type = 'ibl';
scene.env.light.allowSSGI = true;
camera.SSGI = true;
```

只有相机启用 HDR、SSGI 强度大于 0 且 IBL 同时具有 radiance 和 irradiance 数据时才会启用，并要求设备支持可渲染的半浮点纹理、至少 2 个 draw buffers 及 16 字节/采样的颜色附件预算。WebGPU 使用 motion vector、Hi-Z、历史 SceneColor 和完整时域过滤；WebGL 使用线性步进、IBL Miss fallback、空间过滤和同像素深度/法线历史验证，不执行 motion-vector 时域过滤。

## 帧间数据流

1. LightPass 重投影上一帧已去噪的 SSGI irradiance；深度或法线验证失败时回退普通 diffuse IBL。Specular IBL 保持不变。
2. SSGI 在当前不透明 HDR SceneColor 上追踪余弦加权漫反射光线。
3. 命中时按 `previousHitUV = hitUV - motionVector(hitUV)` 采样上一帧 opaque SceneColor，并用命中表面的深度/法线验证历史；低置信度命中与 EnvLight directional radiance 混合，余弦采样结果乘以 π 后写入 irradiance。
4. 时域阶段执行深度/法线拒绝、邻域裁剪和 luminance moments 累积。
5. 使用 variance-guided cross-bilateral a-trous 去噪；半分辨率档位随后执行联合双边上采样。
6. 独立提交 SceneColor、irradiance、surface 和 moments 历史。

SSGI 位于 SSR、透明层、ToneMap、TAA 和 FXAA 之前，因此后续抗锯齿可以继续处理间接光噪点。它的历史资源与 TAA/SSR 相互独立。

## 质量档

| 档位 | 分辨率 | 每像素光线 | 最大步数 | a-trous 次数 |
| --- | --- | ---: | ---: | ---: |
| `quality` | 全分辨率 | 2 | 64 | 3 |
| `balanced` | 半分辨率 | 1 | 48 | 2 |
| `performance` | 半分辨率 | 1 | 24 | 1 |
| `custom` | 可配置 | 1–4 | 1–256 | 0–5 |

```ts
camera.ssgiQualityPreset = 'quality';
```

选择 `custom` 后可分别设置追踪分辨率、SPP、最大步数和去噪次数：

```ts
camera.ssgiQualityPreset = 'custom';
camera.ssgiHalfResolution = true;
camera.ssgiRaysPerPixel = 2;
camera.ssgiMaxSteps = 48;
camera.ssgiDenoisePasses = 2;
```

直接修改任意一项自定义参数也会自动将 preset 切换为 `custom`。

## 参数

| 属性 | 默认值 | 说明 |
| --- | ---: | --- |
| `ssgiIntensity` | `0.7` | 屏幕空间命中替换 IBL 的强度；Miss 仍保持 IBL |
| `ssgiMaxDistance` | `32` | 视空间最大追踪距离 |
| `ssgiThickness` | `0.5` | 深度相交厚度 |
| `ssgiStride` | `1` | 线性光线步进的像素步长 |
| `ssgiMaxRayIntensity` | `10` | 时域累积前的 firefly clamp |
| `ssgiTemporal` | `true` | 是否启用时域累积 |
| `ssgiTemporalWeight` | `0.94` | 有效历史帧权重 |
| `ssgiDepthReject` | `0.5` | 重投影深度拒绝阈值（场景单位） |
| `ssgiNormalReject` | `0.75` | 重投影法线点积阈值 |

所有属性都已接入场景序列化，并显示在编辑器的 `PostProcessing/SSGI` 和 `Environment/IBL` 分组中。

## 限制

屏幕外、被遮挡或历史无效的信息不能由 SSGI 命中；这些情况会稳定回退到 IBL。快速显隐、极薄几何和很大的相机切换仍可能暂时降低历史置信度。
