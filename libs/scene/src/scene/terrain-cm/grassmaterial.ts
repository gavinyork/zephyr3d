import type { Clonable } from '@zephyr3d/base';
import { Vector2, Vector4, DWeakRef } from '@zephyr3d/base';
import type { BindGroup, PBFunctionScope, RenderStateSet } from '@zephyr3d/device';
import {
  applyMaterialMixins,
  MeshMaterial,
  mixinFoliage,
  mixinPBRMetallicRoughness,
  ShaderHelper
} from '../../material';
import type { DrawContext } from '../../render';
import { RENDER_PASS_TYPE_LIGHT } from '../../values';
import type { ClipmapTerrain } from './terrain-cm';
import { fetchSampler } from '../../utility/misc';

/**
 * Terrain grass material
 * @public
 */
export class ClipmapGrassMaterial
  extends applyMaterialMixins(MeshMaterial, mixinPBRMetallicRoughness, mixinFoliage)
  implements Clonable<ClipmapGrassMaterial>
{
  /** @internal */
  private readonly _terrain: DWeakRef<ClipmapTerrain>;
  /** @internal */
  private readonly _terrainPosScale: Vector4;
  /** @internal */
  private readonly _heightMapSize: Vector2;
  /** @internal */
  private readonly _textureSize: Vector2;
  /**
   * Creates an instance of GrassMaterial class
   * @param terrain - Clipmap terrain object
   * @param heightMap - height map
   * @param grassTexture - grass texture
   */
  constructor(terrain: ClipmapTerrain) {
    super();
    this.metallic = 0;
    this.roughness = 1;
    this.doubleSidedLighting = false;
    this.specularFactor = new Vector4(1, 1, 1, 0.2);
    this._terrain = new DWeakRef(terrain);
    this._terrainPosScale = new Vector4();
    this._heightMapSize = new Vector2(1 / terrain.heightMap!.width, 1 / terrain.heightMap!.height);
    this._textureSize = Vector2.one();
  }
  clone() {
    const other = new ClipmapGrassMaterial(this._terrain.get()!);
    other.copyFrom(this);
    return other;
  }
  copyFrom(other: this) {
    super.copyFrom(other);
    this._terrainPosScale.set(other._terrainPosScale);
    this._heightMapSize.set(other._heightMapSize);
    this._textureSize.set(other._textureSize);
  }
  setTextureSize(w: number, h: number) {
    this._textureSize.setXY(w, h);
    this.uniformChanged();
  }
  /**
   * {@inheritDoc MeshMaterial.isTransparentPass}
   * @override
   */
  isTransparentPass(_pass: number) {
    return false;
  }
  /**
   * {@inheritDoc Material.supportLighting}
   * @override
   */
  supportLighting() {
    return true;
  }
  /**
   * {@inheritDoc Material.supportInstancing}
   * @override
   */
  supportInstancing() {
    return false;
  }
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number) {
    super.applyUniformValues(bindGroup, ctx, pass);
    const terrain = this._terrain.get()!;
    this._terrainPosScale.setXYZW(terrain.scale.x, terrain.scale.y, terrain.scale.z, terrain.worldMatrix.m13);
    bindGroup.setTexture('terrainHeightMap', terrain.heightMap!, fetchSampler('clamp_linear_nomip'));
    bindGroup.setValue('heightMapSize', this._heightMapSize);
    bindGroup.setValue('terrainRegion', terrain.worldRegion);
    bindGroup.setValue('terrainPosScale', this._terrainPosScale);
    if (this.needFragmentColor(ctx)) {
      bindGroup.setValue('albedoTextureSize', this._textureSize);
    }
  }
  vertexShader(scope: PBFunctionScope) {
    super.vertexShader(scope);
    const pb = scope.$builder;
    scope.$inputs.pos = pb.vec3().attrib('position');
    scope.$inputs.albedoUV = pb.vec2().attrib('texCoord0');
    scope.$inputs.placement = pb.vec4().attrib('texCoord1');
    scope.terrainHeightMap = pb.tex2D().uniform(2);
    scope.heightMapSize = pb.vec2().uniform(2);
    scope.terrainRegion = pb.vec4().uniform(2);
    scope.terrainPosScale = pb.vec4().uniform(2);

    pb.func('calcHeightMapNormal', [pb.vec2('uv'), pb.vec2('texelSize'), pb.vec3('scale')], function () {
      this.$l.hL = pb.textureSampleLevel(
        this.terrainHeightMap,
        pb.sub(this.uv, pb.vec2(this.texelSize.x, 0)),
        0
      ).r;
      this.$l.hR = pb.textureSampleLevel(
        this.terrainHeightMap,
        pb.add(this.uv, pb.vec2(this.texelSize.x, 0)),
        0
      ).r;
      this.$l.hD = pb.textureSampleLevel(
        this.terrainHeightMap,
        pb.add(this.uv, pb.vec2(0, this.texelSize.y)),
        0
      ).r;
      this.$l.hU = pb.textureSampleLevel(
        this.terrainHeightMap,
        pb.sub(this.uv, pb.vec2(0, this.texelSize.y)),
        0
      ).r;
      this.$l.dHdU = pb.div(pb.mul(pb.sub(this.hR, this.hL), this.scale.y), pb.mul(this.scale.x, 2));
      this.$l.dHdV = pb.div(pb.mul(pb.sub(this.hD, this.hU), this.scale.y), pb.mul(this.scale.z, 2));
      this.t = pb.normalize(pb.vec3(1, this.dHdU, 0));
      this.b = pb.normalize(pb.vec3(0, this.dHdV, 1));
      this.$return(pb.normalize(pb.cross(this.b, this.t)));
    });

    scope.$l.uv = scope.$inputs.placement.xy;
    scope.$l.heightSample = pb.textureSampleLevel(scope.terrainHeightMap, scope.uv, 0);
    scope.$l.height = pb.add(pb.mul(scope.heightSample.r, scope.terrainPosScale.y), scope.terrainPosScale.w);
    scope.$l.normal = scope.calcHeightMapNormal(scope.uv, scope.heightMapSize, scope.terrainPosScale.xyz);
    scope.$l.axisX = pb.vec3(scope.$inputs.placement.z, 0, scope.$inputs.placement.w);
    scope.$l.axisZ = pb.cross(scope.axisX, scope.normal);
    scope.$l.axisX = pb.cross(scope.normal, scope.axisZ);
    scope.$l.rotPos = pb.mul(pb.mat3(scope.axisX, scope.normal, scope.axisZ), scope.$inputs.pos);
    scope.$l.posXZ = pb.add(
      pb.mul(scope.$inputs.placement.xy, pb.sub(scope.terrainRegion.zw, scope.terrainRegion.xy)),
      scope.terrainRegion.xy
    );
    scope.$outputs.zAlbedoTexCoord = scope.$inputs.albedoUV;
    scope.$outputs.worldPos = pb.add(scope.rotPos, pb.vec3(scope.posXZ.x, scope.height, scope.posXZ.y));
    ShaderHelper.setClipSpacePosition(
      scope,
      pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.worldPos, 1))
    );
    scope.$outputs.worldNorm = scope.normal;
    ShaderHelper.resolveMotionVector(scope, scope.$outputs.worldPos, scope.$outputs.worldPos);
  }
  fragmentShader(scope: PBFunctionScope) {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    const that = this;
    if (this.needFragmentColor()) {
      scope.albedoTextureSize = pb.vec2().uniform(2);
      scope.$l.albedo = this.calculateAlbedoColor(scope);
      scope.albedo = that.calculateFoliageAlbedo(
        scope,
        scope.albedo,
        pb.mul(that.getAlbedoTexCoord(scope), scope.albedoTextureSize)
      );
      scope.$l.litColor = pb.vec3(0);
      if (this.drawContext.renderPass!.type === RENDER_PASS_TYPE_LIGHT) {
        scope.$l.normalInfo = this.calculateNormalAndTBN(
          scope,
          scope.$inputs.worldPos,
          scope.$inputs.worldNorm
        );
        scope.$l.viewVec = this.calculateViewVector(scope, scope.$inputs.worldPos);
        scope.$l.litColor = this.PBRLight(
          scope,
          scope.$inputs.worldPos,
          scope.normalInfo.normal,
          scope.viewVec,
          scope.albedo,
          scope.normalInfo.TBN
        );
      }
      this.outputFragmentColor(scope, scope.$inputs.worldPos, pb.vec4(scope.litColor, scope.albedo.a));
    } else {
      this.outputFragmentColor(scope, scope.$inputs.worldPos, null);
    }
  }
  apply(ctx: DrawContext) {
    this.alphaToCoverage = ctx.device.getFrameBufferSampleCount() > 1;
    this.alphaCutoff = this.alphaToCoverage ? 1 : 0.8;
    return super.apply(ctx);
  }
  protected updateRenderStates(pass: number, stateSet: RenderStateSet, ctx: DrawContext) {
    super.updateRenderStates(pass, stateSet, ctx);
    stateSet.useRasterizerState().setCullMode('none');
  }
}
