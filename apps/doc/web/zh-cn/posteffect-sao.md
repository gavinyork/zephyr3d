# SSAO（屏幕空间环境光遮蔽）

**用途**：模拟光线遮挡，在物体缝隙、接触区域生成阴影，增强深度层次。

**属性接口**：

- `camera.SSAO`:	`boolean` -	启用 SSAO（默认 `false`）
- `camera.SSAOOcclusionRadius`:	`number` -	遮蔽半径，世界单位（米），默认 `0.25`
- `camera.SSAOBias`:	`number` -	偏移，减少自遮挡伪影，默认 `0.05`
- `camera.SSAOIntensity`:	`number` -	阴影强度，默认 `1`
- `camera.SSAOBlurDepthCutoff`:	`number` -	模糊深度截止值，默认 `2`

**示例**：
```javascript
camera.SSAO = true;
camera.SSAOOcclusionRadius = 0.5;
camera.SSAOIntensity = 2;
```

<div class="showcase" case="tut-29" style="width:600px;height:500px"></div>

**调参与取舍**：

- `SSAOOcclusionRadius` 是世界尺寸，要随场景尺度调：默认 0.25 米适合人物与家具尺度的接触阴影，建筑尺度的场景需要更大的值（上面的示例 tut-29 用的是 3.5）。半径越大，遮蔽延伸得越远。
- 不要和 SSGI 同时开启。SSGI 自带的环境光遮蔽（`camera.ssgiAOIntensity`）也会乘到最终颜色上，两者同开会压暗两次。

> 1.0 之前的 `SSAOScale`（相对远裁剪面的倍数）和 `SSAORadius` 已移除，统一由 `SSAOOcclusionRadius` 取代。
