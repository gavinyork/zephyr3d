# 阴影

> 本页代码为片段示意，省略了 import 与应用初始化，完整可运行示例见页内嵌入的实例。

阴影可以使场景更具立体感和真实感。平行光、点光、锥光和面光源都可以投射阴影。

## 开启阴影

每个光源可以单独配置是否投射阴影以及阴影模式，质量等参数。

```javascript

const light = new DirectionalLight(scene);
// castShadow属性控制灯光是否投射阴影
light.castShadow = true;

```

网格也可以配置是否投射阴影。

```javascript

// 允许该网格投射阴影
// 默认值为true
mesh.castShadow = true;

```

## 默认设置与偏移

光源的阴影参数在 `light.shadow` 上。默认模式为 `'pcf'`，阴影贴图 1024，单级（不分级），阴影距离 2000。

阴影贴图的分辨率有限，表面容易被自己的阴影遮挡，出现条纹（shadow acne）。两个偏移参数用来消除它：

| 属性 | 默认值 | 作用 |
| --- | --- | --- |
| `depthBias` | `0.003` | 深度偏移。太小会有条纹，太大会让阴影和物体脱开（peter-panning） |
| `normalBias` | `1.5` | 沿法线把接收点推出去的距离，单位是阴影贴图的纹素。消除掠射角下的条纹主要靠它，常用 1～4；太大会让细小物体的接触阴影脱开 |
| `shadowStrength` | `1` | 阴影的深浅，0 为没有阴影，1 为完全遮挡 |

**数量上限**：同时最多 32 个投影光源。超出的光源不再投射阴影，控制台会警告一次。

## 接触阴影

阴影贴图的分辨率不足以表现物体与地面接触处、缝隙里的细小阴影。屏幕空间接触阴影从每个像素向光源方向追踪一小段距离，补上这部分细节。它是逐光源设置的，默认关闭：

```javascript
light.castShadow = true;            // 只对投射阴影的光源生效
light.contactShadowLength = 0.05;   // 追踪长度，默认按屏幕高度的比例计；0 关闭（默认）
light.contactShadowLengthInWS = false;   // 设为 true 时长度改用世界单位
light.contactShadowCastingIntensity = 1; // 接触阴影的深浅，0～1
```

接触阴影在屏幕空间阴影遮罩中计算，需要相机的 `camera.contactShadows` 和 `camera.screenSpaceShadowMask` 都开启（两者默认都开启）。它只能看到屏幕上可见的几何，被遮挡或在屏幕外的物体不会投下接触阴影。

## 平行光投影：

<div class="showcase" case="tut-16"></div>

## 点光源投影：

<div class="showcase" case="tut-17"></div>

## 锥光投影

<div class="showcase" case="tut-18"></div>

## 面光源投影

面光源的阴影贴图和点光一样是立方体贴图。使用 `'pcss'` 阴影模式时，半影大小随矩形尺寸变化：
光源越大阴影越柔和，并且离投影物体越远，阴影边缘扩散得越宽。其他模式下，阴影边缘不随光源大小变化。

<<< @/../src/tut-84/main.js#shadow

示例中光源在高矮不同的柱子上方来回移动。拖动尺寸滑块可以看到半影变宽，也可以切换阴影模式对比效果。

<div class="showcase" case="tut-84"></div>
