# visual-test 基线改为"摘要入库、图片外置"

状态：阶段 0-4 已实施（PR #34），阶段 5 按决定不做
范围：`visual-test/` 的基线存储与比对流程。场景、捕获、确定性机制不变。

---

## 1. 动机

### 1.1 现状

| 项 | 数值 |
|---|---|
| 入库基线 | 183 张（`webgl2-swiftshader` + `webgpu-swiftshader`，各 reverse 一种约定） |
| 单张 | 512×512 RGBA PNG，平均约 100 KB，最大约 540 KB |
| 工作区占用 | 约 18 MB |
| 历史中的基线 blob | 403 个，约 64 MB（2026-08-14 首次入库，至今不足两个月） |
| 整仓 pack | 约 275 MB |

### 1.2 问题

用例数是 visual-test 当前最大的短板（约 100 个场景覆盖了几十项渲染特性），但按现有方式扩展到上千用例不可行：

- 1000 场景 × 2 后端 × 约 100 KB ≈ **200 MB 工作区**；
- 每次全局重刷基线（升级 Playwright/Chromium/SwiftShader、改动共享着色或默认参数）**历史再增加约 200 MB**，且永久保留；
- 两个月已积累 64 MB 历史，增长主要来自重刷而不是新增。

压缩单张图只能降低斜率，不能消除"历史无限增长"。根因是**图片进了主仓库的历史**。

### 1.3 目标

1. 主仓库的基线数据随用例数**线性、小常数**增长（每用例百字节量级），重刷基线时历史增量同样只有百字节量级。
2. 判定语义不变：严格默认容忍度、按场景覆盖的 `tolerance`、缺基线即失败、`UPDATE_BASELINES=1` 显式接受。
3. 失败时仍能看到 expected/actual/diff 三张图。
4. 图片存储可以随时压缩历史或垃圾回收，**丢失图片只会降低诊断能力，不会影响判定**。

### 1.4 非目标

- 不改变场景定义、捕获流程、确定性机制（`setFixedFrameTime`、`stepFrame`、帧计数回绕）。
- `*-gpu` 项目维持现状（本机 PNG、git-ignored、不卡 CI）。
- 冒烟档用例（批量接入 tutorial/demo）不在本设计内实现，只在第 8 节预留接口。

---

## 2. 参考

Chromium/Skia 的 **Skia Gold** 是同类问题的工业方案：仓库与测试只认像素摘要（digest），图片存放在外部存储；每个测试可有多个被接受的摘要；未知摘要进入人工分拣。本设计取其核心——"摘要判定 + 外置图片 + 多正例"，去掉分拣服务，用本地命令和一个独立 git 仓库代替。

---

## 3. 总体结构

```
主仓库 zephyr3d
└── visual-test/
    ├── digests/
    │   ├── webgl2-swiftshader.reverse.json   ← 入库：场景 → 可接受摘要
    │   └── webgpu-swiftshader.reverse.json
    ├── .baseline-cache/                      ← git-ignored：按摘要缓存的图片
    └── baselines/*-gpu/                      ← git-ignored：不变

外部仓库 zephyr3d-visual-baselines（孤儿分支 images，可随时压缩历史）
└── ab/abcdef0123….png                        ← 按内容寻址
```

- **判定只依赖 `digests/*.json`**，它是唯一真相。
- **图片只用于**：容忍度比较（摘要未命中时）、生成 diff、人工检视。

---

## 4. 摘要

### 4.1 计算对象

对捕获后、经 `normalizeRowOrder` 归一化的**原始 RGBA 像素缓冲**计算，而不是对 PNG 文件计算——PNG 编码结果依赖编码器版本与压缩参数，同一像素可得到不同字节。

```
digest = sha256( "zvt1" ‖ u32le(width) ‖ u32le(height) ‖ rgba ).hex 前 32 位
```

- 前缀 `zvt1` 是格式版本，将来改变哈希输入时整体失效而不是误命中。
- 宽高进入哈希，尺寸变化必然不命中，替代现有的 `size-mismatch` 分支。
- 截断到 128 位：碰撞概率可忽略，文件更短。

