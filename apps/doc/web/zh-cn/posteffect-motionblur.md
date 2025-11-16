# Motion Blur（运动模糊）

**用途**：模拟相机或物体快速运动时的模糊轨迹，提升速度感和动感。

**属性接口**：

- `camera.motionBlur`: `boolean` — 启用或禁用运动模糊。
- `camera.motionBlurStrength`: `number` — 模糊强度，默认 1。

**示例**：
```javascript
camera.motionBlur = true;
camera.motionBlurStrength = 0.8;
```
