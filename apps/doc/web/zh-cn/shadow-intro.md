# 阴影

> 本页代码为片段示意，省略了 import 与应用初始化，完整可运行示例见页内嵌入的实例。

阴影可以使场景更具立体感和真实感。平行光、点光、锥光和面光源都可以投射阴影。

## 开启阴影

每个光源可以单独配置是否投射阴影以及阴影模式，质量等参数。

```javascript

const light = new DirectionalLight(scene);
// castShadow属性控制灯光是否投射阴影
light.castShadow = true;

```

网格也可以配置是否投射阴影。

```javascript

// 允许该网格投射阴影
// 默认值为true
mesh.castShadow = true;

```

## 平行光投影：

<div class="showcase" case="tut-16"></div>

## 点光源投影：

<div class="showcase" case="tut-17"></div>

## 锥光投影

<div class="showcase" case="tut-18"></div>

## 面光源投影

面光源的阴影贴图和点光一样是立方体贴图。使用 `'pcss'` 阴影模式时，半影大小随矩形尺寸变化：
光源越大阴影越柔和，并且离投影物体越远，阴影边缘扩散得越宽。其他模式下，阴影边缘不随光源大小变化。

<<< @/../src/tut-84/main.js#shadow

示例中光源在高矮不同的柱子上方来回移动。拖动尺寸滑块可以看到半影变宽，也可以切换阴影模式对比效果。

<div class="showcase" case="tut-84"></div>
