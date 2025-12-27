import type { AbstractDevice, BindGroup, GPUProgram, RenderStateSet } from '@zephyr3d/device';
import { ProgramBuilder } from '@zephyr3d/device';
import type { Primitive } from '../render/primitive';
import type { DrawContext } from '../render/drawable';
import { QUEUE_OPAQUE } from '../values';
import { RenderBundleWrapper } from '../render/renderbundle_wrapper';
import { Disposable } from '@zephyr3d/base';
import type { Clonable, IDisposable, Nullable } from '@zephyr3d/base';
import { getEngine } from '../app/api';

type MaterialState = {
  program: GPUProgram;
  bindGroup: Nullable<BindGroup>;
  bindGroupTag: string;
  renderStateSet: RenderStateSet;
  materialTag: number;
};

/**
 * Base class for all materials.
 *
 * Responsibilities:
 * - Defines a multi-pass rendering interface (`numPasses`, `apply`, `bind`, `draw`, `drawPrimitive`).
 * - Builds and caches GPU shader programs per pass and per-render-context hash.
 * - Manages a per-material bind group (typically at index 2) for uniforms and resources.
 * - Updates render states per pass (`updateRenderStates`) and uploads uniforms (`_applyUniforms`).
 * - Tracks "option" changes that affect shader variant hashing and render bundles.
 *
 * Caching and hashing:
 * - `createHash(pass)` produces a stable hash representing shader variant options for a pass.
 *   Override `_createHash()` in subclasses to encode feature toggles (defines, keywords, macros).
 * - The global hash used to key `MaterialState` also includes `ctx.materialFlags` and
 *   `ctx.renderPassHash`, allowing context-sensitive variants (e.g., MSAA, MRT layout).
 * - GPU programs are additionally memoized in a global static `_programCache` across materials
 *   by `constructor.name` + hash, to avoid recompilation of identical variants.
 *
 * Bind groups and uniforms:
 * - If a program declares a bind group layout at index 2 (i.e., `bindGroupLayouts.length > 2`),
 *   `apply()` will allocate the group and keep it in the state. Subclasses should fill it in
 *   `_applyUniforms()`.
 * - `applyUniforms()` only calls `_applyUniforms()` when `needUpdate` is true, based on
 *   `_optionTag` changes (see `optionChanged()`).
 *
 * Lifecycle:
 * - Constructed materials register a persistent ID into a global registry for serialization.
 * - `apply(ctx)` prepares all passes: creates/gets state, programs, bind groups, render states,
 *   and uploads uniforms as needed.
 * - `bind(device, pass)` binds the program, bind group (index 2), and render states.
 * - `draw(primitive, ctx, numInstances)` runs all passes, calling `bind()` and `drawPrimitive()`.
 * - `onDispose()` releases bind groups and registry entries.
 *
 * Extending:
 * - Override `_createProgram(pb, ctx, pass)` to build a shader.
 * - Override `_applyUniforms(bindGroup, ctx, pass)` to upload uniforms and resources.
 * - Override `updateRenderStates(pass, renderStates, ctx)` to set depth, blend, cull, etc.
 * - Override `_createHash()` to encode options that affect program compilation.
 * - Override `supportLighting`, `supportInstancing`, `isTransparentPass`, `getQueueType`, etc.
 *
 * Thread-safety:
 * - Intended for main-thread use in a renderer driving WebGPU/WebGL-like devices.
 *
 * @public
 */
