# 摄像机后处理（Camera Post-Processing）

`Camera` 类集成了一条在主场景渲染之后执行的后处理链。后处理效果由摄像机内部的 `Compositor` 管理，常用效果可以直接通过摄像机属性启用。

## 概述

后处理效果会读取已经渲染好的 framebuffer，并输出新的图像。大多数应用代码应使用内置摄像机属性，例如 `camera.bloom = true` 或 `camera.bloomIntensity = 1.2`。

内置效果：

| 效果 | 类名 | 用途 |
| --- | --- | --- |
| 色调映射 | `Tonemap` | 将 HDR 场景颜色转换为显示颜色 |
| FXAA | `FXAA` | 快速边缘平滑 |
| TAA | `TAA` | 基于 jitter 和累积缓冲的时间抗锯齿 |
| Bloom | `Bloom` | 高亮区域光晕 |
| SSR | `SSR` | 屏幕空间反射 |
| SSGI | `SSGI` | 基于历史 HDR 场景颜色的屏幕空间漫反射全局光照 |
| SSAO/SAO | `SAO` | 屏幕空间环境光遮蔽 |
| Motion Blur | `MotionBlur` | 相机或物体运动造成的模糊 |
| Skin SSS | `SkinSSS` | 皮肤次表面散射，配合 `SkinMaterial` 使用，见[皮肤与次表面散射](zh-cn/material-skin.md) |
| Color Adjust | `ColorAdjust` | 饱和度、对比度、色相和锐化调整 |
| Grayscale | `Grayscale` | 用于自定义 compositor 链的灰度转换 |

## 摄像机属性

摄像机会持有常用后处理实例，并自动加入内部 compositor。典型用法：

```ts
camera.HDR = true;
camera.toneMap = true;
camera.toneMapExposure = 1.1;

camera.bloom = true;
camera.bloomThreshold = 0.85;
camera.bloomIntensity = 1.2;

camera.FXAA = true;
camera.TAA = true;
camera.motionBlur = true;
camera.motionBlurStrength = 0.5;
```

如果需要自定义后处理链，可以使用 `camera.compositor` 并追加自己的 `AbstractPostEffect` 实例。
