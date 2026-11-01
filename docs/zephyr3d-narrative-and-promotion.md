# Zephyr3D 叙事与推广实施方案

> 数据采集日期 2026-10-31。竞品数字来自 GitHub API 与 npm registry，发布任何对外对比前须重新核对。

## 1. 结论

- **主叙事保持不变**：「把先进的实时渲染技术带进浏览器」（Bringing advanced real-time rendering techniques to the browser）。不宣称高画质、高保真、AAA。
- **收窄到两个领域**：角色（皮肤、眼睛、发丝）与自然环境（海洋与岸线、地形、云、大气）。这是竞品核心库里最薄、而 Zephyr3D 投入最深的地方，也是唯一能和竞品拉开明显差距的地方。
- **"一套 shader 源码两后端"降为支撑性卖点**：three.js 的 TSL 已经做到同样的事，这一点不能再作为与 three.js 的区别来讲（见 §3.2）。
- **推广的瓶颈在转化资产，不在曝光渠道**：develop 领先 main 341 个提交没有发布；demos 页 26 个条目里 10 个是 RenderGraph 开发样例，皮肤、头发、眼睛、体积云一个都没有。先修这些，再做任何曝光。
- **推广节奏绑定版本**：1.0 做第一波集中发布，探针 GI 进 1.x 时做第二波并升级叙事。两波之间每周一篇技术长文。

## 2. 现状数据

| 项目 | Zephyr3D | three.js | Babylon.js | PlayCanvas |
| --- | --- | --- | --- | --- |
| GitHub stars | 141（fork 20） | 117,271 | 26,250 | 17,167（编辑器另 1,356） |
| npm 月下载（09-30 至 10-29） | 787（`@zephyr3d/scene`） | 88,435,172 | 1,415,103（`@babylonjs/core`） | 485,487 |
| 最新版本 | 0.9.27（2026-09-14） | r187 | 9.33.1 | 2.23.3 |
| 维护者 | 1 人 | 社区 + 核心团队 | 微软团队 | 公司团队 |

Zephyr3D 其他指标：仓库近 14 天访问 67 次、独立访客 63，其中 50 次来自 aocr.org，搜索引擎来源各 1 次；Discussions 5 条，Issues 5 条，PR 22 个。项目自 2024-02 起共 2,740 个提交。

这些数字说明：技术积累已经相当于一个中型引擎，但外界几乎看不到它。three.js 的下载量含大量传递依赖，不宜直接对比；和 PlayCanvas 比，Zephyr3D 的下载量约为其 1/600。

## 3. 竞品对比

### 3.1 各自的产品心智

| | three.js | Babylon.js | PlayCanvas | Zephyr3D 应占的位置 |
| --- | --- | --- | --- | --- |
| 用户怎么理解它 | 可组合的底层渲染库，什么都能拼 | 功能全面的完整引擎，工具齐全 | 云编辑器 + 发布平台，团队协作 | 角色与自然环境的渲染专长引擎 |
| 强项 | 生态、教程、第三方组件，243 个 WebGPU 示例 | 广度、Playground/Inspector/节点材质、商业背书 | 协作编辑、发布流程、Gaussian Splatting（引擎内 207 个 gsplat 相关文件） | 皮肤/头发/眼睛、海洋岸线、地形、云的完整系统 |
| WebGPU 路线 | WebGPURenderer + TSL 节点着色语言 | 原生 WGSL shader 库（ShadersWGSL 175 个目录项）+ FrameGraph | 手写 GLSL 与 WGSL 两套 chunk（290 / 316 个文件） | WebGPU 优先，TS shader builder 生成两种语言 |

### 3.2 三个支柱逐一核对差异

**支柱一：先进的渲染技术。** 这里有真实差距，但要讲准确：

