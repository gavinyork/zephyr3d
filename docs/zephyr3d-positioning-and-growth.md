# Zephyr3D 定位叙事与推广实施方案

> 基于仓库当前能力与公开竞品定位整理，版本：2026-10。

## 1. 先给结论

Zephyr3D 不应把自己包装成“另一个 Three.js”，也不应在生态规模上与 Babylon.js 或 PlayCanvas 正面竞争。更合适的定位是：

> **面向浏览器的高质量实时 3D 创作引擎：用 TypeScript 把 WebGPU 级画面、复杂动态效果和可视化编辑器放在同一条工作流里，并以 WebGL2 作为兼容后备。**

英文短句建议：

> **Build rich, physical worlds on the web.**

中文短句建议：

> **在浏览器里，做出会动、会呼吸的 3D 世界。**

这个叙事把 Zephyr3D 的差异集中在三个结果上：画面效果有说服力、动态系统能直接用于交互、从编辑器到 TypeScript 运行时不需要换工具。WebGPU、Forward+、渲染图和 shader 生成器是支撑这些结果的技术，不应成为首屏主标题。

## 2. 产品现状盘点

仓库和现有站点已经具备可公开展示的证据：

| 能力 | 当前证据 | 对外应表达的用户价值 |
| --- | --- | --- |
| WebGPU 优先，WebGL2 fallback | `backend-webgpu`、`backend-webgl`，README 有完整初始化示例 | 新浏览器获得现代 GPU 路径，旧环境仍有可运行的兼容路径 |
| 高难度自然效果 | FFT/Gerstner/FBM 水体、近岸浪花和焦散、clipmap terrain、草、天空和雾 | 海洋、岛屿、户外场景不必从零搭建核心效果 |
| 角色表现 | skin、眼睛、MToon/VRM、GPU hair、morph、IK、joint dynamics、cloth | 角色和服装能在浏览器中产生可交互的动态反馈 |
| 渲染质量 | PBR/IBL、clustered lighting、PCF/PCSS/ESM/VSM/SSM/DOM shadows、OIT、TAA/SSR/SSGI/SSAO | 适合展示型产品、数字人、互动展览和高质量 demo |
| 单一 shader 来源 | TypeScript shader builder 生成 WGSL 与 GLSL | 一套 shader 逻辑覆盖 WebGPU 和 WebGL2，减少分叉维护 |
| 编辑器工作流 | 在线编辑器、Electron 桌面版、材质节点、地形、动画、脚本、插件 API | 从看到效果到修改场景可以在浏览器完成，工程团队仍可用代码扩展 |
| 自动化与扩展 | 桌面编辑器内置 MCP、LLM assistant、插件 API | 可将场景制作接入自动化工具和团队内部工具链 |
| 工程基础 | glTF/GLB、FBX、Alembic、KTX2、prefab、VFS、LOD、GPU culling、procgen、Rapier physics | 资产导入和运行时优化已有工程基础 |

需要诚实标明的限制：项目尚未 1.0，minor 版本可能改 API；WebGPU 才能提供 GPU cloth、GPU hair、A-buffer OIT、DOM shadows 等完整能力；社区、插件和案例数量仍远小于成熟竞品；目前主要由单人维护。这些限制应转化为版本策略和社区建设任务，而不是在宣传中回避。

## 3. 与竞品的选择性比较

