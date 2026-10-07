# @zephyr3d/scene

> Part of [Zephyr3D](https://github.com/gavinyork/zephyr3d) — bringing advanced real-time rendering techniques to the browser.
> A WebGPU-first TypeScript engine with skin, hair, water and terrain rendering, a single-source
> shader system, and a visual editor.

The complete renderer of Zephyr3D, built on
[`@zephyr3d/device`](https://www.npmjs.com/package/@zephyr3d/device): scene graph, cameras, PBR
materials, clustered lighting, shadows, post-processing, animation, terrain, sky and water,
organized behind a render graph. This is the package most applications start with.

- **Characters** — skin with subsurface scattering and transmission, eyes, and hair with
  Kajiya-Kay and Marschner shading expanded into strands on the GPU.
- **Natural environments** — FFT, Gerstner or FBM ocean water, clipmap terrain with runtime
  texturing and grass, atmospheric sky and height fog.
- **Shadows and transparency** — PCF, PCSS, ESM, VSM, SSM and DOM shadows with cascades, and three
  order-independent transparency backends.
- **Lighting and post-processing** — PBR with image-based lighting, clustered and rect area
  lights, TAA, SSGI, SSR, SSAO, bloom and tonemapping.

## Installation

```bash
npm install --save @zephyr3d/base @zephyr3d/scene @zephyr3d/backend-webgpu @zephyr3d/backend-webgl
```

## Example

A lit sphere you can orbit around, on WebGPU with a WebGL2 fallback:

```ts
import { Vector3, Vector4 } from '@zephyr3d/base';
import {
  Scene, Application, LambertMaterial, Mesh,
  OrbitCameraController, PerspectiveCamera, SphereShape,
  DirectionalLight, getInput, getEngine
} from '@zephyr3d/scene';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

const myApp = new Application({
  backend: (await backendWebGPU.supported()) ? backendWebGPU : backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

myApp.ready().then(function () {
  const scene = new Scene();
  const light = new DirectionalLight(scene);
  light.lookAt(Vector3.one(), Vector3.zero(), Vector3.axisPY());

  const material = new LambertMaterial();
  material.albedoColor = new Vector4(1, 0, 0, 1);
  new Mesh(scene, new SphereShape(), material);

  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 1, 100);
  scene.mainCamera.lookAt(new Vector3(0, 0, 4), Vector3.zero(), Vector3.axisPY());
  scene.mainCamera.controller = new OrbitCameraController();
  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);

  getEngine().setRenderable(scene, 0);
  myApp.run();
});
```

To load glTF or FBX models, add [`@zephyr3d/loaders`](https://www.npmjs.com/package/@zephyr3d/loaders).

## Links

- [Documentation](https://zephyr3d.org/doc/)
- [Demos](https://zephyr3d.org/en/demos.html)
- [Online editor](https://zephyr3d.org/editor/)
- [API reference](https://zephyr3d.org/doc/api/)
- [GitHub](https://github.com/gavinyork/zephyr3d)

Zephyr3D has not reached 1.0 yet and APIs may change between minor versions, so pin your versions.

## License

MIT