| 技术 | 竞品现状（已核对） | Zephyr3D |
| --- | --- | --- |
| 发丝头发 | three.js、Babylon.js、PlayCanvas 仓库中均未找到发丝渲染或模拟 | Kajiya-Kay / Marschner 着色，GPU 展开发丝，compute 模拟，Alembic 导入 |
| 皮肤 | three.js 有 `webgpu_materials_sss` 示例；Babylon.js 有 SSS 后处理 | Burley 散射 + 透射，逐像素 profile 参数表，配套眼睛材质 |
| 海洋 | three.js 有 `webgpu_ocean` 示例（单文件 6.7 KB） | FFT/Gerstner/FBM，岸浪、泡沫场、焦散、折射、浮力、交互 |
| 体积云 | three.js 有 `webgpu_volume_cloud` 示例 | 体积云系统（develop 分支，未发布） |
| 地形 | three.js 有程序化地形示例 | clipmap 地形、运行时纹理、虚拟纹理、GPU 草 |
| GI | three.js 有 `webgpu_vxgi_sponza` 示例；Babylon.js 有 IBL Shadows | 仅 SSGI；探针 GI 在 feature/probe-gi，不进 1.0 |

可以讲的区别是：**竞品给的是示例或单项效果，Zephyr3D 给的是可在编辑器中调参、有文档、能和场景交互的完整系统**。发丝头发是唯一可以说"其他三家没有"的项。不能讲的是"只有 Zephyr3D 能做海洋/皮肤/云"。

**支柱二：一套 shader 源码两后端。** three.js TSL 同样用 JS 描述 shader、生成 WGSL 和 GLSL。这个支柱对比 Babylon.js 和 PlayCanvas（两套手写 shader）仍成立，对比 three.js 不成立。建议：
- 保留为支柱，但对外只讲它带来的结果（绑定布局与 shader 同步、自定义材质一次写成），不讲"别人做不到"。
- 不要在任何对比材料里把它列为与 three.js 的区别。

**支柱三：基于引擎的编辑器。** PlayCanvas 编辑器已以 MIT 开源，Babylon.js 有 Editor、Playground 和节点材质编辑器。编辑器本身不是区别。可以讲的区别有两点：编辑器所见即引擎所渲染（编辑器就跑在 Scene API 上）；角色和自然环境系统的参数在编辑器里直接可调。

### 3.3 竞品有而 Zephyr3D 没有的

对外"是否适合"段落里应如实列出：Gaussian Splatting（三家都有，PlayCanvas 投入最重）、WebXR（libs 中未找到相关代码）、烘焙或探针 GI、大型第三方生态、团队协作编辑。这些空缺决定了 Zephyr3D 不该打"通用引擎替代品"。

## 4. 叙事设计

### 4.1 定位句

> 当 Web 项目的成败取决于角色或自然环境的渲染效果时，Zephyr3D 提供可直接使用、可在编辑器里调节的完整系统，而不是需要自己拼装的示例。

这句话给内部统一口径用，不直接作对外文案。它同时划定了不服务的场景：通用游戏、团队协作平台、Splat 展示、XR。

### 4.2 标语与首屏

标语沿用现有：**Bringing advanced real-time rendering techniques to the browser.**

副标题建议从功能清单改为两个领域：

> Characters with skin, eyes and strand hair. Oceans, shorelines, terrain and clouds. A WebGPU-first TypeScript engine with a visual editor, falling back to WebGL2.

语气说明：三个短句并列陈述事实，不含比较词，不含 best / only / beyond 一类措辞。中文对应：

> 有皮肤、眼睛和发丝的角色，有海洋、岸线、地形和云的自然环境。WebGPU 优先的 TypeScript 引擎与可视化编辑器，可回退到 WebGL2。

首屏视觉：用一个能直接交互的旗舰 demo 代替现在的 mp4 视频（见 §5 阶段二）。

### 4.3 三支柱的权重调整

支柱名称不变，调整篇幅和证据：

| 支柱 | 首页篇幅 | 证据 |
| --- | --- | --- |
| 先进的渲染技术 | 约 60%，拆成"角色"和"自然环境"两块 | 两个旗舰 demo + 每项技术的文档页 |
| 一套 shader 源码两后端 | 约 15% | README 现有代码块 + 生成结果对照 |
| 基于引擎的编辑器 | 约 25% | 在编辑器里打开旗舰 demo 并调参的 30 秒录屏 |

### 4.4 措辞规则

