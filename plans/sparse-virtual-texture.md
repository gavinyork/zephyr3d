# 稀疏虚拟纹理（SVT）基础设施 —— 详细设计（阶段 0、1）

## 目标与原则

- 一套**可复用**的稀疏虚拟纹理核心。第一个使用方是地形 RVT，之后 Virtual Shadow Map（VSM）复用同一套逻辑。
- **驻留管理完全 GPU 驱动、同帧生效**：标记 → 分配 → 填充全部是 compute，不做 CPU 读回。
  - VSM 不能容忍反馈延迟（缺页就是错误阴影，不只是模糊）；RVT 也因此没有"先糊后清"。
  - memory 实测 WebGPU 读回延迟 +2～+6 帧，读回路线不可行。
- **WebGPU only**。WebGL 继续走各使用方现有的非虚拟路径。
- 核心只管"页"：虚拟空间、页表、物理池、驻留、失效、采样寻址。**内容由使用方负责**（标记哪些页、页里填什么）。

## 术语

| 术语 | 含义 |
|---|---|
| 级（level） | 一张独立的页网格。RVT 的级是 mip 链（逐级减半）；VSM 的级是 clipmap 层（各级页数相同） |
| 虚拟页（virtual page） | 某一级上的一个页，用全局线性 id 标识 |
| 物理页（physical page / slot） | 物理图集里的一个格子，大小 = 内容 `P` + 两侧边框 `B` |
| 平面（plane） | 物理池里的一张存储（如 RVT 的 albedo、normal；VSM 的深度）。同一物理页在所有平面上位置相同 |
| 帧戳（stamp） | 每次 `update()` 递增的 u32，从 1 开始，0 表示"从未" |
| 常驻级（pinned levels） | 最粗的若干级，初始化时全部分配且永不淘汰，保证采样总能回退到有效数据 |

---

## 阶段 0：compute 的 indirect dispatch

### API

```ts
// device/src/base_types.ts
interface MiscCaps { supportDispatchIndirect: boolean; }          // WebGPU 为 true，WebGL 为 false
interface AbstractDevice {
  /**
   * 以 GPU buffer 中的参数发起 compute。buffer 需以 'indirect' 用途创建，
   * 在 indirectOffset 处存放 3 个 uint32：workgroupCountX/Y/Z。
   */
  computeIndirect(indirectBuffer: GPUDataBuffer, indirectOffset?: number): void;
}
```

### 实现

- `device.ts`：`computeIndirect` 调 `_computeIndirect`，并计入 `frameInfo.computeCalls`。
- WebGPU：`commandQueue.computeIndirect(...)` → `computePass.computeIndirect(...)` → `dispatchWorkgroupsIndirect(buffer, offset)`。
  - 与 `compute()` 共用校验、mipmap 延迟刷新、bind group 设置逻辑（抽出公共函数）。
  - 参数校验与 `drawIndirectInternal` 一致：用途含 `BF_INDIRECT`、offset 为 4 的倍数、`offset + 12 ≤ byteLength`，失败时 `console.error` 并跳过。
- WebGL：`_computeIndirect` 抛 `PBDeviceNotSupport` 风格的错误（WebGL 本来就没有 compute）。

### 验证示例 `examples/src/indirectdispatch`

- compute A（1 个线程）：按时间把参数 `(n, 1, 1)` 写入 indirect buffer，`n` 每秒在 1..16 间循环。
- compute B（`computeIndirect`）：第 i 个 workgroup 把第 i 个格子标为"点亮"，写入 storage buffer。
- 绘制 4×4 格子，被点亮的显示为亮色。
- **预期**：亮格数每秒 +1，从左上角逐行填满后重来；屏幕文字显示应有的数量。

---

## 阶段 1：通用虚拟纹理核心

代码位置：`libs/scene/src/render/virtualtexture/`

### 1. 虚拟空间

```ts
interface VirtualTextureLevel { pagesX: number; pagesY: number; }

/** 便捷构造：RVT 用的 mip 链，直到 1×1 页为止 */
function virtualMipChain(virtualWidth: number, virtualHeight: number, pageSize: number): VirtualTextureLevel[];
/** 便捷构造：VSM 用的 clipmap，各级页数相同 */
function virtualClipmap(levels: number, pagesPerAxis: number): VirtualTextureLevel[];
```

