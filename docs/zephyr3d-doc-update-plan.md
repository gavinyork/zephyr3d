# Zephyr3D 用户指南完善计划

## 当前盘点

| 功能 | 当前文档状态 | 完善动作 |
| --- | --- | --- |
| Mesh LOD | `mesh-lod.md` 已覆盖运行时生成、选择规则和限制 | 增加版本验收项，确认编辑器与运行时参数保持一致 |
| 骨骼动画几何体实例化（WebGPU） | 只有通用实例化说明 | 新增批处理、骨骼 palette、兼容条件和调试章节 |
| 网格 SDF / 全局 SDF（WebGPU） | 代码已有 `scene.sdf`，缺少用户指南 | 新增烘焙、流式加载、`sdfMode`、clipmap 和资源预算说明 |
| 基于 SDF 的 DDGI（WebGPU） | 代码已有 `scene.gi`，间接光照页尚未介绍 | 新增启用流程、探针参数、收敛/冻结、调试和烘焙状态说明 |
| 地形 RVT（WebGPU） | 已在 `terrain-runtime.md` | 补充与细节层、显存预算和手动失效的验收示例 |
| 体积云 | 只有传统 2D 云层说明 | 新增 `SkyRenderer.cloudMode`、噪声资源、缓存和调试视图说明 |
| 物理系统集成 | 刚体、碰撞体、脚本、角色、关节等已有完整章节 | 在总览中明确 Rapier/WASM 初始化、固定步长和 WebGL2/WebGPU 支持 |

## 页面与导航

新增页面成对维护：

- `web/zh-cn/instancing-skinned.md` / `web/en/instancing-skinned.md`
- `web/zh-cn/sdf.md` / `web/en/sdf.md`
- `web/zh-cn/lighting-ddgi.md` / `web/en/lighting-ddgi.md`
- `web/zh-cn/volumetric-clouds.md` / `web/en/volumetric-clouds.md`

页面统一按“解决的问题、最小示例、关键参数、限制与排查”组织。每次改动后运行
`npm run build:check` 和 `npm run build:vitepress:noapi`，并检查中英文侧边栏的页面集合一致。

## 分阶段验收

1. **API 对齐**：示例中的符号在 `apps/doc/report` 或源码中存在，WebGPU-only 能力有明确提示。
2. **可运行性**：示例初始化顺序与 `src/tut-*` 一致；需要资产的功能说明资产格式和烘焙位置。
3. **性能说明**：记录显存、每帧预算、更新模式和后端降级行为，避免只罗列属性。
4. **回归检查**：VitePress 构建通过，新增链接无 404，中文和英文页面同步更新。
