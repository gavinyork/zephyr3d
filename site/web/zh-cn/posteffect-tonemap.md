# 色调映射 (Tonemap)

色调映射用来将HDR图像映射为LDR图像，位于Transparent分组。
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

