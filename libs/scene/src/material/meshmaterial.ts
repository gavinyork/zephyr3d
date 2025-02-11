import type {
  BindGroup,
  FaceMode,
  GPUProgram,
  PBFunctionScope,
  PBInsideFunctionScope,
  PBShaderExp,
  RenderStateSet
} from '@zephyr3d/device';
import { ProgramBuilder } from '@zephyr3d/device';
import {
  MaterialVaryingFlags,
  QUEUE_OPAQUE,
  QUEUE_TRANSPARENT,
  RENDER_PASS_TYPE_DEPTH,
  RENDER_PASS_TYPE_LIGHT,
  RENDER_PASS_TYPE_OBJECT_COLOR,
  RENDER_PASS_TYPE_SHADOWMAP
} from '../values';
import { Material } from './material';
import type { DepthPass } from '../render';
import { type DrawContext, type ShadowMapPass } from '../render';
import { encodeNormalizedFloatToRGBA, packFloat16x2 } from '../shaders';
import { Application, Ref, WeakRef } from '../app';
import { ShaderHelper } from './shader/helper';
import type { Clonable } from '@zephyr3d/base';
import { Vector2, Vector3, Vector4, applyMixins } from '@zephyr3d/base';
import { RenderBundleWrapper } from '../render/renderbundle_wrapper';

/**
 * Blending mode for mesh material
 * @public
 */
export type BlendMode = 'none' | 'blend' | 'additive';

/**
 * Extract mixin return type
 * @public
 */
export type ExtractMixinReturnType<M> = M extends (target: infer A) => infer R ? R : never;

/**
 * Extract mixin type
 * @public
 */
export type ExtractMixinType<M> = M extends [infer First]
  ? ExtractMixinReturnType<First>
  : M extends [infer First, ...infer Rest]
  ? ExtractMixinReturnType<First> & ExtractMixinType<[...Rest]>
  : never;

/**
 * Apply material mixins to specific material class
 * @param target - Material class
 * @param mixins - mixins
 * @returns Mixed mesh material class
 *
 * @public
 */
export function applyMaterialMixins<M extends ((target: any) => any)[], T>(
  target: T,
  ...mixins: M
): ExtractMixinType<M> & T {
  return applyMixins(target, ...mixins);
}

let FEATURE_ALPHATEST = 0;
let FEATURE_ALPHABLEND = 0;
let FEATURE_ALPHATOCOVERAGE = 0;

/** @internal */
export type InstanceUniformType = 'float' | 'vec2' | 'vec3' | 'vec4' | 'rgb' | 'rgba';

/**
 * Base class for any kind of mesh materials
 *
 * @public
 */
