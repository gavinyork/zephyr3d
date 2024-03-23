import type { ListIterator } from '@zephyr3d/base';
import { List } from '@zephyr3d/base';
import type {
  BindGroup,
  GPUProgram,
  RenderStateSet,
  BindGroupLayout,
  TextureSampler
} from '@zephyr3d/device';
import { ProgramBuilder } from '@zephyr3d/device';
import type { Primitive } from '../render/primitive';
import type { Drawable, DrawContext } from '../render/drawable';
import { Application } from '../app';
import {
  QUEUE_OPAQUE,
  RENDER_PASS_TYPE_DEPTH,
  RENDER_PASS_TYPE_LIGHT,
  RENDER_PASS_TYPE_SHADOWMAP
} from '../values';
import { ShaderHelper } from './shader/helper';

/**
 * Garbage collection options for material
 * @public
 */
export type MaterialGCOptions = {
  /** Whether garbage collection for materials should be disabled  */
  disabled?: boolean;
  /** Threshold for drawable count */
  drawableCountThreshold?: number;
  /** Threshold for material count */
  materialCountThreshold?: number;
  /** How long after the bind groups can be garbage collected */
  inactiveTimeDuration?: number;
  /** Whether to produce verbose output */
  verbose?: boolean;
};

type ProgramInfo = {
  programs: GPUProgram[];
  hash: string;
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
  private static _programMap: {
    [hash: string]: ProgramInfo;
  } = {};
  /** @internal */
  private static _drawableTimestamps: WeakMap<Drawable, number> = new WeakMap();
  /** @internal */
  private static _drawableIterators: WeakMap<Drawable, ListIterator<Drawable>> = new WeakMap();
  /** @internal */
  private static _drawableLRU: List<Drawable> = new List<Drawable>();
  /** @internal */
  private static _materialTimestamps: WeakMap<Material, number> = new WeakMap();
  /** @internal */
  private static _materialIterators: WeakMap<Material, ListIterator<Material>> = new WeakMap();
  /** @internal */
  private static _materialLRU: List<Material> = new List<Material>();
  /** @internal */
  private static _gcOptions: MaterialGCOptions = {
    disabled: true,
    drawableCountThreshold: 500,
    materialCountThreshold: 200,
    inactiveTimeDuration: 30000
  };
  /** @internal */
  private static _boneMatrixTextureSampler: TextureSampler = null;
  /** @internal */
  //private static _instanceBindGroupPool: InstanceBindGroupPool = new InstanceBindGroupPool();
  /** @internal */
  private static _drawableBindGroupMap: WeakMap<
    Drawable,
    {
      [hash: string]: {
        bindGroup: BindGroup[];
        xformTag: number[];
        bindGroupTag: number[];
      };
    }
  > = new WeakMap();
  /** @internal */
  protected _numPasses: number;
  /** @internal */
  protected _hash: string[][];
  /** @internal */
  protected _renderStateSet: RenderStateSet;
  /** @internal */
  private _bindGroupMap: {
    [hash: string]: {
      materialBindGroup: BindGroup[];
      materialTag: number[];
      bindGroupTag: number[];
    };
  };
  /** @internal */
  private _optionTag: number;
  /** @internal */
  private _materialBindGroup: BindGroup;
  /** @internal */
  private _id: number;
  /**
   * Creates an instance of material
   */
  constructor() {
    this._id = ++Material._nextId;
    this._numPasses = 1;
    this._hash = [[]];
    this._renderStateSet = null;
    this._bindGroupMap = {};
    this._optionTag = 0;
    this._materialBindGroup = null;
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
      this._hash.push([]);
    }
    this._numPasses = val;
  }
  /** @internal */
  protected getHash(renderPassType: number, pass: number): string {
    if (this._hash[pass][renderPassType] === void 0) {
      this._hash[pass][renderPassType] = this.createHash(renderPassType, pass);
    }
    return this._hash[pass][renderPassType];
  }
  /** Render states associated to this material */
  get stateSet(): RenderStateSet {
    if (!this._renderStateSet) {
      this._renderStateSet = this.createRenderStateSet();
    }
    return this._renderStateSet;
  }
  set stateSet(stateset: RenderStateSet) {
    this._renderStateSet = stateset;
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
  /** @internal */
  get coreMaterial(): this {
    return this;
  }
  /**
   * Draws a primitive using this material
   *
   * @param primitive - The prmitive to be drawn
   * @param ctx - The context of current drawing task
   * @param numInstances - How many instances should be drawn. if zero, the instance count will be automatically detected.
   */
  draw(primitive: Primitive, ctx: DrawContext, numInstances = 0) {
    for (let i = 0; i < this._numPasses; i++) {
      if (this.beginDraw(i, ctx)) {
        this.drawPrimitive(i, primitive, ctx, numInstances);
        this.endDraw(i);
      }
    }
  }
  /**
   * Prepares for drawing
   * @param ctx - The context of current drawing task
   * @returns true if succeeded, otherwise false
   */
  beginDraw(pass: number, ctx: DrawContext): boolean {
    const device = Application.instance.device;
    const programInfo = this.getOrCreateProgram(ctx, pass);
    if (programInfo) {
      const hash = programInfo.hash;
      if (!programInfo.programs[ctx.renderPass.type]) {
        return false;
      }
      if (pass > 0) {
        this.optionChanged(false);
      }
      this._materialBindGroup = this.applyMaterialBindGroups(ctx, hash, pass);
      if (pass === 0) {
        if (ctx.instanceData) {
          this.applyInstanceBindGroups(ctx, hash);
        } else {
          this.applyDrawableBindGroups(ctx, hash);
        }
      }
      ctx.renderPass.applyRenderStates(device, this.stateSet, ctx);
      device.setProgram(programInfo.programs[ctx.renderPass.type]);
      Material._drawableTimestamps.set(ctx.target, ctx.timestamp);
      Material.lruPutDrawable(ctx.target);
      Material._materialTimestamps.set(this, ctx.timestamp);
      Material.lruPutMaterial(this);
      return true;
    }
    return false;
  }
  /**
   * Ends drawing a primitive
   */
  endDraw(pass: number): void {
    this._materialBindGroup = null;
  }
  /**
   * Gets the bind group of this material
   * @returns The bind group of this material
   */
  getMaterialBindGroup(): BindGroup {
    return this._materialBindGroup;
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
  /**
   * Fetch the gpu program of the material for drawing
   * @param ctx - The context for current drawing task
   * @returns Information of the gpu program
   */
  getOrCreateProgram(ctx: DrawContext, pass: number): ProgramInfo {
    const programMap = Material._programMap;
    const renderPassType = ctx.renderPass.type;
    const hash = `${this.getHash(renderPassType, pass)}:${!!ctx.target.getBoneMatrices()}:${Number(
      !!ctx.instanceData
    )}:${ctx.renderPassHash}`;
    let programInfo = programMap[hash];
    if (!programInfo || programInfo.programs[renderPassType] === undefined) {
      const program = this.createProgram(ctx, pass) ?? null;
      if (!programInfo) {
        programInfo = {
          programs: [null, null, null],
          hash
        };
        programMap[hash] = programInfo;
      }
      programInfo.programs[renderPassType] = program;
    }
    return programInfo;
  }
  dispose(): void {
    this.clearBindGroupCache();
  }
  /**
   * Sets the options of garbage collection
   * @param opt - The options to set
   */
  static setGCOptions(opt: MaterialGCOptions) {
    this._gcOptions = Object.assign({}, this._gcOptions, opt || {});
  }
  /**
   * Gets the options of garbage collection
   * @returns The options of garbage collection
   */
  static getGCOptions(): MaterialGCOptions {
    return this._gcOptions;
  }
  /**
   * Performs a garbage collection for this material
   * @param ts - Current time stamp
   * @returns How many bind groups have been garbage collected
   */
  static garbageCollect(ts: number): number {
    let n = 0;
    ts -= this._gcOptions.inactiveTimeDuration;
    while (this._drawableLRU.length > this._gcOptions.drawableCountThreshold) {
      const iter = this._drawableLRU.begin();
      if (this._drawableTimestamps.get(iter.data) < ts) {
        const bindGroups = this._drawableBindGroupMap.get(iter.data);
        if (bindGroups) {
          for (const k in bindGroups) {
            for (const bindGroup of bindGroups[k].bindGroup) {
              if (bindGroup) {
                this.bindGroupGarbageCollect(bindGroup);
                n++;
              }
            }
          }
        }
        this._drawableBindGroupMap.delete(iter.data);
        this._drawableIterators.delete(iter.data);
        this._drawableLRU.remove(iter);
      } else {
        break;
      }
    }
    while (this._materialLRU.length > this._gcOptions.materialCountThreshold) {
      const iter = this._materialLRU.begin();
      const mat = iter.data as Material;
      if (this._materialTimestamps.get(mat) < ts && mat._bindGroupMap) {
        n += mat.clearBindGroupCache();
        this._materialIterators.delete(mat);
        this._materialLRU.remove(iter);
      } else {
        break;
      }
    }
    if (n > 0 && this._gcOptions.verbose) {
      console.log(`INFO: ${n} bind groups have been garbage collected`);
    }
    return n;
  }
  /** @internal */
  optionChanged(changeHash: boolean) {
    this._optionTag++;
    if (changeHash) {
      for (let i = 0; i < this._numPasses; i++) {
        this._hash[i] = [];
      }
    }
  }
  /** @internal */
  static getProgramByHashIndex(hash: string, index: number) {
    return this._programMap[hash].programs[index];
  }
  /** @internal */
  private applyMaterialBindGroups(ctx: DrawContext, hash: string, pass: number): BindGroup {
    const index = ctx.renderPass.type;
    let bindGroupInfo = this._bindGroupMap[hash];
    if (!bindGroupInfo) {
      // bindGroups not created or have been garbage collected
      const materialBindGroup = [
        RENDER_PASS_TYPE_LIGHT,
        RENDER_PASS_TYPE_SHADOWMAP,
        RENDER_PASS_TYPE_DEPTH
      ].map((k) => {
        const program = Material._programMap[hash].programs[k];
        return program?.bindGroupLayouts[2]
          ? Application.instance.device.createBindGroup(program.bindGroupLayouts[2])
          : null;
      });
      bindGroupInfo = this._bindGroupMap[hash] = {
        materialBindGroup,
        bindGroupTag: [0, 0, 0],
        materialTag: [-1, -1, -1]
      };
    }
    const bindGroup = bindGroupInfo.materialBindGroup[index];
    if (bindGroup) {
      this.applyUniforms(
        bindGroup,
        ctx,
        bindGroupInfo.materialTag[index] < this._optionTag ||
          bindGroupInfo.bindGroupTag[index] !== bindGroup.cid,
        pass
      );
      bindGroupInfo.materialTag[index] = this._optionTag;
      bindGroupInfo.bindGroupTag[index] = bindGroup.cid;
      Application.instance.device.setBindGroup(2, bindGroup);
    } else {
      Application.instance.device.setBindGroup(2, null);
    }
    return bindGroup;
  }
  /** @internal */
  private getDrawableBindGroup(
    ctx: DrawContext,
    hash: string
  ): {
    bindGroup: BindGroup[];
    xformTag: number[];
    bindGroupTag: number[];
  } {
    let drawableBindGroups = Material._drawableBindGroupMap.get(ctx.target);
    if (!drawableBindGroups) {
      drawableBindGroups = {};
      Material._drawableBindGroupMap.set(ctx.target, drawableBindGroups);
    }
    let drawableBindGroup = drawableBindGroups[hash];
    if (!drawableBindGroup) {
      const bindGroup = [RENDER_PASS_TYPE_LIGHT, RENDER_PASS_TYPE_SHADOWMAP, RENDER_PASS_TYPE_DEPTH].map(
        (k) => {
          const program = Material._programMap[hash].programs[k];
          return program?.bindGroupLayouts[1]
            ? Application.instance.device.createBindGroup(program.bindGroupLayouts[1])
            : null;
        }
      );
      drawableBindGroup = drawableBindGroups[hash] = {
        bindGroup,
        bindGroupTag: [0, 0, 0],
        xformTag: [-1, -1, -1]
      };
    }
    return drawableBindGroup;
  }
  /** @internal */
  private applyInstanceBindGroups(ctx: DrawContext, hash: string): void {
    if (ctx.instanceData) {
      if (ctx.instanceData.bindGroup.dirty) {
        ctx.instanceData.bindGroup.bindGroup.setRawData(
          ShaderHelper.getInstanceDataUniformName(),
          0,
          ctx.instanceData.bindGroup.buffer,
          0,
          ctx.instanceData.bindGroup.offset
        );
        ctx.instanceData.bindGroup.dirty = false;
      }
      Application.instance.device.setBindGroup(3, ctx.instanceData.bindGroup.bindGroup ?? null);
    } else {
      Application.instance.device.setBindGroup(3, null);
    }
    const bindGroup = this.getDrawableBindGroup(ctx, hash).bindGroup?.[ctx.renderPass.type];
    if (bindGroup) {
      if (ctx.instanceData) {
        bindGroup.setValue(ShaderHelper.getInstanceDataStrideUniformName(), ctx.instanceData.stride >> 2);
        bindGroup.setValue(ShaderHelper.getInstanceDataOffsetUniformName(), ctx.instanceData.offset >> 2);
      }
      Application.instance.device.setBindGroup(1, bindGroup);
    } else {
      Application.instance.device.setBindGroup(1, null);
    }
  }
  /** @internal */
  private applyDrawableBindGroups(ctx: DrawContext, hash: string): void {
    const device = Application.instance.device;
    const index = ctx.renderPass.type;
    const drawableBindGroup = this.getDrawableBindGroup(ctx, hash);
    if (drawableBindGroup.bindGroup) {
      const bindGroup = drawableBindGroup.bindGroup[index];
      if (
        drawableBindGroup.xformTag[index] < ctx.target.getXForm().getTag() ||
        drawableBindGroup.bindGroupTag[index] !== bindGroup.cid
      ) {
        bindGroup.setValue(ShaderHelper.getWorldMatrixUniformName(), ctx.target.getXForm().worldMatrix);
        drawableBindGroup.xformTag[index] = ctx.target.getXForm().getTag();
        drawableBindGroup.bindGroupTag[index] = bindGroup.cid;
      }
      const boneMatrices = ctx.target.getBoneMatrices();
      if (boneMatrices) {
        if (!Material._boneMatrixTextureSampler) {
          Material._boneMatrixTextureSampler = device.createSampler({
            magFilter: 'nearest',
            minFilter: 'nearest',
            mipFilter: 'none'
          });
        }
        bindGroup.setTexture(ShaderHelper.getBoneMatricesUniformName(), boneMatrices);
        bindGroup.setValue(ShaderHelper.getBoneTextureSizeUniformName(), boneMatrices.width);
        bindGroup.setValue(ShaderHelper.getBoneInvBindMatrixUniformName(), ctx.target.getInvBindMatrix());
      }
      device.setBindGroup(1, bindGroup);
    } else {
      device.setBindGroup(1, null);
    }
    device.setBindGroup(3, null);
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
  createHash(renderPassType: number, pass: number): string {
    return `${this.constructor.name}|${this.passToHash(pass)}|${this._createHash(renderPassType)}`;
  }
  /** @internal */
  clearBindGroupCache(): number {
    let n = 0;
    for (const k in this._bindGroupMap) {
      for (const bindGroup of this._bindGroupMap[k].materialBindGroup) {
        if (bindGroup) {
          Material.bindGroupGarbageCollect(bindGroup);
          n++;
        }
      }
    }
    this._bindGroupMap = {};
    return n;
  }
  /** @internal */
  static bindGroupGarbageCollect(bindGroup: BindGroup) {
    const layout: BindGroupLayout = bindGroup.getLayout();
    for (const entry of layout.entries) {
      if (entry.buffer) {
        const buffer = bindGroup.getBuffer(entry.name);
        if (buffer) {
          buffer.dispose();
          bindGroup.setBuffer(entry.name, null);
        }
      }
    }
  }
  /** @internal */
  private static lruPutDrawable(drawable: Drawable) {
    const iter = this._drawableIterators.get(drawable);
    if (iter) {
      this._drawableLRU.remove(iter);
    }
    this._drawableIterators.set(drawable, this._drawableLRU.append(drawable));
  }
  /** @internal */
  private static lruPutMaterial(material: Material) {
    const iter = this._materialIterators.get(material);
    if (iter) {
      this._materialLRU.remove(iter);
    }
    this._materialIterators.set(material, this._materialLRU.append(material));
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
    const pb = new ProgramBuilder(Application.instance.device);
    return this._createProgram(pb, ctx, pass);
  }
  /** @internal */
  protected createRenderStateSet(): RenderStateSet {
    return Application.instance.device.createRenderStateSet();
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
   * Calculates the hash code of the shader program
   * @returns The hash code
   */
  protected _createHash(renderPassType: number): string {
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
