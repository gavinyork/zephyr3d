# 水体泡沫改造：有记忆的平流泡沫场

> 状态：方案已定，尚未实现（2026-10-16）。分支 `gamedemo`。
> 本文是交接文档，接手的 agent 读完即可开工。

## 1. 为什么要改

zephyr3d 现在的泡沫效果差。根源不在参数，而在结构：三个泡沫来源都只按**当前时刻**计算，没有记忆。

| 来源 | 位置 | 计算 |
|---|---|---|
| FFT / Gerstner 波峰泡沫 | `libs/scene/src/render/fft_wavegenerator.ts` 约 1223 行，`gerstner_wavegenerator.ts` 约 333 行 | 雅可比行列式折叠：`pow(-min(0, det - foamWidth), foamContrast)` |
| 近岸浪碎浪泡沫 | `libs/scene/src/render/shore_wave_generator.ts` 的 `evaluate`（约 374 行）和 `calcFragmentNormalAndFoam` | `smoothStep(BREAK_SHOAL,1,shoal)·smoothStep(0.55,0.95,profile)`，用 `foamPattern` 两层 flow map 加纹理 |
| 岸线接触带 | `libs/scene/src/material/water.ts` 的 `waterShoreFoam`（约 1994 行） | 按离水线距离生成一条带，宽度随 run-up 正弦变化 |

三者在 `waterShading` 里按重叠面积合成：`foam = 1-(1-crestFoam)(1-shoreFoam)`。外观由 `utility/textures/foam.ts` 生成的 Voronoi 纹理做黑点阈值。

由此产生的问题：
- 浪峰一过，泡沫立刻消失，不会留在水面上。
- 回流带不走泡沫，沙滩上不会留下退浪纹。
- 没有老化过程，看不到"新泡沫成片、旧泡沫散成网"。

## 2. FluidFlux 3 是怎么做的（RenderDoc 证据）

捕获文件：`F:\FluidFlux_3_0_1_Demo_UE532\fluidflux1.rdc`（UE 5.3.2，D3D11）。

- 1690 和 1708 是一对 512² RGBA32F 乒乓状态场，帧首由全屏 draw 迭代，随后由 Niagara 计算读取。
- 各通道的值域：R/G ∈ [-1.3, 1.1]，B 最大 1288，A ∈ [0, 1]，由此判断通道含义为 **(流速 xy, 水高, 泡沫)**。
- 把 **alpha 通道**单独导出后看到：岸边和礁石四周是厚泡沫，礁石下游拖着尾迹，开阔水面上有被流动带走的软斑块。这说明泡沫是一个随流平流、逐帧累积和衰减的标量场。
- 水面 PS 读 512² 的泡沫 mask（R8，1684）和细节噪声，在场的基础上叠纹理。

结论：泡沫应当是**一张持久的场**，每帧依次做「平流 → 注入 → 衰减/老化」；着色阶段只负责读取，再加纹理细节。

## 3. 方案

### 3.1 新类 `WaterFoamField`（新文件 `libs/scene/src/render/water_foam.ts`）

照搬 `WaterInteraction`（`render/water_interaction.ts`）已经验证过的写法：
- 两张 `rgba16f` 纹理乒乓，格式回退方式参考 `HEIGHT_FORMATS`。
- 分辨率 512，单元 0.25 m，窗口 128 m，与水线场网格一致。
- 窗口按单元对齐跟随相机。窗口移动时用整数 `shift` 重投影，从外面移入的纹素按 0 处理，做法同 `createWaterInteractionStepShader` 里的 `q = p + shift`。
- 步进用**全屏片元 pass**，不用 compute，这样 WebGL2 和 WebGPU 都能跑。
- 通道约定：R = 覆盖率，G = 年龄（0 新，1 老），BA = 本帧流速。流速写进场里，渲染端的 flow map 就能和平流用同一个速度。

每帧的步进顺序（`dt` 取真实帧间隔并 clamp）：
1. **平流**：半拉格朗日回溯 `src(x − v·dt)`，双线性采样。
2. **流速 v**（解析计算）：
   - 风漂移；
   - 近岸浪的向岸推进：波峰速度 × 浪碎程度，方向取水线距离场的梯度；
   - 冲上沙滩后的回流：沿床面下坡方向。

   方向数据来自 `WaterlineField`（`render/sdf/waterline.ts`）。没有水线场时，只保留风漂移。
3. **注入**：`max(旧值, 源)` 加一个饱和累积项；新注入的泡沫把年龄拉回 0。
4. **衰减与老化**：覆盖率按半衰期指数衰减，深水衰减快、岸边慢；年龄每帧增加 `dt / 寿命`；再加一个很小的扩散项。
5. 干陆地清零，网格边缘做淡出。

### 3.2 注入源：给 `WaveGenerator` 加一个可选方法

