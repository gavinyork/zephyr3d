# 自定义材质

## 简介

材质对于物体的渲染效果非常重要。引擎的材质系统目前已经预定义了PBR，Unlit，Blinn和Lambert材质。
为了实现更为丰富的渲染效果，材质系统也提供了相关接口用于自定义材质。自定义材质可以应用于任何Mesh对象。

## 前提条件

引擎使用javascript编写Shader，在实现自定义材质之前请确认你已经熟悉这部分内容。参见：[编写shader](zh-cn/shader.md)

## 渲染流程

在编写自定义材质之前你需要了解引擎的渲染流程。场景的渲染需要经过多个Pass:

1. DepthPass

  在需要的情况下，场景会先进行一次深度渲染生成深度缓冲区，线性深度会被渲染到一张Float32纹理。DepthPass只渲染不透明物体。

2. ShadowMapPass

  如果场景中存在投射阴影的光源，每个光源渲染一张ShadowMap

3. LightingPass

  根据光源的数量以及是否投射阴影，场景需要被渲染一遍或多遍。每个投射阴影的光源需要单独渲染一遍，其他不投射阴影的光源
  利用聚簇光照(Clustered lighting)算法渲染一遍。

4. 天空，雾效以及后处理

自定义材质需要正确处理DepthPass，ShadowMapPass和LightingPass。

## 创建自定义材质

[MeshMaterial](/doc/markdown/./scene.meshmaterial)是所有Mesh材质的基类，任何自定义材质必须继承于MeshMaterial。

自定义材质继承MeshMaterial以后需要重写一些类方法：

  - [MeshMaterial.supportLighting()](/doc/markdown/./scene.meshmaterial.supportlighting)

    返回true表明该材质受光照影响，否则为无光照材质。该函数默认返回true。

  - [MeshMaterial.isTransparent(pass)](/doc/markdown/./scene.meshmaterial.istransparent)

    返回true表明该材质的指定pass是否为半透明。该值影响Shader对alpha通道的处理，当pass为0时该属性影响物体在哪个队列内渲染。
    默认情况下该函数通过[MeshMaterial.blendMode](/doc/markdown/./scene.meshmaterial.blendmode)
    属性来判断是否半透明，如果blendMode为'none'则返回false，否则返回true。

  - [MeshMaterial.applyUniformValues(bindGroup, ctx, pass)](/doc/markdown/./scene.meshmaterial.applyuniformvalues)

    该函数用于上传该材质指定pass所需的uniform常量。如果自定义材质定义了新的uniform常量，则需要重写
    该函数。在重写该函数时必需调用父类的该方法。
  
  - [MeshMaterial.vertexShader(scope)](/doc/markdown/./scene.meshmaterial.vertexshader)

    这里是该材质的VertexShader实现，必需重写。

  - [MeshMaterial.fragmentShader(scope)](/doc/markdown/./scene.meshmaterial.fragmentshader)

    这里是该材质的fragmentShader实现，必需重写。

类[ShaderHelper](/doc/markdown/./scene.shaderhelper)提供了编写材质需要的诸多工具函数。

## 系统设计

引擎的材质系统使用混入(Mixin)设计模式提供组件的共用。组件被混入以后会给自定义材质注入相关的属性和方法，也可能会改变材质的一些默认行为。

自定义材质可以通过调用[applyMaterialMixins](/doc/markdown/./scene.applymaterialmixins)方法混入一个或多个组件。

例如，需要混入组件mixinLambert光照模型，类需要定义如下：

```javascript

class MyMaterial extends applyMaterialMixins(MeshMaterial, mixinLambert) {
  // 材质实现
}

```