export class Material extends Disposable implements Clonable<Material>, IDisposable {
  /**
   * Monotonic instance ID counter.
   * @internal
   */
  private static _nextId = 0;
  /**
   * Per-material state cache keyed by global hash (material + context + pass).
   * @internal
   */
  private _states: { [hash: string]: MaterialState };
  /**
   * Number of rendering passes.
   * Subclasses can increase this to implement multi-pass rendering.
   * @internal
   */
  protected _numPasses: number;
  /**
   * Per-pass hash cached results. Length scales with `numPasses`.
   * @internal
   */
  protected _hash: Nullable<string>[];
  /**
   * Incremented each time options change (via `optionChanged`), used to decide whether
   * uniforms need update on next `apply()`.
   * @internal
   */
  private _optionTag: number;
  /**
   * Unique runtime instance ID.
   * @internal
   */
  protected readonly _id: number;
  /**
   * Latest computed global hash per pass, set during `apply()`, read in `bind()`.
   * @internal
   */
  private _currentHash: string[];
  /**
   * Incremented when material states affecting render bundles change (e.g., bind group id changes
   * or `optionChanged(true)`), used to trigger re-recording of render bundles.
   * @internal
   */
  private _changeTag: number;
  /**
   * Unique program id counter for naming compiled programs.
   * @internal
   */
  private _nextProgramId = 0;
  /**
   * Create a new material instance.
   *
   * - Initializes one pass by default.
   * - Prepares per-pass hash storage and change tracking.
   * - Registers a persistent ID in the global registry.
   */
  constructor() {
    super();
    this._id = ++Material._nextId;
    this._nextProgramId = 0;
    this._states = {};
    this._numPasses = 1;
    this._hash = [null];
    this._optionTag = 0;
    this._changeTag = 0;
    this._currentHash = [];
  }
  /**
   * Create a shallow clone of this material.
   *
   * Note: The base implementation returns a base `Material`. Subclasses should
   * override to return their own type and copy custom fields.
   */
  clone(): Material {
    const other = new Material();
    other.copyFrom(this);
    return other;
  }
  /**
   * Copy basic properties from another material.
   *
   * Disposes existing bind groups/states, copies `numPasses`. Subclasses should
   * extend this to copy their own fields and call `optionChanged(true)` if
   * shader-affecting options differ.
   *
   * @param other - Source material.
   */
  copyFrom(other: this) {
    this.clearCache();
    this._numPasses = other._numPasses;
    getEngine().resourceManager.setAssetId(this, getEngine().resourceManager.getAssetId(other.coreMaterial));
  }
  /**
   * Incremented when the material’s GPU-relevant state changes and render bundles
   * may need to be rebuilt.
   */
  get changeTag() {
    return this._changeTag;
  }
  /**
   * Runtime-unique numeric identifier for the material instance.
   */
  get instanceId(): number {
    return this._id;
  }
  /**
   * Number of rendering passes this material uses.
   *
   * Increasing this will expand the per-pass hash cache; make sure to implement
   * `createHash(pass)`, `_createProgram(pb, ctx, pass)`, and `updateRenderStates(pass, ...)`
   * accordingly for each pass.
   */
  get numPasses(): number {
    return this._numPasses;
  }
  set numPasses(val: number) {
    while (this._hash.length < val) {
      this._hash.push(null);
    }
    this._numPasses = val;
  }
  /**
   * Get or compute the per-pass shader hash used for program caching.
   *
   * Calls `createHash(pass)` lazily and caches the result.
   * @internal
   */
  protected getHash(pass: number): string {
    if (this._hash[pass] === null) {
      this._hash[pass] = this.createHash(pass);
    }
    return this._hash[pass];
  }
  /**
   * Return the queue type to which this material belongs.
   *
   * Override this in transparent or special materials (e.g., post-process).
   */
  getQueueType(): number {
    return QUEUE_OPAQUE;
  }
  /**
   * Whether the given pass is transparent.
   *
   * Used to place draw calls into appropriate render queues and set blending states.
   */
  isTransparentPass(_pass: number): boolean {
    return false;
  }
  /**
   * Whether this material's shading is affected by scene lights.
   *
   * Override and return `false` for unlit materials.
   */
  supportLighting(): boolean {
    return true;
  }
  /**
   * Whether this material supports hardware instancing.
   *
   * Override and return `false` if per-instance data is not supported in the shader.
   */
  supportInstancing(): boolean {
    return true;
  }
  /** Returns true if this is a instance of material */
  isBatchable(): boolean {
    return false;
  }

