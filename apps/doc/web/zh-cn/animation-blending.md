# 动画融合

当前我们支持所有种类动画的融合，使用方法也很简单只需要以特定的权重播放动画，当前正在播放的
所有动画会根据各自的权重通过加权平均进行融合。

## 权重融合

以下代码同时播放三个动画并令它们3:7:5融合

```javascript

animationSet.playAnimation('animation-1', {
  weight: 3, // 权重
});

animationSet.playAnimation('animation-2', {
  weight: 7, // 权重
});

animationSet.playAnimation('animation-3', {
  weight: 5, // 权重
});

```

## 动画衔接

动画衔接也是利用权重实现的，用于避免两个动画切换时产生跳变

```javascript

// 假定动画A正在播放，我们此时需要切换到动画B

// 停止动画A，给定淡出时间为0.3秒
animationSet.stopAnimation('A', {
  fadeOut: 0.3
});

// 播放动画B，给定淡入时间为0.3秒
animationSet.playAnimation('B', {
  fadeIn: 0.3
});

```

以上例子中，动画A的权重在0.3秒内逐渐减为0并停止播放，动画B的权重在0.3秒内从0逐渐变为1，实现了两个动画的无缝转换。

