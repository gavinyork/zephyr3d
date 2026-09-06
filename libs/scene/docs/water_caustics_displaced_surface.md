# 水体焦散：位移水面门控（光空间高度图方案）

分支 `feat-water-caustics`，2026-09-06。

## 1. 问题

水体有明显起伏时，焦散在**静态水面高度**处被硬截断：高于静水位、但被波峰覆盖的接收体
（露出水面的礁石顶、浅滩、码头桩）既没有焦散，也没有水体介质的透射着色，画面上呈现为一条
与静水位齐平的水平直线。

## 2. 根因

焦散光程的两端都用静态水位 `Water.worldMatrix.m13` 做"是否在水下"的判定，而光子实际是透过
**位移后**的水面折射的，两端不一致：

| 位置 | 文件 | 原逻辑 |
| --- | --- | --- |
| 接收端 | `libs/scene/src/material/shader/helper.ts` `calculateWaterCaustic` | `slotDepth = waterMedia.w - worldPos.y`，`slotDepth <= 0` 直接跳过该水体；最终 `submerged = smoothstep(0, 0.05, depth)` |
| 喷溅端（WebGPU 场景深度落点） | `libs/scene/src/render/water_caustics.ts` 光子 splat 顶点着色器 | 不动点迭代只接受 `scenePos.y < waterLevel` 的落点 |

喷溅端本身已经通过 `calcVertexPositionAndNormal` 得到了位移后的入射点 `surfacePos`，
只是门控没用它。

## 3. 被否决的方案：接收端解析求波高

第一版实现把主导水体的 `WaveGenerator` 用 `setupUniforms(scope, 0)` 绑进 light pass 的全局
bind group，在接收端逐片元调用新增的 `calcFragmentHeight(xz)` 求波高。它在单元测试和
`build:check` 下都能通过，但有一个致命缺陷：

- 水面材质（`WaterMaterial`）自己也走 `calculateLightAttenuation`，因而会进入
  `calculateWaterCaustic`；而它在 group 2 用同一个 generator 再声明一遍同名 uniform
  （`sizes`、`waveParams`、`numOctaves`……）。
- `ProgramBuilder` 对已注册的全局变量名再次赋 uniform 表达式，会走 `$_registerVar` 的
  setter，退化成一条**全局作用域的赋值语句**而不是新声明（`programbuilder.ts` `$set` →
  `prop in scope`）。水面材质的着色器直接损坏。

其它缺点：一个 light pass 只能绑一个 generator，混用 generator 的多水体只能退回平坦门控；
FBM 多倍频程噪声 / Gerstner 多波 sin-cos 会落到**每个不透明片元**上。

该版源码曾丢失，仅存于当日 `libs/scene/dist` 的 source map 中，已提取为
`E:/tmp/caustic-displaced-gate.patch`，仅作参考，不要恢复。

## 4. 采用方案：光空间高度图

### 4.1 核心观察

接收端已经把片元投影进焦散贴图：`mapNDC = (dot(rel, frameX), dot(rel, frameY)) * (frameX.w, frameY.w)`，
再 warp 得到 `uv`。这个投影是**沿光线方向不变**的。接收端估算的入射点
`entry = worldPos - L * t` 与片元在同一条光线上，所以**入射点处的水面高度可以用与焦散
pattern 完全相同的 `uv` 查到**，不需要任何额外投影计算。

于是只需在焦散 pass 里多渲染一张与焦散贴图同 slice、同 warp、同分辨率的**高度图**。

### 4.2 数据流

```
WaterCaustics pass (forward_plus_builder.ts)
  ├─ 高度图 pass ─── 每个水体一次全屏 quad ──► waterCausticHeights (RGBA16F, 通道 i = slot i)
  ├─ 光子 splat ─── 每个水体一次 point-list ─► waterCaustics (R16F)
  ├─ blur / temporal resolve（仅焦散贴图，高度图不做）
  └─ 发布 ctx.waterCausticTexture / ctx.waterCausticHeightTexture / ctx.waterCausticUniforms

Light pass (helper.ts declareWaterCausticUniforms / setWaterCausticUniforms)
  └─ group 0 多一张 Z_UniformCausticHeightMap，采样器 clamp_linear_nomip
```

