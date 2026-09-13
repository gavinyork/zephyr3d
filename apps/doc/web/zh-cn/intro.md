# 概述

Zephyr3d是一个面向浏览器的3D渲染框架，提供了两套API接口及所见即所得的编辑器

---

## API

### Device API

  DeviceAPI提供了一组面向底层的抽象封装接口，允许用户使用完全相同的方式调用WebGL，WebGL2和WebGPU图形接口。这些接口覆盖了绝大多数的底层API能力，可以轻松支持跨API的图形渲染。
  跨平台渲染的一个主要困难是Shader语言不同，WebGL和WebGL2使用GLSL而WebGPU使用WGSL，为了能够统一Shader的编写，我们实现了一套动态生成Shader的功能，用户可以使用原生Javascript
  编写Shader，对于不同的后端，系统自动生成对应的Shader代码，不存在繁琐的字符串拼接，不存在大量的#ifdef，具有极高的灵活性。

### Scene API

  SceneAPI是建立在DeviceAPI基础上的一个上层渲染框架，既作为DeviceAPI的测试环境，也可直接用于图形开发。目前SceneAPI已实现的功能有：

**渲染管线**

Forward+ 管线以 render graph 组织，具备自动资源池化与用于时域效果的历史缓冲。支持 Clustered 光照、Hi-Z、深度预通道、[GPU拾取](./picking.html)、[几何体实例化](./instancing-intro.html)、render bundle 以及[多视图渲染](./multi-views.html)。

**材质与光照**

PBR（metallic-roughness 与 specular-glossiness 两套工作流）、[基于图像的光照](./lighting-intro.html)、物理光照单位、Lambert/Blinn/Unlit、用于风格化着色的 MToon，以及可用于自定义材质的[基于mixin的系统](./user-material.html)。[材质蓝图](./material-blueprint.html)可在编辑器中以节点图的方式编写材质。

**角色渲染**

带次表面散射 profile 的皮肤材质、带眼窝遮蔽的眼球材质，以及同时提供 Kajiya-Kay 与 Marschner 两种模型、并在 GPU 上展开发丝级几何的头发材质。

**[阴影](./shadow-intro.html)**

提供 PCF（多种变体）、PCSS、ESM、VSM、SSM 与 DOM 阴影，支持级联阴影贴图与接收端偏移（receiver bias）控制。可按光源逐个选择，以匹配你想要的质量/开销取舍。

**[后处理](./posteffect-intro.html)**

TAA、SSGI、SSR、SSAO、bloom、运动模糊、FXAA、色调映射、调色，以及用于皮肤的独立次表面散射通道。

**[透明](./oit.html)**

三种顺序无关透明（OIT）后端：A-buffer（WebGPU）、双向深度剥离（dual depth peeling）与加权混合（weighted blended）。

**地形、天空与水体**

[Clipmap地形](./terrain-runtime.html)，支持运行时纹理化与草地层；[大气天空](./sky.html)；以及由 FFT、Gerstner 或 FBM 波形生成器驱动的[海洋水体](./water.html)。

**[动画与模拟](./animation-intro.html)**

骨骼与关键帧动画，支持混合、遮罩与 action controller。[反向动力学](./animation-ik.html)（CCD、FABRIK、双骨骼）、[关节动力学](./animation-joint-dynamics.html)、弹簧链、GPU 布料、GPU 头发模拟、[Morph Target](./animation-morph-target.html)与几何缓存。

**资产管线**

glTF/GLB、FBX、Alembic 与发丝曲线[导入器](./asset-loading.html)，[预制体系统](./serialization.html)、[虚拟文件系统](./vfs.html)，以及[引用计数资源管理](./lifetime.html)。

---

## 编辑器

编辑器本身即构建于 Scene 与 Device API 之上。它涵盖场景编辑、内容浏览器、节点图式材质蓝图、地形雕刻与纹理绘制、动画编辑、绑定到场景实体的 TypeScript 脚本，以及用于自定义工具与面板的插件 API。

桌面端构建（Electron）在此基础上增加了带持久化存储的本地项目文件夹、内嵌的 MCP 服务器（使 AI agent 可以直接驱动编辑器），以及内置的 LLM 助手。API 密钥存储在本地，并以静态加密方式保存。

## 从哪里开始

如果你要**用代码开发 3D 应用**，按顺序读下去就行：

1. [安装](zh-cn/installation.md) —— 确定该装哪几个包
2. [第一个应用](zh-cn/first-app.md) —— 跑出第一个画面
3. [放入模型与材质](zh-cn/first-scene.md) —— 往场景里放东西
4. [加上阴影与后处理](zh-cn/first-polish.md) —— 让画面像样起来

之后再按需深入「使用场景 API」下的各个专题。

如果你更想用**可视化工作流**，从[编辑器概述](zh-cn/editor/overview.md)开始。

如果你要**自研渲染框架**、不打算用引擎的场景管理，直接看
[底层图形 API](zh-cn/device-intro.md)。


