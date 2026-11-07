# 实时预览

Zephyr3D 编辑器提供实时预览功能，用于在浏览器中运行当前项目，查看脚本逻辑与动画效果的实际运行状态。

---

## 预览功能说明

- **所有脚本逻辑**（如 TypeScript 脚本中的游戏逻辑、交互逻辑等）
- **所有动画逻辑**（包括关键帧动画、骨骼动画、顶点动画等）

仅在**预览运行时**才会执行并可见：

- 在编辑器静态状态下，这些逻辑**不会被执行**；
- 场景中的脚本行为、动画播放、交互响应等，都需要通过预览来验证。

换言之：**要检查“实际运行效果”，必须通过实时预览。**

---

## 预览前的项目设置

在启动预览之前，需要先配置项目的基本运行参数。  
项目设置面板中主要包含以下选项：

### 1. Title（应用标题）

- 用途：设置运行时网页窗口的标题。
- 默认值：当前项目名称。
- 建议：
  - 可填写产品名 / Demo 名称 / 内部版本标识，例如：`Zephyr3D Terrain Demo`。

### 2. Favicon（页面图标）

- 用途：设置浏览器标签页左侧显示的小图标。
- 是否必填：**否（可选）**。
- 说明：
  - 若未配置，将使用浏览器默认图标或系统预设图标；
  - 建议使用方形 PNG/ICO/SVG 图标资源。

### 3. Splash Screen / Splash Background（加载画面）

- 用途：设置应用启动期间显示的加载画面。
- `Splash Screen`：是否显示引擎自带的加载画面，**默认开启**。
- `Splash Background`：加载画面的底色（默认黑色），只在开启 `Splash Screen` 时可设置。
- 说明：
  - 加载画面由网页本身绘制，打开页面即显示，内容是引擎 Logo、进度条和一行状态文字。它覆盖下载引擎、创建渲染设备、预编译管线、预取资源、执行启动脚本和加载启动场景的全过程，直到启动场景的第一帧画面出现后淡出；
  - 进度条按阶段推进：录制过管线时先编译管线（见[构建与部署](zh-cn/editor/build-deploy.md)），再预取启动场景用到的资源，最后加载场景；
  - 启动失败时（例如浏览器不支持所选的渲染后端），加载画面不会消失，而是显示错误信息；
  - 关闭 `Splash Screen` 后不再显示加载画面，页面在启动期间只有黑色背景。需要完全自定义的加载画面时，可以关闭它，自己实现 `LoadingScreen` 协议。

### 4. Startup Scene（启动场景）

- 用途：指定应用启动时首先加载并运行的场景。
- 与 Startup Script 的关系：**与 Startup Script 二者必须至少填写其一**。
- 说明：
  - 当仅设置了启动场景而未设置启动脚本时，应用将在加载该场景后直接进入该场景；
  - 通常适用于以场景为主导的静态/半静态 Demo、关卡展示等。

### 5. Startup Script（启动脚本）

- 用途：指定应用启动时首先执行的脚本入口。
- 与 Startup Scene 的关系：**与 Startup Scene 二者必须至少填写其一**。

#### Startup Script 与 Startup Scene 的优先级与执行顺序

- 当 **Startup Script 和 Startup Scene 同时填写** 时：
  1. 应用启动后，**首先执行 Startup Script**；
  2. Startup Script 对应脚本的 `onCreated` 与 `onAttached` 生命周期回调会**先后被完整执行**；
  3. 仅当上述回调全部执行完毕后，才会去加载 `Startup Scene`；
  4. 在 `Startup Scene` 加载完成后：
     - 绑定到 `Startup Scene` 的脚本（作为场景节点的**绑定脚本**）会按正常生命周期执行；
     - 你可以将场景内的行为逻辑拆分到这些绑定脚本中，与 Startup Script 配合使用。

