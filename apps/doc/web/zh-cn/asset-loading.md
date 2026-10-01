# 资源加载与模型导入

Zephyr3D 将资源访问和具体存储位置分离。运行时代码通常使用 `ResourceManager`，而 `ResourceManager` 会把带缓存的加载工作交给内部的 `AssetManager`，并通过当前配置的 VFS 读取文件。

这一层可用于加载纹理、材质、图元、字体、模型文件、预制体，以及普通的 text/json/binary 数据。

## 资源流程

```text
Application runtimeOptions.VFS
        |
        v
ResourceManager
        |
        v
AssetManager
        |
        v
已注册的纹理 / 模型加载器
```

可以从引擎实例取得 `ResourceManager`：

```ts
import { getEngine } from '@zephyr3d/scene';

const resourceManager = getEngine().resourceManager;
```

传给资源接口的路径都是 VFS 路径。使用 `HttpFS` 时，`/assets/model.glb` 会解析到 HTTP 根目录下；使用内存文件系统或 IndexedDB 文件系统时，同一个路径也可以指向本地保存的数据。

## 加载纹理

使用 `fetchTexture()` 加载浏览器图片格式，以及引擎内置纹理加载器支持的 DDS、HDR、TGA、KTX2 等格式。

使用 Basis Universal 编码（ETC1S 或 UASTC）的 KTX2 文件会在 Web Worker 中转码为设备支持的最佳压缩格式：桌面 GPU 上为 BC7 或 BC1/BC3，移动端为 ETC2 或 ASTC，都不支持时退回未压缩的 RGBA8。转码器随 `@zephyr3d/scene` 发布，在首次加载 KTX2 纹理时才下载。Vite 和 webpack 5 会自动处理；使用其他打包工具时，请把 `@zephyr3d/scene/dist` 中 KTX2 加载器旁边的 `basis` 目录复制到输出目录，并将 `KTX2Loader.transcoderPath` 指向它。

```ts
const baseColor = await getEngine().resourceManager.fetchTexture('/textures/rocks-albedo.png');
const normal = await getEngine().resourceManager.fetchTexture('/textures/rocks-normal.png', {
  linearColorSpace: true
});

material.albedoTexture = baseColor;
material.normalTexture = normal;
```

颜色贴图通常使用默认的 sRGB 路径。数据贴图、法线贴图、金属粗糙度贴图、遮罩和高度图通常应设置 `linearColorSpace: true`。

常用选项：

| 选项 | 用途 |
| --- | --- |
| `mimeType` | 文件扩展名不可靠时手动指定 MIME 类型 |
| `linearColorSpace` | 按线性数据加载，不做 sRGB 转换 |
| `texture` | 将加载结果写入已有纹理对象 |
| `samplerOptions` | 上传或重打包纹理时使用的采样器设置 |
| `overrideVFS` | 仅本次加载改用另一个 VFS |

## 加载材质、图元和字体

编辑器生成的资源可以直接加载：

```ts
const material = await getEngine().resourceManager.fetchMaterial('/assets/ground.zmtl');
const primitive = await getEngine().resourceManager.fetchPrimitive('/assets/rock.zprim');
const fontAsset = await getEngine().resourceManager.fetchFontAsset('/assets/Inter-Regular.ttf', {
  pageSize: 1024,
  glyphSize: 64
});
```

`fetchFontAsset()` 主要供 MSDF 文本节点使用。字体会按路径缓存；同一路径后续调用会复用第一次加载时的 atlas 设置。

## 注册模型加载器

模型加载基于加载器机制。安装 `@zephyr3d/loaders` 后，注册应用需要的导入器：

```ts
import { GLTFImporter, FBXImporter } from '@zephyr3d/loaders';
import { getEngine } from '@zephyr3d/scene';

const resources = getEngine().resourceManager;

resources.setModelLoader('model/gltf+json', new GLTFImporter());
resources.setModelLoader('model/gltf-binary', new GLTFImporter());
resources.setModelLoader('model/fbx', new FBXImporter());
```

