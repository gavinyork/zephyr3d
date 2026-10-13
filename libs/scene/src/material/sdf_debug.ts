import type { BindGroup, PBFunctionScope } from '@zephyr3d/device';
import { MeshMaterial } from './meshmaterial';
import { ShaderHelper } from './shader/helper';
import type { DrawContext } from '../render/drawable';

/**
 * Unlit material showing the scene's signed distance field where it is drawn:
 * warm outside geometry, cool inside, isolines every
 * {@link SDFDebugMaterial.isoSpacing} and a white line on the surface. On a
 * horizontal plane it shows a slice of the field; on a mesh it shows the field
 * on that surface. Magenta when the scene has no field for this draw (it is
 * off, or the device is WebGL2).
 *
 * @public
 */
export class SDFDebugMaterial extends MeshMaterial {
  private _isoSpacing: number;
  constructor() {
    super();
    this._isoSpacing = 0.25;
    this.cullMode = 'none';
  }
  /** World distance between isolines. */
  get isoSpacing() {
    return this._isoSpacing;
  }
  set isoSpacing(val: number) {
    val = Math.max(1e-3, val);
    if (val !== this._isoSpacing) {
      this._isoSpacing = val;
      this.uniformChanged();
    }
  }
  vertexShader(scope: PBFunctionScope) {
    super.vertexShader(scope);
    const pb = scope.$builder;
    scope.$l.oPos = ShaderHelper.resolveVertexPosition(scope);
    scope.$outputs.worldPos = pb.mul(ShaderHelper.getWorldMatrix(scope), pb.vec4(scope.oPos, 1)).xyz;
    ShaderHelper.setClipSpacePosition(
      scope,
      pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.worldPos, 1))
    );
  }
  fragmentShader(scope: PBFunctionScope) {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    if (!this.needFragmentColorInput()) {
      this.outputFragmentColor(scope, scope.$inputs.worldPos, null);
      return;
    }
    const hasSDF = ShaderHelper.declareSceneSDF(pb.getGlobalScope(), this.drawContext, 2);
    scope.isoSpacing = pb.float().uniform(2);
    if (!hasSDF) {
      this.outputFragmentColor(scope, scope.$inputs.worldPos, pb.vec4(1, 0, 1, 1));
      return;
    }
    scope.$l.d = ShaderHelper.sampleSceneSDF(scope, scope.$inputs.worldPos);
    // Brighter near the surface, fading out over a few metres
    scope.$l.fade = pb.exp(pb.neg(pb.mul(pb.abs(scope.d), 0.35)));
    scope.$l.base = pb.mix(
      pb.mix(pb.vec3(0.05, 0.12, 0.35), pb.vec3(0.25, 0.6, 1), scope.fade),
      pb.mix(pb.vec3(0.3, 0.12, 0.02), pb.vec3(1, 0.62, 0.2), scope.fade),
      pb.step(0, scope.d)
    );
    // Isolines one pixel wide whatever the zoom, from the screen derivative
    scope.$l.w = pb.max(pb.fwidth(scope.d), 1e-5);
    scope.$l.t = pb.div(scope.d, scope.isoSpacing);
    scope.$l.iso = pb.sub(
      1,
      pb.smoothStep(
        0,
        pb.div(pb.mul(scope.w, 1.5), scope.isoSpacing),
        pb.abs(pb.sub(pb.fract(pb.add(scope.t, 0.5)), 0.5))
      )
    );
    scope.$l.zero = pb.sub(1, pb.smoothStep(0, pb.mul(scope.w, 2.5), pb.abs(scope.d)));
    scope.$l.color = pb.mix(pb.mul(scope.base, pb.sub(1, pb.mul(scope.iso, 0.6))), pb.vec3(1), scope.zero);
    this.outputFragmentColor(scope, scope.$inputs.worldPos, pb.vec4(scope.color, 1));
  }
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number) {
    super.applyUniformValues(bindGroup, ctx, pass);
    if (this.needFragmentColorInput(ctx)) {
      bindGroup.setValue('isoSpacing', this._isoSpacing);
      ShaderHelper.applySceneSDF(bindGroup, ctx);
    }
  }
}
