import { Clonable } from '@zephyr3d/base';
import { Vector2, Vector4 } from '@zephyr3d/base';
import type { BindGroup, PBFunctionScope, RenderStateSet, Texture2D } from '@zephyr3d/device';
import {
  applyMaterialMixins,
  MeshMaterial,
  mixinFoliage,
  mixinPBRMetallicRoughness,
  ShaderHelper
} from '../../material';
import { DrawContext } from '../../render';
import { RENDER_PASS_TYPE_LIGHT } from '../../values';
import { DRef } from '../../app';

/**
 * Terrain grass material
 * @public
 */
export class ClipmapGrassMaterial
  extends applyMaterialMixins(MeshMaterial, mixinPBRMetallicRoughness, mixinFoliage)
  implements Clonable<ClipmapGrassMaterial>
{
  /** @internal */
  private _terrainRegion: Vector4;
  /** @internal */
  private _terrainPosScale: Vector2;
  /** @internal */
  private _terrainNormalMap: DRef<Texture2D>;
  /** @internal */
  private _textureSize: Vector2;
  /** @internal */
  private _bladeSize: Vector2;
  /**
   * Creates an instance of GrassMaterial class
   * @param terrainSize - terrain size
   * @param normalMap - normal map
   * @param grassTexture - grass texture
   */
  constructor() {
    super();
    this.metallic = 0;
    this.roughness = 1;
    this.specularFactor = new Vector4(1, 1, 1, 0.2);
    this._terrainRegion = new Vector4();
    this._terrainPosScale = new Vector2();
    this.doubleSidedLighting = false;
    this._terrainNormalMap = new DRef();
    this._textureSize = Vector2.one();
  }
  clone(): ClipmapGrassMaterial {
    const other = new ClipmapGrassMaterial();
    other.copyFrom(this);
    return other;
  }
  copyFrom(other: this): void {
    super.copyFrom(other);
    this._terrainRegion.set(other._terrainRegion);
    this._terrainNormalMap.set(other._terrainNormalMap.get());
    this._textureSize.set(other._textureSize);
  }
  /**
   * {@inheritDoc MeshMaterial.isTransparentPass}
   * @override
   */
  isTransparentPass(pass: number): boolean {
    return false;
  }
  /**
   * {@inheritDoc Material.supportLighting}
   * @override
   */
  supportLighting(): boolean {
    return true;
  }
  /**
   * {@inheritDoc Material.supportInstancing}
   * @override
   */
  supportInstancing(): boolean {
    return false;
  }
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number): void {
    super.applyUniformValues(bindGroup, ctx, pass);
    bindGroup.setTexture('terrainNormalMap', this._terrainNormalMap.get());
    bindGroup.setValue('terrainRegion', this._terrainRegion);
    bindGroup.setValue('terrainPosScale', this._terrainPosScale);
    if (this.needFragmentColor(ctx)) {
      bindGroup.setValue('albedoTextureSize', this._textureSize);
    }
  }
  vertexShader(scope: PBFunctionScope): void {
    super.vertexShader(scope);
    const pb = scope.$builder;
    scope.$inputs.pos = pb.vec3().attrib('position');
    scope.$inputs.placement = pb.vec4().attrib('texCoord1');
    scope.terrainNormalMap = pb.tex2D().uniform(2);
    scope.terrainRegion = pb.vec4().uniform(2);
    scope.terrainPosScale = pb.vec2().uniform(2);
    scope.$l.normalHeightSample = pb.textureSampleLevel(
      scope.terrainNormalMap,
      scope.$inputs.placement.xy,
      0
    );
    scope.$l.normal = pb.normalize(pb.sub(pb.mul(scope.normalHeightSample.xyz, 2), pb.vec3(1)));
    scope.$l.axisX = pb.vec3(scope.$inputs.placement.z, 0, scope.$inputs.placement.w);
    scope.$l.axisZ = pb.cross(scope.axisX, scope.normal);
    scope.$l.axisX = pb.cross(scope.normal, scope.axisZ);
    scope.$l.rotPos = pb.mul(pb.mat3(scope.axisX, scope.normal, scope.axisZ), scope.$inputs.pos);
    scope.$l.height = scope.normalHeightSample.w;
    scope.$l.posXZ = pb.add(pb.mul(scope.$inputs.placement.xy, scope.Scale.zw), scope.terrainRegion.xy);
    scope.$l.posY = pb.add(scope.terrainPosScale.x, pb.mul(scope.height, scope.terrainPosScale.y));

    scope.$outputs.worldPos = pb.add(scope.rotPos, pb.vec3(scope.posXZ.x, scope.posY, scope.posXZ.y));
    ShaderHelper.setClipSpacePosition(
      scope,
      pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.worldPos, 1))
    );
    scope.$outputs.worldNorm = scope.normal;
  }
  fragmentShader(scope: PBFunctionScope): void {
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
      if (this.drawContext.renderPass.type === RENDER_PASS_TYPE_LIGHT) {
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
  apply(ctx: DrawContext): boolean {
    this.alphaToCoverage = ctx.device.getFrameBufferSampleCount() > 1;
    this.alphaCutoff = this.alphaToCoverage ? 1 : 0.8;
    return super.apply(ctx);
  }
  protected updateRenderStates(pass: number, stateSet: RenderStateSet, ctx: DrawContext): void {
    super.updateRenderStates(pass, stateSet, ctx);
    stateSet.useRasterizerState().setCullMode('none');
  }
}
