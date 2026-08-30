# Bloom

A real lens photographing something very bright spills light into the surrounding area as a soft
halo. Bloom reproduces that: pixels above a brightness threshold are extracted, blurred, and added
back over the image. This is not only decoration — a light tube, a screen or a flame without a halo
reads as a bright-colored texture rather than something actually emitting light.

> The snippets on this page omit imports and application setup. See the embedded live example for
> complete runnable code.

## Minimal example

Bloom is a single switch on the camera:

```javascript
camera.bloom = true;
```

Flipping it often changes nothing, though, **because nothing in the scene is bright enough**. Bloom
acts on color-buffer values above its threshold, and a normally exposed white surface usually is not
one. Making something genuinely glow is the material's job:

```javascript
const material = new PBRMetallicRoughnessMaterial();
material.emissiveColor = new Vector3(1, 0.92, 0.78);
material.emissiveStrength = 8;
```

The example below is a row of identical spheres whose only difference is that `emissiveStrength`
doubles from one to the next (0.5 up to 16). Dragging the Threshold slider makes the halos appear
one by one from the right — that is the threshold at work.

<div class="showcase" case="tut-28" style="width:600px;height:500px"></div>

## Tuning and trade-offs

`bloomThreshold` decides how bright a pixel must be to bloom, and is the one to set first. Bloom
runs **before** tone mapping, so it compares against **scene-linear radiance**, not the value you
see on screen — a pixel that looks pure white might be linear 1.2 or linear 200, and those two bloom
very differently.

What the threshold means physically depends on the [lighting mode](en/lighting-physical.md):

| Lighting mode | Buffer holds | What a threshold of 0.8 means |
| --- | --- | --- |
| `legacy` (default) | scene-linear radiance, unitless | a little above "a correctly exposed white" |
| `physical` | camera pre-exposed luminance | ~30,700 cd/m² at the Sunny-16 reference, about a white surface in direct sunlight |

The default is strict in `physical` mode: only real emitters and specular highlights bloom. For a
more pronounced glow, lower it — around `0.3` makes a white surface bloom, and `0.15` catches
everything above mid-gray.

`bloomThresholdKnee` controls how wide the transition around the threshold is. At `0` the switch is
hard: an object crossing the threshold pops into having a halo, which is visible as a jump when
something brightens gradually. A non-zero value (`0.5`, say) makes that continuous.

`bloomIntensity` scales the final additive blend and is purely a matter of taste. It does not change
which pixels bloom, only how much is added, so get the threshold right before reaching for it. Note
that it acts on linear light which then goes through tone mapping, so its **useful range is much
smaller than it looks**: the embedded example uses `0.35`, and much above 1 the highlights smear
into a single white mass.

`bloomMaxDownsampleLevels` and `bloomDownsampleLimit` set the depth and minimum resolution of the
blur pyramid, which is what determines how far the glow spreads: more levels mean a wider halo, at
the cost of one blur pass each. The default of 4 suits most scenes; raise it only when you want
broad, soft light.

`bloomFilterRadius` is the radius of the 3x3 tent filter used when upsampling the pyramid, in source
texels, and defaults to `1`. It controls how soft the halo is, but **should not go much above 2**:
the tent's taps drift far enough apart that they stop overlapping, which reintroduces the very grid
pattern the filter exists to remove. At 0 it collapses to a single bilinear tap and the blocky
banding comes back.

`bloomKarisAverage` is on by default and suppresses fireflies — isolated blown-out pixels where a
normal map happens to put NdotL near 1, which flicker violently as the surface moves. The trade is a
slightly dimmer and tighter halo, since the weighting deliberately holds the brightest samples back.
Turn it off for a fully static scene with no high-frequency speculars to gain a little reach.

