# FXAA

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
