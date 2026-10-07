# @zephyr3d/backend-webgpu

> Part of [Zephyr3D](https://github.com/gavinyork/zephyr3d) — bringing advanced real-time rendering techniques to the browser.
> A WebGPU-first TypeScript engine with skin, hair, water and terrain rendering, a single-source
> shader system, and a visual editor.

The WebGPU backend for Zephyr3D. This is the primary backend: it runs the full feature set,
including compute shaders, which are required for A-buffer order-independent transparency, DOM
shadows, GPU hair and cloth simulation, and the terrain shading cache.

Pair it with [`@zephyr3d/backend-webgl`](https://www.npmjs.com/package/@zephyr3d/backend-webgl)
to fall back to WebGL2 in browsers without WebGPU.

## Installation

```bash
npm install --save @zephyr3d/backend-webgpu @zephyr3d/backend-webgl
```

## Usage

```ts
import { Application } from '@zephyr3d/scene';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

const app = new Application({
  backend: (await backendWebGPU.supported()) ? backendWebGPU : backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});
```

See [Basic Framework](https://zephyr3d.org/doc/en/scene-basic.html) for the full setup.

## Links

- [Documentation](https://zephyr3d.org/doc/)
- [Demos](https://zephyr3d.org/en/demos.html)
- [Online editor](https://zephyr3d.org/editor/)
- [API reference](https://zephyr3d.org/doc/api/)
- [GitHub](https://github.com/gavinyork/zephyr3d)

Zephyr3D has not reached 1.0 yet and APIs may change between minor versions, so pin your versions.

## License

MIT
