# 后处理

后处理(PostProcess)允许你在场景渲染以后为图像添加2D效果。

我们使用Compositor对象管理后处理效果。Compositor可以添加多个后处理效果，每个都以前一个效果的渲染结果为输入形成链式调用。
渲染的时候只需要将Compositor对象作为Camera.render()的第二个参数即可。

我们的后处理效果分为Opaque和Transparent两组，Opaque组是在不透明物体渲染完成，不透明物体渲染之前调用，Transparent组在透明和不透明物体都渲染完成调用。
每种后处理效果根据应用不同默认处于Opaque组或Transparent组。后处理效果的调用次序分别在每个组内符合添加次序。

## 色调映射

色调映射(Tone mapping)用来将HDR图像映射为LDR图像，位于Transparent分组。
我们的色调映射采用ACES编码实现。

```javascript

// 创建Compositor实例
const compositor = new Compositor();
// 创建色调映射后处理实例
const tonemap = new Tonemap();
// exposure属性控制曝光度，默认值为1
tonemap.exposure = 1.5;
// 添加该效果到compositor
compositor.appendPostEffect(tonemap)
// ...
// 渲染场景并应用效果
camera.render(scene, compositor);

```

<div class="showcase" case="tut-27" style="width:600px;height:800px;"></div>

## 辉光

辉光效果(Bloom)用来将渲染图像中高亮的部分溢出产生朦胧的效果，位于Transparent分组。

如果将Bloom效果应用于HDR图像可能产生明显的高光闪烁，建议放在ToneMap之后。

```javascript

// 创建Compositor实例
const compositor = new Compositor();
// 创建Bloom后处理实例
const bloom = new Bloom();
// threshold属性为亮度阈值，亮度低于此值的部分将不产生辉光，默认值为0.8
bloom.threshold = 0.85;
// intensity属性为强度，值越大辉光效果越强烈，默认值为1
bloom.intensity = 2;
// downsampleLimit属性为downsample的最小贴图尺寸，默认值为32
bloom.downsampleLimit = 64;
// 添加该效果到compositor
compositor.appendPostEffect(bloom);
// ...
// 渲染场景并应用效果
camera.render(scene, compositor);

```

<div class="showcase" case="tut-28" style="width:600px;height:800px;"></div>

## 环境光遮挡

环境光遮挡(SAO)是一种屏幕空间的AO算法，旨在提供间接光的阴影近似，提高渲染的真实感，位于Opacity组

```javascript

// 创建Compositor实例
const compositor = new Compositor();
// 创建SAO后处理
const ssao = new SAO();
// radius属性为深度检测范围，默认值为100
ssao.radius = 80;
// intensity属性为强度，值越大阴影越强烈，默认值为0.05
ssao.intensity = 0.04;
// blurKernelRadius属性为模糊半径，默认值为8
ssao.blurKernelRadius = 10;
// 添加该效果到compositor
compositor.appendPostEffect(ssao);
// ...
// 渲染场景并应用效果
camera.render(scene, compositor);

```

<div class="showcase" case="tut-29" style="width:600px;height:800px;"></div>

## FXAA

FXAA是一种屏幕空间的抗锯齿技术，位于Transparent组。

```javascript

// 创建Compositor实例
const compositor = new Compositor();
// 创建FXAA后处理实例
const fxaa = new FXAA();
// 添加该效果到compositor
compositor.appendPostEffect(fxaa);
// ...
// 渲染场景并应用效果
camera.render(scene, compositor);

```

<div class="showcase" case="tut-30" style="width:600px;height:800px;"></div>
