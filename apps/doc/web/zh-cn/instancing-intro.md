# 几何体实例化

几何体实例化是一种高效的图形渲染技术，它允许在单个渲染调用中绘制同一渲染对象的多个实例。
这种方法特别适用于需要重复渲染大量相同对象的场景。通过几何体实例化，每个实例共享相同的
几何结构和材质，但可以有不同的位置、不同的旋转和缩放以及不同的材质属性，从而显著减少了
内存占用和提高了渲染效率。

Zephyr3d对于WebGL2和WebGPU设备提供了实例化渲染的支持。在同一场景中，引擎会自动将使用
了相同的几何体和材质的Mesh合并到一个或几个渲染调用。在代码中，你需要为作为实例渲染的对
象赋予相同的几何体和同一材质的副本。之所以需要材质副本是因为即使是同一材质，每一个渲染
实例也可能需要分别设置不同的材质属性。

以下代码创建了若干盒子，通过共享相同的几何体和材质来进行实例化渲染。

```javascript

// 创建几何体
const boxShape = new BoxShape();

// 创建材质
const material = new LambertMaterial();

// 创建几个盒子
for (let i = 0; i < 10; i++) {
  const box = new Mesh(scene);
  // 共享几何体
  box.primitive = boxShape;
  // 同一材质创建不同的副本
  box.material = material.createInstance();
  // 为材质副本设置颜色
  box.material.albedoColor = new Vector4(Math.random(), Math.random(), Math.random(), 1);
  // 设置实例的位置
  box.position.setXYZ(1, 2, 3);
}

```

以下是个完整的示例：

<div class="showcase" case="tut-44"></div>

## 动态合批

通过以上代码创建的Mesh对象在渲染过程中需要逐一进行视锥剪裁，并将其中可见的对象动态合并为一个渲染调用。
这种方式的好处在于通过视锥剪裁控制了实例的数量，缺点在于如果实例数量庞大，剪裁和合并操作将会带来可观
的性能损失。在这种情况下，可以选择静态合批。

## 静态合批

静态合批是通过缓存实例合批的结果达到加速的效果。对于静态批次，实例将不再进行视锥剪裁和动态合并。静态
批次里的对象可以改变位置缩放和旋转，材质副本的属性改变将不再生效。静态合批的使用也很简单，只需要创建
一个BatchGroup节点作为所有渲染实例的父节点即可。

<div class="showcase" case="tut-45"></div>

## 载入模型

对于使用AssetManager加载的模型，可以通过加载选项的[enableInstancing](/doc/markdown/./scene.modelfetchoptions)属性来允许实例化渲染该模型。
添加了该属性，材质会自动调用createInstance()方法。

```javascript

  const instancedModels = [];
  const nonInstancedModels = [];
  // 模型地址
  const modelUrl = 'http://foo/bar.glb';
  for (let i = 0; i < 100; i++) {
    // 加载相同的模型并设置enableInstancing属性为true，这些模型自动使用实例化渲染
    instancedModels.push(await getEngine().resourceManager.fetchModel(url, scene, {
      enableInstancing: true
    }));
  }
  for (let i = 0; i < 100; i++) {
    // 加载相同的模型但未设置enableInstancing属性为true，这些模型不会使用实例化渲染
    nonInstancedModels.push(await getEngine().resourceManager.fetchModel(url, scene));
  }

```

## 透明物体

通常情况下，透明物体需要由远及近渲染，但是如果使用了几何体实例化，则无法通过距离排序。
如果你对透明物体使用几何体实例化，推荐使用顺序无关的透明物体渲染技术(OIT)。我们目前
支持两种OIT渲染方式.

1. Weighted Blended，适用于WebGL,WebGL2和WebGPU设备
2. Per-Pixel Linked List，仅适用于WebGPU设备

具体参见：[OIT渲染](zh-cn/oit.md)



