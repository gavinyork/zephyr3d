import type { Matrix4x4 } from '@zephyr3d/base';
import { Material } from './material';
import { forwardComputeLighting } from '../shaders/lighting';
import * as values from '../values';
import type { BindGroup, GPUProgram, PBGlobalScope, ProgramBuilder } from '@zephyr3d/device';
import type { LightModel } from './lightmodel';
import type { DrawContext } from '../render/drawable';
import type { ShadowMapPass } from '../render';
import { encodeNormalizedFloatToRGBA, nonLinearDepthToLinearNormalized } from '../shaders/misc';
import { Application } from '../app';
import { MESH_MATERIAL } from '../shaders/builtins';

/**
 * The standard mesh material
 * @public
 */
export class StandardMaterial<T extends LightModel = LightModel> extends Material {
  /** @internal */
  private _vertexColor: boolean;
  /** @internal */
  private _hasNormal: boolean;
  /** @internal */
  private _useTangent: boolean;
  /** @internal */
  private _alphaBlend: boolean;
  /** @internal */
  private _alphaCutoff: number;
  /** @internal */
  private _opacity: number;
  /** @internal */
  private _lightModel: T;
  /**
   * Creates an instance of StandardMaterial
   */
  constructor() {
    super();
    this._vertexColor = false;
    this._useTangent = false;
    this._hasNormal = true;
    this._alphaBlend = false;
    this._alphaCutoff = 0;
    this._opacity = 1;
    this._lightModel = null;
  }
  /** Light model of the material */
  get lightModel(): T {
    return this._lightModel;
  }
  set lightModel(lm: T) {
    this._lightModel = lm || null;
  }
  /** true if vertex color attribute presents */
  get vertexColor(): boolean {
    return this._vertexColor;
  }
  set vertexColor(val: boolean) {
    if (this._vertexColor !== !!val) {
      this._vertexColor = !!val;
      this.optionChanged(true);
    }
  }
  /** true if vertex tangent attribute presents */
  get vertexTangent(): boolean {
    return this._useTangent;
  }
  set vertexTangent(val: boolean) {
    if (this._useTangent !== !!val) {
      this._useTangent = !!val;
      this.optionChanged(true);
    }
  }
  /** true if vertex normal attribute presents */
  get vertexNormal(): boolean {
    return this._hasNormal;
  }
  set vertexNormal(val: boolean) {
    if (this._hasNormal !== !!val) {
      this._hasNormal = !!val;
      this.optionChanged(true);
    }
  }
  /** true if alpha blending is enabled */
  get alphaBlend(): boolean {
    return this._alphaBlend;
  }
  set alphaBlend(val: boolean) {
    if (this._alphaBlend !== !!val) {
      this._alphaBlend = !!val;
      const blending = this._alphaBlend || this._opacity < 1;
      if (blending && !this.stateSet.blendingState?.enabled) {
        this.stateSet.useBlendingState().enable(true).setBlendFunc('one', 'inv-src-alpha');
      } else if (this.stateSet.blendingState?.enabled && !blending) {
        this.stateSet.defaultBlendingState();
      }
      this.optionChanged(true);
    }
  }
  /** A value between 0 and 1, presents the cutoff for alpha testing */
  get alphaCutoff(): number {
    return this._alphaCutoff;
  }
  set alphaCutoff(val: number) {
    if (this._alphaCutoff !== val) {
      this.optionChanged(this._alphaCutoff === 0 || val === 0);
      this._alphaCutoff = val;
    }
  }
  /** A value between 0 and 1, presents the opacity */
  get opacity(): number {
    return this._opacity;
  }
  set opacity(val: number) {
    val = val < 0 ? 0 : val > 1 ? 1 : val;
    if (this._opacity !== val) {
      this.optionChanged(this._opacity === 1 || val === 1);
      this._opacity = val;
      const blending = this._alphaBlend || this._opacity < 1;
      if (blending && !this.stateSet.blendingState?.enabled) {
        this.stateSet.useBlendingState().enable(true).setBlendFunc('one', 'inv-src-alpha');
      } else if (this.stateSet.blendingState?.enabled && !blending) {
        this.stateSet.defaultBlendingState();
      }
    }
  }
  /** true if the material is transparency */
  isTransparent(): boolean {
    return this._alphaBlend || this._opacity < 1;
  }
  /**
   * {@inheritDoc Material.supportLighting}
   * @override
   */
  supportLighting(): boolean {
    return this._lightModel ? this._lightModel.supportLighting() : false;
  }
  /**
   * {@inheritDoc Material.applyUniforms}
   * @override
   */
  applyUniforms(bindGroup: BindGroup, ctx: DrawContext, needUpdate: boolean): void {
    super.applyUniforms(bindGroup, ctx, needUpdate);
    if (ctx.renderPass.type === values.RENDER_PASS_TYPE_FORWARD || this._alphaCutoff > 0) {
      this._lightModel?.applyUniformsIfOutdated(bindGroup, ctx);
    }
  }
  /**
   * Gets the texture transform matrix for given texture coordinate index.
   * @param texCoordIndex - The texture coordinate index
   * @returns Texture transform matrix
   */
  getTexCoordTransform(texCoordIndex: number): Matrix4x4 {
    return this._lightModel?.getTexCoordTransform(texCoordIndex) ?? null;
  }
  /**
   * Sets the texture transform matrix for given texture coordinate index.
   * @param texCoordIndex - The texture coordinate index.
   * @param transform - Texture transform matrix, if null, the identity matrix will be set.
   */
  setTexCoordTransform(texCoordIndex: number, transform: Matrix4x4) {
    this._lightModel?.setTexCoordTransform(texCoordIndex, transform);
  }
  /**
   * {@inheritDoc Material._applyUniforms}
   * @override
   */
  protected _applyUniforms(bindGroup: BindGroup, ctx: DrawContext): void {
    if (this._alphaCutoff > 0) {
      bindGroup.setValue('alphaCutoff', this._alphaCutoff);
    }
    if (this._alphaBlend || this._opacity < 1) {
      bindGroup.setValue('opacity', this._opacity);
    }
  }
  /** @internal */
  protected getHash(renderPassType: number): string {
    if (this._hash[renderPassType] === void 0 || (this._lightModel && !this._lightModel.peekHash())) {
      this._hash[renderPassType] = this.createHash(renderPassType);
    }
    return this._hash[renderPassType];
  }
  /**
   * {@inheritDoc Material._createHash}
   * @override
   */
  protected _createHash(renderPassType: number): string {
    return renderPassType === values.RENDER_PASS_TYPE_FORWARD || this._alphaCutoff > 0
      ? `|${Number(!!this._vertexColor)}`
        + `|${Number(!!this._useTangent)}`
        + `|${Number(!!this._hasNormal)}`
        + `|${Number(this._opacity < 1 || this._alphaBlend)}`
        + `|${Number(this._alphaCutoff > 0)}`
        + `|${this._lightModel?.getHash() || ''}`
      : '';
  }
  /**
   * {@inheritDoc Material._createProgram}
   * @override
   */
  protected _createProgram(pb: ProgramBuilder, ctx: DrawContext): GPUProgram {
    const that = this;
    const useNormal =
      that._hasNormal && ctx.renderPass.type === values.RENDER_PASS_TYPE_FORWARD && that._lightModel?.isNormalUsed();
    if (ctx.renderPass.type === values.RENDER_PASS_TYPE_SHADOWMAP) {
      const shadowMapParams = ctx.shadowMapInfo.get((ctx.renderPass as ShadowMapPass).light);
      pb.emulateDepthClamp = !!shadowMapParams.depthClampEnabled;
    }
    const useLightModel = ctx.renderPass.type === values.RENDER_PASS_TYPE_FORWARD || that._alphaCutoff > 0;
    const program = pb.buildRenderProgram({
      label: ctx.target?.getName() ?? '',
      vertex(this: PBGlobalScope) {
        MESH_MATERIAL.VERTEX_SHADER(this, ctx);
        this.$inputs.pos = pb.vec3().attrib('position');
        if (ctx.target.getBoneMatrices()) {
          this.$inputs.blendIndices = pb.vec4().attrib('blendIndices');
          this.$inputs.blendWeights = pb.vec4().attrib('blendWeights');
        }
        if (useLightModel) {
          if (useNormal) {
            this.$inputs.normal = pb.vec3().attrib('normal');
          }
          if (that._vertexColor) {
            this.$inputs.vertexColor = pb.vec4().attrib('diffuse');
          }
          for (let i = 0; i < Application.instance.device.getDeviceCaps().miscCaps.maxTexCoordIndex; i++) {
            if (that._lightModel?.isTexCoordSrcLocationUsed(i)) {
              this.$inputs[`texcoord${i}`] = pb.vec2().attrib(`texCoord${i}` as any);
            }
          }
          if (useNormal && that._useTangent) {
            this.$inputs.tangent = pb.vec4().attrib('tangent');
          }
          that._lightModel?.setupUniforms(this, ctx);
        }
        pb.main(function () {
          MESH_MATERIAL.FTRANSFORM(this);
          if (ctx.renderPass.type === values.RENDER_PASS_TYPE_FORWARD || that._alphaCutoff > 0) {
            if (that._vertexColor) {
              this.$outputs.outVertexColor = MESH_MATERIAL.DEFINE_VERTEX_COLOR(this.$inputs.vertexColor);
            }
            for (let i = 0; i < Application.instance.device.getDeviceCaps().miscCaps.maxTexCoordIndex; i++) {
              if (that._lightModel?.isTexCoordIndexUsed(i)) {
                this.$outputs[`texcoord${i}`] = that._lightModel.calculateTexCoord(this, i);
              }
            }
          }
        });
      },
      fragment(this: PBGlobalScope) {
        MESH_MATERIAL.FRAGMENT_SHADER(this, ctx);
        if (that._alphaCutoff > 0) {
          this.alphaCutoff = pb.float().uniform(2);
        }
        if (useLightModel) {
          that._lightModel?.setupUniforms(this, ctx);
        }
        if (ctx.renderPass.type === values.RENDER_PASS_TYPE_FORWARD) {
          const blend = that._alphaBlend || that._opacity < 1;
          if (blend) {
            this.opacity = pb.float().uniform(2);
          }
          this.$outputs.outColor = pb.vec4();
          pb.main(function () {
            this.$l.litColor = that._lightModel
              ? forwardComputeLighting(this, that._lightModel, ctx)
              : pb.vec4(1);
            MESH_MATERIAL.DISCARD_IF_CLIPPED(this);
            if (!blend && that._alphaCutoff === 0) {
              this.litColor.a = 1;
            } else if (blend) {
              this.litColor.a = pb.mul(this.litColor.a, this.opacity);
            }
            if (that._alphaCutoff > 0) {
              this.$if(pb.lessThan(this.litColor.a, this.alphaCutoff), function () {
                pb.discard();
              });
            }
            this.litColor = pb.vec4(pb.mul(this.litColor.rgb, this.litColor.a), this.litColor.a);
            MESH_MATERIAL.APPLY_FOG(this, this.litColor, ctx);
            this.$outputs.outColor = MESH_MATERIAL.FRAGMENT_OUTPUT(this, this.litColor);
          });
        } else if (ctx.renderPass.type === values.RENDER_PASS_TYPE_DEPTH_ONLY) {
          this.$outputs.outColor = pb.vec4();
          pb.main(function () {
            MESH_MATERIAL.DISCARD_IF_CLIPPED(this);
            if (that._alphaCutoff > 0) {
              this.$l.albedoColor = that._lightModel.calculateAlbedo(this);
              this.$if(pb.lessThan(this.albedoColor.a, this.alphaCutoff), function () {
                pb.discard();
              });
            }
            this.$l.depth = nonLinearDepthToLinearNormalized(this, this.$builtins.fragCoord.z);
            if (Application.instance.device.type === 'webgl') {
              this.$outputs.outColor = encodeNormalizedFloatToRGBA(this, this.depth);
            } else {
              this.$outputs.outColor = pb.vec4(this.depth, 0, 0, 1);
            }
          });
        } else if (ctx.renderPass.type === values.RENDER_PASS_TYPE_SHADOWMAP) {
          this.$outputs.outColor = pb.vec4();
          pb.main(function () {
            MESH_MATERIAL.DISCARD_IF_CLIPPED(this);
            if (that._alphaCutoff > 0) {
              this.$l.albedoColor = that._lightModel.calculateAlbedo(this);
              this.$if(pb.lessThan(this.albedoColor.a, this.alphaCutoff), function () {
                pb.discard();
              });
            }
            const shadowMapParams = ctx.shadowMapInfo.get((ctx.renderPass as ShadowMapPass).light);
            this.$outputs.outColor = shadowMapParams.impl.computeShadowMapDepth(shadowMapParams, this);
          });
        } else {
          throw new Error(`unknown render pass type: ${ctx.renderPass.type}`);
        }
      }
    });
    //console.log(program.getShaderSource('fragment'));
    return program;
  }
}
