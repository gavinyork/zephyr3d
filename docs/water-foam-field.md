# 水体泡沫改造：把近岸泡沫场推广为全水面的平流泡沫场

> 状态：方案修订稿，尚未实现（2026-10-17）。分支 `gamedemo`。
> 取代 8f8160fe 的初稿。初稿对现状的描述写于 e900817b / 2b0c0e1e 之前，已过时。

## 1. 现状（以代码为准）

| 来源 | 位置 | 有无记忆 |
|---|---|---|
| FFT / Gerstner 波峰泡沫 | `fft_wavegenerator.ts` `calcFragmentNormalAndFoam`（约 1223 行），`gerstner_wavegenerator.ts` | 无，按当前帧雅可比瞬时计算 |
| 近岸浪泡沫 | `shore_wave_generator.ts` `simulateFoam` / `getSimProgram`（约 312–471 行） | 有，Crest 式持久场 |
| 交互泡沫 | `water_interaction.ts` 步进 shader 的 B 通道 | 有，与交互高度场同纹理 |

近岸泡沫场已经实现以下内容（照搬 Crest `UpdateFoam.compute`）：
- r16f 乒乓纹理，尺寸与水线场网格一致（默认 256 格 × 0.5 m = 128 m）；
- 30 Hz 固定步长追帧，单帧最多 8 步；窗口移动时，用一个 dt=0 的步重投影；首帧 prewarm；
- 半拉格朗日平流，流速取 `foamVelocity = dir · gη/c`，只有向岸方向；
- 按 `foamFadeRate` 线性衰减；
- 两个注入源：一是近岸浪剖面的雅可比 `clamp(waveFoamCoverage − det)`，二是浅水深度 `1 − depth/shorelineFoamMaxDepth`；
- 着色端 `foamPattern` 做 Crest `ComputeFoamWithFlow` 的两层 flow map。材质按 Crest `OceanFoam.hlsl` 做白泡沫黑点切割、浮雕法线和气泡层。

**它解决不了的问题**
1. 开阔海面的波峰泡沫没有记忆。浪峰过去之后泡沫立刻消失，这是目前观感差的主要原因。
2. 流速只有向岸分量：回流带不走泡沫，沙滩上不会留下退浪纹。
3. 水中的礁石、岸角对流动没有影响，绕流和下游尾迹都出不来。
4. 整个场挂在 `ShoreWaveGenerator` 下面，依赖水线场，而水线场是 WebGPU only。WebGL2 下以及没有近岸浪的水体都用不上。

## 2. FluidFlux 3 值得借鉴的地方

依据：RenderDoc 捕获 `fluidflux1.rdc`（UE 5.3.2，D3D11），见初稿。通道含义是推断出来的，不保证准确。

| 观察 | 借鉴结论 |
|---|---|
| 512² 乒乓状态场里，A 通道是泡沫，与流速、水高同场迭代 | 泡沫是随流平流的持久标量场，覆盖整片可见水面，不只是岸边。**采纳** |
| 礁石四周有厚泡沫，下游拖出尾迹 | 障碍物处注入泡沫，流动绕开障碍物把泡沫带向下游。**采纳**，用解析近似实现（见 3.4） |
| 开阔水面有被流动带走的软斑块 | 泡沫漂移，加上平流本身的数值扩散。**采纳**风漂移，不另加显式扩散 |
| 水面 PS 读泡沫 mask，再叠细节噪声 | 与现有的 Crest 着色一致，**已有** |
| 流速来自浅水方程求解 | 我们没有流体解算。**不采纳**，流速改为解析构造，并在本文写明这是近似 |

没有采纳初稿的"年龄通道 G"。捕获里只看到一个泡沫标量，没有老化的证据。按 Crest 的写法，"新泡沫成片、旧泡沫成网丝"本来就是密度衰减经过黑点阈值后的结果。只有调完仍不够时，才另找有出处的老化模型（遵守"不要自创算法"）。

## 3. 方案

### 3.1 抽出 `WaterFoamField`（新文件 `libs/scene/src/render/water_foam.ts`）

