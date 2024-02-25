import { Vector2, Vector4 } from '@zephyr3d/base';
import { MeshMaterial, applyMaterialMixins } from './meshmaterial';
import { mixinLight } from './mixins/lit';
import { mixinPBRMetallicRoughness } from './mixins/pbr/metallicroughness';
import type { BindGroup, PBFunctionScope, Texture2D } from '@zephyr3d/device';
import type { DrawContext } from '../render';
import { RENDER_PASS_TYPE_LIGHT } from '../values';

export class GrassMaterial extends applyMaterialMixins(MeshMaterial, mixinLight, mixinPBRMetallicRoughness) {
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
    this.vertexNormal = false;
    this._terrainSize = terrainSize;
    this._terrainNormalMap = normalMap;
    this._textureSize = Vector2.one();
    if (grassTexture) {
      this.albedoTexture = grassTexture;
      this._textureSize.setXY(grassTexture.width, grassTexture.height);
    }
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
    return true;
  }
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number): void {
    super.applyUniformValues(bindGroup, ctx, pass);
    bindGroup.setTexture('kkTerrainNormalMap', this._terrainNormalMap);
    bindGroup.setValue('kkTerrainSize', this._terrainSize);
    if (this.needFragmentColor(ctx)) {
      bindGroup.setValue('albedoTextureSize', this._textureSize);
    }
  }
  vertexShader(scope: PBFunctionScope): void {
    super.vertexShader(scope);
    const pb = scope.$builder;
    scope.$inputs.pos = pb.vec3().attrib('position');
    scope.$inputs.placement = pb.vec4().attrib('texCoord1');
    scope.kkTerrainNormalMap = pb.tex2D().uniform(2);
    scope.kkTerrainSize = pb.vec2().uniform(2);
    const normalSample = pb.textureSampleLevel(
      scope.kkTerrainNormalMap,
      pb.div(scope.$inputs.placement.xz, scope.kkTerrainSize),
      0
    ).rgb;
    scope.$l.kkNormal = pb.normalize(pb.sub(pb.mul(normalSample, 2), pb.vec3(1)));
    scope.$l.axisX = pb.vec3(1, 0, 0);
    scope.$l.axisZ = pb.cross(scope.axisX, scope.kkNormal);
    scope.$l.axisX = pb.cross(scope.kkNormal, scope.axisZ);
    scope.$l.rotPos = pb.mul(pb.mat3(scope.axisX, scope.kkNormal, scope.axisZ), scope.$inputs.pos);
    this.helper.transformVertexAndNormal(
      scope,
      pb.add(scope.rotPos, scope.$inputs.placement.xyz),
      scope.kkNormal
    );
  }
  fragmentShader(scope: PBFunctionScope): void {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    const that = this;
    if (this.needFragmentColor()) {
      scope.albedoTextureSize = pb.vec2().uniform(2);
      pb.func('calcMipLevel', [pb.vec2('coord')], function () {
        this.$l.dx = pb.dpdx(this.coord);
        this.$l.dy = pb.dpdy(this.coord);
        this.$l.deltaMaxSqr = pb.max(pb.dot(this.dx, this.dx), pb.dot(this.dy, this.dy));
        this.$return(pb.max(0, pb.mul(pb.log2(this.deltaMaxSqr), 0.5)));
      });
      scope.$l.albedo = this.calculateAlbedoColor(scope);
      scope.$l.litColor = pb.vec3(0);
      if (this.drawContext.renderPass.type === RENDER_PASS_TYPE_LIGHT) {
        scope.$l.normalInfo = this.calculateNormalAndTBN(scope);
        scope.$l.normal = scope.normalInfo.normal;
        scope.$l.viewVec = this.calculateViewVector(scope);
        scope.$l.pbrData = this.getCommonData(scope, scope.albedo, scope.viewVec, scope.normalInfo.TBN);
        this.indirectLighting(scope, scope.normal, scope.viewVec, scope.pbrData, scope.litColor);
        this.forEachLight(scope, function (type, posRange, dirCutoff, colorIntensity, shadow) {
          this.$l.diffuse = pb.vec3();
          this.$l.specular = pb.vec3();
          this.$l.lightAtten = that.calculateLightAttenuation(this, type, posRange, dirCutoff);
          this.$l.lightDir = that.calculateLightDirection(this, type, posRange, dirCutoff);
          this.$l.NoL = pb.clamp(pb.dot(this.normal, this.lightDir), 0, 1);
          this.$l.lightColor = pb.mul(colorIntensity.rgb, colorIntensity.a, this.lightAtten, this.NoL);
          if (shadow) {
            this.lightColor = pb.mul(this.lightColor, that.calculateShadow(this, this.NoL));
          }
          that.directLighting(
            this,
            this.lightDir,
            this.lightColor,
            this.normal,
            this.viewVec,
            this.pbrData,
            this.litColor
          );
        });
      }
      scope.albedo.a = pb.mul(
        scope.albedo.a,
        pb.add(
          1,
          pb.mul(
            pb.max(0, scope.$g.calcMipLevel(pb.mul(that.getAlbedoTexCoord(scope), scope.albedoTextureSize))),
            0.25
          )
        )
      );
      if (that.alphaToCoverage) {
        scope.albedo.a = pb.add(
          pb.div(pb.sub(scope.albedo.a, 0.4), pb.max(pb.fwidth(scope.albedo.a), 0.0001)),
          0.5
        );
      }
      this.outputFragmentColor(scope, pb.vec4(scope.litColor, scope.albedo.a));
    } else {
      this.outputFragmentColor(scope, null);
    }
  }
}
