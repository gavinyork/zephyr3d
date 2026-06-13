# Asset Loading and Model Import

Zephyr3D separates asset access from the concrete storage location. Runtime code usually talks to `ResourceManager`, while `ResourceManager` delegates cached loading work to its `AssetManager` and reads files through the configured VFS.

Use this layer for textures, materials, primitives, fonts, model files, prefabs, and raw text/json/binary data.

## Resource Flow

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
registered texture/model loaders
```

`ResourceManager` is available from the engine:

```ts
import { getEngine } from '@zephyr3d/scene';

const resourceManager = getEngine().resourceManager;
```

The paths passed to resource methods are VFS paths. With `HttpFS`, `/assets/model.glb` is resolved under the HTTP root. With an in-memory or IndexedDB file system, the same path can point to data stored locally.

## Loading Textures

Use `fetchTexture()` for browser image formats and the built-in texture loaders registered by the engine, including DDS, HDR, and TGA.

```ts
const baseColor = await getEngine().resourceManager.fetchTexture('/textures/rocks-albedo.png');
const normal = await getEngine().resourceManager.fetchTexture('/textures/rocks-normal.png', {
  linearColorSpace: true
});

material.albedoTexture = baseColor;
material.normalTexture = normal;
```

Color textures should normally use the default sRGB path. Data textures, normal maps, metallic-roughness maps, masks, and height maps should use `linearColorSpace: true`.

Useful options:

| Option | Use |
| --- | --- |
| `mimeType` | Override the MIME type when the file extension is ambiguous |
| `linearColorSpace` | Load texture data without sRGB conversion |
| `texture` | Upload the loaded data into an existing texture object |
| `samplerOptions` | Provide sampler settings used during upload or repacking |
| `overrideVFS` | Load this asset from a different VFS than the app default |

## Loading Materials, Primitives, and Fonts

Editor-authored resources can be loaded directly:

```ts
const material = await getEngine().resourceManager.fetchMaterial('/assets/ground.zmtl');
const primitive = await getEngine().resourceManager.fetchPrimitive('/assets/rock.zprim');
const fontAsset = await getEngine().resourceManager.fetchFontAsset('/assets/Inter-Regular.ttf', {
  pageSize: 1024,
  glyphSize: 64
});
```

`fetchFontAsset()` is used by the MSDF text nodes. It caches the `FontAsset` by path; later calls with the same path reuse the first loaded atlas settings.

## Registering Model Loaders

Model loading is loader-based. Install `@zephyr3d/loaders`, then register the importers your app needs:

```ts
import { GLTFImporter, FBXImporter } from '@zephyr3d/loaders';
import { getEngine } from '@zephyr3d/scene';

const resources = getEngine().resourceManager;

resources.setModelLoader('model/gltf+json', new GLTFImporter());
resources.setModelLoader('model/gltf-binary', new GLTFImporter());
resources.setModelLoader('model/fbx', new FBXImporter());
```

The exact MIME type comes from the active VFS. If the server does not send a reliable MIME type, or the VFS cannot infer it from the extension, pass `mimeType` when loading. Unknown extensions fall back to `application/octet-stream`; register that MIME type only if you intentionally want a loader to handle ambiguous binary files.

## Loading Models

`fetchModel()` creates a scene-node hierarchy from a source model. It can load meshes, skeletons, animations, morph targets, and model-provided Joint Dynamics data when the importer provides them.

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

If a glTF/GLB file uses Draco mesh compression, make the Draco decoder factory available as `window.DracoDecoderModule` before loading the model. The current GLTF importer checks that global when it encounters `KHR_draco_mesh_compression`.

## Shared Model Data

Internally, model source data is cached as `SharedModel`. Creating a node from a model does not require parsing the file again while the cached shared data is alive.

Use `AssetManager.fetchModelData()` only when you intentionally need reusable model data before instantiating nodes:

```ts
const resources = getEngine().resourceManager;
const sharedModel = await resources.assetManager.fetchModelData('/models/tree.glb');

const treeA = await sharedModel.createSceneNode(
  resources,
  scene,
  true,  // enable instancing
  true,  // load meshes
  true,  // load skeletons
  true,  // load animations
  true,  // load joint dynamics
  resources.VFS
);
```

For normal application code, prefer `ResourceManager.fetchModel()`.

## Prefabs

Prefabs are serialized `SceneNode` trees, usually produced by the editor or by `ResourceManager.serializeObject()`. They are useful after import when you want to keep edited materials, node properties, scripts, morph settings, and engine-specific data.

In a product build, models can be loaded in two common ways: load supported source model files directly, such as glTF, FBX, or VRM, or import those files in the editor first and save them as prefabs, then load them at runtime with `instantiatePrefab()`. The prefab workflow is recommended for shipped products because runtime code only needs to restore the serialized engine object graph; it does not need to include glTF/FBX/VRM importer code in the bundle, which reduces package size and removes runtime import overhead.

```ts
const duck = await getEngine().resourceManager.instantiatePrefab(scene.rootNode, '/assets/Duck.zprefab');

if (duck) {
  duck.position.setXYZ(0, -0.5, 0);
}
```

Direct model loading imports from the source file. Prefab loading restores the serialized engine object graph. Use prefabs when you need to persist editor-authored state.

## Raw Data

The asset manager can also cache raw files:

```ts
const text = await getEngine().resourceManager.assetManager.fetchTextData('/shaders/custom.txt');
const json = await getEngine().resourceManager.assetManager.fetchJsonData('/config/level.json');
const bytes = await getEngine().resourceManager.assetManager.fetchBinaryData('/data/mesh.bin');
```

Use these methods for game data or tool data that should live in the same VFS as engine assets.

## Cache Notes

Asset loading is asynchronous and cached. Repeated calls for the same path normally reuse the same in-flight promise or a weak reference to the loaded resource.

Call `resourceManager.clearCache()` when you need to evict cached asset references, for example after switching projects or replacing many source files in an editor-like tool. Clearing the cache does not forcibly dispose objects that are still referenced by your scene.
