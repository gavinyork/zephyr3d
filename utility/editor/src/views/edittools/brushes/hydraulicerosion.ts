import { TerrainComputeErosionBrush } from './computeerosionbrush';

/** Rainfall, surface flow, sediment transport and deposition on WebGPU. */
export class HydraulicErosionBrush extends TerrainComputeErosionBrush {
  constructor() {
    super('hydraulic', {
      rainRate: 0.18,
      evaporation: 0.002,
      capacity: 0.7,
      erosionRate: 0.45,
      depositionRate: 0.12,
      flowPersistence: 0.8,
      channeling: 4
    });
  }
  getName(): string {
    return 'hydraulic erosion';
  }
}
