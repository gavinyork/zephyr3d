# SDF 系统：离线烘焙 + 全局 clipmap SDF + 按需流式

## Context

近岸泡沫的屏幕空间 Hi-Z 查询受视角、遮挡和 mip 影响（刀切边、颗粒、缓坡大片起沫），后续 GPU 碰撞、软阴影/AO、GI 也都需要一份世界空间的距离场。本计划建立引擎级 SDF 基础设施：

- 每个 mesh 离线烘焙一份局部 SDF 资产；
- 运行时由这些资产 + 地形合成一份跟随相机的多级全局 SDF，增量更新；
- mesh SDF 按需异步加载/释放；
- 统一的着色器查询 API，供水体、碰撞、阴影等消费。

已定决策：运行时合成 **WebGPU 专属**，但接口和着色器写法预留 WebGL2 逐 slice 渲染回退；"流式"指 **SDF 资产按需流式**（不做 world partition）；节点新增 **`sdfMode`** 属性区分静态/动态。

## 现状约束（来自代码调研）

- compute：`device.buildComputeProgram` / `device.compute()`；WebGL2 无 compute（`device_webgl.ts` 直接抛错）。FFT 波形（`render/fft_wavegenerator.ts` + `shaders/water.ts`）用"同一函数体既做 compute 又做 fragment"的双路写法，是回退口子的现成范式。
- 3D 纹理：WebGPU 只能用 compute 写（不可作 render target）；可写格式只有 `r32f`（过滤需 `float32-filterable`）和 `rgba16f`；`r16f` 可采样不可写。`Texture3D.update()` 支持子区域上传（atlas 用）。WebGL2 可用 `fb.setColorAttachmentLayer` 逐 slice 渲染。
- Mesh：`.zmsh`（`asset/zmsh_binary.ts`，`decodeZmshBinary` 可在 worker 里不经 GPU 解码）；`Primitive` 无 CPU 副本。
- 派生资产：`utility/editor/src/core/services/derivedassets.ts`（`/.cache/derived/...`，按源 SHA-1 + 设置 + 版本作键，`assetSourceResolver` 运行时解析，`asset_manifest.ts`/`core/build/build.ts` 随构建打包）；导入设置在 `.zmeta`（`asset/mesh_settings.ts`）。
- 地形：`terrain-cm/terrain-cm.ts`，GPU `r16f` 高度图 `material.heightMap`，CPU `_heightData`；只继承平移。
- 无 static/mobility 标记；遍历用 `scene.rootNode.iterate` + `isMesh()`；`Scene.octree` 可做空间查询。

## 架构

```
离线：.zmsh ──worker 烘焙──▶ .zsdf（派生资产缓存）
运行：.zsdf ──按需加载──▶ Mesh SDF Atlas（3D r16f，共享）
      Atlas + 地形高度图 + 静态实例列表 ──compute 合成──▶ Global SDF clipmap（N 级，环形寻址，增量）
      动态实例（≤16）──▶ 查询时现场 min 合并
      着色器：sdfSample / sdfGradient / sdfRaymarch（不可用时返回 null → 调用方回退）
```

### 1. 离线 mesh SDF 烘焙

- **资产格式 `.zsdf`**（新文件 `libs/scene/src/asset/zsdf_binary.ts`，仿 `zmsh_binary.ts` 的 magic + JSON 头 + blob）：头含 `version`、局部包围盒（外扩 2 voxel）、`resolution[3]`、`voxelSize`、`maxDistance`、`twoSided`；数据为 half-float 稠密体素。预留 `encoding` 字段，以后换 8³ 稀疏 brick + 窄带量化时不破格式。
- **分辨率**：按 `voxelSize = 最大边 / (64 × resolutionScale)`，每轴上限 128，下限 8。
- **烘焙算法（CPU worker，与后端无关，WebGL2 也能用）**：新 worker `utility/editor/src/workers/sdf_bake.ts`
  1. `decodeZmshBinary` 取 LOD0 三角形；
  2. 构建三角形 BVH（新 `libs/scene/src/utility/sdf/bvh.ts`，SAH 分箱）；
  3. 每体素：BVH 最近三角形求无符号距离；
  4. 符号：6~12 方向射线奇偶投票取多数（容忍非水密模型）；`twoSided` 薄片模型改为"无符号 − 半个体素"。
- **编辑器接入**：`DerivedAssetService` 增加 `sdf` 类别（`/.cache/derived/sdf/<hash>.zsdf`，键 = 源 SHA-1 + SDF 设置 + `SDF_BAKER_VERSION`）；`.zmeta` 新增 `sdf: { enabled, resolutionScale, twoSided }`；导入/修改 mesh 时后台烘焙；菜单"Bake SDF（当前场景所有 mesh）"。随构建打包走现有 manifest。
- **MCP**：`asset_bake_sdf(paths)`、`sdf_query_distance(points)`（按 MCP 优先的工作方式，供我直接验证数值）。

