# Installation

Zephyr3d ships as ES6 modules, installed through npm and used with a bundler such as Vite or Webpack.

## Which packages do I need

The engine is split into several packages and you rarely need all of them. Find your case below:

| What you want to do | Install |
| --- | --- |
| Build a 3D app with the Scene API (**most common**) | `@zephyr3d/base` + `@zephyr3d/scene` + one backend |
| Write your own renderer on the Device API | `@zephyr3d/base` + `@zephyr3d/device` + one backend |
| Load glTF/FBX source models at runtime | add `@zephyr3d/loaders` |
| Need a debug GUI panel | add `@zephyr3d/imgui` |

At least one backend package is required; it decides which graphics API the engine runs on:

- `@zephyr3d/backend-webgl` — provides both the WebGL and WebGL2 backends; the most compatible option.
- `@zephyr3d/backend-webgpu` — the WebGPU backend, with better performance. Some advanced features
  (ABuffer OIT, compute shaders) are only available here.

You can install both and choose at runtime based on device capability — see
[Your First Application](en/first-app.md).

## The common combination

For a 3D application that should run on WebGPU where available and WebGL otherwise:

```bash
npm install --save @zephyr3d/base @zephyr3d/scene @zephyr3d/backend-webgl @zephyr3d/backend-webgpu
```

Note that `@zephyr3d/scene` depends on `@zephyr3d/device`, which your package manager installs
automatically — you do not need to declare it.

## What each package does

- **`@zephyr3d/base`**

  Foundation module: math library (`Vector3`, `Matrix4x4`, `Quaternion`, ...), virtual file system,
  events, reference counting. Nearly every project uses it.

- **`@zephyr3d/device`**

  The graphics API abstraction and the shader generator. With the Scene API it is an indirect
  dependency; you only depend on it directly when writing your own render pipeline.

- **`@zephyr3d/backend-webgl`** / **`@zephyr3d/backend-webgpu`**

  The concrete backend implementations, as above.

- **`@zephyr3d/scene`**

  The Scene API: scene graph, materials, lighting, shadows, animation, post-processing and resource
  management. The high-level framework, suited to getting things done quickly.

- **`@zephyr3d/loaders`**

  Importers for source model formats — glTF/GLB, FBX, Alembic and others. **If you use the editor
  workflow and load models as prefabs (`.zprefab`), you do not need this package**, which also keeps
  your bundle smaller. See [Resource Loading and Model Import](en/asset-loading.md) for the tradeoff.

- **`@zephyr3d/imgui`**

  ImGui bindings, useful for debug panels and tooling UI.

## Next

With the packages installed, write [your first application](en/first-app.md).