### 4.3 高度图着色器 `createCausticHeightShader`：光栅化位移水面

不在 texel 处"查询"波高，而是**把位移后的水面网格画进高度图**，每个水体一次索引三角网格绘制
（`HEIGHT_GRID_SIZE = 256`，一次性建好顶点序号与索引缓冲）：

1. 顶点序号 → 网格坐标 → 在该水体 footprint 的 warped 贴图范围（复用 `_updateGridBounds`）内取
   `warpedNDC` → `unwarpCausticNDC` → slice 平面点 `planePos`。
2. 沿 `L` 扫到该水体静水面得到静水面点 `x`（`surfaceXZ`）。
3. `calcVertexPositionAndNormal(x)` 得到位移后的水面点 `p = x + d(x)`。
4. 把 `p` 沿光投影回 warped 贴图坐标（与 splat 投影光子落点完全相同的两个点积 + warp），
   作为顶点 clip 位置；输出 `height = p.y - level` 和 region 内外标志。
5. 片元：region 外 `discard`；否则写 `height + CAUSTIC_HEIGHT_BIAS`（偏置 8），并用**颜色写掩码**
   只落到本水体的通道（覆盖写，不混合）。目标先清零。

这样贴图里每个 texel 记录的就是**渲染出来的那张水面**（水面网格同样由位移顶点构成）在该光线
上的高度，水平位移天然正确；水面自交处由后绘制的三角形覆盖（混合会把两层高度相加，所以用
写掩码而不是加法混合）。

**WebGPU 上 clip y 取反**：接收端按 `v = 0.5 + 0.5·ndc.y` 采样。WebGL 渲染到纹理时 clip y 落在
这一行；WebGPU 上 clip +1 是第 0 行（`v = 0.5 − 0.5·y`），所以高度图在 WebGPU 上倒着画。光子贴图
不需要这个翻转，只是因为它经过 blur×2 + temporal resolve 三次全屏 pass，每次在 WebGPU 上各翻一次，
奇数次刚好翻回来（这意味着 `causticsTemporalStrength = 0` 时 WebGPU 的光子贴图可能是镜像的，
属既有代码的潜在问题，本次未处理）。

**偏置的意义**：清零后的 texel（0）必须与"水面在静水位"（偏置后为 8）区分开。光线穿过静水面的
位置落在 footprint 之外时（例如水域边缘外侧的墙，墙上低于静水位、高于本地波谷的点），该光线上
没有任何水面被光栅化，texel 保持 0，接收端判为"此光线上无水"→ 干燥。若把 0 当成静水位，这些点
会被当成在水下，焦散在墙上沿静水位平切——实测正是这样。半精度在 8±4 范围内精度约 4–8 mm。

### 4.4 接收端 `calculateWaterCaustic` 改动

1. 把 `mapNDC / warpedNDC / uv` 的计算提到水体循环之前。
2. 采样 `waveHeights = heightMap(uv)`，并记录 `insideMap = all(|mapNDC| <= 1)`：贴图之外 clamp
   采样器会重复边界值（别的光线上的波高），此时视为平坦。
3. 循环内：先按静水面算 `slotFlat / slotEntry`，只用于 region 测试（与 splat 按静水面入射点裁剪
   光子的口径一致）；通过后取 `sample = dot(waveHeights, e_i)`：
   - 贴图内且 `sample <= 0.5` → 此光线上没有该水体的水面 → 跳过该 slot（干燥）；
   - 否则 `slotWave = insideMap ? sample - 8 : 0`，`slotDepth = level + slotWave - worldPos.y`，
     再做 `slotDepth > 0` 与"取最低水面"的选择。
4. 后续 Beer-Lambert、defocus、`submerged` 全部沿用 `depth`，自动变为位移深度。