### 4.2 摘要文件格式

每个"项目 × 约定"一个文件，避免单文件合并冲突集中：

```json
{
  "format": 1,
  "environments": {
    "linux-x64": { "playwright": "1.62.1", "chromium": "…", "adapter": "SwiftShader …" },
    "win32-x64": { "playwright": "1.62.1", "chromium": "…", "adapter": "SwiftShader …" }
  },
  "scenes": {
    "shadow-pcf": {
      "size": 512,
      "accepted": {
        "linux-x64": ["3f9c…"],
        "win32-x64": ["a017…"]
      }
    }
  }
}
```

- **按平台分别记录**（已定，见第 11 节）。平台键取 `${process.platform}-${process.arch}`。各平台的摘要互不影响：在 Windows 上接受基线只改 `win32-x64`，Linux 的摘要不动。
- 两个平台输出相同时，各自记录的是同一个摘要，图片在外部仓库里只存一份（内容寻址天然去重）。
- `scenes` 与各层的键按字母排序写出，保证 diff 稳定、合并冲突最小。
- 每个平台下的 `accepted[0]` 是该平台的**主摘要**，容忍度比较以它对应的图片为参考。其余是额外正例，用于确有多个合法输出的场景（见 5.3），默认只有一个。
- `environments` 记录各平台生成时的环境指纹，只用于诊断提示（见 7.2），不参与判定。
- **CI 平台（`linux-x64`）是权威**。其他平台的摘要供开发者本机使用，缺失时按 5.4 处理，不阻塞 CI。

---

## 5. 判定流程

```
capture → digest d
  │
  ├─ 场景不在摘要文件中 ──────────────→ 失败 baseline-missing（同现状，附 actual.png）
  │
  ├─ 当前平台没有该场景的摘要 ────────→ 见 5.4（以 CI 平台的主摘要作参考做容忍度比较）
  │
  ├─ d ∈ accepted[当前平台] ──────────→ 通过（不读取任何图片）
  │
  └─ d ∉ accepted[当前平台]
        │
        ├─ 取得 accepted[当前平台][0] 的图片（本地缓存 → 外部仓库）
        │     └─ 取不到 ────────────→ 失败 reference-unavailable（附 actual.png，
        │                               提示运行 baselines:fetch 或检查外部仓库）
        │
        └─ pixelmatch(参考图, 捕获, 场景容忍度)
              ├─ 在容忍度内 ─────────→ 通过，标注 tolerant-match（报告中可见）
              └─ 超出容忍度 ─────────→ 失败 mismatch（附 expected/actual/diff）
```

### 5.1 与现状的语义对照

| 现状 | 新流程 |
|---|---|
| 每次都做 pixelmatch | 摘要命中时跳过；只有未命中才比较 |
| `size-mismatch` | 宽高进入摘要，必不命中，再由比较报尺寸不一致 |
| `baseline-missing` 即失败 | 不变 |
| 容忍度内即通过 | 不变，额外标注 tolerant-match |

因此**任何现在通过的结果在新流程下仍然通过，任何现在失败的结果仍然失败**；区别只在性能和存储位置。迁移的正确性就靠这一点检验（见第 9 节阶段 2）。

### 5.2 `UPDATE_BASELINES=1`

| 情况 | 行为 |
|---|---|
| 场景缺失 | 写入 `accepted[当前平台] = [d]`，图片放入本地缓存并标记待上传 |
| 当前平台无摘要 | 写入 `accepted[当前平台] = [d]`（首次为本平台建立摘要） |
| 摘要命中 | 不变 |
| tolerant-match | **不变**，保留原主摘要（与现状一致：容忍度内不重写基线） |
| mismatch | `accepted[当前平台] = [d]`（替换，不追加），图片放入缓存并标记待上传 |

更新只改当前平台的条目，不访问网络。

**改动渲染行为时，所有平台的摘要都会失效**。在本机重刷后，`linux-x64` 那一列仍是旧值，CI 会报 mismatch。处理办法有两种：
- 在 Linux（或 WSL、容器）上也跑一次 `test:update`；
- 或使用 `baselines:update-from-ci`：从失败 CI 运行的 artifact 里取回 Linux 的捕获结果，写入 `linux-x64` 条目（见 6.2）。

