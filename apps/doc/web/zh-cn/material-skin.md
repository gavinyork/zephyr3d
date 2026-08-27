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

相机上的这组属性控制扩散行为：

| 属性 | 默认值 | 作用 |
| --- | --- | --- |
| `skinSSS` | false | 开关 |
| `skinSSSStrength` | 1 | 最终合成强度 |
| `skinSSSScatterRadius` | 0.02 | **世界空间**散射半径，模糊宽度随距离缩放以保持它恒定 |
| `skinSSSSampleStep` | 2 | 模糊采样的最大像素间距，用于给近景的投影半径设上限 |
| `skinSSSOpacity` | 0.18 | 合成前从模糊后的皮肤遮罩里减掉的偏置 |
| `skinSSSDepthScale` | 80 | 深度拒绝尺度，防止跨越深度断层的错误混合 |
| `skinSSSColorBoost` | 1 | 模糊结果的额外倍数 |
| `skinSSSSmoothness` | 0 | 磨皮（"美颜"）强度 |
| `skinSSSScatterTint` | 白 | 给被重分配的光染色 |
| `skinSSSGlow` | 0 | 非守恒的额外透光感 |
| `skinSSSProfilePreset` | `'skin'` | 散射 profile 预设 |

几个值得单独说明的：

**`skinSSSScatterRadius` 是世界空间的**，不是像素。这意味着角色走远时散射范围会正确变小，
不需要你按距离调参。`skinSSSSampleStep` 则给近景设一个像素上限，避免贴脸时模糊核过大。

**`skinSSSGlow` 会破坏能量守恒**，这是有意的。默认 0 时，交界暗侧增加的光就是亮侧减少的光；
调高它则只加不减，让皮肤看起来"从内部发光"。取 1 左右接近该效果在支持能量守恒之前的观感。

**`skinSSSScatterTint` 只作用于差值项**，所以偏暖的色调会给明暗交界染色，而不会让整个
表面泛色。

**`skinSSSSmoothness` 要求遮罩正确**：磨皮按皮肤遮罩加权采样，所以 R 通道必须把五官抠掉，
否则眉眼嘴会一起被磨平。

## 散射 profile

`skinSSSProfilePreset` 决定红、绿、蓝三个通道散射半径的**比例**——这个比例才是散射材质的性格
所在。红光在皮肤里传得最远，这正是明暗交界处那条红黄渐变的来源。改预设就是改这个比例，
所以 `wax`（蜡）和 `jade`（玉）与皮肤走的是同一套代码，而不是特例分支。

可选预设：`skin`、`skin_thin`、`skin_default`、`skin_heavy_makeup`、`wax`、`wax_backlit`、
`wax_soft`、`jade`、`jade_backlit`、`jade_soft`。

半径的绝对大小仍由 `skinSSSScatterRadius` 控制，预设只管比例。

::: tip 这个预设作用于整个 pass
`camera.skinSSSProfilePreset` 是**整个渲染 pass** 的设置，一个相机只有一个。
需要同一画面里不同材质用不同 profile，走的是另一条 profile slot 路径，`SubsurfaceProfile`
类的实例可以被多个材质共享（类似 Unreal 的 skin profile 资产）。
:::

## 已知限制

- **精度回退**：可散射项写在一张附加的 MRT 里。当渲染图退回 8 位格式时，会按
  `SKIN_SSS_LDR_ENCODE_RANGE`（值为 4）压缩再还原。极端亮度下可能出现精度损失。
- **默认值未在真实角色上标定**：当前的视觉默认值（`scatterStrength` 1.5、
  `scatterRadius` 0.02 等）是按参考实现给的，实际角色上通常需要调整。
- 高光走的是归一化 Blinn 而不是 GGX，这是风格化取向，不追求与 PBR 材质完全一致。

## 相关

- [自定义材质](zh-cn/user-material.md) —— 材质系统的通用机制
- [后处理](zh-cn/posteffect-intro.md) —— 相机后处理链
- [光照](zh-cn/lighting-intro.md) —— 光源配置