- 级数上限 16。
- **全局页 id** = `levelOffset[l] + y * pagesX[l] + x`，`levelOffset` 为前缀和。
- 级描述表以 uniform 上传：`vec4u levelInfo[16] = (offset, pagesX, pagesY, 0)`。
- 容量参考：RVT 32768² 虚拟尺寸、P=128 → 第 0 级 256×256 页，全链约 8.7 万页；VSM 16 级 × 128² ≈ 26 万页。都只是 u32 数组，完全可以接受。

### 2. 物理池

```ts
interface VirtualTexturePlane {
  name: string;
  /** 'texture'：采样用纹理，compute 以 storage 写入或作为渲染目标写入
   *  'buffer'：storage buffer，给需要原子写的使用方（VSM 深度用 atomicMin，WebGPU 没有纹理原子） */
  kind: 'texture' | 'buffer';
  format?: TextureFormat;          // kind === 'texture'
  bytesPerTexel?: number;          // kind === 'buffer'
  writeMode?: 'storage' | 'render' // 填充方式：compute 写 / 光栅化写
}
```

- 物理页边长 `S = P + 2B`。图集每行 `slotsPerRow = floor(atlasSize / S)`，总页数 `N = slotsPerRow²`。
- 物理页 `i` 在图集中的原点 = `(i % slotsPerRow, floor(i / slotsPerRow)) * S`。
- 图集**没有 mip**：mip 是虚拟的，由各级分别提供；三线性过滤通过采样相邻两级再插值实现。
- 默认值：`P = 128`，`B = 4`（满足双线性过滤，也为少量各向异性留余量），`atlasSize = 4096` → 31×31 = 961 页。
  - RVT 两张 rgba8 平面约 128 MB。

### 3. GPU 数据结构（全部是 storage buffer）

> 本节与第 4、6 节按 UE 5.8 源码修订，出处见文末"参考来源"。

| 名称 | 大小 | 内容 |
|---|---|---|
| `pageTable` | u32 × 虚拟页总数 | **每次 update 清零后重建**。编码照搬 UE VSM：bit0..15 物理页号、bit20..25 `LODOffset`（0 = 本级驻留，n = 映射到往上第 n 个更粗级）、bit30 本级有效（本帧已填好，可采样）、bit31 任一级有效 |
| `pageRequest` | u32 × 虚拟页总数 | 本帧请求计数。**每次 update 结束时清零**。标记时 `atomicAdd(1)`，RVT 用计数做优先级 |
| `physicalMeta` | 4 × u32 × N | `owner`（虚拟页 id）、`level`、`lastRequested`（帧戳）、`flags`（bit0 已分配，bit1 脏，bit2 常驻） |
| `physicalLists` | 4 × (N + 1) × i32 | UE VSM 的四个物理页列表：LRU、AVAILABLE、EMPTY、REQUESTED，每个列表末尾一个计数 |
| `loadList` | 2 × u32 × `requestCapacity` | 未驻留的请求 `(虚拟页 id, 优先级)` |
| `fillList` | 2 × u32 × `allocBudget` | 本帧要填充的 `(虚拟页 id, 物理页号)` |
| `counters` | u32 × 64 | 列表计数、优先级直方图、统计值 |
| `dispatchArgs` | u32 × 3 × 2 | 分配 pass 与填充 pass 的 indirect dispatch 参数 |

`physicalLists` 初始化时 REQUESTED 列表 = `[0, 1, …, N−1]`（作为第一帧的 LRU 输入），其余为空。

### 4. 每帧流水线