把 `ShoreWaveGenerator` 里的 sim 原样迁出，由 `WaterMaterial` 持有：
- 纹理、帧缓冲、固定步长追帧、prewarm、窗口重投影、`sampleFoamSim`、`foamPattern`，全部迁出，算法不变。
- 网格：有水线场时与它的 region 对齐（近岸注入需要逐格读取水线场）；没有水线场时自建网格，跟随相机，单元对齐。窗口中心的取法参照 `scene/water.ts` 的 `updateInteractionFocus`，对准视线与水面的交点，而不是相机脚下。
- 格式仍用 r16f 单通道。流速在着色端解析重算，不写进场里。如果以后接入真正的流速场，再扩成 rgba16f。
- 步进仍是全屏片元 pass，WebGL2 和 WebGPU 都能跑。
- 驱动：在 `WaterMaterial.update` 里每帧步进一次，用帧号去重，方式同 `_interactionUpdateState`。`ShoreWaveGenerator.setFrame` 不再自己步进。

### 3.2 注入源接口

在 `WaveGenerator` 上加一个可选方法 `calcFoamSource?(scope, xz): PBShaderExp`，返回本步的注入率，单位为每秒。计算按 Crest 的写法 `strength · clamp(coverage − det, 0, 1)`。步进里乘 dt 累加，prewarm 规则沿用现有逻辑。

- FFT / Gerstner：复用现有雅可比，`coverage` 取生成器自身的 `foamWidth`。这与 Crest 喂给 foam sim 的来源一致（动画波 LOD 的雅可比）。
- `ShoreWaveGenerator`：base 的注入与近岸剖面雅可比相加，再加浅水深度源，也就是现有两项原样迁过来。
- `InteractiveWaveGenerator`：透传 base。交互自带的泡沫仍留在交互场里，由材质与场按重叠合成。
- 步进 pass 需要绑定 base 生成器的纹理和 uniform（`setupUniforms` + `applyWaterBindGroup`），这比现在的 sim 只调 `setupShoreUniforms` 多绑了一组，采样器预算见 §5。

### 3.3 流速（解析构造）

`v = v_drift + v_shore + v_swash`，再在障碍物处投影：

1. **风漂移**：海面漂浮物相对水的漂移速度约为风速的 3%。出处：Wagner, Dell & Eisenman, "How Winds and Ocean Currents Influence the Drift of Floating Objects", JPO 52(5), 2022。该文给出系数约为 √(ρ_air/ρ_water) ≈ 0.035，实测范围是 2–4%。风向和风速取 FFT 生成器的 `wind`（m/s），没有时为 0。系数设为参数 `foamDrift`，默认 0.03。开阔海面不加波峰速度：场按静止坐标索引，FFT 的水平位移已经让泡沫随轨道运动。
2. **向岸推进**：现有 `foamVelocity`，即 `gη/c` 长波水质点速度。
3. **回流**：内陆的 swash 段已经用 Shen & Meyer / Peregrine & Williams (2001) 的弹道解给出水深 `h(s,t)`。同一组解里有对应的流速 `u(s,t)`，在回流阶段为负（指向海）。实现前从论文里取出 `u` 的表达式，与现有 `depth` 同源，不要自己拟合。
4. **障碍物自由滑移**：在水线距离场的梯度方向上，去掉指向陆地的法向分量（`v -= min(0, v·n) n`，n 指向水面），近似自由滑移边界条件。效果是泡沫贴着礁石和岸角绕流，在迎流面堆积，下游拖出尾迹。只在有水线场时（WebGPU）生效。

### 3.4 障碍物注入

现有的浅水深度源已经覆盖水中礁石的周边，因为礁石在水线场里就是一圈水线。不需要新的注入源，P3 只需要确认它在开阔水面的礁石上也会触发（目前它只在近岸浪启用时运行）。

### 3.5 材质读取

- 场窗口内：`crestDensity` 改为读场，不再同时叠加瞬时 FFT 泡沫，因为两者来自同一个源，叠加会重复计数。
- 场窗口外：退回瞬时 FFT 泡沫。窗口边缘按距离把两者混合，避免出现接缝。
- **单级网格，保留多级扩展**（已定）。第一期只做一级，以下接口按多级来设计，以后加级时无需改调用方：
  - `WaterFoamField` 内部持有 `levels: FoamFieldLevel[]`，第一期长度为 1。每级各有自己的纹理、region 和步进。
  - 着色端只通过 `sampleFoamField(scope, xz)` 读取，返回 `(density, coverage)`。`coverage` 是该点被场覆盖的权重（0 表示窗口外），材质用它混回瞬时值。多级时由这个函数内部从细到粗选级、在级间混合，调用方不用改。
  - uniform 用数组 `foamFieldRegions[MAX_LEVELS]` 加级数，第一期 `MAX_LEVELS = 1`。
  - 多级时每级的平流与注入都相同，粗级单元更大；做法参照 Crest 的 LOD 级联（每级边长翻倍）。
