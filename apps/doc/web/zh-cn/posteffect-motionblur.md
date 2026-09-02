# Motion Blur（运动模糊）

Motion Blur 会使用摄像机的 motion-vector buffer，在主场景渲染完成后对快速相机运动或物体运动做模糊。

它适合赛车、快速相机移动、高速飞行物和电影化转场。不建议在 UI 较多或需要精确检查画面的工具场景中过度使用，因为它会降低可读性。

## 启用运动模糊

```ts
camera.motionBlur = true;
camera.motionBlurStrength = 1;
```

属性：

| 属性 | 类型 | 含义 |
| --- | --- | --- |
| `camera.motionBlur` | `boolean` | 启用或禁用效果 |
| `camera.motionBlurStrength` | `number` | 模糊强度倍率，默认值为 `1` |

## 可运行示例

```js
camera.motionBlur = true;
camera.motionBlurStrength = 1.0;
```

<div class="showcase" case="tut-73" style="width:600px;height:500px"></div>

