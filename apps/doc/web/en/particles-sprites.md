# Particles and Sprites

Zephyr3D provides two kinds of camera-facing quads:

- `Sprite` renders a single camera-facing quad.
- `ParticleEmitter` renders many quads with per-particle movement and lifetime, simulated on the CPU or the GPU.

Use sprites for icons, markers, simple decals, and 2D elements in 3D space. Use particles for smoke, sparks, dust, fireflies, magic effects, and other repeated transient visuals. This page covers sprites, and what particles and sprites share: transparency sorting, picking and serialization. The parameters of particle emitters, CPU and GPU simulation, forces and collisions are covered in [Particle Emitter](en/particle-emitter.md), along with migrating from the deprecated `ParticleSystem`.

> The code on this page is taken from the source of the runnable example `tut-90` below, which generates all of its textures in code.

## Example

<div class="showcase" case="tut-90"></div>

A particle emitter (the small bright ball) circles the centre of the scene and keeps emitting particles that go from bright yellow to dark red and end as smoke. A map pin sprite sits on top of each of the three posts, and a star sprite spins in the middle. The panel in the top left:

- **Shape / Spawn**: switches the emitter shape `shape.type`, and whether particles are born on the surface of the shape (`shape.thickness` 0) or anywhere inside it (1).
- **Blend**: the particle material's `blendMode`, `additive` or `blend`.
- **World space**: toggles `space`. The emitter is always moving, so the difference between the two spaces is plain to see.
- **Continuous**: when unchecked, sets `emission.rate` to 0 to stop continuous emission.
- **Weighted OIT**: the camera's `oitMode`.
- **Burst**: calls `emit()` to emit 200 particles at once.



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

## Particles

The example's particle emitter:

<<< @/../src/tut-90/main.js#particles

The emitter emits 150 particles a second, born on a sphere of radius 0.6 and flying outward. The two curves in `overLife` make the particles grow to four times their size and turn from bright yellow to smoky grey over their life; `forces.drag` eases their velocities toward `airVelocity`, so the plume rises and drifts along +X.

The example's colour keys are sRGB bytes, and `createGradient()` converts them to linear colours before building the `ParticleGradient`. The emitter computes colours in linear space; dividing 0-255 sRGB values by 255 would make the midtones too bright.

<<< @/../src/tut-90/main.js#material

Particles are drawn with a `ParticleSpriteMaterial`; without a texture each particle is a soft round dot. `additive` adds the colour onto what is behind, so overlaps get brighter and dark colours all but vanish; use it for sparks, glows and magic effects. `blend` is ordinary transparency, for smoke, dust and leaves. Switch the example to Alpha blend and the grey end of the life becomes smoke that hides the background; switch back to Additive and the smoke nearly disappears, leaving only the glowing part.

## World Space and Local Space

The example moves the emitter in its tick handler every frame:

<<< @/../src/tut-90/main.js#motion

`space` decides which coordinate system particles live in after birth:

- `'world'` (default): independent of the emitter once born. Moving the emitter leaves a trail behind, which suits torches, exhaust and dust from footsteps.
- `'local'`: particles stay in the emitter node's local space, and the whole cloud follows the node as it moves, rotates and scales. This suits effects that stick to an object, such as a shield aura.

<<< @/../src/tut-90/main.js#worldspace

Changing `space` at runtime clears the particles alive, and the effect starts over in the new space.

## Manual Bursts

For one-shot effects, set `emission.rate` to 0 to stop continuous emission, then call `emit()` when needed:

<<< @/../src/tut-90/main.js#burst

`emit(count)` emits `count` particles at the next step, born where the emitter is then. Bursts are capped by `maxParticles` too, and particles beyond it are not created, so leave room in `maxParticles` for the burst. For bursts that repeat every cycle, use `emission.bursts`; see [Particle Emitter](en/particle-emitter.md#emission-and-capacity).

This is useful for impacts, explosions, or interaction feedback.

## Transparency Sorting and OIT

Particles and sprites are drawn in the transparent queue and do not write depth. The particles of one emitter are drawn in a single draw call in order of birth, not sorted by distance to the camera, so dense `blend` particles can show wrong front-to-back order; `additive` gives the same result in any order and is not affected. When sorting artifacts show up, enable OIT on the camera:

<<< @/../src/tut-90/main.js#oit

Weighted blended OIT works on both WebGL2 and WebGPU and is the practical choice for particle-heavy scenes. Note that OIT takes over blending for the transparent queue: with it on, `additive` particles are composited as a weighted average too and no longer get brighter where they overlap. Choose Additive in the example and then check Weighted OIT to see the difference. Other OIT modes are covered in [Order-Independent Transparency](en/oit.md).

## Picking

Particles and sprites are drawable scene nodes and can be picked. A particle emitter's pick target is the emitter itself; a sprite can point its pick result at another node with `setPickTarget()`.

## Serialization

`Sprite`, `SpriteMaterial`, `StandardSpriteMaterial`, `ParticleEmitter`, and `ParticleSpriteMaterial` are registered with serialization. Editor-authored sprites and particle nodes can be saved in scenes or prefabs. The deprecated `ParticleSystem` and `ParticleMaterial` are still registered, so older scenes keep loading.

Textures used by sprite and particle materials should have asset ids before serialization. Textures generated in code, like the ones in the example, have no asset id and cannot be referenced from saved data.

## Limitations and Pitfalls

- **Sprites only inherit their parent's translation.** The parent's rotation and scale do not apply to a sprite; its size and in-plane rotation come from its own transform alone.
- Particles do not read scene depth by default, so they show hard edges where they cut into geometry. For large particles such as smoke, turn on the material's `softDistance` (soft particles), at the cost of needing the scene depth.

## Performance Notes

What particles cost depends on where they are simulated: the CPU simulation computes every particle and uploads the data again each frame, so the cost grows linearly with the live particles, while the GPU simulation on WebGPU hardly uses the CPU at all. See [Particle Emitter](en/particle-emitter.md#cpu-or-gpu) for choosing. Keep `maxParticles` close to the maximum number you actually need. Avoid replacing textures or materials every frame; animate parameters instead.
