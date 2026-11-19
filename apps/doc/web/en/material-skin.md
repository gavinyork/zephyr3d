# Skin and Subsurface Scattering

Skin, wax, jade and marble are not opaque: light goes in, scatters some distance beneath the surface and
comes out somewhere else. That is why a shadow edge on skin has a soft red fringe, and why thin parts such
as ear rims glow when lit from behind. `SSSMaterial` reproduces both, and this page covers how to size it
so the effect actually shows and what it needs from the rest of the scene.

## How the work is divided

| Piece | Kind | Responsible for |
| --- | --- | --- |
| `SSSMaterial` | Material | Lighting the surface: Burley diffuse, two-lobe GGX specular and back-lit transmission. Per pixel it also records how much of the result is diffuse light, and which profile applies |
| `SSSProfile` | Data, owned by each `SSSMaterial` | How far light travels beneath the surface, separately for red, green and blue, plus the transmission and specular-lobe parameters |
| `PostSSS` | Post effect, owned by the camera | Spreading the diffuse part of those pixels across the screen according to each pixel's profile, then adding the specular back untouched |

The material decides what the lighting at each point is; the diffusion only moves the diffuse part of it
around. Specular never goes through the diffusion, so highlights stay crisp on top of soft skin. And because
the diffusion is a normalised weighted average, it **conserves energy**: it redistributes light rather than
adding or removing any, so an evenly lit area looks the same with or without it. The visible change is
concentrated where the lighting changes abruptly — shadow edges above all.

## Minimal example

<div class="showcase" case="tut-94"></div>

The scene is life-size, in metres: a 20 cm sphere stands in for a head, a grazing key light puts the
terminator down its middle, and a thin rod throws a hard-edged shadow across the lit side. With
**Subsurface** checked, the edges of that shadow pick up a red fringe that bleeds into the shadow; uncheck it
and the same surface under a plain PBR material shows a hard grey edge. The 5 mm disc beside the head is lit
only by a light behind it, shining through.

Setting up the material takes three lines:

<<< @/../src/tut-94/main.js#material

**There is no switch to turn on.** Every frame the renderer checks whether an opaque `SSSMaterial` is being
drawn and enables `PostSSS` for that frame only, so the pass costs nothing while no such material is
visible. It follows that the way to turn the effect off is to draw a different material, which is what the
example's checkbox does:

<<< @/../src/tut-94/main.js#toggle

## Profiles: how far light travels

`material.subsurfaceProfile` is read-only and never `null`: each `SSSMaterial` creates its own profile and
owns it for life, so you edit it in place instead of assigning one. Profiles cannot be shared; to give a
second material the same look, copy the values with `subsurfaceProfile.copyFrom(otherProfile)`. Because
every material has its own profile and writes the profile's id per pixel, a face, its ears and its lips can
each scatter differently within one screen-space pass.

Setting `preset` overwrites every parameter of the profile with a built-in set:

| Preset | `meanFreePathDistance` | `meanFreePath` (R : G : B) | Reads as |
| --- | --- | --- | --- |
| `skin` (default) | 26.7 mm | 1 : 0.089 : 0.072 | Skin: red travels much farther than green and blue |
| `skin_pale` | 29.4 mm | 1 : 0.1 : 0.083 | Lighter skin |
| `skin_tan` | 25.4 mm | 1 : 0.082 : 0.066 | Tanned skin |
| `skin_dark` | 22.7 mm | 1 : 0.072 : 0.057 | Dark skin |
| `wax` | 50 mm | 1 : 0.85 : 0.68 | Wax: wide and almost neutral |
| `jade` | 45 mm | 0.6 : 1 : 0.85 | Jade: green travels farthest |
| `marble` | 35 mm | 1 : 0.96 : 0.92 | Marble: almost neutral |