沿用已定规则，并补充比较场景下的写法：

- 不写 high-fidelity、AAA、cinematic、photorealistic，不写 research-based。
- 技术出处引用论文（Burley 2015、d'Eon、Marschner 2003、Tessendorf 等），不写"移植自 UE5"。
- 不点名贬低竞品。需要对比时只用"Zephyr3D 自带 X 系统"的正面陈述，不用"别家没有"。
- 对 three.js 不提 shader 系统的区别（理由见 §3.2）。
- 每个技术主张旁边都放可运行 demo 链接；没有 demo 的技术不写进首页。

### 4.5 目标人群（按优先级）

1. **做数字人、虚拟形象、角色展示的 Web 开发者**：需要皮肤、眼睛、头发，three.js 生态里只能自己写。转化入口：头部 demo + `material-skin` / `material-hair` 文档。
2. **做海岸、户外、数字孪生、文旅展示的开发者**：需要海洋和地形。转化入口：海岸 demo + `water` / `terrain-runtime` 文档。
3. **图形程序员与学习者**：读源码学完整引擎怎么搭。转化入口：技术长文 + 源码链接。这群人带来 star 和传播，不一定是使用者。

## 5. 推广实施方案

按已定顺序：叙事 → create 模板 / StackBlitz → 旗舰 demo → 1.0 并同步推广。下面把每步拆成可验收的任务。周期按单人维护估算，假设每周投入推广相关工作约 1 天。

### 阶段一：转化资产（2026-11，约 4 周）

先修"有人来了却留不住"的问题，此阶段不做任何主动曝光。

| 任务 | 验收标准 |
| --- | --- |
| 把 develop 发到 npm（0.9.28 或 0.10） | npm 上的版本包含云、岸浪、泡沫等近两个月功能 |
| 合并工作区里未提交的 README / package.json / 主页叙事改动 | main 与主页首屏文案一致 |
| `npm create zephyr3d` 模板 + StackBlitz 链接 | 新用户 2 分钟内在浏览器里看到可旋转的场景 |
| 重排 demos 页 | 首屏是角色和自然环境 demo；RenderGraph 样例移到"开发者示例"子页；补上头发、眼睛 demo |
| 每个旗舰技术的文档页顶部加 demo 链接与论文出处 | `material-skin`、`material-hair`、`material-eye`、`water`、`terrain-runtime` 五页完成 |
| 修正已知过时文档 | `scene-basic.md` 中 backendWebGL 的说法等 |

### 阶段二：旗舰 demo（2026-12 至 2027-01，约 6-8 周）

| Demo | 内容 | 要求 |
| --- | --- | --- |
| 数字人头部 | 皮肤 SSS 与透射、眼睛、发丝头发、可旋转灯光 | 打开即交互；面板可切换各层效果对照；显示帧时间与 GPU 信息 |
| 海岸 | FFT 海洋、岸浪与泡沫、地形与草、体积云、大气、浮力物体 | 可拖动太阳与风向；可点击投放漂浮物 |

两个 demo 都提供"在编辑器中打开"按钮，并录制 30 秒和 2 分钟两个视频版本（YouTube / B 站）。资产必须有可再分发的授权；头部模型如用 MetaHuman 衍生物，需先确认 Epic 授权条款允许 Web 公开展示，否则改用自有头模。

### 阶段三：1.0 集中发布（时间由 API 冻结决定）

1.0 前置条件：核心 API 清单与弃用策略写入文档；两个旗舰 demo 上线；create 模板可用。

发布周内容包：

| 渠道 | 内容 | 形式 |
| --- | --- | --- |
| Hacker News | Show HN：标题讲旗舰 demo，链接直达 demo | 发布日当天本人在线回复评论 |
| Reddit r/webgpu、r/GraphicsProgramming、r/webdev | 头部 demo 视频 + 技术说明 | 各发一次，内容按版块调整 |
| X / Bluesky / Mastodon | 30 秒视频 + demo 链接 | 标注 #WebGPU，提及 WebGPU 相关作者前先私信确认 |
| 掘金、知乎、B 站 | 中文长文 + 2 分钟视频 | 与英文同日 |
| WebGPU 相关通讯与列表 | 提交到 webgpu.com、Awesome WebGPU 等列表 | 发布后一周内 |
| GitHub Release | 完整 release note + 视频 | 发布日 |

