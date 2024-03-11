# 环境光遮挡 (SSAO)

环境光遮挡是一种屏幕空间的AO算法，旨在提供间接光的阴影近似，提高渲染的真实感，位于Opacity组

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

