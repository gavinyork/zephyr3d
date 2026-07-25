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
| `ssgiMaxRayIntensity` | `10` | 控制变量修正前对屏幕空间 radiance 的 firefly clamp |
| `ssgiTemporal` | `true` | 是否启用时域累积 |
| `ssgiTemporalWeight` | `0.94` | 历史稳定后的最大有效历史帧权重 |
| `ssgiDepthReject` | `0.5` | 重投影深度拒绝阈值（场景单位） |
| `ssgiNormalReject` | `0.75` | 重投影法线点积阈值 |


