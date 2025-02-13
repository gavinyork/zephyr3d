import type { BindGroup, PBFunctionScope } from '@zephyr3d/device';
import { MeshMaterial } from './meshmaterial';
import type { DrawContext, WaveGenerator } from '../render';
import { MaterialVaryingFlags } from '../values';
import { ShaderHelper } from './shader/helper';
import { Matrix4x4, Vector4 } from '@zephyr3d/base';
import { Ref } from '../app';

export class WaterMaterial extends MeshMaterial {
  private static FEATURE_SSR = this.defineFeature();
  private static _waveUpdateState: WeakMap<WaveGenerator, number> = new WeakMap();
  private _region: Vector4;
  private _waveGenerator: Ref<WaveGenerator>;
  private _clipmapMatrix: Matrix4x4;
  constructor() {
    super();
    this._region = new Vector4(-99999, -99999, 99999, 99999);
    this._clipmapMatrix = new Matrix4x4();
    this._waveGenerator = new Ref();
    this.cullMode = 'none';
    this.useFeature(WaterMaterial.FEATURE_SSR, true);
  }
  get SSR() {
    return this.featureUsed<boolean>(WaterMaterial.FEATURE_SSR);
  }
  set SSR(val: boolean) {
    this.useFeature(WaterMaterial.FEATURE_SSR, !!val);
  }
  get region() {
    return this._region;
  }
  set region(val: Vector4) {
    if (!val.equalsTo(this._region)) {
      this._region.set(val);
      this.uniformChanged();
    }
  }
  get waveGenerator() {
    return this._waveGenerator.get();
  }
  set waveGenerator(waveGenerator: WaveGenerator) {
    if (this._waveGenerator.get() !== waveGenerator) {
      this._waveGenerator.set(waveGenerator);
      this.uniformChanged();
    }
  }
  protected _createHash(): string {
    return `${super._createHash}:${this.waveGenerator?.getHash() ?? ''}`;
  }
  setClipmapMatrix(mat: Matrix4x4) {
    this._clipmapMatrix.set(mat);
    this.uniformChanged();
  }
  supportInstancing(): boolean {
    return false;
  }
  supportLighting(): boolean {
    return false;
  }
  vertexShader(scope: PBFunctionScope): void {
    super.vertexShader(scope);
    const pb = scope.$builder;
    this.waveGenerator?.setupUniforms(scope);
    scope.$inputs.position = pb.vec3().attrib('position');
    scope.clipmapMatrix = pb.mat4().uniform(2);
    scope.$l.clipmapPos = pb.mul(scope.clipmapMatrix, pb.vec4(scope.$inputs.position, 1)).xy;
    //scope.$l.level = pb.mul(ShaderHelper.getWorldMatrix(scope), pb.vec4(0, 0, 0, 1)).y;
    scope.worldPos = pb.mul(
      ShaderHelper.getWorldMatrix(scope),
      pb.vec4(scope.clipmapPos.x, 0, scope.clipmapPos.y, 1)
    ).xyz; // pb.vec3(scope.clipmapPos.x, scope.level, scope.clipmapPos.y);
    scope.worldNormal = pb.vec3(0, 1, 0);
    this.waveGenerator?.calcVertexPositionAndNormal(scope, scope.worldPos, scope.worldPos, scope.worldNormal);
    scope.$outputs.worldPos = scope.worldPos;
    scope.$outputs.worldNormal = scope.worldNormal;
    ShaderHelper.setClipSpacePosition(
      scope,
      pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.worldPos, 1))
    );
  }
  fragmentShader(scope: PBFunctionScope): void {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    scope.region = pb.vec4().uniform(2);
    scope.$l.discardable = pb.or(
      pb.any(pb.lessThan(scope.$inputs.worldPos.xz, scope.region.xy)),
      pb.any(pb.greaterThan(scope.$inputs.worldPos.xz, scope.region.zw))
    );
    scope.$if(scope.discardable, function () {
      pb.discard();
    });
    if (this.needFragmentColor()) {
      if (this.drawContext.materialFlags & MaterialVaryingFlags.SSR_STORE_ROUGHNESS) {
        scope.$l.outRoughness = pb.vec4(1, 1, 1, 0);
        this.outputFragmentColor(
          scope,
          scope.$inputs.worldPos,
          pb.vec4(1),
          scope.outRoughness,
          pb.vec4(pb.add(pb.mul(scope.$inputs.worldNormal, 0.5), pb.vec3(0.5)), 1)
        );
      } else {
        this.outputFragmentColor(scope, scope.$inputs.worldPos, pb.vec4(1));
      }
    } else {
      this.outputFragmentColor(scope, scope.$inputs.worldPos, null);
    }
  }
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number): void {
    super.applyUniformValues(bindGroup, ctx, pass);
    bindGroup.setValue('clipmapMatrix', this._clipmapMatrix);
    bindGroup.setValue('region', this._region);
  }
  needUpdate() {
    return !!this._waveGenerator.get();
  }
  update(frameId: number, elapsed: number) {
    const waveGenerator = this._waveGenerator.get();
    if (waveGenerator) {
      const updateFrameId = WaterMaterial._waveUpdateState.get(waveGenerator);
      if (updateFrameId !== frameId) {
        waveGenerator.update(elapsed);
        WaterMaterial._waveUpdateState.set(waveGenerator, frameId);
      }
    }
  }
}
