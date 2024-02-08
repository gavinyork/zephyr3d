# 天空

我们支持两种天空模式：天空盒，大气散射

## 天空盒

天空盒(Skybox)是一种简单的天空渲染方法，只需要一张包含天空背景的立方体贴图，可以表现任意天空背景，缺点是只能表现静态天空。
天空盒贴图可以直接加载立方体贴图，也可以通过全景图生成。

要使用天空盒渲染，只需要在场景中设置天空渲染方式为天空盒并设置天空盒贴图即可。

```javascript

// 设置天空渲染模式为天空盒
scene.env.sky.skyType = 'skybox';
// 设置天空盒贴图
scene.env.sky.skyboxTexture = skyboxTexture;

```

<div class="showcase" case="tut-32"></div>

<br>

下面的例子演示了如何通过全景图实时生成天空盒

<div class="showcase" case="tut-33"></div>

## 大气散射

大气散射(atmosphere scattering)是利用大气层对阳光散射的物理模型来实时计算和渲染天空的一种方法，优点在于可以动态渲染不同时间的天空效果实现白天黑夜变换，缺点在于运算量较大，表现力较为单一。

要使用大气散射渲染天空，只需要设置天空渲染模式为大气散射即可，天空效果会根据阳光的方向实时计算。

```javascript

scene.env.sky.skyType = 'scatter';

```

注意：场景中的每个方向光都可以被设置为阳光，但是只能设置一个方向光为阳光，当一个方向光被设置为阳光后，之前被设置为阳光的方向光会被取消阳光属性。默认场景中第一个被创建的方向光会被设置为阳光。如果场景中不存在具有阳光属性的方向光，大气散射天空将会取一个默认的阳光方向。

```javascript

// 设置为阳光
directionalLight.sunLight = true;

// 取消阳光属性
directionalLight.sunLight = false;

```

大气散射计算出的天空通常为高动态范围，需要配合Tonemap后处理效果。

<div class="showcase" case="tut-34"></div>

可以看到，天空中我们使用2D噪声函数创建了云层，云层的覆盖率可以通过代码调节

```javascript

// 设置云层覆盖率，仅在使用大气散射渲染模式时有效
scene.env.sky.cloudy = 0.5;

// 设置云层亮度
scene.env.sky.cloudIntensity = 1.5

// 设置风力，风力大小影响云层移动速度
scene.env.sky.wind = new Vector2(300, 500);

```
