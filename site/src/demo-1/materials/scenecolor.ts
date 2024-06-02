import { Vector2 } from '@zephyr3d/base';
import type { BindGroup, PBFunctionScope } from '@zephyr3d/device';
import type { DrawContext } from '@zephyr3d/scene';
import { MeshMaterial, ShaderHelper, applyMaterialMixins, mixinLambert } from '@zephyr3d/scene';

export class SceneColorMaterial extends applyMaterialMixins(MeshMaterial, mixinLambert) {
  constructor() {
    super();
  }
  needSceneColor(): boolean {
    return true;
  }
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number): void {
    super.applyUniformValues(bindGroup, ctx, pass);
    if (this.needFragmentColor(ctx)) {
      bindGroup.setTexture('sceneColorTex', ctx.sceneColorTexture);
    }
  }
  vertexShader(scope: PBFunctionScope): void {
    super.vertexShader(scope);
    const pb = scope.$builder;
    scope.$l.oPos = ShaderHelper.resolveVertexPosition(scope);
    scope.$outputs.worldPos = pb.mul(ShaderHelper.getWorldMatrix(scope), pb.vec4(scope.oPos, 1)).xyz;
    scope.$l.csPos = pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.worldPos, 1));
    ShaderHelper.setClipSpacePosition(scope, scope.csPos);
    scope.$l.oNorm = ShaderHelper.resolveVertexNormal(scope);
    scope.$outputs.wNorm = pb.mul(ShaderHelper.getNormalMatrix(scope), pb.vec4(scope.oNorm, 0)).xyz;
    scope.$outputs.screenUV = pb.add(pb.mul(pb.div(scope.csPos.xy, scope.csPos.w), 0.5), pb.vec2(0.5));
    scope.$outputs.oPos = scope.oPos;
  }
  fragmentShader(scope: PBFunctionScope): void {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    if (this.needFragmentColor()) {
      scope.sceneColorTex = pb.tex2D().uniform(2);
      scope.$l.albedo = pb.textureSample(scope.sceneColorTex, scope.$inputs.screenUV);
      scope.albedo = pb.mul(scope.albedo, pb.vec4(1, 0.5, 0.5, 1));
      scope.$l.normal = this.calculateNormal(scope, scope.$inputs.worldPos, scope.$inputs.wNorm);
      scope.$l.litColor = this.lambertLight(scope, scope.$inputs.worldPos, scope.normal, scope.albedo);
      this.outputFragmentColor(scope, scope.$inputs.worldPos, pb.vec4(scope.litColor, scope.albedo.a));
    } else {
      this.outputFragmentColor(scope, scope.$inputs.worldPos, null);
    }
  }
}
