# 阴影

> 本页代码为片段示意，省略了 import 与应用初始化，完整可运行示例见页内嵌入的实例。

阴影可以使场景更具立体感和真实感。目前我们支持对平行光，点光和锥光投射阴影。

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