实际 MIME 类型来自当前 VFS。如果服务器没有返回可靠的 MIME 类型，或者 VFS 无法根据扩展名推断类型，可以在加载时通过 `mimeType` 手动指定。未知扩展名会退回到 `application/octet-stream`；只有在你确实希望某个加载器处理不明确的二进制文件时，才注册这个 MIME 类型。

## 加载模型

`fetchModel()` 会从源模型创建场景节点层级。只要导入器提供数据，它可以加载网格、骨骼、动画、Morph Target，以及模型中包含的 Joint Dynamics 数据。

```ts
const model = await getEngine().resourceManager.fetchModel('/models/character.glb', scene, {
  enableInstancing: false,
  loadMeshes: true,
  loadSkeletons: true,
  loadAnimations: true,
  loadJointDynamics: true
});

if (model) {
  model.parent = scene.rootNode;
  model.position.setXYZ(0, 0, 0);

  const names = model.animationSet.getAnimationNames();
  if (names.length > 0) {
    model.animationSet.playAnimation(names[0], { repeat: 0 });
  }
}
```

GLTF importer 无需额外配置即可读取压缩的几何与纹理：`KHR_draco_mesh_compression`、`EXT_meshopt_compression` / `KHR_meshopt_compression`、`KHR_mesh_quantization` 和 `KHR_texture_basisu`。Draco 解码器随 `@zephyr3d/loaders` 发布，在首次加载 Draco 模型时才下载；如需从其他位置提供，请设置 `GLTFImporter.dracoDecoderPath`。如果页面已经定义了全局的 `DracoDecoderModule`，会继续使用它。

## 共享模型数据

模型源数据在内部会缓存为 `SharedModel`。缓存仍然有效时，多次从同一个模型创建节点不需要重新解析文件。

只有在你确实需要先拿到可复用的模型数据时，才直接使用 `AssetManager.fetchModelData()`：

```ts
const resources = getEngine().resourceManager;
const sharedModel = await resources.assetManager.fetchModelData('/models/tree.glb');

const treeA = await sharedModel.createSceneNode(
  resources,
  scene,
  true,  // 启用 instancing
  true,  // 加载网格
  true,  // 加载骨骼
  true,  // 加载动画
  true,  // 加载 joint dynamics
  resources.VFS
);
```

普通应用代码优先使用 `ResourceManager.fetchModel()`。

## 预制体

预制体是序列化后的 `SceneNode` 树，通常由编辑器生成，也可以通过 `ResourceManager.serializeObject()` 生成。导入模型后，如果你需要保存编辑过的材质、节点属性、脚本、Morph 设置或引擎专有数据，应使用预制体。

产品中加载模型有两种常见方式：一种是直接加载 glTF、FBX、VRM 等支持的源模型文件；另一种是在编辑器中先把这些模型导入并保存为 prefab，然后在产品运行时通过 `instantiatePrefab()` 加载。更推荐后者，因为运行时只需要恢复序列化后的引擎对象图，不必把 glTF/FBX/VRM 等模型加载器代码打进产品包里，可以减小包体并减少运行时导入逻辑。

```ts
const duck = await getEngine().resourceManager.instantiatePrefab(scene.rootNode, '/assets/Duck.zprefab');

if (duck) {
  duck.position.setXYZ(0, -0.5, 0);
}
```

直接加载模型会从源文件重新导入。加载预制体会恢复序列化后的引擎对象图。需要持久化编辑器状态时，优先使用预制体。

## 原始数据

`AssetManager` 也可以缓存普通文件：

```ts
const text = await getEngine().resourceManager.assetManager.fetchTextData('/shaders/custom.txt');
const json = await getEngine().resourceManager.assetManager.fetchJsonData('/config/level.json');
const bytes = await getEngine().resourceManager.assetManager.fetchBinaryData('/data/mesh.bin');
```

这些接口适合加载和引擎资源放在同一个 VFS 中的游戏数据或工具数据。

## 缓存说明

资源加载是异步且带缓存的。对同一路径重复调用时，通常会复用同一个进行中的 Promise，或复用已加载资源的弱引用。

切换项目、批量替换源资源，或者在类似编辑器的工具中需要清理资源表时，可以调用 `resourceManager.clearCache()`。清理缓存不会强制释放仍被场景引用的对象。