高度图沿光线存储，接收端**不需要估算入射点**：光线与水面的交点就在同一 texel 上。

**删掉了外层 `slotDepth > 0` 平坦门。** 早先一版犯过"外门用平坦深度"的错：高于静水位的
接收体连 entry 估算都进不了。

### 4.5 喷溅端改动

场景深度落点的接受条件从 `scenePos.y < waterLevel` 改为 `scenePos.y < surfacePos.y`
（该光子入射点处的位移水面），与接收端口径一致。

### 4.6 为什么不做"反演"

FFT（默认 choppiness -1.5 / -1.2 / -0.5）和 Gerstner 是拉格朗日式生成器：`calc(x)` 返回静水面点
`x` 移动到的位置 `x + d(x)`，水平位移 `d` 与波高同量级。曾尝试两种做法：

- **直接在 `q` 处求值**（欧拉）：得到的是 `q + d(q)` 处的水面，在竖墙上表现为焦散截面与实际
  波形错位（用户用 FFT 实测发现）。
- **不动点反演** `x ← q - d(x)`：要求 `|∇d| < 1`，FFT 在 choppiness 1.5 下波峰附近接近甚至越过
  这个界（正是 foam 用 Jacobian 标记自交的地方），迭代不收敛，波峰处高度成为垃圾——实测
  Gerstner 吻合、FFT 仍大幅错位。

光栅化（4.3）没有收敛问题，也不依赖任何生成器内部结构，因此被采用。光子 splat 保留从静水面
网格点出发的做法：落点 `x + d(x)` 及其法线都是真实水面的样本，只是光子密度带 `1/J` 的偏差，
自交处才显著，属二阶量；对 splat 做反演同样会在自交处发散，得不偿失。

### 4.7 为什么优于方案 3

- light pass 不绑任何 generator：无 uniform 命名冲突，bind group / shader 变体 hash 不用动。
- 每个水体用自己的 generator 生成高度，混合 generator 的多水体天然支持，最多 4 个 slot
  （`MAX_CAUSTIC_WATERS`），正好塞进 RGBA 四个通道。
- 接收端每片元只多一次双线性采样。
- 代价：一张 `causticsResolution²` 的 RGBA16F（1024² 为 8 MB）和每水体一次全屏 quad。

### 4.8 顺带修复：WebGL 清屏不重置颜色写掩码

高度 pass 最后一次绘制留下"只写 G"的掩码后，紧接着的光子贴图清屏在 WebGL 上走 `clearBufferfv`，
它遵守写掩码，于是 R16F 光子贴图的 R 通道没被清，光子逐帧累积，焦散越来越亮（两池场景 WebGL2
差 12.6%）。WebGPU 的 loadOp 清屏不受掩码影响。修在 `libs/backend-webgl/src/device_webgl.ts`
`clearFrameBuffer`：清屏前 `WebGLColorState.applyDefaults`（之前只重置了深度掩码），使两后端语义
一致。

## 5. 已知近似

- **入射点仍在静水面上估算**，避免"entry 依赖波高、波高依赖 entry"的循环。
  误差量级 `Δh / tan(太阳仰角)`，相对可见焦散的波长是二阶量。若将来需要更准，可在接收端
  做一次不动点迭代：用查到的波高修正 `t`，再查一次。
- 高度图按 256×256 网格光栅化，网格内高度线性插值；水面自交处取后绘制的一层。
- 光子密度带 `1/J` 偏差（见 4.6）。
- 高度图分辨率等于焦散贴图，texel 尺寸在 range 60 下约 0.1–0.25 m，对米级波长足够。

## 6. 验证

- 单元测试 `test/src/render/water_caustics_shader.test.ts`：新增高度图着色器在两个后端的编译
  测试（含显式 LOD 断言）、接收端采样 `Z_UniformCausticHeightMap` 的断言、uniform 声明测试。
  `src/render` 目录 290 个测试全部通过。
