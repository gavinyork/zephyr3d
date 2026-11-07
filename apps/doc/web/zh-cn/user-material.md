# 自定义材质

## 简介

材质对于物体的渲染效果非常重要。引擎的材质系统已经预定义了 PBR（金属/粗糙度与镜面/光泽度两套工作流）、Unlit、Blinn、Lambert，以及皮肤（`SSSMaterial`）、头发、眼睛、MToon 等专用材质；在编辑器里还可以用[材质蓝图](zh-cn/editor/material-blueprint.md)以节点图的方式编写材质。
为了实现更为丰富的渲染效果，材质系统也提供了相关接口用于自定义材质。自定义材质可以应用于任何Mesh对象。

## 前提条件

引擎使用javascript编写Shader，在实现自定义材质之前请确认你已经熟悉这部分内容。参见：[编写shader](zh-cn/shader.md)

## 渲染流程

在编写自定义材质之前你需要了解引擎的渲染流程。场景的渲染需要经过多个Pass:

1. DepthPass

  场景总是先进行一次深度预渲染，生成深度缓冲区和后续效果需要的数据（如运动矢量）。DepthPass只渲染不透明物体。不透明物体的阴影随后在屏幕空间计算成一张阴影遮罩，光照阶段直接读取。

2. ShadowMapPass

  如果场景中存在投射阴影的光源，每个光源渲染一张ShadowMap

3. LightingPass

  根据光源的数量以及是否投射阴影，场景需要被渲染一遍或多遍。每个投射阴影的光源需要单独渲染一遍，其他不投射阴影的光源
  利用聚簇光照(Clustered lighting)技术渲染一遍。

4. 天空，雾效以及后处理

自定义材质需要正确处理DepthPass，ShadowMapPass和LightingPass。此外还有拾取用的 OBJECT_COLOR pass，以及开启探针 GI 时的体素化 pass；材质要参与 GI，需要重写 `supportsVoxelization()` 返回 true。

## 创建自定义材质

[MeshMaterial](/doc/markdown/./scene.meshmaterial)是所有Mesh材质的基类，任何自定义材质必须继承于MeshMaterial。

自定义材质继承MeshMaterial以后可能需要重写一些类方法：

  - [MeshMaterial.supportLighting()](/doc/markdown/./scene.meshmaterial.supportlighting)

    返回true表明该材质受光照影响，否则为无光照材质。`MeshMaterial` 上默认返回 false；混入 `mixinLight` 后默认返回 true。

  - [MeshMaterial.getQueueType()](/doc/markdown/./scene.meshmaterial.getqueuetype)

    返回[QUEUE_OPAQUE](/doc/markdown/./scene.queue_opaque)表明此材质需要在不透明阶段渲染，
    返回[QUEUE_TRANSPARENT](/doc/markdown/./scene.queue_transparent)表明此材质需要在透明阶段渲染。

  - [MeshMaterial.isTransparentPass(pass)](/doc/markdown/./scene.meshmaterial.istransparent)

    返回true表明该材质的指定pass是否为半透明。该值影响Shader对alpha通道的处理。
    默认情况下该函数通过[MeshMaterial.blendMode](/doc/markdown/./scene.meshmaterial.blendmode)
    属性来判断是否半透明，如果blendMode为'none'则返回false，否则返回true。

  - [MeshMaterial.applyUniformValues(bindGroup, ctx, pass)](/doc/markdown/./scene.meshmaterial.applyuniformvalues)

    该函数用于上传该材质指定pass所需的uniform常量。如果自定义材质定义了新的uniform常量，则需要重写该函数。
    重写此方法必须调用其默认实现。

    **注意**：它只在材质的参数改变后才会执行（改变参数后要调用 `this.uniformChanged()` 通知材质），不是每帧都调用。**每帧都会变化的值**（例如随相机移动的数据）要写在 `applyUniforms(bindGroup, ctx, needUpdate, pass)` 里：重写它，先调用默认实现，再在 `needUpdate` 判断之外设置这些值。只是做时间动画的话，在 shader 里用 `ShaderHelper.getElapsedTime(scope)` 读取时间即可，不需要自己上传。

  - [MeshMaterial.vertexShader(scope)](/doc/markdown/./scene.meshmaterial.vertexshader)

    这里是该材质的VertexShader实现，必需重写。
    重写此方法必须调用其默认实现。

  - [MeshMaterial.fragmentShader(scope)](/doc/markdown/./scene.meshmaterial.fragmentshader)

    这里是该材质的fragmentShader实现，必需重写。
    重写此方法必须调用其默认实现。

  - [MeshMaterial.updateRenderStates(pass, stateSet, ctx)](/doc/markdown/./scene.meshmaterial.updaterenderstates)

    每次当使用该材质的渲染对象被渲染之前会调用，用于设置材质的渲染状态。
    重写此方法必须调用其默认实现。
    
  - [MeshMaterial.apply(ctx)](/doc/markdown/./scene.material.apply)

    当应用材质时调用，按需创建Shader设置uniform常量。
    重写此方法必须调用其默认实现。

类[ShaderHelper](/doc/markdown/./scene.shaderhelper)提供了编写材质需要的诸多工具函数。

> **命名注意**：shader 里的变量名会原样写进生成的 WGSL/GLSL，引擎不会改名。WGSL 的保留字（如 `set`、`pass`、`from`、`filter`、`sample`、`type`、`target`）和 GLSL 的保留字（如 `input`、`output`、`filter`、`sample`）不能用作变量名，否则程序编译失败。尤其要注意只在 WebGL2 上测试过的材质，换到 WebGPU 后可能才暴露这个问题。用多个单词组成的名字最安全。

## 系统设计

引擎的材质系统使用混入(Mixin)设计模式提供组件的共用。组件被混入以后会给自定义材质注入相关的属性和方法，也可能会改变材质的一些默认行为。

自定义材质可以通过调用[applyMaterialMixins](/doc/markdown/./scene.applymaterialmixins)方法混入一个或多个组件。

例如，需要混入组件mixinLambert光照模型，类需要定义如下：

```javascript

class MyMaterial extends applyMaterialMixins(MeshMaterial, mixinLambert) {
  // 材质实现
}

```
