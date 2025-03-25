import type { BindGroup, PBFunctionScope, Texture2D } from '@zephyr3d/device';
import { applyMaterialMixins, MeshMaterial } from './meshmaterial';
import type { DrawContext } from '../render';
import { MaterialVaryingFlags } from '../values';
import { ShaderHelper } from './shader/helper';
import { Matrix4x4, Vector4 } from '@zephyr3d/base';
import { mixinLight } from './mixins/lit';
import { DRef } from '../app';
import { fetchSampler } from '../utility/misc';
import { mixinPBRMetallicRoughness } from './mixins/lightmodel/pbrmetallicroughness';

export class ClipmapTerrainMaterial extends applyMaterialMixins(
  MeshMaterial,
  mixinLight,
  mixinPBRMetallicRoughness
) {
  private _region: Vector4;
  private _clipmapMatrix: Matrix4x4;
  private _heightMap: DRef<Texture2D>;
  private _normalMap: DRef<Texture2D>;
  private _scaleY: number;
  constructor(heightMap: Texture2D) {
    super();
    this._region = new Vector4(-99999, -99999, 99999, 99999);
    this._clipmapMatrix = new Matrix4x4();
    this._heightMap = new DRef(heightMap);
    this._normalMap = new DRef();
    this._scaleY = 1;
  }
  /** @internal */
  get region() {
    return this._region;
  }
  /** @internal */
  set region(val: Vector4) {
    if (!val.equalsTo(this._region)) {
      this._region.set(val);
      this.uniformChanged();
    }
  }
  /** @internal */
  get scaleY() {
    return this._scaleY;
  }
  /** @internal */
  set scaleY(val: number) {
    if (val !== this._scaleY) {
      this._scaleY = val;
      this.uniformChanged();
    }
  }
  get heightMap() {
    return this._heightMap.get();
  }
  set heightMap(val: Texture2D) {
    if (val !== this._heightMap.get()) {
      this._heightMap.set(val);
      this.uniformChanged();
    }
  }
  get normalMap() {
    return this._normalMap.get();
  }
  set normalMap(val: Texture2D) {
    if (val !== this._normalMap.get()) {
      this._normalMap.set(val);
      this.uniformChanged();
    }
  }
  needSceneColor(): boolean {
    return false;
  }
  needSceneDepth(): boolean {
    return false;
  }
  setClipmapMatrix(mat: Matrix4x4) {
    this._clipmapMatrix.set(mat);
    this.uniformChanged();
  }
  supportInstancing(): boolean {
    return false;
  }
  supportLighting(): boolean {
    return true;
  }
  vertexShader(scope: PBFunctionScope): void {
    super.vertexShader(scope);
    const pb = scope.$builder;
    scope.$inputs.position = pb.vec3().attrib('position');
    scope.clipmapMatrix = pb.mat4().uniform(2);
    scope.heightMap = pb.tex2D().uniform(2);
    scope.region = pb.vec4().uniform(2);
    scope.scaleY = pb.float().uniform(2);
    scope.$l.clipmapPos = pb.mul(scope.clipmapMatrix, pb.vec4(scope.$inputs.position, 1)).xy;
    scope.clipmapWorldPos = pb.mul(
      ShaderHelper.getWorldMatrix(scope),
      pb.vec4(scope.clipmapPos.x, 0, scope.clipmapPos.y, 1)
    ).xyz; // pb.vec3(scope.clipmapPos.x, scope.level, scope.clipmapPos.y);
    scope.worldPos = scope.clipmapWorldPos;
    scope.$outputs.uv = pb.div(
      pb.sub(scope.worldPos.xz, scope.region.xy),
      pb.sub(scope.region.zw, scope.region.xy)
    );
    scope.$l.height = pb.textureSampleLevel(scope.heightMap, scope.$outputs.uv, 0).r;
    scope.$outputs.worldPos = pb.vec3(scope.worldPos.x, pb.mul(scope.height, scope.scaleY), scope.worldPos.z);
    scope.$outputs.clipmapPos = scope.clipmapWorldPos;
    ShaderHelper.setClipSpacePosition(
      scope,
      pb.mul(ShaderHelper.getUnjitteredViewProjectionMatrix(scope), pb.vec4(scope.$outputs.worldPos, 1))
    );
  }
  fragmentShader(scope: PBFunctionScope): void {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    scope.region = pb.vec4().uniform(2);
    scope.$l.discardable = pb.or(
      pb.any(pb.lessThan(scope.$inputs.uv, pb.vec2(0))),
      pb.any(pb.greaterThan(scope.$inputs.uv, pb.vec2(1)))
    );
    scope.$if(scope.discardable, function () {
      pb.discard();
    });
    if (this.needFragmentColor()) {
      scope.normalMap = pb.tex2D().uniform(2);
      scope.$l.albedo = pb.vec4(1);
      scope.$l.worldNormal = pb.sub(
        pb.mul(pb.textureSample(scope.normalMap, scope.$inputs.uv).rgb, 2),
        pb.vec3(1)
      );
      scope.$l.normalInfo = this.calculateNormalAndTBN(scope, scope.$inputs.worldPos, scope.worldNormal);
      scope.$l.viewVec = this.calculateViewVector(scope, scope.$inputs.worldPos);
      scope.$l.litColor = this.PBRLight(
        scope,
        scope.$inputs.worldPos,
        scope.normalInfo.normal,
        scope.viewVec,
        scope.albedo,
        scope.normalInfo.TBN
      );
      scope.$l.outColor = pb.vec4(scope.litColor, 1);
      if (this.drawContext.materialFlags & MaterialVaryingFlags.SSR_STORE_ROUGHNESS) {
        scope.$l.outRoughness = pb.vec4(1, 1, 1, 0);
        this.outputFragmentColor(
          scope,
          scope.$inputs.worldPos,
          pb.vec4(1),
          scope.outRoughness,
          scope.outColor
        );
      } else {
        this.outputFragmentColor(scope, scope.$inputs.worldPos, scope.outColor);
      }
    } else {
      this.outputFragmentColor(scope, scope.$inputs.worldPos, null);
    }
  }
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number): void {
    super.applyUniformValues(bindGroup, ctx, pass);
    bindGroup.setValue('clipmapMatrix', this._clipmapMatrix);
    bindGroup.setValue('region', this._region);
    bindGroup.setValue('scaleY', this._scaleY);
    bindGroup.setTexture('heightMap', this._heightMap.get(), fetchSampler('clamp_linear_nomip'));
    if (this.needFragmentColor(ctx)) {
      bindGroup.setTexture('normalMap', this._normalMap.get());
    }
  }
}
