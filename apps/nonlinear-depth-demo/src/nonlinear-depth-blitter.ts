import { Blitter } from '@zephyr3d/scene';
import type { BlitType } from '@zephyr3d/scene';
import { Vector2 } from '@zephyr3d/base';
import type {
  BindGroup,
  PBShaderExp,
  PBInsideFunctionScope,
  PBGlobalScope
} from '@zephyr3d/device';

/**
 * Visualizes the RAW, non-linear depth buffer as grayscale.
 *
 * Unlike the linear-depth demo, this blitter samples the scene's actual
 * depth-stencil attachment (`FrameResources.SceneDepthAttachment`) and displays
 * the hardware z value directly — no linearization, and no re-deriving it from
 * the linear-depth texture. The result is the familiar hyperbolic distribution:
 * precision is packed near the camera, so almost the entire scene reads as
 * near-white (values close to 1) with only very close surfaces showing any
 * gradient.
 *
 * The depth attachment is a depth texture, so its red channel holds the
 * non-linear NDC depth in `[0, 1]` (WebGL2). A `[windowNear, windowFar]` window
 * plus a `gamma` curve remap that range so the crushed near field is at least
 * inspectable.
 *
 * Implemented entirely against the public `Blitter` API.
 */
export class NonLinearDepthBlitter extends Blitter {
  // Packs [windowNear, windowFar] window; gamma is separate for clarity.
  private _window: Vector2;
  private _gamma: number;

  constructor() {
    super();
    this._window = new Vector2(0, 1);
    this._gamma = 1;
  }

  /** Near end of the NDC-depth window mapped to black (0..1). */
  get windowNear(): number {
    return this._window.x;
  }
  set windowNear(val: number) {
    this._window.x = val;
  }

  /** Far end of the NDC-depth window mapped to white (0..1). */
  get windowFar(): number {
    return this._window.y;
  }
  set windowFar(val: number) {
    this._window.y = val;
  }

  /** Contrast curve applied to the remapped depth. */
  get gamma(): number {
    return this._gamma;
  }
  set gamma(val: number) {
    if (this._gamma !== val) {
      this._gamma = val;
      this.invalidateHash();
    }
  }

  setup(scope: PBGlobalScope, _type: BlitType) {
    const pb = scope.$builder;
    if (pb.shaderKind === 'fragment') {
      scope.depthWindow = pb.vec2().uniform(0);
    }
  }

  setUniforms(bindGroup: BindGroup) {
    bindGroup.setValue('depthWindow', this._window);
  }

  filter(
    scope: PBInsideFunctionScope,
    type: BlitType,
    srcTex: PBShaderExp,
    srcUV: PBShaderExp,
    srcLayer: PBShaderExp,
    sampleType: 'float' | 'int' | 'uint'
  ): PBShaderExp {
    const pb = scope.$builder;
    // Sample the raw depth texture. Its red channel is the non-linear NDC depth.
    const texel = this.readTexel(scope, type, srcTex, srcUV, srcLayer, sampleType);
    scope.$l.raw = texel.r;
    scope.$l.wNear = scope.depthWindow.x;
    scope.$l.wFar = scope.depthWindow.y;
    scope.$l.norm = pb.clamp(
      pb.div(pb.sub(scope.raw, scope.wNear), pb.max(pb.sub(scope.wFar, scope.wNear), 0.0001)),
      0,
      1
    );
    // Near = black, far = white, matching the linear demo's convention.
    scope.$l.gray = pb.pow(scope.norm, pb.float(this._gamma));
    return pb.vec4(scope.gray, scope.gray, scope.gray, 1);
  }

  protected calcHash(): string {
    return `${this._gamma}`;
  }
}