- 视觉回归 `visual-test`：新增场景 `water-caustics-crest`——顶部高出静水位 0.7 m 的礁石
  置于 0.65 m 振幅的 Gerstner 涌浪下，钉住"焦散与介质着色随波峰爬上礁石面、无水平截断"。
  on/off/deep-bed/moving 四个场景两后端基线不变；two-pools 基线在两块焦散落点的下游边缘一圈
  像素上变化（区域边缘由静水位门控改为"无水即干"），已检视后重录。
- 修复前后 A/B（同一场景、同一 bundle，仅引擎 dist 换成修复前版本）：差异像素集中在礁石面
  水线下方的一条带里。修复前该带沿静水位平切，带内无焦散、无介质着色；修复后焦散条纹与介质
  着色随波浪形水线起伏。两后端一致。
- 临时竖墙对照场景（不入库，水域边界正好贴在墙面）：分别渲染线框/实体、焦散开/关，用"焦散开-关"
  的像素差定位焦散水线。偏置修复前，焦散水线在波谷段是一条恒定的静水位直线（texel 0 被当成
  静水位）；修复后跟随水面，残差约 0.1 m，与远处水面网格 LOD 变粗后线性插值削低波峰的量级一致
  （λ=4.5 m、A=0.4 m 时约 0.09 m）。此前的欧拉取样与不动点反演两版在 FFT 下均明显错位。

## 7. 后续：CausticsRange 边界的两条接缝

2026-09-07。位移门控落地后，用户在 FFT 大浪下报告贴图边界出现明显裂缝。这是**两个独立缺陷**
叠在同一条线上，都只在"range 而非水域决定贴图边界"时出现——所有既有场景要么把贴图贴合到水池
（two-pools / deep-bed / moving），要么相机足够近使水面填满 range（on / crest），所以六个场景
一个都没覆盖到。

### 7.1 光子网格被硬裁在边界（提交 `7ca95c15`）

`_updateGridBounds` 把网格 clamp 到 `[-1, 1]`。光子从静水面网格点发射，落点由**位移后**的水面
折射决定，水平位移会把光子双向带过边界——但"向外走"的光子存在，"本该从界外飘进来"的那些
**从未被发射**。边界 texel 于是缺一半来源，形成一圈内部任何 texel 都没有的密度。

实测原始 pattern 剖面：边界内侧约 165、内部约 140，确实有一圈亮环；而 edge fade 恰好在边界处
把 pattern 拉平到 1.0，把这圈亮环变成可见接缝。

**修复**：网格向外扩 `GRID_BORDER_MARGIN = 0.15`，且**只在被 range 限制的一侧**——被水域
footprint 限制的一侧不扩，否则光子会被 region test 杀掉、白白稀释权重。`_gridFraction` 本就同时
缩放每光子权重和 `_resolvePhotonGrid` 解出的网格尺寸，所以归一化与每 texel 密度都不变，只是光子
数增加（默认 warp 1.5 下约 +11%）。接缝台阶从 +7.9 降到 +2.2（关掉 choppiness 的参考值 −1.5）。
margin 加到 0.35 无进一步改善，故取 0.15。

### 7.2 depth 在边界硬切换 + 透射率的凸性（提交 `211fae1f`）

`depth` 跨越边界是硬切的：界内 `level + wave - y`（位移水面），界外 `level - y`（退回静水面）。
而 `transmittance = exp(-σ·depth)` 是 depth 的**凸函数**，按 Jensen 不等式，界内逐像素波高抖动
后的均值 `E[exp(-σ·w)] = exp((σ·σ_w)²/2) > 1`，界外是恒定值——界内系统性偏亮，且**红通道最严重**
（σ_red 最大）。这解释了为什么只在浪大时出现、水越浑越明显、且呈现为一条笔直分界。

浑浊水（absorption 0.55/0.14/0.09）下的量级：

| 波高 σ_w | R | G | B |
| --- | --- | --- | --- |
| 0.5 m | 1.18× | 1.02 | 1.02 |
| 1.0 m | 1.91× | 1.08 | 1.07 |
| 1.5 m | 4.28× | 1.20 | 1.15 |