比较对象的公开入口： [Three.js](https://threejs.org/)、[Babylon.js](https://www.babylonjs.com/)、[PlayCanvas](https://playcanvas.com/)。以下比较按产品心智而非功能逐项打勾。

| 维度 | Three.js | Babylon.js | PlayCanvas | Zephyr3D 的机会 |
| --- | --- | --- | --- | --- |
| 产品心智 | 低层级、可组合的 Web 3D 库 | 完整引擎、工具和 Playground | 云端编辑器、协作和发布平台 | 把“高质量效果 + TypeScript 工作流 + 可视化编辑器”绑定成一个窄而强的选择 |
| 上手路径 | 开发者从代码和生态拼装 | Playground、Inspector、文档和社区 | 浏览器编辑器、模板和团队协作 | 在线编辑器直接打开可运行 demo，再导出或接入 npm 工程 |
| 画面差异 | 依赖示例和第三方方案，能力边界弹性大 | 功能广、成熟度高 | 面向生产和协作，效果取决于资产与模板 | 用水体、头发、布料、地形四个“难效果”作为可重复 benchmark |
| WebGPU 故事 | 持续演进，但不是唯一品牌中心 | WebGPU 与 WebGL 都是完整路径 | 兼顾浏览器生产和平台能力 | WebGPU-first + WebGL2 fallback + 单源 shader 是清楚的技术承诺 |
| 工具和协作 | 主要由生态补足 | Inspector、Node Material、Editor 等较完整 | 云项目、协作、发布体验强 | 用轻量在线/桌面编辑器和插件/MCP切入“个人开发者 + 技术美术” |
| 生态壁垒 | 最大的社区、教程和第三方组件 | 成熟的引擎生态与商业支持 | 平台、模板、团队用户 | 不追求广度，先建立“高质量效果配方”和可复制案例壁垒 |

因此，Zephyr3D 的竞争句式应是“当项目的关键是浏览器中的复杂动态效果和可编辑工作流时，选择 Zephyr3D”，而不是“Zephyr3D 比所有引擎更强”。

## 4. 目标用户与使用场景

首阶段只服务三个相邻人群：

1. **Web 3D 产品开发者**：互动官网、数字孪生、展览、教育、产品配置器，需要高画面质量且不想维护两套 shader。
2. **技术美术和独立创作者**：想快速试验海洋、地形、角色、布料和材质，接受 TypeScript，但需要编辑器缩短反馈周期。
3. **引擎/工具开发者**：要在 Web 上做自己的编辑器、可视化工具或仿真界面，需要 MIT、可读源码和插件接口。

暂不把“通用游戏引擎替代品”和“大型团队云协作平台”作为主战场；那会直接撞上 Babylon.js 与 PlayCanvas 最强的认知资产。

## 5. 叙事结构

### 首屏

标题：**Build rich, physical worlds on the web.**

副标题：**A WebGPU-first TypeScript engine and visual editor for characters, oceans, terrain, and interactive scenes—with WebGL2 fallback.**

首屏只放三个动作：`Try a live demo`、`Open the editor`、`Install packages`。第一屏应展示一个可交互场景，而不是功能长列表。

### 三个支柱

- **Effects that sell the scene**：海水、近岸浪花、地形、草、头发、皮肤和透明效果，强调最终画面。
- **Dynamics you can touch**：IK、布料、弹簧链、浮力、物理和脚本，强调“点击、拖动、碰撞后真的有反馈”。
- **One workflow from idea to runtime**：编辑器、材质节点、TypeScript、插件和 MCP，强调从实验到产品的连续性。

### 证明方式

每个主张都配一个 30 秒内可操作的证据：拖动浮标看浮力，拉动布料看约束，切换 WebGPU/WebGL2 看兼容路径，在材质节点中改颜色后立即运行脚本。功能页面采用“场景、操作、源码、性能数据、限制”五段结构。

## 6. 推广实施方案

### 0-30 天：建立可转化的第一印象

- 重写官网首页和 GitHub README 首段，统一上面的定位、三个支柱和三个 CTA。
- 制作四个固定 benchmark：`Ocean + buoyancy`、`Terrain + grass`、`Character + hair/cloth`、`Material + OIT`。每个 demo 都提供在线编辑器链接、源码、包版本、浏览器/GPU 信息和 FPS/帧时间。
- 发布“5 分钟完成第一个场景”和“从 demo 到 npm 项目”两条路径；首个成功事件定义为用户在编辑器中打开场景并修改一个参数后运行。
- 增加兼容性页面：WebGPU 能力矩阵、WebGL2 降级矩阵、已知限制和故障排查。
- 加入匿名、可退出的事件统计：官网 CTA 点击、编辑器打开、首个运行、npm 安装、GitHub star、示例 fork。

### 31-90 天：用内容制造搜索入口

每周发布一篇技术文章和一段短视频，固定采用“问题 → 画面 → 原理 → 可运行 demo → 源码”的模板：

- `How FFT ocean and buoyancy work in the browser`
- `One TypeScript shader source for WGSL and GLSL`
- `GPU cloth and hair: when WebGPU is worth it`
- `Clipmap terrain with runtime texturing and grass`
- `Building a material node graph, then extending it with TypeScript`

同步投放到 GitHub Discussions、Reddit `r/webgpu`/`r/threejs`、Hacker News（技术文章而非广告）、Discord/论坛和中文的掘金、知乎、B 站。每篇内容只推一个可运行 demo，避免泛泛介绍引擎。

### 91-180 天：把试用者变成贡献者

- 举办“WebGPU Scene Jam”：提供四个 starter project、统一资产和性能记录模板，评审画面、交互和源码质量。
- 建立 `good first issue`、效果配方仓库、性能回归仪表盘和每月 release note。
- 招募 5-10 位早期创作者做公开案例，优先覆盖数字人、教育、互动展览、产品配置器和独立游戏原型。
- 发布稳定性路线图：0.x 期间的兼容承诺、弃用周期、1.0 的核心 API 清单和版本迁移工具。
- 形成插件目录和示例插件；MCP/LLM 能力先以“可复现的编辑器自动化脚本”展示，避免只讲概念。

## 7. 渠道与内容配比

建议每月内容配比：40% 可运行效果 demo，25% 技术深度文章，20% 教程和模板，10% 社区活动，5% 项目进展。渠道优先级为 GitHub/官网文档、YouTube/B 站、Hacker News/Reddit、Discord/Discussions，再做中文社区和会议演讲。付费广告暂缓，等激活漏斗和留存数据稳定后再测试。

## 8. 指标与验收

不要用曝光量作为唯一目标。首个 6 个月跟踪：

| 阶段 | 核心指标 | 建议目标 |
| --- | --- | --- |
| 发现 | benchmark 页面到编辑器点击率 | ≥ 15% |
| 激活 | 编辑器打开后 10 分钟内成功运行并改动场景 | ≥ 35% |
| 开发 | 文档访客到 npm 安装或 starter fork | ≥ 8% |
| 留存 | 新用户 30 天内再次打开 demo/提交代码 | ≥ 20% |
| 社区 | 每月外部贡献者、有效 issue、插件/配方 PR | 持续增长，按月公布 |
| 产品质量 | demo 崩溃率、WebGPU shader 错误率、首屏加载时间 | 每个版本回归并公开 |

每月只保留一个增长实验变量，例如 CTA 文案、demo 首屏、教程顺序或 starter 项目；所有结果写入 `docs/marketing/`，避免凭感觉调整定位。

## 9. 必须补齐的产品与信任资产

推广前应完成：稳定的 CDN demo 版本、浏览器支持矩阵、可复制的 starter repo、API 版本策略、性能基准脚本、错误报告入口、贡献指南和维护者响应时间说明。对外材料中明确“尚未 1.0”和 WebGPU 限制，反而能筛选出适合的早期用户并减少预期落差。

## 10. 可直接复用的短文案

**一句话**：Zephyr3D 是一个 WebGPU-first 的 TypeScript 3D 引擎与可视化编辑器，让海洋、地形、角色、布料和材质等高难度实时效果可以直接在浏览器里创作和发布。

**面向开发者**：Write one TypeScript shader source, ship WebGPU and WebGL2, and keep the scene editable from the browser.

**面向技术美术**：Start from a live scene, tune the material or terrain visually, then take the same project into TypeScript.

**面向决策者**：A focused web runtime for experiences where visual richness and interaction matter more than a large generic engine footprint.

## 参考资料

- Zephyr3D 仓库 README、`libs/scene/README.md`、`utility/editor/README.md` 与现有 demos。
- Three.js：<https://threejs.org/>、文档与 examples。
- Babylon.js：<https://www.babylonjs.com/>、<https://doc.babylonjs.com/>。
- PlayCanvas：<https://playcanvas.com/>、<https://developer.playcanvas.com/>。

竞品的功能和产品页面会随版本变化；发布正式对比页面前，应在发布日重新核对版本、浏览器支持和商业条款。