- 当 **只填写 Startup Script、不填写 Startup Scene** 时：
  - 引擎不会自动加载任何场景；
  - 你可以在 Startup Script 内 **手动加载场景**，例如：
    - 按条件决定加载哪个场景；
    - 分步骤加载多个场景（主场景 + 叠加 UI 场景等）；
    - 实现更灵活的启动流程控制。

> **约束规则：**
>
> - `Startup Scene` 和 `Startup Script` **必须至少配置一个**；
> - 若两者都配置，**Startup Script 拥有更高优先级**：其 `onCreated` / `onAttached` 完成之后才会加载 `Startup Scene`；
> - 启动后与 `Startup Scene` 绑定的脚本可以作为场景逻辑脚本使用，也可完全依赖 `Startup Script` 中的手动场景加载与控制逻辑。

### 6. Targeted RHIs（目标渲染后端）

- 用途：指定运行时可选的渲染后端（RHI, Rendering Hardware Interface）。
- 可选项（多选）：
  - `WebGL2`
  - `WebGPU`
- 启动时的选择逻辑：
  - 应用启动时，会在你**勾选的选项中**，按以下优先级顺序查找可用的渲染后端：
    1. WebGPU
    2. WebGL2
  - 一旦在当前浏览器/设备环境中找到第一个可用且被勾选的后端，即使用该后端运行应用。
- 示例：
  - 若勾选了 `WebGL2` 和 `WebGPU`：
    - 在支持 `WebGPU` 的浏览器上，将优先使用 WebGPU；
    - 在仅支持 `WebGL2` 的浏览器上，将退回使用 WebGL2。
  - 若只勾选了 `WebGL2`：
    - 即使环境支持 WebGPU，也只会使用 WebGL2。

### 7. 其他设置

| 设置 | 作用 |
| --- | --- |
| `Enable MSAA` | 开启多重采样抗锯齿 |
| `Render Scale` | 渲染分辨率相对页面分辨率的比例，调低可以换取性能 |
| `Precompile Recorded Pipelines` | 启动时预编译录制下来的渲染管线，见[构建与部署](zh-cn/editor/build-deploy.md) |
| `Morph Target Limit` / `Active Morph Upload Limit` | 单个网格的 Morph Target 上限，以及同时生效的 Morph Target 上限 |
| `Max Skin Influences` | 每个顶点最多受几根骨骼影响 |
| `Additional packages` | 项目额外依赖的 npm 包 |

---

## 启动实时预览

完成项目设置后，可以通过工具栏右侧的三个运行按钮启动预览，它们都会在**新的浏览器标签页**中打开运行页面：

| 按钮 | 作用 |
| --- | --- |
| **Play**（播放图标） | 按项目设置中的 `Startup Scene` / `Startup Script` 运行整个项目，与发布后的启动方式相同。运行的是**已保存**的文件，未保存的修改不会生效 |
| **Preview**（眼睛图标） | 只运行当前场景，会先要求保存当前场景 |
| **Record Pipelines**（摄像机图标） | 与 Play 相同，同时录制运行中用到的渲染管线，供构建时预编译。只读项目不能录制。见[构建与部署](zh-cn/editor/build-deploy.md) |

在打开的页面中，所有脚本逻辑开始执行、所有关联动画进入实际运行状态，你可以进行交互操作、观察运行表现、调试逻辑与动画效果。

> **提示：**
>
> - 预览窗口打开期间，编辑器视口会暂停渲染，把 GPU 留给预览页面；关闭预览后恢复。
> - 若修改了脚本、动画或项目设置，需要保存后重新运行预览。
> - 项目设置在主菜单 `Project > Project Settings...` 中。

---

以下视频演示中，我们在场景中添加了一个立方体并给他添加了一个自动播放的绕Y轴旋转的动画，然后保存为启动场景并进行预览：

<video src="https://cdn.zephyr3d.org/doc/assets/videos/play-project.mp4" controls width="640">
  Your browser does not support the video tag.
</video>

