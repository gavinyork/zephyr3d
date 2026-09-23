# Skin Material and Subsurface Scattering

Real skin is not opaque: light enters the surface, scatters some distance beneath it and exits
elsewhere. That is why skin has a reddish transition across the terminator, and why thin parts (ear
rims, nostrils) glow when lit from behind. The engine models this with a **material plus a post
effect** working together.

## How the three pieces divide the work

Three components make up this feature, and understanding their split is the key to using it:

| Component | Kind | Responsible for |
| --- | --- | --- |
| `SkinMaterial` | Material | The **shape** of direct lighting: diffuse ramp, specular, back-lit transmission |
| `SkinSSS` | Camera post effect | The **diffusion**: blurring the scatterable part in screen space and compositing it back |
| `SubsurfaceProfile` | Data | The **ratio** of per-channel scatter radii — what makes it read as skin versus wax |

The important part is that **stylization is separate from diffusion**: the material decides what the
lighting ramp looks like, and the post effect only spreads that ramp out. A stylized ramp therefore
stays stylized after scattering instead of being averaged away.

That leads to a rule which is easy to get wrong: **scatter tint, strength and radius live on the post
effect, not on the material.** There is no `scatterRadius` on the material; it is on the camera.

## Minimal usage

```javascript
import { SkinMaterial } from '@zephyr3d/scene';

const material = new SkinMaterial();
material.albedoTexture = skinColorTexture;
material.normalTexture = skinNormalTexture;

// The post effect must be enabled, or you get the material ramp with no diffusion
camera.skinSSS = true;
```

**Setting up the material without enabling `camera.skinSSS` is the most common mistake**: nothing
errors, but you see no scattering, because the diffusion step never runs.

Conversely the effect is **energy conserving**: the post effect subtracts the scatterable term and adds
back a diffused version, so turning `camera.skinSSS` off leaves the image unchanged rather than
suddenly darker or brighter.

## Material side: the shape of the lighting

Parameters on `SkinMaterial` shape direct lighting and have nothing to do with diffusion:

| Property | Default | Purpose |
| --- | --- | --- |
| `diffuseWrap` | 0.28 | Diffuse wrap amount, letting light reach past the geometric terminator |
| `diffuseSoftness` | 0.45 | How soft the ramp is |
| `shininess` | 72 | Specular sharpness |
| `specularStrength` | 1 | Specular intensity |
| `scatterWrap` | 0.65 | Wrap of the scatterable term, setting the width of the transition band |
| `scatterStrength` | 1.5 | Strength of the scatterable term written out |
| `scatterColor` | (1, 0.42, 0.28) | Tint of the scatterable term |
| `transmissionStrength` | 0 | Back-lit transmission strength; **off by default** |
| `transmissionPower` | 4 | Directionality of the transmission |
| `shadowTint` | black | Tints the shadowed part of the ramp; black is the original behaviour |
| `brightening` | 0 | Overall diffuse gain |

### The mask texture

The optional `subsurfaceTexture` carries three different things in its channels:

- **R = skin mask** — which pixels participate in scattering. **Clothing, hair and eyes must be
  masked out here**, otherwise they get tinted with the skin scatter colour.
- **G = local softness** — per-pixel adjustment of ramp softness.
- **B = thickness** — used by back-lit transmission; thin areas (ear rims, nostrils) take high values.

Transmission is off by default; to use it, raise `transmissionStrength` and supply thickness in B.

## Post-effect side: diffusion and compositing

The camera side is deliberately just a switch:

| Property | Default | Purpose |
| --- | --- | --- |
| `skinSSS` | false | Enable the diffusion pass (WebGPU only) |
| `skinSSSDebugOutput` | `'none'` | Render one intermediate of the diffusion instead of the shaded result |

**There are no scattering knobs on the camera.** How far the light travels, how strongly and in what
colour are all properties of the [`SkinProfile`](#scatter-profiles) the material points at, which the
pass reads per pixel from the profile id the material writes. This mirrors UE5, where a subsurface
profile asset is the only thing that shapes the diffusion, and it is what keeps the screen-space
diffusion and the baked transmission profile from drifting apart — a pass-level radius multiplier
would scale the first without touching the second.

`skinSSSDebugOutput` is the practical way to tell an input problem from a kernel problem: it can show
the diffusible energy, the per-pixel profile id, the normal, the per-channel diffusion distance, the
sample radius, the tap acceptance rate, the diffused result on its own, and the light-space
thickness. Several intermediates sit in a narrow band, so pair it with the post effect's
`debugExposure` when a channel reads as a flat tone.

## Scatter profiles

A `SkinProfile` holds every scattering parameter, and materials reference one through
`SkinMaterial.subsurfaceProfile`. Profiles are packed into a shared GPU table keyed by profile id, so
a face, its ears and its lips can each carry their own profile and diffuse independently within a
single screen-space pass.

The parameters that matter most:

| Property | Purpose |
| --- | --- |
| `surfaceAlbedo` | Per-channel scattering albedo; drives Burley's shaping term |
| `meanFreePath` | Per-channel scatter **ratio** — what gives a surface its character |
| `meanFreePathDistance` | Absolute scatter distance, in world units |
| `worldUnitScale` | Profile-space to world-unit conversion, for scenes not authored in metres |
| `scatterScale` | Overall multiplier on the diffusion width |
| `transmissionTint` | Tint of the light transmitted through thin geometry |
| `scatteringDistribution` | Henyey-Greenstein asymmetry of the transmitted light |
| `roughness0` / `roughness1` / `lobeMix` | Dual-lobe specular |

The `meanFreePath` **ratio** is what makes a scattering surface read as skin rather than as a neutral
blur. Red travels roughly ten times further than blue in the `skin` preset, which is exactly the
red-to-yellow gradient at the terminator. Changing the preset changes that ratio, which is why `wax`
and `jade` run the same code path as skin rather than being special cases.

Available presets: `skin`, `skin_pale`, `skin_tan`, `skin_dark`, `wax`, `jade`, `marble`.

The absolute size comes from `meanFreePathDistance` and `worldUnitScale`; the preset only sets
proportions.

::: tip Scale matters
The scatter distances are physical: `skin` has a mean free path of about 27 mm. On a metre-scale
object the diffusion is correctly invisible. If scattering "has no effect", check the object's world
size before reaching for the parameters.
:::

## See also

- [Custom Materials](en/user-material.md) — the general material system
- [Post-processing](en/posteffect-intro.md) — the camera post-processing chain
- [Lighting](en/lighting-intro.md) — configuring lights
