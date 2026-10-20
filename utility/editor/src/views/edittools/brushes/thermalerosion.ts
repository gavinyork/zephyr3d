import { TerrainComputeErosionBrush } from './computeerosionbrush';

/** Conservative downslope sediment relaxation on WebGPU. */
export class ThermalErosionBrush extends TerrainComputeErosionBrush {
  constructor() {
    super('thermal', { talus: 30, thermalRate: 0.35 });
  }
  getName(): string {
    return 'thermal erosion';
  }
}
