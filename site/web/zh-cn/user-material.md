# 自定义材质

## 简介

材质对于物体的渲染效果非常重要。引擎目前已经预定义了PBR材质，Unlit材质，Blinn材质和Lambert材质。
为了实现更为丰富的渲染效果，引擎提供了材质的自定义功能。自定义材质可以应用于任何Mesh对象。

## 前提条件

引擎使用javascript编写Shader，在实现自定义材质之前请确认你已经熟悉这部分内容。[编写shader](zh-cn/shader.md)

## 渲染流程

在编写自定义材质之前你需要了解引擎的渲染流程。场景的渲染需要经过多个Pass:

1. DepthPass

  在需要的情况下，场景会先进行一次深度渲染生成深度缓冲区，线性深度会被渲染到一张Float纹理。DepthPass只渲染不透明物体

2. ShadowMapPass

  如果场景中存在投射阴影的光源，每个光源渲染一张ShadowMap

3. LightingPass

  根据光源的数量以及是否投射阴影，场景需要被渲染一遍或多遍。每个投射阴影的光源需要单独渲染一遍，其他不投射阴影的光源
  利用聚簇光照(Clustered lighting)算法渲染一遍。

4. 天空，雾效以及后处理

自定义材质需要正确处理DepthPass，ShadowMapPass和LightingPass。

## 创建自定义材质

任何自定义材质必须继承于[MeshMaterial](/doc/markdown/./scene.meshmaterial)。

下面是一个最简单的例子，我们定义一个不受光照的材质，输出法线的RGB值和一个指定颜色的乘积。

<div class="showcase" case="tut-39"></div>
