# 岸边涌浪改进

目标：白沫随浪冲上沙滩，部分随回流撤退，部分在薄水区沿途滞留成贴地泡沫带；前缘连续，不被固定边界或地形遮断。

按阶段实施并验证。可在已有编辑器中检查 WebGPU 编译、运行日志和画面；需要判断动态观感时请用户目测。修改引擎前检查场景是否已保存，不启动新的服务器。

| 阶段 | 内容 | 验证重点 | 状态 |
| --- | --- | --- | --- |
| P1 | 按上冲前缘计算干湿覆盖率，保留塌落浪峰覆盖；已知薄水层上的白沫独立于水体厚度淡出 | 上冲前缘平滑收尾；白沫在毫米级水层仍可见；退浪后无持续白色边带 | 已通过类型、lint 和编辑器 WebGPU 渲染检查 |
| P2 | 保守且稳定的贴地网格支持范围；修正地面高度近似 | 较高沙滩和相邻浪段交替时不出现几何切线；陡岸不被抬起 | 已通过类型、格式、局部平面数值和编辑器 WebGPU 渲染检查 |
| P3 | 将已有的上冲、回流有符号速度接入泡沫密度运输 | 白沫上冲后回撤；不向岸单向堆积；细节纹理不撕裂 | 已通过类型、lint、双后端着色器生成和编辑器 WebGPU 渲染检查；动态观感待用户目测 |
| P4 | 薄水层沿途沉积部分泡沫，独立保存、贴沙面绘制并消散 | 退水留下铺开的泡沫带；残留纹理不随水滑动；干区不出现水体反射及抬高深度 | 已通过类型、lint、格式、回归测试、引擎/编辑器构建及 WebGPU 实景检查；动态观感待用户目测 |

P4 加入地表泡沫持久场及绘制。湿沙和局部浅水方程属于进一步的模拟升级。

## P1

- 保持当前浪高、周期、爬高范围及场景参数。
- `ShoreWaveGenerator.evaluate` 输出覆盖率：海侧保留水面高度与地面的交界；陆侧取塌落浪峰覆盖与活动上冲水层覆盖的并集。
- 上冲水层用 `smoothstep(0, 0.08m, front - s)` 在真实前缘内淡出，避免深度趋零时覆盖率仍为 0.5、前缘外突然归零。
- 水体透明度继续使用厚度。对地面厚度已知且实际有水的区域，泡沫只按干湿覆盖率淡出；厚度未知处沿用原深度淡出。
- `npm run build:check`（`libs/scene`）、修改文件 ESLint 通过；现有编辑器中重新打开已保存的 island 场景，WebGPU 无着色器错误。薄水层上的白沫已可见，也暴露出第二阶段要处理的网格折线。

## P2

- 网格按配置浪高建立固定保守支撑范围，保持原有地面高度、离岸距离和坡度限制。当前湿区仍由 P1 覆盖率控制。
- 水线场在局部模型有效时将负 SDF 距离改为垂直高度近似 `-A/B`，无效模型保持原回退。
- 有效条件为 `abs(SDF)<4m`、`abs(A)<1000`、`0.001<B<10000`。已检查平面多种坡度、正负地面高度、无效及饱和参数的回退。
- 现有编辑器已加载该阶段，WebGPU 运行日志无着色器错误。复杂曲面仍采用局部平面近似。

## P3

- 只在岸线场内、陆侧当前湿润的爬滩水层中接入 `dir.xy * sw.w`，沿真实前缘和水线内部短距离平滑衔接。
- `sw.w` 保留弹道解给出的正负方向，密度既能上冲也能回流。海侧继续使用风漂移，避免原先只有正向速度的涌浪长期向岸堆积泡沫。
- 细节纹理保持原有平滑风漂移及陡岸滑移；密度运输与纹理 UV 独立。

## P4

