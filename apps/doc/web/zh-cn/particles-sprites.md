# 粒子与 Sprite

Zephyr3D 提供两类 billboard 系统：

- `Sprite` 渲染单个始终面向摄像机的四边形。
- `ParticleSystem` 渲染大量带运动和生命周期的面向摄像机四边形。

Sprite 适合图标、标记、简单贴花和 3D 空间中的 2D 元素。粒子系统适合烟雾、火花、尘土、萤火、魔法效果等重复且短暂的视觉元素。

> 本页代码引自下方可运行示例 `tut-90` 的源码，示例里的纹理全部在代码中生成。只有"从文件加载粒子纹理"一段是片段示意，省略了应用初始化；`getEngine` 来自 `@zephyr3d/scene`。

## 示例

<div class="showcase" case="tut-90"></div>

一个粒子发射器（小亮球）绕场景中心转圈，持续喷出由亮黄变暗红、最后化成烟的粒子；三根柱子顶上各有一个图钉 Sprite，中间一颗星星 Sprite 在原地转动。左上角面板：

- **Shape / Spawn**：切换发射器形状 `emitterShape` 和 `emitterBehavior`。
- **Blend**：粒子材质的 `blendMode`，`additive` 或 `blend`。
- **World space**：切换 `worldSpace`。发射器一直在移动，两种空间的差别一眼可见。
- **Continuous**：取消勾选时把 `emitCount` 设为 0，停止持续发射。
- **Weighted OIT**：摄像机的 `oitMode`。
- **Burst**：调用 `newParticle()` 一次生成 200 个粒子。

## Sprite

<<< @/../src/tut-90/main.js#sprite

`Sprite` 是一个边长为 1 的正方形，始终正对摄像机，**宽和高取节点 `scale` 的 X、Y**（世界单位）。构造时不传材质会自动创建一个 `StandardSpriteMaterial`。

`StandardSpriteMaterial` 直接输出纹理颜色，不受光照影响，没设纹理时是纯白。它的 `blendMode` 默认是 `'none'`，即按不透明物体绘制，纹理中透明的部分会画成实心（通常是黑色）。带透明背景的图标要像示例这样设为 `'blend'`，或者用 `alphaCutoff` 做硬边裁切。

示例的图标都在一张 2×2 图集里，用到的控制项：

| 控制项 | 说明 |
| --- | --- |
| `anchorX`, `anchorY`（节点） | 轴心在四边形内的位置，(0, 0) 是左下角，默认 (0.5, 0.5)。示例设为 (0.5, 0)，图钉尖端正好落在节点位置上 |
| `material.setUVInfo(左, 下, 右, 上)` | 使用纹理中的哪个矩形。**V 从图像底边往上数**，示例的 `useAtlasCell()` 把图集的行列换算成这四个数 |
| `uvTopLeft`, `uvBottomRight`（节点） | 与 `setUVInfo()` 读写同一组值，分别是 (左, 下) 和 (右, 上)。名字里的 top/bottom 与 V 向上的约定相反，以 `setUVInfo()` 的参数顺序为准 |
| 节点绕 Z 轴的旋转 | billboard 平面内的旋转，示例在 tick 里用 `star.rotation.fromEulerAngle(0, 0, angle)` 让星星转动 |
| `setPickTarget(node, label)` | 拾取到这个 Sprite 时返回的节点，例如它所标注的物体 |

V 向上这一点在用图集时最容易弄错。示例里图集的第 0 行在图像顶部，换算成 `setUVInfo()` 的参数是这样的：

<<< @/../src/tut-90/main.js#uv

锚点和旋转要设在**节点**上：材质挂到 Sprite 时，节点会用自己的锚点和旋转覆盖材质上的 `anchorX` / `anchorY` / `rotation`，之后每次变换更新还会重写 `rotation`。也因为锚点、旋转和 UV 都存在材质里，这几项不同的 Sprite 应该各用一个材质（纹理可以共用），示例就是这样做的。

