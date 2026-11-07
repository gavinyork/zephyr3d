# Particles and Sprites

Zephyr3D provides two related billboard systems:

- `Sprite` renders a single camera-facing quad.
- `ParticleSystem` renders many camera-facing quads with per-particle movement and lifetime.

Use sprites for icons, markers, simple decals, and 2D elements in 3D space. Use particle systems for smoke, sparks, dust, fireflies, magic effects, and other repeated transient visuals.

> The code on this page is illustrative and leaves out application setup; `getEngine` comes from `@zephyr3d/scene`.

## Sprite

Create a sprite with a `SpriteMaterial` implementation. `StandardSpriteMaterial` is the common textured material.

```ts
import { Sprite, StandardSpriteMaterial } from '@zephyr3d/scene';

const texture = await getEngine().resourceManager.fetchTexture('/textures/marker.png');
const material = new StandardSpriteMaterial();
material.spriteTexture = texture;
material.setUVInfo(0, 0, 1, 1);
material.anchorX = 0.5;
material.anchorY = 0.5;

const sprite = new Sprite(scene, material);
sprite.parent = scene.rootNode;
sprite.position.setXYZ(0, 2, 0);
sprite.scale.setXYZ(0.6, 0.6, 0.6);
```

Important sprite controls:

| Property | Meaning |
| --- | --- |
| `anchorX`, `anchorY` | Pivot inside the sprite quad |
| `uvTopLeft`, `uvBottomRight` | UV rectangle used by the sprite node |
| `material.setUVInfo()` | UV rectangle on the material |
| `material.rotation` | In-plane billboard rotation |
| `setPickTarget()` | Assign logical pick target data |

Use `SDFSpriteMaterial` for signed-distance-field icons or glyph-like textures that need crisp edges, and call its `setSDFTextureInfo()` to describe the SDF texture.

## Particle System

`ParticleSystem` owns emission settings, simulation parameters, and a `ParticleMaterial`. It is automatically updated by the scene when attached.

```ts
import { ParticleSystem } from '@zephyr3d/scene';
import { Vector3 } from '@zephyr3d/base';

const particles = new ParticleSystem(scene);
particles.parent = scene.rootNode;
particles.position.setXYZ(0, 1, 0);

particles.maxParticleCount = 512;
particles.emitInterval = 24;
particles.emitCount = 4;

particles.emitterShape = 'sphere';
particles.emitterBehavior = 'volume';
particles.emitterShapeSizeMin = new Vector3(0.2, 0.2, 0.2);
particles.emitterShapeSizeMax = new Vector3(0.5, 0.5, 0.5);

particles.particleLifeMin = 0.8;
particles.particleLifeMax = 1.8;
particles.particleVelocityMin = 1.5;
particles.particleVelocityMax = 3.2;
particles.particleSize1Min = 0.08;
particles.particleSize1Max = 0.18;
particles.particleSize2Min = 0.35;
particles.particleSize2Max = 0.6;

particles.gravity = new Vector3(0, 0.8, 0);
particles.wind = new Vector3(0.4, 0, 0);
particles.airResistence = true;
```

Common parameters and defaults:

| Property | Default | Meaning |
| --- | --- | --- |
| `maxParticleCount` | `100` | The most particles alive at once; the instance buffer is sized by it |
| `emitInterval` | `100` | Time between emissions, **in milliseconds** |
| `emitCount` | `1` | Particles per emission; 0 stops continuous emission |
| `particleLifeMin` / `Max` | `1` / `1.5` | Particle lifetime range, **in seconds** |
| `particleVelocityMin` / `Max` | `2` / `3` | Initial speed range |
| `particleSize1Min` / `Max` | — | Size range at birth |
| `particleSize2Min` / `Max` | — | Size range at death; particles go from Size1 to Size2 over their life |
| `particleRotationMin` / `Max` | `0` / `0` | Rotation range in the billboard plane |
| `particleAccelMin` / `Max` | `-0.01` / `-0.02` | Acceleration range along the velocity |
| `gravity` | `(0, 0, 0)` | Constant acceleration |
| `wind` | `(0, 0, 0)` | Wind velocity. **Only applies while `airResistence` is true**; particle velocity eases towards it |
| `emitterBehavior` | `'surface'` | See below |
| `worldSpace` | `true` | See below |

Emission shapes:

| Shape | Use |
| --- | --- |
| `point` | Emit from a single point |
| `sphere` | Emit from a sphere |
| `box` | Emit from a box |
| `cylinder` | Emit from a cylinder |
| `cone` | Emit from a cone, opening set by `emitterConeRadiusMin` / `Max` (default 0 / 0.1) |

`emitterBehavior` can be `surface` or `volume`, depending on whether particles should start on the surface of the shape or inside it.

## Particle Material

The default material is `ParticleMaterial`.

```ts
const alpha = await getEngine().resourceManager.fetchTexture('/particles/smoke-alpha.png', {
  linearColorSpace: true
});
const ramp = await getEngine().resourceManager.fetchTexture('/particles/smoke-ramp.png');

particles.material.alphaMap = alpha;
particles.material.rampMap = ramp;
particles.material.aspect = 1;
particles.material.jitterPower = 0.2;
particles.material.directional = false;
particles.material.blendMode = 'blend';
```

Important material controls:

| Property | Meaning |
| --- | --- |
| `alphaMap` | Particle shape and opacity |
| `rampMap` | Color over normalized lifetime |
| `aspect` | Billboard width/height ratio |
| `jitterPower` | Adds animated distortion in the shader |
| `directional` | Align particles with velocity direction |
| `blendMode` | Common values are `blend` or `additive` |

Use additive blending for sparks, glows, and magic effects. Use alpha blending for smoke, dust, leaves, and soft particles.

## World Space and Local Space

`worldSpace` controls whether particles continue moving in world coordinates after emission.

```ts
particles.worldSpace = true;
```

When `worldSpace` is true, moving the emitter does not drag already emitted particles with it. When false, particles stay in the emitter node's local space.

## Manual Bursts

The system emits continuously according to `emitInterval` and `emitCount`. For one-shot effects, set `emitCount` to 0 to stop continuous emission, then trigger a burst with `newParticle()`:

```ts
particles.emitCount = 0;
particles.newParticle(80, particles.worldMatrix);
```

Bursts are capped by `maxParticleCount` too, and particles beyond it are not created, so leave room in `maxParticleCount` for the burst.

This is useful for impacts, explosions, or interaction feedback.

## Picking and Transparency

Particles and sprites are drawable scene nodes, so they can provide pick targets. For dense transparent particles, enable OIT on the camera when sorting artifacts are visible:

```ts
scene.mainCamera.oitMode = 'weighted';
```

Weighted blended OIT is usually the practical choice for particle-heavy scenes.

## Serialization

`Sprite`, `SpriteMaterial`, `StandardSpriteMaterial`, `ParticleSystem`, and `ParticleMaterial` are registered with serialization. Editor-authored sprites and particle nodes can be saved in scenes or prefabs.

Textures used by sprite and particle materials should have asset ids before serialization.

## Performance Notes

Keep `maxParticleCount` close to the maximum number you actually need. Particles do not read scene depth (there are no soft particles), so they show hard edges where they cut into geometry; place large particles such as smoke with that in mind. Prefer a few larger particle systems over many tiny systems when they share behavior and material. Avoid replacing textures or materials every frame; animate parameters instead.