```
使用方标记（片元着色器或 compute）
  │  vtRequest(level, uv)：atomicAdd(pageRequest[id], 1)
  │  RVT 另外按 UE 的预取规则连带请求一个祖先页（见下）
  ▼
update(stamp)
  ① ClearPageTable     每个虚拟页 1 线程：pageTable = 0；清零 counters
  ② UpdatePhysicalPages  UE: UpdatePhysicalPages。每个物理页 1 线程，按上一帧 REQUESTED 列表的顺序读取物理页：
                        已分配且（本帧被请求 或 帧龄 ≤ maxPageAge 或 常驻）→ 保留映射，写回 pageTable（LODOffset = 0）
                          本帧被请求 → 移入 REQUESTED 列表，lastRequested = stamp；若脏 → 追加 fillList（原地重填）
                          否则 → 留在 LRU 列表的原位置（缓存着但可被复用）
                        否则（未分配或超龄）→ 移入 EMPTY 列表，flags = 0
                        LRU 列表在原位置写入 物理页号 或 INDEX_NONE（保持顺序）
  ③ PackAvailablePages  UE: PackAvailablePages。单个 workgroup，前缀和压缩 LRU 列表 → AVAILABLE（保持顺序）
  ④ AppendEmpty         UE: AppendPhysicalPageLists(EMPTY→AVAILABLE)。EMPTY 追加到 AVAILABLE 末尾
                        （分配从末尾弹出，所以空页最先被用，其次是最久未请求的缓存页）
  ⑤ GatherLoads         每个虚拟页 1 线程：请求计数 > 0 且 pageTable 本级无效 → 追加 loadList(id, 优先级)
                        优先级照搬 UE RVT：count × (1 + level)；常驻级的请求最高优先
                        同时累加优先级的 log2 直方图（见"预算选择"）
  ⑥ SelectBudget        1 线程：由直方图求出能容纳 allocBudget 的最低优先级门槛，写分配 pass 的 dispatch 参数
  ⑦ AllocateNewPages    UE: AllocateNewPageMappings。每个 loadList 项 1 线程（indirect）：
                        优先级 ≥ 门槛 且 fillList 未满 → 从 AVAILABLE 末尾弹出物理页
                          该物理页原有主人 → 清掉旧主人的 pageTable 项（淘汰）
                          写新映射；追加 REQUESTED 列表；追加 fillList
                        写填充 pass 的 dispatch 参数 = (|fillList|, 1, 1)
  ⑧ AppendAvailable     UE: AppendPhysicalPageLists(AVAILABLE→REQUESTED)。剩余 AVAILABLE 追加到 REQUESTED 末尾，
                        REQUESTED 即为下一帧 LRU 的输入顺序（列表顺序本身就是 LRU，无需排序）
  ⑨ Fill                使用方：computeIndirect，每个 workgroup 填一页；填完的页在 pageTable 中置"本级有效"
  ⑩ PropagateMappedMips UE: PropagateMappedMips（局部光源分支）。每个第 0 级页 1 线程，从最粗级往下走，
                        未驻留的页写入"最近的已驻留祖先"的物理页号和 LODOffset
  ⑪ ClearRequests       pageRequest 清零（只清 ⑤ 中计数 > 0 的项也可以，先整体清零，实测再优化）
```

**要点**
- **物理页管理完全照搬 UE VSM 的四列表 LRU**：列表顺序即 LRU 顺序，只靠压缩和追加维持，不做排序，也不需要年龄分桶。本帧被请求的页都在 REQUESTED 列表里，不可能被本帧的分配复用。
- **页表每帧重建**（UE VSM 同样每帧清空后由 ② 和 ⑦ 重写），所以淘汰、失效、回退传播都不需要增量维护。代价是每帧清零虚拟页数个 u32（RVT 约 8.7 万个），可以忽略。
- **预算与优先级（仅 RVT 这类填充昂贵的使用方需要）**：
  - UE RVT 在 CPU 上按 `count × (1 + level)` 排序并截断到 `r.VT.MaxUploadsPerFrame`（默认 2）。
  - 我们在 GPU 上做等价的 top-K：优先级的 log2 直方图 → 求门槛 → 门槛以上的请求参与分配；门槛所在的那个桶按原子顺序截断。**与 UE 的差异**：同一个 log2 桶内的顺序不是严格排序，而是原子竞争顺序。这是为了避免 GPU 全量排序的折中，会在文档和代码注释中注明。
  - VSM 设 `allocBudget = Infinity`，跳过 ⑥ 的门槛，与 UE VSM 一致（全部分配，池按需求配置）。
- **预取（UE RVT 规则，`VirtualTextureSystem.cpp`）**：请求的页未驻留时，额外请求比"当前实际驻留级"细最多 2 级的祖先页，即级号 `max(请求级, 驻留级 − 2)`。配合 `(1 + level)` 的优先级，画面每次最多细化 2 级，渐进变清晰。核心提供这个规则，使用方在标记时调用。
- **溢出**：`loadList` 超过容量时丢弃，下一帧会重新请求，只影响收敛速度。
- **时序**：
  - 深度驱动的标记（RVT、VSM 的正式用法）：同一帧内标记 → update → 填充 → 着色，零延迟。
  - 片元着色器驱动的标记（阶段 1 的验证示例）：第 N 帧着色时标记，第 N+1 帧 update，有 1 帧延迟，流程相同。
