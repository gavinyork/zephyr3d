# Particles and Sprites

Zephyr3D provides two related billboard systems:

- `Sprite` renders a single camera-facing quad.
- `ParticleSystem` renders many camera-facing quads with per-particle movement and lifetime.

Use sprites for icons, markers, simple decals, and 2D elements in 3D space. Use particle systems for smoke, sparks, dust, fireflies, magic effects, and other repeated transient visuals.

> The code on this page is taken from the source of the runnable example `tut-90` below, which generates all of its textures in code. Only the snippet that loads particle textures from files is illustrative and leaves out application setup; `getEngine` comes from `@zephyr3d/scene`.

## Example

<div class="showcase" case="tut-90"></div>

A particle emitter (the small bright ball) circles the centre of the scene and keeps emitting particles that go from bright yellow to dark red and end as smoke. A map pin sprite sits on top of each of the three posts, and a star sprite spins in the middle. The panel in the top left:

- **Shape / Spawn**: switches the emitter shape `emitterShape` and `emitterBehavior`.
- **Blend**: the particle material's `blendMode`, `additive` or `blend`.
- **World space**: toggles `worldSpace`. The emitter is always moving, so the difference between the two spaces is plain to see.
- **Continuous**: when unchecked, sets `emitCount` to 0 to stop continuous emission.
- **Weighted OIT**: the camera's `oitMode`.
- **Burst**: calls `newParticle()` to create 200 particles at once.

## Sprite

<<< @/../src/tut-90/main.js#sprite

A `Sprite` is a square with sides of 1 that always faces the camera; **its width and height come from the X and Y of the node's `scale`**, in world units. Constructed without a material, it creates a `StandardSpriteMaterial` of its own.

`StandardSpriteMaterial` outputs the texture colour as is, unaffected by lighting, and is plain white without a texture. Its `blendMode` defaults to `'none'`, which draws it as an opaque object: transparent parts of the texture come out solid (usually black). For icons with a transparent background set it to `'blend'` as the example does, or use `alphaCutoff` for a hard cut-out edge.

The example's icons share one 2×2 atlas. The controls it uses:

| Control | Description |
| --- | --- |
| `anchorX`, `anchorY` (node) | Where the pivot sits inside the quad, (0, 0) being the bottom-left corner; default (0.5, 0.5). The example uses (0.5, 0), so the tip of the pin lands exactly on the node position |
| `material.setUVInfo(left, bottom, right, top)` | Which rectangle of the texture to show. **V counts up from the bottom edge of the image**; the example's `useAtlasCell()` turns an atlas row and column into these four numbers |
| `uvTopLeft`, `uvBottomRight` (node) | Read and write the same values as `setUVInfo()`, (left, bottom) and (right, top) respectively. The top/bottom in their names runs against the V-up convention; go by the parameter order of `setUVInfo()` |
| The node's rotation around Z | In-plane rotation of the billboard; the example spins the star with `star.rotation.fromEulerAngle(0, 0, angle)` in its tick handler |
| `setPickTarget(node, label)` | The node returned when this sprite is picked, such as the object it labels |

V counting upwards is the easiest thing to get wrong with an atlas. Row 0 of the example's atlas is at the top of the image, and this is how a cell turns into the arguments of `setUVInfo()`:

<<< @/../src/tut-90/main.js#uv

Set the anchor and the rotation on the **node**: when a material is attached to a sprite, the node overwrites the material's `anchorX` / `anchorY` / `rotation` with its own values, and it rewrites `rotation` on every transform update after that. Since anchor, rotation and UVs all live in the material, sprites that differ in any of them should each have their own material (the texture can be shared), which is what the example does.

For text labels that stay crisp at any scale, use `MSDFTextSprite`; see [Text Rendering](en/text-rendering.md).

## Particle System

`ParticleSystem` is a scene node that owns emission settings, simulation parameters, and a `ParticleMaterial` (`particles.material`). Once attached, the scene updates it every frame: the simulation runs on the CPU, the result is uploaded as instance data, and the whole system is drawn in one draw call.

<<< @/../src/tut-90/main.js#particles

**Emission rate**: `emitCount` particles are emitted every `emitInterval` milliseconds. But at most **one batch is emitted per frame**: when the interval is shorter than a frame, the missed batches are not made up, and the actual rate becomes "`emitCount` per frame", varying with the frame rate. For denser emission raise `emitCount` rather than pushing `emitInterval` below a frame. The example uses 6 every 40 milliseconds, which holds 150 per second at anything above 25 fps.

**Particle limit**: `maxParticleCount` sizes the instance buffer and is also a hard limit: once it is reached, new particles are simply not created. Estimate it as "emission rate × longest life + burst size": the example's continuous flow keeps about 150 × 2.2 ≈ 330 alive, and 800 leaves room for two bursts of 200.

