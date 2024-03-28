import type {
  BindGroup,
  FaceMode,
  GPUProgram,
  PBFunctionScope,
  PBInsideFunctionScope,
  PBShaderExp
} from '@zephyr3d/device';
import { ProgramBuilder } from '@zephyr3d/device';
import {
  QUEUE_OPAQUE,
  QUEUE_TRANSPARENT,
  RENDER_PASS_TYPE_DEPTH,
  RENDER_PASS_TYPE_LIGHT,
  RENDER_PASS_TYPE_SHADOWMAP
} from '../values';
import { Material } from './material';
import type { DrawContext, ShadowMapPass } from '../render';
import { encodeNormalizedFloatToRGBA } from '../shaders';
import { Application } from '../app';
import { ShaderHelper } from './shader/helper';
import { Vector2, Vector3, Vector4, applyMixins } from '@zephyr3d/base';

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
): ExtractMixinType<M> {
  return applyMixins(target, ...mixins);
}

let FEATURE_ALPHATEST = 0;
let FEATURE_ALPHABLEND = 0;
let FEATURE_ALPHATOCOVERAGE = 0;

/** @internal */
export type InstanceUniformType = 'float' | 'vec2' | 'vec3' | 'vec4';

/**
 * Base class for any kind of mesh materials
 *
 * @public
 */
