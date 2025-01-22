import type { AbstractDevice, BindGroup, GPUProgram, RenderStateSet } from '@zephyr3d/device';
import { ProgramBuilder } from '@zephyr3d/device';
import type { Primitive } from '../render/primitive';
import type { DrawContext } from '../render/drawable';
import { QUEUE_OPAQUE } from '../values';
import { RenderBundleWrapper } from '../render/renderbundle_wrapper';

type MaterialState = {
  program: GPUProgram;
  bindGroup: BindGroup;
  bindGroupTag: string;
  renderStateSet: RenderStateSet;
  materialTag: number;
};

/**
 * Base class for any kind of materials
 *
 * @public
 */
export class Material {
  /** @internal */
  private static _nextId = 0;
  /** @internal */
  private static _programCache: { [hash: string]: GPUProgram } = {};
  /** @internal */
  private _poolId: symbol;
  /** @internal */
  private _states: { [hash: string]: MaterialState };
  /** @internal */
  protected _numPasses: number;
  /** @internal */
  protected _hash: string[];
  /** @internal */
  private _optionTag: number;
  /** @internal */
  private _id: number;
  /** @internal */
  private _currentHash: string[];
  /**
   * Creates an instance of material
   */
  constructor(poolId?: symbol) {
    if (poolId && (typeof poolId !== 'symbol' || Symbol.keyFor(poolId) === undefined)) {
      throw new Error('Material construction failed: poolId must be a symbol which is created by Symbol.for');
    }
    this._poolId = poolId ?? null;
    this._id = ++Material._nextId;
    this._states = {};
    this._numPasses = 1;
    this._hash = [null];
    this._optionTag = 0;
    this._currentHash = [];
  }
  /** Pool id */
  get poolId() {
    return this._poolId;
  }
  /** Unique identifier of the material */
  get instanceId(): number {
    return this._id;
  }
  get numPasses(): number {
    return this._numPasses;
  }
  set numPasses(val: number) {
    while (this._hash.length < val) {
      this._hash.push(null);
    }
    this._numPasses = val;
  }
  /** @internal */
  protected getHash(pass: number): string {
    if (this._hash[pass] === null) {
      this._hash[pass] = this.createHash(pass);
    }
    return this._hash[pass];
  }
  getQueueType(): number {
    return QUEUE_OPAQUE;
  }
  /** Returns true if given pass is transparent */
  isTransparentPass(pass: number): boolean {
    return false;
  }
  /** Returns true if shading of the material will be affected by lights  */
  supportLighting(): boolean {
    return true;
  }
  /** Returns true if this material supports geometry instancing  */
  supportInstancing(): boolean {
    return true;
  }
  /** Returns true if this material supports geometry instancing  */
  isBatchable(): boolean {
    return false;
  }
  /** Return true if this material requires the scene color texture */
  needSceneColor(): boolean {
    return false;
  }
  /** @internal */
  get coreMaterial(): this {
    return this;
  }
  /**
   * Apply material
   * @param ctx - Draw context
   * @returns true if no error, otherwise false
   */
  apply(ctx: DrawContext): boolean {
    for (let pass = 0; pass < this._numPasses; pass++) {
      const hash = this.calcGlobalHash(ctx, pass);
      let state = this._states[hash];
      if (!state) {
        const programHash = `${this.constructor.name}:${hash}`;
        let program = Material._programCache[programHash];
        if (!program) {
          program = this.createProgram(ctx, pass) ?? null;
          Material._programCache[programHash] = program;
        }
        const bindGroup =
          program.bindGroupLayouts.length > 2
            ? (this._poolId ? ctx.device.getPool(this._poolId) : ctx.device).createBindGroup(
                program.bindGroupLayouts[2]
              )
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
      this.applyUniforms(state.bindGroup, ctx, state.materialTag !== this._optionTag, pass);
      state.materialTag = this._optionTag;
      this.updateRenderStates(pass, state.renderStateSet, ctx);
      this._currentHash[pass] = hash;
      if (state.bindGroup) {
        const id = state.bindGroup.getGPUId();
        if (id !== state.bindGroupTag) {
          state.bindGroupTag = id;
          RenderBundleWrapper.materialChanged(this.coreMaterial);
        }
      }
    }
  }
  /** @internal */
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
    device.setBindGroup(2, state.bindGroup);
    device.setRenderStates(state.renderStateSet);
  }
  /** @internal */
  private calcGlobalHash(ctx: DrawContext, pass: number): string {
    return `${this.getHash(pass)}:${ctx.materialFlags}:${ctx.renderPassHash}`;
  }
  /**
   * Draws a primitive using this material
   * @internal
   *
   * @param primitive - The prmitive to be drawn
   * @param ctx - The context of current drawing task
   * @param numInstances - How many instances should be drawn. if zero, the instance count will be automatically detected.
   */
  draw(primitive: Primitive, ctx: DrawContext, numInstances = 0) {
    for (let pass = 0; pass < this._numPasses; pass++) {
      this.bind(ctx.device, pass);
      this.drawPrimitive(pass, primitive, ctx, numInstances);
    }
  }
  /**
   * Sets all uniform values to the bind group of the material if needed
   * @param bindGroup - The bind group of the material
   * @param ctx - The context of current drawing task
   * @param needUpdate - true if the uniform values needs to update
   */
  applyUniforms(bindGroup: BindGroup, ctx: DrawContext, needUpdate: boolean, pass: number): void {
    if (needUpdate) {
      this._applyUniforms(bindGroup, ctx, pass);
    }
  }
  /** @internal */
  optionChanged(changeHash: boolean) {
    this._optionTag++;
    if (changeHash) {
      for (let i = 0; i < this._numPasses; i++) {
        this._hash[i] = null;
      }
      RenderBundleWrapper.materialChanged(this.coreMaterial);
    }
  }
  /**
   * Convert pass to hash
   * @param pass - pass number
   * @returns String hash
   */
  passToHash(pass: number): string {
    return String(pass);
  }
  /** @internal */
  createHash(pass: number): string {
    return `${this.constructor.name}|${pass}|${this._createHash()}`;
  }
  /**
   * Draw primitve
   *
   * @param primitive - Primitive to be drawn
   * @param ctx - Draw context
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
  /** @internal */
  protected createProgram(ctx: DrawContext, pass: number): GPUProgram {
    const pb = new ProgramBuilder(ctx.device);
    return this._createProgram(pb, ctx, pass);
  }
  /**
   * Creates the shader program
   * @param pb - The program builder
   * @param ctx - The drawing context
   * @param func - The material func
   * @returns The created shader program
   */
  protected _createProgram(pb: ProgramBuilder, ctx: DrawContext, pass: number): GPUProgram {
    return null;
  }
  /**
   * Applies uniform values
   * @param bindGroup - The bind group
   * @param ctx - The drawing context
   */
  protected _applyUniforms(bindGroup: BindGroup, ctx: DrawContext, pass: number) {}
  /**
   * Update render states according to draw context and current material pass
   * @param pass - Current material pass
   * @param renderStates - Render state set to be updated
   * @param ctx - Draw context
   */
  protected updateRenderStates(pass: number, renderStates: RenderStateSet, ctx: DrawContext): void {}
  /**
   * Calculates the hash code of the shader program
   * @returns The hash code
   */
  protected _createHash(): string {
    return '';
  }
  /**
   * True if this is a material instance
   * @internal
   **/
  get $isInstance() {
    return false;
  }
  /**
   * Returns the instance uniforms if this is a material instance
   * @internal
   **/
  get $instanceUniforms(): Float32Array {
    return null;
  }
}
