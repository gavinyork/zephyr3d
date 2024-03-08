# Bloom 辉光

辉光效果用来将渲染图像中高亮的部分溢出产生朦胧的效果，位于Transparent分组。

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

