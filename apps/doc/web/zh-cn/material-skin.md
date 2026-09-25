# 皮肤材质与次表面散射

真实的皮肤不是不透明的：光线进入表层、在皮下散射一段距离再射出，所以皮肤在明暗交界处会有
偏红的过渡，薄的部位（耳廓、鼻翼）被背光照射时会透光。引擎用**材质 + 后处理**两部分配合
来模拟这个现象。

## 三个组件的分工

这套方案由三个部分组成，理解它们的分工是用好它的前提：

| 组件 | 类型 | 负责什么 |
| --- | --- | --- |
| `SkinMaterial` | 材质 | 直接光照的**形状**：漫反射 ramp、高光、背光透射 |
| `SkinSSS` | 相机后处理 | **扩散**：把材质算出的可散射部分做屏幕空间模糊再合成回去 |
| `SubsurfaceProfile` | 数据 | 各颜色通道的散射半径**比例**，决定"像皮肤还是像蜡" |

关键在于**风格化与扩散是分开的**：材质决定光照 ramp 长什么样，后处理只负责把这个 ramp 扩散开。
所以你调出来的风格化 ramp 在散射之后依然保持风格，而不会被平均掉。

由此推论出一条容易搞错的规则：**散射的色调、强度和半径都在后处理上，不在材质上。**
材质上没有 `scatterRadius`，相机上才有。

## 最小用法

```javascript
import { SkinMaterial } from '@zephyr3d/scene';

const material = new SkinMaterial();
material.albedoTexture = skinColorTexture;
material.normalTexture = skinNormalTexture;

// 后处理必须打开，否则只有材质的 ramp，没有扩散
camera.skinSSS = true;
```

**只设材质不开 `camera.skinSSS` 是最常见的问题**：画面不会报错，但看不到散射效果，
因为扩散那一步根本没执行。

反过来，效果是**能量守恒**的：后处理把可散射部分减掉再加回扩散后的版本，
所以关掉 `camera.skinSSS` 时画面保持不变，不会突然变暗或变亮。

## 材质侧：光照的形状

`SkinMaterial` 上的参数塑造直接光照，不涉及扩散：

| 属性 | 默认值 | 作用 |
| --- | --- | --- |
| `diffuseWrap` | 0.28 | 漫反射环绕量，让光照越过几何明暗界线 |
| `diffuseSoftness` | 0.45 | ramp 的软硬程度 |
| `shininess` | 72 | 高光锐度 |
| `specularStrength` | 1 | 高光强度 |
| `scatterWrap` | 0.65 | 可散射项的环绕量，决定交界处过渡带的宽度 |
| `scatterStrength` | 1.5 | 写入可散射项的强度 |
| `scatterColor` | (1, 0.42, 0.28) | 可散射项的色调 |
| `transmissionStrength` | 0 | 背光透射强度，**默认关闭** |
| `transmissionPower` | 4 | 透射的方向性 |
| `shadowTint` | 黑 | 暗部 ramp 染色，黑色为原始行为 |
| `brightening` | 0 | 漫反射整体增益 |

### 遮罩贴图

可选的 `subsurfaceTexture` 用三个通道携带不同信息：

- **R = 皮肤遮罩** —— 哪些像素参与散射。**衣服、头发、眼睛应当在这里被抠掉**，
  否则会被染上皮肤的散射色。
- **G = 局部软硬** —— 逐像素调节 ramp 软硬。
- **B = 厚度** —— 供背光透射使用，薄的部位（耳廓、鼻翼）取高值。

透射默认是关的，要用得把 `transmissionStrength` 调上去，并提供 B 通道厚度信息。

## 后处理侧：扩散与合成

相机侧只有一个开关：

| 属性 | 默认值 | 作用 |
| --- | --- | --- |
| `skinSSS` | false | 开启扩散 pass（仅 WebGPU） |
| `skinSSSDebugOutput` | `'none'` | 输出扩散过程的某个中间量，替代最终着色结果 |

**相机上没有任何散射参数。** 光走多远、多强、什么颜色，全部是材质所指向的
[`SkinProfile`](#散射-profile) 的属性，由材质逐像素写出的 profile id 供 pass 查表读取。
这与 UE5 一致——那里也只有 subsurface profile 资产能塑造扩散形状。这样做还能保证屏幕空间扩散
和烘焙的透射 profile 不会走样：一个 pass 级的半径倍数只会缩放前者而不动后者。

`skinSSSDebugOutput` 是区分"输入有问题"和"核函数有问题"的实用手段，可以显示可扩散能量、
逐像素 profile id、法线、逐通道扩散距离、采样半径、采样接受率、单独的扩散结果，以及光源空间
厚度。有几个中间量落在很窄的区间里，读起来是一片平色，这时配合后处理的 `debugExposure` 一起用。

## 散射 profile

`SkinProfile` 持有全部散射参数，材质通过 `SkinMaterial.subsurfaceProfile` 引用它。所有 profile
被打包进一张以 profile id 为索引的共享 GPU 表，所以脸、耳朵、嘴唇可以各带一份 profile，在同一
个屏幕空间 pass 里独立扩散。

其中最关键的几个参数：

| 属性 | 作用 |
| --- | --- |
| `surfaceAlbedo` | 逐通道散射反照率，驱动 Burley 的形状项 |
| `meanFreePath` | 逐通道散射**比例**——决定材质性格的就是它 |
| `meanFreePathDistance` | 散射的绝对距离，世界单位 |
| `worldUnitScale` | profile 空间到世界单位的换算，供非米制场景使用 |
| `scatterScale` | 扩散宽度的总体倍数 |
| `transmissionTint` | 穿透薄处的透射光染色 |
| `scatteringDistribution` | 透射光的 Henyey-Greenstein 各向异性 |
| `roughness0` / `roughness1` / `lobeMix` | 双瓣高光 |

让散射材质读起来像皮肤而不是一团中性模糊的，是 `meanFreePath` 的**比例**。在 `skin` 预设里红光
传播距离大约是蓝光的十倍，这正是明暗交界处那条红黄渐变的来源。改预设就是改这个比例，所以
`wax`（蜡）和 `jade`（玉）与皮肤走的是同一套代码，而不是特例分支。

可选预设：`skin`、`skin_pale`、`skin_tan`、`skin_dark`、`wax`、`jade`、`marble`。

绝对尺度由 `meanFreePathDistance` 和 `worldUnitScale` 决定，预设只管比例。

::: tip 尺度是物理量
散射距离是物理量：`skin` 的平均自由程约 27 毫米。在米级大小的物体上，扩散本来就看不见。
如果觉得"散射没效果"，先查物体的世界尺寸，再去动参数。
:::

## 相关

- [自定义材质](zh-cn/user-material.md) —— 材质系统的通用机制
- [后处理](zh-cn/posteffect-intro.md) —— 相机后处理链
- [光照](zh-cn/lighting-intro.md) —— 光源配置