需要在任意缩放下都清晰的文字标签，用 `MSDFTextSprite`，见[文本渲染](zh-cn/text-rendering.md)。

## 粒子系统

`ParticleSystem` 是一个场景节点，持有发射设置、模拟参数和一个 `ParticleMaterial`（`particles.material`）。挂进场景后由场景每帧自动更新：模拟在 CPU 上进行，结果作为实例数据上传，整个系统一次绘制。

<<< @/../src/tut-90/main.js#particles

**发射节奏**：每 `emitInterval` 毫秒发射 `emitCount` 个粒子。但每帧**最多发射一批**，间隔短于帧时间时多出来的批次不会补发，实际速率变成"每帧 `emitCount` 个"，随帧率浮动。要更密就加大 `emitCount`，不要把 `emitInterval` 压到一帧以下。示例用 40 毫秒 × 6 个，帧率在 25 fps 以上都能保持每秒 150 个。

**数量上限**：`maxParticleCount` 决定实例缓冲的大小，也是硬上限，达到上限后新粒子直接不生成。可以按"发射速率 × 最长寿命 + 爆发数量"估算：示例持续发射约 150 × 2.2 ≈ 330 个，800 还能容下两次 200 个的爆发。

**运动**：初速度的方向由发射器形状决定（见下表），大小在 `particleVelocityMin` ~ `Max` 之间随机。之后每帧依次受 `gravity`（恒定加速度）和沿速度方向的 `particleAccelMin` ~ `Max`（负值即减速）影响。`airResistence` 为 true 时，速度还会以约 1 秒的时间常数趋近 `wind`，示例就靠它让粒子先按形状散开、再随风上升飘移。注意属性名就拼作 `airResistence`，在 JavaScript 里写成 `airResistance` 不会报错，只会没有效果。

**尺寸**：每个粒子在生命周期内从 Size1 线性变化到 Size2，两者都在各自的 Min ~ Max 之间随机取值。默认 Size2 比 Size1 小，粒子逐渐缩小；示例反过来让粒子由小变大，像火焰化成烟。

常用参数与默认值：

| 属性 | 默认值 | 含义 |
| --- | --- | --- |
| `maxParticleCount` | `100` | 同时存在的粒子上限，按它分配实例缓冲 |
| `emitInterval` | `100` | 两次发射之间的间隔，**单位毫秒** |
| `emitCount` | `1` | 每次发射的粒子数；设为 0 停止持续发射 |
| `particleLifeMin` / `Max` | `1` / `1.5` | 粒子寿命范围，**单位秒** |
| `particleVelocityMin` / `Max` | `2` / `3` | 初速度大小范围 |
| `particleSize1Min` / `Max` | `0.4` / `0.5` | 粒子出生时的尺寸范围 |
| `particleSize2Min` / `Max` | `0` / `0.1` | 粒子消亡时的尺寸范围 |
| `particleAccelMin` / `Max` | `-0.01` / `-0.02` | 沿速度方向的加速度范围 |
| `gravity` | `(0, 0, 0)` | 恒定加速度 |
| `wind` | `(0, 0, 0)` | 风速。**只在 `airResistence` 为 true 时生效** |
| `airResistence` | `false` | 是否让速度趋近 `wind` |
| `scalar` | `1` | 同时缩放粒子的位移和出生尺寸，用来整体放大或缩小一个效果 |
| `jitterSpeed` | `1` | 粒子摆动的角速度（弧度/秒），摆动幅度是材质的 `jitterPower` |
| `emitterShape` | `'point'` | 见下表 |
| `emitterBehavior` | `'surface'` | 见下表 |
| `emitterShapeSizeMin` / `Max` | `(1, 1, 1)` / `(1, 1, 1)` | 发射器形状的尺寸，每个粒子每个轴各自在两者之间随机 |
| `emitterConeRadiusMin` / `Max` | `0` / `0.1` | 初速度方向偏离 +Y 的程度，只有 `point`、`box`、`cylinder` 使用 |
| `worldSpace` | `true` | 粒子出生后存在世界空间还是发射器的局部空间，见下文 |