这是"按平台记录"的代价，也是 `--update-from-ci` 必须做成一等公民的原因：开发者不应被迫装一套 Linux 环境才能接受基线。上传由单独命令完成（6.2），使"接受基线"与"发布图片"两个动作都显式。

### 5.3 多正例

只通过显式命令追加：`npm run baselines:accept -- <scene> --project <p> --append`。用途限于确实存在多个合法输出、且原因已写进场景文件注释的情况。数量上限为 4，超过则报错——多正例过多说明场景不确定，应修场景而不是扩名单。

### 5.4 当前平台缺摘要

开发者本机的平台可能没有记录（新平台，或者别人改动后只更新了 CI 平台）。此时：

1. 以 CI 平台（`linux-x64`）的主摘要对应的图片为参考，按场景容忍度比较；
2. 在容忍度内报 `tolerant-match (no <platform> digest)`，超出报 mismatch；
3. 报告头部汇总"本平台缺 N 个摘要，可运行 `UPDATE_BASELINES=1` 在本机建立"。

这样新平台第一次运行时就能用，不需要先手工建立基线；判定也和现状完全一致（现状就是跨平台按容忍度比较）。

---

## 6. 外部图片仓库

### 6.1 选型

| 方案 | 结论 |
|---|---|
| **独立 GitHub 仓库 + 孤儿分支** | **采用**。零成本、复用现有权限；公开仓库可直接按 raw URL 下载单图，无需 git |
| Git LFS | 否。只是把 blob 挪出 pack，LFS 存储与带宽额度照样增长，历史版本难以清理 |
| Releases / CI artifact | 否。不适合数千个小文件，保留期有限 |
| 对象存储（S3/R2/OSS） | 备选。需要凭据；接口抽象为 `ImageStore`，以后可替换 |

仓库：`gavinyork/zephyr3d-visual-baselines`（**公开**，已定），分支 `images`，布局 `<前2位>/<digest>.png`（避免单目录过多文件）。

### 6.2 命令

在 `visual-test/package.json` 新增：

| 命令 | 作用 |
|---|---|
| `baselines:fetch` | 下载所有摘要文件引用、本地缓存缺失的图片 |
| `baselines:push` | 上传本地缓存中被引用但外部仓库缺失的图片，提交并推送外部仓库 |
| `baselines:check` | 校验每个被引用的摘要在外部仓库都有图片；CI 跑，失败即报错 |
| `baselines:gc` | 外部仓库只保留"保留集"引用的图片，压缩为单个提交后强推 |
| `baselines:accept` | 手动追加或替换某场景的摘要（5.3） |
| `baselines:update-from-ci` | 下载指定 CI 运行的 artifact，把其中 Linux 捕获的摘要写入 `linux-x64` 条目，图片放入缓存待上传（5.2） |

下载走 `https://raw.githubusercontent.com/<repo>/images/<path>`，仓库公开，**CI 和任何人都无需凭据**；上传与 gc 需要 git 和推送权限，用 `.baseline-cache/store/` 下的浅 clone 完成。

### 6.3 发布顺序与一致性

接受新基线的完整流程：

```bash
UPDATE_BASELINES=1 npm run test      # 改 digests/*.json，图片进本地缓存
# 检视 .baseline-cache 中新写入的图片（命令会打印路径）
npm run baselines:push               # 先发布图片
git add visual-test/digests && git commit
```

即使忘了 push，**判定也不受影响**（命中摘要即通过，不需要图片）。受影响的只是：别人遇到 tolerant 比较或失败时拿不到参考图。`baselines:check` 在 CI 中兜底，让这种情况在合并前暴露，而不是等到某次失败时才发现。

为支持 `update-from-ci`，CI 失败时上传的 artifact（现有的 `test-results`）需要包含每个失败场景的 `actual.png` 和一份 `captures.json`（场景 → 摘要 → 图片路径）。

### 6.4 垃圾回收