The ratio between the channels is what gives a material its character. Skin's red channel spreading more
than ten times as far as green and blue is exactly the red fringe at a shadow edge, and `wax`, `jade` and
`marble` run the same code with different ratios rather than being special cases. A preset does not set the
surface colour — that is still the material's `albedoColor` / `albedoTexture` — so the example sets both:

<<< @/../src/tut-94/main.js#preset

When a preset is close but not quite right, these are the parameters worth adjusting:

| Property | What it changes | When to touch it |
| --- | --- | --- |
| `meanFreePathDistance` | Mean free path of the widest channel, in metres | The absolute size of the scattering |
| `meanFreePath` | Per-channel ratio of that distance | The colour of the fringe |
| `scatterScale` | Multiplier on the distance (default 1), applied to the diffusion and the transmission alike | Exaggerating or toning down the effect while keeping its colour |
| `worldUnitScale` | World units per metre (default 1) | Scenes not authored in metres, e.g. 100 for centimetres. Not an artistic control |
| `surfaceAlbedo` | Per-channel shaping term: values near 0.33 spread widest, values towards 0 or 1 tighten | Fine-tuning how quickly each channel falls off |
| `boundaryColorBleed` | Tint applied to light picked up from a neighbouring pixel with a different profile (default white) | Softening or colouring the seam between, say, face and lips |
| `transmissionTint`, `extinctionScale` | Colour of the light coming through thin parts, and how quickly it dies off with thickness | Back-lit ears and fingers |
| `scatteringDistribution`, `ior` | How forward-peaked the transmitted light is (Henyey-Greenstein, -1 to 1), and the refraction applied to the view ray first | How much the glow depends on looking towards the light |
| `roughness0`, `roughness1`, `lobeMix` | Multipliers on the material's roughness for the narrow and the wide specular lobe, and the blend between them | Oily versus dry sheen |

Keeping the radius on the profile, rather than on the camera, is deliberate: the same distances size both
the screen-space diffusion and the transmission, so `scatterScale` changes the two together instead of
letting them drift apart.

::: tip The radius is a physical size
`skin` has a mean free path of 26.7 mm in its red channel, and after the shaping term the visible spread is
a few millimetres. On a head-sized object filling the screen that is tens of pixels; on an object a few
metres across it is a pixel or two, so the diffusion is — correctly — invisible. If scattering "has no
effect", check the object's world size and `worldUnitScale` before touching anything else. To exaggerate it
on purpose, raise `scatterScale`.
:::

## Material parameters

`SSSMaterial` has few parameters of its own; the scattering lives in the profile.

| Property | Default | Purpose |
| --- | --- | --- |
| `roughness` | 0.5 | Base GGX roughness (clamped to 0.045–1); the profile's lobe multipliers derive both specular lobes from it |
| `specularF0` | 0.04 | Reflectance at normal incidence (clamped to 0–0.2) |
| `transmissionStrength` | 1 | Multiplier on back-lit transmission; 0 turns it off for this material |
| `subsurfaceTexture` | none | Scattering mask, see below |

It also has the usual `albedoColor` / `albedoTexture`, `normalTexture` / `normalScale` and `vertexColor`.

### Mask texture

`subsurfaceTexture` reads only its **R channel**, as a mask. Where it is 0 the pixel is not diffused and
neighbours do not pull light from it, and the specular falls back from two lobes to one. Use it for parts of
the same mesh that should not behave like skin. The other channels are ignored; in particular, thickness for
transmission is not painted but measured, as described next.

## Transmission: light through thin parts

Transmission is opt-in per light and needs three things:

- `light.transmission = true` (the default is `false`);
- the light casts shadows (`light.castShadow = true`), because the thickness the light travels through is
  measured every frame from its shadow map;
- an `SSSMaterial` is drawn that frame.

<<< @/../src/tut-94/main.js#transmission

