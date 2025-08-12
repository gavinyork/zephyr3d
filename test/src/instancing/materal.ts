import type { BindGroup, PBFunctionScope } from '@zephyr3d/device';
import type { DrawContext } from '@zephyr3d/scene';
import { Application, MeshMaterial, ShaderHelper } from '@zephyr3d/scene';

export class LinearDepthMaterial extends MeshMaterial {
  private _screenSize: Int32Array<ArrayBuffer>;
  constructor() {
    super();
    this._screenSize = new Int32Array(2);
  }
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number): void {
    super.applyUniformValues(bindGroup, ctx, pass);
    if (this.needFragmentColor(ctx)) {
      const device = Application.instance.device;
      this._screenSize[0] = device.getDrawingBufferWidth();
      this._screenSize[1] = device.getDrawingBufferHeight();
      bindGroup.setValue('screenSize', this._screenSize);
      bindGroup.setTexture('linearDepthTex', ctx.linearDepthTexture);
    }
  }
  vertexShader(scope: PBFunctionScope): void {
    super.vertexShader(scope);
    const pb = scope.$builder;
    scope.$l.oPos = ShaderHelper.resolveVertexPosition(scope);
    scope.$outputs.worldPos = pb.mul(ShaderHelper.getWorldMatrix(scope), pb.vec4(scope.oPos, 1)).xyz;
    ShaderHelper.setClipSpacePosition(
      scope,
      pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.worldPos, 1))
    );
  }
  fragmentShader(scope: PBFunctionScope): void {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    if (this.needFragmentColor()) {
      scope.linearDepthTex = pb.tex2D().uniform(2);
      scope.screenSize = pb.ivec2().uniform(2);
      // scope.$l.uv = pb.div(scope.$builtins.fragCoord.xy, pb.vec2(scope.screenSize));
      // scope.$l.texelPos = pb.ivec2(pb.floor(pb.mul(scope.uv, pb.vec2(scope.screenSize))));
      scope.$l.linearDepth = pb.textureLoad(
        scope.linearDepthTex,
        pb.ivec2(scope.$builtins.fragCoord.xy),
        0
      ).r;
      this.outputFragmentColor(
        scope,
        scope.$inputs.worldPos,
        pb.vec4(pb.pow(pb.sub(1, scope.linearDepth), 8), 0, 0, 1)
      );
    } else {
      this.outputFragmentColor(scope, scope.$inputs.worldPos, null);
    }
  }
}
