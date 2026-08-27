# Hair Rendering

Hair is the most awkward part of character rendering: a single strand is thinner than a pixel, light
passes through it, and there are tens of thousands of them packed together. The engine offers two
entirely different technical paths — pick the path first, then worry about parameters.

## Choosing a path

| | Hair cards | Strands |
| --- | --- | --- |
| Geometry | Textured polygon cards | Real strands expanded on the GPU |
| What you use | `HairMaterial` + a regular `Mesh` | `HairStrandMaterial` + `HairStrandData`, or `HairNode` |
| Asset source | DCC modelling + textures | Curves imported from Alembic / `.zhair` |
| Cost | Low | High (driven directly by strand count) |
| Suits | Mobile, distant characters, stylized looks | Close-ups, realism, physical simulation |
| Physical simulation | No | Yes (WebGPU only) |

When unsure, start with cards — they are better for both compatibility and performance, and are enough
for most projects.

## Shading model: two separate parameter sets

Whichever path you take, first pick a shading model. **This is the most important step for
understanding hair parameters**, because the two models' parameters barely overlap:

```javascript
material.shadingModel = 'kajiya-kay';  // default
material.shadingModel = 'marschner';
```

**`kajiya-kay` (default)** — the phenomenological double lobe. Every term is an art dial, which makes it
predictable and cheap, and is usually what a stylized hair card wants.

**`marschner`** — the fibre model, splitting light into the three paths it can take through a strand
(R / TT / TRT). It costs more and gives up some direct control, but the secondary highlight takes the
hair's own colour and backlit tips glow because the model says they must, not because someone dialled
it in.

::: warning Switching models changes the look rather than refining it
`marschner` is opt-in, and the image changes when you switch. The two models' parameters also
**deactivate each other**: the `marschner*` properties are inert under `kajiya-kay`, and the specular
lobe properties are inert under `marschner`.
:::

### Overlapping properties to leave alone under marschner

Two properties should be left as they are when `marschner` is on:

- **`transmissionIntensity`** — its whole job is faking the backlit glow that Marschner's TT path
  produces for real. Stacking both overdoes it.
- **`strandRoundness`** (`HairStrandMaterial` only) — it works through a bent normal, but Marschner
  already integrates across the fibre, so that normal never reaches the highlight.

## The hair card path

`HairMaterial` is for textured polygon cards, used with a regular `Mesh`.

Its lighting is made of:

- **wrap diffuse** — softens the terminator across thin cards;
- a **primary specular lobe** — usually near-white, sharp, shifted toward the root;
- a **secondary specular lobe** — tinted by the hair colour, broader, shifted toward the tip;
- an optional **shift texture** (`shiftMapScale`) that jitters both lobes per strand, breaking the
  "angel ring" into natural streaks;
- optional **view-dependent transmission** for backlit tips;
- an optional **baked occlusion map** (`occlusionStrength`) for root darkening.

### Strand direction

```javascript
material.strandDirection = 'tangent';   // or 'binormal'
```

Anisotropic highlights need to know which way the strands run in texture space, which depends on how
your UVs are laid out. **If highlights look wrong — running along the strands instead of across them —
try flipping this first.**

### Alpha handling

Hair edge handling comes from the `MeshMaterial` base. The recommended combination is:

- `alphaCutoff` plus `alphaDither` for the opaque core, giving TAA-converged soft edges;
- `blendMode = 'blend'` for the outer flyaway layer.

## The strand path

The strand path hands curve control points to the GPU, which expands them into camera-facing ribbons.

