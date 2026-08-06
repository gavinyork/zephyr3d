# Tonemap（色调映射）

## 概述

**色调映射（Tone Mapping）** 是把 **HDR（高动态范围）** 图像转换为适合标准显示设备的 **LDR（低动态范围）** 图像的过程。
Zephyr3D 的色调映射基于 **ACES（Academy Color Encoding System）**，保证物理正确的颜色响应和自然的亮度压缩。

---

## 属性接口

- `camera.toneMap`: `boolean` — 启用或禁用色调映射。
- `camera.toneMapExposure`: `number` — 曝光控制，默认值 `1`。

---

## 示例

```javascript
// 开启色调映射
camera.toneMap = true;
// 调整曝光
camera.toneMapExposure = 1.5;
```

<div class="showcase" case="tut-27" style="width:600px;height:800px;"></div>

---

## 总结

色调映射保证 HDR 渲染结果在压缩到显示设备范围时不损失高光和暗部细节。
基于 ACES 的管线保留了宽动态范围和电影级的色彩还原，适合写实渲染和电影化的视觉风格。
