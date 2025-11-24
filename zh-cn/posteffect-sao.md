# SSAO（屏幕空间环境光遮蔽）

**用途**：模拟光线遮挡，在物体缝隙、接触区域生成阴影，增强深度层次。

**属性接口**：

- `camera.SSAO`:	`boolean` -	启用 SSAO
- `camera.SSAOScale`:	`number` -	采样比例（半径倍数）
- `camera.SSAOBias`:	`number` -	偏移，减少自遮挡伪影
- `camera.SSAORadius`:	`number` -	采样半径
- `camera.SSAOIntensity`:	`number` -	阴影强度
- `camera.SSAOBlurDepthCutoff`:	`number` -	模糊深度截止值

**示例**：
```javascript
camera.SSAO = true;
camera.SSAOIntensity = 0.05;
```

<div class="showcase" case="tut-29" style="width:600px;height:800px;"></div>

