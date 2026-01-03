import type {
  BindGroup,
  FaceMode,
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
import { encodeNormalizedFloatToRGBA } from '../shaders/misc';
import { ShaderHelper } from './shader/helper';
import type { Clonable, Immutable, Nullable } from '@zephyr3d/base';
import { Vector2, Vector3, Vector4, applyMixins, DRef } from '@zephyr3d/base';
import { RenderBundleWrapper } from '../render/renderbundle_wrapper';
import { getDevice } from '../app/api';

/**
 * Blending mode for mesh materials.
 *
 * - `none`: No blending (opaque).
 * - `blend`: Standard alpha blending (srcAlpha, 1 - srcAlpha).
 * - `additive`: Additive blending (1, 1), commonly for glow/FX.
 *
 * May be combined with alpha-to-coverage and alpha test.
 * @public
 */
export type BlendMode = 'none' | 'blend' | 'additive';

/**
 * Extracts the return type of a mixin function.
 * @public
 */
export type ExtractMixinReturnType<M> = M extends (target: infer A) => infer R ? R : never;

/**
 * Produces the intersection type of multiple mixins’ return types.
 * @public
 */
export type ExtractMixinType<M> = M extends [infer First]
  ? ExtractMixinReturnType<First>
  : M extends [infer First, ...infer Rest]
    ? ExtractMixinReturnType<First> & ExtractMixinType<[...Rest]>
    : never;

/**
 * Apply material mixins to a target material class.
 *
 * Useful for composing optional capabilities (e.g., base color, normal map, PBR terms).
 *
 * @param target - The material class (constructor or prototype).
 * @param mixins - One or more mixin functions.
 * @returns The target class augmented with the mixins (intersection type).
 *
 * @example
 * class MyMaterial extends MeshMaterial \{\}
 * const Mixed = applyMaterialMixins(MyMaterial, WithBaseColor, WithNormalMap);
 * const m = new Mixed();
 * @public
 */
export function applyMaterialMixins<M extends ((target: any) => any)[], T>(target: T, ...mixins: M) {
  return applyMixins(target, ...mixins);
}

let FEATURE_ALPHATEST = 0;
let FEATURE_ALPHABLEND = 0;
let FEATURE_CULLMODE = 0;
let FEATURE_ALPHATOCOVERAGE = 0;
let FEATURE_DISABLE_TAA = 0;

/** @internal */
export type InstanceUniformType = 'float' | 'vec2' | 'vec3' | 'vec4' | 'rgb' | 'rgba';

/**
 * Base class for mesh materials.
 *
 * Key responsibilities:
 * - Defines feature-based shader variants (alpha test, blending, alpha-to-coverage, TAA toggle, etc.).
 * - Provides a material instancing mechanism (per-instance uniforms via a shared core material).
 * - Implements the base shader scaffolding for multiple render passes (LIGHT, DEPTH, OBJECT_COLOR, SHADOWMAP).
 * - Updates render states depending on pass and features (blending, depth, culling).
 * - Submits material uniforms and cooperates with OIT/TAA/SSR/motion vectors.
 *
 * Variant system:
 * - Features are stored in `_featureStates` and hashed into `_createHash()`.
 * - Changing features calls `useFeature(...)` which triggers `optionChanged(true)` to rebuild programs.
 *
 * Instancing:
 * - `defineInstanceUniform` registers per-instance fields with packed layout.
 * - `createInstance()` returns a lightweight instance that shares the core’s GPU programs and updates
 *   instance uniform buffer only. This improves batching/instancing support.
 *
 * Shader hooks:
 * - `vertexShader(scope)` and `fragmentShader(scope)` provide per-pass hook points to implement the
 *   material’s vertex/fragment logic. The base class wires up common I/O (skin, morph, instancing).
 * - `outputFragmentColor(...)` centralizes final color output across passes, handling OIT and alpha ops.
 *
 * Render states and queues:
 * - `updateRenderStates(...)` sets depth/blend/cull states based on blending, alpha-to-coverage,
 *   depth equality optimizations, pass type, and optional OIT overrides.
 * - `getQueueType()` chooses between opaque and transparent queues.
 *
 * Extending:
 * - Override `vertexShader`, `fragmentShader`, and optionally `outputFragmentColor`.
 * - Override `supportLighting`, `isTransparentPass`, `needFragmentColor`, etc., as needed.
 * - Use `uniformChanged()` when changing uniform-only values that do not alter shader variants.
 * - Use `useFeature()` when toggling options that affect shader variants.
 *
 * @public
 */
export class MeshMaterial extends Material implements Clonable<MeshMaterial> {
  /**
   * Registered instance uniforms for this material class.
   *
   * Each entry defines property name, type, and packed offset (float-aligned).
   * @internal
   */
  static INSTANCE_UNIFORMS: { prop: string; type: InstanceUniformType; offset: number; name: string }[] = [];
  /**
   * Next free feature index for subclasses to define their own feature toggles.
   * @internal
   */
  static NEXT_FEATURE_INDEX = 3;
  /**
   * Built-in per-instance uniform: object color (rgba), used for GPU picking/object-ID pass.
   * @internal
   */
  static OBJECT_COLOR_UNIFORM = this.defineInstanceUniform('objectColor', 'rgba');
  /**
   * Built-in per-instance uniform: opacity (float), used in transparent passes.
   * @internal
   */
  static OPACITY_UNIFORM = this.defineInstanceUniform('opacity', 'float', 'Opacity');
  /** @internal Feature state array (indexed by feature indices). */
  private _featureStates: unknown[];
  /** @internal Alpha test cutoff in [0, 1]. */
  private _alphaCutoff: number;
  /** @internal Blending mode. */
  private _blendMode: BlendMode;
  /** @internal Face culling mode. */
  private _cullMode: FaceMode;
  /** @internal Opacity in [0, 1]. */
  private _opacity: number;
  /**
   * @internal TAA strength in [0, 1], where higher value typically means stronger accumulation
   * (here used inversely when mapping to motion vector output).
   */
  private _taaStrength: number;
  /** @internal Per-object color for object picking pass. */
  private readonly _objectColor: Vector4;
  /** @internal Last draw context used for shader creation. */
  private _ctx: Nullable<DrawContext>;
  /** @internal Current material pass index during program building. */
  private _materialPass: number;
  /**
   * Create a MeshMaterial with default opaque settings.
   *
   * Defaults:
   * - `blendMode = 'none'`
   * - `cullMode = 'back'`
   * - `opacity = 1`
   * - `alphaCutoff = 0`
   * - `taaStrength = 1 - 1/16`
   */
  constructor() {
    super();
    this._featureStates = [];
    this._alphaCutoff = 0;
    this._blendMode = 'none';
    this._cullMode = 'back';
    this._opacity = 1;
    this._taaStrength = 1 - 1 / 16;
    this._objectColor = Vector4.one();
    this._ctx = null;
    this._materialPass = -1;
    this.useFeature(FEATURE_ALPHABLEND, this._blendMode);
    this.useFeature(FEATURE_CULLMODE, this._cullMode);
  }
  /**
   * Create a shallow clone of this material.
   * Subclasses should override to copy custom fields.
   */
  clone() {
    const other = new MeshMaterial();
    other.copyFrom(this);
    return other;
  }
  /**
   * Copy common MeshMaterial properties from another material.
   * Call `super.copyFrom(other)` first when overriding in subclasses.
   *
   * @param other - Source material.
   */
  copyFrom(other: this) {
    super.copyFrom(other);
    this.alphaCutoff = other.alphaCutoff;
    this.blendMode = other.blendMode;
    this.cullMode = other.cullMode;
    this.opacity = other.opacity;
    this.objectColor = other.objectColor;
  }
  /**
   * Mark uniform-only changes so uniforms are re-uploaded on next apply, without
   * rebuilding shader programs.
   */
  uniformChanged() {
    this.optionChanged(false);
  }
  /**
   * Define a new feature bit/index for shader variants.
   * Subclasses may use this to add their own switches.
   */
  static defineFeature() {
    const val = this.NEXT_FEATURE_INDEX;
    this.NEXT_FEATURE_INDEX++;
    return val;
  }
  /** @internal Helper: get number of scalar components for a given instance uniform type. */
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
  /**
   * Define a per-instance uniform for this class.
   *
   * Returns a compact index encoding the vector index and component offset, which can be
   * used in shader code via `getInstancedUniform(...)`.
   *
   * @param prop - Property name exposed on instances.
   * @param type - Uniform data type.
   * @returns Encoded index for use in `getInstancedUniform`.
   *
   * @throws If the property is already defined or type is invalid.
   */
  static defineInstanceUniform(prop: string, type: InstanceUniformType, name = '') {
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
    this.INSTANCE_UNIFORMS.splice(index, 0, { prop, offset, type, name });
    return (offset << 2) | (numComponents - 1);
  }
  /**
   * Read an encoded per-instance uniform in shader code.
   *
   * Encoded index packs: vector index, component offset, and component count.
   *
   * @param scope - Inside-function shader scope.
   * @param uniformIndex - Encoded index from `defineInstanceUniform`.
   * @returns The shader expression reading the selected components.
   */
  getInstancedUniform(scope: PBInsideFunctionScope, uniformIndex: number) {
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
    return u[m] as PBShaderExp;
  }
  /**
   * Get the list of per-instance uniforms for this material class.
   */
  getInstancedUniforms() {
    return (this.constructor as typeof MeshMaterial).INSTANCE_UNIFORMS;
  }
  /**
   * Create a material instance (preferred for GPU instancing).
   *
   * - On WebGL1 (or when instancing unsupported), falls back to cloning.
   * - Otherwise, returns a proxy instance that shares GPU programs and
   *   stores per-instance uniforms in a compact Float32Array.
   *
   * The returned instance:
   * - Exposes properties defined by `defineInstanceUniform` with getter/setter
   *   that read/write the packed buffer and notify `RenderBundleWrapper`.
   * - Delegates methods to the core material via prototype chain.
   */
  createInstance(): this {
    if (this.$isInstance) {
      return this.coreMaterial.createInstance() as this;
    }
    const isWebGL1 = getDevice().type === 'webgl';
    if (isWebGL1 || !this.supportInstancing()) {
      return this.clone() as this;
    }
    const instanceUniforms = this.getInstancedUniforms();
    const uniformsHolder =
      instanceUniforms.length > 0
        ? new Float32Array((instanceUniforms[instanceUniforms.length - 1].offset + 4) & ~3)
        : null;
    const instance = {} as any;
    const that = this;
    const coreMaterial = new DRef(that);
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
    Object.defineProperty(instance, 'coreMaterial', {
      get: function () {
        return coreMaterial.get();
      }
    });

    // Copy original uniform values
    for (let i = 0; i < instanceUniforms.length; i++) {
      const { prop, offset, type } = instanceUniforms[i];
      const value = that[prop];
      switch (type) {
        case 'float': {
          uniformsHolder![offset] = Number(value);
          Object.defineProperty(instance, prop, {
            get() {
              return uniformsHolder![offset];
            },
            set(value) {
              uniformsHolder![offset] = value;
              RenderBundleWrapper.materialUniformsChanged(instance);
            }
          });
          break;
        }
        case 'vec2': {
          if (!(value instanceof Vector2)) {
            throw new Error(`Instance uniform property ${prop} must be of type Vector2`);
          }
          uniformsHolder![offset] = value.x;
          uniformsHolder![offset + 1] = value.y;
          Object.defineProperty(instance, prop, {
            get() {
              return new Vector2(uniformsHolder![offset], uniformsHolder![offset + 1]);
            },
            set(value) {
              if (!(value instanceof Vector2)) {
                throw new Error(`Instance uniform property ${prop} must be of type Vector2`);
              }
              uniformsHolder![offset] = value.x;
              uniformsHolder![offset + 1] = value.y;
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
          uniformsHolder![offset] = value.x;
          uniformsHolder![offset + 1] = value.y;
          uniformsHolder![offset + 2] = value.z;
          Object.defineProperty(instance, prop, {
            get() {
              return new Vector3(
                uniformsHolder![offset],
                uniformsHolder![offset + 1],
                uniformsHolder![offset + 2]
              );
            },
            set(value) {
              if (!(value instanceof Vector3)) {
                throw new Error(`Instance uniform property ${prop} must be of type Vector3`);
              }
              uniformsHolder![offset] = value.x;
              uniformsHolder![offset + 1] = value.y;
              uniformsHolder![offset + 2] = value.z;
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
          uniformsHolder![offset] = value.x;
          uniformsHolder![offset + 1] = value.y;
          uniformsHolder![offset + 2] = value.z;
          uniformsHolder![offset + 3] = value.w;
          Object.defineProperty(instance, prop, {
            get() {
              return new Vector4(
                uniformsHolder![offset],
                uniformsHolder![offset + 1],
                uniformsHolder![offset + 2],
                uniformsHolder![offset + 3]
              );
            },
            set(value) {
              if (!(value instanceof Vector4)) {
                throw new Error(`Instance uniform property ${prop} must be of type Vector4`);
              }
              uniformsHolder![offset] = value.x;
              uniformsHolder![offset + 1] = value.y;
              uniformsHolder![offset + 2] = value.z;
              uniformsHolder![offset + 3] = value.w;
              RenderBundleWrapper.materialUniformsChanged(instance);
            }
          });
          break;
        }
      }
    }
    Object.setPrototypeOf(instance, that);
    return instance as this;
  }
  /**
   * Draw context captured during program creation, available inside shader hooks.
   *
   * @returns The last `DrawContext` used to build or apply this material.
   */
  get drawContext() {
    return this._ctx!;
  }
  /**
   * Current material pass index during program building.
   * Typically used inside shader hooks to select per-pass logic.
   *
   * @returns The active pass index while building the program, or -1 when idle.
   * @internal
   */
  get pass() {
    return this._materialPass;
  }
  /**
   * Alpha test cutoff in [0, 1].
   * - 0 disables alpha testing.
   * - \> 0 discards fragments with alpha \< cutoff.
   * Changing this marks uniforms dirty (no shader rebuild).
   */
  get alphaCutoff() {
    return this._alphaCutoff;
  }
  set alphaCutoff(val) {
    if (this._alphaCutoff !== val) {
      this.useFeature(FEATURE_ALPHATEST, val > 0);
      this._alphaCutoff = val;
      this.uniformChanged();
    }
  }
  /**
   * Whether TAA is disabled for this material.
   * - When true, motion vectors encode a large sentinel to skip TAA accumulation.
   * - Managed via an internal feature toggle.
   */
  get TAADisabled() {
    return !!this.featureUsed(FEATURE_DISABLE_TAA);
  }
  set TAADisabled(val) {
    this.useFeature(FEATURE_DISABLE_TAA, !!val);
  }
  /**
   * TAA strength in [0, 1].
   * - Higher values generally imply stronger accumulation.
   * - The value is mapped when writing motion-vector outputs during depth pass.
   */
  get TAAStrength() {
    return this._taaStrength;
  }
  set TAAStrength(val) {
    val = val > 1 ? 1 : val < 0 ? 0 : val;
    if (this._taaStrength !== val) {
      this._taaStrength = val;
      this.uniformChanged();
    }
  }
  /**
   * Alpha-to-coverage toggle.
   * - Useful to approximate transparency for MSAA targets.
   * - Managed as a shader feature; toggling rebuilds variants.
   */
  get alphaToCoverage() {
    return !!this.featureUsed(FEATURE_ALPHATOCOVERAGE);
  }
  set alphaToCoverage(val) {
    this.useFeature(FEATURE_ALPHATOCOVERAGE, !!val);
  }
  /**
   * Blending mode of this material.
   * - 'none' for opaque, 'blend' for standard alpha, 'additive' for emissive FX.
   * - Changing the mode toggles an internal feature and rebuilds variants.
   */
  get blendMode() {
    return this._blendMode;
  }
  set blendMode(val) {
    if (this._blendMode !== val) {
      this._blendMode = val;
      this.useFeature(FEATURE_ALPHABLEND, this._blendMode);
    }
  }
  /**
   * Face culling mode: 'none' | 'front' | 'back'.
   * - Does not force shader rebuild; affects rasterizer state.
   */
  get cullMode() {
    return this._cullMode;
  }
  set cullMode(val) {
    if (this._cullMode !== val) {
      this._cullMode = val;
      this.useFeature(FEATURE_CULLMODE, this._cullMode);
    }
  }
  /**
   * Material opacity in [0, 1].
   * - Used in transparent passes. Changing marks uniforms dirty only.
   */
  get opacity() {
    return this._opacity;
  }
  set opacity(val) {
    val = val < 0 ? 0 : val > 1 ? 1 : val;
    if (this._opacity !== val) {
      this._opacity = val;
      this.uniformChanged();
    }
  }
  /**
   * Per-object color used for GPU picking/object-ID pass.
   * - Changing marks uniforms dirty only.
   */
  get objectColor(): Immutable<Vector4> {
    return this._objectColor;
  }
  set objectColor(val: Immutable<Vector4>) {
    if (val !== this._objectColor) {
      this._objectColor.set(val ?? Vector4.one());
      this.uniformChanged();
    }
  }
  /**
   * Whether this material responds to scene lighting.
   * Override to return false for unlit materials.
   *
   * @returns True if lighting affects this material; otherwise false.
   */
  supportLighting(): boolean {
    return false;
  }
  /**
   * Update render states per pass and draw context.
   * Sets blending, alpha-to-coverage, depth test/write, cull mode, color mask, and cooperates with OIT.
   *
   * @param pass - Current material pass index.
   * @param stateSet - Render state set to update.
   * @param ctx - Current draw context.
   * @returns void
   */
  protected updateRenderStates(pass: number, stateSet: RenderStateSet, ctx: DrawContext) {
    const isObjectColorPass = ctx.renderPass!.type === RENDER_PASS_TYPE_OBJECT_COLOR;
    const blending =
      !isObjectColorPass && (this.featureUsed<BlendMode>(FEATURE_ALPHABLEND) !== 'none' || ctx.lightBlending);
    const a2c = !isObjectColorPass && this.featureUsed<boolean>(FEATURE_ALPHATOCOVERAGE);
    const ztestEq = ctx.queue === QUEUE_OPAQUE && !!ctx.depthTexture && !ctx.sceneColorTexture;
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
    } else {
      stateSet.defaultBlendingState();
      if (ztestEq) {
        stateSet.useDepthState().setCompareFunc('eq').enableTest(true).enableWrite(false);
      } else {
        stateSet.defaultDepthState();
      }
    }
    if (ctx.forceCullMode || this._cullMode !== 'back') {
      stateSet.useRasterizerState().cullMode = ctx.forceCullMode || this._cullMode;
    } else if (ctx.renderPass!.type === RENDER_PASS_TYPE_SHADOWMAP) {
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
   * Submit material uniforms/resources to the material bind group (set 2).
   * Handles alpha cutoff, opacity (non-instanced transparent), OIT, object color, and TAA strength.
   *
   * @param bindGroup - The material bind group to write into.
   * @param ctx - Current draw context.
   * @param pass - Current material pass index.
   * @returns void
   */
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number) {
    if (this.featureUsed(FEATURE_ALPHATEST)) {
      bindGroup.setValue('zAlphaCutoff', this._alphaCutoff);
    }
    if (
      this.isTransparentPass(pass) &&
      ctx.renderPass!.type === RENDER_PASS_TYPE_LIGHT &&
      !(ctx.materialFlags & MaterialVaryingFlags.INSTANCING)
    ) {
      bindGroup.setValue('zOpacity', this._opacity);
    }
    if (ctx.oit) {
      ctx.oit.applyUniforms(ctx, bindGroup);
    }
    if (ctx.renderPass!.type === RENDER_PASS_TYPE_DEPTH && ctx.motionVectors) {
      bindGroup.setValue('zTAAStrength', (1 - this._taaStrength) * 50000);
    }
  }
  /**
   * Determine the render queue for this material.
   * Transparent materials are queued as `QUEUE_TRANSPARENT`, otherwise `QUEUE_OPAQUE`.
   *
   * @returns The queue type constant.
   */
  getQueueType(): number {
    return this.isTransparentPass(0) ? QUEUE_TRANSPARENT : QUEUE_OPAQUE;
  }
  /**
   * Whether the given pass is transparent.
   * Default returns true when `blendMode !== 'none'`.
   *
   * @param pass - Material pass index.
   * @returns True if the pass is transparent; otherwise false.
   */
  isTransparentPass(_pass: number) {
    return this.featureUsed<BlendMode>(FEATURE_ALPHABLEND) !== 'none';
  }
  /**
   * Create the GPU program for a given pass and draw context.
   * Enables depth-clamp emulation for shadow map passes when required by the light, then delegates to `_createProgram`.
   *
   * @param ctx - Current draw context.
   * @param pass - Material pass index.
   * @returns The created `GPUProgram`.
   * @internal
   */
  protected createProgram(ctx: DrawContext, pass: number) {
    const pb = new ProgramBuilder(ctx.device);
    if (ctx.renderPass!.type === RENDER_PASS_TYPE_SHADOWMAP) {
      const shadowMapParams = ctx.shadowMapInfo!.get((ctx.renderPass as ShadowMapPass).light!)!;
      pb.emulateDepthClamp = !!shadowMapParams.depthClampEnabled;
    }
    return this._createProgram(pb, ctx, pass);
  }
  /**
   * Query a feature flag’s current value.
   *
   * @typeParam T - Expected value type.
   * @param feature - The feature index.
   * @returns The current value for the feature, typed as `T`.
   */
  featureUsed<T = unknown>(feature: number): T {
    return this._featureStates[feature] as T;
  }
  /**
   * Enable or disable a feature and trigger variant rebuild when changed.
   * Calls `optionChanged(true)` internally on change.
   *
   * @param feature - The feature index to set.
   * @param use - The new feature value (typed by convention).
   * @returns void
   */
  useFeature(feature: number, use: unknown) {
    if (this._featureStates[feature] !== use) {
      this._featureStates[feature] = use;
      this.optionChanged(true);
    }
  }
  /**
   * Create the material-specific hash fragment from feature state.
   * Contributes to program variant hashing.
   *
   * @returns The hash fragment string.
   * @internal
   */
  protected _createHash() {
    return this._featureStates.map((val) => (val === undefined ? '' : val)).join('|');
  }
  /**
   * Apply material uniforms to the bind group (set 2).
   * Default implementation delegates to `applyUniformValues`.
   *
   * @param bindGroup - The material bind group to update.
   * @param ctx - Current draw context.
   * @param pass - Current material pass index.
   * @returns void
   * @internal
   */
  protected _applyUniforms(bindGroup: BindGroup, ctx: DrawContext, pass: number) {
    this.applyUniformValues(bindGroup, ctx, pass);
  }
  /**
   * Whether the fragment shader needs to compute color.
   * Returns true for LIGHT pass, or when alpha test or alpha-to-coverage is enabled.
   * Override if the material writes color in other passes.
   *
   * @param ctx - Optional draw context; defaults to the last captured `drawContext`.
   * @returns True if fragment color computation is needed; otherwise false.
   */
  needFragmentColor(ctx?: DrawContext) {
    return (
      (ctx ?? this.drawContext).renderPass!.type === RENDER_PASS_TYPE_LIGHT ||
      this._alphaCutoff > 0 ||
      this.alphaToCoverage
    );
  }
  /**
   * Vertex shader hook.
   * Prepares common inputs (skin/morph/instancing), varyings, and pass-dependent outputs.
   * Override to implement per-vertex logic; use `ShaderHelper` as needed.
   *
   * @param scope - Vertex shader function scope.
   * @returns void
   */
  vertexShader(scope: PBFunctionScope) {
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
      if (this.drawContext.renderPass!.type === RENDER_PASS_TYPE_OBJECT_COLOR) {
        scope.$outputs.zObjectColor = this.getInstancedUniform(scope, MeshMaterial.OBJECT_COLOR_UNIFORM);
      }
      if (this.isTransparentPass(this.pass)) {
        scope.$outputs.zOpacity = this.getInstancedUniform(scope, MeshMaterial.OPACITY_UNIFORM);
      }
    } else {
      if (this.drawContext.renderPass!.type === RENDER_PASS_TYPE_OBJECT_COLOR) {
        scope.$outputs.zObjectColor = scope[ShaderHelper.getObjectColorUniformName()];
      }
    }
  }
  /**
   * Fragment shader hook.
   * Declares pass-dependent uniforms (e.g., opacity, objectColor, alphaCutoff).
   * Override to implement per-fragment logic, and call `outputFragmentColor` to finalize writes.
   *
   * @param scope - Fragment shader function scope.
   * @returns void
   */
  fragmentShader(scope: PBFunctionScope) {
    const pb = scope.$builder;
    ShaderHelper.prepareFragmentShader(pb, this.drawContext);
    if (this._alphaCutoff > 0) {
      scope.zAlphaCutoff = pb.float().uniform(2);
    }
    if (this.drawContext.renderPass!.type === RENDER_PASS_TYPE_LIGHT) {
      if (
        this.isTransparentPass(this.pass) &&
        !(this.drawContext.materialFlags & MaterialVaryingFlags.INSTANCING)
      ) {
        scope.zOpacity = pb.float().uniform(2);
      }
    }
  }
  /**
   * Build and return the GPU program for this pass.
   * Wires `vertexShader` and `fragmentShader`; sets up pass-dependent outputs (OIT, SSR, motion vectors, distance/object color).
   *
   * @param pb - Program builder.
   * @param ctx - Current draw context.
   * @param pass - Material pass index.
   * @returns The created `GPUProgram`.
   * @internal
   */
  protected _createProgram(pb: ProgramBuilder, ctx: DrawContext, pass: number) {
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
          if (ctx.renderPass!.type === RENDER_PASS_TYPE_DEPTH && ctx.motionVectors) {
            this.$outputs.zMotionVector = pb.vec4();
            this.zTAAStrength = pb.float().uniform(2);
          }
          if (ctx.renderPass!.type === RENDER_PASS_TYPE_OBJECT_COLOR) {
            this.$outputs.zDistance = pb.vec4();
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
   * Centralized final color write and per-pass output composition.
   *
   * Behavior by pass:
   * - LIGHT: clipping, alpha handling, optional OIT integration, fog application, color output encoding.
   * - DEPTH: encoded depth; optional motion vectors (TAA enabled/disabled handling).
   * - OBJECT_COLOR: object color and distance output (linear depth or world-pos + distance).
   * - SHADOWMAP: writes shadow depth via light’s shadow implementation.
   *
   * Also writes SSR roughness/normal buffers when requested via material flags.
   *
   * @param scope - Inside-function shader scope.
   * @param worldPos - Fragment world-space position expression.
   * @param color - Lit fragment color expression; may be undefined for depth-only paths.
   * @param ssrRoughness - Optional SSR roughness output expression.
   * @param ssrNormal - Optional SSR normal output expression.
   * @returns void
   */
  outputFragmentColor(
    scope: PBInsideFunctionScope,
    worldPos: PBShaderExp,
    color: Nullable<PBShaderExp>,
    ssrRoughness?: PBShaderExp,
    ssrNormal?: PBShaderExp
  ) {
    const pb = scope.$builder;
    const that = this;
    const funcName = 'Z_outputFragmentColor';
    pb.func(funcName, color ? [pb.vec3('worldPos'), pb.vec4('color')] : [pb.vec3('worldPos')], function () {
      this.$l.outColor = color ? this.color : pb.vec4();
      if (that.drawContext.renderPass!.type === RENDER_PASS_TYPE_LIGHT) {
        let output = true;
        if (!that.isTransparentPass(that.pass) && !that.alphaToCoverage) {
          this.outColor.a = 1;
        } else if (that.isTransparentPass(that.pass)) {
          const opacity =
            that.drawContext.materialFlags & MaterialVaryingFlags.INSTANCING
              ? this.$inputs.zOpacity
              : this.zOpacity;
          this.outColor.a = pb.mul(this.outColor.a, opacity);
        }
        if (that.isTransparentPass(that.pass)) {
          if (this.zAlphaCutoff) {
            this.$if(pb.lessThan(this.outColor.a, this.zAlphaCutoff), function () {
              pb.discard();
            });
          }
          if (!that.drawContext.oit || that.drawContext.oit.wantsPremultipliedAlpha()) {
            this.outColor = pb.vec4(
              pb.mul(this.outColor.rgb, this.outColor.a),
              that.featureUsed<BlendMode>(FEATURE_ALPHABLEND) === 'additive' ? 0 : this.outColor.a
            );
          }
          output = !that.drawContext.oit || !that.drawContext.oit.outputFragmentColor(this, this.outColor);
        }
        if (output) {
          ShaderHelper.applyFog(this, this.worldPos, this.outColor, that.drawContext);
          this.$outputs.zFragmentOutput = ShaderHelper.encodeColorOutput(this, this.outColor);
        }
      } else if (that.drawContext.renderPass!.type === RENDER_PASS_TYPE_DEPTH) {
        if (color) {
          if (this.zAlphaCutoff) {
            this.$if(pb.lessThan(this.outColor.a, this.zAlphaCutoff), function () {
              pb.discard();
            });
          }
        }
        const depthPass = that.drawContext.renderPass! as DepthPass;
        this.$l.depth = ShaderHelper.nonLinearDepthToLinearNormalized(this, this.$builtins.fragCoord.z);
        if (depthPass.encodeDepth) {
          this.$outputs.zFragmentOutput = encodeNormalizedFloatToRGBA(this, this.depth);
        } else if (depthPass.renderBackface) {
          this.$outputs.zFragmentOutput = pb.vec4(0, this.depth, 0, 1);
        } else {
          this.$outputs.zFragmentOutput = pb.vec4(this.depth, 0, 0, 1);
        }
        if (that.drawContext.motionVectors) {
          if (that.featureUsed(FEATURE_DISABLE_TAA)) {
            this.$outputs.zMotionVector = pb.vec4(6e4, 6e4, 1, 1);
          } else {
            if (this.$inputs.zMotionVectorPosCurrent && this.$inputs.zMotionVectorPosPrev) {
              this.$outputs.zMotionVector = pb.vec4(
                pb.mul(
                  pb.sub(
                    pb.div(this.$inputs.zMotionVectorPosCurrent.xy, this.$inputs.zMotionVectorPosCurrent.w),
                    pb.div(this.$inputs.zMotionVectorPosPrev.xy, this.$inputs.zMotionVectorPosPrev.w)
                  ),
                  0.5
                ),
                this.zTAAStrength,
                1
              );
            } else {
              this.$outputs.zMotionVector = pb.vec4(0, 0, 1, 1);
            }
          }
        }
      } else if (that.drawContext.renderPass!.type === RENDER_PASS_TYPE_OBJECT_COLOR) {
        if (color) {
          this.$if(pb.lessThan(this.outColor.a, this.zAlphaCutoff), function () {
            pb.discard();
          });
        }
        this.$outputs.zFragmentOutput = scope.$inputs.zObjectColor;
        if (that.drawContext.device.type === 'webgl') {
          this.$l.linearDepth = ShaderHelper.nonLinearDepthToLinearNormalized(
            this,
            this.$builtins.fragCoord.z
          );
          this.$outputs.zDistance = encodeNormalizedFloatToRGBA(this, this.linearDepth);
        } else {
          this.$outputs.zDistance = pb.vec4(
            this.worldPos,
            pb.distance(ShaderHelper.getCameraPosition(this), this.worldPos)
          );
        }
      } /*if (that.drawContext.renderPass.type === RENDER_PASS_TYPE_SHADOWMAP)*/ else {
        if (color) {
          this.$if(pb.lessThan(this.outColor.a, this.zAlphaCutoff), function () {
            pb.discard();
          });
        }
        const shadowMapParams = that.drawContext.shadowMapInfo!.get(
          (that.drawContext.renderPass as ShadowMapPass).light!
        )!;
        this.$outputs.zFragmentOutput = shadowMapParams.impl!.computeShadowMapDepth(
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
FEATURE_CULLMODE = MeshMaterial.defineFeature();
FEATURE_ALPHATOCOVERAGE = MeshMaterial.defineFeature();
FEATURE_DISABLE_TAA = MeshMaterial.defineFeature();