**修复**：`slotWave` 按**已有的那条 edge fade** 衰减到 0，让 depth 在边界连续过渡到静水面值。
顺带把 `edge` 的计算从水体循环之后提到循环之前（波高和 pattern 都要用它）。

### 7.3 排查教训：弱介质会把 7.2 完全掩盖

修 7.1 时，我用 `causticsIntensity = 0`（只留 Beer-Lambert）测跨界剖面，得到平坦结果，据此
**错误地排除了** depth 路径。原因是当时复现场景的 absorption 只有 0.25、水深 3 m，把 7.2 的
影响压到了 5% 以下。用户随后用浑浊水复现，同一路径放大了几十倍。

**结论**：验证焦散边界行为时，介质强度和波高都必须取到目标场景的量级；清水浅池会让一整类
缺陷测不出来。凸性效应的判据是 `exp((σ·σ_w)²/2)`，可以先算再决定场景参数。

### 7.4 回归场景 `water-caustics-range-border`

100 m 水域 / 20 m range，FFT 大浪含水平位移，浑浊介质，相机高俯视使整条边界弧在画面内。三个
条件缺一不可（见 7.1–7.3）。

**FFT 是确定性的**：噪声纹理来自 `PRNG(randomSeed)`（mulberry32，默认种子 0），不是
`Math.random`。`water-caustics-off/on` 里"FFT seeds itself from a random noise texture"的注释
是过时的，已一并订正。实测两后端各重跑两次均按近似严格容差通过。

**反向验证**（把修复 revert 回去跑同一基线）：

| 状态 | webgl2 差异 |
| --- | --- |
| 仅 revert 7.1 | 4.46% |
| 仅 revert 7.2 | 5.19% |
| 两个都 revert | 6.97% |

预算是 0.05%，两个缺陷都能被单独钉住。

### 7.5 基线影响

重录了 `on` / `deep-bed` / `moving` / `crest` 四个场景 × 两后端共 8 张。逐张核对过 expected/
actual/diff：各场景要钉住的性质均未破坏——`crest` 的礁石水线仍随波起伏（差异全在周围水面的
焦散丝线上，礁石在贴图中心区 `edge = 1`，衰减不生效）；`deep-bed` / `moving` 的焦散块仍是沿
太阳方向错切的水池轮廓。`off` 与 `two-pools` 两后端原样通过（footprint 限制，边界不由 range
决定）。全量视觉回归 113 passed / 15 skipped / 0 failed。

## 8. 涉及文件

| 文件 | 改动 |
| --- | --- |
| `libs/scene/src/render/water_caustics.ts`（7 节） | 新增 `GRID_BORDER_MARGIN`，光子网格向 range 边界外扩 |
| `libs/scene/src/material/shader/helper.ts`（7 节） | `edge` 提到水体循环之前；`slotWave` 按 `edge` 衰减 |
| `libs/scene/src/render/water_caustics.ts` | 新增 `createCausticHeightShader`（光栅化位移水面）、`getHeightMapFormat`、高度网格缓冲、高度 pass 与程序缓存；`render()` 增加 `heights` 参数；splat 门控改用 `surfacePos.y` |
| `libs/scene/src/material/shader/helper.ts` | 声明/绑定 `Z_UniformCausticHeightMap`；接收端按位移深度门控 |
| `libs/scene/src/render/drawable.ts` | `DrawContext.waterCausticHeightTexture` |
| `libs/scene/src/render/rendergraph/forward_plus_builder.ts` | 分配 `waterCausticHeights` 纹理，传入渲染器并发布/每帧清空 |
| `test/src/render/water_caustics_shader.test.ts` | 新增测试 |
| `visual-test/src/scenes/water.ts` 等 | 新增 `water-caustics-crest` 场景与基线 |
| `visual-test/src/scenes/water.ts` 等（7 节） | 新增 `water-caustics-range-border` 场景与基线；订正 FFT 确定性注释 |
