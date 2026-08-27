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

This group of camera properties controls the diffusion:

| Property | Default | Purpose |
| --- | --- | --- |
| `skinSSS` | false | Enable |
| `skinSSSStrength` | 1 | Final composite strength |
| `skinSSSScatterRadius` | 0.02 | **World-space** scatter radius; blur width scales with distance to keep it constant |
| `skinSSSSampleStep` | 2 | Maximum pixel spacing between blur taps, capping the projected radius for close-ups |
| `skinSSSOpacity` | 0.18 | Bias subtracted from the blurred skin mask before compositing |
| `skinSSSDepthScale` | 80 | Depth rejection scale, preventing bleeding across depth discontinuities |
| `skinSSSColorBoost` | 1 | Extra multiplier on the blurred result |
| `skinSSSSmoothness` | 0 | Skin smoothing ("beauty filter") amount |
| `skinSSSScatterTint` | white | Tints the light being redistributed |
| `skinSSSGlow` | 0 | Additive, deliberately non-conserving bleed |
| `skinSSSProfilePreset` | `'skin'` | Scatter profile preset |

A few worth calling out:

**`skinSSSScatterRadius` is in world space**, not pixels. That means scattering correctly shrinks as a
character walks away, without you retuning by distance. `skinSSSSampleStep` then caps the kernel in
pixels so it does not grow unbounded in close-ups.

**`skinSSSGlow` breaks energy conservation on purpose.** At the default 0, light added on the dark side
of the terminator is light removed from the lit side. Raising it only adds, making skin read as lit
from within; around 1 approximates how the effect looked before it conserved energy.

**`skinSSSScatterTint` multiplies only the difference term**, so a warm tint colours the terminator
without washing out the whole surface.

**`skinSSSSmoothness` depends on a correct mask**: smoothing samples weighted by the skin mask, so the
R channel must exclude eyes, brows and lips or they get smoothed away too.

## Scatter profiles

`skinSSSProfilePreset` sets the **ratio** between the red, green and blue scatter radii — and that ratio
is what gives a scattering surface its character. Red travels furthest in skin, which is exactly the
red-to-yellow gradient at the terminator. Changing the preset changes that ratio, which is why `wax`
and `jade` run the same code path as skin rather than being special cases.

Available presets: `skin`, `skin_thin`, `skin_default`, `skin_heavy_makeup`, `wax`, `wax_backlit`,
`wax_soft`, `jade`, `jade_backlit`, `jade_soft`.

The absolute size is still controlled by `skinSSSScatterRadius`; the preset only sets proportions.

::: tip This preset applies to the whole pass
`camera.skinSSSProfilePreset` is a **whole-pass** setting — one per camera. Using different profiles for
different materials in the same image goes through a separate profile-slot path, where
`SubsurfaceProfile` instances can be shared between materials (similar to Unreal's skin profile
assets).
:::

## Known limitations

- **Precision fallback**: the scatterable term is written to an additional MRT. When the render graph
  falls back to an 8-bit format, it is compressed and restored using `SKIN_SSS_LDR_ENCODE_RANGE`
  (value 4). Precision loss is possible at extreme brightness.
- **Defaults are not calibrated against real characters**: the current visual defaults
  (`scatterStrength` 1.5, `scatterRadius` 0.02, and so on) follow the reference implementation and
  usually need adjusting on an actual character.
- Specular uses a normalized Blinn model rather than GGX. That is a stylistic choice and does not aim
  to match PBR materials exactly.

## See also

- [Custom Materials](en/user-material.md) — the general material system
- [Post-processing](en/posteffect-intro.md) — the camera post-processing chain
- [Lighting](en/lighting-intro.md) — configuring lights