**Motion**: the direction of the initial velocity comes from the emitter shape (see the table below) and its magnitude is random between `particleVelocityMin` and `Max`. After that, every frame applies `gravity` (a constant acceleration) and `particleAccelMin` ~ `Max` along the velocity (negative values slow particles down). With `airResistence` set to true, the velocity also eases towards `wind` with a time constant of about one second; that is how the example's particles first spread out according to the shape and then rise and drift with the wind. Note that the property really is spelled `airResistence`: writing `airResistance` in JavaScript raises no error, it just does nothing.

**Size**: each particle changes linearly from Size1 to Size2 over its life, both picked at random between their Min and Max. By default Size2 is smaller than Size1, so particles shrink; the example does the opposite and lets them grow, like flames turning into smoke.

Common parameters and defaults:

| Property | Default | Meaning |
| --- | --- | --- |
| `maxParticleCount` | `100` | The most particles alive at once; the instance buffer is sized by it |
| `emitInterval` | `100` | Time between emissions, **in milliseconds** |
| `emitCount` | `1` | Particles per emission; 0 stops continuous emission |
| `particleLifeMin` / `Max` | `1` / `1.5` | Particle lifetime range, **in seconds** |
| `particleVelocityMin` / `Max` | `2` / `3` | Initial speed range |
| `particleSize1Min` / `Max` | `0.4` / `0.5` | Size range at birth |
| `particleSize2Min` / `Max` | `0` / `0.1` | Size range at death |
| `particleAccelMin` / `Max` | `-0.01` / `-0.02` | Acceleration range along the velocity |
| `gravity` | `(0, 0, 0)` | Constant acceleration |
| `wind` | `(0, 0, 0)` | Wind velocity. **Only applies while `airResistence` is true** |
| `airResistence` | `false` | Whether the velocity eases towards `wind` |
| `scalar` | `1` | Scales both the particles' movement and their birth size, to make a whole effect bigger or smaller |
| `jitterSpeed` | `1` | Angular speed of the particle wobble (radians per second); its amplitude is the material's `jitterPower` |
| `emitterShape` | `'point'` | See the table below |
| `emitterBehavior` | `'surface'` | See the table below |
| `emitterShapeSizeMin` / `Max` | `(1, 1, 1)` / `(1, 1, 1)` | Size of the emitter shape; each axis is picked at random between the two, per particle |
| `emitterConeRadiusMin` / `Max` | `0` / `0.1` | How far the launch direction spreads away from +Y; only `point`, `box` and `cylinder` use it |
| `worldSpace` | `true` | Whether particles live in world space or in the emitter's local space after birth; see below |

Emitter shapes ("size" below is the value of `emitterShapeSize` picked between Min and Max):

| Shape | Where particles are born | Initial direction |
| --- | --- | --- |
| `point` | The node origin; size is ignored | Along +Y, opened up by `emitterConeRadius` |
| `sphere` | An ellipsoid with the size as its radii | Outwards from the centre |
| `box` | A box with the size as its half extents | Along +Y, opened up by `emitterConeRadius` |
| `cylinder` | The side of a cylinder with radius size X/Z and half height size Y | Horizontally outwards; `emitterConeRadius` times size Y gives the vertical spread |
| `cone` | The side of a cone with its apex 2 × size Y above the node and a base radius of size X | Outwards and down along the cone surface |

With `emitterBehavior` set to `surface` particles are born on the surface of the shape, with `volume` inside it; this applies to `sphere`, `box` and `cylinder` only. When the size Min and Max differ, the "surface" turns into a shell with some thickness; for an exact surface give both the same value, as the example does.

## Particle Material

The default material is `ParticleMaterial`, reached through `particles.material`:

<<< @/../src/tut-90/main.js#material

| Property | Description |
| --- | --- |
| `alphaMap` | The particle's shape. **Only the red channel is read**, as opacity. It is data rather than colour, so it should be in a linear format |
| `rampMap` | Colour over the particle's life: sampled with the normalized age (0 at birth, 1 at death) as U and V at 0. RGB is the colour and A multiplies the opacity, so fading in and out goes here too. It is a colour texture and should be in an sRGB format |
| `blendMode` | `'blend'` (default) or `'additive'` |
| `jitterPower` | How far particles wobble around their path, in the plane perpendicular to their velocity; the speed is set by `ParticleSystem.jitterSpeed` |
| `aspect` | Width/height ratio of the quad; width = size × `aspect` |
| `directional` | When true, the quad's long axis follows the on-screen direction of the velocity; with an `aspect` below 1 this gives sparks stretched along their motion |

With neither map set, particles are plain white squares. The particle material is unlit: the ramp colour is the output colour, which then goes through tone mapping as usual. `aspect`, `jitterPower` and `directional` also exist on `ParticleSystem` and are passed straight through to the material.

