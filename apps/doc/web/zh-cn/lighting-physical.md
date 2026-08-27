# 物理光照模式

::: warning 试验性功能
物理光照模式目前是**试验性功能**，接口和标定方式在后续版本中可能调整。
生产项目请谨慎使用，或做好后续需要适配的准备。默认的 `legacy` 模式行为已冻结，不会变动。
:::

引擎支持两套光照单位模型，由 `Scene.lightingMode` 选择：

- **`legacy`（默认）** —— 无单位模型。灯光的 `intensity` 是一个任意倍数，色调映射用
  `camera.toneMapExposure` 控制曝光。
- **`physical`** —— 全流程使用真实的光度单位（照度、光通量、亮度），相机曝光由光圈、
  快门、ISO 推导。

```javascript
scene.lightingMode = 'physical';
```

**这个开关会重新解释场景中每个光源、材质和曝光值的含义。** 切换之后原有的 `intensity`
和 `toneMapExposure` 不再生效，画面会明显变化——这不是 bug，而是两套模型的量纲不同。

## 什么时候用它

适合：

- 要复现真实世界的光照强度（例如正午阳光约 100,000 lux、室内照明数百 lux）；
- 需要和摄影参数对应的曝光控制（光圈/快门/ISO）；
- 从 DCC 工具或实拍数据带过来的是物理量而不是美术调出来的倍数。

如果你只是想把场景调好看，`legacy` 模式更直接，也不用理解光度单位。

## 单位对照

物理模式遵循 Filament 的约定：

| 对象 | 单位 | 属性 |
| --- | --- | --- |
| 平行光 | lux（lm/m²） | `DirectionalLight.illuminance` |
| 点光 | lumen（录入）/ candela（着色） | `luminousPower` / `luminousIntensity` |
| 锥光 | lumen（录入）/ candela（着色） | `luminousPower` / `luminousIntensity` |
| 面光源 | cd/m²（nit） | `RectLight.luminance` |
| 环境光 / IBL | cd/m²（nit） | `EnvLightWrapper.intensity` |
| 自发光材质 | cd/m²（nit） | `emissiveLuminance` |
| 相机曝光 | 无单位倍数 | `Camera.exposure`（只读，由摄影参数推导） |

点光和锥光有两个相关属性：`luminousPower`（光通量，即灯泡包装上标的流明数）便于录入，
`luminousIntensity`（光强，candela）是着色实际使用的量，两者按 Filament 的公式换算。

## 光度相机

物理模式下曝光不再用 `toneMapExposure`，而是由摄影三要素推导：

```javascript
camera.aperture = 16;          // 光圈 f 值
camera.shutterSpeed = 1 / 125; // 快门时间（秒）
camera.ISO = 100;              // 感光度
camera.exposureCompensation = 0; // 曝光补偿（EV 档数）

// 只读：由上面四项推导
console.log(camera.EV100);     // 摄影 EV100
console.log(camera.exposure);  // 场景线性曝光倍数
```

默认值就是摄影上的 **Sunny 16** 参考（f/16、1/125 秒、ISO 100），配合平行光默认的
100,000 lux 照度，正好对应正午晴天的正确曝光。所以切到物理模式后如果不改任何参数，
默认场景是曝光正常的。

相机还可以用真实镜头参数决定视场角：

```javascript
camera.projectionMode = 'physical';
camera.focalLengthMm = 35;     // 焦距
camera.sensorWidthMm = 36;     // 传感器尺寸（默认 35mm 全画幅）
camera.sensorHeightMm = 24;
camera.sensorFit = 'horizontal'; // 用哪个方向的传感器尺寸推导 FOV
```

`projectionMode` 保持默认的 `'fov'` 时仍然使用 `fovY`，这两种参数化方式互不影响，
可以只用曝光部分而不用镜头部分。

## 场景尺度

物理光照涉及平方反比衰减，所以引擎需要知道一个场景单位等于多少米：

```javascript
scene.metersPerUnit = 1;    // 默认：1 单位 = 1 米
scene.metersPerUnit = 0.01; // 1 单位 = 1 厘米
```

设置正确以后，改变场景尺度不会改变实际的光照结果——引擎会相应换算光强，
让同一个物理距离上的照度保持一致。

## 曝光在哪一步发生

物理模式在 **CPU 上预曝光**：每个光源的量在上传前就乘上了相机曝光，
所以 HDR 渲染目标的数值保持在 1.0 附近。这样做的好处是下游的 bloom、SSR、SSGI、雾
都不需要知道单位，色调映射只负责应用 ACES 曲线。

**自发光是唯一的例外**，因为它写在材质上而不是光源上。它在 shader 里曝光，
由 `emissiveExposureWeight` 决定曝光是否生效：

- 为 1 时 `emissiveLuminance` 是真正的 cd/m² 亮度；
- 为 0 时曝光被抵消，`emissiveLuminance` 退化成一个显示参考的倍数。

默认值是 1。但**导入的模型材质会被设为 0**，以保持 glTF 显示参考的自发光语义，让同一份资产在
两种光照模式下渲染一致。这带来一个实际后果：导入材质上的 `emissiveLuminance` **不是** cd/m²，
而是一个已经在 1 附近就很亮、且忽略光圈/快门/ISO 的显示参考倍数。要把这类材质改成按物理量
调整，需要把权重改回 1 并把数值重新换算成 nit。

## 已知的注意事项

- 天空/IBL 的烘焙固定存储在 `PHYSICAL_BAKE_EXPOSURE`（即 Sunny-16 参考曝光）下，
  而不是实时相机曝光。原因是烘焙有缓存、只在太阳变化时失效，无法携带实时曝光；
  而且环境立方体贴图的格式容纳不了 100,000 lux 阳光驱动出的原始亮度（会溢出成 `Inf`
  并被 GGX 预滤波扩散到整张 IBL）。消费方按 `cameraExposure / PHYSICAL_BAKE_EXPOSURE` 换算。
- 锥光在物理模式下用 `innerConeAngle` / `outerConeAngle`（**弧度表示的真实半角**），
  而不是 legacy 模式的 `cutoff`（半角余弦）。两者都会被限制在 0.5° 到 90° 之间，
  且内锥角不会超过外锥角。
- 切换 `lightingMode` 会重建相机的后处理链。

## 相关

- [直接光照](zh-cn/lighting-direct.md) —— 各类光源的通用属性
- [间接光照](zh-cn/lighting-indirect.md) —— 环境光与 IBL
- [Tonemap](zh-cn/posteffect-tonemap.md) —— legacy 模式的曝光控制