- 在原 RGBA16F 移动泡沫及墙面历史之外增加 R16F 四级纹理数组双缓冲，约增加 1 MiB；同一 MRT 步进更新两类泡沫。未启用岸浪的水体不分配沉积场。
- 当前有水、覆盖有效且坡度适合的陆侧海滩才沉积。水厚从 3 cm 降至零时，沉积率平滑增至 4/s；每步转移比例为 `1-exp(-contact*dt)`，从移动泡沫扣除并加入地面泡沫，墙面泡沫不参与。
- 地面泡沫按固定世界 XZ 读取历史，窗口移动时从上一级相同位置回填；不会跟着上冲、退流或风平移。`dt=0` 不转移、不衰减；首次预热不预填干沙。
- 沉积泡沫以移动泡沫一半的速率指数衰减，默认衰减率 0.8 时约 1.73 秒减半。密度降低使静止泡沫纹理逐步破碎，沿途留下铺开的残留，而非都运到最远端。
- 颜色通道按不透明场景深度重建沙面位置，用其 XZ 采沉积场和静止细节，用地面法线照明。岸线场校验海滩范围及床面高度，避免把残留投到明显高出沙面的物体上。
- 水体光学仍受湿区覆盖率控制；1–6 cm 水层逐渐切换到沙面泡沫绘制。沙面层使用地形深度加约 1 mm 偏移；深度和运动向量通道丢弃干区支撑网格，保留地形结果。
- 关闭岸浪或更换泡沫源时清除沉积历史，保留原移动泡沫及墙面历史，避免重新开启时旧白痕复活。

### 交界裂缝修正尝试（仍待定位）

- 原先移动泡沫在抬高的水网格 XZ 绘制、沉积泡沫在真实沙面 XZ 绘制，存在视差。薄水区现在统一在重建沙面位置采移动泡沫、沉积泡沫、湿覆盖及水厚，使用同一静止地面纹理。
- 先合并 `mobile * wetCoverage + deposited` 再进行一次泡沫纹理裁切，避免两份密度各自低于阈值、转移时同时消失。
- 颜色在完整水面结果和完整沙面泡沫结果之间只混合一次；去掉先减弱移动泡沫、再覆盖沙面泡沫的重复淡化。两端完全白时，半过渡仍为完全白，不额外透出沙色。
- 颜色通道的片元深度与薄水区的地面过渡使用相同权重，避免仍按抬高载体深度遮挡已经投影到沙面的泡沫。
- 临时 RGB 调试在检查区域观察到沙面掩码、过渡权重和密度有绘制覆盖，但尚未与用户接缝像素精确对齐。用户随后反馈仍有接缝，因此这些修改及公式测试不能证明接缝已解决。

### 交接裂缝根因（已定位）

- 冻结帧（`AnimationSpeed=0`）上对照 `swashFoamCuts`、`swashHandover`、`swashFoamSources` 发现：接缝处载体与地面湿覆盖率均为 1，泡沫总量也连续；断开出现在交接权重升起之前的几个像素里。
- 载体泡沫只读移动泡沫密度，地面层读 `移动×湿覆盖 + 沉积`，而地面层只有在载体水厚低于 1–6 cm 时才显示。越靠近交接点，移动泡沫被沉积转走得越多，转走的这一份在两层里都不显示。剩下的是偏淡、带孔的载体泡沫，盖在近乎透明的薄水上，孔里透出沙色。
- 修正：载体泡沫密度改为 `clamp(移动 + 沉积)`，在载体 XZ 采样沉积场（`water_foam.ts` 的 `calcFragmentNormalAndFoam`）。交接两侧显示同一个总量。副作用：被下一波重新盖住的沉积泡沫会以水面泡沫的样子显示。

### 退浪后岸内残留泡沫带

- 退浪冻结帧上：上缘白带的沉积密度接近饱和，中间带的移动泡沫本来就少、几乎没有沉积。前缘水层薄、停留时间长，沉积集中在最高爬升处；而沉积泡沫按移动泡沫一半的速率衰减，排干后还会停留约 1.7 秒半衰期，于是留下一条孤立的白线。
- 修正：泡沫源的 `contact` 输出改为 vec2，y 分量为地面干燥度（水层排干或前缘覆盖率渐隐处为 1）。沉积泡沫的衰减倍率从 0.5（湿）过渡到 2（干），默认衰减率 0.8 下，干沙上的半衰期约 0.4 秒。

