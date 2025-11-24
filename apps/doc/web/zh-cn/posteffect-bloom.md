# Bloom（泛光）

**用途**：在高亮区域生成柔和的光晕效果，提升画面亮度层次与氛围感。

**属性接口**：

- `camera.bloom`: `boolean` — 启用 Bloom。
- `camera.bloomIntensity`: `number` — 泛光强度。
- `camera.bloomThreshold`: `number` — 阈值，高于该亮度的像素将产生 Bloom。
- `camera.bloomThresholdKnee`: `number` — 平滑阈值过渡范围。
- `camera.bloomMaxDownsampleLevels`: `number` — 最大降采样层级。
- `camera.bloomDownsampleLimit`: `number` — 降采样分辨率下限。

**示例**：
```javascript
camera.bloom = true;
camera.bloomIntensity = 1.5;
camera.bloomThreshold = 0.9;
```

<div class="showcase" case="tut-28" style="width:600px;height:800px;"></div>