### 2. 运行时：Mesh SDF Atlas + 流式

- **`MeshSDFAtlas`**（新 `libs/scene/src/render/sdf/sdf_atlas.ts`）：一张 3D `r16f` 纹理（默认 512×512×256，可配置），以 8 voxel 为粒度的 3D shelf 分配；`Texture3D.update` 子区域上传。只采样不写，WebGL2 同样可用。
- **`SDFStreamer`**（`sdf_streamer.ts`）：根据实例到相机的距离与 clipmap 覆盖范围决定所需 SDF，经 `AssetManager`（`assetSourceResolver`）异步拉取 `.zsdf`；LRU 驱逐；每帧上传字节预算；一个资产被多个实例共享。资产到达/驱逐时把覆盖区域标脏。
- **`sdfMode`**：`SceneNode` 新属性 `'auto' | 'none' | 'static' | 'dynamic'`，默认 `auto`：有动态刚体、蒙皮或 morph → `dynamic`，否则 `static`。序列化 + 编辑器属性。地形恒为 static，不走 atlas。

### 3. 全局 SDF clipmap（WebGPU compute）

- **`GlobalSDF`**（`render/sdf/global_sdf.ts`）：默认 5 级，每级 128³，voxel 0.25/0.5/1/2/4 m（覆盖 32 m~512 m），可配置。存储格式按能力选：有 `float32-filterable` 用 `r32f`，否则 `rgba16f`（只用 r 通道）。
- **环形寻址**：每级中心按 brick（8 voxel）对齐跟随相机；移动时只把新进入的 slab 记为脏区。外加脏区来源：static 实例增删/移动、SDF 资产到达/驱逐、地形编辑。
- **合成 compute**（每帧按 brick 预算处理脏区，粗级优先保证可用性）：
  1. CPU 用 `Scene.octree` 找与脏区块（32³ voxel 为一块）相交的 static 实例，写入 storage buffer：world→local 矩阵、atlas 偏移/尺寸、局部包围盒、`1/最小缩放`；
  2. 每体素：对列表内实例，包围盒内采样 atlas，包围盒外用到盒的距离 + 盒边界 SDF 值近似；乘以缩放修正后取 min；
  3. 地形：`(y − h(x,z)) / sqrt(1 + |∇h|²)`，`h` 从地形高度图采样，与上面取 min；
  4. 截断到 `levelMaxDist`（4 个本级 voxel 以外的部分由更粗级负责）。
- **回退口子**：合成函数体按 FFT 双路范式编写（一份逻辑，compute 入口用 `textureStore`，fragment 入口输出到 slice）。定义 `SDFCompositor` 接口：WebGPU 实现 = compute；WebGL2 先给 `UnsupportedCompositor`，以后补逐 slice 渲染实现，上层不变。
- **接入渲染图**：在 `render/rendergraph/forward_plus_builder.ts` 帧首（不透明之前）加 `GlobalSDFUpdate` pass，作为可选模块注册（符合 RenderGraph 模块化方向）；场景级开关 `scene.globalSDF.enabled`。

### 4. 着色器查询 API

- 新 `libs/scene/src/shaders/sdf.ts`，按 `ShaderHelper.getHiZDepthTexture` 同样的方式经 `material/shader/helper.ts` 暴露：
  - `ShaderHelper.hasGlobalSDF(scope)`：WebGL2 / 未启用时为 false，调用方据此回退（如泡沫继续用 Hi-Z）；
  - `sdfSample(scope, worldPos)`：选包含该点的最细级，级边界处与下一级线性混合，再与动态实例（storage buffer，≤16 个，现场采样 atlas）取 min；
  - `sdfGradient`（中心差分）、`sdfRaymarch(origin, dir, tMax, steps)`（球追踪，返回命中距离和步数）。
- **CPU 查询**：`GlobalSDF.queryDistance(points): Promise<Float32Array>`，复用水面 feedback 的点列表绘制 + readback 模式（`scene/water.ts` `_evaluateSurfacePoints`），供 gameplay/编辑器/MCP 用。

### 5. 调试与工具

- 调试视图：全局 SDF 水平切片（距离着色 + 等值线）、球追踪着色视图、各级 clipmap 边界与脏 brick 可视化、实例包围盒。
- 统计：atlas 占用、待加载数、每帧合成 brick 数、GPU 时间。

### 6. GPU 动态网格 SDF（参考 TressFX）

蒙皮、morph、可破坏等 `sdfMode = dynamic` 的网格，几何每帧在变，不能用离线烘焙，改为在 GPU 上每帧（或按需）重建局部 SDF，结果写入 atlas 里该实例的槽位。参考 `E:\works\TressFX\src\Shaders\TressFXSDFCollision.hlsl`：

