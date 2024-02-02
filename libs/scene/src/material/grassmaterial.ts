import { Texture2D, BindGroup, GPUProgram, PBGlobalScope, ProgramBuilder, ShaderType } from '@zephyr3d/device';
import { Material } from './material';
import { forwardComputeLighting } from '../shaders/lighting';
import { RENDER_PASS_TYPE_SHADOWMAP, RENDER_PASS_TYPE_FORWARD, RENDER_PASS_TYPE_DEPTH_ONLY } from '../values';
import { ShaderFramework } from '../shaders/framework';
import { encodeColorOutput, encodeNormalizedFloatToRGBA, nonLinearDepthToLinearNormalized } from '../shaders/misc';
import { Application } from '../app';
import { PBRLightModelMR } from '.';
import type { DrawContext } from '../render/drawable';
import type { ShadowMapPass } from '../render';
import { Vector2, Vector4 } from '@zephyr3d/base';
import { MESH_MATERIAL } from '../shaders/builtins';

/**
 * The terrain material
 * @public
 */
export class GrassMaterial extends Material {
  /** @internal */
  private _lightModel: PBRLightModelMR;
  /** @internal */
  private _terrainSize: Vector2;
  /** @internal */
  private _normalMap: Texture2D;
  /** @internal */
  private _grassTexture: Texture2D;
  /** @internal */
  private _textureSize: Vector2;
  /** @internal */
  private _useAlphaToCoverage: boolean;
  /**
   * Creates an instance of TerrainMaterial
   */
  constructor(terrainSize: Vector2, normalMap: Texture2D, grassTexture?: Texture2D) {
    super();
    this._lightModel = new PBRLightModelMR();
    this._lightModel.metallic = 0;
    this._lightModel.roughness = 1;
    this._lightModel.specularFactor = new Vector4(1, 1, 1, 0.2);
    this._lightModel.doubleSideLighting = false;
    this._terrainSize = terrainSize;
    this._normalMap = normalMap;
    this._textureSize = Vector2.one();
    this._useAlphaToCoverage = false;
    if (grassTexture) {
      this._lightModel.setAlbedoMap(grassTexture, null, 0);
      this._textureSize.setXY(grassTexture.width, grassTexture.height);
    }
  }
  /** enable alpha to coverage */
  get alphaToCoverage(): boolean {
    return this._useAlphaToCoverage;
  }
  set alphaToCoverage(val: boolean) {
    if (this._useAlphaToCoverage !== !!val) {
      this._useAlphaToCoverage = !!val;
      if (this._useAlphaToCoverage) {
        this.stateSet.useBlendingState().enableAlphaToCoverage(true);
      } else {
        this.stateSet.defaultBlendingState();
      }
      this.optionChanged(true);
    }
  }
  /** Light model */
  get lightModel(): PBRLightModelMR {
    return this._lightModel;
  }
  /** Base map */
  get colorMap(): Texture2D {
    return this._lightModel.albedoMap;
  }
  set colorMap(tex: Texture2D) {
    this._lightModel.setAlbedoMap(tex, null, 0);
  }
  /** Color */
  get color(): Vector4 {
    return this._lightModel.albedo;
  }
  set color(val: Vector4) {
    this._lightModel.albedo = val;
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
    this._lightModel.applyUniformsIfOutdated(bindGroup, ctx);
  }
  /**
   * {@inheritDoc Material._applyUniforms}
   * @override
   */
  protected _applyUniforms(bindGroup: BindGroup, ctx: DrawContext): void {
    bindGroup.setValue('terrainSize', this._terrainSize);
    bindGroup.setTexture('terrainNormalMap', this._normalMap);
    bindGroup.setValue('albedoTextureSize', this._textureSize);
  }
  /** @internal */
  protected getHash(renderPassType: number): string {
    if (this._hash[renderPassType] === void 0 || !this._lightModel.peekHash()) {
      this._hash[renderPassType] = this.createHash(renderPassType);
    }
    return this._hash[renderPassType];
  }
  /** @internal */
  protected _createHash(renderPassType: number): string {
    return renderPassType === RENDER_PASS_TYPE_FORWARD ? `${Number(this._useAlphaToCoverage)}:${this._lightModel.getHash()}` : `${Number(this._useAlphaToCoverage)}`;
  }
  /** @internal */
  protected _createProgram(pb: ProgramBuilder, ctx: DrawContext): GPUProgram {
    const that = this;
    if (ctx.renderPass.type === RENDER_PASS_TYPE_SHADOWMAP) {
      const shadowMapParams = ctx.shadowMapInfo.get((ctx.renderPass as ShadowMapPass).light);
      pb.emulateDepthClamp = !!shadowMapParams.depthClampEnabled;
    }
    const program = pb.buildRenderProgram({
      vertex(pb) {
        ShaderFramework.prepareVertexShader(pb, ctx);
        this.$inputs.pos = pb.vec3().attrib('position');
        this.$inputs.uv = pb.vec2().attrib('texCoord0');
        this.$inputs.placement = pb.vec4().attrib('texCoord1');
        this.terrainNormalMap = pb.tex2D().uniform(2);
        this.terrainSize = pb.vec2().uniform(2);
        that._lightModel.setupUniforms(this, ctx);
        pb.main(function () {
          this.$l.normalSample = pb.getDevice().type === 'webgl'
            ? pb.textureSample(this.terrainNormalMap, pb.div(this.$inputs.placement.xz, this.terrainSize)).rgb
            : pb.textureSampleLevel(this.terrainNormalMap, pb.div(this.$inputs.placement.xz, this.terrainSize), 0).rgb
          this.$l.normal = pb.normalize(pb.sub(pb.mul(this.normalSample, 2), pb.vec3(1)));
          this.$l.axisX = pb.vec3(1, 0, 0);
          this.$l.axisZ = pb.cross(this.axisX, this.normal);
          this.$l.axisX = pb.cross(this.normal, this.axisZ);
          this.$l.rotPos = pb.mul(pb.mat3(this.axisX, this.normal, this.axisZ), this.$inputs.pos);
          this.$l.p = pb.vec4(pb.add(this.rotPos, this.$inputs.placement.xyz), 1);
          this.$outputs.texcoord0 = this.$inputs.uv;
          this.$outputs.worldPosition = pb.mul(ShaderFramework.getWorldMatrix(this), this.$l.p).tag(ShaderFramework.USAGE_WORLD_POSITION);
          ShaderFramework.setClipSpacePosition(this, pb.mul(ShaderFramework.getViewProjectionMatrix(this), this.$outputs.worldPosition));
          if (ctx.renderPass.type === RENDER_PASS_TYPE_FORWARD) {
            this.$outputs.worldNormal = pb.normalize(pb.mul(ShaderFramework.getWorldMatrix(this), pb.vec4(this.normal,0)).xyz).tag(ShaderFramework.USAGE_WORLD_NORMAL);
            this.$outputs.outVertexColor = pb.vec4(1, 1, 1, 1).tag(ShaderFramework.USAGE_VERTEX_COLOR);
          }
        });
      },
      fragment(pb) {
        ShaderFramework.prepareFragmentShader(pb, ctx);
        that._lightModel.setupUniforms(this, ctx);
        this.albedoTextureSize = pb.vec2().uniform(2);
        this.$outputs.outColor = pb.vec4();
        pb.func('calcMipLevel', [pb.vec2('coord')], function(){
          this.$l.dx = pb.dpdx(this.coord);
          this.$l.dy = pb.dpdy(this.coord);
          this.$l.deltaMaxSqr = pb.max(pb.dot(this.dx, this.dx), pb.dot(this.dy, this.dy));
          this.$return(pb.max(0, pb.mul(pb.log2(this.deltaMaxSqr), 0.5)));
        });
        if (ctx.renderPass.type === RENDER_PASS_TYPE_FORWARD) {
          pb.main(function () {
            this.$l.litColor = forwardComputeLighting(this, that._lightModel, ctx);
            MESH_MATERIAL.DISCARD_IF_CLIPPED(this);
            this.$l.a = pb.mul(this.litColor.a, pb.add(1, pb.mul(pb.max(0, this.calcMipLevel(pb.mul(this.$inputs.texcoord0, this.albedoTextureSize))), 0.25)));
            if (that._useAlphaToCoverage) {
              // alpha to coverage
              this.a = pb.add(pb.div(pb.sub(this.litColor.a, 0.4), pb.max(pb.fwidth(this.litColor.a), 0.0001)), 0.5);
              this.litColor = pb.vec4(this.litColor.rgb, this.a);//pb.vec4(pb.mul(this.litColor.rgb, this.litColor.a), this.litColor.a);
            } else {
              // alpha test
              this.$if(pb.lessThan(this.a, 0.8), function () {
                pb.discard();
              });
            }
            MESH_MATERIAL.APPLY_FOG(this, this.litColor, ctx);
            this.$outputs.outColor = MESH_MATERIAL.FRAGMENT_OUTPUT(this, this.litColor);
          });
        } else if (ctx.renderPass.type === RENDER_PASS_TYPE_DEPTH_ONLY) {
          pb.main(function () {
            this.$l.litColor = that._lightModel.calculateAlbedo(this);
            MESH_MATERIAL.DISCARD_IF_CLIPPED(this);
            this.$l.a = pb.mul(this.litColor.a, pb.add(1, pb.mul(pb.max(0, this.calcMipLevel(pb.mul(this.$inputs.texcoord0, this.albedoTextureSize))), 0.25)));
            if (that._useAlphaToCoverage) {
              // alpha to coverage
              this.a = pb.add(pb.div(pb.sub(this.litColor.a, 0.4), pb.max(pb.fwidth(this.litColor.a), 0.0001)), 0.5);
              this.litColor = pb.vec4(this.litColor.rgb, this.a);//pb.vec4(pb.mul(this.litColor.rgb, this.litColor.a), this.litColor.a);
            } else {
              // alpha test
              this.$if(pb.lessThan(this.a, 0.8), function () {
                pb.discard();
              });
            }
            this.$l.depth = nonLinearDepthToLinearNormalized(this, this.$builtins.fragCoord.z);
            if (Application.instance.device.type === 'webgl') {
              this.$outputs.outColor = encodeNormalizedFloatToRGBA(this, this.depth);
            } else {
              this.$outputs.outColor = pb.vec4(this.depth, 0, 0, this.a);
            }
          });
        } else if (ctx.renderPass.type === RENDER_PASS_TYPE_SHADOWMAP) {
          pb.main(function () {
            this.$l.litColor = that._lightModel.calculateAlbedo(this);
            MESH_MATERIAL.DISCARD_IF_CLIPPED(this);
            this.$l.a = pb.mul(this.litColor.a, pb.add(1, pb.mul(pb.max(0, this.calcMipLevel(pb.mul(this.$inputs.texcoord0, this.albedoTextureSize))), 0.25)));
            if (that._useAlphaToCoverage) {
              // alpha to coverage
              this.a = pb.add(pb.div(pb.sub(this.litColor.a, 0.4), pb.max(pb.fwidth(this.litColor.a), 0.0001)), 0.5);
              this.litColor = pb.vec4(this.litColor.rgb, this.a);//pb.vec4(pb.mul(this.litColor.rgb, this.litColor.a), this.litColor.a);
            } else {
              // alpha test
              this.$if(pb.lessThan(this.a, 0.8), function () {
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
    // console.log(program?.getShaderSource('vertex'));
    // console.log(program?.getShaderSource('fragment'));
    return program;
  }
}
