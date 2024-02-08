<img
    src="media/logo_i.svg"
    style="display: block; width: 400px; margin: auto; margin-bottom: 0"
/>

# 简介

Zephyr3d是一组支持在浏览器中进行3D渲染的API接口，支持WebGL/WebGL2/WebGPU. 

它主要包括两个部分：Device API 和 Scene API.<br>

### Device API

  Device API通过抽象化的封装，允许用户使用一套统一的接口来一致的方法来调用WebGL和WebGPU渲染功能。<br>
  主要功能包括:

  - 全面支持WebGL，WebGL2和WebGPU。
  - 使用javascript编写shader，无需了解GLSL或WGSL。
  - 类似于WebGPU架构, 使用绑定组(Bind group)来管理着色器资源。

  Device API提供了跨底层API的能力，适合用于编写自己的渲染框架。

### Scene API

  Scene API是建立于Device API之上的一个高级渲染框架。<br>
  主要功能包括:

  - PBR渲染及IBL光照。
  - Clustered光照渲染器，支持WebGL/WebGL2/WebGPU。
  - 导入GLTF模型。
  - 基于Octree的裁剪与拾取。
  - 骨骼动画，帧动画
  - 基于ChunkedLOD的地形渲染
  - Linear/Exp/Exp2雾
  - HDR渲染
  - PCF/ESM/VSM Shadow Map
  - Cascaded Shadow Map
  - 集成ImGUI

  Scene API适合用于快速开发。

[Examples](/examples/index.html).
