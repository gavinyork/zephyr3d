import type { BindGroup, PBFunctionScope, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { MeshMaterial } from './meshmaterial';
import type { DrawContext, WaveGenerator } from '../render';
import { MaterialVaryingFlags } from '../values';
import { ShaderHelper } from './shader/helper';
import { Matrix4x4, Vector4 } from '@zephyr3d/base';
import { DRef } from '../app';
import { sampleLinearDepth } from '../shaders/ssr';

export class WaterMaterial extends MeshMaterial {
  private static FEATURE_SSR = this.defineFeature();
  private static _waveUpdateState: WeakMap<WaveGenerator, number> = new WeakMap();
  private _region: Vector4;
  private _displace: number;
  private _waveGenerator: DRef<WaveGenerator>;
  private _clipmapMatrix: Matrix4x4;
  constructor() {
    super();
    this._region = new Vector4(-99999, -99999, 99999, 99999);
    this._clipmapMatrix = new Matrix4x4();
    this._waveGenerator = new DRef();
    this._displace = 16;
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
      this.optionChanged(true);
    }
  }
  needSceneColor(): boolean {
    return true;
  }
  needSceneDepth(): boolean {
    return true;
  }
  protected _createHash(): string {
    return `${super._createHash()}:${this.waveGenerator?.getHash() ?? ''}`;
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
    this.waveGenerator?.setupUniforms(scope, 2);
    scope.$inputs.position = pb.vec3().attrib('position');
    scope.clipmapMatrix = pb.mat4().uniform(2);
    scope.$l.clipmapPos = pb.mul(scope.clipmapMatrix, pb.vec4(scope.$inputs.position, 1)).xy;
    //scope.$l.level = pb.mul(ShaderHelper.getWorldMatrix(scope), pb.vec4(0, 0, 0, 1)).y;
    scope.clipmapWorldPos = pb.mul(
      ShaderHelper.getWorldMatrix(scope),
      pb.vec4(scope.clipmapPos.x, 0, scope.clipmapPos.y, 1)
    ).xyz; // pb.vec3(scope.clipmapPos.x, scope.level, scope.clipmapPos.y);
    scope.worldNormal = pb.vec3(0, 1, 0);
    scope.worldPos = scope.clipmapWorldPos;
    this.waveGenerator?.calcVertexPositionAndNormal(
      scope,
      scope.clipmapWorldPos,
      scope.worldPos,
      scope.worldNormal
    );
    scope.$outputs.worldPos = scope.worldPos;
    scope.$outputs.clipmapPos = scope.clipmapWorldPos;
    scope.$outputs.worldNormal = scope.worldNormal;
    ShaderHelper.setClipSpacePosition(
      scope,
      pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.worldPos, 1))
    );
  }
  fragmentShader(scope: PBFunctionScope): void {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    this.waveGenerator?.setupUniforms(scope, 2);
    scope.region = pb.vec4().uniform(2);
    scope.displace = pb.float().uniform(2);
    scope.$l.discardable = pb.or(
      pb.any(pb.lessThan(scope.$inputs.worldPos.xz, scope.region.xy)),
      pb.any(pb.greaterThan(scope.$inputs.worldPos.xz, scope.region.zw))
    );
    scope.$if(scope.discardable, function () {
      pb.discard();
    });
    if (this.needFragmentColor()) {
      scope.$l.normal = this.waveGenerator
        ? this.waveGenerator.calcFragmentNormalAndFoam(
            scope,
            scope.$inputs.clipmapPos.xz,
            scope.$inputs.worldNormal
          )
        : scope.$inputs.worldNormal;
      scope.$l.outColor = pb.vec4(pb.add(pb.mul(scope.normal.xyz, 0.5), pb.vec3(0.5)), 1);
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
  waterShading(
    scope: PBInsideFunctionScope,
    worldPos: PBShaderExp,
    worldNormal: PBShaderExp,
    foamFactor: PBShaderExp
  ) {
    const pb = scope.$builder;
    pb.func('getPosition', [pb.vec2('uv'), pb.mat4('mat')], function () {
      this.$l.linearDepth = sampleLinearDepth(this, this.depthTex, this.uv, 0);
      this.$l.nonLinearDepth = pb.div(
        pb.sub(pb.div(this.cameraNearFar.x, this.linearDepth), this.cameraNearFar.y),
        pb.sub(this.cameraNearFar.x, this.cameraNearFar.y)
      );
      this.$l.clipSpacePos = pb.vec4(
        pb.sub(pb.mul(this.uv, 2), pb.vec2(1)),
        pb.sub(pb.mul(pb.clamp(this.nonLinearDepth, 0, 1), 2), 1),
        1
      );
      this.$l.wPos = pb.mul(this.mat, this.clipSpacePos);
      this.$return(pb.vec4(pb.div(this.wPos.xyz, this.wPos.w), this.linearDepth));
    });
    pb.func(
      'waterShading',
      [pb.vec3('worldPos'), pb.vec3('worldNormal'), pb.float('foamFactor')],
      function () {
        this.$l.screenUV = pb.div(pb.vec2(this.$builtins.fragCoord.xy), this.targetSize.xy);
        this.$l.dist = pb.length(pb.sub(this.worldPos, ShaderHelper.getCameraPosition(this)));
        this.$l.normalScale = pb.pow(pb.clamp(pb.div(100, this.dist), 0, 1), 2);
        this.$l.normal = pb.normalize(
          pb.mul(this.worldNormal, pb.vec3(this.normalScale, 1, this.normalScale))
        );
        this.$l.displacedTexCoord = pb.add(this.screenUV, pb.mul(this.normal.xz, this.displace));
        this.$l.wPos = this.getPosition(this.screenUV, this.invViewProj).xyz;
        this.$l.eyeVec = pb.sub(this.worldPos.xyz, this.cameraPos);
        this.$l.eyeVecNorm = pb.normalize(this.eyeVec);
        this.$l.depth = pb.length(pb.sub(this.wPos.xyz, this.worldPos));
        this.$l.viewPos = pb.mul(this.viewMatrix, pb.vec4(this.worldPos, 1)).xyz;
      }
    );
  }
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number): void {
    super.applyUniformValues(bindGroup, ctx, pass);
    bindGroup.setValue('clipmapMatrix', this._clipmapMatrix);
    bindGroup.setValue('region', this._region);
    bindGroup.setValue('displace', this._displace);
    if (this.waveGenerator) {
      this.waveGenerator.applyWaterBindGroup(bindGroup);
    }
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