发射器形状（下文的"尺寸"即 `emitterShapeSize` 在 Min ~ Max 间取到的值）：

| 形状 | 出生位置 | 初速度方向 |
| --- | --- | --- |
| `point` | 节点原点，忽略尺寸 | 朝 +Y，按 `emitterConeRadius` 向四周张开 |
| `sphere` | 以尺寸为半径的椭球 | 从中心向外 |
| `box` | 以尺寸为半边长的盒体 | 朝 +Y，按 `emitterConeRadius` 向四周张开 |
| `cylinder` | 半径取尺寸 X/Z、半高取尺寸 Y 的圆柱侧面 | 水平向外，`emitterConeRadius` 乘以尺寸 Y 给出上下散布 |
| `cone` | 顶点在节点上方 2 × 尺寸 Y 处、底面半径为尺寸 X 的圆锥侧面 | 沿锥面向外、向下 |

`emitterBehavior` 为 `surface` 时粒子从形状表面出生，为 `volume` 时从内部出生，只对 `sphere`、`box`、`cylinder` 有效。尺寸的 Min 与 Max 不同时，"表面"会变成有厚度的一层壳；想要严格的表面，把两者设成相同的值，示例就是这样。

## 粒子材质

默认材质是 `ParticleMaterial`，通过 `particles.material` 访问：

<<< @/../src/tut-90/main.js#material

| 属性 | 说明 |
| --- | --- |
| `alphaMap` | 粒子的形状。**只读红通道**，作为不透明度。它是数据而不是颜色，应使用线性格式 |
| `rampMap` | 颜色随生命周期的变化：以粒子的归一化年龄（出生 0、消亡 1）为 U、V 取 0 采样。RGB 是颜色，A 再乘到不透明度上，所以淡入淡出也写在这里。它是颜色纹理，应使用 sRGB 格式 |
| `blendMode` | `'blend'`（默认）或 `'additive'` |
| `jitterPower` | 粒子在垂直于速度的平面内绕自己的轨迹摆动的幅度，速度由 `ParticleSystem.jitterSpeed` 控制 |
| `aspect` | 四边形的宽高比，宽 = 尺寸 × `aspect` |
| `directional` | 为 true 时四边形的长度方向对齐速度在屏幕上的投影，配合小于 1 的 `aspect` 可以做出沿运动方向拉长的火花 |

两张贴图都不设时，粒子是纯白的方块。粒子材质不受光照，ramp 的颜色就是输出颜色，之后照常经过色调映射。`aspect`、`jitterPower`、`directional` 在 `ParticleSystem` 上也有同名属性，会直接转发给材质。

示例的 `createAlphaMap()` 生成一张 64×64 的 `rgba8unorm` 圆形软边遮罩，`createRampMap()` 把一组关键帧插值成 64×1 的 `rgba8unorm-srgb` 纹理。实际项目里这两张图通常来自文件（片段示意）：

```ts
const alpha = await getEngine().resourceManager.fetchTexture('/particles/smoke-alpha.png', {
  linearColorSpace: true
});
const ramp = await getEngine().resourceManager.fetchTexture('/particles/smoke-ramp.png');

particles.material.alphaMap = alpha;
particles.material.rampMap = ramp;
```

`linearColorSpace: true` 让遮罩按线性数据读取，ramp 用默认的 sRGB。编辑器反序列化粒子材质时也是这样加载这两张图的。

`additive` 把颜色叠加到背景上，重叠越多越亮，暗色几乎不可见，适合火花、辉光和魔法效果；`blend` 是普通的透明混合，适合烟雾、尘土和叶片。在示例里切到 Alpha blend，ramp 末段的灰色会变成遮挡背景的烟；切回 Additive，烟几乎消失，只剩发光的部分。

## 世界空间与局部空间

示例在每帧的 tick 里移动发射器：

<<< @/../src/tut-90/main.js#motion

