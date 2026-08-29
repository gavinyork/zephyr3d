# @zephyr3d/backend-null

A GPU-less device backend for [zephyr3d](https://github.com/gavinyork/zephyr3d), intended for unit testing.

The null backend implements the whole `AbstractDevice` interface with plain JavaScript objects:

- buffers and textures keep their content in system memory, so writes can be read back,
- draw, clear and copy calls are recorded instead of executed,
- no WebGL/WebGPU context, canvas or other browser API is required.

That makes it possible to unit test device-facing engine logic (render graph, render passes, materials,
resource lifetimes) without hand-writing device mocks.

## Installation

```npm install --save-dev @zephyr3d/backend-null```

## Usage

```ts
import { createNullDevice } from '@zephyr3d/backend-null';
import { Vector4 } from '@zephyr3d/base';

const device = await createNullDevice({ type: 'webgl2', width: 256, height: 256 });

const color = device.createTexture2D('rgba8unorm', 256, 256)!;
const fb = device.createFrameBuffer([color], null);

device.beginFrame();
device.setFramebuffer(fb);
device.clearFrameBuffer(new Vector4(0, 0, 0, 1), 1, 0);
device.endFrame();

expect(device.getCommandCount('clear')).toBe(1);
expect(device.getCommands('setFramebuffer')[0].framebuffer).toBe(fb);
```

The device can also be used through the regular backend interface, for example when driving an
`Application`:

```ts
import { backendNull } from '@zephyr3d/backend-null';
```

## Emulated device type

`device.type` defaults to `'webgl2'` and can be set through the `type` option to `'webgl'`,
`'webgl2'`, `'webgpu'` or `'null'`. The type selects both the shader language emitted by the program
builder and the device specific code paths taken by the engine, so shader generation tests should
pick the type they want to exercise. Shader generation is not supported for type `'null'`.

Device capabilities are derived from the emulated type and can be overridden per device:

```ts
const device = await createNullDevice({
  type: 'webgpu',
  caps: { shaderCaps: { supportShaderF16: false } }
});
```

## Recorded commands

`device.commands` holds the recorded command log. `device.getCommands(type)` and
`device.getCommandCount(type)` filter it, and `device.clearCommands()` resets it. Recording can be
disabled with `recordCommands: false`, and the log length is capped by `maxCommandLogSize`
(4096 by default).

Validation problems are reported to the console by default; pass `strict: true` to have them throw
instead.
