# Bloom 辉光

辉光效果用来将渲染图像中高亮的部分溢出产生朦胧的效果。

```javascript
// 为摄像机打开辉光效果
camera.bloom = true;
// bloomThreshold属性为亮度阈值，亮度低于此值的部分将不产生辉光
camera.bloomThreshold = 0.85;
// bloomIntensity属性为强度，值越大辉光效果越强烈
camera.bloomIntensity = 2;
```

<div class="showcase" case="tut-28" style="width:600px;height:800px;"></div>