`worldSpace` 决定粒子出生后存在哪个坐标系：

- `true`（默认）：出生时把位置和速度变换到世界空间，之后与发射器无关。移动发射器会留下一条拖尾，适合火把、尾焰、脚步扬尘。
- `false`：粒子留在发射器节点的局部空间，整团粒子跟着节点平移、旋转、缩放，适合"粘"在物体上的效果，如护盾光环。

<<< @/../src/tut-90/main.js#worldspace

运行时切换 `worldSpace` 不会转换已经存在的粒子，它们的坐标会按新的空间重新解释，在消亡前出现一次跳变（在示例里切换 World space 就能看到）。最好在开始发射前设好。

## 手动爆发

系统会按 `emitInterval` 和 `emitCount` 持续发射。对于一次性效果，把 `emitCount` 设为 0 停止持续发射，在需要时调用 `newParticle()`：

<<< @/../src/tut-90/main.js#burst

`newParticle(count, worldMatrix)` 立即生成 `count` 个粒子，第二个参数是出生时使用的变换，通常传 `particles.worldMatrix`（`worldSpace` 为 false 时不使用）。爆发同样受 `maxParticleCount` 限制，超出上限的部分不会生成，所以 `maxParticleCount` 要留出爆发需要的余量。

这适合命中、爆炸或交互反馈。

## 透明排序与 OIT

粒子和 Sprite 都在透明队列中绘制，不写深度。同一个粒子系统的粒子在一次绘制中按出生顺序画，不按与摄像机的距离排序，所以 `blend` 模式的粒子较密时可能出现前后关系错乱；`additive` 的结果与顺序无关，不受影响。出现排序问题时，可以在摄像机上启用 OIT：

<<< @/../src/tut-90/main.js#oit

Weighted blended OIT 在 WebGL2 和 WebGPU 上都可用，是粒子较多时最实用的选择。注意 OIT 会接管透明队列的混合方式：开启后 `additive` 粒子也按加权平均合成，不再越叠越亮。在示例里选 Additive 再勾选 Weighted OIT 就能看到区别。其他 OIT 模式见[顺序无关的透明度渲染](zh-cn/oit.md)。

## 拾取

粒子和 Sprite 都是可绘制场景节点，可以被拾取。粒子系统的拾取目标就是它自己；Sprite 可以用 `setPickTarget()` 把拾取结果指向别的节点。

## 序列化

`Sprite`、`SpriteMaterial`、`StandardSpriteMaterial`、`ParticleSystem` 和 `ParticleMaterial` 都已注册到序列化系统。编辑器创建的 Sprite 和粒子节点可以保存在场景或预制体中。

Sprite 和粒子材质使用的纹理，应在序列化前拥有 asset id。像示例这样在代码里生成的纹理没有 asset id，无法被保存引用。

## 限制与坑

- **零速度的粒子不可靠。** 着色器要对粒子速度做归一化来构建摆动和朝向用的坐标轴，速度为 0 时结果未定义，粒子可能直接消失。`particleVelocityMin` 不要设为 0，减速度也不要大到让粒子在寿命内停下（有 `gravity` 或 `wind` 时一般不会停）。
- **`particleRotationMin` / `Max` 目前看不到效果。** 它们在 CPU 上按每秒弧度累加成粒子的旋转角，但 `ParticleMaterial` 的着色器没有使用这个值。
- **Sprite 只继承父节点的平移。** 父节点的旋转和缩放不会作用到 Sprite 上，Sprite 的大小与平面内旋转只由它自己的变换决定。
- 粒子不读取场景深度（没有软粒子），与几何体相交处会出现硬边，烟雾等大粒子要注意摆放位置。

## 性能建议

模拟在 CPU 上逐粒子进行，每帧的数据都要重新上传，开销随存活粒子数线性增长。`maxParticleCount` 应接近实际需要的最大数量。多个效果共享行为和材质时，优先使用少量较大的粒子系统，而不是大量很小的粒子系统。避免每帧替换纹理或材质，优先动画参数。