  /**
   * Whether this material requires the scene color texture (e.g., for refraction).
   */
  needSceneColor(): boolean {
    return false;
  }
  /**
   * Whether this material requires the linear scene depth texture (e.g., for depth-aware effects).
   */
  needSceneDepth(): boolean {
    return false;
  }
  /**
   * Create a material instance (instance-uniform-driven variant).
   *
   * Base returns `null`. Subclasses that support instancing can return a lightweight instance.
   */
  createInstance(): this {
    throw new Error('Abstract function call');
  }
  /**
   * Returns the core material that owns GPU state.
   *
   * Instances may delegate to a shared core to reuse compiled programs and caches.
   * @internal
   */
  get coreMaterial(): this {
    return this;
  }
  /**
   * Prepare the material for drawing across all passes for the given draw context.
   *
   * Steps per pass:
   * - Compute global hash (material variant + context).
   * - Retrieve or build the GPU program, cache in `_programCache`.
   * - Create per-material bind group (index 2) if the program exposes it.
   * - Update uniforms if `_optionTag` indicates changes since last apply.
   * - Update and cache render states for the pass.
   * - Detect bind group GPU ID changes to bump `changeTag` and notify `RenderBundleWrapper`.
   *
   * @param ctx - Draw context (device, flags, pass hash, instance data, etc.).
   * @returns `true` if successful; `false` if any pass lacks a valid program.
   */
  apply(ctx: DrawContext): boolean {
    for (let pass = 0; pass < this._numPasses; pass++) {
      const hash = this.calcGlobalHash(ctx, pass);
      let state = this._states[hash];
      if (!state) {
        const program = this.createProgram(ctx, pass) ?? null;
        program.name = `@${this.constructor.name}_program_${this._nextProgramId++}`;
        const bindGroup =
          program.bindGroupLayouts.length > 2
            ? ctx.device.createBindGroup(program.bindGroupLayouts[2])
            : null;
        state = {
          program,
          bindGroup,
          bindGroupTag: bindGroup?.getGPUId() ?? '',
          renderStateSet: ctx.device.createRenderStateSet(),
          materialTag: -1
        };
        this._states[hash] = state;
      }
      if (!state.program) {
        return false;
      }
      if (state.bindGroup) {
        this.applyUniforms(state.bindGroup, ctx, state.materialTag !== this._optionTag, pass);
      }
      state.materialTag = this._optionTag;
      this.updateRenderStates(pass, state.renderStateSet, ctx);
      this._currentHash[pass] = hash;
      if (state.bindGroup) {
        const id = state.bindGroup.getGPUId();
        if (id !== state.bindGroupTag) {
          state.bindGroupTag = id;
          this._changeTag++;
          RenderBundleWrapper.materialChanged(this.coreMaterial);
        }
      }
    }
    return true;
  }
  /**
   * Bind the program, bind group, and render states for the specified pass.
   *
   * Must be called after `apply(ctx)` for the same pass.
   *
   * @param device - Rendering device.
   * @param pass - Pass index to bind.
   * @returns `true` on success; `false` if state or program missing.
   * @internal
   */
  bind(device: AbstractDevice, pass: number): boolean {
    const hash = this._currentHash[pass];
    const state = this._states[hash];
    if (!state) {
      console.error('Material.bind() failed: state not found');
      return false;
    }
    if (!state.program) {
      return false;
    }
    device.setProgram(state.program);
    if (state.bindGroup) {
      device.setBindGroup(2, state.bindGroup);
    }
    device.setRenderStates(state.renderStateSet);
    return true;
  }
  /**
   * Compute the global hash for the given pass and draw context.
   *
   * Includes:
   * - Per-pass material hash from `getHash(pass)`.
   * - `ctx.materialFlags` for context-dependent toggles.
   * - `ctx.renderPassHash` for framebuffer/attachment layout variants.
   * @internal
   */
  private calcGlobalHash(ctx: DrawContext, pass: number): string {
    return `${this.getHash(pass)}:${ctx.materialFlags}:${ctx.renderPassHash}`;
  }
  /**
   * Draw a primitive for all passes using this material.
   *
   * Calls `bind()` then `drawPrimitive()` per pass. If `numInstances` is zero,
   * and `ctx.instanceData` exists, uses `ctx.instanceData.numInstances`.
   *
   * @param primitive - Geometry to draw.
   * @param ctx - Draw context.
   * @param numInstances - Instance count; 0 means auto-detect from context.
   * @internal
   */
  draw(primitive: Primitive, ctx: DrawContext, numInstances = 0) {
    for (let pass = 0; pass < this._numPasses; pass++) {
      this.bind(ctx.device, pass);
      this.drawPrimitive(pass, primitive, ctx, numInstances);
    }
  }
  /**
   * Conditionally update uniforms/resources into the material bind group.
   *
   * Delegates to `_applyUniforms()` when `needUpdate` is true (based on `_optionTag` check).
   *
   * @param bindGroup - Material bind group at index 2 (may be `null` if program has no layout).
   * @param ctx - Draw context.
   * @param needUpdate - Whether uniforms need to be refreshed.
   * @param pass - Pass index.
   */
  applyUniforms(bindGroup: BindGroup, ctx: DrawContext, needUpdate: boolean, pass: number): void {
    if (needUpdate) {
      this._applyUniforms(bindGroup, ctx, pass);
    }
  }
  /**
   * Notify the material that some option changed.
   *
   * - Always increments `_optionTag`. This will trigger uniforms update on next `apply()`.
   * - If `changeHash` is true, clears per-pass hashes so programs/states will be rebuilt,
   *   increments `_changeTag`, and notifies `RenderBundleWrapper` to regenerate recorded bundles.
   *
   * @param changeHash - Set true if the change affects shader compilation or render states.
   * @internal
   */
  optionChanged(changeHash: boolean) {
    this._optionTag++;
    if (changeHash) {
      for (let i = 0; i < this._numPasses; i++) {
        this._hash[i] = null;
      }
      this._changeTag++;
      RenderBundleWrapper.materialChanged(this.coreMaterial);
    }
  }
  clearCache() {
    for (const k in this._states) {
      this._states[k]?.bindGroup?.dispose();
      this._states[k]?.program?.dispose();
    }
    this._states = {};
  }
  /**
   * Convert a pass index to a hash seed string.
   *
   * Subclasses may override to encode per-pass role (e.g., "depth", "forward", "shadow").
   *
   * @param pass - Pass number.
   * @returns String used when building full hash.
   */
  passToHash(pass: number): string {
    return String(pass);
  }
  /**
   * Build the material hash for a pass (excluding context-dependent parts).
   *
   * Default formula: `${constructor.name}|${pass}|${_createHash()}`
   *
   * @param pass - Pass number.
   * @returns Hash string used in program caching.
   * @internal
   */
  createHash(pass: number): string {
    return `${this.constructor.name}|${pass}|${this._createHash()}`;
  }
  /**
   * Issue the actual draw call for a pass.
   *
   * Override for custom per-pass draw behavior if necessary. The default implementation:
   * - Draws instanced if `numInstances > 0`.
   * - Else uses `ctx.instanceData.numInstances` if available.
   * - Else issues a non-instanced draw.
   *
   * @param pass - Pass number.
   * @param primitive - Primitive to draw.
   * @param ctx - Draw context.
   * @param numInstances - Explicit instance count (0 = auto).
   */
  drawPrimitive(pass: number, primitive: Primitive, ctx: DrawContext, numInstances: number): void {
    if (numInstances > 0) {
      primitive.drawInstanced(numInstances);
    } else if (ctx.instanceData) {
      primitive.drawInstanced(ctx.instanceData.numInstances);
    } else {
      primitive.draw();
    }
  }
  /**
   * Dispose the material and release GPU-side resource references.
   *
   * - Unregisters from the global registry.
   * - Disposes the per-material bind groups kept in `_states`.
   */
  protected onDispose() {
    super.onDispose();
    this.clearCache();
  }
  /**
   * Build the GPU program for a pass.
   *
   * Default creates a `ProgramBuilder` and calls `_createProgram(pb, ctx, pass)`.
   * Subclasses should override `_createProgram` instead of this method unless
   * they need to replace builder instantiation.
   *
   * @param ctx - Draw context.
   * @param pass - Pass number.
   * @returns The compiled `GPUProgram`, or `null` on failure.
   * @internal
   */
  protected createProgram(ctx: DrawContext, pass: number): GPUProgram {
    const pb = new ProgramBuilder(ctx.device);
    return this._createProgram(pb, ctx, pass);
  }
  /**
   * Create and compile the shader program for this material/pass.
   *
   * Implement in subclasses:
   * - Define shader stages, entry points, macros/defines, and resource layouts.
   * - Return a compiled `GPUProgram`.
   *
   * @param pb - Program builder.
   * @param ctx - Draw context.
   * @param _pass - Pass number.
   * @returns The created program, or `null` on failure.
   */
  protected _createProgram(_pb: ProgramBuilder, _ctx: DrawContext, _pass: number): GPUProgram {
    throw new Error('Abstract function call');
  }
  /**
   * Upload uniforms and bind resources to the per-material bind group (index 2).
   *
   * Implement in subclasses to:
   * - Write uniform buffers/textures/samplers to the `bindGroup`.
   * - Respect the current `pass` and `ctx`.
   *
   * @param _bindGroup - The bind group to populate.
   * @param _ctx - Draw context.
   * @param _pass - Pass number.
   */
  protected _applyUniforms(_bindGroup: BindGroup, _ctx: DrawContext, _pass: number) {}
  /**
   * Update render states (depth/stencil, blending, rasterization) for the pass.
   *
   * Implement in subclasses based on transparency, double-sidedness, depth writes/tests,
   * color mask, stencil ops, etc., and any context flags in `ctx`.
   *
   * @param _pass - Current pass index.
   * @param _renderStates - Render state set to mutate.
   * @param _ctx - Draw context.
   */
  protected updateRenderStates(_pass: number, _renderStates: RenderStateSet, _ctx: DrawContext): void {}
  /**
   * Compute the material-specific portion of the shader hash for the current options.
   *
   * Subclasses should override to include macro/define sets that influence program compilation.
   * Example return: `"USE_NORMALMAP=1;ALPHA_MODE=BLEND;RECEIVE_SHADOWS=1"`.
   *
   * @returns Hash fragment string (no context/pass info).
   */
  protected _createHash(): string {
    return '';
  }
  /**
   * Whether this is a lightweight instance of a core material.
   *
   * Instances typically share GPU programs with a core and only override instance uniforms.
   * @internal
   */
  get $isInstance() {
    return false;
  }
  /**
   * Instance-uniform buffer for material instances, if supported.
   *
   * Returned as a typed Float32 view over a backing ArrayBuffer.
   * @internal
   */
  get $instanceUniforms(): Float32Array<ArrayBuffer> {
    throw new Error('Abstract function call');
  }
}
