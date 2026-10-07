# @zephyr3d/loaders

> Part of [Zephyr3D](https://github.com/gavinyork/zephyr3d) — bringing advanced real-time rendering techniques to the browser.
> A WebGPU-first TypeScript engine with skin, hair, water and terrain rendering, a single-source
> shader system, and a visual editor.

Model importers for Zephyr3D: glTF/GLB, FBX, Alembic and hair curves. The glTF importer handles
`KHR_draco_mesh_compression`, `EXT_meshopt_compression` / `KHR_meshopt_compression`,
`KHR_mesh_quantization` and `KHR_texture_basisu` without extra setup.

## Installation

```bash
npm install --save @zephyr3d/loaders
```

## Usage

Register the importers your app needs, then load models through the resource manager:

```ts
import { getEngine } from '@zephyr3d/scene';
import { GLTFImporter, FBXImporter } from '@zephyr3d/loaders';

const resources = getEngine().resourceManager;
resources.setModelLoader('model/gltf+json', new GLTFImporter());
resources.setModelLoader('model/gltf-binary', new GLTFImporter());
resources.setModelLoader('model/fbx', new FBXImporter());

const model = await resources.fetchModel('/models/character.glb', scene);
```

[Asset Loading](https://zephyr3d.org/doc/en/asset-loading.html) covers the options, the virtual file system, and where
the Draco decoder is served from.

## Links

- [Documentation](https://zephyr3d.org/doc/)
- [Demos](https://zephyr3d.org/en/demos.html)
- [Online editor](https://zephyr3d.org/editor/)
- [API reference](https://zephyr3d.org/doc/api/)
- [GitHub](https://github.com/gavinyork/zephyr3d)

Zephyr3D has not reached 1.0 yet and APIs may change between minor versions, so pin your versions.

## License

MIT