### 阶段四：持续技术内容（1.0 后，每周一篇）

每篇固定结构：问题 → 画面 → 论文出处与原理 → 可运行 demo → 源码位置。首批题目：

1. Strand hair on WebGPU: expansion, shading and simulation
2. Skin in the browser: Burley diffusion and transmission
3. Shorelines: breaking waves, foam fields and swash
4. Clipmap terrain with virtual texturing and GPU grass
5. Volumetric clouds with an octahedral sky cache
6. One TypeScript source for WGSL and GLSL (讲做法，不和 three.js 比较)

长文发在文档站博客，同步到 dev.to / 掘金 / 知乎。这类内容是唯一能带来持续搜索流量的资产，当前搜索来源接近 0。

### 阶段五：探针 GI 进 1.x（第二波发布）

探针 GI 上线后，叙事增加"室内与动态全局光照"，§3.3 的 GI 空缺移除，再做一次与阶段三同规模的发布。在此之前，所有材料保留"暂无烘焙或探针 GI"的说明。

## 6. 不做的事

- 不投付费广告。转化漏斗没有数据前投放无法评估。
- 不做 Scene Jam、创作者计划、插件市场等需要持续运营的社区活动，单人维护撑不住；star 过 1,000 或出现第二位长期贡献者后再评估。
- 不做 Gaussian Splatting、XR 来追平竞品清单，这会稀释叙事。
- 不把 AI / MCP 编辑器作为宣传卖点，只在编辑器特性里列出。

## 7. 指标

现有基线和 6 个月目标（目标为估计值，用于判断方向，不是承诺）：

| 指标 | 基线（2026-10） | 1.0 发布后 3 个月 | 数据来源 |
| --- | --- | --- | --- |
| GitHub stars | 141 | 1,000 | GitHub |
| 仓库 14 天独立访客 | 63 | 1,500 | GitHub Traffic |
| `@zephyr3d/scene` 月下载 | 787 | 5,000 | npm API |
| 外部 Discussions / Issues | 5 / 5 | 每月 15 条以上 | GitHub |
| 搜索来源访客 | 约 2 / 14 天 | 每 14 天 100 | GitHub Traffic、站点统计 |

每月第一周记录一次上表，存到 `docs/marketing/metrics.md`。数据需在 GitHub Traffic 的 14 天窗口内采集，过期无法补。

## 8. 风险

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 单人维护，曝光后 issue 和问题激增 | 响应变慢，口碑变差 | README 写明响应预期；发布周前清空已知 bug；Discussions 设 FAQ 置顶 |
| 旗舰 demo 在部分 GPU 上崩溃或很慢 | HN 首评就是"在我电脑上跑不动" | 发布前用集成显卡与 Mac 各测一次；demo 内自动降档并显示 WebGL2 回退提示 |
| 竞品发布同类功能（如 three.js 加头发示例） | 区别缩小 | 叙事落在"完整系统 + 编辑器可调"，不落在"独有" |
| 资产授权问题 | demo 被迫下线 | 阶段二开始前确认所有模型、贴图、HDR 的授权 |

## 9. 本周可开始的事

1. 合并工作区里的叙事改动并发布 develop 到 npm。
2. 重排 demos 页，补头发与眼睛 demo。
3. 开始 create 模板。
4. 建 `docs/marketing/metrics.md`，记下 §2 的基线。

## 附：数据来源

- GitHub API：各仓库 `stargazerCount`、目录树（three.js `dev` 分支 examples，Babylon.js `master`，PlayCanvas engine `main`），2026-10-31。
- npm：`api.npmjs.org/downloads/point/last-month/<pkg>` 与 `npm view <pkg> version`，2026-10-31。
- Zephyr3D：`git log`、GitHub Traffic API、`apps/homepage/en/*.html`。
- "竞品未找到发丝头发"基于仓库文件路径搜索 hair / strand / marschner，可能遗漏第三方扩展。
