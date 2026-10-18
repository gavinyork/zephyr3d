import type { AABB, IDisposable, Immutable, Vector2 } from '@zephyr3d/base';
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
   * Wind velocity in metres per second, for generators driven by a wind; the
   * foam the water carries drifts on it. Optional: without it, no wind.
   */
  readonly wind?: Immutable<Vector2>;
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
   * @param vertexSpacing - Optional distance in metres between mesh vertices
   *   around the position, for generators that band-limit their displacement
   *   to what the mesh can show; 0 or omitted for no limit.
   */
  calcVertexPositionAndNormal(
    scope: PBInsideFunctionScope,
    inPos: PBShaderExp,
    outPos: PBShaderExp,
    outNormal: PBShaderExp,
    vertexSpacing?: PBShaderExp
  ): void;
  /**
   * Where a vertex was in the previous frame, for motion vectors. Optional:
   * without it the surface is taken as not moving, which suits waves that
   * change slowly against the temporal filter.
   * @param scope - Shader scope.
   * @param inPos - Undisplaced position.
   * @param outPos - Receives the previous displaced position.
   * @param vertexSpacing - As for {@link WaveGenerator.calcVertexPositionAndNormal}.
   */
  calcPrevVertexPosition?(
    scope: PBInsideFunctionScope,
    inPos: PBShaderExp,
    outPos: PBShaderExp,
    vertexSpacing?: PBShaderExp
  ): void;
  /**
   * Calculate fragment normal.
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
   * @param foamSample - Optional inout vec3: the foam texture as the material
   *   sampled it here, (value, slope along x, slope along z). A generator that
   *   carries its foam on texture coordinates of its own (moving with its
   *   waves) blends its sample in by its share of the foam.
   * @returns (normal, foam density 0..1). The density is how much foam there
   *   is, not the area it covers: the material reveals the foam texture by it.
   */
  calcFragmentNormalAndFoam(
    scope: PBInsideFunctionScope,
    xz: PBShaderExp,
    vertexNormal: PBShaderExp,
    foamSample?: PBShaderExp
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
   * Thickness in metres of the water over the ground at an undisplaced XZ, for
   * a generator that knows the ground under it, by which the material fades a
   * thin sheet into the scene behind; unlike a depth buffer reconstruction it
   * does not move with the camera jitter.
   * Optional: without it, or where it is negative, the material reconstructs
   * the thickness from the depth buffer.
   * @param scope - Shader scope.
   * @param xz - Undisplaced XZ position.
   */
  calcSheetThickness?(scope: PBInsideFunctionScope, xz: PBShaderExp): PBShaderExp;
  /**
   * Apply water bind group.
   * @param bindGroup - Bind group to apply.
   */
  applyWaterBindGroup(bindGroup: BindGroup): void;
  /**
   * Bounding box of a clipmap tile with the wave displacement applied.
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
   * Whether this wave generator's update() method should be called this frame
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
