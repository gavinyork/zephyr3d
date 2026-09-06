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

## 7. 涉及文件

| 文件 | 改动 |
| --- | --- |
| `libs/scene/src/render/water_caustics.ts` | 新增 `createCausticHeightShader`（光栅化位移水面）、`getHeightMapFormat`、高度网格缓冲、高度 pass 与程序缓存；`render()` 增加 `heights` 参数；splat 门控改用 `surfacePos.y` |
| `libs/scene/src/material/shader/helper.ts` | 声明/绑定 `Z_UniformCausticHeightMap`；接收端按位移深度门控 |
| `libs/scene/src/render/drawable.ts` | `DrawContext.waterCausticHeightTexture` |
| `libs/scene/src/render/rendergraph/forward_plus_builder.ts` | 分配 `waterCausticHeights` 纹理，传入渲染器并发布/每帧清空 |
| `test/src/render/water_caustics_shader.test.ts` | 新增测试 |
| `visual-test/src/scenes/water.ts` 等 | 新增 `water-caustics-crest` 场景与基线 |
