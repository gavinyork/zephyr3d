# @zephyr3d/modelgen

> Part of [Zephyr3D](https://github.com/gavinyork/zephyr3d) — bringing advanced real-time rendering techniques to the browser.
> A WebGPU-first TypeScript engine with skin, hair, water and terrain rendering, a single-source
> shader system, and a visual editor.

A dependency-free procedural mesh generator. It takes a declarative model spec — primitives,
surfaces of revolution, Bezier patches, swept curves, CSG booleans and sandboxed script nodes — and
tessellates it into plain vertex and index buffers.

Nothing here touches a graphics device, so it runs in a worker, in the browser, or under Node.js.

## Installation

```bash
npm install --save @zephyr3d/modelgen
```

## Links

- [Documentation](https://zephyr3d.org/doc/)
- [Demos](https://zephyr3d.org/en/demos.html)
- [Online editor](https://zephyr3d.org/editor/)
- [API reference](https://zephyr3d.org/doc/api/)
- [GitHub](https://github.com/gavinyork/zephyr3d)

Zephyr3D has not reached 1.0 yet and APIs may change between minor versions, so pin your versions.

## License

MIT
