# 安装

Zephyr3d 以 ES6 模块形式发布，通过 npm 安装，配合 Vite、Webpack 等前端构建工具使用。

## 我需要装哪几个包

引擎按功能拆成了多个包，不必全装。先按下面的场景对号入座：

| 你要做的事 | 需要安装 |
| --- | --- |
| 用 Scene API 做 3D 应用（**最常见**） | `@zephyr3d/base` + `@zephyr3d/scene` + 一个后端包 |
| 只用 Device API 自研渲染框架 | `@zephyr3d/base` + `@zephyr3d/device` + 一个后端包 |
| 运行时直接加载 glTF/FBX 等源模型 | 再加 `@zephyr3d/loaders` |
| 需要调试用的 GUI 面板 | 再加 `@zephyr3d/imgui` |

后端包至少要装一个，决定引擎跑在什么图形 API 上：

- `@zephyr3d/backend-webgl` —— 提供 WebGL 和 WebGL2 两个后端，兼容性最好。
- `@zephyr3d/backend-webgpu` —— WebGPU 后端，性能更好，部分高级特性（如 ABuffer OIT、
  计算着色器）只在这里可用。

两个后端可以同时装，运行时按设备能力选择，参见[第一个应用](zh-cn/first-app.md)。

## 最常见的组合

做 3D 应用、并希望同时支持 WebGPU 和 WebGL：

```bash
npm install --save @zephyr3d/base @zephyr3d/scene @zephyr3d/backend-webgl @zephyr3d/backend-webgpu
```

注意 `@zephyr3d/scene` 依赖 `@zephyr3d/device`，包管理器会自动装上，你不需要显式声明。

## 各个包的作用

- **`@zephyr3d/base`**

  基础模块：数学库（`Vector3`、`Matrix4x4`、`Quaternion` 等）、虚拟文件系统、事件、
  引用计数。几乎所有项目都会用到。

- **`@zephyr3d/device`**

  底层图形 API 的抽象接口与 shader 生成器。用 Scene API 时它是间接依赖；
  要自己写渲染管线才需要直接依赖它。

- **`@zephyr3d/backend-webgl`** / **`@zephyr3d/backend-webgpu`**

  具体的后端实现，见上。

- **`@zephyr3d/scene`**

  Scene API：场景图、材质、光照、阴影、动画、后处理、资源管理。上层渲染框架，
  适合快速开发。

- **`@zephyr3d/loaders`**

  glTF/GLB、FBX、Alembic 等源模型格式的导入器。**如果走编辑器工作流、用预制体
  （`.zprefab`）加载模型，则不需要这个包**——这样也能让最终产物体积更小，
  取舍见[资源加载与模型导入](zh-cn/asset-loading.md)。

- **`@zephyr3d/imgui`**

  ImGui 绑定，适合做调试面板和工具界面。

## 下一步

装好以后就可以[写第一个应用](zh-cn/first-app.md)了。