### 退浪沉积连续化

- 用户目测：泡沫只在最高爬升处成带，与退去的水面之间断开。原因是沉积率乘了覆盖率，而覆盖率在水层将干时先降到 0；排干时格子里剩下的移动泡沫只是被 `groundWet` 遮掉，没有落到沙上。
- 修正：薄水沉积率不再乘覆盖率，水厚低于 5 cm 时随水层变薄升至 8/s；水层前缘的渐隐区，以及爬升范围内已排干的格子，以 30/s 把剩余移动泡沫转到地面（"搁浅"）。干沙上沉积的衰减倍率改为 1（默认约 0.9 秒半衰期），让退浪全程铺开的一层泡沫有时间显示。

### 沉积改为印记模型

- 用户反馈仍断开。冻结帧数据：白带处水中泡沫与沉积都饱和；其下方的退流水体仍厚于 6 cm，水中泡沫只有中等密度，裁切后为 0，透出沙色。
- 根因是守恒转移：薄水格子被水流持续流过，沉积一层层累积到饱和，远比水中泡沫浓；流过去的水又被抽走泡沫，到下游时已偏淡。
- 修正：沉积改为印记。薄水或排干时，地面泡沫按接触速率趋近当地水中泡沫密度，不超过它，也不再从水中扣除。地面层与载体都按 `max(水中, 地面)` 显示，不再求和。
- 仍断开。冻结帧数据：中段沉积为 0，水中密度自上而下从 ≈1 递减到 ≈0.3，被纹理裁切出硬边。原因是上冲的薄前缘带着最浓的泡沫，但每个格子只被它扫过约 0.05 秒，按 8/s 只印下约 30%，随后在水下衰减殆尽。印记不扣减水中泡沫，因此印记速率提高到 30/s（一次扫过约印下 80%），水下沉积的衰减倍率降为 0.25。
- 仍断开。冻结帧数据：白带海侧仍是厚于 6 cm 的水（交接权重 0），说明断开与 5 cm 沉积阈值无关；断开区地面沉积为 0，移动泡沫从白带向海递减形成凹谷。根因是 P3 接入的冲刷平流：上冲把泡沫推到最高处（排干后被搁浅保留），回流把中段抽空。
- 修正：撤销 P3 的冲刷平流，爬滩区只保留风漂移。泡沫留在浪生成的位置，水层变薄时印到沙面。代价是泡沫密度不再随浪上冲、回撤；纹理流动不受影响。
- 仍断开。用户要求不追求物理正确，只要岸边泡沫与海面泡沫相连。加入显示层的泡沫下限 `calcSwashFoamFloor`：在岸浪网格内、水厚已知处，泡沫密度至少为 `0.85 × (1 − smoothstep(0, 岸浪高, 水厚))`。载体按自身水厚、地面层按交接水厚各取一次，与泡沫场密度取最大值。不改变泡沫场模拟。
- 用户确认岸边泡沫已连续，断开在碎浪泡沫与岸边泡沫之间。再加入碎波带泡沫下限 `calcSurfFoamFloor`：按与静水线的距离，在岸浪区宽度的 10% 内为 0.6，到 25% 时淡出为 0，只在海滩坡度、网格内生效。0.6 低于纹理全裁切，呈花边状。载体与地面层都取这个下限。
- 用户反馈两部分仍可分辨：交界处密度不一致，两边泡沫运动也不连续。改为按静水深统一处理（`nearShore`），取代上面两个下限：
  - 静水深 `h = max(−海底高, 0)`，岸上为 0。用静水深而非瞬时水深，跨岸线连续，也不随浪峰脉动。
  - 近岸阈值 `Hn = 岸浪高 / 0.78`（碎波判据），在 `Hn`～`1.5Hn` 之间过渡到开阔水域；只在海滩坡度、网格内生效。
  - 近岸密度下限 `T(h)` 从阈值处的 0.6 平滑升到岸线处的 0.85。显示密度为 `mix(泡沫场, max(泡沫场, T), w)`，载体与地面层共用。
  - 泡沫场步进速度和纹理流动速度都乘 `(1 − w)`，近岸静止。地面层改用同一个 `flowPattern` 取样，与水面同一张图案；载体在整个泡沫场范围内都使用流动图案。

