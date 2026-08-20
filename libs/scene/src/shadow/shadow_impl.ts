import type {
  BindGroup,
  PBGlobalScope,
  PBInsideFunctionScope,
  PBShaderExp,
  RenderStateSet,
  TextureFormat
} from '@zephyr3d/device';
import type { ShadowMapParams, ShadowMapType, ShadowMode } from './shadowmapper';
import { REVERSE_Z, Vector4, type Nullable } from '@zephyr3d/base';
import { isDeviceDepthShadow } from '../shaders/shadow';
import { getDevice } from '../app/api';

/** @internal */
export function getShadowMapFarthestDepth(lightType: number) {
  return REVERSE_Z && isDeviceDepthShadow(lightType) ? 0 : 1;
}

/** @internal */
export function getPackedShadowMapClearColor(lightType: number) {
  // The RGBA8 decoder assigns the alpha channel a weight of 1, so the
  // normalized depth endpoints are represented by transparent/opaque black.
  return new Vector4(0, 0, 0, getShadowMapFarthestDepth(lightType));
}

/** @internal */
export abstract class ShadowImpl {
  protected _resourceDirty: boolean;
  constructor() {
    this._resourceDirty = true;
  }
  invalidateResource() {
    this._resourceDirty = true;
  }
  updateResources(shadowMapParams: ShadowMapParams) {
    this.doUpdateResources(shadowMapParams);
  }
  abstract getType(): ShadowMode;
  abstract getShadowMapBorder(shadowMapParams: ShadowMapParams): number;
  getShadowMapClearColor(shadowMapParams: ShadowMapParams) {
    const colorAttachment = shadowMapParams.shadowMapFramebuffer?.getColorAttachments()[0];
    // Empty texels must read as "farthest": under reverse-Z that is 0 for
    // device-encoded directional/rect maps, 1 for linear point/spot maps.
    const farthest = getShadowMapFarthestDepth(shadowMapParams.lightType);
    return colorAttachment
      ? colorAttachment.isFloatFormat()
        ? new Vector4(farthest, farthest, farthest, 1)
        : getPackedShadowMapClearColor(shadowMapParams.lightType)
      : null;
  }
  /**
   * Depth format for shadow maps rendered into a native depth attachment.
   *
   * Float depth everywhere except WebGL, where d24s8 is kept under
   * standard-Z (WebGL1 compatibility, no precision benefit anyway). Under
   * reverse-Z the WebGL2 float depth format is used so shadow maps share
   * the near-uniform precision distribution (full benefit with
   * EXT_clip_control active).
   * @internal
   */
  protected preferredShadowMapDepthFormat(): TextureFormat {
    const device = getDevice();
    return device.type !== 'webgl' ||
      (REVERSE_Z && device.getDeviceCaps().framebufferCaps.supportDepth32float)
      ? 'd32f'
      : 'd24s8';
  }
  abstract getParams(out?: Vector4): Vector4;
  /**
   * Number of geometry passes this implementation needs over the shadow casters.
   *
   * Almost every technique rasterises the casters once and post-processes the
   * result, which is what {@link postRenderShadowMap} is for - it runs after the
   * geometry is on the map and receives no scene state, so a blur or resolve
   * fits there but a second draw of the casters does not.
   *
   * Deep opacity maps do need that second draw: the first pass establishes the
   * frontmost depth per texel and the second accumulates transmittance in layers
   * measured from it, so the casters must be rasterised again with the first
   * pass's output already available. Returning a count above one makes
   * `ShadowMapper.render` repeat the draw, calling {@link beginGeometryPass}
   * before each one.
   *
   * @returns The number of passes; one unless overridden.
   */
  getGeometryPassCount(_shadowMapParams: ShadowMapParams): number {
    return 1;
  }
  /**
   * Whether this implementation can split a directional light into cascades.
   *
   * Cascades need one shadow map per split, which every depth-based technique
   * gets by rendering into array layers. A technique whose storage is already
   * spoken for - a deep opacity map packs layer depth and coverage into the one
   * texture the receiver is allowed to bind - has nowhere to put them, and asks
   * to be driven with a single split instead.
   *
   * @returns True unless overridden.
   */
  supportsCascades(): boolean {
    return true;
  }
  /**
   * Prepares state for the given geometry pass.
   *
   * Only called when {@link getGeometryPassCount} returns more than one. The
   * index is zero-based. Implementations that vary the emitted shader between
   * passes must fold the index into {@link getShaderHash} as well, since the
   * shadow pass keys its programs on that hash.
   *
   * @param shadowMapParams - Current shadow map state.
   * @param pass - Zero-based index of the geometry pass about to run.
   */
  beginGeometryPass(_shadowMapParams: ShadowMapParams, _pass: number): void {}
  /**
   * Last say on the render states a shadow caster is drawn with.
   *
   * Runs after the material has set up its own states, in the same spirit as the
   * OIT hook on the transparent pass. Techniques that rasterise the casters once
   * want the defaults - depth test and write on, no blending - and leave this
   * alone. An accumulating pass wants the opposite and overrides it here rather
   * than teaching the material about shadow implementations.
   *
   * @param shadowMapParams - Current shadow map state.
   * @param stateSet - The state set about to be applied, already populated.
   */
  setCasterRenderStates(_shadowMapParams: ShadowMapParams, _stateSet: RenderStateSet): void {}
  /**
   * Declares any extra resources the caster shader needs, in bind group 0.
   *
   * The shadow map pass otherwise gives a caster only the camera and the light,
   * which is all a technique needs when it just records depth. One that reads
   * back its own earlier output - a deep opacity map measuring layers from the
   * frontmost strand - declares that input here instead of the pass hard-coding
   * knowledge of the implementation.
   *
   * @param scope - Global shader scope of the caster program.
   * @param shadowMapParams - Current shadow map state.
   */
  declareCasterUniforms(_scope: PBGlobalScope, _shadowMapParams: ShadowMapParams): void {}
  /**
   * Binds whatever {@link declareCasterUniforms} declared.
   *
   * @param bindGroup - Bind group 0 of the caster program.
   * @param shadowMapParams - Current shadow map state.
   */
  applyCasterUniforms(_bindGroup: BindGroup, _shadowMapParams: ShadowMapParams): void {}
  /**
   * Whether casters should still be alpha-clipped before their shadow output.
   *
   * A depth-recording technique wants the clip: a fragment that fails it is not
   * there, and letting it write depth would block light with geometry the eye
   * never sees. A technique that records coverage instead wants the raw alpha,
   * because the clip destroys exactly the quantity it is accumulating - a
   * dithered caster survives with probability alpha and then contributes alpha,
   * which accumulates alpha squared, and a cutoff drops the thin strands that
   * carry most of a groom's transmittance.
   *
   * @param shadowMapParams - Current shadow map state.
   * @returns True unless overridden.
   */
  clipsCasterAlpha(_shadowMapParams: ShadowMapParams): boolean {
    return true;
  }
  abstract getShadowMap(shadowMapParams: ShadowMapParams): ShadowMapType;
  abstract postRenderShadowMap(shadowMapParams: ShadowMapParams): void;
  abstract getDepthScale(): number;
  abstract setDepthScale(val: number): void;
  abstract resourceDirty(): boolean;
  abstract doUpdateResources(shadowMapParams: ShadowMapParams): void;
  abstract getShaderHash(): string;
  /**
   * Fragment output for a shadow caster.
   *
   * @param shadowMapParams - Current shadow map state.
   * @param scope - Caster fragment scope.
   * @param worldPos - World position of the fragment.
   * @param alpha - The material's own alpha, or null when it computes no fragment
   * colour and the fragment is therefore fully opaque. Depth-recording techniques
   * ignore it - by the time this runs the fragment has already survived whatever
   * alpha test applies - but one that records absorption needs the value itself.
   * It must be passed rather than read out of `scope`, because the caller's
   * `outColor` is local to the material's own shader function and defaults to a
   * zero vector when no colour was computed, which is indistinguishable from a
   * genuinely transparent fragment.
   */
  abstract computeShadowMapDepth(
    shadowMapParams: ShadowMapParams,
    scope: PBInsideFunctionScope,
    worldPos: PBShaderExp,
    alpha: Nullable<PBShaderExp>
  ): PBShaderExp;
  abstract computeShadow(
    shadowMapParams: ShadowMapParams,
    scope: PBInsideFunctionScope,
    shadowVertex: PBShaderExp,
    NdotL: PBShaderExp
  ): PBShaderExp;
  abstract computeShadowCSM(
    shadowMapParams: ShadowMapParams,
    scope: PBInsideFunctionScope,
    shadowVertex: PBShaderExp,
    NdotL: PBShaderExp,
    split: PBShaderExp
  ): PBShaderExp;
  abstract getShadowMapColorFormat(shadowMapParams: ShadowMapParams): Nullable<TextureFormat>;
  abstract getShadowMapDepthFormat(shadowMapParams: ShadowMapParams): TextureFormat;
  abstract useNativeShadowMap(shadowMapParams: ShadowMapParams): boolean;
}
