import type { Clonable, Nullable } from '@zephyr3d/base';
import { Vector2, Vector4, DWeakRef } from '@zephyr3d/base';
import type { BindGroup, PBFunctionScope, PBInsideFunctionScope, RenderStateSet } from '@zephyr3d/device';
import {
  applyMaterialMixins,
  MeshMaterial,
  mixinFoliage,
  mixinPBRMetallicRoughness,
  ShaderHelper
} from '../../material';
import type { DrawContext } from '../../render';
import { WindField } from '../wind';
import { RENDER_PASS_TYPE_LIGHT } from '../../values';
import type { ClipmapTerrain } from './terrain-cm';
import { fetchSampler } from '../../utility/misc';
import { GRASS_LOD_FADE_BAND, grassDensityLod } from './grass_gpu';

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
  /** @internal */
  private readonly _distanceFade: Vector2;
  /** (density falloff start distance, density at the draw distance) @internal */
  private readonly _densityLod: Vector2;
  /** (wind lean, sway amplitude, sway speed, unused) @internal */
  private readonly _wind: Vector4;
  /** Scene wind of the current and the previous frame, see WindField.shaderParams @internal */
  private readonly _windParams: Float32Array<ArrayBuffer>;
  /** @internal */
  private _drawDistance: number;
  /** @internal */
  private _farDensity: number;
  /** @internal */
  private static readonly FEATURE_OCCLUSION_DEBUG = this.defineFeature();
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
    this._distanceFade = new Vector2(0, 0);
    this._densityLod = new Vector2(0, 1);
    this._wind = new Vector4(0.5, 0.15, 2.5, 0);
    this._windParams = new Float32Array(32);
    this._drawDistance = 0;
    this._farDensity = 1;
    this.useFeature(ClipmapGrassMaterial.FEATURE_OCCLUSION_DEBUG, false);
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
    this._distanceFade.set(other._distanceFade);
    this._densityLod.set(other._densityLod);
    this._wind.set(other._wind);
    this._drawDistance = other._drawDistance;
    this._farDensity = other._farDensity;
  }
  /**
   * Sets the distance beyond which blades are not drawn. Blades shrink into the ground over
   * the last quarter of it so that they do not pop out. Zero or less disables the fade.
   * @internal
   */
  setDrawDistance(distance: number) {
    this._drawDistance = distance;
    this.updateDistanceParams();
  }
  /**
   * Sets the fraction of blades kept at the draw distance, see GrassLayer.farDensity
   * @internal
   */
  setFarDensity(farDensity: number) {
    this._farDensity = farDensity;
    this.updateDistanceParams();
  }
  /**
   * Updates the scene wind before drawing. Taken from the scene rather than the draw context:
   * the depth prepass and the light pass must bend the cards by the same wind or the light pass's
   * equal depth test rejects them.
   * @internal
   */
  prepareDraw(wind: Nullable<WindField>) {
    const params = wind?.shaderParams;
    const p = this._windParams;
    let changed = false;
    for (let i = 0; i < p.length; i++) {
      const val = params ? params[i] : 0;
      if (p[i] !== val) {
        p[i] = val;
        changed = true;
      }
    }
    if (changed) {
      this.uniformChanged();
    }
  }
  /**
   * How far the wind lays the cards over toward lying flat, per unit of wind push. 0 leaves them
   * standing.
   */
  get windLean() {
    return this._wind.x;
  }
  set windLean(val: number) {
    val = Math.min(4, Math.max(0, val));
    if (val !== this._wind.x) {
      this._wind.x = val;
      this.uniformChanged();
    }
  }
  /** How far the card tops bob in the wind, as a fraction of the card height per unit of push */
  get swayAmplitude() {
    return this._wind.y;
  }
  set swayAmplitude(val: number) {
    val = Math.min(1, Math.max(0, val));
    if (val !== this._wind.y) {
      this._wind.y = val;
      this.uniformChanged();
    }
  }
  /** How fast the cards bob in the wind, in radians per second */
  get swaySpeed() {
    return this._wind.z;
  }
  set swaySpeed(val: number) {
    val = Math.min(50, Math.max(0, val));
    if (val !== this._wind.z) {
      this._wind.z = val;
      this.uniformChanged();
    }
  }
  /** @internal */
  private updateDistanceParams() {
    const distance = this._drawDistance;
    const start = distance > 0 ? distance * 0.75 : 0;
    const end = distance > 0 ? distance : 0;
    const lod = grassDensityLod(distance, this._farDensity);
    if (
      this._distanceFade.x !== start ||
      this._distanceFade.y !== end ||
      this._densityLod.x !== lod[0] ||
      this._densityLod.y !== lod[1]
    ) {
      this._distanceFade.setXY(start, end);
      this._densityLod.setXY(lod[0], lod[1]);
      this.uniformChanged();
    }
  }
  /**
   * Tints the blades the GPU placement pass flagged as hidden behind terrain red, instead of
   * leaving them out. Debugging aid for the terrain occlusion culling.
   * @internal
   */
  get occlusionDebug() {
    return !!this.featureUsed<boolean>(ClipmapGrassMaterial.FEATURE_OCCLUSION_DEBUG);
  }
  set occlusionDebug(val: boolean) {
    this.useFeature(ClipmapGrassMaterial.FEATURE_OCCLUSION_DEBUG, !!val);
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
    const heightMap = terrain.heightMap!;
    // The height map can be resized or replaced after construction
    this._heightMapSize.setXY(1 / heightMap.width, 1 / heightMap.height);
    bindGroup.setTexture('terrainHeightMap', heightMap, fetchSampler('clamp_linear_nomip'));
    bindGroup.setValue('heightMapSize', this._heightMapSize);
    bindGroup.setValue('terrainRegion', terrain.worldRegion);
    bindGroup.setValue('terrainPosScale', this._terrainPosScale);
    bindGroup.setValue('distanceFade', this._distanceFade);
    bindGroup.setValue('densityLod', this._densityLod);
    bindGroup.setValue('zCardWind', this._wind);
    bindGroup.setValue('zWind', this._windParams);
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
    scope.distanceFade = pb.vec2().uniform(2);
    scope.densityLod = pb.vec2().uniform(2);
    // (wind lean, sway amplitude, sway speed, unused)
    scope.zCardWind = pb.vec4().uniform(2);
    // Scene wind, current frame then previous frame, see WindField.shaderParams
    scope.zWind = pb.vec4[8]().uniform(2);

    pb.func('calcHeightMapNormal', [pb.vec2('uv'), pb.vec2('texelSize'), pb.vec3('scale')], function () {
      // World-space distance between the two samples of each central difference
      this.$l.sampleDist = pb.mul(
        pb.sub(this.terrainRegion.zw, this.terrainRegion.xy),
        pb.mul(this.texelSize, 2)
      );
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
      this.$l.dHdU = pb.div(pb.mul(pb.sub(this.hR, this.hL), this.scale.y), this.sampleDist.x);
      this.$l.dHdV = pb.div(pb.mul(pb.sub(this.hD, this.hU), this.scale.y), this.sampleDist.y);
      this.t = pb.normalize(pb.vec3(1, this.dHdU, 0));
      this.b = pb.normalize(pb.vec3(0, this.dHdV, 1));
      this.$return(pb.normalize(pb.cross(this.b, this.t)));
    });

    scope.$l.uv = scope.$inputs.placement.xy;
    scope.$l.heightSample = pb.textureSampleLevel(scope.terrainHeightMap, scope.uv, 0);
    scope.$l.height = pb.add(pb.mul(scope.heightSample.r, scope.terrainPosScale.y), scope.terrainPosScale.w);
    scope.$l.normal = scope.calcHeightMapNormal(scope.uv, scope.heightMapSize, scope.terrainPosScale.xyz);
    // placement: (u, v, facing angle, density LOD hash); the GPU placement pass adds 2 to the
    // hash of blades it flags as occluded
    scope.$l.occluded = pb.step(1.5, scope.$inputs.placement.w);
    if (this.occlusionDebug) {
      scope.$outputs.occludedFlag = scope.occluded;
    }
    scope.$l.lodHash = pb.mul(
      pb.sub(scope.$inputs.placement.w, pb.mul(scope.occluded, 2)),
      1 - GRASS_LOD_FADE_BAND
    );
    scope.$l.axisX = pb.vec3(pb.sin(scope.$inputs.placement.z), 0, pb.cos(scope.$inputs.placement.z));
    scope.$l.axisZ = pb.cross(scope.axisX, scope.normal);
    scope.$l.axisX = pb.cross(scope.normal, scope.axisZ);
    scope.$l.posXZ = pb.add(
      pb.mul(scope.$inputs.placement.xy, pb.sub(scope.terrainRegion.zw, scope.terrainRegion.xy)),
      scope.terrainRegion.xy
    );
    // (width scale, overall scale)
    scope.$l.bladeScale = pb.vec2(1);
    scope.$if(pb.greaterThan(scope.distanceFade.y, 0), function () {
      this.$l.bladeDist = pb.distance(
        ShaderHelper.getCameraPosition(this),
        pb.vec3(this.posXZ.x, this.height, this.posXZ.y)
      );
      // Density LOD: the fraction of blades kept falls with distance and each blade leaves as
      // it drops below its own hash, shrinking over a narrow band on the way. The survivors
      // widen by the inverse of the fraction to keep the coverage. Mirrors the GPU placement
      // pass, which skips the blades whose scale reaches zero here.
      this.$l.keep = pb.mix(
        1,
        this.densityLod.y,
        pb.smoothStep(this.densityLod.x, this.distanceFade.y, this.bladeDist)
      );
      this.bladeScale = pb.vec2(
        pb.div(1, this.keep),
        pb.mul(
          pb.sub(1, pb.smoothStep(this.distanceFade.x, this.distanceFade.y, this.bladeDist)),
          pb.clamp(pb.div(pb.sub(this.keep, this.lodHash), GRASS_LOD_FADE_BAND), 0, 1)
        )
      );
    });
    scope.$l.localPos = pb.mul(
      pb.vec3(
        pb.mul(scope.$inputs.pos.x, scope.bladeScale.x),
        scope.$inputs.pos.y,
        pb.mul(scope.$inputs.pos.z, scope.bladeScale.x)
      ),
      scope.bladeScale.y
    );
    scope.$l.rotPos = pb.mul(pb.mat3(scope.axisX, scope.normal, scope.axisZ), scope.localPos);
    scope.$l.basePos = pb.vec3(scope.posXZ.x, scope.height, scope.posXZ.y);
    scope.$outputs.zAlbedoTexCoord = scope.$inputs.albedoUV;
    scope.$outputs.worldPos = pb.add(scope.basePos, scope.rotPos, this.emitCardWind(scope, 0));
    ShaderHelper.setClipSpacePosition(
      scope,
      pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.worldPos, 1))
    );
    scope.$outputs.worldNorm = scope.normal;
    if (ShaderHelper.getPrevUnjitteredViewProjectionMatrix(scope)) {
      // Where this vertex was last frame, for the motion vectors: bent by last frame's wind
      scope.$l.prevWorldPos = pb.add(scope.basePos, scope.rotPos, this.emitCardWind(scope, 4));
      ShaderHelper.resolveMotionVector(scope, scope.$outputs.worldPos, scope.prevWorldPos);
    }
  }
  /**
   * Returns the world offset the wind moves the current vertex of a card by, for the wind of the
   * frame whose parameters start at `frame` in zWind.
   *
   * The card turns about its base toward the wind: by a lean that grows with the wind push, plus
   * a sine sway whose phase comes from the card's facing hash, both scaled by the push as for the
   * procedural blades (ClipmapBladeGrassMaterial). Turning keeps the card's length, so its top
   * drops as it leans.
   */
  private emitCardWind(scope: PBInsideFunctionScope, frame: number) {
    const pb = scope.$builder;
    const v = (name: string) => `${name}${frame}`;
    scope.$l[v('windPush')] = WindField.shaderPush(
      scope,
      scope.posXZ,
      scope.zWind.at(frame),
      scope.zWind.at(frame + 1),
      scope.zWind.at(frame + 2),
      scope.zWind.at(frame + 3)
    );
    scope.$l[v('windAngle')] = pb.add(
      pb.mul(pb.clamp(pb.mul(scope[v('windPush')], scope.zCardWind.x), 0, 0.95), Math.PI * 0.5),
      pb.mul(
        scope.zCardWind.y,
        scope[v('windPush')],
        // Wind clock in the fourth vec4 of the frame
        pb.sin(pb.add(pb.mul(scope.zWind.at(frame + 3).y, scope.zCardWind.z), scope.$inputs.placement.z))
      )
    );
    // Height of the vertex above the card's base
    const y = scope.localPos.y;
    return pb.add(
      pb.mul(
        pb.vec3(scope.zWind.at(frame).x, 0, scope.zWind.at(frame).y),
        pb.mul(y, pb.sin(scope[v('windAngle')]))
      ),
      pb.vec3(0, pb.mul(y, pb.sub(pb.cos(scope[v('windAngle')]), 1)), 0)
    );
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
      if (this.occlusionDebug) {
        scope.albedo = pb.vec4(
          pb.mix(scope.albedo.rgb, pb.vec3(1, 0, 0), scope.$inputs.occludedFlag),
          scope.albedo.a
        );
      }
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
