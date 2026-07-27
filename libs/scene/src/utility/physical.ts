/**
 * Scene lighting unit model.
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
 * Camera exposure parameterization.
 *
 * @public
 */
export type CameraExposureMode = 'legacy' | 'manual';

/**
 * Sensor dimension used to derive the perspective field of view.
 *
 * @public
 */
export type CameraSensorFit = 'horizontal' | 'vertical';

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