export class MeshMaterial extends Material implements Clonable<MeshMaterial> {
  /** @internal */
  static INSTANCE_UNIFORMS: { prop: string; type: InstanceUniformType; offset: number }[] = [];
  /** @internal */
  static NEXT_FEATURE_INDEX = 3;
  /** @internal */
  static OBJECT_COLOR_UNIFORM = this.defineInstanceUniform('objectColor', 'rgba');
  /** @internal */
  static OPACITY_UNIFORM = this.defineInstanceUniform('opacity', 'float');
  /** @internal */
  private _featureStates: unknown[];
  /** @internal */
  private _alphaCutoff: number;
  /** @internal */
  private _blendMode: BlendMode;
  /** @internal */
  private _cullMode: FaceMode;
  /** @internal */
  private _opacity: number;
  /** @internal */
  private _objectColor: Vector4;
  /** @internal */
  private _ctx: DrawContext;
  /** @internal */
  private _materialPass: number;
  /**
   * Creates an instance of MeshMaterial class
   * @param args - constructor arguments
   */
  constructor() {
    super();
    this._featureStates = [];
    this._alphaCutoff = 0;
    this._blendMode = 'none';
    this._cullMode = 'back';
    this._opacity = 1;
    this._objectColor = Vector4.one();
    this._ctx = null;
    this._materialPass = -1;
    this.useFeature(FEATURE_ALPHABLEND, this._blendMode);
  }
  clone(): MeshMaterial {
    const other = new MeshMaterial();
    other.copyFrom(this);
    return other;
  }
  copyFrom(other: this): void {
    super.copyFrom(other);
    this.alphaCutoff = other.alphaCutoff;
    this.blendMode = other.blendMode;
    this.cullMode = other.cullMode;
    this.opacity = other.opacity;
    this.objectColor = other.objectColor;
  }
  /** Indicate that the uniform has changed and needs to be resubmitted. */
  uniformChanged() {
    this.optionChanged(false);
  }
  /** Define feature index */
  static defineFeature(): number {
    const val = this.NEXT_FEATURE_INDEX;
    this.NEXT_FEATURE_INDEX++;
    return val;
  }
  /** @internal */
  private static getNumComponents(type: InstanceUniformType) {
    if (type === 'float') {
      return 1;
    }
    if (type === 'vec2') {
      return 2;
    }
    if (type === 'rgb' || type === 'vec3') {
      return 3;
    }
    if (type === 'rgba' || type === 'vec4') {
      return 4;
    }
    return 0;
  }
  /** Define instance uniform index */
  static defineInstanceUniform(prop: string, type: InstanceUniformType): number {
    if (this.INSTANCE_UNIFORMS.findIndex((val) => val.prop === prop) >= 0) {
      throw new Error(`${this.name}.defineInstanceUniform(): ${prop} was already defined`);
    }
    const numComponents = this.getNumComponents(type);
    if (numComponents === 0) {
      throw new Error(`${this.name}.defineInstanceUniform(): invalid uniform type ${type}`);
    }
    let index = this.INSTANCE_UNIFORMS.length;
    let offset = 0;
    if (this.INSTANCE_UNIFORMS.length > 0) {
      const lastUniform = this.INSTANCE_UNIFORMS[this.INSTANCE_UNIFORMS.length - 1];
      const finalOffset = (lastUniform.offset + 4) & ~3;
      offset = finalOffset;
      for (let i = 0; i < this.INSTANCE_UNIFORMS.length; i++) {
        const offset1 = this.INSTANCE_UNIFORMS[i].offset;
        const numComps1 = this.getNumComponents(this.INSTANCE_UNIFORMS[i].type);
        const offset2 =
          i === this.INSTANCE_UNIFORMS.length - 1 ? finalOffset : this.INSTANCE_UNIFORMS[i + 1].offset;
        if (offset1 + numComps1 + numComponents <= offset2) {
          index = i + 1;
          offset = offset1 + numComps1;
          if (offset + numComponents === offset2) {
            break;
          }
        }
      }
    }
    this.INSTANCE_UNIFORMS = this.INSTANCE_UNIFORMS.slice();
    this.INSTANCE_UNIFORMS.splice(index, 0, { prop, offset, type });
    return (offset << 2) | (numComponents - 1);
  }
  getInstancedUniform(scope: PBInsideFunctionScope, uniformIndex: number): PBShaderExp {
    const pb = scope.$builder;
    const instanceID = scope.$builtins.instanceIndex;
    const uniformName = ShaderHelper.getInstanceDataUniformName();
    const strideName = ShaderHelper.getInstanceDataStrideUniformName();
    const offsetName = ShaderHelper.getInstanceDataOffsetUniformName();
    const numComponents = (uniformIndex & 3) + 1;
    const vecIndex = uniformIndex >> 4;
    const vecOffset = (uniformIndex >> 2) & 3;
    const u = scope[uniformName].at(
      pb.add(
        pb.mul(scope[strideName], instanceID),
        ShaderHelper.MATERIAL_INSTANCE_DATA_OFFSET + vecIndex,
        scope[offsetName]
      )
    );
    const m = ['x', 'y', 'z', 'w'].slice(vecOffset, vecOffset + numComponents).join('');
    return u[m];
  }
  /** Get instanced material property list */
  getInstancedUniforms() {
    return (this.constructor as typeof MeshMaterial).INSTANCE_UNIFORMS;
  }
  /** Create material instance */
  createInstance(): this {
    if (this.$isInstance) {
      return this.coreMaterial.createInstance();
    }
    const isWebGL1 = Application.instance.device.type === 'webgl';
    if (isWebGL1 || !this.supportInstancing) {
      return this.clone() as this;
    }
    const instanceUniforms = this.getInstancedUniforms();
    const uniformsHolder =
      instanceUniforms.length > 0
        ? new Float32Array((instanceUniforms[instanceUniforms.length - 1].offset + 4) & ~3)
        : null;
    const instance = {} as any;
    const that = this;
    const coreMaterial = new Ref(that);
    let disposed = false;
    instance.isBatchable = () => true; //!isWebGL1 && that.supportInstancing();
    instance.dispose = () => {
      if (!disposed) {
        disposed = true;
        coreMaterial.dispose();
      }
    };
    instance.$instanceUniforms = uniformsHolder;
    instance.$isInstance = true;
    let persistentId = crypto.randomUUID();
    Material._registry.set(persistentId, new WeakRef(instance));
    Object.defineProperty(instance, 'coreMaterial', {
      get: function () {
        return coreMaterial.get();
      }
    });
    Object.defineProperty(instance, 'persistentId', {
      get: function () {
        return persistentId;
      },
      set: function (val) {
        if (val !== persistentId) {
          const m = Material._registry.get(persistentId);
          if (!m || m.get() !== instance) {
            throw new Error('Registry material mismatch');
          }
          Material._registry.delete(persistentId);
          persistentId = val;
          Material._registry.set(persistentId, m);
        }
      }
    });

    // Copy original uniform values
    for (let i = 0; i < instanceUniforms.length; i++) {
      const { prop, offset, type } = instanceUniforms[i];
      const value = that[prop];
      switch (type) {
        case 'float': {
          uniformsHolder[offset] = Number(value);
          Object.defineProperty(instance, prop, {
            get() {
              return uniformsHolder[offset];
            },
            set(value) {
              uniformsHolder[offset] = value;
              RenderBundleWrapper.materialUniformsChanged(instance);
            }
          });
          break;
        }
        case 'vec2': {
          if (!(value instanceof Vector2)) {
            throw new Error(`Instance uniform property ${prop} must be of type Vector2`);
          }
          uniformsHolder[offset] = value.x;
          uniformsHolder[offset + 1] = value.y;
          Object.defineProperty(instance, prop, {
            get() {
              return new Vector2(uniformsHolder[offset], uniformsHolder[offset + 1]);
            },
            set(value) {
              if (!(value instanceof Vector2)) {
                throw new Error(`Instance uniform property ${prop} must be of type Vector2`);
              }
              uniformsHolder[offset] = value.x;
              uniformsHolder[offset + 1] = value.y;
              RenderBundleWrapper.materialUniformsChanged(instance);
            }
          });
          break;
        }
        case 'vec3':
        case 'rgb': {
          if (!(value instanceof Vector3)) {
            throw new Error(`Instance uniform property ${prop} must be of type Vector3`);
          }
          uniformsHolder[offset] = value.x;
          uniformsHolder[offset + 1] = value.y;
          uniformsHolder[offset + 2] = value.z;
          Object.defineProperty(instance, prop, {
            get() {
              return new Vector3(
                uniformsHolder[offset],
                uniformsHolder[offset + 1],
                uniformsHolder[offset + 2]
              );
            },
            set(value) {
              if (!(value instanceof Vector3)) {
                throw new Error(`Instance uniform property ${prop} must be of type Vector3`);
              }
              uniformsHolder[offset] = value.x;
              uniformsHolder[offset + 1] = value.y;
              uniformsHolder[offset + 2] = value.z;
              RenderBundleWrapper.materialUniformsChanged(instance);
            }
          });
          break;
        }
        case 'vec4':
        case 'rgba': {
          if (!(value instanceof Vector4)) {
            throw new Error(`Instance uniform property ${prop} must be of type Vector4`);
          }
          uniformsHolder[offset] = value.x;
          uniformsHolder[offset + 1] = value.y;
          uniformsHolder[offset + 2] = value.z;
          uniformsHolder[offset + 3] = value.w;
          Object.defineProperty(instance, prop, {
            get() {
              return new Vector4(
                uniformsHolder[offset],
                uniformsHolder[offset + 1],
                uniformsHolder[offset + 2],
                uniformsHolder[offset + 3]
              );
            },
            set(value) {
              if (!(value instanceof Vector4)) {
                throw new Error(`Instance uniform property ${prop} must be of type Vector4`);
              }
              uniformsHolder[offset] = value.x;
              uniformsHolder[offset + 1] = value.y;
              uniformsHolder[offset + 2] = value.z;
              uniformsHolder[offset + 3] = value.w;
              RenderBundleWrapper.materialUniformsChanged(instance);
            }
          });
          break;
        }
      }
    }
    Object.setPrototypeOf(instance, that);
    return instance;
  }
  /** Draw context for shader creation */
  get drawContext(): DrawContext {
    return this._ctx;
  }
  /**
   * Current material pass
   * @internal
   **/
  get pass(): number {
    return this._materialPass;
  }
  /** A value between 0 and 1, presents the cutoff for alpha testing */
  get alphaCutoff(): number {
    return this._alphaCutoff;
  }
  set alphaCutoff(val: number) {
    if (this._alphaCutoff !== val) {
      this.useFeature(FEATURE_ALPHATEST, val > 0);
      this._alphaCutoff = val;
      this.uniformChanged();
    }
  }
  get alphaToCoverage(): boolean {
    return this.featureUsed(FEATURE_ALPHATOCOVERAGE);
  }
  set alphaToCoverage(val: boolean) {
    this.useFeature(FEATURE_ALPHATOCOVERAGE, !!val);
  }
  /** Blending mode */
  get blendMode(): BlendMode {
    return this._blendMode;
  }
  set blendMode(val: BlendMode) {
    if (this._blendMode !== val) {
      this._blendMode = val;
      this.useFeature(FEATURE_ALPHABLEND, this._blendMode);
    }
  }
  /** Cull mode */
  get cullMode(): FaceMode {
    return this._cullMode;
  }
  set cullMode(val: FaceMode) {
    this._cullMode = val;
  }
  /** A value between 0 and 1, presents the opacity */
  get opacity(): number {
    return this._opacity;
  }
  set opacity(val: number) {
    val = val < 0 ? 0 : val > 1 ? 1 : val;
    if (this._opacity !== val) {
      this._opacity = val;
      this.uniformChanged();
    }
  }
  /** Object color used for GPU picking */
  get objectColor(): Vector4 {
    return this._objectColor;
  }
  set objectColor(val: Vector4) {
    if (val !== this._objectColor) {
      this._objectColor.set(val ?? Vector4.one());
      this.uniformChanged();
    }
  }
  /** Returns true if shading of the material will be affected by lights  */
  supportLighting(): boolean {
    return true;
  }
  /**
   * {@inheritDoc Material.updateRenderStates}
   */
  protected updateRenderStates(pass: number, stateSet: RenderStateSet, ctx: DrawContext): void {
    const isObjectColorPass = ctx.renderPass.type === RENDER_PASS_TYPE_OBJECT_COLOR;
    const blending =
      !isObjectColorPass && (this.featureUsed<BlendMode>(FEATURE_ALPHABLEND) !== 'none' || ctx.lightBlending);
    const a2c = !isObjectColorPass && this.featureUsed<boolean>(FEATURE_ALPHATOCOVERAGE);
    const ztestEq = ctx.queue === QUEUE_OPAQUE && !!ctx.depthTexture;
    if (blending || a2c) {
      const blendingState = stateSet.useBlendingState();
      if (blending) {
        blendingState.enable(true);
        blendingState.setBlendFuncAlpha('zero', 'one');
        blendingState.setBlendEquation('add', 'add');
        if (this._blendMode === 'additive' || ctx.lightBlending) {
          blendingState.setBlendFuncRGB('one', 'one');
        } else {
          blendingState.setBlendFuncRGB('one', 'inv-src-alpha');
        }
      } else {
        blendingState.enable(false);
      }
      blendingState.enableAlphaToCoverage(a2c);
      if (ztestEq) {
        stateSet.useDepthState().setCompareFunc('eq').enableTest(true).enableWrite(false);
      } else if (blendingState.enabled) {
        stateSet.useDepthState().enableTest(true).enableWrite(false);
      } else {
        stateSet.defaultDepthState();
      }
    } else if (stateSet.blendingState?.enabled && !blending) {
      stateSet.defaultBlendingState();
      if (ztestEq) {
        stateSet.useDepthState().setCompareFunc('eq').enableTest(true).enableWrite(false);
      } else {
        stateSet.defaultDepthState();
      }
    }
    if (ctx.forceCullMode || this._cullMode !== 'back') {
      stateSet.useRasterizerState().cullMode = ctx.forceCullMode || this._cullMode;
    } else if (ctx.renderPass.type === RENDER_PASS_TYPE_SHADOWMAP) {
      stateSet.useRasterizerState().cullMode = 'none';
    } else {
      stateSet.defaultRasterizerState();
    }
    if (ctx.forceColorState) {
      stateSet.useColorState(ctx.forceColorState);
    } else {
      stateSet.defaultColorState();
    }
    stateSet.defaultStencilState();
    if (ctx.oit) {
      ctx.oit.setRenderStates(stateSet);
    }
  }
  /**
   * Submit Uniform values before rendering with this material.
   *
   * @param bindGroup - Bind group for this material
   * @param ctx - Draw context
   * @param pass - Current pass of the material
   */
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number): void {
    if (this.featureUsed(FEATURE_ALPHATEST)) {
      bindGroup.setValue('zAlphaCutoff', this._alphaCutoff);
    }
    if (this.isTransparentPass(pass) && !(ctx.materialFlags & MaterialVaryingFlags.INSTANCING)) {
      bindGroup.setValue('zOpacity', this._opacity);
    }
    if (ctx.oit) {
      ctx.oit.applyUniforms(ctx, bindGroup);
    }
    if (
      !(ctx.materialFlags & MaterialVaryingFlags.INSTANCING) &&
      ctx.renderPass.type === RENDER_PASS_TYPE_OBJECT_COLOR
    ) {
      bindGroup.setValue('zObjectColor', this._objectColor);
    }
  }
  /**
   * Determine which queue should be used to render this material.
   * @returns QUEUE_TRANSPARENT or QUEUE_OPAQUE
   */
  getQueueType(): number {
    return this.isTransparentPass(0) ? QUEUE_TRANSPARENT : QUEUE_OPAQUE;
  }
  /**
   * Determine if a certain pass of this material is translucent.
   * @param pass - Pass of the material
   * @returns True if it is translucent, otherwise false.
   */
  isTransparentPass(pass: number): boolean {
    return this.featureUsed<BlendMode>(FEATURE_ALPHABLEND) !== 'none';
  }
  /** @internal */
  protected createProgram(ctx: DrawContext, pass: number): GPUProgram {
    const pb = new ProgramBuilder(ctx.device);
    if (ctx.renderPass.type === RENDER_PASS_TYPE_SHADOWMAP) {
      const shadowMapParams = ctx.shadowMapInfo.get((ctx.renderPass as ShadowMapPass).light);
      pb.emulateDepthClamp = !!shadowMapParams.depthClampEnabled;
    }
    return this._createProgram(pb, ctx, pass);
  }
  /**
   * Check if a feature is in use for given render pass type.
   *
   * @param feature - The feature index
   * @returns true if the feature is in use, otherwise false.
   */
  featureUsed<T = unknown>(feature: number): T {
    return this._featureStates[feature] as T;
  }
  /**
   * Use or unuse a feature of the material, this will cause the shader to be rebuild.
   *
   * @param feature - Which feature will be used or unused
   * @param use - true if use the feature, otherwise false
   */
  useFeature(feature: number, use: unknown) {
    if (this._featureStates[feature] !== use) {
      this._featureStates[feature] = use;
      this.optionChanged(true);
    }
  }
  /**
   * {@inheritDoc Material._createHash}
   * @override
   *
   * @internal
   */
  protected _createHash(): string {
    return this._featureStates.map((val) => (val === undefined ? '' : val)).join('|');
  }
  /**
   * {@inheritDoc Material._applyUniforms}
   * @override
   *
   * @internal
   */
  protected _applyUniforms(bindGroup: BindGroup, ctx: DrawContext, pass: number): void {
    this.applyUniformValues(bindGroup, ctx, pass);
  }
  /**
   * Check if the color should be computed in fragment shader, this is required for forward render pass or alpha test is in use or alpha to coverage is in use.
   *
   * @returns - true if the color should be computed in fragment shader, otherwise false.
   */
  needFragmentColor(ctx?: DrawContext): boolean {
    return (
      (ctx ?? this.drawContext).renderPass.type === RENDER_PASS_TYPE_LIGHT ||
      this._alphaCutoff > 0 ||
      this.alphaToCoverage
    );
  }
  /**
   * Vertex shader implementation of this material
   * @param scope - Shader scope
   */
  vertexShader(scope: PBFunctionScope): void {
    const pb = scope.$builder;
    ShaderHelper.prepareVertexShader(pb, this.drawContext);
    if (this.drawContext.materialFlags & MaterialVaryingFlags.SKIN_ANIMATION) {
      scope.$inputs.zBlendIndices = pb.vec4().attrib('blendIndices');
      scope.$inputs.zBlendWeights = pb.vec4().attrib('blendWeights');
      ShaderHelper.prepareSkinAnimation(scope);
    }
    if (
      this.drawContext.materialFlags & MaterialVaryingFlags.MORPH_ANIMATION &&
      this.drawContext.device.type === 'webgl'
    ) {
      scope.$inputs.zFakeVertexID = pb.float().attrib('texCoord7');
    }
    if (this.drawContext.materialFlags & MaterialVaryingFlags.INSTANCING) {
      if (this.drawContext.renderPass.type === RENDER_PASS_TYPE_OBJECT_COLOR) {
        scope.$outputs.zObjectColor = this.getInstancedUniform(scope, MeshMaterial.OBJECT_COLOR_UNIFORM);
      }
      if (this.isTransparentPass(this.pass)) {
        scope.$outputs.zOpacity = this.getInstancedUniform(scope, MeshMaterial.OPACITY_UNIFORM);
      }
    }
  }
  /**
   * Fragment shader implementation of this material
   * @param scope - Shader scope
   */
  fragmentShader(scope: PBFunctionScope): void {
    const pb = scope.$builder;
    ShaderHelper.prepareFragmentShader(pb, this.drawContext);
    if (this._alphaCutoff > 0) {
      scope.zAlphaCutoff = pb.float().uniform(2);
    }
    if (this.drawContext.renderPass.type === RENDER_PASS_TYPE_LIGHT) {
      if (
        this.isTransparentPass(this.pass) &&
        !(this.drawContext.materialFlags & MaterialVaryingFlags.INSTANCING)
      ) {
        scope.zOpacity = pb.float().uniform(2);
      }
    } else if (
      this.drawContext.renderPass.type === RENDER_PASS_TYPE_OBJECT_COLOR &&
      !(this.drawContext.materialFlags & MaterialVaryingFlags.INSTANCING)
    ) {
      scope.zObjectColor = pb.vec4().uniform(2);
    }
  }
  /**
   * {@inheritDoc Material._createProgram}
   * @override
   *
   * @internal
   */
  protected _createProgram(pb: ProgramBuilder, ctx: DrawContext, pass: number): GPUProgram {
    const that = this;
    this._ctx = ctx;
    this._materialPass = pass;
    const program = pb.buildRenderProgram({
      vertex(pb) {
        pb.main(function () {
          that.vertexShader(this);
        });
      },
      fragment(pb) {
        if (that.drawContext.oit) {
          that.drawContext.oit.setupFragmentOutput(this);
        } else {
          this.$outputs.zFragmentOutput = pb.vec4();
          if (ctx.materialFlags & MaterialVaryingFlags.SSR_STORE_ROUGHNESS) {
            this.$outputs.zSSRRoughness = pb.vec4();
            this.$outputs.zSSRNormal = pb.vec4();
          }
          if (ctx.renderPass.type === RENDER_PASS_TYPE_DEPTH && ctx.motionVectors) {
            this.$outputs.zMotionVector = pb.vec4();
          }
        }
        pb.main(function () {
          that.fragmentShader(this);
        });
      }
    });
    return program;
  }
  /**
   * Calculate final fragment color for output.
   *
   * @param scope - Shader scope
   * @param color - Lit fragment color
   *
   * @returns The final fragment color
   */
  outputFragmentColor(
    scope: PBInsideFunctionScope,
    worldPos: PBShaderExp,
    color: PBShaderExp,
    ssrRoughness?: PBShaderExp,
    ssrNormal?: PBShaderExp
  ) {
    const pb = scope.$builder;
    const that = this;
    const funcName = 'Z_outputFragmentColor';
    pb.func(funcName, color ? [pb.vec3('worldPos'), pb.vec4('color')] : [pb.vec3('worldPos')], function () {
      this.$l.outColor = color ? this.color : pb.vec4();
      if (that.drawContext.renderPass.type === RENDER_PASS_TYPE_LIGHT) {
        ShaderHelper.discardIfClipped(this, this.worldPos);
        let output = true;
        if (!that.isTransparentPass(that.pass) && !this.zAlphaCutoff && !that.alphaToCoverage) {
          this.outColor.a = 1;
        } else if (that.isTransparentPass(that.pass)) {
          const opacity =
            that.drawContext.materialFlags & MaterialVaryingFlags.INSTANCING
              ? this.$inputs.zOpacity
              : this.zOpacity;
          this.outColor.a = pb.mul(this.outColor.a, opacity);
        }
        if (this.zAlphaCutoff) {
          this.$if(pb.lessThan(this.outColor.a, this.zAlphaCutoff), function () {
            pb.discard();
          });
        }
        if (that.isTransparentPass(that.pass)) {
          if (!that.drawContext.oit || that.drawContext.oit.wantsPremultipliedAlpha()) {
            this.outColor = pb.vec4(
              pb.mul(this.outColor.rgb, this.outColor.a),
              that.featureUsed<BlendMode>(FEATURE_ALPHABLEND) === 'additive' ? 0 : this.outColor.a
            );
          }
          output = !that.drawContext.oit || !that.drawContext.oit.outputFragmentColor(this, this.outColor);
          /*
          if (!that.drawContext.oit || !that.drawContext.oit.outputFragmentColor(this, this.outColor)) {
            this.outColor = pb.vec4(
              pb.mul(this.outColor.rgb, this.outColor.a),
              that.featureUsed<BlendMode>(FEATURE_ALPHABLEND) === 'additive' ? 0 : this.outColor.a
            );
          }
          */
        }
        if (output) {
          ShaderHelper.applyFog(this, this.worldPos, this.outColor, that.drawContext);
          this.$outputs.zFragmentOutput = ShaderHelper.encodeColorOutput(this, this.outColor);
        }
      } else if (that.drawContext.renderPass.type === RENDER_PASS_TYPE_DEPTH) {
        if (color) {
          this.$if(pb.lessThan(this.outColor.a, this.zAlphaCutoff), function () {
            pb.discard();
          });
        }
        ShaderHelper.discardIfClipped(this, this.worldPos);
        const depthPass = that.drawContext.renderPass as DepthPass;
        this.$l.depth = ShaderHelper.nonLinearDepthToLinearNormalized(this, this.$builtins.fragCoord.z);
        if (depthPass.encodeDepth) {
          this.$outputs.zFragmentOutput = encodeNormalizedFloatToRGBA(this, this.depth);
        } else if (depthPass.renderBackface) {
          this.$outputs.zFragmentOutput = pb.vec4(0, this.depth, 0, 1);
        } else {
          this.$outputs.zFragmentOutput = pb.vec4(this.depth, 0, 0, 1);
        }
        if (that.drawContext.motionVectors) {
          if (this.$inputs.zMotionVectorPosCurrent && this.$inputs.zMotionVectorPosPrev) {
            this.$outputs.zMotionVector = pb.vec4(
              pb.mul(
                pb.sub(
                  pb.div(this.$inputs.zMotionVectorPosCurrent.xy, this.$inputs.zMotionVectorPosCurrent.w),
                  pb.div(this.$inputs.zMotionVectorPosPrev.xy, this.$inputs.zMotionVectorPosPrev.w)
                ),
                0.5
              ),
              0,
              1
            );
          } else {
            this.$outputs.zMotionVector = pb.vec4(0, 0, 0, 1);
          }
          if (that.drawContext.device.type === 'webgl') {
            this.$outputs.zMotionVector = packFloat16x2(
              this,
              pb.add(pb.mul(this.$outputs.zMotionVector.xy, 0.5), pb.vec2(0.5))
            );
          }
        }
      } else if (that.drawContext.renderPass.type === RENDER_PASS_TYPE_OBJECT_COLOR) {
        if (color) {
          this.$if(pb.lessThan(this.outColor.a, this.zAlphaCutoff), function () {
            pb.discard();
          });
        }
        ShaderHelper.discardIfClipped(this, this.worldPos);
        this.$outputs.zFragmentOutput =
          that.drawContext.materialFlags & MaterialVaryingFlags.INSTANCING
            ? scope.$inputs.zObjectColor
            : scope.zObjectColor;
      } /*if (that.drawContext.renderPass.type === RENDER_PASS_TYPE_SHADOWMAP)*/ else {
        if (color) {
          this.$if(pb.lessThan(this.outColor.a, this.zAlphaCutoff), function () {
            pb.discard();
          });
        }
        ShaderHelper.discardIfClipped(this, this.worldPos);
        const shadowMapParams = that.drawContext.shadowMapInfo.get(
          (that.drawContext.renderPass as ShadowMapPass).light
        );
        this.$outputs.zFragmentOutput = shadowMapParams.impl.computeShadowMapDepth(
          shadowMapParams,
          this,
          this.worldPos
        );
      }
    });
    if (color) {
      pb.getGlobalScope()[funcName](worldPos, color);
    } else {
      pb.getGlobalScope()[funcName](worldPos);
    }
    if (that.drawContext.materialFlags & MaterialVaryingFlags.SSR_STORE_ROUGHNESS) {
      scope.$outputs.zSSRRoughness = ssrRoughness ?? pb.vec4(1, 0, 0, 1);
      scope.$outputs.zSSRNormal = ssrNormal ?? pb.vec4(0);
    }
  }
}
FEATURE_ALPHATEST = MeshMaterial.defineFeature();
FEATURE_ALPHABLEND = MeshMaterial.defineFeature();
FEATURE_ALPHATOCOVERAGE = MeshMaterial.defineFeature();
