# TAA（时间抗锯齿）

**用途**：基于时间采样的抗锯齿算法，通过多帧累积与抖动消除噪声。

**属性接口**：

- `camera.TAA`: `boolean` — 启用或禁用 TAA。
- `camera.TAADebug`: `number` — 调试模式标志（实现相关）。

**示例**：
```javascript
camera.TAA = true; // 开启 TAA 抗锯齿
```

<div class="showcase" case="tut-51" style="width:600px;height:800px;"></div>
