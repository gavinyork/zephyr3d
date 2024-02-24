import type { PBFunctionScope } from '@zephyr3d/device';
import { BlinnMaterial, applyMaterialMixins, mixinTextureProps } from '@zephyr3d/scene';

/**
 * Reference: https://github.com/Sorumi/UnityFurShader
 */
export class FurMaterial extends applyMaterialMixins(BlinnMaterial, mixinTextureProps('fur')) {
  private static readonly furSteps = [
    0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95
  ];
  constructor() {
    super();
    this.numPasses = 1 + FurMaterial.furSteps.length;
  }
  vertexShader(scope: PBFunctionScope): void {
    super.vertexShader(scope);
    if (this.pass > 0) {
      const pb = scope.$builder;
      scope.kkFurStep = pb.float().uniform(2);
      scope.$outputs.furAlpha = pb.float();
      scope.$outputs.furAlpha = pb.sub(1, pb.mul(scope.kkFurStep, scope.kkFurStep));
    }
  }
  fragmentShader(scope: PBFunctionScope): void {
    if (this.pass === 0) {
      super.fragmentShader(scope);
    } else {
    }
  }
}
