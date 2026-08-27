# 天空

我们支持两种天空模式：天空盒，大气散射

## 天空盒

天空盒(Skybox)是一种简单的天空渲染方法，只需要一张包含天空背景的立方体贴图，可以表现任意天空背景，缺点是只能表现静态天空。
天空盒贴图可以直接加载立方体贴图，也可以通过全景图生成。

要使用天空盒渲染，只需要在场景中设置天空渲染方式为天空盒并设置天空盒贴图即可。

<<< @/../src/tut-32/main.js{27-37 js}

天空盒贴图是一张立方体贴图（`TextureCube`）。上例直接加载了一个 `.dds` 立方体贴图文件。

<div class="showcase" case="tut-32"></div>

<br>

如果手头只有全景图（等距圆柱投影，常见于 HDRI 素材），可以用内置的 `panoramaToCubemap()`
在运行时转成立方体贴图：

<<< @/../src/tut-33/main.js{28-44 js}

要点是先用 `device.createCubeTexture()` 建一张空的立方体贴图作为目标（第 35 行），
再把全景图渲染进去。这里用 `rgba16f` 格式是因为 HDR 全景图的亮度超出 [0,1] 范围，
用 8 位格式会把高光截断。

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

大气散射计算出的天空通常为高动态范围，需要配合 [Tonemap](zh-cn/posteffect-tonemap.md) 后处理效果。

下面是一个完整的大气散射天空设置：

<<< @/../src/tut-34/main.js{27-37 js}

注意第 28 行创建方向光时并没有显式设置 `sunLight = true`——**场景中第一个被创建的方向光会自动
成为阳光**，所以这里只需要用 `lookAt()` 定好它的朝向，天空就会随之变化。

<div class="showcase" case="tut-34"></div>

天空中的云层是用 2D 噪声函数生成的，有三个可调参数：

```javascript
// 云层覆盖率，仅在大气散射模式下有效
scene.env.sky.cloudy = 0.5;

// 云层亮度
scene.env.sky.cloudIntensity = 1.5;

// 风力，影响云层移动速度和方向
scene.env.sky.wind = new Vector2(300, 500);
// 也可以就地修改，避免额外分配
scene.env.sky.wind.setXY(600, 0);
```
