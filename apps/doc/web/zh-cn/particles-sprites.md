# 粒子与 Sprite

Zephyr3D 提供两类面向摄像机的四边形：

- `Sprite` 渲染单个始终面向摄像机的四边形。
- `ParticleEmitter` 渲染大量带运动和生命周期的四边形，可以在 CPU 或 GPU 上模拟。

Sprite 适合图标、标记、简单贴花和 3D 空间中的 2D 元素。粒子适合烟雾、火花、尘土、萤火、魔法效果等重复且短暂的视觉元素。本页讲 Sprite，以及粒子与 Sprite 共有的透明排序、拾取和序列化；粒子发射器的各组参数、CPU 与 GPU 模拟、力场和碰撞见[粒子发射器](zh-cn/particle-emitter.md)。

> 本页代码引自下方可运行示例 `tut-90` 的源码，示例里的纹理全部在代码中生成。

## 示例

<div class="showcase" case="tut-90"></div>

一个粒子发射器（小亮球）绕场景中心转圈，持续喷出由亮黄变暗红、最后化成烟的粒子；三根柱子顶上各有一个图钉 Sprite，中间一颗星星 Sprite 在原地转动。左上角面板：

- **Shape / Spawn**：切换发射器形状 `shape.type`，以及粒子在形状表面（`shape.thickness` 为 0）还是整个体积内（为 1）出生。
- **Blend**：粒子材质的 `blendMode`，`additive` 或 `blend`。
- **World space**：切换 `space`。发射器一直在移动，两种空间的差别一眼可见。
- **Continuous**：取消勾选时把 `emission.rate` 设为 0，停止持续发射。
- **Weighted OIT**：摄像机的 `oitMode`。
- **Burst**：调用 `emit()` 一次发射 200 个粒子。

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

## 粒子

示例的粒子发射器：

<<< @/../src/tut-90/main.js#particles

发射器每秒发射 150 个粒子，从半径 0.6 的球面出生、向外飞出。`overLife` 里的两条曲线让粒子在一生中长大到 4 倍、颜色由亮黄变成烟灰；`forces.drag` 让速度逐渐趋近 `airVelocity`，烟柱就向上升起并向 +X 飘去。

示例的颜色关键帧沿用了 sRGB 字节值，`createGradient()` 先把它们换算成线性颜色，再构造 `ParticleGradient`。发射器在线性空间里计算颜色，直接把 0~255 的 sRGB 值除以 255 会让中间调偏亮。

<<< @/../src/tut-90/main.js#material

粒子用 `ParticleSpriteMaterial` 绘制，不设贴图时每个粒子是一个柔边圆点。`additive` 把颜色叠加到背景上，重叠越多越亮，暗色几乎不可见，适合火花、辉光和魔法效果；`blend` 是普通的透明混合，适合烟雾、尘土和叶片。在示例里切到 Alpha blend，生命周期末段的灰色会变成遮挡背景的烟；切回 Additive，烟几乎消失，只剩发光的部分。

## 世界空间与局部空间

示例在每帧的 tick 里移动发射器：

<<< @/../src/tut-90/main.js#motion

`space` 决定粒子出生后存在哪个坐标系：

- `'world'`（默认）：出生后就与发射器无关，移动发射器会留下一条拖尾，适合火把、尾焰、脚步扬尘。
- `'local'`：粒子留在发射器节点的局部空间，整团粒子跟着节点平移、旋转、缩放，适合"粘"在物体上的效果，如护盾光环。

<<< @/../src/tut-90/main.js#worldspace

运行时切换 `space` 会清空已有的粒子，效果从新的空间重新开始。

## 手动爆发

对于一次性效果，把 `emission.rate` 设为 0 停止持续发射，在需要时调用 `emit()`：

<<< @/../src/tut-90/main.js#burst

`emit(count)` 在下一步发射 `count` 个粒子，出生在发射器当时所在的位置。爆发同样受 `maxParticles` 限制，超出上限的部分不会生成，所以 `maxParticles` 要留出爆发需要的余量。周期性的爆发可以用 `emission.bursts`，见[粒子发射器](zh-cn/particle-emitter.md#发射与容量)。

这适合命中、爆炸或交互反馈。

## 透明排序与 OIT

粒子和 Sprite 都在透明队列中绘制，不写深度。同一个发射器的粒子在一次绘制中按出生顺序画，不按与摄像机的距离排序，所以 `blend` 模式的粒子较密时可能出现前后关系错乱；`additive` 的结果与顺序无关，不受影响。出现排序问题时，可以在摄像机上启用 OIT：

<<< @/../src/tut-90/main.js#oit

Weighted blended OIT 在 WebGL2 和 WebGPU 上都可用，是粒子较多时最实用的选择。注意 OIT 会接管透明队列的混合方式：开启后 `additive` 粒子也按加权平均合成，不再越叠越亮。在示例里选 Additive 再勾选 Weighted OIT 就能看到区别。其他 OIT 模式见[顺序无关的透明度渲染](zh-cn/oit.md)。

## 拾取

粒子和 Sprite 都是可绘制场景节点，可以被拾取。粒子发射器的拾取目标就是它自己；Sprite 可以用 `setPickTarget()` 把拾取结果指向别的节点。

## 序列化

`Sprite`、`SpriteMaterial`、`StandardSpriteMaterial`、`ParticleEmitter` 和 `ParticleSpriteMaterial` 都已注册到序列化系统。编辑器创建的 Sprite 和粒子节点可以保存在场景或预制体中。

Sprite 和粒子材质使用的纹理，应在序列化前拥有 asset id。像示例这样在代码里生成的纹理没有 asset id，无法被保存引用。

## 限制与坑

- **Sprite 只继承父节点的平移。** 父节点的旋转和缩放不会作用到 Sprite 上，Sprite 的大小与平面内旋转只由它自己的变换决定。
- 粒子默认不读取场景深度，与几何体相交处会出现硬边。烟雾等大粒子可以打开材质的 `softDistance`（软粒子），代价是需要场景深度。

## 性能建议

粒子的开销取决于模拟放在哪里：CPU 模拟每帧逐粒子计算并重新上传数据，开销随存活粒子数线性增长；WebGPU 上的 GPU 模拟几乎不占 CPU。怎么选见[粒子发射器](zh-cn/particle-emitter.md#cpu-还是-gpu)。`maxParticles` 应接近实际需要的最大数量。避免每帧替换纹理或材质，优先动画参数。
