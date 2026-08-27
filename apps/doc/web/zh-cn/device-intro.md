# 何时需要 Device API

Zephyr3d 提供两套 API，本章是其中偏底层的那套。**如果你的目标是做 3D 应用，
[Scene API](zh-cn/scene-basic.md) 才是你要的层，本章可以跳过。**

## 两套 API 的关系

```
你的应用
   │
   ├─── Scene API   （场景图、材质、光照、阴影、动画、后处理）
   │        │
   └────────┴─── Device API   （设备、缓冲区、纹理、shader、绘制调用）
                     │
              WebGL / WebGL2 / WebGPU
```

Scene API 建立在 Device API 之上，两者可以混用：用 Scene API 搭建场景，同时用 Device API
写自定义材质的 shader 或者插入自己的渲染 pass。

## 什么情况下需要读这一章

- **要自研渲染框架**，不想用引擎的场景管理和渲染管线。
- **要写自定义材质** —— 材质的 shader 用 Device API 的 shader 生成器编写，
  见[自定义材质](zh-cn/user-material.md)。
- **要写自定义后处理效果**或者往渲染管线里插自己的 pass，
  见[渲染图与自定义 Pass](zh-cn/rendergraph.md)。
- **要用计算着色器**（仅 WebGPU）做 GPU 通用计算。
- 想理解引擎内部如何工作。

如果只是想加载模型、打光、播放动画、加后处理，这些 Scene API 都已经封装好了，
直接用上层接口更省事。

## 这一章提供什么

Device API 把 WebGL、WebGL2 和 WebGPU 抽象成一套统一接口，覆盖了绝大多数底层能力：

- **统一的设备接口** —— 同一份代码跑在三种图形 API 上，见[创建设备](zh-cn/device.md)。
- **用 JavaScript 写 shader** —— 跨 API 最大的障碍是 shader 语言不同（GLSL vs WGSL）。
  引擎让你用原生 JavaScript 描述 shader，再按后端生成对应代码。没有字符串拼接，
  没有成堆的 `#ifdef`，见[编写 shader](zh-cn/shader.md)。
- **资源管理** —— [缓冲区](zh-cn/buffer.md)、[纹理](zh-cn/texture.md)、
  [渲染状态](zh-cn/renderstate.md)、[绘制调用](zh-cn/drawcall.md)。

## 后端能力差异

统一接口不等于能力相同，写跨后端代码时要注意：

| 能力 | WebGL | WebGL2 | WebGPU |
| --- | --- | --- | --- |
| 计算着色器 | 不支持 | 不支持 | 支持 |
| 多渲染目标 | 需扩展 | 支持 | 支持 |
| 浮点纹理渲染 | 需扩展 | 视扩展而定 | 支持 |
| Uniform Buffer | 不支持 | 支持 | 支持 |

具体能力通过 `device.getDeviceCaps()` 查询。**引擎在能力不足时通常静默回退**，
所以跨后端开发要在目标设备上实测。

## 建议的阅读顺序

1. [创建设备](zh-cn/device.md) —— 设备创建与渲染循环
2. [编写 shader](zh-cn/shader.md) —— 本章篇幅最大也最关键的一节
3. [缓冲区](zh-cn/buffer.md) 与 [纹理](zh-cn/texture.md) —— 资源准备
4. [渲染状态](zh-cn/renderstate.md) 与 [渲染图元](zh-cn/drawcall.md) —— 提交绘制
5. [示例](zh-cn/devicesamples.md) —— 完整可运行代码
