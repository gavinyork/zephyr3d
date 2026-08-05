import type { PBInsideFunctionScope, PBShaderExp, TextureFormat } from '@zephyr3d/device';
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
  abstract getShadowMap(shadowMapParams: ShadowMapParams): ShadowMapType;
  abstract postRenderShadowMap(shadowMapParams: ShadowMapParams): void;
  abstract getDepthScale(): number;
  abstract setDepthScale(val: number): void;
  abstract resourceDirty(): boolean;
  abstract doUpdateResources(shadowMapParams: ShadowMapParams): void;
  abstract getShaderHash(): string;
  abstract computeShadowMapDepth(
    shadowMapParams: ShadowMapParams,
    scope: PBInsideFunctionScope,
    worldPos: PBShaderExp
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
