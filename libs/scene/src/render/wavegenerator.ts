import type { AABB } from '@zephyr3d/base';
import type {
  AbstractDevice,
  BindGroup,
  PBGlobalScope,
  PBInsideFunctionScope,
  PBShaderExp
} from '@zephyr3d/device';

/**
 * Abstract class for wave generators.
 * @public
 */
export abstract class WaveGenerator {
  /**
   * Setup uniforms for the shader program.
   * @param scope - Global scope of the shader program.
   */
  abstract setupUniforms(scope: PBGlobalScope): void;
  /**
   * Calculate vertex position and normal.
   * @param scope - Global scope of the shader program.
   * @param inPos - Input position.
   * @param outPos - Output position.
   * @param outNormal - Output normal.
   */
  abstract calcVertexPositionAndNormal(
    scope: PBInsideFunctionScope,
    inPos: PBShaderExp,
    outPos: PBShaderExp,
    outNormal: PBShaderExp
  ): void;
  /**
   *
   * @param scope - Global scope of the shader program.
   * @param xz - XZ position.
   * @param vertexNormal - Vertex normal.
   */
  abstract calcFragmentNormal(
    scope: PBInsideFunctionScope,
    xz: PBShaderExp,
    vertexNormal: PBShaderExp
  ): PBShaderExp;
  /**
   * Calculate fragment normal and foam.
   * @param scope - Global scope of the shader program.
   * @param xz - XZ position.
   * @param vertexNormal - Vertex normal.
   */
  abstract calcFragmentNormalAndFoam(
    scope: PBInsideFunctionScope,
    xz: PBShaderExp,
    vertexNormal: PBShaderExp
  ): PBShaderExp;
  /**
   * Apply water bind group.
   * @param bindGroup - Bind group to apply.
   */
  abstract applyWaterBindGroup(bindGroup: BindGroup): void;
  /**
   *
   * @param minX - Minimum X position of the clipmap tile.
   * @param maxX - Maximum X position of the clipmap tile.
   * @param minZ - Minimum Z position of the clipmap tile.
   * @param maxZ - Maximum Z position of the clipmap tile.
   * @param y - Y position of the water surface.
   * @param outAABB - Output AABB.
   */
  abstract calcClipmapTileAABB(
    minX: number,
    maxX: number,
    minZ: number,
    maxZ: number,
    y: number,
    outAABB: AABB
  );
  /**
   * Update the wave generator.
   * @param timeInSeconds - Time in seconds.
   */
  abstract update(timeInSeconds: number): void;
  /**
   * Get the shader hash of the wave generator.
   * @param device - Rendering device.
   */
  abstract getHash(device: AbstractDevice): string;
  /**
   * Check if the wave generator is ok.
   * @param device - Rendering device.
   */
  abstract isOk(device: AbstractDevice): boolean;
  /**
   * Dispose the wave generator.
   */
  abstract dispose(): void;
}
