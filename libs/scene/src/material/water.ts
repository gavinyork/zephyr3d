import { BindGroup, PBFunctionScope, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { MeshMaterial } from './meshmaterial';
import { DrawContext, GerstnerWaveGenerator, WaveGenerator } from '../render';
import { Ref } from '../app';
import { MaterialVaryingFlags } from '../values';

export class WaterMaterial extends MeshMaterial {
  private static FEATURE_SSR = this.defineFeature();
  private _waveGenerator: Ref<WaveGenerator>;
  constructor() {
    super();
    this._waveGenerator = new Ref(new GerstnerWaveGenerator());
    this.useFeature(WaterMaterial.FEATURE_SSR, true);
  }
  get SSR() {
    return this.featureUsed<boolean>(WaterMaterial.FEATURE_SSR);
  }
  set SSR(val: boolean) {
    this.useFeature(WaterMaterial.FEATURE_SSR, !!val);
  }
  supportInstancing(): boolean {
    return false;
  }
  supportLighting(): boolean {
    return false;
  }
  vertexShader(scope: PBFunctionScope): void {
    super.vertexShader(scope);
    const that = this;
    const pb = scope.$builder;
    scope.$outputs.outPos = pb.vec3();
    scope.$outputs.outNormal = pb.vec3();
    scope.$outputs.outXZ = pb.vec2();
    scope.modelMatrix = pb.mat4().uniform(2);
    scope.gridScale = pb.float().uniform(2);
    scope.level = pb.float().uniform(2);
    scope.offset = pb.vec2().uniform(2);
    scope.scale = pb.float().uniform(2);
    that._waveGenerator.get().setupUniforms(pb.getGlobalScope());
    pb.main(function () {
      this.$l.xz = pb.mul(
        pb.add(
          this.offset,
          pb.mul(pb.mul(this.modelMatrix, pb.vec4(this.$inputs.position, 1)).xy, this.scale)
        ),
        this.gridScale
      );
      this.$l.outPos = pb.vec3();
      this.$l.outNormal = pb.vec3();
      that._waveGenerator
        .get()
        .calcVertexPositionAndNormal(
          this,
          pb.vec3(this.xz.x, this.level, this.xz.y),
          this.outPos,
          this.outNormal
        );
      this.$outputs.outPos = this.outPos;
      this.$outputs.outNormal = this.outNormal;
      this.$outputs.outXZ = this.xz;
      this.$builtins.position = pb.mul(this.viewProjMatrix, pb.vec4(this.$outputs.outPos, 1));
    });
  }
  fragmentShader(scope: PBFunctionScope): void {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    scope.pos = pb.vec3().uniform(2);
    scope.region = pb.vec4().uniform(2);
    scope.$l.discardable = pb.or(
      pb.any(pb.lessThan(scope.$inputs.outXZ, scope.region.xy)),
      pb.any(pb.greaterThan(scope.$inputs.outXZ, scope.region.zw))
    );
    scope.$if(scope.discardable, function () {
      pb.discard();
    });
    if (this.needFragmentColor()) {
      this._waveGenerator.get().setupUniforms(scope);
      scope.$l.n = this._waveGenerator
        .get()
        .calcFragmentNormalAndFoam(scope, scope.$inputs.outXZ, scope.$inputs.outNormal);
      scope.$l.outColor =
        this.shading(scope, scope.$inputs.outPos, scope.n.xyz, scope.n.w, scope.discardable) ??
        pb.vec4(pb.add(pb.mul(scope.n.xyz, 0.5), pb.vec3(0.5)), 1);
      if (this.drawContext.materialFlags & MaterialVaryingFlags.SSR_STORE_ROUGHNESS) {
        scope.$l.outRoughness = pb.vec4(1, 1, 1, 0);
        this.outputFragmentColor(
          scope,
          scope.$inputs.outPos,
          pb.vec4(scope.outColor.rgb, 1),
          scope.outRoughness,
          pb.vec4(pb.add(pb.mul(scope.n.xyz, 0.5), pb.vec3(0.5)), 1)
        );
      } else {
        this.outputFragmentColor(scope, scope.$inputs.outPos, pb.vec4(scope.outColor.rgb, 1));
      }
    } else {
      this.outputFragmentColor(scope, scope.$inputs.outPos, null);
    }
  }
  shading(
    scope: PBInsideFunctionScope,
    worldPos: PBShaderExp,
    worldNormal: PBShaderExp,
    foamFactor: PBShaderExp,
    discardable: PBShaderExp
  ) {
    const pb = scope.$builder;
    return pb.add(pb.mul(worldNormal.xyz, 0.5), pb.vec3(0.5));
  }
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number): void {
    super.applyUniformValues(bindGroup, ctx, pass);
  }
}