- **多相机**：共用同一个池和页表，同一帧内的相机共用一个帧戳，各自的请求在同一次 update 前累加。

### 5. 失效

```ts
invalidate(): void;                                      // 全部失效
invalidateRegion(u0: number, v0: number, u1: number, v1: number): void;  // 按归一化虚拟坐标，覆盖所有级
```

- 语义对应 UE VSM 的 `VSM_FLAG_*_UNCACHED`：被失效的物理页**保持映射**，只打上脏标记；下次被请求时在 ② 中原地重填，在此之前继续显示旧内容，不会出现空洞。
- CPU 端把矩形放进队列，下一次 update 开头用一个 compute 按物理页检查 `(owner, level)` 是否落在矩形内并置脏。
- 脏页的重填占用 fillList 名额，但优先于新分配（UE VSM 中已缓存页的重新渲染同样不受分配预算影响）。
- RVT：splat 或细节贴图修改时按修改区域调用。VSM：投影体移动时按其光源空间包围盒调用。

### 6. 采样寻址（着色器辅助函数）

```ts
class VirtualTexture {
  /** 声明页表、级描述表、图集信息等绑定，group 由调用方指定 */
  declareBindings(scope: PBGlobalScope, group: number): void;
  applyBindings(bindGroup: BindGroup): void;
  /** 标记：给定级和虚拟 uv，写请求；prefetch 为 true 时按 UE 规则连带请求祖先页 */
  request(scope: PBInsideFunctionScope, level: PBShaderExp, uv: PBShaderExp, prefetch?: boolean): void;
  /** 由虚拟 uv 的屏幕导数计算级（仅片元着色器） */
  computeLevel(scope: PBInsideFunctionScope, uv: PBShaderExp): PBShaderExp;
  /** 寻址：返回 (图集 uv, 实际命中的级)。一次页表查找，回退已由 PropagateMappedMips 写入页表 */
  resolve(scope: PBInsideFunctionScope, level: PBShaderExp, uv: PBShaderExp): PBShaderExp;
}
```

- **一次查找**：页表项已经带着"最近的已驻留祖先"，命中级 = 请求级 + LODOffset，页内坐标按 `2^LODOffset` 缩放后换算到祖先页，与 UE `VirtualToPhysicalTexelBase` 一致。不需要逐级回退的循环。
- 图集 uv = `(物理页原点 + B + fract(页内坐标) × P) / atlasSize`。
- 三线性：对 `floor(level)` 和下一级各 resolve 一次，按小数部分插值，2 倍开销，由使用方选择是否开启。
- **VSM 使用精确查找**：只接受 `LODOffset = 0` 且"本级有效"的页，缺页的处理由使用方决定。

### 7. 填充的两种接入方式

- **compute 填充**（RVT）：核心提供一个填充 kernel 模板。每个 workgroup 负责一页，线程循环覆盖 `S × S` 个 texel（含边框），对每个 texel 调用使用方提供的 `fillTexel(scope, level, 虚拟 texel 坐标)`，返回各平面的值，由核心负责 `textureStore`。
  - 边框 texel 的虚拟坐标落在页外，使用方按正常逻辑计算即可，边框天然正确。对 RVT 这类由函数生成的内容，不需要从相邻页拷贝边框。
- **自定义填充**（VSM）：核心交出 `fillList` 和 dispatch 参数，由使用方自行光栅化。例如按物理页原点设置视口和裁剪，用 instancing 批量绘制。

### 8. 调试

- **页表可视化**：一个 compute 把指定级的页表写成一张小纹理。绿色 = 已驻留，黄色 = 脏，红色 = 本帧请求但未驻留，灰色 = 未请求。
- **统计**：`counters` 每隔若干帧异步读回一次（本来就只是调试信息，延迟无所谓），包括：本帧请求数、分配数、淘汰数、填充数、驻留总数、请求溢出次数。

### 9. 对外 API 概要

