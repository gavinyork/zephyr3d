# @zephyr3d/base

> Part of [Zephyr3D](https://github.com/gavinyork/zephyr3d) — bringing advanced real-time rendering techniques to the browser.
> A WebGPU-first TypeScript engine with skin, hair, water and terrain rendering, a single-source
> shader system, and a visual editor.

The foundation library shared by every other Zephyr3D package: vectors, matrices, quaternions and
geometry helpers, the virtual file system (VFS), events, reference counting, and the depth
convention constants used across the engine.

It has no dependency on a graphics device, so you can also use it on its own, in workers or under
Node.js.

## Installation

```bash
npm install --save @zephyr3d/base
```

## Example

```ts
import { Vector3, Quaternion } from '@zephyr3d/base';

const up = Vector3.axisPY();
const rotation = Quaternion.fromAxisAngle(up, Math.PI / 2);
const v = rotation.transform(new Vector3(1, 0, 0));
```

If you write custom materials or render passes, use the depth constants exported here
(`DEPTH_CLEAR_VALUE`, `DEPTH_COMPARE_DEFAULT`, ...) instead of hard-coding 0 or 1 — the engine uses
a [reverse-Z depth convention](https://zephyr3d.org/doc/en/reverse-z.html) by default.

## Links

- [Documentation](https://zephyr3d.org/doc/)
- [Demos](https://zephyr3d.org/en/demos.html)
- [Online editor](https://zephyr3d.org/editor/)
- [API reference](https://zephyr3d.org/doc/api/)
- [GitHub](https://github.com/gavinyork/zephyr3d)

Zephyr3D has not reached 1.0 yet and APIs may change between minor versions, so pin your versions.

## License

MIT