### 几何区域调试

- 新增 `Debug Output → Shore regions (geometry)`（`water.debugOutput = 'shoreRegions'`）。蓝色：基础水面；青色：海侧 ShoreWave 影响区；橙色：岸内湿润涌浪区；紫色：岸内干燥承载区。影响区按岸线场、坡度、网格边缘及外海振幅包络计算，颜色渐变显示影响权重，不使用只有约 3 米范围的 chop 衰减代替整个 ShoreWave 区域。
- 主体水面和 ShoreWave 共用同一个位移网格。调试模式在所有通道中保留真实顶点位移及地形深度遮挡，绕过干湿裁剪、地面深度投影和泡沫着色，避免将着色边界误判为几何边界。可配合现有 `wireframe` 观察三角形。
- 双后端、颜色/深度、ShoreWave 开/关的 8 个组合验证调试路径可生成，且不残留泡沫采样、地面重建和干湿裁剪；standard-Z 与 reverse-Z 下的水面 shader 测试均通过。

## P1–P3 验证记录

- `libs/scene`：`npm run build:check`、修改文件 ESLint、Prettier 检查、`npm run build` 通过。
- `test`：`npm test -- --runInBand --runTestsByPath src/scene/water_swash_shader.test.ts`，6 项通过。覆盖 WebGL2 / WebGPU 的当前及上一帧顶点位移、覆盖率输出、薄水层厚度、法线、泡沫纹理输入输出和泡沫场持久状态参数传递。此测试验证着色器生成，不等同于两个后端均已在 GPU 上运行。
- 现有编辑器：WebGPU island 场景可正常显示爬滩白沫，运行日志无着色器错误。引擎更新引起刷新后重新打开已保存场景，未保存或改写场景参数。
- `utility/editor`：`npm run build` 通过，产物为 `utility/editor/dist/index.html`。
- 用户目测建议：观察至少 3 个浪周期，查看前缘是否仍出现固定切线、白沫是否上冲并回撤，以及浪段交替时是否突跳。

## P4 验证记录

- `libs/scene`：`npm run build:check`、修改文件 ESLint、Prettier、`npm run build` 均通过。
- `utility/editor`：`npm run build` 通过，产物为 `utility/editor/dist/index.html`。未启动服务器。
- `water_swash_shader.test.ts` 和 `water_foam_deposition.test.ts` 合计 27 项通过，涵盖双后端 shader 生成、contact 可选输出、实际材质颜色/深度通道、地面法线直射/环境光和阴影、沉积交换守恒/容量、零时长、静止历史及资源切换。裂缝回归直接执行真实 GLSL 生成的合密度/泡沫裁切/颜色混合表达式，验证分份转移及中间过渡不漏白沫。standard-Z 和 reverse-Z 均通过。
- 编辑器重新连接后打开已保存的 island 场景，WebGPU 正常渲染、控制台没有着色器或管线错误；间隔截图可见沙面上残留的破碎泡沫及变化中的上冲前缘，未保存或改写场景参数。
- 用户目测时观察至少 3 个周期：残留应沿整段薄水区分布，退水后固定在沙面并破碎消散；低视角不应漂浮或跟随水面滑动。截图和运行日志不能取代对动态观感的判断。

## 当前限制

