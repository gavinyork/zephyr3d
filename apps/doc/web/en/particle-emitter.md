# Particle Emitter

`ParticleEmitter` is the particle node for sparks, smoke, dust, magic motes and the like. The same parameters simulate on the CPU or, on WebGPU, in a compute shader, which keeps hundreds of thousands or even millions of particles real-time.

> The code on this page comes from the source of the runnable example `tut-95` below.

## Example

<div class="showcase" case="tut-95"></div>

The panel at the top left:

- **Preset**: four effects, used below to explain each group of parameters.
  - **Spark fountain**: 100 000 sparks falling under gravity and bouncing off the ground.
  - **Smoke**: a plume stirred by noise and carried off by the scene's wind.
  - **Swarm**: 300 000 motes swirling in place.
  - **Comet trail**: a comet circling the scene, speeding up and slowing down, with an even trail.
- **Simulation**: where the particles are simulated, see [CPU or GPU](#cpu-or-gpu). The status line below shows the backend in use and an upper bound of the live particles.
- **Burst**: emits an extra batch at once. **Restart**: clears the particles and plays from the start.

## Creating an emitter

The whole setup of the fountain:

<<< @/../src/tut-95/main.js#fountain

The parameters are grouped in modules on the emitter:

| Module | Contents |
| --- | --- |
| `emission` | Emission rate, emission per distance moved, bursts each cycle |
| `shape` | The shape particles are born from and which way they leave it |
| `start` | Values each particle picks at birth: lifetime, speed, size, angle, color |
| `overLife` | Size and color curves over the life |
| `forces` | Gravity, drag, air velocity, scene wind, noise |
| `collision` | Collision with a plane or the scene SDF |
| `bounds` | Bounding box for culling |

The fields of the modules can be changed at any time; the emitter reads them every frame. Only three kinds of change do more: curves take effect when assigned (see [Curves over the life](#curves-over-the-life)), and changing `maxParticles`, `space` or `simulation` clears the particles alive.

The ranges in `start` are `ParticleRange`s: after `set(min, max)` each particle picks its own value between the two. Every random value is computed from the `seed` and the particle's birth serial: the same seed and the same sequence of frame times give the same effect. Angles are in radians (the editor shows degrees).

Scaling the emitter node scales the whole effect: shape, speeds and sizes together. Gravity, air velocity and the scene wind belong to the world and do not scale with the node.

### Playback

An emitter plays once it is in the scene (`autoPlay`). An emission cycle lasts `duration` seconds and bursts repeat every cycle; with `looping` false it emits one cycle, and `isFinished` turns true once every particle has died.

<<< @/../src/tut-95/main.js#playback

`play()`, `pause()`, `stop()` and `restart()` control playback: `stop()` only stops emitting and the particles alive live out their lives, unless `{ clear: true }` is passed. `emit(n)` emits n more particles at the next step, playing or not. `prewarm` starts a looping effect as if it had been playing for a cycle, for smoke or fire that should already be there when the scene loads. `simulationSpeed` scales the effect's time.

A frame longer than 0.1 seconds (a hitch, a background tab) is simulated as 0.1 seconds: the effect slows down slightly, but particles do not leap ahead.

## CPU or GPU

| `simulation` | Backend used |
| --- | --- |
| `'auto'` (default) | The GPU on WebGPU when `maxParticles` is 1000 or more, otherwise the CPU |
| `'gpu'` | The GPU on WebGPU; on WebGL2 the CPU, with at most `ParticleEmitter.cpuFallbackMaxParticles` particles (20000 by default) and a warning in the console once |
| `'cpu'` | Always the CPU, with no cap |

`activeSimulation` returns the backend in use. Both backends share the parameters, the random numbers and the order of integration, so the effect has the same distribution on either; but the CPU computes in double precision and the GPU in single precision, so with noise the paths of single particles drift apart over time.

Choosing:

- **The GPU** births, simulates and writes the drawing data in one compute dispatch, and the CPU only schedules emission, so the cost hardly depends on the number of particles. On the desktop GPU used for testing, a million particles took about 6 ms of GPU time for the whole frame.
- **The CPU** spends a fraction of a microsecond per particle per frame, close to a microsecond with noise, wind and collision, and uploads all the instance data every frame. Tens of thousands of particles is the practical limit.
- Small effects (a few hundred particles) are better on the CPU: every GPU emitter costs a dispatch of its own each frame. That is what the 1000 threshold of `'auto'` is for, so a scene with many small fires keeps them on the CPU.

On the CPU the example scales the particle count and the rates down to 20 000:

<<< @/../src/tut-95/main.js#simulation

## Emission and capacity

- `emission.rate`: particles per second, independent of the frame rate; fractions carry over to the next frame. The particles of a frame are born at staggered times, so a fast-moving emitter still leaves a continuous trail.
- `emission.rateOverDistance`: particles per unit the emitter moves, for tire smoke and wakes.
- `emission.bursts`: a list of `ParticleBurst`s, each emitting `count` particles (a whole number in the range) at `time` seconds into every cycle, repeated `cycles` times `interval` apart.

`maxParticles` is a hard cap on the particles alive at once; births beyond it are dropped, old particles are not replaced. It counts particles that may still be alive, judged by the upper bound of the lifetime, so leave room: continuous emission needs about `rate × longest lifetime`, plus the bursts. The fountain in the example emits 20 000 a second for up to 4 seconds, 80 000 for the continuous part, and its 100 000 leave room for the burst of each cycle. `aliveCount` is that same upper bound, not an exact count.

## Shapes

Particles are born from a shape and leave it along +Y by default:

| `shape.type` | Born | Direction | Parameters |
| --- | --- | --- | --- |
| `point` | At the node's origin | Within `angle` of +Y | `angle` |
| `sphere` | In a sphere | Out from the center | `radius`, `thickness`, `arc` |
| `hemisphere` | In the upper half sphere | Out from the center | `radius`, `thickness`, `arc` |
| `box` | In a box | Within `angle` of +Y | `boxSize`, `thickness`, `angle` |
| `cone` | On the base disk | Tilted outward the farther out, by `angle` at the rim | `radius`, `thickness`, `angle`, `arc` |
| `circle` | On a disk in the XZ plane | Horizontally outward | `radius`, `thickness`, `arc` |
| `edge` | On a segment along X, `length` long | Within `angle` of +Y | `length`, `angle` |

With `thickness` 0 particles are born on the surface only (the faces of the box, the rim of the disk and the cone), with 1 throughout the volume, and in between in a shell; every shape is sampled evenly by area or volume. An `angle` of π means every direction. `randomizeDirection` (0 to 1) blends the direction toward a random one. `inheritVelocity` gives particles a share of the emitter's velocity, in world space only.

## Curves over the life

`overLife.size` and `overLife.color` are factors multiplying the values picked at birth, over the normalized age (0 at birth, 1 at death). The example builds the curves from keys with two small functions:

<<< @/../src/tut-95/main.js#curves

The smoke uses both kinds:

<<< @/../src/tut-95/main.js#smoke

- `overLife.size` is a number curve (an `Interpolator` with target `'number'`); null means 1 throughout.
- `overLife.color` is a `ParticleGradient`: an RGB curve (`'vec3'`) and an alpha curve (`'number'`), each 1 throughout when null. The smoke only has an alpha curve and keeps its birth color.
- Curves are baked into a lookup table (64 samples each) when assigned. **After changing a curve object, assign it again**, or the change has no effect.

The birth colors `start.colorA` and `colorB` are linear and may exceed 1: under the camera's bloom they glow, as the fountain and the motes do. The colors over the life are factors between 0 and 1; HDR brightness belongs in the birth colors.

## Forces

Each step adds the accelerations of gravity and noise, pulls the velocity toward the air's by the drag, moves, and then collides.

- `forces.gravity`: acceleration in world space; the earth's is `(0, -9.8, 0)`.
- `forces.drag`: how strongly the air carries the particles, in 1/s, the rate their velocity approaches the air's. High for smoke, snow and leaves, low for sparks.
- `forces.airVelocity`: the velocity of the air, in world space.
- `forces.windInfluence`: how much of the scene's wind `scene.env.wind` adds to the air's velocity. The wind is sampled where each particle is, so gusts sweep through the particles in patches; a wind push of 1 is 10 m/s.

> **Air velocity and wind only act through drag.** With `drag` 0 the particles ignore the air, and `airVelocity` and `windInfluence` have no visible effect.

The scene's wind is shared by grass, foliage and particles:

<<< @/../src/tut-95/main.js#wind

### Noise

`forces.noise` is curl noise: a swirling acceleration that varies smoothly through space, stirring particles without bunching them up.

<<< @/../src/tut-95/main.js#swarm

- `strength`: the average acceleration; the strongest swirls reach about three times it.
- `frequency`: noise cells per unit; larger for smaller swirls.
- `scrollSpeed`: how fast the field changes, in units per second; 0 for a still field.

Noise is part of the effect: it scales with the node, and in local space the field moves with the emitter. Noise alone keeps speeding particles up; with `drag` their speed settles near `strength / drag` and they follow the swirls, which is how the motes are made.

## Collision

Each particle is a small sphere (half its size times `radiusScale` across) that is pushed out of surfaces it hits and bounces off them. Particles do not collide with each other.

| `collision.mode` | Collides with |
| --- | --- |
| `'none'` | Nothing |
| `'plane'` | An infinite plane in world space: normal `planeNormal` (up by default), `planeHeight` from the origin, the height of the ground with the default normal |
| `'sdf'` | The scene's signed distance field: static meshes, terrain and moving meshes that have a field. **GPU simulation only**, with the scene SDF enabled (`scene.sdf.enabled`, see [Mesh and Global SDF](en/sdf.md)); the CPU simulation and scenes without the field ignore it |

- `bounce`: the share of the speed into the surface kept, bouncing back, 0 to 1.
- `friction`: the share of the speed along the surface lost each step in contact, 0 to 1.
- `lifetimeLoss`: the share of the lifetime used up by each hit; 1 makes particles vanish on contact (rain on the ground).

The global SDF only covers about ±128 units around the camera and gets coarser with distance, so collisions far away are less precise.

## World space, local space and trails

`space` decides where particles live once born:

- `'world'` (default): independent of the emitter once born; a moving emitter leaves a trail. For smoke, exhaust and dust kicked up by footsteps.
- `'local'`: particles follow the node as it moves, turns and scales, for effects stuck to an object, such as the flame of a torch or a shield's glow.

The comet uses `rateOverDistance` instead of `rate`, so the particles follow the distance travelled and the trail is equally dense at any speed:

<<< @/../src/tut-95/main.js#trail

The example moves the emitter in its tick handler:

<<< @/../src/tut-95/main.js#motion

Simulation runs in the scene's `lateupdate` event, after scripts and physics, so an emitter on a rigid body does not lag a frame behind.

## Rendering: ParticleSpriteMaterial

The emitter draws with a `ParticleSpriteMaterial`, available as `material`. Particles are unlit.

| Property | Effect |
| --- | --- |
| `blendMode` | `'blend'` (default) is plain transparency, for smoke and dust; `'additive'` brightens what is behind, for sparks and glows; `'none'` with `alphaCutoff` gives cutout particles such as leaves |
| `texture` | Color texture (sRGB, alpha as coverage), multiplied by the particle's color. A soft round dot when unset. Turn on `alphaFromRed` for a mask with a red channel only |
| `alignment` | How the quads face, see below |
| `flipbook` | Flipbook frames: `{ tilesX, tilesY, mode, cycles, blend }`. Mode `'lifetime'` plays them over the life, `'random'` shows one random frame per particle |
| `softDistance` | Soft particles: fades out within this distance of the scene behind, hiding hard edges where quads cut into the ground. Needs the scene depth when above 0 |
| `nearFadeDistance` | Fades out this close to the near plane, so large quads do not fill the screen |

| `alignment` | Facing |
| --- | --- |
| `'view'` | Parallel to the screen |
| `'velocity'` | Facing the camera, height along the motion |
| `'stretched'` | As velocity, lengthened by the speed: length = size × `stretchLengthScale` + speed × `stretchSpeedScale` |
| `'horizontal'` | Lying flat in the XZ plane, for ripples spreading on the ground |
| `'vertical'` | Upright, turned toward the camera |

The particles of an emitter are drawn in birth order (`sortOrder` can draw the newest first), **not sorted by depth**. The order never changes over a particle's life, so nothing flickers; but dense `blend` particles may overlap in the wrong order, in which case OIT helps, see [Particles and Sprites](en/particles-sprites.md#transparency-sorting-and-oit). Particles are not drawn into shadow maps.

## Bounds

The emitter's bounding box culls it against the view.

- `bounds.mode = 'auto'` (default): the CPU simulation measures the exact box of the particles. The GPU simulation cannot read them back and estimates a conservative box from the shape, the speed bounds, the forces and the lifetime; it is larger than needed, which only makes culling looser, never the picture wrong.
- `bounds.mode = 'fixed'`: uses `bounds.box`, in the emitter's local space. When the extent of an effect is known this culls tighter.

Emitters simulate every frame, visible or not.

## In the editor

Pick **Particle Emitter** in the **Add** menu. The property grid follows the modules above:

- The buttons of the **Playback** group play, pause, stop and restart; angles are shown in degrees.
- SizeOverLife and ColorOverLife under **Over Lifetime** start empty: click ✓ to create a curve of 1, then the pencil to edit it, in a curve editor for the size and a gradient editor for the color (color keys on top, the alpha curve below). Particles update while you edit, Cancel restores the curve, and OK can be undone.
- **Bursts** is a list; + adds a burst.

## Limitations and pitfalls

- **GPU simulation needs WebGPU.** On WebGL2 both `'gpu'` and `'auto'` fall back to the CPU with at most `cpuFallbackMaxParticles` particles. A large effect made for the GPU thins out on WebGL2; scale its rates down by `activeSimulation` as the example does if needed.
- **Air velocity and wind need `drag`.** With `drag` 0 they have no effect.
- **SDF collision only works on the GPU**, with the scene SDF enabled.
- **Particles cannot be read back one by one.** There are no per-particle callbacks, and `aliveCount` is an upper bound; an effect ends by time (the longest lifetime after emission stops).
- **Changing `maxParticles`, `space` or `simulation` clears the particles alive**, so switching at run time restarts the effect.
- Every GPU emitter costs a compute dispatch per frame. With dozens of large emitters, prefer fewer, larger ones.
