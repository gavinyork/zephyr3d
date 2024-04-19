# 顺序无关的透明度渲染

我们的引擎支持两种顺序无关的透明度渲染(Order-Independent Transparency, OIT)技术:
Weighted Blended OIT和Per-Pixel Linked List OIT。

## Weighted Blended OIT

Weighted Blended OIT是一种基于权重的透明度混合技术。它通过在片元着色器中计算每个片元
的颜色和透明度权重,然后在后期合成阶段对这些片元进行加权混合。

该技术的优点是实现相对简单,性能较好,且可以很好地处理复杂的透明场景。缺点是无法完全解决
所有的透明度排序问题,在某些情况下可能会产生视觉瑕疵。

WebGL,WebGL2和WebGPU设备均支持Weighted Blended OIT。

以下代码允许使用Weigted Blended OIT进行透明物体渲染

```javascript

// 为相机指定Weighted Blended渲染透明物体
camera.oit = new WeightedBlendedOIT();

```

## Per-Pixel Linked List OIT

Per-Pixel Linked List OIT是一种基于每像素链表的透明度渲染技术。它在片元着色器中为每个
片元构建一个链表,链表中存储了该片元的颜色和深度信息。

该技术的优点是能够准确地处理透明物体的渲染顺序,即使在复杂场景下也能够正确渲染。缺点是需
要更多的显存和计算资源。

Per-Pixel Linked List OIT仅可用于WebGPU设备。

以下代码允许使用Per-Pixel Linked List进行透明物体渲染

```javascript

// 为相机指定Per-Pixel Linked List渲染透明物体
// 构造函数的参数是支持的透明层级数量，默认是16.
camera.oit = new ABufferOIT(20);

```

## 注意

OIT对象在使用完毕以后必须释放以免资源泄露。

```javascript

// 释放OIT对象
camera.oit.dispose();
camera.oit = null;

```

