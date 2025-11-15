# 概述

Zephyr3d是一个面向浏览器的3D渲染框架，提供了两套API接口及所见即所得的编辑器

## API

### Device API

  DeviceAPI提供了一组面向底层的抽象封装接口，允许用户使用完全相同的方式调用WebGL，WebGL2和WebGPU图形接口。这些接口覆盖了绝大多数的底层API能力，可以轻松支持跨API的图形渲染。
  跨平台渲染的一个主要困难是Shader语言不同，WebGL和WebGL2使用GLSL而WebGPU使用WGSL，为了能够统一Shader的编写，我们实现了一套动态生成Shader的功能，用户可以使用原生Javascript
  编写Shader，对于不同的后端，系统自动生成对应的Shader代码，不存在繁琐的字符串拼接，不存在大量的#ifdef，具有极高的灵活性。

### Scene API

  SceneAPI是建立在DeviceAPI基础上的一个上层渲染框架，既作为DeviceAPI的测试环境，也可直接用于图形开发。目前SceneAPI已实现的功能有：

  - 基于SceneGraph的场景管理
  - Clustered光照
  - PBR/IBL
  - ShadowMap(PCF/ESM/VSM/CSM)
  - 骨骼动画及关键帧动画
  - GPU实例渲染
  - 地形渲染
  - 大气渲染
  - 水面渲染
  - 后处理(Tonemap, Bloom, TAA, FXAA, SSAO等)
  - ImGui绑定

## 编辑器

Zephyr3d编辑器运行于浏览器中，无需下载安装，可用于交互式网页3D应用开发。

### 主要功能：

- 项目管理

  - 新建/导入/导出项目
  - 一键发布Web应用

- 场景编辑

  - 物体摆放
  - 属性编辑
  - 地形编辑

- 动画编辑

  为场景节点创建和编辑关键帧动画和动画轨道

- 创建/编辑材质

  使用蓝图创建和编辑自定义材质

- 脚本编写

  编辑器内编写TS脚本并绑定到场景实体

- 资产管理

  - 导入外部GLTF/GLB模型
  - 预制件系统
  - 使用IndexedDB存储项目资产