```ts
interface VirtualTextureOptions {
  levels: VirtualTextureLevel[];
  pageSize?: number;           // 默认 128
  border?: number;             // 默认 4
  atlasSize?: number;          // 默认 4096
  planes: VirtualTexturePlane[];
  requestCapacity?: number;    // 默认 16384
  allocBudget?: number;        // 每次 update 最多分配 + 重填的页数；UE RVT 默认 2，我们默认 16（GPU 填充便宜得多）；VSM 设为 Infinity
  pinnedLevels?: number;       // 最粗的几级常驻，默认按页数 ≤ N/8 自动选择
  maxPageAge?: number;         // 帧，未被请求的页保留映射的最长帧数，对应 UE MaxPageAgeSinceLastRequest，默认 1000
}

class VirtualTexture extends Disposable {
  constructor(options: VirtualTextureOptions);
  readonly slotSize: number; readonly slotsPerRow: number; readonly physicalPageCount: number;
  getPlaneTexture(name: string): Texture2D | null;
  getPlaneBuffer(name: string): GPUDataBuffer | null;
  update(stamp: number): void;            // ①～⑧
  fill(program: GPUProgram, bindGroup: BindGroup): void;  // ⑨ compute 填充，随后执行 ⑩ ⑪
  readonly fillList: GPUDataBuffer; readonly fillDispatchArgs: GPUDataBuffer;  // 自定义填充用
  invalidate(): void; invalidateRegion(u0, v0, u1, v1): void;
  // 着色器辅助：见第 6 节
  // 调试：debugTexture(level)、stats
}
```

---

## 阶段 1 的验证示例 `examples/src/virtualtexture`

使用方是一个合成的"程序化纹理"：
- 虚拟尺寸 65536²，P=128，即 512×512 页、10 级。**图集故意设得很小**（例如 1024² → 7×7 = 49 页），用来逼出淘汰和预算上限。
- 填充内容：每页底色 = 按级区分的颜色；页内画网格线、页边框，以及用哈希决定的色块区分相邻页。边框 texel 也按同一规则计算，用来验证双线性过滤在页边界处连续。
- 一个大平面贴上这张虚拟纹理，片元着色器用导数算级，先 `request` 再 `resolve` 并采样。
- 屏幕上叠加：页表可视化（可切换级）和统计数据。

**目测要点**
1. 相机拉近时，细级的页逐步出现，颜色从粗级的色调变为细级的色调；拉远时退回粗级。
2. 预算限制下，是从粗到细均匀地变清晰，不会出现局部空洞或错误的页。
3. 页边界处的过滤连续，看不到缝。
4. 图集很小时，相机移动会引发淘汰，但**当前视野里需要的页永远不会被淘汰**，页表可视化中看不到"本帧请求却被淘汰"的闪烁。
5. 统计数据合理：静止时分配数为 0；移动时分配数不超过预算。

## 风险与待定事项

- **pb 构建器**：本仓库之前没有在片元着色器里用过 storage buffer 的原子写（标记用），也没有大量使用 workgroup 共享内存。阶段 1 会先踩这些坑，出了问题就地修构建器。
- **片元着色器里的原子写开销**：每个像素都写请求会有竞争。验证示例里按 4×4 像素、随帧抖动采样一个像素来标记。正式的 RVT 改为深度驱动的 compute 标记（阶段 3），就不存在这个问题。
- **页表放在 storage buffer**：UE 用的是 `RWTexture2D<uint>`。WebGPU 的 r32uint storage texture 可读写，但构建器对它的支持没有 storage buffer 成熟，先按 buffer 实现；如果阶段 3 的实测显示寻址是瓶颈，再改成纹理，接口不变。
- **渲染图接入**（阶段 2）：需要在"深度预pass 之后、光照之前"新增插入点。本文只确定核心接口，不涉及渲染图的具体改法。

## 与后续阶段的关系

| 阶段 | 依赖本设计的部分 |
|---|---|
| 2 渲染图接入 | `update()` 的调用时机；多相机共用规则 |
| 3 地形 RVT | 深度驱动标记（compute 读深度 → 世界 XZ → 地形 uv，按像素覆盖选级）；compute 填充模板；`resolve` + 三线性；splat 修改时 `invalidateRegion` |
| VSM（以后） | `virtualClipmap`；buffer 平面 + atomicMin 深度；`allocBudget = Infinity`；自定义光栅化填充；不回退的精确查找；投影体移动时 `invalidateRegion` |

## 参考来源