The example's `createAlphaMap()` builds a 64×64 `rgba8unorm` round mask with a soft edge, and `createRampMap()` interpolates a set of keys into a 64×1 `rgba8unorm-srgb` texture. In a real project the two usually come from files (illustrative snippet):

```ts
const alpha = await getEngine().resourceManager.fetchTexture('/particles/smoke-alpha.png', {
  linearColorSpace: true
});
const ramp = await getEngine().resourceManager.fetchTexture('/particles/smoke-ramp.png');

particles.material.alphaMap = alpha;
particles.material.rampMap = ramp;
```

`linearColorSpace: true` reads the mask as linear data, while the ramp uses the default sRGB. The editor loads the two maps the same way when it deserializes a particle material.

`additive` adds the colour onto what is behind, so overlaps get brighter and dark colours all but vanish; use it for sparks, glows and magic effects. `blend` is ordinary transparency, for smoke, dust and leaves. Switch the example to Alpha blend and the grey end of the ramp becomes smoke that hides the background; switch back to Additive and the smoke nearly disappears, leaving only the glowing part.

## World Space and Local Space

The example moves the emitter in its tick handler every frame:

<<< @/../src/tut-90/main.js#motion

`worldSpace` decides which coordinate system particles live in after birth:

- `true` (default): position and velocity are transformed into world space at birth and have nothing to do with the emitter afterwards. Moving the emitter leaves a trail behind, which suits torches, exhaust and dust from footsteps.
- `false`: particles stay in the emitter node's local space, and the whole cloud follows the node as it moves, rotates and scales. This suits effects that stick to an object, such as a shield aura.

<<< @/../src/tut-90/main.js#worldspace

Changing `worldSpace` at runtime does not convert the particles already alive: their coordinates are reinterpreted in the new space, so they jump once before they expire (toggle World space in the example to see it). Set it before emission starts.

## Manual Bursts

The system emits continuously according to `emitInterval` and `emitCount`. For one-shot effects, set `emitCount` to 0 to stop continuous emission, then call `newParticle()` when needed:

<<< @/../src/tut-90/main.js#burst

`newParticle(count, worldMatrix)` creates `count` particles at once; the second argument is the transform used at birth, normally `particles.worldMatrix` (it is not used while `worldSpace` is false). Bursts are capped by `maxParticleCount` too, and particles beyond it are not created, so leave room in `maxParticleCount` for the burst.

This is useful for impacts, explosions, or interaction feedback.

## Transparency Sorting and OIT

Particles and sprites are drawn in the transparent queue and do not write depth. The particles of one system are drawn in a single draw call in order of birth, not sorted by distance to the camera, so dense `blend` particles can show wrong front-to-back order; `additive` gives the same result in any order and is not affected. When sorting artifacts show up, enable OIT on the camera:

<<< @/../src/tut-90/main.js#oit

Weighted blended OIT works on both WebGL2 and WebGPU and is the practical choice for particle-heavy scenes. Note that OIT takes over blending for the transparent queue: with it on, `additive` particles are composited as a weighted average too and no longer get brighter where they overlap. Choose Additive in the example and then check Weighted OIT to see the difference. Other OIT modes are covered in [Order-Independent Transparency](en/oit.md).

## Picking

Particles and sprites are drawable scene nodes and can be picked. A particle system's pick target is the system itself; a sprite can point its pick result at another node with `setPickTarget()`.

## Serialization

`Sprite`, `SpriteMaterial`, `StandardSpriteMaterial`, `ParticleSystem`, and `ParticleMaterial` are registered with serialization. Editor-authored sprites and particle nodes can be saved in scenes or prefabs.

Textures used by sprite and particle materials should have asset ids before serialization. Textures generated in code, like the ones in the example, have no asset id and cannot be referenced from saved data.

## Limitations and Pitfalls

- **Particles with zero velocity are unreliable.** The shader normalizes the particle velocity to build the axes for the wobble and orientation; at zero velocity the result is undefined and the particle may simply disappear. Do not set `particleVelocityMin` to 0, and do not use a deceleration strong enough to stop particles within their life (with `gravity` or `wind` they generally do not stop).
- **`particleRotationMin` / `Max` currently have no visible effect.** They are accumulated on the CPU, in radians per second, into a rotation angle per particle, but the `ParticleMaterial` shader does not use that value.
- **Sprites only inherit their parent's translation.** The parent's rotation and scale do not apply to a sprite; its size and in-plane rotation come from its own transform alone.
- Particles do not read scene depth (there are no soft particles), so they show hard edges where they cut into geometry; place large particles such as smoke with that in mind.

## Performance Notes

The simulation runs per particle on the CPU and the data is uploaded again every frame, so the cost grows linearly with the number of live particles. Keep `maxParticleCount` close to the maximum number you actually need. Prefer a few larger particle systems over many tiny systems when they share behavior and material. Avoid replacing textures or materials every frame; animate parameters instead.
