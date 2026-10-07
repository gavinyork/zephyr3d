# @zephyr3d/device

> Part of [Zephyr3D](https://github.com/gavinyork/zephyr3d) — bringing advanced real-time rendering techniques to the browser.
> A WebGPU-first TypeScript engine with skin, hair, water and terrain rendering, a single-source
> shader system, and a visual editor.

The graphics abstraction layer of Zephyr3D. It defines a single device API over WebGPU and WebGL2
— buffers, textures, samplers, framebuffers, render and compute programs — together with a shader
system where you write shaders in TypeScript and the engine generates WGSL or GLSL for the active
backend, including the matching bind group and buffer layouts.

Use it directly if you want to build your own renderer; otherwise
[`@zephyr3d/scene`](https://www.npmjs.com/package/@zephyr3d/scene) builds a complete one on top of it.
You also need at least one backend:
[`@zephyr3d/backend-webgpu`](https://www.npmjs.com/package/@zephyr3d/backend-webgpu) and/or
[`@zephyr3d/backend-webgl`](https://www.npmjs.com/package/@zephyr3d/backend-webgl).

## Installation

```bash
npm install --save @zephyr3d/base @zephyr3d/device @zephyr3d/backend-webgpu @zephyr3d/backend-webgl
```

## Write the shader once

```ts
const program = device.buildRenderProgram({
  vertex(pb) {
    this.$inputs.pos = pb.vec3().attrib('position');
    this.$inputs.uv  = pb.vec2().attrib('texCoord0');
    this.$outputs.uv = pb.vec2();

    this.xform = pb.defineStruct([pb.mat4('mvpMatrix')])().uniform(0);

    pb.main(function () {
      this.$builtins.position =
        pb.mul(this.xform.mvpMatrix, pb.vec4(this.$inputs.pos, 1));
      this.$outputs.uv = this.$inputs.uv;
    });
  },

  fragment(pb) {
    this.$outputs.color = pb.vec4();
    this.tex = pb.tex2D().uniform(0);

    pb.main(function () {
      this.$outputs.color = pb.textureSample(this.tex, this.$inputs.uv);
    });
  }
});
```

The same source produces WGSL on WebGPU and GLSL on WebGL2. The
[Writing Shaders](https://zephyr3d.org/doc/en/shader.html) guide shows the generated output side by side, and the
[Device API guide](https://zephyr3d.org/doc/en/device.html) covers the rest of the layer.

## Links

- [Documentation](https://zephyr3d.org/doc/)
- [Demos](https://zephyr3d.org/en/demos.html)
- [Online editor](https://zephyr3d.org/editor/)
- [API reference](https://zephyr3d.org/doc/api/)
- [GitHub](https://github.com/gavinyork/zephyr3d)

Zephyr3D has not reached 1.0 yet and APIs may change between minor versions, so pin your versions.

## License

MIT
