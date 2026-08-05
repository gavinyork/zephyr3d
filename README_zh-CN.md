<!-- hy-mt2-i18n:start -->
[English](./README.md) | **中文** | [日本語](./README_ja.md) | [Español](./README_es.md)
<!-- hy-mt2-i18n:end -->



<div align="center">

  ![](https://cdn.zephyr3d.org/doc/assets/images/logo_theme.svg)

> 一款基于现代 TypeScript 的 WebGL 与 WebGPU 渲染引擎

[用户手册](https://zephyr3d.org/doc/) &nbsp;|&nbsp; [演示案例](https://zephyr3d.org/en/demos.html) &nbsp;|&nbsp; [在线编辑器](https://zephyr3d.org/editor/)

[![CI](https://github.com/gavinyork/zephyr3d/actions/workflows/ci.yml/badge.svg)](https://github.com/gavinyork/zephyr3d/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@zephyr3d/scene?color=%235865f2)](https://www.npmjs.com/package/@zephyr3d/scene)
[![License: MIT](https://img.shields.io/badge/license-MIT-blueviolet.svg)](https://opensource.org/licenses/MIT)

</div>

## 概述

**Zephyr3D** 是一款基于 TypeScript 的网页 3D 渲染引擎，具备以下特点：

- 统一的 WebGL/WebGPU 后端
- 代码生成的着色器系统（JS/TS → GLSL/WGSL）
- 完整的基于网页的可视化编辑器。

> 轻量级 · 模块化 · 开发者友好 · 以代码赋能视觉创作。

## 概览

**Zephyr3D** 是一款基于 TypeScript 的网页 3D 渲染引擎，具备

 - 统一的 WebGL/WebGPU 后端  
- 基于代码生成的着色器系统（JS/TS → GLSL/WGSL）  
- 以及完整的基于网页的可视化编辑器。

轻量级 · 模块化 · 开发者友好 · 以代码赋能视觉创作。

## 核心功能

- **统一的 WebGL / WebGPU 后端（RHI）**  
  单一渲染抽象层，支持多种后端。无需重写场景代码即可在这三种格式之间切换。

## 核心特性

- **统一的 WebGL/WebGPU 后端（RHI）**  
  单一渲染抽象层，多种后端支持。无需重写场景代码即可在这三种渲染技术之间切换。

- **基于 JS/TS 的着色器构建工具**  
  可以在 TypeScript/JavaScript 中编写着色器，仅需一个源文件即可生成针对不同后端的 GLSL/WGSL 代码以及 WebGPU 绑定组布局。

- **现代场景渲染**  
  支持PBR材质、基于图像的照明、集群照明、阴影贴图、地形渲染、基于FFT的水面效果、后期处理等功能。

- **以 TypeScript 为先的架构**  
  强类型设计、模块化包结构，以及专为引擎与工具开发设计的、便于 IDE 使用的 API。

- **基于网页的可视化编辑器**  
  场景、材质、地形编辑器以及 TypeScript 脚本功能——全部在浏览器中直接运行。

- **可直接通过 NPM 安装的模块化包**  
  按需选用所需组件：基础数学功能、设备/RHI 相关模块、不同后端支持、场景渲染层，或是完整的编辑器。

## 基于 JS/TS 的着色器构建工具

Zephyr3D 让你无需手动编写原始的 GLSL/WGSL 代码，只需**用 JavaScript/TypeScript 定义着色器**，它便会自动生成针对特定后端的代码。

一个 JS 程序：

```ts  
const program = device.buildRenderProgram({  
  vertex(pb) {  
    this.$inputs.pos = pb.vec3().attrib('position');  
    this.$inputs.uv  = pb.vec2().attrib('texCoord0');  
    this.$outputs.uv = pb.vec2();  

    this.xform = pb.defineStruct([pb.mat4('mvpMatrix')])().uniform(0);  

    pb.main(function () {  
      this.$builtins.position =  
        pb.mul(this.xform.mvpMatrix, pb.vec4(this.$inputs.pos, 1));  
      this.$outputs.uv = this.$inputs.uv;  
    });  
  },  

  fragment(pb) {  
    this.$outputs.color = pb.vec4();  
    this.tex = pb.tex2D().uniform(0);  

    pb.main(function () {  
      this.$outputs.color = pb.textureSample(this.tex, this.$inputs.uv);  
    });  
  }  
});  
```

基于这一单一的源代码，Zephyr3D 会生成：

- WebGL 1 GLSL（属性/变量，传统统一变量）
- WebGL 2 GLSL（带layout(std140)的统一缓冲区，显式输出）
- WebGPU WGSL着色器
- 匹配的WebGPU绑定组布局（纹理、采样器以及带计算布局的统一缓冲区）

因此您只需：

- 仅需在 JS/TS 中编写一次着色器逻辑
- 自动获得适用于各后端的正确 GLSL/WGSL 代码
- 自动同步绑定设置与着色器代码
- 避免维护多个略有差异的着色器版本

如需查看更高级的示例，请参阅[用户手册](https://zephyr3d.org/doc/)。

## Zephyr3D 编辑器 — *基于网页的可视化工具*

<div align="center">

**在线试用 → [Zephyr3D 编辑器](https://zephyr3d.org/editor/)**  
*无需安装——完全在浏览器中运行*

<br/>

<img src="https://cdn.zephyr3d.org/doc/assets/images/editor-sm.jpg" width="80%" alt="Zephyr3D Web 编辑器">

</div>

**亮点**
- 场景、材质、地形编辑器

## Zephyr3D 编辑器 — *基于网页的可视化工具*

<div align="center">

在线试用 → [Zephyr3D 编辑器](https://zephyr3d.org/editor/)  
*无需安装——完全在浏览器中运行*

<br/>

<img src="https://cdn.zephyr3d.org/doc/assets/images/editor-sm.jpg" width="80%" alt="Zephyr3D 网页编辑器">

</div>

**亮点功能**
- 场景、材质、地形编辑器  
- TypeScript 脚本编写与动画工具  
- 基于 Zephyr3D 场景与设备 API 构建  
- 即时预览与一键导出

## Zephyr3D 编辑器桌面版

桌面版编辑器提供基于 Electron 的构建版本，便于在本地项目中使用并实现持久化存储。它通过 MCP 与内置的大型语言模型助手引入了人工智能功能，同时 API 密钥会以加密形式存储在本地。

下载最新的桌面版版本：[GitHub 发布页面](https://github.com/gavinyork/zephyr3d/releases)

## 架构概览

| 层级 | 描述 |
|------|------|
| **基础层** | 数学运算 / 资源文件系统 / 事件处理 / 智能指针 |
| **设备层（RHI）** | 抽象图形 API 层 + 着色器构建工具 / 资源绑定 |
| **后端渲染层 - WebGL / WebGPU** | 各平台特定的渲染后端 |
| **场景层** | 场景系统、材质、动画、后期特效 |

## 架构概览

| 层级 | 描述 |
|-------|--------------|
| **基础层** | 数学运算 / 资源文件系统 / 事件处理 / 智能指针 |
| **设备层（RHI）** | 抽象图形API层 + 着色器构建工具 / 资源绑定 |
| **WebGL/WebGPU后端层** | 针对不同平台的渲染后端 |
| **场景层** | 场景系统、材质、动画、后期特效 |
| **编辑器层** | 基于场景层构建的浏览器原生编辑器 |

## 深度约定（反向Z轴）

## 安装

```bash
npm install --save @zephyr3d/device
npm install --save @zephyr3d/backend-webgl
npm install --save @zephyr3d/backend-webgpu
npm install --save @zephyr3d/scene
```

可配合您常用的打包工具（Vite / Webpack / Rollup）一起使用。

## 深度约定（反Z轴）

## 深度约定（反向Z）

该引擎支持两种深度约定，会在加载时选定一种：

- **标准深度模式（Standard-Z）**：近平面处的设备深度值为0，远平面处的深度值为1。  
- **反向深度模式（Reverse-Z，默认值）**：近平面处的设备深度值为1，远平面处的深度值为0。使用浮点型深度缓冲区（`d32f` / `d32fs8`，WebGPU和WebGL2的默认类型）时，这种方式能产生几乎均匀的深度误差分布，从而大幅减少远距离处的Z冲突问题。

通过构建时的 define 设置启用反向 Z 坐标系，这样你的打包工具就能移除未使用的代码。

```js
// vite.config.js / esbuild
define: { __ZEPHYR3D_REVERSE_Z__: 'true' }

// rollup (@rollup/plugin-replace)
replace({ preventAssignment: true, values: { __ZEPHYR3D_REVERSE_Z__: 'true' } })
```

如果没有使用打包工具，则需在首次导入任何 `@zephyr3d/*` 模块之前设置全局变量 **：

```html
<script>globalThis.__ZEPHYR3D_REVERSE_Z__ = true;</script>
<script type="module" src="app.js"></script>
```

该约定在页面的整个生命周期内都是固定的。后端说明：

- **WebGPU**：可充分发挥优势，无需额外要求。  
- **WebGL/WebGL2**：当可用时（Chromium 121+），引擎会启用`EXT_clip_control`；若未启用，着色器端的回退机制仍能保证正确渲染，但精度提升效果有限。WebGL1没有浮点深度格式，因此虽在功能上支持反向Z轴，但无法获得精度提升。  
- 自定义材质应使用`@zephyr3d/base`中导出的常量（`REVERSE_Z`、`DEPTH_CLEAR_VALUE`、`DEPTH_COMPARE_DEFAULT`、`DEPTH_FARTHEST`等）以及`ShaderHelper`提供的深度相关工具，而非硬编码深度值或比较方向。  
- 已知限制：在反向Z轴模式下，斜向裁剪投影（如平面水面反射所使用的`Matrix4x4.obliqueProjection/obliquePerspective`）暂不支持，会抛出明确错误。

# 严格约束
1. **结构锁定**：绝对保持原有的 Markdown 数据结构、缩进、标题层级、表格、链接、URL、徽章、代码块和行内代码完全不变。
2. **选择性翻译**：仅翻译面向用户展示的可见自然语言内容。
3. **禁止修改**：**严禁**翻译或更改代码标签、键名、变量占位符（如 {{var}}、${var}、%s、%d 等）、命令示例、文件路径、项目名、API 名、包名、模型名、标识符和代码符号；除非背景信息中已经给出对应译名。
4. 术语、风格、专有名词的译法要与所给背景信息保持一致。

## 示例 — 场景 API

```ts
import { Vector3, Vector4 } from '@zephyr3d/base';
import {
  Scene, Application, LambertMaterial, Mesh,
  OrbitCameraController, PerspectiveCamera,
  SphereShape, DirectionalLight
} from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

const app = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

app.ready().then(() => {
  const scene = new Scene();
  new DirectionalLight(scene).lookAt(Vector3.one(), Vector3.zero(), Vector3.axisPY());
  const mat = new LambertMaterial();
  mat.albedoColor = new Vector4(0.9, 0.1, 0.1, 1);
  new Mesh(scene, new SphereShape(), mat);
  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 1, 100);
  scene.mainCamera.lookAt(new Vector3(0,0,4), Vector3.zero(), Vector3.axisPY());
  scene.mainCamera.controller = new OrbitCameraController({ center: Vector3.zero() });
  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);
  getEngine().setRenderable(scene, 0);
  app.run();
});
```

## 状态

**正在开发中**  

Zephyr3D 是用于我自己的实验、演示和工具的项目，目前正处于积极开发阶段。其 API 可能还会发生变化，但目前已可满足以下需求：

- 图形/Web 渲染实验
- 学习引擎与渲染架构
- 开发自定义工具及内部编辑器

## 状态

正在积极开发中

Zephyr3D 是用于我自己的实验、演示和工具的，目前仍在积极开发中。虽然其 API 可能还会发生变化，但它已经可以用于：

- 图形/网页渲染实验
- 引擎与渲染架构研究
- 开发自定义工具及内部编辑器

# 支持方式

## 支持方式

Zephyr3D 是我在业余时间开发与维护的。如果这款引擎、编辑器以及相关的工具或文章对您有所帮助，欢迎通过以下链接支持我的工作：

Ko-fi：https://ko-fi.com/gavinyork2024

您的支持有助于支付服务器托管与测试工具的费用，同时也能让我有更多专注的时间来：

- 开发新的引擎功能并提升性能  
- 维护文档与示例  
- 探索实验性的渲染理念与工具方案

非常感谢您的任何形式的支持——哪怕只是试用 Zephyr3D 并给予反馈，我也将不胜感激。

---

## 许可证

Zephyr3D 是在 [MIT 许可证](https://opensource.org/licenses/MIT) 的授权下发布的。

# 支持方式

<div align="center">

**© 2025 Zephyr3D — 专为 Web3D 领域使用 TypeScript 与 💙 构建。**

</div>
