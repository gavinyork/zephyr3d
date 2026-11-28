# 粒子发射器

`ParticleEmitter` 是用来做火花、烟、尘土、魔法光点这类效果的粒子节点。同一套参数既能在 CPU 上模拟，也能在 WebGPU 上用计算着色器模拟，几十万甚至上百万个粒子也能实时运行。

> 本页代码引自下方可运行示例 `tut-95` 的源码。

## 示例

<div class="showcase" case="tut-95"></div>

左上角面板：

- **Preset**：四个效果，下文分别用它们讲解各组参数。
  - **Spark fountain**：10 万个火花，受重力落下后在地面弹开。
  - **Smoke**：烟柱，受噪声扰动，被场景风吹走。
  - **Swarm**：30 万个光点在原地打旋。
  - **Comet trail**：绕圈飞行、忽快忽慢的彗星，拖尾始终均匀。
- **Simulation**：模拟放在哪里，见[CPU 还是 GPU](#cpu-还是-gpu)。面板下方的状态行显示实际使用的后端和存活粒子数的上界。
- **Burst**：立即额外发射一批粒子。**Restart**：清空粒子，从头播放。

## 创建发射器

喷泉效果的完整设置：

<<< @/../src/tut-95/main.js#fountain

参数按模块分组，挂在发射器上：

| 模块 | 内容 |
| --- | --- |
| `emission` | 发射速率、按移动距离发射、周期性爆发 |
| `shape` | 粒子从什么形状上出生、朝哪个方向飞出 |
| `start` | 每个粒子出生时随机取的值：寿命、速度、尺寸、角度、颜色 |
| `overLife` | 随生命周期变化的尺寸和颜色曲线 |
| `forces` | 重力、阻力、空气速度、场景风、噪声 |
| `collision` | 与平面或场景 SDF 碰撞 |
| `bounds` | 剔除用的包围盒 |

模块的字段随时可以改，发射器每帧重新读取。只有三类改动有额外效果：曲线要重新赋值才会生效（见[生命周期曲线](#生命周期曲线)）；改 `maxParticles`、`space`、`simulation` 会清空现有粒子。

`start` 里的区间是 `ParticleRange`，`set(min, max)` 之后每个粒子在两端之间随机取一个值。所有随机数都由种子 `seed` 和粒子的出生序号算出：种子相同、帧时间序列相同，效果就完全相同。角度一律用弧度（编辑器里显示为度）。

缩放发射器节点会整体缩放效果：形状、速度、尺寸一起变。重力、空气速度和场景风属于世界，不随节点缩放。

### 播放控制

发射器加入场景后自动播放（`autoPlay`）。一个发射周期长 `duration` 秒，爆发按周期重复；`looping` 为 false 时只发射一个周期，粒子全部消亡后 `isFinished` 变为 true。

<<< @/../src/tut-95/main.js#playback

`play()`、`pause()`、`stop()`、`restart()` 控制播放：`stop()` 只是停止发射，已有粒子会继续走完一生，传 `{ clear: true }` 才立即清空。`emit(n)` 在下一步额外发射 n 个粒子，不管是否在播放。`prewarm` 让循环效果一开始就像已经播放了一个周期，适合场景加载时就该存在的烟或火。`simulationSpeed` 缩放效果的时间。

一帧超过 0.1 秒时（比如卡顿或切到后台标签页），这一步只按 0.1 秒模拟，效果会稍微变慢，但粒子不会突然飞出一大段。

## CPU 还是 GPU

| `simulation` | 实际后端 |
| --- | --- |
| `'auto'`（默认） | WebGPU 下且 `maxParticles` ≥ 1000 时用 GPU，其他情况用 CPU |
| `'gpu'` | WebGPU 下用 GPU；WebGL2 下退回 CPU，粒子数截到 `ParticleEmitter.cpuFallbackMaxParticles`（默认 20000），并在控制台警告一次 |
| `'cpu'` | 总是用 CPU，粒子数不截断 |

`activeSimulation` 返回实际在用的后端。两种后端的参数、随机数和积分顺序完全相同，切换后效果的分布一致；但 CPU 用双精度、GPU 用单精度，开了噪声之后单个粒子的轨迹会逐渐分开。

怎么选：

- **GPU** 的模拟、出生和写渲染数据都在一次计算调度里完成，CPU 只做发射调度，开销与粒子数基本无关。在测试用的桌面显卡上，100 万个粒子整帧的 GPU 时间约 6 毫秒。
- **CPU** 每个粒子每帧大约花零点几微秒，开了噪声、风和碰撞后接近 1 微秒，而且每帧要上传全部实例数据。几万个粒子是实际上限。
- 粒子少的小效果（几百个以内）用 CPU 更划算：每个 GPU 发射器每帧都有一次单独的调度。`'auto'` 的 1000 个阈值就是按这个设的，场景里有大量小火堆时让它们留在 CPU 上。

示例在 CPU 上会把粒子数和发射率按比例缩到 2 万：

<<< @/../src/tut-95/main.js#simulation

## 发射与容量

- `emission.rate`：每秒发射数，与帧率无关，不足一个的部分累计到下一帧。一帧内发射的粒子按出生时刻错开，发射器快速移动时拖尾也是连续的。
- `emission.rateOverDistance`：发射器每移动一个单位发射多少个，用于轮胎烟尘、尾迹。
- `emission.bursts`：`ParticleBurst` 列表，每个周期内在 `time` 秒爆发 `count` 个（区间内取整数），可以按 `interval` 重复 `cycles` 次。

`maxParticles` 是同时存活粒子数的硬上限，超过时新粒子直接丢弃，不会顶掉老粒子。它按"可能还活着"来计数，也就是按寿命上界判断，所以要留够余量：持续发射时大约需要 `rate × 最长寿命`，再加上爆发的数量。示例喷泉每秒 2 万个、最长 4 秒，持续部分就是 8 万，10 万的容量为每个周期的爆发留了余量。`aliveCount` 同样是这个上界，不是精确的存活数。

## 形状

粒子从形状上出生，默认朝 +Y 方向飞出：

| `shape.type` | 出生位置 | 飞出方向 | 用到的参数 |
| --- | --- | --- | --- |
| `point` | 节点原点 | +Y 周围 `angle` 半角内 | `angle` |
| `sphere` | 球体 | 从球心向外 | `radius`、`thickness`、`arc` |
| `hemisphere` | 上半球 | 从球心向外 | `radius`、`thickness`、`arc` |
| `box` | 盒体 | +Y 周围 `angle` 半角内 | `boxSize`、`thickness`、`angle` |
| `cone` | 底面圆盘 | 越靠外越向外倾斜，边缘处倾斜 `angle` | `radius`、`thickness`、`angle`、`arc` |
| `circle` | XZ 平面上的圆盘 | 水平向外 | `radius`、`thickness`、`arc` |
| `edge` | 沿 X 轴、长 `length` 的线段 | +Y 周围 `angle` 半角内 | `length`、`angle` |

`thickness` 为 0 时只在表面（盒体的面、圆盘和圆锥的边缘）出生，为 1 时在整个体积内出生，中间值是一层壳；所有形状都按面积或体积均匀取样。`angle` 设为 π 就是所有方向。`randomizeDirection`（0~1）把飞出方向向随机方向混合。`inheritVelocity` 让粒子继承发射器速度的一部分，只在世界空间下有效。

## 生命周期曲线

`overLife.size` 和 `overLife.color` 是乘在出生值上的系数，横轴是归一化年龄（出生为 0，消亡为 1）。示例用两个小函数从关键帧构造曲线：

<<< @/../src/tut-95/main.js#curves

烟的设置用到了这两种曲线：

<<< @/../src/tut-95/main.js#smoke

- `overLife.size` 是一条数值曲线（`Interpolator`，目标 `'number'`），为 null 时恒为 1。
- `overLife.color` 是 `ParticleGradient`：一条 RGB 曲线（`'vec3'`）和一条 Alpha 曲线（`'number'`），任一条为 null 时那部分恒为 1。烟就只给了 Alpha 曲线，颜色保持出生值。
- 曲线在赋值时烘焙成查找表（每条 64 个采样点）。**改了曲线对象之后要重新赋值一次**，否则不会生效。

出生颜色 `start.colorA` / `colorB` 是线性颜色，可以大于 1：配合摄像机的 bloom 会发光，喷泉和光点就是这样做的。生命周期颜色是 0~1 之间的系数，HDR 亮度应该放在出生颜色上。

## 力

每一步先加上重力和噪声的加速度，再按阻力把速度拉向空气速度，最后移动，然后处理碰撞。

- `forces.gravity`：世界空间的加速度，地球重力是 `(0, -9.8, 0)`。
- `forces.drag`：粒子被空气带动的强弱，单位 1/秒，表示速度趋近空气速度的快慢。烟、雪、树叶取大值，火花取小值。
- `forces.airVelocity`：空气的速度（世界空间）。
- `forces.windInfluence`：把场景风 `scene.env.wind` 的多少叠加到空气速度上。风在每个粒子所在的位置采样，阵风扫过时粒子会一片一片地被吹动；风的推力 1 相当于 10 m/s。

> **空气速度和风都要靠阻力才起作用。** `drag` 为 0 时粒子完全不受空气影响，设了 `airVelocity` 或 `windInfluence` 也看不到效果。

场景风是草、植被和粒子共用的：

<<< @/../src/tut-95/main.js#wind

### 噪声

`forces.noise` 是旋度噪声：一个在空间里平滑变化的旋转加速度场，会让粒子打旋，但不会把它们聚成团。

<<< @/../src/tut-95/main.js#swarm

- `strength`：平均加速度，最强的旋涡约为它的三倍。
- `frequency`：每单位多少个噪声格，越大旋涡越小。
- `scrollSpeed`：噪声场变化的速度（单位/秒），为 0 时是静止的场。

噪声属于效果本身，会随节点缩放；局部空间下噪声场还会跟着发射器一起移动。只加噪声、不加阻力时，粒子会被越推越快；配合 `drag`，速度会稳定在 `strength / drag` 附近，粒子就会沿着旋涡走，光点效果就是这样做的。

## 碰撞

每个粒子当作一个小球（半径是尺寸的一半乘 `radiusScale`），撞上表面时推出表面并反弹。粒子之间不互相碰撞。

| `collision.mode` | 碰撞对象 |
| --- | --- |
| `'none'` | 不碰撞 |
| `'plane'` | 世界空间的无限平面：法线 `planeNormal`（默认朝上），到原点的距离 `planeHeight`，默认法线下就是地面高度 |
| `'sdf'` | 场景的符号距离场，包括静态网格、地形和带距离场的运动网格。**仅 GPU 模拟**，并且需要开启场景 SDF（`scene.sdf.enabled`，见[网格 SDF 与全局 SDF](zh-cn/sdf.md)）；CPU 模拟和没有字段的场景会忽略它 |

- `bounce`：撞进表面的速度保留多少反弹回去，0~1。
- `friction`：接触时沿表面的速度每步损失多少，0~1。
- `lifetimeLoss`：每次撞向表面消耗多少寿命，1 表示一碰就消失（雨滴落地）。

全局 SDF 只覆盖摄像机周围约 ±128 单位，越远越粗，远处的碰撞会变得不精确。

## 世界空间与局部空间、拖尾

`space` 决定粒子出生后存在哪个坐标系：

- `'world'`（默认）：出生后就与发射器无关，移动发射器会留下拖尾。适合烟、尾焰、脚步扬尘。
- `'local'`：粒子跟着节点平移、旋转、缩放，适合"粘"在物体上的效果，比如火把上的火苗、护盾光环。

彗星用 `rateOverDistance` 代替 `rate`，粒子数与移动距离成正比，所以无论快慢，拖尾都一样密：

<<< @/../src/tut-95/main.js#trail

示例在每帧的 tick 里移动发射器：

<<< @/../src/tut-95/main.js#motion

模拟在场景的 `lateupdate` 事件里进行，晚于脚本和物理，所以挂在刚体上的发射器不会落后一帧。

## 渲染：ParticleSpriteMaterial

发射器用 `ParticleSpriteMaterial` 绘制，通过 `material` 访问。粒子材质不受光照。

| 属性 | 作用 |
| --- | --- |
| `blendMode` | `'blend'`（默认）是普通透明，适合烟尘；`'additive'` 叠加变亮，适合火花和辉光；`'none'` 配合 `alphaCutoff` 可以做树叶这类镂空粒子 |
| `texture` | 颜色贴图（sRGB，alpha 作为覆盖度），与粒子颜色相乘。不设时是柔边圆点。只有 R 通道的遮罩贴图打开 `alphaFromRed` |
| `alignment` | 四边形的朝向，见下表 |
| `flipbook` | 序列帧：`{ tilesX, tilesY, mode, cycles, blend }`。`mode` 为 `'lifetime'` 时随生命周期播放，`'random'` 时每个粒子固定显示随机的一帧 |
| `softDistance` | 软粒子：离背后场景的距离小于它时逐渐淡出，避免插进地面处出现硬边。大于 0 时需要场景深度 |
| `nearFadeDistance` | 离近平面这么近时淡出，避免大面片贴脸糊满屏幕 |

| `alignment` | 朝向 |
| --- | --- |
| `'view'` | 平行于屏幕 |
| `'velocity'` | 面向摄像机，高度方向沿运动方向 |
| `'stretched'` | 同 velocity，并按速度拉长：长度 = 尺寸 × `stretchLengthScale` + 速度 × `stretchSpeedScale` |
| `'horizontal'` | 平躺在 XZ 平面上，适合地面上扩散的波纹 |
| `'vertical'` | 竖直立起并转向摄像机 |

同一个发射器的粒子按出生顺序绘制（`sortOrder` 可改为先画最新的），**不按深度排序**。顺序在整个生命周期内不变，不会闪烁；但 `blend` 粒子很密时前后关系可能不对，这时可以开 OIT，见[粒子与 Sprite](zh-cn/particles-sprites.md#透明排序与-oit)。粒子不进阴影图。

## 包围盒

发射器的包围盒用于视锥剔除。

- `bounds.mode = 'auto'`（默认）：CPU 模拟时逐粒子统计精确的包围盒。GPU 模拟读不回粒子，只能根据形状、速度上界、力和寿命做保守估计，结果偏大，只会让剔除变松，画面不会错。
- `bounds.mode = 'fixed'`：用 `bounds.box`（发射器局部空间）。效果范围已知时用它可以得到更紧的剔除。

不管是否可见，发射器每帧都会模拟。

## 在编辑器里

在 **Add** 菜单中选 **Particle Emitter**。属性面板按上面的模块分组：

- **Playback** 分组里的按钮可以播放、暂停、停止和重新开始；角度类参数显示为度。
- **Over Lifetime** 里的 SizeOverLife 和 ColorOverLife 为空时，先点 ✓ 创建一条恒为 1 的曲线，再点铅笔按钮打开编辑窗：尺寸是曲线编辑器，颜色是渐变编辑器（上方是颜色关键帧，下方是 Alpha 曲线）。编辑时粒子实时更新，取消会还原，确定后可以撤销。
- **Bursts** 是列表，用 + 添加爆发。

## 限制与坑

- **GPU 模拟仅限 WebGPU。** 在 WebGL2 上，`'gpu'` 和 `'auto'` 都会退回 CPU，粒子数最多 `cpuFallbackMaxParticles` 个。为 GPU 设计的大效果在 WebGL2 上会变稀，必要时像示例那样按 `activeSimulation` 缩小发射率。
- **空气速度和风必须配合 `drag` 使用。** `drag` 为 0 时它们没有效果。
- **SDF 碰撞只在 GPU 上有效**，还需要开启场景 SDF。
- **单个粒子读不回来。** 没有逐粒子回调，`aliveCount` 是上界；效果是否结束按时间判断（发射结束后再过最长寿命）。
- **改 `maxParticles`、`space`、`simulation` 会清空现有粒子**，运行时切换会看到效果从头开始。
- 每个 GPU 发射器每帧有一次单独的计算调度。几十个以上的大发射器同时存在时，优先合并成少量较大的发射器。
