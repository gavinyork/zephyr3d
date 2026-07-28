/**
 * Scene lighting unit model.
 *
 * @remarks
 * `legacy` keeps the original unitless model: light `intensity` is an arbitrary multiplier and
 * tonemapping applies a plain `toneMapExposure`. It is a public, widely used API and its behaviour
 * is frozen.
 *
 * `physical` uses photometric units throughout, following Filament's conventions:
 *
 * | Quantity | Unit | Property |
 * | --- | --- | --- |
 * | Directional light | lux (lm/m²) | {@link DirectionalLight.illuminance} |
 * | Point light | lumen (authored) / candela (shaded) | `luminousPower` / `luminousIntensity` |
 * | Spot light | lumen (authored) / candela (shaded) | `luminousPower` / `luminousIntensity` |
 * | Rect light | cd/m² (nit) | {@link RectLight.luminance} |
 * | Environment / IBL | cd/m² (nit) | `EnvLightWrapper.intensity` |
 * | Emissive material | cd/m² (nit) | `emissiveLuminance` |
 * | Camera exposure | unitless multiplier | {@link Camera.exposure} |
 *
 * Lighting is pre-exposed on the CPU: every light quantity is multiplied by the camera exposure
 * before upload, so the HDR render target stays near 1.0 and downstream passes (bloom, SSR, SSGI,
 * fog) need no unit awareness. Tonemapping therefore applies the ACES curve only.
 *
 * @public
 */
export type LightingMode = 'legacy' | 'physical';

/**
 * Camera projection parameterization.
 *
 * @public
 */
export type CameraProjectionMode = 'fov' | 'physical';

/**
 * Sensor dimension used to derive the perspective field of view.
 *
 * @public
 */
export type CameraSensorFit = 'horizontal' | 'vertical';

/**
 * Fixed exposure the physical sky bake (IBL, distant-light LUT, baked skybox) is stored at, equal
 * to the Sunny-16 reference: `1 / 38400 === calculatePhysicalExposure(16, 1/125, 100)`.
 *
 * @remarks
 * The bake is cached and only invalidated when the sun changes, so it cannot carry the live camera
 * exposure. Nor can it hold raw photometric luminance: the environment cubemap is `rg11b10uf`
 * (max ~65,024) or `rgba16f` (max 65,504), while a 100,000 lux sun drives the atmosphere model to
 * ~384,000. That overflows to `Inf` in the sun's direction, and the GGX prefilter plus the SH
 * projection then spread the `Inf` across the entire IBL.
 *
 * Storing at this fixed reference keeps the bake exposure-independent *and* in range. Consumers
 * convert to the live exposure with `cameraExposure / PHYSICAL_BAKE_EXPOSURE`.
 *
 * @public
 */
export const PHYSICAL_BAKE_EXPOSURE = 1 / 38400;

/** Calculate photographic EV100 from aperture, shutter time and ISO. */
export function calculateEV100(aperture: number, shutterSeconds: number, iso: number): number {
  const safeAperture = Math.max(aperture, 0.0001);
  const safeShutter = Math.max(shutterSeconds, 0.000001);
  const safeISO = Math.max(iso, 0.0001);
  return Math.log2(((safeAperture * safeAperture) / safeShutter) * (100 / safeISO));
}

/**
 * Calculate the scene-linear exposure multiplier for a photometrically calibrated camera.
 *
 * Uses the saturation-based calibration commonly used by real-time PBR renderers:
 * `1 / (1.2 * 2 ^ EV100)`.
 */
export function calculatePhysicalExposure(
  aperture: number,
  shutterSeconds: number,
  iso: number,
  compensationEV = 0
): number {
  const ev100 = calculateEV100(aperture, shutterSeconds, iso) - compensationEV;
  return 1 / (1.2 * Math.pow(2, ev100));
}

/** Calculate vertical field of view from physical camera parameters. */
export function calculateVerticalFov(
  focalLengthMm: number,
  sensorWidthMm: number,
  sensorHeightMm: number,
  aspect: number,
  sensorFit: CameraSensorFit
): number {
  const focalLength = Math.max(focalLengthMm, 0.0001);
  if (sensorFit === 'horizontal') {
    const safeAspect = Math.max(aspect, 0.0001);
    const fovX = 2 * Math.atan(Math.max(sensorWidthMm, 0.0001) / (2 * focalLength));
    return 2 * Math.atan(Math.tan(fovX * 0.5) / safeAspect);
  }
  return 2 * Math.atan(Math.max(sensorHeightMm, 0.0001) / (2 * focalLength));
}
