# 阴影

阴影可以使场景更具立体感和真实感。目前我们支持对平行光，点光和锥光投射阴影。

## 开启阴影

每个光源可以单独配置是否投射阴影以及阴影模式，质量等参数。

```javascript

const light = new DirectionalLight(scene);
// castShadow属性控制灯光是否投射阴影
light.castShadow = true;

```

### 平行光投影：

<div class="showcase" case="tut-16"></div>

### 点光源投影：

<div class="showcase" case="tut-17"></div>

### 锥光投影

<div class="showcase" case="tut-18"></div>

## 反走样

使用ShadowMap实现阴影，因为ShadowMap贴图的精度问题，阴影边缘会出现锯齿形走样。
为了软化阴影边缘，我们可以提高ShadowMap贴图尺寸，或使用PCF, VSM, ESM等技术。

### 提高ShadowMap贴图分辨率

我们可以通过```light.shadow.shadowMapSize```属性设置ShadowMap贴图的分辨率。

在下面的示例中，上半屏阴影贴图分辨率为512像素，下半屏阴影贴图的分辨率为1024像素。

<div class="showcase" case="tut-19" style="width:600px;height:800px"></div>

### PCF

PCF是通过对阴影图多次采样的一种反走样技术

```javascript

// 采用optimized PCF
light.shadow.mode = 'pcf-opt';
// 采用PoissonDisc采样的PCF
light.shadow.mode = 'pcf-pd';

```

在下面的示例中，上半屏使用PCF采样，下半屏为常规采样。

<div class="showcase" case="tut-20" style="width:600px;height:800px"></div>

### VSM

VSM是利用统计学原理的一种反走样技术

```javascript

light.shadow.mode = 'vsm';

```

在下面的示例中，上半屏使用VSM，下半屏为常规采样。

<div class="showcase" case="tut-21" style="width:600px;height:800px;"></div>

### ESM

ESM是利用指数函数处理阴影边缘的一种反走样技术

```javascript

light.shadow.mode = 'esm';

```

在下面的示例中，上半屏使用ESM，下半屏为常规采样。

<div class="showcase" case="tut-22" style="width:600px;height:800px;"></div>

### CSM

CSM(Cascaded Shadow Map)是通过把视锥分割成多个部分分别应用ShadowMap来改善阴影走样的技术。

下面是一个CSM的示例

<div class="showcase" case="tut-23"></div>

### 限制阴影范围

如果阴影范围过大，即使用CSM可能也无法提高阴影的精度，我们可以限制阴影在距离摄像机一定范围之内，在范围边界，阴影平滑过渡到无阴影状态

```javascript

light.shadow.shadowDistance = 500;

```