1. **初始化**：每格一个线程，写入大值。
2. **种子（照搬 TressFX）**：每三角形一个线程，遍历三角形包围盒外扩 1 格内的格子，算点到三角形距离，以 `FloatFlip3` 编码（符号位移到最低位，按无符号比较即取绝对值最小，同值偏向正）对 `atomic<u32>` storage buffer 做 `atomicMin`（`pb.atomicMin`，WebGPU）。同时以同样方式记录最近三角形 ID（64 位不可用时用两遍：先距离，再对距离相等者写 ID）。
3. **远场（TressFX 没有）**：3D JFA 传播最近三角形 ID，步长 N/2…1，每格对邻居的候选三角形重算距离取最小。替代 CPU 版的 8 向扫描。
4. **符号（TressFX 用单三角形面法线，边/凹角/开口网格会错）**：默认用角度加权伪法线判号（需要顶点/边伪法线，网格拓扑不变时预计算一次，蒙皮时随顶点一起变换）；可选每行一线程的三轴射线奇偶投票（需要 GPU 端格子化三角形列表），用于不封闭网格。
5. **定稿**：解码写入 atlas（compute 写 `rgba16f`/`r32f` 暂存，再拷贝或直接采样）。

输入顶点取蒙皮后的结果（复用 GPU 蒙皮输出，或在此 pass 内做一次蒙皮）。分辨率比静态网格低（如 32³~48³），按距离相机降频更新。WebGL2 下回退为不更新（用绑定姿态的离线 SDF）。

### 7. 相关工作（建议纳入后续阶段）

1. **水线距离场**（直接解决近岸泡沫）：在全局 SDF 上取海平面切片，`sdf < 0` 为掩码，跑 2D JFA 得到严格的"到水线水平距离" + 岸线法线。地形、礁石、码头、桥墩统一处理；水体泡沫、冲刷相位 `sin(ωt − k·d)` 和 `ShoreWaveField` 都从这里取数。
2. **GPU 碰撞**：粒子、GPU 布料、草（`terrain-cm/grass_gpu.ts`）、泡沫粒子对 SDF 做穿透修正；CPU 侧用 `queryDistance` 做射线/点查询。
3. **SDF 软阴影 / DFAO**：球追踪做远处软阴影和天光遮蔽；替代或补充远级联阴影。
4. **GI 前置**：SDF 球追踪 + surface cache（后续独立项目）。
5. **水下光线/焦散遮挡**：`UnderwaterGodRayShadow` 可改用 SDF，代替逐步的阴影图查询。
6. **稀疏 brick + 窄带压缩**：mesh SDF 换成稀疏 8³ brick（UE5 做法），省内存、支持更高分辨率。
7. **WebGL2 合成器**：逐 slice 渲染实现。

## 分期与关键文件

| 阶段 | 内容 | 主要文件 |
| --- | --- | --- |
| P1 | `.zsdf` 格式、BVH、CPU 烘焙 worker、派生资产缓存、`.zmeta` 设置、编辑器烘焙命令、MCP 烘焙/单 mesh 查询 | `asset/zsdf_binary.ts`、`utility/sdf/bvh.ts`、`utility/sdf/bake.ts`、`editor/.../workers/sdf_bake.ts`、`derivedassets.ts`、`asset/mesh_settings.ts` |
| P2 | Atlas、Streamer、`sdfMode` 属性与序列化 | `render/sdf/sdf_atlas.ts`、`render/sdf/sdf_streamer.ts`、`scene/scene_node.ts`、`utility/serialization/scene/*` |
| P3 | GlobalSDF clipmap、合成 compute、地形项、渲染图 pass、`SDFCompositor` 接口 | `render/sdf/global_sdf.ts`、`shaders/sdf_composite.ts`、`rendergraph/forward_plus_builder.ts` |
| P4 | 着色器查询 API、动态实例、CPU `queryDistance`、调试视图 | `shaders/sdf.ts`、`material/shader/helper.ts` |
| P5 | 水线距离场 + 近岸泡沫改用它（Hi-Z 作回退） | `material/water.ts` |
| P6 | GPU 动态网格 SDF：原子种子 + JFA 远场 + 伪法线判号，写入 atlas 槽位 | `render/sdf/dynamic_sdf.ts`、`shaders/sdf_dynamic.ts` |

## 验证

- P1：对盒子、球、船体 mesh 烘焙，用 MCP `sdf_query_distance` 取若干已知点（中心、面外 1 m、角外），和解析距离对比；检查非水密模型符号正确。
- P3/P4：海岛场景开启全局 SDF，切片调试视图看沙滩、岩石、船体；相机快速移动时检查无闪烁、clipmap 级边界无断层；地形编辑后对应区域重算。
- P5：近岸泡沫在沙滩上只沿水线一窄条，桥墩/船体仍有一圈，视角变化时稳定。
- 每阶段先 `rush build`，再进 `utility/editor` 单独 build，由你目测；不主动加单测，烘焙器若需要回归测试可再加。
