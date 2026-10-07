# @zephyr3d/backend-webgl

> Part of [Zephyr3D](https://github.com/gavinyork/zephyr3d) — bringing advanced real-time rendering techniques to the browser.
> A WebGPU-first TypeScript engine with skin, hair, water and terrain rendering, a single-source
> shader system, and a visual editor.

The WebGL2 backend for Zephyr3D, used as the fallback when WebGPU is not available. It covers most
of the engine without compute shaders; features that need compute (for example GPU hair and cloth
simulation or A-buffer transparency) fall back or are disabled. WebGL1 is no longer supported.

## Installation

```bash
npm install --save @zephyr3d/backend-webgl @zephyr3d/backend-webgpu
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

Because missing capabilities fall back silently, test on the backends you actually target.

## Links

- [Documentation](https://zephyr3d.org/doc/)
- [Demos](https://zephyr3d.org/en/demos.html)
- [Online editor](https://zephyr3d.org/editor/)
- [API reference](https://zephyr3d.org/doc/api/)
- [GitHub](https://github.com/gavinyork/zephyr3d)

Zephyr3D has not reached 1.0 yet and APIs may change between minor versions, so pin your versions.

## License

MIT
