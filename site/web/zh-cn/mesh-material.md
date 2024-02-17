# 网格

网格(Mesh)是由顶点数据和材质构成的渲染对象。

我们使用Mesh对象来表示一个网格。构造一个mesh对象需要三个参数scene, primitive和material，其中scene是场景对象，网格构造后将会添加到该场景。
primitive为网格的顶点数据。可以使用内置的SphereShape,BoxShape,PlaneShape,CylinderShape来创建球体，盒子，平面和圆柱形顶点数据，也可手动填充。
material为该网格的材质，我们支持unlit(非光照)材质，Lambert/Blinn材质和PBR材质。

## 使用预定义网格

系统内置了几种常见的网格顶点数据，例如盒子，球体，圆柱，平面等。

以下代码创建了一个正方体网格并且赋予一个Lambert材质.

在场景中我们添加了一个方向光以便照亮该网格。关于光源和光照我们将在后续章节详细介绍。

```javascript
import { Scene, Application, LambertMaterial, Mesh, OrbitCameraController, PerspectiveCamera, BoxShape } from '@zephyr3d/scene';

// ... ...

// 添加一个方向光以照亮物体
const light = new DirectionalLight(scene);
light.lookAt(Vector3.one(), Vector3.zero(), Vector3.axisPY());

// 创建一个红色Lambert材质
const material = new LambertMaterial();
material.albedoColor = new Vector4(1, 0, 0, 1);

// 创建一个球体网格并赋予刚创建的材质
const sphere = new Mesh(scene, new SphereShape(), material);

// 创建相机
// 创建的网格默认位于世界坐标系原点，我们将摄像机放置在(0,0,4)并看向原点
const camera = new PerspectiveCamera(scene, Math.PI/3, myApp.device.canvas.width/myApp.device.canvas.height, 1, 100);
camera.lookAt(new Vector3(0, 0, 4), new Vector3(0, 0, 0), new Vector3(0, 1, 0));
// Orbit控制器距离设置为4，即摄像机到物体的距离
camera.controller = new OrbitCameraController({ distance: 4 });

```

<div class="showcase" case="tut-5"></div>

下面我们给球体一个PBR材质并添加贴图。

我们使用[AssetManager](/doc/markdown/./scene.assetmanager)类的fetchTexture()方法加载贴图。<br>
[AssetManager.fetchTexture()](/doc/markdown/./scene.assetmanager.fetchtexture)方法接受一个URL地址参数以及一个可选的[Options](/doc/markdown/./scene.texturefetchoptions)对象。<br>

AssetManager会对加载的资源进行缓存，如果该贴图已经加载则不会重新加载。


```javascript

import { AssetManager } from "@zephyr3d/scene";

// ... ...

const assetManager = new AssetManager();

// 创建一个PBR材质
const material = new PBRMetallicRoughnessMaterial();
// 金属度 0.9
material.metallic = 0.9;
// 粗糙度 0.6
material.roughness = 0.6;
// 添加diffuse贴图
assetManager.fetchTexture('assets/images/earthcolor.jpg').then(texture => {
  material.albedoTexture = texture;
});
// 添加法线贴图
assetManager.fetchTexture('assets/images/earthnormal.png', {
  linearColorSpace: true
}).then(texture => {
  material.normalTexture = texture;
});

```

<div class="showcase" case="tut-6"></div>

## 手动填充网格顶点

为了手动填充顶点数据，我们需要创建顶点缓冲区，索引缓冲区设备对象并提交顶点和索引数据。

下面我们通过手动填充顶点数据创建一个无光照的三角形网格

```javascript

  // 创建一个无光照材质
  const material = new UnlitMaterial();
  // 禁止背面剔除
  material.stateSet.useRasterizerState().setCullMode('none');
  // 使用顶点色
  material.vertexColor = true;

  // 填充三角形顶点数据
  const triangle = new Primitive();
  const vertices = myApp.device.createVertexBuffer('position_f32x3', new Float32Array([2, -2, 0, 0, 2, 0, -2, -2, 0]));
  const diffuse = myApp.device.createVertexBuffer('diffuse_u8normx4', new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]));
  const indices = myApp.device.createIndexBuffer(new Uint16Array([0, 1, 2]));
  triangle.setVertexBuffer(vertices);
  triangle.setVertexBuffer(diffuse);
  triangle.setIndexBuffer(indices);
  // 创建网格
  const triangleMesh = new Mesh(scene, triangle, material);

```
<div class="showcase" case="tut-9"></div>

## 加载模型

最常用的创建网格的方法就是加载现有的模型。目前我们支持GLTF/GLB模型。

加载模型可以很方便地通过AssetManager完成。

```javascript

  const assetManager = new AssetManager();
  // 加载模型到场景
  assetManager.fetchModel(scene, 'assets/models/Duck.glb').then(info => {
    info.group.position.setXYZ(0, 0, -10);
  });

```

<div class="showcase" case="tut-10"></div>
