import { Vector4 } from '@zephyr3d/base';
import type { BindGroup, PBFunctionScope, RenderStateSet } from '@zephyr3d/device';
import { ShaderHelper, UnlitMaterial } from '@zephyr3d/scene';
import type { DrawContext } from '@zephyr3d/scene';

/**
 * Unlit inverted-hull material used by the outline pass.
 *
 * Vertices are displaced along their animated object-space normals. Front-face culling then keeps
 * only the expanded back faces, while the scene depth hides the hull interior and occluded parts.
 */
export class OutlineMaterial extends UnlitMaterial {
  private _outlineWidth: number;

  constructor() {
    super();
    this._outlineWidth = 0.08;
    this.albedoColor = new Vector4(1, 0.55, 0.05, 1);
    this.cullMode = 'front';
  }

  /** Outline thickness in object-space units. */
  get outlineWidth(): number {
    return this._outlineWidth;
  }

  set outlineWidth(value: number) {
    const width = Math.max(0, value);
    if (width !== this._outlineWidth) {
      this._outlineWidth = width;
      this.uniformChanged();
    }
  }

  protected updateRenderStates(pass: number, stateSet: RenderStateSet, ctx: DrawContext): void {
    super.updateRenderStates(pass, stateSet, ctx);
    stateSet.useDepthState().enableTest(true).enableWrite(false).setCompareFunc('le');
  }

  vertexShader(scope: PBFunctionScope): void {
    super.vertexShader(scope);
    const pb = scope.$builder;
    scope.outlineWidth = pb.float().uniform(2);

    // resolveVertexPosition/Normal include morph and skin deformation. The ProxyDrawable supplies
    // the host mesh's primitive, morph targets, bone matrices, and world transform.
    scope.$l.outlineNormal = ShaderHelper.resolveVertexNormal(scope);
    scope.$l.outlinePosition = pb.add(
      scope.oPos,
      pb.mul(pb.normalize(scope.outlineNormal), scope.outlineWidth)
    );
    scope.$outputs.worldPos = pb.mul(
      ShaderHelper.getWorldMatrix(scope),
      pb.vec4(scope.outlinePosition, 1)
    ).xyz;
    ShaderHelper.setClipSpacePosition(
      scope,
      pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.worldPos, 1))
    );
  }

  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number): void {
    super.applyUniformValues(bindGroup, ctx, pass);
    bindGroup.setValue('outlineWidth', this._outlineWidth);
  }
}