- flow map：`foamPattern` 的 flow 改为 §3.3 的总流速，开阔海面同样会随风漂移。
- 外观：保持 Crest 的黑点阈值和羽化不变。P4 只调参数，不改结构。
- 新增 debug 输出 `foamField`，以灰度显示场值，窗口外压暗。加入 `WaterDebugOutput` 和标签列表。

### 3.6 参数

- 迁移的参数：`foamFadeRate`、`waveFoamStrength`、`waveFoamCoverage`、`shorelineFoamStrength`、`shorelineFoamMaxDepth`。它们从 shore settings 移到泡沫场，语义不变。
- 新增的参数：`baseFoamStrength`（开阔海面雅可比注入），`foamDrift`（风漂移系数），`foamFieldSize`（窗口边长，米）。
- 按水体泡沫的约定，不考虑兼容，废弃字段直接删除。需要同步修改 Water 节点、`utility/serialization/scene/water.ts` 和 `utility/editor/src/helpers/mcpwater.ts`。

## 4. 分阶段（每阶段结束都停下来，由用户目测）

1. **P1 迁移**：抽出 `WaterFoamField`，近岸行为与现在一致。这一阶段只做重构，目测确认无回归。
2. **P2 开阔海面**：base 雅可比注入、风漂移、无水线场时的自建网格、窗口边缘混回瞬时值、debug 视图。预期效果：白浪拖出逐渐散去的尾巴，并随风漂移；WebGL2 也能看到。
3. **P3 岸边流动**：回流流速和障碍物自由滑移。预期效果：泡沫被浪推上沙滩、再被回流带下来，留下退浪纹；礁石四周泡沫堆积，下游有尾迹。
4. **P4 外观与时域**：调整黑点、羽化与密度的关系；视 TAA 拖影情况，决定是否在泡沫像素上降低历史权重。

## 5. 风险

- **窗口覆盖**：第一期为单级窗口，看向远处时远海会回到瞬时泡沫，窗口边缘的混合必须做得足够软。多级扩展的接口见 §3.5。
- **分辨率**：0.5 m 的单元对 FFT 的细小折叠偏粗，细节靠泡沫纹理补。如果白浪边缘发糊，再考虑把窗口内的瞬时值作为细节，以 `max` 的方式叠回去。
- **TAA**：泡沫纹理随流速相对网格移动，而运动矢量只覆盖几何，水的 `TAAStrength` 是 0.9，可能出现拖影。
- **采样器**：步进 pass 要绑定 base FFT 的纹理、水线场、逆查表和场自身。WebGL2 下没有水线场，仍在 16 张以内；WebGPU 下需要清点一遍。
- **WebGL2 std140**：只含一个 float 的 uniform 结构体要补齐到 16 字节，否则 draw 会静默失效。

## 6. 项目约束（接手必读）

- 改 `libs` 会触发 vite 整页刷新。改代码前先查 `scene_changed`，请用户先保存场景。
- `rush build` 可能谎报 up-to-date，要进 `utility/editor` 单独 build。
- 着色器变量名避开 WGSL 保留字（`set`、`pass`、`filter`、`sample` 等）。
- `pb.select(a, b, cond)` 的参数顺序是条件为假时取的值在前。`pb.equal` 是整向量比较，逐分量比较用 `compEqual`。`$return` 不会阻止 JS 侧代码继续执行。
- WebGPU 下不可过滤的纹理必须配 nearest 采样器。
- 每阶段做完就停下来让用户目测，不要主动加单测或截图比对，也不要自行做 headless 验证。
- 提交信息只写一行英文，不写正文，不加签名，不提 plans。
- 测试场景：`F:\zephyrprojects\island-game` 的 `/assets/island.zscn`，用的是 `FFTWaveGenerator`（FoamWidth 1.2，FoamContrast 7.2），近岸浪高 0.2，周期 8。编辑器 MCP 端口为 9876。