Nothing has to be authored, but the shadow map's resolution limits how thin a feature can be resolved, so
keep `shadowDistance` (or the light's range) tight around the subject. In a metre-scale scene with
`extinctionScale` at 1, no light gets through more than about 5 cm of material, and with the skin presets
most of it is gone within a centimetre or two: ears and fingers transmit, a whole head does not. The
transmitted light is added to the diffuse light, so on WebGPU it is diffused along with it.

`transmissionStrength` on the material scales the result; `transmissionTint` and `extinctionScale` on the
profile set its colour and how fast it fades.

## Debug outputs

`camera.SSSDebugOutput` replaces the diffused pixels with one intermediate of the pass, which is how an input
problem is told apart from a kernel problem:

<<< @/../src/tut-94/main.js#debug

| Question | Output | Shows |
| --- | --- | --- |
| Is the input right? | `diffusible` | The diffuse light the pass is going to spread |
| | `diffuseAmount` | The diffuse share of each pixel (white = all diffuse) |
| | `profileId` | Profile id per pixel, as grey levels (id 8 and above is white) |
| | `normal` | The normal the pass uses to stop light crossing creases |
| Is the kernel the right size? | `diffusionDistance` | Per-channel diffusion distance in millimetres (1 mm = full intensity) |
| | `sampleRadius` | Average tap distance in pixels (32 px = white) |
| | `centerWeight` | How much of the kernel falls on the pixel itself; white means the diffusion is sub-pixel |
| Are taps rejected? | `acceptance` | Fraction of taps that landed on scattering pixels |
| | `weight` | Accumulated kernel weight before normalisation |
| Output | `diffused` | The diffused result on its own, without the specular |
| Transmission | `thickness` | Light-space thickness from the transmission pass (bright = thick); pure blue means no transmission light reached the pixel |

Debug views carry values rather than colours, so the example turns tonemapping off while one is selected; with
it on, the tone curve bends the values and mixes the channels. The camera has no exposure control for these
views.

## Limitations and pitfalls

- **The diffusion is WebGPU only.** On WebGL2 `PostSSS` passes the image through unchanged and logs a warning
  to the console once. The material's own lighting and its transmission still work, so the same material can
  be used on both backends. To adapt the UI or content per backend, check `device.type === 'webgpu'`, as the
  example does; see also [Backend Support](en/backend-support.md).
- **Only opaque surfaces are diffused.** A blended (transparent) `SSSMaterial` is lit but not diffused, and
  does not enable the pass.
- **Judge it on a hard edge.** Diffusing a smooth terminator changes it very little, because light spread
  evenly in both directions averages back to the same gradient. A hard-edged cast shadow, as in the example,
  is where the effect is plainly visible.
- **Keep `camera.HDR` on** (the default). The diffuse share travels in the scene colour's alpha channel; with
  HDR off the scene colour is 8-bit, values above 1 clip, and the split between diffuse and specular stops
  being reliable in bright areas.
- **About 255 profiles at a time.** Every `SSSMaterial`, clones included, holds a row of a shared 255-row
  table until it is disposed; creating one more throws `SSSProfile limit exceeded`. Dispose of materials you
  no longer need.
- **`camera.SSS` is something else.** `camera.SSS` and the `camera.sss*` properties belong to an older
  screen-space path driven by `PBRMetallicRoughnessMaterial.subsurfaceProfile` (`SubsurfaceProfile`). They
  neither enable nor tune `SSSMaterial`; leave them off.
- **Cost.** The diffusion runs at full resolution with 64 taps per scattering pixel; other pixels skip the
  work early. Its cost therefore grows with how much of the screen the material covers, and a face in
  close-up is the expensive case. Transmission adds a screen-space thickness pass per frame on top of the
  lights' shadow maps.

## See also

- [Post-processing](en/posteffect-intro.md) — the camera post-processing chain
- [Shadows](en/shadow-intro.md) — shadow maps, which transmission measures thickness from
- [Hair](en/material-hair.md) and [Eyes](en/material-eye.md) — the rest of character rendering
