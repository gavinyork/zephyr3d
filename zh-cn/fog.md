# 大气和雾效

雾效用于模拟自然场景中物体距离越远越为模糊的效果，可以让渲染效果更加真实。我们支持基于真实大气散射算法实现的雾效，也支持传统的线性和指数算法的雾效。

## 大气散射雾效

```javascript

// 设置为大气散射雾效（通常需要配合大气散射天空渲染模式)
scene.env.sky.fogType = 'scatter';
// 使用大气散射雾效时，这个属性可以调节雾效的浓度，值越小，雾效浓度越小
scene.worldUnit = 100;

```

<div class="showcase" case="tut-35"></div>

## 线性雾效

```javascript

// 设置为线性模式雾效
scene.env.sky.fogType = 'linear';
// 雾效起始距离
scene.env.sky.fogStart = 10;
// 雾效达到最浓的距离
scene.env.sky.fogEnd = 400;
// 雾效高度
scene.env.sky.fogTop = 120;

// 设置
```

<div class="showcase" case="tut-36"></div>

## 指数雾效

```javascript

// 设置为指数雾效(exp或exp2)
scene.env.sky.fogType = 'exp';
// 雾效浓度
scene.env.sky.fogDensity = 0.006;

```

<div class="showcase" case="tut-37"></div>
