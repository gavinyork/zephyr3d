import type { PBInsideFunctionScope, PBShaderExp, TextureFormat, TextureSampler } from '@zephyr3d/device';
import type { ShadowMapParams, ShadowMapType, ShadowMode } from './shadowmapper';

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
  abstract getShadowMap(shadowMapParams: ShadowMapParams): ShadowMapType;
  abstract postRenderShadowMap(shadowMapParams: ShadowMapParams);
  abstract getDepthScale(): number;
  abstract setDepthScale(val: number);
  abstract resourceDirty(): boolean;
  abstract doUpdateResources(shadowMapParams: ShadowMapParams);
  abstract getShaderHash(): string;
  abstract releaseTemporalResources(shadowMapParams: ShadowMapParams);
  abstract computeShadowMapDepth(shadowMapParams: ShadowMapParams, scope: PBInsideFunctionScope): PBShaderExp;
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
  abstract getShadowMapColorFormat(shadowMapParams: ShadowMapParams): TextureFormat;
  abstract getShadowMapDepthFormat(shadowMapParams: ShadowMapParams): TextureFormat;
  abstract useNativeShadowMap(shadowMapParams: ShadowMapParams): boolean;
}