```javascript
import { HairStrandData, HairStrandMaterial, Mesh, Primitive } from '@zephyr3d/scene';

const material = new HairStrandMaterial();

const strands = new HairStrandData({
  positions,    // all control points, flat array
  pointCounts,  // how many control points each strand has
  widths,       // strand widths
  uv,
  scale: unitScale
});
material.strands = strands;

// Strand geometry is generated on the GPU, but a Primitive is still needed to issue the draw
const primitive = new Primitive();
// No vertex attribute is read; this layout exists only so a draw can be submitted
primitive.createAndSetVertexBuffer('position_f32x3', new Float32Array(3));
primitive.indexCount = material.vertexCount;
primitive.primitiveType = 'triangle-list';
primitive.setBoundingVolume(myBounds);

const mesh = new Mesh(scene, primitive, material);
```

::: tip That placeholder Primitive is required
Strand vertices are expanded on the GPU and do not come from a vertex buffer, but the draw call still
needs a `Primitive`. Set `indexCount` to `material.vertexCount`; what the vertex buffer contains does
not matter (the example puts in a single three-component placeholder). **You must compute and set the
bounding volume yourself**, or frustum culling will discard the hair.
:::

### Common parameters

| Property | Purpose |
| --- | --- |
| `segmentsPerStrand` | Subdivisions per strand |
| `strandWidthScale` | Overall strand width scale |
| `minStrandWidth` | Minimum world-space width |
| `minPixelWidth` | Minimum screen-space width, preventing distant strands from flickering |
| `strandLOD` / `minStrandLODRatio` | Reduce strand count by distance |
| `strandRoundness` | Fake a cylindrical cross-section with a bent normal (inert under `marschner`) |
| `rootOcclusion` / `rootOcclusionRange` | Root darkening |
| `strandMotion` / `prevPoints` | Motion vectors for TAA and motion blur |

`minPixelWidth` deserves a note: strands thinner than a pixel alias badly, and setting a floor (paired
with alpha falloff) is the standard remedy.

### Loading assets with HairNode

When hair comes from a `.zhair` asset, `HairNode` wraps up both loading and drawing:

```javascript
const hair = new HairNode(scene);
await hair.setHairAsset('/assets/hair.zhair');
```

It also accepts control points directly with `hair.setStrands(source)`. `HairNode` forwards the shading
properties (`shadingModel`, `albedoColor`, `marschner*` and so on), so you do not need to hold the
material separately.

**The practical benefit of `HairNode` is that it handles the chores above for you**: uploading control
points, sizing the draw call, **recomputing the bounding box**, releasing previous data, and rebuilding
a running simulation (whose rest pose comes from the strands). Going through `HairStrandMaterial` +
`Mesh` by hand means managing all of that yourself.

`setHairAsset()` is async; a failed load logs an error and clears the strands rather than throwing and
interrupting your flow.

## Physical simulation

The strand path supports GPU strand simulation, **available on WebGPU only**:

```javascript
import { isHairSimulationSupported } from '@zephyr3d/scene';

if (isHairSimulationSupported()) {
  // enable simulation
}
```

On other backends this returns false and you need a static-hair branch. **Do not assume simulation is
available** — it depends on compute shaders, which WebGL does not have at all.

## Shadows

Ordinary shadow maps handle hair self-shadowing poorly: strands are far thinner than a shadow map pixel,
and a binary occlusion test produces noise instead of soft light bleeding through.

For this the engine provides the **DOM (Deep Opacity Map)** shadow mode, which records **fractional**
occlusion through hair rather than a blocked/unblocked result:

```javascript
light.shadow.mode = 'dom';
```

**This mode is WebGPU only.** Setting it on another backend falls back to `pcf` and logs a console
warning — deliberately, so that a scene authored with DOM still renders shadows on WebGL instead of
producing no shadow map at all. So **check the console** when debugging, or you may believe the setting
took effect when it did not.

Related parameters, all on `light.shadow`: `domLayerDistance`, `domDensity`, `domFilterSize`.

## See also

- [Skin and Subsurface Scattering](en/material-skin.md) — the other half of character rendering
- [Shadow Anti-aliasing](en/shadow-aa.md) — shadow modes and quality
- [Custom Materials](en/user-material.md) — the general material system
