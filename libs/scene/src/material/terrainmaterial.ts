import { Material } from './material';
import { forwardComputeLighting } from '../shaders/lighting';
import { RENDER_PASS_TYPE_SHADOWMAP, RENDER_PASS_TYPE_FORWARD, RENDER_PASS_TYPE_DEPTH_ONLY } from '../values';
import { ShaderFramework } from '../shaders/framework';
import {
  encodeColorOutput,
  encodeNormalizedFloatToRGBA,
  nonLinearDepthToLinearNormalized
} from '../shaders/misc';
import { Application } from '../app';
import type { TerrainLightModelOptions } from './terrainlightmodel';
import { TerrainLightModel } from './terrainlightmodel';
import { MESH_MATERIAL } from '../shaders/builtins';
import type { BindGroup, GPUProgram, PBGlobalScope, ProgramBuilder } from '@zephyr3d/device';
import type { Vector4 } from '@zephyr3d/base';
import type { DrawContext } from '../render/drawable';
import type { ShadowMapPass } from '../render';

/** @internal */
export const MAX_DETAIL_TEXTURE_LEVELS = 8;

/**
 * The terrain material
 * @public
 */
export class TerrainMaterial extends Material {
  /** @internal */
  private _lightModel: TerrainLightModel;
  /** @internal */
  private _terrainInfo: Vector4;
  /**
   * Creates an instance of TerrainMaterial
   */
  constructor(options?: TerrainLightModelOptions) {
    super();
    this._terrainInfo = null;
    this._lightModel = new TerrainLightModel(options);
  }
  get lightModel(): TerrainLightModel {
    return this._lightModel;
  }
  get terrainInfo(): Vector4 {
    return this._terrainInfo;
  }
  set terrainInfo(val: Vector4) {
    this._terrainInfo = val;
    this.optionChanged(false);
  }
  /**
   * {@inheritDoc Material.isTransparent}
   * @override
   */
  isTransparent(): boolean {
    return false;
  }
  /**
   * {@inheritDoc Material.supportLighting}
   * @override
   */
  supportLighting(): boolean {
    return this._lightModel.supportLighting();
  }
  /**
   * {@inheritDoc Material.applyUniforms}
   * @override
   */
  applyUniforms(bindGroup: BindGroup, ctx: DrawContext, needUpdate: boolean): void {
    super.applyUniforms(bindGroup, ctx, needUpdate);
    if (ctx.renderPass.type === RENDER_PASS_TYPE_FORWARD) {
      this._lightModel.applyUniformsIfOutdated(bindGroup, ctx);
    }
  }
  /**
   * {@inheritDoc Material._applyUniforms}
   * @override
   */
  protected _applyUniforms(bindGroup: BindGroup, ctx: DrawContext): void {
    if (ctx.renderPass.type === RENDER_PASS_TYPE_FORWARD) {
      bindGroup.setValue('terrainInfo', this._terrainInfo);
    }
  }
  /** @internal */
  protected getHash(renderPassType: number): string {
    if (this._hash[renderPassType] === void 0) {
      this._hash[renderPassType] = this.createHash(renderPassType);
    }
    return this._hash[renderPassType];
  }
  /** @internal */
  protected _createHash(renderPassType: number): string {
    return renderPassType === RENDER_PASS_TYPE_FORWARD ? this._lightModel.getHash() : '';
  }
  /** @internal */
  protected _createProgram(pb: ProgramBuilder, ctx: DrawContext): GPUProgram {
    const that = this;
    if (ctx.renderPass.type === RENDER_PASS_TYPE_SHADOWMAP) {
      const shadowMapParams = ctx.shadowMapInfo.get((ctx.renderPass as ShadowMapPass).light);
      pb.emulateDepthClamp = !!shadowMapParams.depthClampEnabled;
    }
    const program = pb.buildRenderProgram({
      vertex(this: PBGlobalScope) {
        ShaderFramework.prepareVertexShader(pb, ctx);
        this.$inputs.pos = pb.vec3().attrib('position');
        if (ctx.renderPass.type === RENDER_PASS_TYPE_FORWARD) {
          this.terrainInfo = pb.vec4().uniform(2);
          this.$inputs.normal = pb.vec3().attrib('normal');
          that._lightModel.setupUniforms(this, ctx);
        }
        pb.main(function () {
          ShaderFramework.ftransform(this);
          if (ctx.renderPass.type === RENDER_PASS_TYPE_FORWARD) {
            this.$l.uv = pb.div(this.$inputs.pos.xz, this.terrainInfo.xy);
            for (let i = 0; i < Application.instance.device.getDeviceCaps().miscCaps.maxTexCoordIndex; i++) {
              if (that._lightModel?.isTexCoordIndexUsed(i)) {
                this.$outputs[`texcoord${i}`] = that._lightModel.calculateTexCoordNoInput(this, i, this.uv);
              }
            }
          }
        });
      },
      fragment(this: PBGlobalScope) {
        ShaderFramework.prepareFragmentShader(pb, ctx);
        if (ctx.renderPass.type === RENDER_PASS_TYPE_FORWARD) {
          that._lightModel.setupUniforms(this, ctx);
          this.$outputs.outColor = pb.vec4();
          pb.main(function () {
            this.$l.litColor = forwardComputeLighting(this, that._lightModel, ctx);
            MESH_MATERIAL.DISCARD_IF_CLIPPED(this);
            this.$outputs.outColor = encodeColorOutput(this, this.litColor);
          });
        } else if (ctx.renderPass.type === RENDER_PASS_TYPE_DEPTH_ONLY) {
          this.$outputs.outColor = pb.vec4();
          pb.main(function () {
            MESH_MATERIAL.DISCARD_IF_CLIPPED(this);
            this.$l.depth = nonLinearDepthToLinearNormalized(this, this.$builtins.fragCoord.z);
            if (Application.instance.device.type === 'webgl') {
              this.$outputs.outColor = encodeNormalizedFloatToRGBA(this, this.depth);
            } else {
              this.$outputs.outColor = pb.vec4(this.depth, 0, 0, 1);
            }
          });
        } else if (ctx.renderPass.type === RENDER_PASS_TYPE_SHADOWMAP) {
          this.$outputs.outColor = pb.vec4();
          pb.main(function () {
            MESH_MATERIAL.DISCARD_IF_CLIPPED(this);
            const shadowMapParams = ctx.shadowMapInfo.get((ctx.renderPass as ShadowMapPass).light);
            this.$outputs.outColor = shadowMapParams.impl.computeShadowMapDepth(shadowMapParams, this);
          });
        } else {
          throw new Error(`unknown render pass type: ${ctx.renderPass.type}`);
        }
      }
    });
    // console.log(program?.getShaderSource('vertex'));
    // console.log(program?.getShaderSource('fragment'));
    return program;
  }
}
