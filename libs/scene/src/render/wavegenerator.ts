import type { AABB } from '@zephyr3d/base';
import type { BindGroup, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';

export abstract class WaveGenerator {
  abstract calcVertexPositionAndNormal(
    scope: PBInsideFunctionScope,
    inPos: PBShaderExp,
    outPos: PBShaderExp,
    outNormal: PBShaderExp
  ): void;
  abstract calcFragmentNormalAndFoam(scope: PBInsideFunctionScope, xz: PBShaderExp): PBShaderExp;
  abstract applyWaterBindGroup(bindGroup: BindGroup): void;
  abstract calcClipmapTileAABB(
    minX: number,
    maxX: number,
    minZ: number,
    maxZ: number,
    y: number,
    outAABB: AABB
  );
  abstract update(timeInSeconds: number): void;
  abstract isOk(): boolean;
  abstract dispose(): void;
}