export class MeshMaterial extends Material {
  /** @internal */
  static INSTANCE_UNIFORMS: [string, InstanceUniformType][] = [];
  /** @internal */
  static NEXT_FEATURE_INDEX = 3;
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
  private _ctx: DrawContext;
  /** @internal */
  private _materialPass: number;
  /**
   * Creates an instance of MeshMaterial class
   * @param args - constructor arguments
   */
  constructor(...args: any[]) {
    super();
    this._featureStates = [];
    this._alphaCutoff = 0;
    this._blendMode = 'none';
    this._cullMode = 'back';
    this._opacity = 1;
    this._ctx = null;
    this._materialPass = -1;
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
  /** Define instance uniform index */
  static defineInstanceUniform(prop: string, type: InstanceUniformType): number {
    if (this.INSTANCE_UNIFORMS.findIndex((val) => val[0] === prop) >= 0) {
      throw new Error(`${this.name}.defineInstanceUniform(): ${prop} was already defined`);
    }
    if (type !== 'float' && type !== 'vec2' && type !== 'vec3' && type !== 'vec4') {
      throw new Error(`${this.name}.defineInstanceUniform(): invalid uniform type ${type}`);
    }
    this.INSTANCE_UNIFORMS = [...this.INSTANCE_UNIFORMS, [prop, type]];
    return this.INSTANCE_UNIFORMS.length - 1;
  }
  getInstancedUniform(scope: PBInsideFunctionScope, uniformIndex: number): PBShaderExp {
    //return ShaderHelper.getInstancedUniform(scope, 4 + uniformIndex);
    const pb = scope.$builder;
    const instanceID = pb.shaderKind === 'vertex' ? scope.$builtins.instanceIndex : scope.$inputs.zInstanceID;
    const uniformName = ShaderHelper.getInstanceDataUniformName();
    const strideName = ShaderHelper.getInstanceDataStrideUniformName();
    const offsetName = ShaderHelper.getInstanceDataOffsetUniformName();
    return scope[uniformName].at(pb.add(pb.mul(scope[strideName], instanceID), 4 + uniformIndex, scope[offsetName]));
  }
  /** Create material instance */
  createInstance(): this {
    const instanceUniforms = (this.constructor as typeof MeshMaterial).INSTANCE_UNIFORMS;
    const uniformsHolder = instanceUniforms.length > 0 ? new Float32Array(4 * instanceUniforms.length) : null;
    const isWebGL1 = Application.instance.device.type === 'webgl';

    const instance = {} as any;
    const that = this;
    instance.isBatchable = () => !isWebGL1 && that.supportInstancing();
    instance.$instanceUniforms = uniformsHolder;
    instance.$isInstance = true;
    instance.beginDraw = function(pass: number, ctx: DrawContext){
      if (isWebGL1 || !that.supportInstancing()) {
        for (let i = 0; i < instanceUniforms.length; i++) {
          const name = instanceUniforms[i][0];
          const type = instanceUniforms[i][1];
          switch (type) {
            case 'float':
              that[name] = uniformsHolder[i * 4];
              break;
            case 'vec2':
              that[name] = new Vector2(uniformsHolder[i * 4], uniformsHolder[i * 4 + 1]);
              break;
            case 'vec3':
              that[name] = new Vector3(
                uniformsHolder[i * 4],
                uniformsHolder[i * 4 + 1],
                uniformsHolder[i * 4 + 2]
              );
            case 'vec4':
              that[name] = new Vector4(
                uniformsHolder[i * 4],
                uniformsHolder[i * 4 + 1],
                uniformsHolder[i * 4 + 2],
                uniformsHolder[i * 4 + 3]
              );
          }
        }
      }
      return that.beginDraw(pass, ctx);
    }
    // Copy original uniform values
    for (let i = 0; i < instanceUniforms.length; i++) {
      const [prop, type] = instanceUniforms[i];
      const value = that[prop];
      switch (type) {
        case 'float': {
          uniformsHolder[i * 4] = Number(value);
          Object.defineProperty(instance, prop, {
            get() {
              return uniformsHolder[i * 4];
            },
            set(value) {
              uniformsHolder[i * 4 + 0] = value;
            }
          });
          break;
        }
        case 'vec2': {
          if (!(value instanceof Vector2)) {
            throw new Error(`Instance uniform property ${prop} must be of type Vector2`);
          }
          uniformsHolder[i * 4] = value.x;
          uniformsHolder[i * 4 + 1] = value.y;
          Object.defineProperty(instance, prop, {
            get() {
              return new Vector2(uniformsHolder[i * 4], uniformsHolder[i * 4 + 1]);
            },
            set(value) {
              uniformsHolder.set(value);
            }
          });
          break;
        }
        case 'vec3': {
          if (!(value instanceof Vector3)) {
            throw new Error(`Instance uniform property ${prop} must be of type Vector3`);
          }
          uniformsHolder[i * 4] = value.x;
          uniformsHolder[i * 4 + 1] = value.y;
          uniformsHolder[i * 4 + 2] = value.z;
          Object.defineProperty(instance, prop, {
            get() {
              return new Vector3(
                uniformsHolder[i * 4],
                uniformsHolder[i * 4 + 1],
                uniformsHolder[i * 4 + 2]
              );
            },
            set(value) {
              uniformsHolder.set(value);
            }
          });
          break;
        }
        case 'vec4': {
          if (!(value instanceof Vector4)) {
            throw new Error(`Instance uniform property ${prop} must be of type Vector4`);
          }
          uniformsHolder[i * 4] = value.x;
          uniformsHolder[i * 4 + 1] = value.y;
          uniformsHolder[i * 4 + 2] = value.z;
          uniformsHolder[i * 4 + 3] = value.w;
          Object.defineProperty(instance, prop, {
            get() {
              return new Vector4(
                uniformsHolder[i * 4],
                uniformsHolder[i * 4 + 1],
                uniformsHolder[i * 4 + 2],
                uniformsHolder[i * 4 + 3]
              );
            },
            set(value) {
              uniformsHolder.set(value);
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
  /** Current material pass */
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
      this.useFeature(FEATURE_ALPHABLEND, this._blendMode !== 'none' || this._opacity < 1);
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
      this.useFeature(FEATURE_ALPHABLEND, this._blendMode !== 'none' || this._opacity < 1);
      this.uniformChanged();
    }
  }
  /** Returns true if shading of the material will be affected by lights  */
  supportLighting(): boolean {
    return true;
  }
  /**
   * Update render states according to draw context and current material pass
   * @param pass - Current material pass
   * @param ctx - Draw context
   */
  protected updateRenderStates(pass: number, ctx: DrawContext): void {
    const stateSet = this.getRenderStateSet(pass);
    const blending = this.featureUsed<boolean>(FEATURE_ALPHABLEND) || ctx.lightBlending;
    const a2c = this.featureUsed<boolean>(FEATURE_ALPHATOCOVERAGE);
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
      if (blendingState.enabled) {
        stateSet.useDepthState().enableTest(true).enableWrite(false);
      } else {
        stateSet.defaultDepthState();
      }
    } else if (stateSet.blendingState?.enabled && !blending) {
      stateSet.defaultBlendingState();
      stateSet.defaultDepthState();
    }
    if (this._cullMode !== 'back') {
      stateSet.useRasterizerState().cullMode = this._cullMode;
    } else {
      stateSet.defaultRasterizerState();
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
    if (this.featureUsed(FEATURE_ALPHABLEND)) {
      bindGroup.setValue('zOpacity', this._opacity);
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
    return this.featureUsed(FEATURE_ALPHABLEND);
  }
  /**
   * {@inheritdoc Material.beginDraw}
   */
  beginDraw(pass: number, ctx: DrawContext): boolean {
    this.updateRenderStates(pass, ctx);
    return super.beginDraw(pass, ctx);
  }
  /** @internal */
  protected createProgram(ctx: DrawContext, pass: number): GPUProgram {
    const pb = new ProgramBuilder(Application.instance.device);
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
  protected _createHash(renderPassType: number): string {
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
    if (this.drawContext.target.getBoneMatrices()) {
      scope.$inputs.zBlendIndices = pb.vec4().attrib('blendIndices');
      scope.$inputs.zBlendWeights = pb.vec4().attrib('blendWeights');
    }
    if (this.drawContext.instanceData) {
      scope.$outputs.zInstanceID = scope.$builtins.instanceIndex;
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
      if (this.isTransparentPass(this.pass)) {
        scope.zOpacity = pb.float().uniform(2);
      }
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
        this.$outputs.zFragmentOutput = pb.vec4();
        pb.main(function () {
          that.fragmentShader(this);
        });
      }
    });
    /*
    if (program) {
      console.log(program.getShaderSource('vertex'));
      console.log(program.getShaderSource('fragment'));
    }
    */
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
  outputFragmentColor(scope: PBInsideFunctionScope, worldPos: PBShaderExp, color: PBShaderExp) {
    const pb = scope.$builder;
    const that = this;
    const funcName = 'Z_outputFragmentColor';
    pb.func(funcName, color ? [pb.vec3('worldPos'), pb.vec4('color')] : [pb.vec3('worldPos')], function () {
      this.$l.outColor = color ? this.color : pb.vec4();
      if (that.drawContext.renderPass.type === RENDER_PASS_TYPE_LIGHT) {
        ShaderHelper.discardIfClipped(this, this.worldPos);
        if (!that.isTransparentPass(that.pass) && !this.zAlphaCutoff && !that.alphaToCoverage) {
          this.outColor.a = 1;
        } else if (this.zOpacity) {
          this.outColor.a = pb.mul(this.outColor.a, this.zOpacity);
        }
        if (this.zAlphaCutoff) {
          this.$if(pb.lessThan(this.outColor.a, this.zAlphaCutoff), function () {
            pb.discard();
          });
        }
        if (that.isTransparentPass(that.pass)) {
          this.outColor = pb.vec4(pb.mul(this.outColor.rgb, this.outColor.a), this.outColor.a);
        }
        ShaderHelper.applyFog(this, this.worldPos, this.outColor, that.drawContext);
        this.$outputs.zFragmentOutput = ShaderHelper.encodeColorOutput(this, this.outColor);
      } else if (that.drawContext.renderPass.type === RENDER_PASS_TYPE_DEPTH) {
        if (color) {
          this.$if(pb.lessThan(this.outColor.a, this.zAlphaCutoff), function () {
            pb.discard();
          });
        }
        ShaderHelper.discardIfClipped(this, this.worldPos);
        this.$l.depth = ShaderHelper.nonLinearDepthToLinearNormalized(this, this.$builtins.fragCoord.z);
        if (Application.instance.device.type === 'webgl') {
          this.$outputs.zFragmentOutput = encodeNormalizedFloatToRGBA(this, this.depth);
        } else {
          this.$outputs.zFragmentOutput = pb.vec4(this.depth, 0, 0, 1);
        }
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
    color ? pb.getGlobalScope()[funcName](worldPos, color) : pb.getGlobalScope()[funcName](worldPos);
  }
}
FEATURE_ALPHATEST = MeshMaterial.defineFeature();
FEATURE_ALPHABLEND = MeshMaterial.defineFeature();
FEATURE_ALPHATOCOVERAGE = MeshMaterial.defineFeature();
