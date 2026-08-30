# TAA（时间抗锯齿）

## 概述

**TAA（Temporal Anti-Aliasing，时间抗锯齿）** 是一种基于时间采样的抗锯齿算法，通过在多帧之间累积信息来消除锯齿和闪烁。
它利用亚像素抖动和时域反馈复用上一帧的数据，在保持细节的同时有效平滑画面。

---

## 属性接口

- `camera.TAA`: `boolean` — 启用或禁用 TAA。
- `camera.TAADebug`: `number` — 调试模式标志，用于实现相关的可视化或测试。

---

## 示例

```javascript
// 开启 TAA 抗锯齿
camera.TAA = true;
```

<div class="showcase" case="tut-51" style="width:600px;height:500px"></div>

---

## 总结

TAA 通过复用帧间的时域信息提供稳定平滑的画质，能显著减少运动中的闪烁和锯齿，配合 **Bloom**、**SSR** 等后处理使用可获得高质量的实时渲染效果。
