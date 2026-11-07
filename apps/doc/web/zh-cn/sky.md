# 天空

`scene.env.sky.skyType` 决定天空的渲染方式：

| 取值 | 说明 |
| --- | --- |
| `'scatter'` | 大气散射（默认），随阳光方向实时计算 |
| `'skybox'` | 天空盒，使用一张立方体贴图 |
| `'image'` | 纯色或单张图片背景，由 `skyColor` / `skyImage` 指定 |
| `'none'` | 不绘制天空 |

本页主要介绍天空盒与大气散射。另外，场景默认开启高度雾（`scene.env.sky.fogType = 'height_fog'`），下面的天空盒示例为了只看天空把它设成了 `'none'`。

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

要点是先用 `device.createCubeTexture()` 建一张空的立方体贴图作为目标，
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

<<< @/../src/tut-34/main.js{40-50 js}

注意创建方向光时并没有显式设置 `sunLight = true`——**场景中第一个被创建的方向光会自动
成为阳光**，所以这里只需要用 `lookAt()` 定好它的朝向，天空就会随之变化。

<div class="showcase" case="tut-34"></div>

### 云层

大气散射天空支持两种云层，通过 `cloudMode` 切换：默认的 `procedural` 2D 云层，以及 WebGPU 上通过 ray marching 绘制的 `volumetric` 体积云。两者都只在 `skyType = 'scatter'` 时绘制，天空盒模式不显示云层。

上面示例左上角的按钮可以在两种云层之间切换。切换只需改 `cloudMode`，再用 `effectiveCloudMode` 读回实际生效的模式（非 WebGPU 后端上体积云会退回 2D 云层，示例因此禁用了体积云按钮）：

<<< @/../src/tut-34/main.js{59-80 js}

#### 2D 云层

2D 云层是用 2D 噪声函数生成的，开销很小，所有后端都可用。有三个可调参数：

```javascript
// 云层覆盖率
scene.env.sky.cloudy = 0.5;

// 云层亮度，默认 15
scene.env.sky.cloudIntensity = 15;

// 风力，影响云层移动速度和方向
scene.env.sky.wind = new Vector2(300, 500);
// 也可以就地修改，避免额外分配
scene.env.sky.wind.setXY(600, 0);
```

> `cloudy` 和 `cloudIntensity` 只在 `skyType` 为 `'scatter'` 时才能设置，其他天空类型下赋值会被静默忽略。因此要先设 `skyType`，再设云层参数。

#### 体积云

需要有层厚、自阴影和多次散射近似的云层时，使用体积云。代价是需要额外的噪声体和天空缓存更新。

```ts
const sky = scene.env.sky;
sky.skyType = 'scatter';
sky.cloudMode = 'volumetric';

const clouds = sky.volumetricCloud;
clouds.layerBottomAltitude = 1500;
clouds.layerHeight = 4000;
clouds.coverage = 0.55;
clouds.density = 0.03;
clouds.wind.setXY(10, 0);
clouds.framesPerUpdate = 64;
clouds.cacheResolution = 768;
```

以上取值都是默认值。所有距离使用大气中的米（换算方式见下方"限制"）。`coverage` 控制云量，`density` 控制厚度，`baseHeightVariation`、`formation` 和噪声缩放控制形状。`viewSampleCountScale` 和 `shadowSampleCountScale` 提高射线采样质量，也会线性增加开销。

**资源与缓存**

默认情况下引擎生成 weather、base noise 和 detail noise。需要固定艺术方向时，可把切片图集分别赋给 `sky.cloudWeatherMap`、`sky.cloudBaseNoise` 和 `sky.cloudDetailNoise`。天空缓存按 `framesPerUpdate` 分帧更新；降低该值能更快响应参数变化，但会增加每帧成本。

调试资源可设置：

```ts
sky.cloudDebugView = 'weather'; // 也可用 baseNoise、detailNoise、densityXY 等
```

**限制**

- `volumetric` 仅 WebGPU。其他后端会通过 `effectiveCloudMode` 自动退回 `procedural`，显示上面介绍的 2D 云层。
- **体积云只在云层下方绘制。** 观察者高度高于 `layerBottomAltitude` 减 500 米时，引擎改画 2D 云层，并在控制台警告一次。此时 `effectiveCloudMode` 仍报告 `'volumetric'`（它只反映后端是否支持）。飞行或高空镜头需要考虑这一点。
- 体积云不是场景几何体，不参与 Mesh LOD、SDF 或物理碰撞。
- 云层参数是大气中的米。世界坐标到大气米的换算由 `scene.env.sky.cameraHeightScale`（每个世界单位对应的大气米数，默认 1）决定，与 `scene.metersPerUnit` 无关。场景单位不是米时，调整 `cameraHeightScale`，否则相机高度和云层的相对位置会不对。
