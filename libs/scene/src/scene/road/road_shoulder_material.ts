import type { Nullable } from '@zephyr3d/base';
import { Vector4 } from '@zephyr3d/base';
import type { BindGroup, PBFunctionScope, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { PBRMetallicRoughnessMaterial } from '../../material/pbrmr';
import { ShaderHelper } from '../../material/shader/helper';
import { RENDER_PASS_TYPE_LIGHT } from '../../values';
import { fetchSampler } from '../../utility/misc';
import type { DrawContext } from '../../render';
import type { VirtualTexture } from '../../render/virtualtexture/virtual_texture';
import type { ClipmapTerrain } from '../terrain-cm';

/**
 * Material of the shoulders of a {@link RoadSpline}: the road surface material blended into the
 * terrain it lies on, read from the terrain's runtime virtual texture.
 *
 * @remarks
 * The weight of the terrain comes from the vertex colors of the shoulder mesh, as 1 - alpha:
 * 0 at the road edge, 1 at the outer edge. Albedo, normal, roughness and metallic all blend, so
 * the outer edge shades exactly like the terrain around it; wherever the shoulder and the ground
 * cross there, both draw the same thing and no depth fighting shows. The shoulder is opaque.
 *
 * Only blends in the light pass on WebGPU, with a terrain whose runtime virtual texture is on;
 * otherwise it draws as the surface material.
 * @internal
 */
export class RoadShoulderMaterial extends PBRMetallicRoughnessMaterial {
  /** The layout of the virtual texture, baked into the shader, or '' when not blending */
  private static readonly FEATURE_TERRAIN_RVT = this.defineFeature();
  private _virtualTexture: Nullable<VirtualTexture>;
  private readonly _terrainRegion: Vector4;
  constructor() {
    super();
    this._virtualTexture = null;
    this._terrainRegion = new Vector4();
  }
  /** The virtual texture blended into, null when the shoulder draws as the surface material */
  get terrainVirtualTexture() {
    return this._virtualTexture;
  }
  /**
   * Sets the terrain to blend into; call again when its runtime virtual texture is turned on or
   * off or recreated, or the terrain moves
   * @param terrain - The terrain, or null
   */
  setTerrain(terrain: Nullable<ClipmapTerrain>) {
    const vt = terrain?.material?.virtualTextureUsed ? terrain.runtimeVirtualTextureData : null;
    this._virtualTexture = vt;
    if (terrain) {
      this._terrainRegion.set(terrain.worldRegion);
    }
    this.useFeature(
      RoadShoulderMaterial.FEATURE_TERRAIN_RVT,
      vt ? `${vt.levels[0].pagesX}x${vt.levels[0].pagesY}:${vt.pageSize}:${vt.border}:${vt.atlasSize}` : ''
    );
    // A recreated texture with the same layout keeps the program but has new buffers
    this.uniformChanged();
  }
  clone() {
    const other = new RoadShoulderMaterial();
    other.copyFrom(this);
    return other;
  }
  copyFrom(other: this) {
    super.copyFrom(other);
    if (other instanceof RoadShoulderMaterial) {
      this._virtualTexture = other._virtualTexture;
      this._terrainRegion.set(other._terrainRegion);
      this.useFeature(
        RoadShoulderMaterial.FEATURE_TERRAIN_RVT,
        other.featureUsed<string>(RoadShoulderMaterial.FEATURE_TERRAIN_RVT)
      );
    }
  }
  private terrainBlendActive(ctx?: DrawContext) {
    const drawContext = ctx ?? this.drawContext;
    return (
      !!this._virtualTexture &&
      !!this.featureUsed<string>(RoadShoulderMaterial.FEATURE_TERRAIN_RVT) &&
      drawContext?.renderPass?.type === RENDER_PASS_TYPE_LIGHT
    );
  }
  /** Weight of the terrain at the fragment, eased so both ends meet their neighbours smoothly */
  private terrainWeight(scope: PBInsideFunctionScope) {
    const pb = scope.$builder;
    return pb.smoothStep(0, 1, scope.$inputs.zRoadTerrainWeight) as PBShaderExp;
  }
  vertexShader(scope: PBFunctionScope) {
    super.vertexShader(scope);
    if (this.terrainBlendActive()) {
      const pb = scope.$builder;
      let color = scope.$getVertexAttrib('diffuse');
      if (!color) {
        scope.$inputs.zRoadVertexColor = pb.vec4().attrib('diffuse');
        color = scope.$inputs.zRoadVertexColor as PBShaderExp;
      }
      scope.$outputs.zRoadTerrainWeight = pb.sub(1, color.a);
    }
  }
  fragmentShader(scope: PBFunctionScope) {
    if (this.terrainBlendActive()) {
      const pb = scope.$builder;
      const globals = pb.getGlobalScope();
      this._virtualTexture!.declareBindings(globals, 2, false);
      globals.zRoadRVT0 = pb.tex2D().uniform(2);
      globals.zRoadRVT1 = pb.tex2D().uniform(2);
      globals.zRoadTerrainRegion = pb.vec4().uniform(2);
    }
    super.fragmentShader(scope);
  }
  /**
   * The surface albedo blended into the terrain's. The terrain roughness rides in the alpha into
   * PBRLight, whose own function cannot see the locals here (see calculateCommonData); nothing
   * else reads the alpha of an opaque material.
   */
  calculateAlbedoColor(scope: PBInsideFunctionScope, uv?: PBShaderExp) {
    const base = super.calculateAlbedoColor(scope, uv);
    if (!this.terrainBlendActive()) {
      return base;
    }
    const pb = scope.$builder;
    scope.$l.zRoadTerrainN = pb.vec3();
    scope.$l.zRoadTerrain = this.sampleTerrain(scope, scope.zRoadTerrainN);
    scope.$l.zRoadTerrainW = this.terrainWeight(scope);
    return pb.vec4(pb.mix(base.rgb, scope.zRoadTerrain.rgb, scope.zRoadTerrainW), scope.zRoadTerrain.a);
  }
  calculateNormalAndTBN(
    scope: PBInsideFunctionScope,
    worldPos: PBShaderExp,
    worldNormal?: PBShaderExp,
    worldTangent?: PBShaderExp,
    worldBinormal?: PBShaderExp
  ) {
    const info = super.calculateNormalAndTBN(scope, worldPos, worldNormal, worldTangent, worldBinormal);
    if (!this.terrainBlendActive()) {
      return info;
    }
    const pb = scope.$builder;
    scope.$l.zRoadNormalInfo = info;
    scope.zRoadNormalInfo.normal = pb.normalize(
      pb.mix(scope.zRoadNormalInfo.normal, scope.zRoadTerrainN, scope.zRoadTerrainW)
    );
    return scope.zRoadNormalInfo as PBShaderExp;
  }
  /** The terrain is not metallic; linear in the weight, so the metallic texture factor keeps it */
  calculateMetallic(scope: PBInsideFunctionScope, albedo: PBShaderExp, normal: PBShaderExp) {
    const metallic = super.calculateMetallic(scope, albedo, normal);
    if (!this.terrainBlendActive()) {
      return metallic;
    }
    const pb = scope.$builder;
    return pb.mul(metallic, pb.sub(1, this.terrainWeight(scope))) as PBShaderExp;
  }
  calculateCommonData(
    scope: PBInsideFunctionScope,
    albedo: PBShaderExp,
    normal: PBShaderExp,
    viewVec: PBShaderExp,
    TBN: PBShaderExp,
    data: PBShaderExp
  ) {
    super.calculateCommonData(scope, albedo, normal, viewVec, TBN, data);
    if (this.terrainBlendActive()) {
      // The surface roughness has its texture applied by now; the terrain's came in as albedo.a
      const pb = scope.$builder;
      data.roughness = pb.mix(
        data.roughness,
        pb.mul(albedo.a, ShaderHelper.getCameraRoughnessFactor(scope)),
        this.terrainWeight(scope)
      );
    }
  }
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number) {
    super.applyUniformValues(bindGroup, ctx, pass);
    if (this.terrainBlendActive(ctx)) {
      const vt = this._virtualTexture!;
      vt.applyBindings(bindGroup, false);
      bindGroup.setTexture('zRoadRVT0', vt.getPlaneTexture('baseColor')!, fetchSampler('clamp_linear_nomip'));
      bindGroup.setTexture(
        'zRoadRVT1',
        vt.getPlaneTexture('normalRoughness')!,
        fetchSampler('clamp_linear_nomip')
      );
      bindGroup.setValue('zRoadTerrainRegion', this._terrainRegion);
    }
  }
  /**
   * Reads the terrain at the fragment from the virtual texture, as
   * ClipmapTerrainMaterial.sampleVirtualTexture: (linear albedo, roughness) is returned, the world
   * space normal written to `normal`
   */
  private sampleTerrain(scope: PBInsideFunctionScope, normal: PBShaderExp) {
    const pb = scope.$builder;
    const vt = this._virtualTexture!;
    const maxLevel = vt.levels.length - 1;
    pb.func('zRoadSampleTerrain', [pb.vec3('normal').out()], function () {
      this.$l.uv = pb.div(
        pb.sub(this.$inputs.worldPos.xz, this.zRoadTerrainRegion.xy),
        pb.sub(this.zRoadTerrainRegion.zw, this.zRoadTerrainRegion.xy)
      );
      this.$l.level = vt.computeLevel(this, this.uv);
      this.$l.level0 = pb.floor(this.level);
      this.$l.level1 = pb.min(pb.add(this.level0, 1), maxLevel);
      this.$l.loc0 = vt.resolve(this, pb.uint(this.level0), this.uv);
      this.$l.loc1 = vt.resolve(this, pb.uint(this.level1), this.uv);
      this.$l.t = pb.select(pb.float(0), pb.sub(this.level, this.level0), pb.equal(this.loc1.z, this.level1));
      this.$l.baseColor = pb.mix(
        pb.textureSampleLevel(this.zRoadRVT0, this.loc0.xy, 0),
        pb.textureSampleLevel(this.zRoadRVT0, this.loc1.xy, 0),
        this.t
      );
      this.$l.normalRoughness = pb.mix(
        pb.textureSampleLevel(this.zRoadRVT1, this.loc0.xy, 0),
        pb.textureSampleLevel(this.zRoadRVT1, this.loc1.xy, 0),
        this.t
      );
      this.$l.nxz = pb.sub(pb.mul(this.normalRoughness.xz, 255 / 127), pb.vec2(1));
      this.normal = pb.normalize(
        pb.vec3(this.nxz.x, pb.sqrt(pb.clamp(pb.sub(1, pb.dot(this.nxz, this.nxz)), 0, 1)), this.nxz.y)
      );
      this.$l.c = this.baseColor.rgb;
      this.$l.linear = pb.mix(
        pb.pow(pb.div(pb.add(this.c, pb.vec3(0.055)), 1.055), pb.vec3(2.4)),
        pb.div(this.c, 12.92),
        pb.vec3(pb.lessThanEqual(this.c, pb.vec3(0.04045)))
      );
      this.$return(pb.vec4(this.linear, this.normalRoughness.y));
    });
    return scope.zRoadSampleTerrain(normal) as PBShaderExp;
  }
}
