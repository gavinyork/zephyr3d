import type { AABB } from '@zephyr3d/base';
import type {
  AbstractDevice,
  BindGroup,
  PBGlobalScope,
  PBInsideFunctionScope,
  PBShaderExp
} from '@zephyr3d/device';

export abstract class WaveGenerator {
  abstract setupUniforms(scope: PBGlobalScope): void;
  abstract calcVertexPositionAndNormal(
    scope: PBInsideFunctionScope,
    inPos: PBShaderExp,
    outPos: PBShaderExp,
    outNormal: PBShaderExp
  ): void;
  abstract calcFragmentNormal(
    scope: PBInsideFunctionScope,
    xz: PBShaderExp,
    vertexNormal: PBShaderExp
  ): PBShaderExp;
  abstract calcFragmentNormalAndFoam(
    scope: PBInsideFunctionScope,
    xz: PBShaderExp,
    vertexNormal: PBShaderExp
  ): PBShaderExp;
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
  abstract getHash(device: AbstractDevice): string;
  abstract isOk(device: AbstractDevice): boolean;
  abstract dispose(): void;
}
