# Motion Blur（运动模糊）

Motion Blur 会使用摄像机的 motion-vector buffer，在主场景渲染完成后对快速相机运动或物体运动做模糊。

它适合赛车、快速相机移动、高速飞行物和电影化转场。不建议在 UI 较多或需要精确检查画面的工具场景中过度使用，因为它会降低可读性。

## 启用运动模糊

```ts
camera.motionBlur = true;
camera.motionBlurStrength = 0.8;
```

属性：

| 属性 | 类型 | 含义 |
| --- | --- | --- |
| `camera.motionBlur` | `boolean` | 启用或禁用效果 |
| `camera.motionBlurStrength` | `number` | 模糊强度倍率，默认值为 `1` |

## 工作方式

该效果会沿每个像素的 motion vector 对渲染结果进行多次采样。motion vector 纹理由场景渲染器生成，后处理效果会在上一帧和当前帧像素位置之间混合多个采样结果。

模糊长度也会受帧时间影响，因此帧时间极不稳定时，效果可能会出现强弱变化。如果应用存在明显帧尖峰，应使用较保守的强度。

## 推荐范围

| 场景 | 强度 |
| --- | --- |
| 轻微相机运动 | `0.25` - `0.5` |
| 动作相机或载具 | `0.6` - `1.0` |
| 风格化高速效果 | `1.0` - `1.5` |

## 注意事项

- Motion Blur 是摄像机后处理效果，因此按摄像机单独配置。
- motion vector 只会在非 WebGL 后端生成，因此这个效果主要面向 WebGPU/native-capable 的渲染路径。
- 移动物体正确输出 motion vector 时效果最好。
- 通常通过摄像机内置 compositor 和其他后处理一起工作。
- 如果画面清晰度比速度感更重要，应保持禁用。