- 地面高度仍为有效区内的局部平面近似，复杂曲面不等同于直接采样真实地形高度。
- 回流在静水线附近衔接回风漂移，可能留较集中的回洗泡沫线；极缓坡和短周期下，较快平流可能使泡沫变糊。
- P4 是泡沫局部沉积的视觉近似，尚未模拟泡沫排液、沙面渗透、再次淹没时的再悬浮或湿沙颜色。
- 沙面判定使用岸线场的局部床面近似，复杂曲面、极低矮物体及支撑网格边缘需要目测；本轮 GPU 实景验证使用 WebGPU，WebGL2 仅验证 shader 生成。

### Wet swash diagnostics

The user located the break visually in the orange wet inland swash region. Three additional RGB modes keep the normal coverage/discard and projected-ground depth handling:

| Debug Output | R | G | B |
| --- | --- | --- | --- |
| Swash handover (RGB) | Carrier wet coverage | Reconstructed ground wet coverage | Ground replacement weight |
| Swash foam sources (RGB) | Surface mobile density | Wet ground mobile density | Deposited density |
| Swash foam cuts (RGB) | Surface foam opacity after texture cut | Ground foam opacity after texture cut | Ground replacement weight |

The user's sand-colored line was reproduced in `swashFoamCuts` at the saved close camera view. In the same frozen phase, raw `shoreRegions` geometry was continuous and `swashVisibility` changed that line to red, without a green depth-failure band. This identifies wet-edge discard as the immediate cause of the reproduced line; it is not evidence of a hole between two meshes.

Two further diagnostics bypass wet clipping and use biased ground depth on valid beach pixels:

| Debug Output | R | G | B |
| --- | --- | --- | --- |
| Swash visibility (RGB) | Production wet-edge discard | Production selected depth behind opaque scene | Projected ground foam density |
| Swash ground support (RGB) | Beach-bed mask | Foam-field coverage | Ground wet coverage |

Ground density and field coverage are sampled only where the beach-bed mask is positive. Zero in those channels can mean that the mask rejected the point, rather than that the underlying foam field is empty. Large red dry-carrier regions in visibility mode are expected.

### Carrier / ground handover correction

The carrier wet test uses P = clipmapPos.xz, whereas projected foam samples Q = reconstructed opaque ground XZ. The raised carrier and shallow view angle separate these positions. With a 6 cm lift and an approximately 11.5 degree view angle, the flat-ground estimate is a 29 cm offset, larger than the 8 cm wet-edge feather.

Previously the handover weight used thickness at Q while the discard used wetness at P. It now uses known thickness at P, falling back to Q only when P has no bed estimate. Foam density and texture coordinates remain at Q so attached foam stays fixed to the sand.

The beach-bed mask also previously became exactly zero on the sea side of the static waterline. That gate has been removed: thin mobile foam can project onto valid shallow beach bed on either side of the line. Bed-height agreement, shelving, field-edge and inland-reach restrictions remain; actual deposition still requires wet inland cells. Thick water retains surface shading through the thickness weight.

When both thickness estimates are unknown, the handover weight is zero. This retains ordinary water over shallow sand outside the shore-wave zone, even when there is no foam.

The editor reconnected and the saved close camera view was restored. In several frozen swash phases, including a retreat phase, `swashFoamCuts` no longer showed the thin sand-colored line between the black water and blue projected band. `swashVisibility` likewise showed no corresponding red discard line at that internal boundary. Normal shading rendered the water and attached foam, and the WebGPU console contained no shader or pipeline errors. These screenshots validate the reproduced line at this camera; other coastline angles and the full dynamic appearance still need user inspection.

The two targeted test files pass 57 cases with standard-Z and 57 with reverse-Z, covering WebGL2/WebGPU shader generation, generated GLSL handover expressions, cross-waterline bed support, conservative unknown-thickness handling, and the existing deposition checks. Type checking, lint, formatting and the scene build pass. WebGL2 was tested through shader generation rather than a live GPU capture. The wave speed was restored to 1.76 and normal shading selected for visual review; no scene or material assets were saved.
