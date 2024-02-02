import { vec2 } from 'gl-matrix';

export interface OceanFieldCascade {
  /**
   * The size of simulated patch of field. (in meters)
   */
  size: number;

  /**
   * How "croppy" this pattern would be
   */
  croppiness: number;

  /**
   * Strength factor for this pattern
   */
  strength: number;

  /**
   * Min wave length. Kind of spectrum filter. (Waves less that this thresold are not involved in spectrum generation)
   */
  minWave: number;

  /**
   * Max wave length. Kind of spectrum filter.
   */
  maxWave: number;
}

export interface OceanFieldBuildParams {
  /**
   * Size of generated texture. Must be power of 2
   */
  resolution: number;

  /**
   * Ocean field sub-pattern options.
   * @see OceanFieldCascade
   */
  cascades: [OceanFieldCascade, OceanFieldCascade, OceanFieldCascade];

  /**
   * Wind vector. Module correspond to wind force.
   */
  wind: vec2;

  /**
   * Parameter for waves motion. 0 means no wave motion
   */
  alignment: number;

  /**
   * How "wide" foam pattern lines will appear in water surface
   */
  foamSpreading: number;

  /**
   * Strength of foam
   */
  foamContrast: number;

  /**
   * Seed of random generator
   */
  randomSeed: number;
}

export const defaultBuildParams: OceanFieldBuildParams = {
  cascades: [
    {
      size: 100.0,
      strength: 2.0,
      croppiness: -1.5,
      minWave: 1.0e-6,
      maxWave: 1.0e6,
    },
    {
      size: 60.0,
      strength: 2.0,
      croppiness: -1.5,
      minWave: 1.0e-6,
      maxWave: 1.0e6,
    },
    {
      size: 6.0,
      strength: 2.0,
      croppiness: -1.5,
      minWave: 1.0e-6,
      maxWave: 1.0e6,
    },
  ],
  resolution: 256,
  wind: vec2.fromValues(4.5, 2.5),
  alignment: 1.0,
  foamSpreading: 1.0,
  foamContrast: 2.0,
  randomSeed: 0,
};
