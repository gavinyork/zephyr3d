# Physical Lighting Mode

::: warning Experimental
Physical lighting mode is currently **experimental**. Its API and calibration may change in future
versions. Use it in production with care, or be prepared to adapt later. The default `legacy` mode
has frozen behaviour and will not change.
:::

The engine supports two lighting unit models, selected through `Scene.lightingMode`:

- **`legacy` (default)** — a unitless model. A light's `intensity` is an arbitrary multiplier and
  exposure is controlled with `camera.toneMapExposure`.
- **`physical`** — real photometric units throughout (illuminance, luminous flux, luminance), with
  camera exposure derived from aperture, shutter speed and ISO.

```javascript
scene.lightingMode = 'physical';
```

**This switch reinterprets the meaning of every light, material and exposure value in the scene.**
After switching, your existing `intensity` and `toneMapExposure` values no longer apply and the image
changes noticeably — that is not a bug, the two models simply use different quantities.

## When to use it

It fits when:

- you want to reproduce real-world light levels (midday sun is roughly 100,000 lux, indoor lighting a
  few hundred);
- you want exposure control that maps to photographic settings (aperture / shutter / ISO);
- the values coming from your DCC tool or reference footage are physical quantities rather than
  art-directed multipliers.

If you just want the scene to look good, `legacy` is more direct and requires no knowledge of
photometric units.

## Unit reference

Physical mode follows Filament's conventions:

| Object | Unit | Property |
| --- | --- | --- |
| Directional light | lux (lm/m²) | `DirectionalLight.illuminance` |
| Point light | lumen (authored) / candela (shaded) | `luminousPower` / `luminousIntensity` |
| Spot light | lumen (authored) / candela (shaded) | `luminousPower` / `luminousIntensity` |
| Rect light | cd/m² (nit) | `RectLight.luminance` |
| Environment / IBL | cd/m² (nit) | `EnvLightWrapper.intensity` |
| Emissive material | cd/m² (nit) | `emissiveLuminance` |
| Camera exposure | unitless multiplier | `Camera.exposure` (read-only, derived) |

Point and spot lights expose two related properties: `luminousPower` (luminous flux — the lumen
figure printed on a bulb's packaging) is convenient for authoring, while `luminousIntensity`
(candela) is what shading actually uses. The engine converts between them with Filament's formulas.

## The photometric camera

In physical mode, exposure no longer comes from `toneMapExposure` but from the three photographic
settings:

```javascript
camera.aperture = 16;            // f-number
camera.shutterSpeed = 1 / 125;   // seconds
camera.ISO = 100;                // sensitivity
camera.exposureCompensation = 0; // in stops (EV)

// Read-only, derived from the four values above
console.log(camera.EV100);       // photographic EV100
console.log(camera.exposure);    // scene-linear exposure multiplier
```

The defaults are the photographic **Sunny 16** reference (f/16, 1/125 s, ISO 100), which together
with the directional light's default 100,000 lux illuminance gives correct exposure for midday
sunlight. So switching to physical mode without changing anything leaves a default scene correctly
exposed.

The camera can also derive its field of view from real lens parameters:

```javascript
camera.projectionMode = 'physical';
camera.focalLengthMm = 35;       // focal length
camera.sensorWidthMm = 36;       // sensor size (35mm full frame by default)
camera.sensorHeightMm = 24;
camera.sensorFit = 'horizontal'; // which sensor dimension drives the FOV
```

With `projectionMode` left at its default `'fov'`, `fovY` is still used. The two parameterizations are
independent, so you can adopt the exposure model without the lens model.

## Scene scale

Physical lighting involves inverse-square falloff, so the engine needs to know how many meters one
scene unit represents:

```javascript
scene.metersPerUnit = 1;    // default: 1 unit = 1 meter
scene.metersPerUnit = 0.01; // 1 unit = 1 centimeter
```

With this set correctly, changing scene scale does not change the resulting lighting — the engine
rescales light intensity so that illuminance at the same physical distance stays the same.

## Where exposure is applied

Physical mode **pre-exposes on the CPU**: every light quantity is multiplied by the camera exposure
before upload, so the HDR render target stays near 1.0. The benefit is that downstream passes — bloom,
SSR, SSGI, fog — need no unit awareness, and tone mapping only applies the ACES curve.

**Emissive is the one exception**, because it is authored on a material rather than a light. It is
exposed in the shader, and `emissiveExposureWeight` decides whether exposure applies at all:

- at 1, `emissiveLuminance` is a true cd/m² luminance;
- at 0, exposure cancels out and `emissiveLuminance` degrades to a display-referred multiplier.

The default is 1, but **imported model materials are set to 0** to preserve glTF's display-referred
emissive semantics, so the same asset renders identically in both lighting modes. This has a practical
consequence: `emissiveLuminance` on an imported material is **not** in cd/m² — it is a
display-referred multiplier that is already bright at 1 and ignores aperture/shutter/ISO. Retuning
such a material photometrically means raising the weight to 1 and rescaling the value into nits.

## Things to be aware of

- The sky/IBL bake is stored at a fixed `PHYSICAL_BAKE_EXPOSURE` (the Sunny-16 reference exposure)
  rather than the live camera exposure. The bake is cached and only invalidated when the sun changes,
  so it cannot carry a live exposure; and the environment cubemap format cannot hold the raw luminance
  a 100,000 lux sun drives the atmosphere model to — it would overflow to `Inf` and the GGX prefilter
  would spread that across the whole IBL. Consumers convert with
  `cameraExposure / PHYSICAL_BAKE_EXPOSURE`.
- Spot lights in physical mode use `innerConeAngle` / `outerConeAngle` (**real half-angles in
  radians**) rather than legacy's `cutoff` (the cosine of the half-angle). Both are clamped to between
  0.5° and 90°, and the inner angle never exceeds the outer.
- Changing `lightingMode` rebuilds the camera's post-processing chain.

## See also

- [Direct lighting](en/lighting-direct.md) — properties common to all light types
- [Indirect lighting](en/lighting-indirect.md) — ambient light and IBL
- [Tonemapping](en/posteffect-tonemap.md) — exposure control in legacy mode
