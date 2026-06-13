# Serialization, Scenes, and Prefabs

Zephyr3D can serialize engine objects to JSON and restore them later. The serialization system is owned by `ResourceManager` and is used by scene files, prefabs, editor-authored assets, terrain/water data, materials, animation clips, scripts, and many scene nodes.

Use serialization when you need persistent engine state. Use model import when you only need to load the source model again.

## What Is Serialized

The built-in registry already covers common runtime objects:

- Scene and scene nodes
- Cameras, lights, meshes, sprites, text, terrain, water, and particle systems
- Built-in materials and material blueprint data
- Primitive shapes and mesh primitives
- Animation clips, keyframe tracks, morph tracks, geometry-cache tracks, skeletons, and skin bindings
- Script attachments

Only registered classes and registered properties are serialized. Ordinary JavaScript fields are ignored unless they have serialization metadata.

## Loading and Saving a Scene

Scene files are stored as JSON in the active VFS.

```ts
import { getEngine } from '@zephyr3d/scene';

const resources = getEngine().resourceManager;

const scene = await resources.loadScene('/scenes/level-01.json');

if (scene) {
  getEngine().setRenderable(scene, 0);
}
```

To save:

```ts
await getEngine().resourceManager.saveScene(scene, '/scenes/level-01.json');
```

The target VFS must support writing. For example, `MemFS` and `IDBFS` can be used in editor-like workflows, while a read-only HTTP file system usually cannot save files back to the server.

## Prefabs

A prefab is a serialized `SceneNode` tree. It is useful for reusable objects such as imported models with edited materials, scripted interactive objects, props, UI markers, particle effects, water patches, or terrain chunks.

```ts
const node = await getEngine().resourceManager.instantiatePrefab(scene.rootNode, '/prefabs/tree.zprefab');

if (node) {
  node.position.setXYZ(5, 0, -3);
}
```

Prefab files use a small envelope:

```json
{
  "type": "SceneNode",
  "data": {
    "ClassName": "SceneNode",
    "Object": {}
  }
}
```

The `data` field is the normal serialized object. `instantiatePrefab()` checks the envelope, creates the node, assigns `prefabId`, attaches it to the requested parent, and gives the instance a new persistent id.

## Serializing Objects

Use `serializeObject()` for low-level serialization of a single registered object. The optional `asyncTasks` array collects deferred writes for embedded assets.

```ts
const asyncTasks: Promise<unknown>[] = [];
const data = await getEngine().resourceManager.serializeObject(node, null, asyncTasks);

await Promise.all(asyncTasks);

const prefab = {
  type: 'SceneNode',
  data
};

await getEngine().VFS.writeFile('/prefabs/box.zprefab', JSON.stringify(prefab, null, 2), {
  encoding: 'utf8',
  create: true
});
```

Use `deserializeObject()` to reconstruct a registered object from JSON:

```ts
const restored = await getEngine().resourceManager.deserializeObject(scene.rootNode, prefab.data);

if (restored) {
  restored.parent = scene.rootNode;
}
```

For normal scene files and prefab files, prefer `loadScene()`, `saveScene()`, and `instantiatePrefab()`.

## Asset Identity

`ResourceManager` tracks asset ids for loaded resources. This lets serialization write a reference to an existing asset instead of embedding all of its data again.

```ts
const texture = await resources.fetchTexture('/textures/albedo.png');

console.log(resources.getAssetId(texture)); // /textures/albedo.png
```

You can also associate an id manually:

```ts
resources.setAssetId(customTexture, '/generated/custom-texture.png');
```

This is useful for editor tools that create assets first and then serialize scene nodes that refer to those assets.

## Registering Custom Serializable Classes

Custom classes must be registered before they can be serialized. A registration describes the class name, constructor, optional parent class, and property accessors.

```ts
import type { SerializableClass } from '@zephyr3d/scene';

class GameSettings {
  speed = 1;
}

const gameSettingsClass: SerializableClass = {
  name: 'GameSettings',
  ctor: GameSettings,
  getProps() {
    return [
      {
        name: 'speed',
        type: 'float',
        get(this: GameSettings, value) {
          value.num[0] = this.speed;
        },
        set(this: GameSettings, value) {
          this.speed = value.num[0];
        }
      }
    ];
  }
};

getEngine().resourceManager.registerClass(gameSettingsClass);
```

After registration, the object can be passed to `serializeObject()` and `deserializeObject()` like built-in classes.

## Practical Guidance

Use direct model loading for read-only source assets such as `.glb`, `.gltf`, `.fbx`, and `.vrm`.

Use prefabs when the runtime object has engine-side edits that are not part of the source model: replaced materials, scripts, edited transforms, morph target weights, imported Joint Dynamics settings, custom metadata, or editor-authored children.

Use scene serialization for complete level state. It captures the scene graph and references assets through the VFS, so keep the saved scene and its referenced assets together when moving projects.