保留集 = `develop`、`main` 以及所有 release tag 上 `digests/*.json` 引用的摘要的并集。`baselines:gc` 删除不在保留集中的图片，把 `images` 分支压缩成一个孤儿提交后强推。

切到更老的提交时，图片可能已被回收：此时摘要判定照常工作，只有需要参考图时报 `reference-unavailable`，可用该提交重新生成。这正是"丢失图片只降低诊断能力"的含义。

建议频率：每次全局重刷基线后跑一次，或按月跑。

---

## 7. 确定性与环境

### 7.1 摘要比图片更依赖环境

现状靠容忍度 0.02 吸收了最低有效位的抖动，所以即使本机与 CI 的输出有微小差别也可能全部通过。摘要要求逐字节一致，环境差异会全部表现为"未命中 → 走容忍度比较"。判定结果不变（5.1），但性能优势会消失，并且每次都要下载参考图。

因此需要：

1. **固定 Playwright 精确版本**。`package.json` 目前是 `~1.62.1`，允许补丁升级，等于允许 Chromium 和 SwiftShader 悄悄变化。改为 `1.62.1`。
2. **以 CI 平台为准**。CI 跑在 `ubuntu-latest`；摘要以 Linux 输出为准生成。

### 7.2 环境指纹

运行时把当前环境与摘要文件里**当前平台**的 `environments` 条目比较（例如同为 linux-x64，但 Chromium 版本不同）。不一致时在报告头部打一条醒目提示，例如"摘要生成于 linux-x64 / Chromium X，当前为 win32-x64 / Chromium Y，预计大量 tolerant-match"，避免有人把环境差异误判为渲染回归。

### 7.3 阶段 0 测量结果（2026-10-05）

环境：Playwright 1.62.1（Chromium 151），Windows 11 本机与 WSL2 Ubuntu 22.04，各跑完整 SwiftShader 套件两次（webgl2 79 个场景、webgpu 104 个场景，其余因后端不支持跳过）。

| 比较 | webgl2 | webgpu |
|---|---|---|
| 修复前，Windows 两次运行 | **8 个场景摘要不同** | **9 个场景摘要不同** |
| 修复后，Windows 两次运行 | 0 | 1（`oit-abuffer`） |
| 修复后，Linux 两次运行 | 0 | 0 |
| 修复后，Linux 对 Windows | 0 | 1（`oit-abuffer`） |

**结论**

1. **README 中"软件光栅逐次可复现"的说法此前并不成立**。`pbr-ibl` 与所有水体场景每次运行都不同（水体最多 85k 像素差 1/255，`pbr-ibl` 最多 6/255），一直靠 0.02 的容忍度掩盖。根因：`CubemapSHProjector` 用 `Math.random()` 生成 10 000 个采样方向，天空光照的 SH 每次页面加载都不同。已改为固定种子的 `PRNG`，修复后上述场景逐字节稳定。
2. **Windows 与 Linux 的 SwiftShader 输出逐字节一致**（`oit-abuffer` 除外）。按平台分组的格式仍保留，但目前各平台会记录相同的摘要，重刷基线在任一平台做一次即可，`update-from-ci` 只在将来出现平台分歧时才需要。
3. **`oit-abuffer`（WebGPU）在 Windows 上不确定**：每次 2 个孤立像素变化，最大 43/255；Linux 上两次一致但与 Windows 不同。尝试按颜色给等深度片元定序未能消除，已回退；原因待查（怀疑分片渲染或节点写入的竞争）。处理：场景增加 `deterministic: false` 标记，跳过摘要判定、始终走容忍度比较，并在报告中单列。
4. ~~残余风险：GitHub runner 的 CPU 与本机不同~~ **已排除**（阶段 3，PR #34）：GitHub `ubuntu-latest` 上两次运行，第一次只有 `oit-abuffer` 未命中摘要（容忍度内通过），第二次 185 个场景**全部命中**、未产生任何 captures。CI 输出与本机 WSL / Windows 逐字节一致。

---

## 8. 为扩展用例预留

本设计不实现，只保证不挡路：

