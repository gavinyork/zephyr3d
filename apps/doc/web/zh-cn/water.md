# 水面渲染

水面是一种常见的自然景观，目前我们提供了一种基于FFT的水面实现，最多支持3层波浪叠加。

目前我们的水面是作为后处理来实现的。

```javascript

// 创建水面后处理
const water = new PostWater();
s
// 设置水面的范围为世界坐标系下(-100, -100)到(100, 100)的矩形范围,默认为(-1000, -1000)到(1000, 1000)
water.boundary.setXYZW(-100, -100, 100, 100);
// 设置水面高度为世界坐标系下Y轴20，默认为0
water.elevation = 20;
// 设置风向(2D空间的向量)，影响波浪的强度和传播方向，默认为(2, 2)
water.wind.setXY(3, 5);
// 设置反射折射的抖动强度，值越大抖动越强，默认值为16
water.displace = 8;
// 设置深度缩放系数，值越小水越显得清澈，默认值为0.1
water.depthMulti = 0.2;
// 设置折射强度，这个值用于修改菲涅尔系数，值越大折射越强，默认为0
water.refractionStrength = 0.1;
// 设置波浪传播方向和风向的对齐程度，值越大对齐程度越高，默认值为1
water.alignment = 0.3;
// 设置白沫的宽度，默认为1.2
water.foamWidth = 0.8;
// 设置白沫的对比度，值越小对比度越高，默认为7.2
water.foamContrast = 8;
// 设置第一层波浪的波长，默认为400
water.waveLength0 = 400;
// 设置第一层波浪的陡度，默认为-1.5
water.waveCroppiness0 = -1;
// 设置第一层波浪的强度，默认为0.4
water.waveStrength0 = 0.4;
// 设置第二层波浪的波长，默认为100
water.waveLength1 = 100;
// 设置第二层波浪的陡度，默认为-1.2
water.waveCroppiness1 = -1;
// 设置第二层波浪的强度，默认为0.2
water.waveStrength1 = 0.2;
// 设置第三层波浪的波长，默认为15
water.waveLength2 = 20;
// 设置第三层波浪的陡度，默认为-0.5
water.waveCroppiness2 = -1;
// 设置第三层波浪的强度，默认为0.2
water.waveStrength2 = 0.2;

// 添加水面后处理效果
compositor.appendPostEffect(water);

```

<div class="showcase" case="tut-38"></div>
