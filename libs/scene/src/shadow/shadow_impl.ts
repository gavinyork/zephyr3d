import type { PBInsideFunctionScope, PBShaderExp, TextureFormat } from '@zephyr3d/device';
import type { ShadowMapParams, ShadowMapType, ShadowMode } from './shadowmapper';
import { Vector4, type Nullable } from '@zephyr3d/base';

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
    return colorAttachment
      ? colorAttachment.isFloatFormat()
        ? new Vector4(1, 1, 1, 1)
        : new Vector4(0, 0, 0, 1)
      : null;
  }
  abstract getParams(out: Vector4): void;
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
