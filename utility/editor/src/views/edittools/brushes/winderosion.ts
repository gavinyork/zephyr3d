import { TerrainComputeErosionBrush } from './computeerosionbrush';

/** Scours windward slopes, carries sediment downwind and deposits it in sheltered lee areas on WebGPU. */
export class WindErosionBrush extends TerrainComputeErosionBrush {
  constructor() {
    super('wind', { windDirection: 0, windSpeed: 0.5, transportRate: 0.35 });
  }
  getName(): string {
    return 'wind erosion';
  }
}
