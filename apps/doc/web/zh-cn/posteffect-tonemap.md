# 色调映射 (Tonemap)

色调映射用来将HDR图像映射为LDR图像。
我们的色调映射采用ACES编码实现。

```javascript
// 对摄像机启用Tonemapping(默认Tonemapping是启用的)
camera.toneMap = true;
// toneMapExposure属性控制曝光度
camera.toneMapExposure = 1.5;
```

<div class="showcase" case="tut-27" style="width:600px;height:800px;"></div>