在 `render/wavegenerator.ts` 的接口里加可选的 `calcFoamSource?(scope, xz): PBShaderExp`，返回**不带纹理**的原始密度：
- FFT / Gerstner：复用现有雅可比计算，只返回 foam 标量。
- `ShoreWaveGenerator`：把 base 的结果与 `evaluate(...).z` 按 `1-(1-a)(1-b)` 合成。
- `InteractiveWaveGenerator`：直接透传 base 的结果；interaction 自带的泡沫通道保持不变。
- 步进 pass 通过 `waveGenerator.setupUniforms(scope, 0)` 和 `applyWaterBindGroup(bindGroup)` 拿到所需的纹理和时钟。
- 岸线接触也算一个注入源：离水线距离小于 `shoreFoamDepth` 时注入，强度随 run-up 相位变化。这样冲上沙滩的泡沫会被回流带走，留下退浪纹。

### 3.3 材质读取（`material/water.ts` 的 `waterShading`）

- 新增属性 `foamField`（默认开）。开启时，`crestFoam` 改为采样场的 R/G；关闭时完全走现有逻辑。
- 场纹理和窗口 uniform 在 `applyUniforms` 里绑定，因为它们每帧都变；`applyUniformValues` 只在材质改动时运行，放那里会用到旧数据。
- 外观：保留黑点阈值 + Voronoi 纹理。阈值和羽化宽度随年龄变化：新泡沫阈值低，成片发白；老泡沫阈值高、羽化窄，只剩细丝网纹。纹理 UV 用场里 BA 存的流速做两层 flow map。把 `ShoreWaveGenerator.foamPattern` 的写法抽成共享函数来复用。
- 场开启时，`waterShoreFoam` 只保留紧贴水线的一条极窄接触线；场关闭时，行为与现在一致。
- 新增 debug 输出 `foamField`：R 和 G 用伪彩显示。加入 `WaterDebugOutput` 和对应的标签列表。

### 3.4 接线与参数

- 在 `WaterMaterial.update(frameId, elapsed)` 里驱动步进。仿照 `_interactionUpdateState`，用 WeakMap 记录帧号，保证每帧只步进一次。相机位置的获取方式参考 `scene/water.ts` 的 `updateInteractionFocus`。
- 可调参数（Water 节点及 `utility/serialization/scene/water.ts`）：
  - `FoamFieldEnabled`
  - `FoamLifetime`（秒，默认 6）
  - `FoamDeepDecay`
  - `FoamInjection`
  - `FoamDrift`
  - `FoamAgeSharpen`

  现有的 `foamAmount` / `foamFalloff` / `foamColor` 继续负责外观。
- 编辑器 MCP（`utility/editor/src/helpers/mcpwater.ts`）补上这些字段。

## 4. 分阶段（每阶段结束都停下来，由用户目测）

1. **P1**：场本身 + FFT 雅可比注入 + 风漂移平流 + 衰减；材质读 R，外观仍用旧阈值；加 debug 视图。预期效果：开阔海面的白浪会拖出逐渐散去的尾巴。
2. **P2**：近岸浪碎浪注入 + 向岸流速 + 回流 + 岸线接触注入。预期效果：浪碎后泡沫推上沙滩，再被回流带下来。
3. **P3**：年龄驱动的外观 + 场流速驱动的 flow map 纹理 + 收窄岸线带。

## 5. 风险

- 泡沫纹理会随流速相对网格移动，但运动矢量只覆盖几何，而水的 `TAAStrength` 是 0.9，可能出现拖影。到 P3 观察后，再决定要不要在泡沫像素上降低历史权重。
- 采样器数量：步进 pass 要绑 FFT 纹理、水线场和场自身，WebGL2 下仍在 16 张以内。
- WebGL2 的 std140：只有一个 float 的 uniform 结构体要补齐到 16 字节，否则 draw 会静默失效。

## 6. 项目约束（接手必读）

- 改 `libs` 会触发 vite 整页刷新，编辑器里未保存的场景会丢。改代码前先查 `scene_changed`，请用户先保存。
- `rush build` 可能谎报 up-to-date，要进 `utility/editor` 单独 build。visual-test 走 dist，之前必须先重建引擎。
- 着色器变量名避开 WGSL 保留字（`set`、`pass`、`filter`、`sample` 等），否则程序会直接编译失败。
- `pb.select(a, b, cond)` 的参数顺序是条件为假时取的值在前，写完要回读生成的着色器确认。`pb.equal` 是整向量比较，逐分量比较要用 `compEqual`。
- WebGPU 下不可过滤的纹理（例如 `rgba32f`）必须配 nearest 采样器，否则 bind group 创建失败，结果全为 0。
- 每阶段做完就停下来让用户目测，不要主动加单测或截图比对。
- 提交信息只写一行英文，不写正文，不加签名；提交信息里不要提 plans。
- 测试场景：编辑器打开 `F:\zephyrprojects\island-game`，场景 `/assets/island.zscn`。它用 `FFTWaveGenerator`（FoamWidth 1.2，FoamContrast 7.2），近岸浪高 0.2，周期 8。编辑器 MCP 端口为 9876。

## 7. 验证

- 用 MCP 把 debug 输出切到 `foamField`，确认能看到尾迹和回流纹；再切回正常着色，交给用户目测。
- WebGL2 和 WebGPU 各打开一次，确认步进 pass 没有静默失败：查 program_errors，并确认 debug 视图不是一直全黑。
