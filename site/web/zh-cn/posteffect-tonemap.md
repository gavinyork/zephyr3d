# 色调映射 (Tonemap)

色调映射用来将HDR图像映射为LDR图像，位于Transparent分组。
我们的色调映射采用ACES编码实现。

```javascript

// 对摄像机启用Tonemapping(默认Tonemapping是启用的)
camera.toneMap = true;
// toneMapExposure属性控制曝光度，默认值为1
camera.toneMapExposure = 1.5;
// ...
// 渲染场景并应用效果
camera.render(scene);

```

<div class="showcase" case="tut-27" style="width:600px;height:800px;"></div>

