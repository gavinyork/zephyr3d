import type { AABB, IDisposable } from '@zephyr3d/base';
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
export interface WaveGenerator extends IDisposable {
  /**
   * Create a new instance from this
   * @returns The created instance
   */
  clone(): this;
  /**
   * Wave parameters change version
   * @internal
   */
  version: number;
  /**
   * Setup uniforms for the shader program.
   * @param scope - Global scope of the shader program.
   * @param uniformGroup - Bind group index for uniform values
   */
  setupUniforms(scope: PBGlobalScope, uniformGroup: number): void;
  /**
   * Calculate vertex position and normal.
   * @param scope - Global scope of the shader program.
   * @param inPos - Input position.
   * @param outPos - Output position.
   * @param outNormal - Output normal.
   */
  calcVertexPositionAndNormal(
    scope: PBInsideFunctionScope,
    inPos: PBShaderExp,
    outPos: PBShaderExp,
    outNormal: PBShaderExp
  ): void;
  /**
   * Where a vertex was in the previous frame, for motion vectors. Optional:
   * without it the surface is taken as not moving, which suits waves that
   * change slowly against the temporal filter.
   * @param scope - Shader scope.
   * @param inPos - Undisplaced position.
   * @param outPos - Receives the previous displaced position.
   */
  calcPrevVertexPosition?(scope: PBInsideFunctionScope, inPos: PBShaderExp, outPos: PBShaderExp): void;
  /**
   *
   * @param scope - Global scope of the shader program.
   * @param xz - XZ position.
   * @param vertexNormal - Vertex normal.
   */
  calcFragmentNormal(scope: PBInsideFunctionScope, xz: PBShaderExp, vertexNormal: PBShaderExp): PBShaderExp;
  /**
   * Calculate fragment normal and foam.
   * @param scope - Global scope of the shader program.
   * @param xz - XZ position.
   * @param vertexNormal - Vertex normal.
   */
  calcFragmentNormalAndFoam(
    scope: PBInsideFunctionScope,
    xz: PBShaderExp,
    vertexNormal: PBShaderExp
  ): PBShaderExp;
  /**
   * Share of the surface over an undisplaced XZ that is water, by which the
   * material fades in the scene behind: a generator that runs the mesh on
   * past the water's edge, to draw that edge per pixel, gives 0 there.
   * Optional: without it, 1 everywhere.
   * @param scope - Shader scope.
   * @param xz - Undisplaced XZ position.
   */
  calcSurfaceCoverage?(scope: PBInsideFunctionScope, xz: PBShaderExp): PBShaderExp;
  /**
   * Apply water bind group.
   * @param bindGroup - Bind group to apply.
   */
  applyWaterBindGroup(bindGroup: BindGroup): void;
  /**
   *
   * @param minX - Minimum X position of the clipmap tile.
   * @param maxX - Maximum X position of the clipmap tile.
   * @param minZ - Minimum Z position of the clipmap tile.
   * @param maxZ - Maximum Z position of the clipmap tile.
   * @param y - Y position of the water surface.
   * @param outAABB - Output AABB.
   */
  calcClipmapTileAABB(minX: number, maxX: number, minZ: number, maxZ: number, y: number, outAABB: AABB): void;
  /**
   * Update the wave generator.
   * @param timeInSeconds - Time in seconds.
   */
  update(timeInSeconds: number): void;
  /**
   * Get the shader hash of the wave generator.
   * @param device - Rendering device.
   */
  getHash(): string;
  /**
   * Wether this wave generator's update() method should be called this frame
   * @returns true if this wave generator's update() method should be called this frame
   */
  needUpdate(): boolean;
  /**
   * Check if the wave generator is ok.
   * @param device - Rendering device.
   */
  isOk(device: AbstractDevice): boolean;
  /**
   * Dispose the wave generator.
   */
  dispose(): void;
}
