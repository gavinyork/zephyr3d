# Depth Convention (Reverse-Z)

The engine supports two depth conventions, chosen once **at load time** and immutable for the lifetime
of the page:

- **Reverse-Z (default)** — device depth 1 at the near plane, 0 at the far plane.
- **Standard-Z** — device depth 0 at the near plane, 1 at the far plane.

For the same eye-space position the two satisfy `standardDepth + reverseDepth === 1`.

## Why Reverse-Z is the default

Floating point has its highest precision near 0. The standard convention maps the far plane to 1, and
perspective projection already crowds depth values towards the far end — the two effects compound into
very poor precision in the distance, which shows up as z-fighting and flickering far from the camera.

Reverse-Z maps the near plane to 1 and the far plane to 0, so the region where float precision is
highest coincides with where the depth distribution is densest. **Combined with a floating-point depth
buffer** (`d32f` / `d32fs8`, the default on WebGPU and WebGL2) the depth error distribution becomes
nearly uniform and far-distance z-fighting is greatly reduced.

## Switching conventions

Reverse-Z is already the default, so configuration is only needed to go back to the standard
convention.

The build-time define is preferred, since it lets your bundler eliminate the unused code path:

```js
// vite.config.js / esbuild
define: { __ZEPHYR3D_REVERSE_Z__: 'false' }

// rollup (@rollup/plugin-replace)
replace({ preventAssignment: true, values: { __ZEPHYR3D_REVERSE_Z__: 'false' } })
```

Without a bundler, set the global **before importing any `@zephyr3d/*` module**:

```html
<script>globalThis.__ZEPHYR3D_REVERSE_Z__ = false;</script>
<script type="module" src="app.js"></script>
```

Resolution order is: build-time define → `globalThis` variable → default (Reverse-Z).

The active convention is readable from `@zephyr3d/base`:

```javascript
import { REVERSE_Z, Z_CONVENTION } from '@zephyr3d/base';

console.log(REVERSE_Z);      // true / false
console.log(Z_CONVENTION);   // 'reverse' / 'standard'
```

## Always use the constants

**This is the most important point on this page.** Any code touching depth values or depth comparisons
must not hard-code literals like 0, 1, `'le'` or `'lt'` — their meaning is inverted between the two
conventions. `@zephyr3d/base` exports a set of constants that are correct under both:

| Constant | Purpose |
| --- | --- |
| `DEPTH_CLEAR_VALUE` | Value to clear the depth buffer to |
| `DEPTH_NEAREST` | Device depth at the near plane |
| `DEPTH_FARTHEST` | Device depth at the far plane (background/sky) |
| `DEPTH_COMPARE_DEFAULT` | Default depth test (passes when closer or equal) |
| `DEPTH_COMPARE_CLOSER` | Passes when strictly closer |
| `DEPTH_COMPARE_CLOSER_EQUAL` | Passes when closer or equal |
| `DEPTH_COMPARE_FARTHER` | Passes when strictly farther |
| `DEPTH_COMPARE_FARTHER_EQUAL` | Passes when farther or equal |
| `DEPTH_REDUCE_CLOSER` | Reduction picking the closer of two depths (`'min'` or `'max'`) |
| `DEPTH_REDUCE_FARTHER` | Reduction picking the farther one |
| `closerDepth(a, b)` | Returns the closer depth value |
| `fartherDepth(a, b)` | Returns the farther depth value |

```javascript
import { DEPTH_CLEAR_VALUE, DEPTH_COMPARE_DEFAULT } from '@zephyr3d/base';

// Correct
device.clearFrameBuffer(clearColor, DEPTH_CLEAR_VALUE, 0);
depthState.setCompareFunc(DEPTH_COMPARE_DEFAULT);

// Wrong: under reverse-Z this clears depth to "nearest", culling everything
device.clearFrameBuffer(clearColor, 1, 0);
```

When writing custom material or custom pass shaders, use the `ShaderHelper` depth utilities
(`linearDepthToNonLinear`, `nonLinearDepthToLinear` and friends) rather than writing your own depth
comparisons and linearization.

### Where literals like to hide

In practice the problems rarely come from explicit depth comparisons. They come from **depth endpoint
literals buried inside geometric tricks**. Cases actually hit during development:

- a temporary framebuffer's `clearDepth` written as a literal 1;
- hand-written clip-volume inequalities that assume an NDC depth direction;
- reprojection code constructing near/far plane points as `vec4(ndc, -1, 1)`;
- **a shadow map's colour attachment clear colour** set to 1 — under reverse-Z "1" means nearest, so
  empty regions become phantom occluders.

That last one is especially subtle: some shadow modes (the linear encoding used for spot and point
lights) sample the **colour attachment** rather than the depth attachment, so whether a flip is needed
depends on the light type and cannot be applied uniformly.

## Backend behaviour

| Backend | Reverse-Z support |
| --- | --- |
| **WebGPU** | Full benefit, no extra requirements |
| **WebGL2** | Full benefit with `EXT_clip_control` (Chromium 121+); without it a shader-side fallback keeps rendering correct but limits the precision gain |
| **WebGL** | Functionally supported, but WebGL1 has no float depth format, so there is **no precision gain** |

The engine detects `EXT_clip_control` at device creation and switches the clip depth range to `[0, 1]`.
For debugging you can set `globalThis.__ZEPHYR3D_NO_CLIP_CONTROL__ = true` before creating the device to
force the shader-side fallback and verify that path.

## Known limitation

**Oblique-clipped projections do not work under Reverse-Z.** `Matrix4x4.obliqueProjection()` and
`obliquePerspective()` throw an explicit error under reverse-Z. These are used for planar water
reflections, so **planar reflections currently require switching back to Standard-Z**.

## See also

- [Create Device](en/device.md) — devices and backends
- [Render States](en/renderstate.md) — depth state configuration
- [Custom Materials](en/user-material.md) — handling depth in material shaders