| 设计点 | 出处（UE 5.8） |
|---|---|
| 四列表 LRU（LRU / AVAILABLE / EMPTY / REQUESTED）、列表顺序即 LRU、分配从 AVAILABLE 末尾弹出、EMPTY 追加到末尾 | `Engine/Shaders/Private/VirtualShadowMaps/VirtualShadowMapPhysicalPageManagement.usf`：`UpdatePhysicalPages`、`PackAvailablePages`、`AppendPhysicalPageLists`、`AllocateNewPageMappings` |
| 帧龄保留缓存页（`MaxPageAgeSinceLastRequest`）、物理页元数据中的 `LastRequestedSceneFrameNumber` | 同上，`UpdatePhysicalPages` |
| 每帧清空并重建页表、淘汰时清除旧主人的页表项 | 同上；主机端 pass 顺序见 `Engine/Source/Runtime/Renderer/Private/VirtualShadowMaps/VirtualShadowMapArray.cpp`（ClearPageTable → UpdatePhysicalPages → PackAvailablePages → AllocateNewPageMappings → PropagateMappedMips） |
| 页表编码（物理地址 + LODOffset + 本级有效 / 任一级有效）、一次查找 | `VirtualShadowMapPageAccessCommon.ush`：`ShadowEncodePageTable`、`ShadowDecodePageTable`、`VirtualToPhysicalTexelBase` |
| 未驻留页写入最近已驻留祖先 | `VirtualShadowMapPageManagement.usf`：`PropagateMappedMips`（局部光源的 mip 分支） |
| 缓存页失效后保持映射、原地重渲染 | `VirtualShadowMapPhysicalPageManagement.usf`：`VSM_FLAG_STATIC_UNCACHED` / `VSM_FLAG_DYNAMIC_UNCACHED` 的处理 |
| 请求优先级 `count × (1 + level)`、按预算截断 | `Engine/Source/Runtime/Renderer/Private/VT/UniqueRequestList.h`：`SortRequests`；预算 `r.VT.MaxUploadsPerFrame` 见 `Engine/Source/Runtime/Engine/Private/VT/VirtualTextureScalability.cpp` |
| 预取：未驻留时连带请求比驻留级细最多 2 级的祖先页 | `Engine/Source/Runtime/Renderer/Private/VT/VirtualTextureSystem.cpp`（`PrefetchLocal_vLevel = AllocatedLocal_vLevel - min(2, AllocatedLocal_vLevel)`） |

| 空闲阈值：最近 N 帧内用过的页不算空闲（默认 15），应对稀疏/轮换标记 | `r.VT.PageFreeThreshold`，`Engine/Source/Runtime/Engine/Private/VT/VirtualTextureScalability.cpp`；使用处 `TexturePagePool.cpp` `AnyFreeAvailable` |
| 驻留 mip 偏移：池使用率超上限时提高全局 mip 偏移，低于下限时回落；速率 0.2、上限 4 级、常驻页占比 > 0.65 时关闭 | `Engine/Source/Runtime/Renderer/Private/VT/VirtualTexturePhysicalSpace.cpp` `UpdateResidencyTracking`；偏移加在取整前见 `VirtualTextureCommon.ush` `TextureComputeVirtualMipLevel` |

**与 UE 不同之处**
- 请求用每帧清零的计数 buffer（UE VSM 用每帧清零的 `PageRequestFlags` 纹理，UE RVT 用 CPU 读回的反馈计数）。我们需要 GPU 上的计数来做 RVT 的优先级，所以合并成一个计数 buffer。
- 预算内的 top-K 选择在 GPU 上用 log2 直方图门槛近似 UE 的 CPU 排序，同桶内不严格有序。
- 页表用 storage buffer 而不是纹理（见"风险与待定事项"）。
- 驻留 mip 偏移的下限默认 0.8（UE 上下限都是 0.95）。页要过空闲阈值才退出"在用"，上下限相等时偏移会追着自己刚造成的驻留率变化来回调整，阶段 1 示例中表现为级别边界上下游走。
- Allocate 先占填充名额再弹出物理页，保证映射过的页一定被填充；UE VSM 的分配与渲染是分开的两步，不存在这个问题。

## 实施记录

- 阶段 0（`f5555b89`）：`computeIndirect`，示例 `examples/src/indirectdispatch`。
- 阶段 1（`0ab89456`）：`libs/scene/src/render/virtualtexture/virtual_texture.ts`，示例 `examples/src/virtualtexture`，单元测试 `test/src/scene/virtual_texture.test.ts`。
  - 调试辅助：`renderDebugTexture(level)` 页表可视化；`stats` 计数；`validate()` 读回检查 6 个不变量（丢失/重复/归属错误/共享/常驻缺失/完全未映射）。
  - 验证中发现并修复：绑定时须按变量名走 `nameMap`（布局条目是 `zUBC_*` 块名）；初始 LRU 须写入第一次 update 读取的那份交替 buffer；JS 位运算常量须 `>>> 0`。

