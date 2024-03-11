import { Vector2, Vector4 } from '@zephyr3d/base';
import { MeshMaterial, applyMaterialMixins } from './meshmaterial';
import { mixinPBRMetallicRoughness } from './mixins/lightmodel/pbrmetallicroughness';
import type { BindGroup, PBFunctionScope, Texture2D } from '@zephyr3d/device';
import type { DrawContext } from '../render';
import { RENDER_PASS_TYPE_LIGHT } from '../values';
import { ShaderHelper } from './shader/helper';
import { mixinFoliage } from './mixins/foliage';

export class GrassMaterial extends applyMaterialMixins(MeshMaterial, mixinPBRMetallicRoughness, mixinFoliage) {
  /** @internal */
  private _terrainSize: Vector2;
  /** @internal */
  private _terrainNormalMap: Texture2D;
  /** @internal */
  private _textureSize: Vector2;
  constructor(terrainSize: Vector2, normalMap: Texture2D, grassTexture?: Texture2D) {
    super();
    this.metallic = 0;
    this.roughness = 1;
    this.specularFactor = new Vector4(1, 1, 1, 0.2);
    this.doubleSidedLighting = false;
    this._terrainSize = terrainSize;
    this._terrainNormalMap = normalMap;
    this._textureSize = Vector2.one();
    if (grassTexture) {
      this.albedoTexture = grassTexture;
      this._textureSize.setXY(grassTexture.width, grassTexture.height);
    }
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
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number): void {
    super.applyUniformValues(bindGroup, ctx, pass);
    bindGroup.setTexture('terrainNormalMap', this._terrainNormalMap);
    bindGroup.setValue('terrainSize', this._terrainSize);
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
    scope.terrainSize = pb.vec2().uniform(2);
    const normalSample = pb.textureSampleLevel(
      scope.terrainNormalMap,
      pb.div(scope.$inputs.placement.xz, scope.terrainSize),
      0
    ).rgb;
    scope.$l.normal = pb.normalize(pb.sub(pb.mul(normalSample, 2), pb.vec3(1)));
    scope.$l.axisX = pb.vec3(1, 0, 0);
    scope.$l.axisZ = pb.cross(scope.axisX, scope.normal);
    scope.$l.axisX = pb.cross(scope.normal, scope.axisZ);
    scope.$l.rotPos = pb.mul(pb.mat3(scope.axisX, scope.normal, scope.axisZ), scope.$inputs.pos);

    scope.$outputs.worldPos = pb.mul(ShaderHelper.getWorldMatrix(scope), pb.vec4(pb.add(scope.rotPos, scope.$inputs.placement.xyz), 1)).xyz;
    ShaderHelper.setClipSpacePosition(scope, pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.worldPos, 1)));
    scope.$outputs.worldNorm = pb.mul(ShaderHelper.getNormalMatrix(scope), pb.vec4(scope.normal, 0)).xyz;
  }
  fragmentShader(scope: PBFunctionScope): void {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    const that = this;
    if (this.needFragmentColor()) {
      scope.albedoTextureSize = pb.vec2().uniform(2);
      scope.$l.albedo = this.calculateAlbedoColor(scope);
      scope.albedo = that.calculateFoliageAlbedo(scope, scope.albedo, pb.mul(that.getAlbedoTexCoord(scope), scope.albedoTextureSize))
      scope.$l.litColor = pb.vec3(0);
      if (this.drawContext.renderPass.type === RENDER_PASS_TYPE_LIGHT) {
        scope.$l.normalInfo = this.calculateNormalAndTBN(scope, scope.$inputs.worldPos, scope.$inputs.worldNorm);
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
}
