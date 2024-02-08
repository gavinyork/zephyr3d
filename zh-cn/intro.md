# 概述

Zephyr3d是一个面向浏览器的3D渲染框架，主要由两套API组成：

## Device API

  DeviceAPI提供了一组面向底层的抽象封装接口，允许用户使用完全相同的方式调用WebGL，WebGL2和WebGPU图形接口。这些接口覆盖了绝大多数的底层API能力，可以轻松支持跨API的图形渲染。
  跨平台渲染的一个主要困难是Shader语言不同，WebGL和WebGL2使用GLSL而WebGPU使用WGSL，为了能够统一Shader的编写，我们实现了一套动态生成Shader的功能，用户可以使用原生Javascript
  编写Shader，对于不同的后端，系统自动生成对应的Shader代码，不存在繁琐的字符串拼接，不存在大量的#ifdef，具有极高的灵活性。

## Scene API

  SceneAPI是建立在DeviceAPI基础上的一个上层渲染框架，既作为DeviceAPI的测试环境，也可直接用于图形开发。目前SceneAPI已实现的功能有：

  - Octree场景管理
  - Clustered光照剪裁
  - PBR/IBL
  - ShadowMap(PCF/ESM/VSM/CSM)
  - 骨骼动画及关键帧动画
  - GPU实例渲染
  - 导入GLTF/GLB模型
  - ChunkLod地形
  - 大气渲染，动态云层，支持日夜交替效果
  - FFT水面渲染
  - 后处理(Tonemap, Bloom, FXAA, SAO等)
  - ImGui绑定

  SceneAPI尚处于开发前期阶段，不推荐用于正式项目。
