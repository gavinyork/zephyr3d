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

## 材质侧的控制

TAA 每个像素保留多少历史，由该像素所属材质决定。`MeshMaterial` 上有这几个属性：

| 属性 | 默认值 | 作用 |
| --- | --- | --- |
| `TAAStrength` | `15/16` | **保留历史的比例**，0～1。当前帧权重至少为 `1 - TAAStrength`。值越大越平滑，但运动时越容易拖影；设为 0 等于完全不用历史，抖动会原样显示出来 |
| `TAADisabled` | `false` | 让这个材质完全不参与 TAA 累积 |
| `transparentMotionVector` | `false` | 让混合（半透明）材质也写入运动矢量。适合头发、植被卡片这类能"占据"像素的几何；玻璃等真正透明的表面不要开，应保留背后物体的运动 |
| `alphaDither` | `false` | 开启 alpha 裁剪时，用逐帧变化的抖动覆盖率模拟柔和透明，靠 TAA 平均成半透明效果 |

## 限制与坑

按症状排查：

- **运动物体拖影**：降低该材质的 `TAAStrength`；半透明物体没有运动矢量时，考虑开启 `transparentMotionVector`。
- **开了 TAA 画面反而抖动、闪烁**：先检查材质的 `TAAStrength` 是否被设得很小（为 0 时每帧的亚像素抖动会直接显示）。
- **半透明物体边缘糊、跟着背景走**：半透明物体默认不写运动矢量，TAA 按背后物体重投影它。头发、植被卡片可以开启 `transparentMotionVector`。

`camera.TAADebug` 可以显示中间结果：0 关闭，1 当前帧颜色，2 历史颜色，3 两者差异，4 屏幕外重投影区域，5 最终混合权重，6 运动矢量，7 材质的 TAA 强度。

## 总结

TAA 通过复用帧间的时域信息提供稳定平滑的画质，能显著减少运动中的闪烁和锯齿，配合 **Bloom**、**SSR** 等后处理使用可获得高质量的实时渲染效果。