- **用例分档**：`VisualScene` 增加 `tier: 'precision' | 'smoke'`。精度档保持 512 与严格容忍度；冒烟档（批量接入的 tutorial/demo）用 256 或 128 分辨率、较宽容忍度，主要拦截黑屏、整屏错误、报错。冒烟档的图片小一个数量级，外部仓库压力随之降低。
- **摘要文件按档拆分**（如 `webgpu-swiftshader.reverse.smoke.json`），批量重刷冒烟档不会和精度档的改动混在同一个 diff 里。
- **CI 缓存**：`.baseline-cache` 用 `actions/cache` 缓存，键取 `digests/*.json` 的哈希。摘要不变时零下载。

---

## 9. 实施阶段

| 阶段 | 内容 | 验收 |
|---|---|---|
| 0 | ~~测量~~ **已完成**，见 7.3；顺带修复天空 SH 采样的随机性 | 一致性表见 7.3 |
| 1 | `compare.ts` 增加摘要计算与两层判定（含按平台分组与 5.4 回退）；`ImageStore` 抽象 + 本地缓存实现；摘要文件读写 | 单元级测试覆盖第 5 节每条路径 |
| 2 | 迁移：**用当前构建重新捕获**生成 `digests/*.json`（SH 修复后有 17 个场景的输出已不同于入库 PNG，但都在原容忍度内），并逐场景确认新捕获与旧 PNG 在原容忍度内一致；图片按摘要写入外部仓库 | 新旧流程对同一构建逐场景给出相同的通过/失败结果；故意引入 `sensitivity.mjs` 的条目，两边失败集合一致 |
| 3 | **已完成**。命令：`fetch` / `push` / `check` / `gc` / `accept` / `update-from-ci`；CI 增加 `baselines:check`、缓存、`visual-captures` artifact（每场景一对 json+png，取代原计划的单个 `captures.json`） | CI 绿；故意漏 push 时 `check` 报错；在 Windows 上改动渲染后能用 `update-from-ci` 补齐 Linux 摘要 |
| 4 | **已完成**。删除 `baselines/*-swiftshader/`（183 张、约 18 MB）；README 改写"Baselines"一节；固定 Playwright 版本（阶段 3 已做） | 文档与流程一致 |
| ~~5~~ | ~~主仓库历史瘦身（`git filter-repo` 移除历史中约 64 MB 基线 PNG）~~ | **暂不做**（已定）。阶段 4 之后历史不再增长，已有的 64 MB 留着 |

阶段 1-4 在一个功能分支内完成。

---

## 10. 风险与取舍

| 风险 | 影响 | 应对 |
|---|---|---|
| 平台间输出不一致 | 每次渲染改动要为每个平台各接受一次基线 | 按平台记录摘要；`update-from-ci` 让开发者无需 Linux 环境即可补齐 CI 平台 |
| 本机平台缺摘要 | 本机全走 tolerant 路径，变慢并需下载 | 5.4 回退保证可用；一次 `test:update` 即可建立本机摘要 |
| 忘记 `baselines:push` | 他人失败时看不到参考图 | 判定不受影响；CI 的 `baselines:check` 在合并前拦截 |
| 外部仓库丢失或被误 gc | 历史提交的参考图不可用 | 判定不受影响；可由对应提交重新生成 |
| tolerant-match 长期掩盖细微漂移 | 主摘要一直不命中，等于退回现状 | 报告中单列 tolerant-match 计数；计数持续非零时提示重刷 |
| 多正例被滥用 | 场景名义上严格、实际放水 | 只能显式命令追加，上限 4，要求场景内注明原因 |
| 引入第二个仓库 | 流程多一步、需要推送权限 | 判定路径不需要权限；只有接受基线的人需要 |

---

## 11. 已定决策（2026-10-05）

1. **外部图片仓库公开**。下载走 raw URL，CI 与任何人都无需凭据；只有接受基线的人需要推送权限。
2. **平台输出不一致时按平台分别记录摘要**。格式从一开始就按平台分组（4.2），阶段 0 的结论只决定工作量，不决定格式；配套 5.4 的缺摘要回退与 `update-from-ci`。
3. **暂不改写主仓库历史**（原阶段 5）。阶段 4 之后不再新增 PNG，已有约 64 MB 历史保留。
