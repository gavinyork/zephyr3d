import { Blitter, ShaderHelper } from '@zephyr3d/scene';
import type { BlitType } from '@zephyr3d/scene';
import { Vector4 } from '@zephyr3d/base';
import type {
  BindGroup,
  PBShaderExp,
  PBInsideFunctionScope,
  PBGlobalScope
} from '@zephyr3d/device';

/**
 * A small user-authored blitter that turns the engine's linear-depth texture
 * into a grayscale image.
 *
 * `FrameResources.LinearDepth` stores **normalized** linear depth in `[0, 1]`
 * (`near / z`), and on the WebGL backend it is RGBA8-packed rather than stored
 * in a single float channel. Reading `.r` directly is therefore wrong on WebGL
 * and unscaled everywhere. This blitter uses the engine's public
 * {@link ShaderHelper.sampleLinearDepth}, which decodes the value correctly per
 * backend and returns normalized linear depth.
 *
 * Because most scene geometry clusters in a thin slice of `[0, 1]`, a straight
 * mapping looks washed-out. So the blitter remaps a configurable
 * `[windowNear, windowFar]` sub-range (in normalized depth) across the full
 * grayscale range and applies a `gamma` power curve for extra contrast.
 *
 * It is deliberately implemented entirely against the public API to show that
 * the depth-visualization feature needs no engine internals.
 */
export class DepthGrayscaleBlitter extends Blitter {
  // Packs [windowNear, windowFar, gamma, unused] into one uniform.
  private _params: Vector4;

  constructor() {
    super();
    this._params = new Vector4(0, 0.35, 0.6, 0);
  }

  /** Near end of the normalized-depth window mapped to black (0..1). */
  get windowNear(): number {
    return this._params.x;
  }
  set windowNear(val: number) {
    this._params.x = val;
  }

  /** Far end of the normalized-depth window mapped to white (0..1). */
  get windowFar(): number {
    return this._params.y;
  }
  set windowFar(val: number) {
    this._params.y = val;
  }

  /**
   * Contrast curve. `< 1` expands the near field (more contrast up close), `1`
   * is linear, `> 1` compresses the near field.
   */
  get gamma(): number {
    return this._params.z;
  }
  set gamma(val: number) {
    this._params.z = val;
  }

  setup(scope: PBGlobalScope, _type: BlitType) {
    const pb = scope.$builder;
    if (pb.shaderKind === 'fragment') {
      scope.depthParams = pb.vec4().uniform(0);
    }
  }

  setUniforms(bindGroup: BindGroup) {
    bindGroup.setValue('depthParams', this._params);
  }

  filter(
    scope: PBInsideFunctionScope,
    _type: BlitType,
    srcTex: PBShaderExp,
    srcUV: PBShaderExp,
    _srcLayer: PBShaderExp,
    _sampleType: 'float' | 'int' | 'uint'
  ): PBShaderExp {
    const pb = scope.$builder;
    // Public helper: decodes the linear-depth texture correctly per backend
    // (WebGL RGBA-unpack vs. float .r) and returns normalized depth in [0,1].
    scope.$l.d = ShaderHelper.sampleLinearDepth(scope, srcTex, srcUV, 0);
    scope.$l.wNear = scope.depthParams.x;
    scope.$l.wFar = scope.depthParams.y;
    scope.$l.gamma = scope.depthParams.z;
    // Remap the [windowNear, windowFar] sub-range across [0,1].
    scope.$l.norm = pb.clamp(
      pb.div(pb.sub(scope.d, scope.wNear), pb.max(pb.sub(scope.wFar, scope.wNear), 0.0001)),
      0,
      1
    );
    // Near = black, far = white, with a gamma curve for contrast.
    scope.$l.gray = pb.pow(scope.norm, scope.gamma);
    return pb.vec4(scope.gray, scope.gray, scope.gray, 1);
  }

  protected calcHash(): string {
    return '';
  }
}
