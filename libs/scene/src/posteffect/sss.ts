import { DEPTH_COMPARE_FARTHER, DEPTH_FARTHEST, Matrix4x4, Vector2, Vector4, type Nullable } from '@zephyr3d/base';
import type { BindGroup, FrameBuffer, GPUProgram, Texture2D } from '@zephyr3d/device';
import type { SSSResolvedSettings } from '../camera';
import type { DrawContext } from '../render';
import { ShaderHelper } from '../material';
import { SubsurfaceProfile } from '../material/subsurfaceprofile';
import type { PunctualLight } from '../scene';
import { LIGHT_TYPE_DIRECTIONAL, LIGHT_TYPE_POINT, LIGHT_TYPE_RECT, LIGHT_TYPE_SPOT } from '../values';
import { linearToGamma } from '../shaders/misc';
import { fetchSampler } from '../utility/misc';
import { AbstractPostEffect, PostEffectLayer } from './posteffect';

/**
 * Screen-space subsurface scattering post effect.
 *
 * @remarks
 * Uses a depth/normal-aware separable blur driven by per-pixel SSS profiles
 * written by skin materials during the main shading pass.
 *
 * @internal
 */
export class SSS extends AbstractPostEffect {
  private static readonly _profileLUTWidth = 256;
  private static readonly _profileLUTHeight = 7;
  private static readonly _profileRadiusEncodeMax = 8;
  private static readonly _profileWorldScaleEncodeMax = 4;
  private static readonly _profileNormalScaleEncodeMax = 2;
  private static readonly _profileExtinctionEncodeMax = 4;
  private static readonly _debugViewMap: Record<string, number> = {
    none: 0,
    scatter_mask: 1,
    scatter_softness: 2,
    scatter_radius: 3,
    scatter_falloff: 4,
    profile_energy: 5,
    profile_transmission: 6,
    profile_boundary: 7,
    diffuse: 8,
    blur: 9,
    screen_thinness: 10,
    thin_transmission_mask: 11,
    thin_lighting: 12,
    transmission_shadow: 13
  };
  private static _blurPrograms: Record<string, GPUProgram> = {};
  private static _combinePrograms: Record<string, GPUProgram> = {};
  private static _profileLUT: Nullable<Texture2D> = null;
  private static _profileLUTVersion = -1;
  private _blurBindGroups: Record<string, BindGroup>;
  private _combineBindGroups: Record<string, BindGroup>;

  constructor() {
    super();
    this._layer = PostEffectLayer.opaque;
    this._blurBindGroups = {};
    this._combineBindGroups = {};
  }

  private static profileRowV(row: number) {
    return (row + 0.5) / SSS._profileLUTHeight;
  }

  private getCombineShadowLight(ctx: DrawContext): Nullable<PunctualLight> {
    const shadowMapInfo = ctx.shadowMapInfo;
    if (!shadowMapInfo) {
      return null;
    }
    const mainDirectionalLight = ctx.sunLight ?? ctx.primaryDirectionalLight;
    if (mainDirectionalLight && shadowMapInfo.has(mainDirectionalLight)) {
      return mainDirectionalLight;
    }
    return null;
  }

  /**
   * Whether the combine pass should read the screen-space shadow mask for the
   * combine light instead of recomputing its shadow. Enabled when the camera
   * renders the mask and the combine light was actually written into it: the
   * mask already holds the identical shadow — same shadow impl (PCSS/VSM/…),
   * distance fade and shadowStrength — so this skips a full redundant per-pixel
   * shadow evaluation. Shadow mode is irrelevant: the mask is rendered with the
   * light's own impl. Falls back to the inline path when the light is not in the
   * mask (e.g. it overflows {@link MAX_SHADOW_MASK_LIGHTS}).
   *
   * Only valid at execute time, after the ShadowMaps and ShadowMask passes have
   * populated shadowMapInfo / maskOrdinal.
   */
  private useCombineShadowMask(ctx: DrawContext, shadowLight: Nullable<PunctualLight>): boolean {
    if (!shadowLight || !ctx.screenSpaceShadowMask) {
      return false;
    }
    const shadowMapParams = ctx.shadowMapInfo?.get(shadowLight);
    return !!(shadowMapParams?.shadowMap && shadowMapParams.impl && shadowMapParams.maskOrdinal != null);
  }

  private getCombineProgramKey(ctx: DrawContext, shadowLight: Nullable<PunctualLight>) {
    const shadowMapParams = shadowLight ? ctx.shadowMapInfo?.get(shadowLight) : null;
    if (!shadowMapParams?.shaderHash) {
      return 'default';
    }
    // The mask-sampling shader is independent of the PCSS impl hash.
    return this.useCombineShadowMask(ctx, shadowLight)
      ? 'shadowMask'
      : `shadow:${shadowMapParams.shaderHash}`;
  }

  requireLinearDepthTexture() {
    return true;
  }

  requireDepthAttachment() {
    return true;
  }

  requireSceneNormalTexture() {
    return true;
  }

  requireShadowMask(ctx: DrawContext) {
    // Runs at graph-build time, before shadowMapInfo is populated (that happens
    // during the ShadowMaps pass execute), so it cannot inspect the combine
    // light. Keep the mask alive whenever the camera renders it; combine()
    // decides at execute time whether to sample it, and _setupFromApply only
    // reads the handle when the mask was actually produced this frame.
    return !!ctx.screenSpaceShadowMask;
  }

  apply(ctx: DrawContext, inputColorTexture: Texture2D, sceneDepthTexture: Texture2D, srgbOutput: boolean) {
    const device = ctx.device;
    const outputFramebuffer = device.getFramebuffer();
    const sssSettings = ctx.camera.sssResolvedSettings;
    if (
      !ctx.SSS ||
      !ctx.SSSProfileTexture ||
      !ctx.SSSParamTexture ||
      ctx.camera.sssStrength <= 0 ||
      (ctx.camera.sssBlurScale <= 0 && ctx.camera.sssTransmissionStrength <= 0)
    ) {
      this.passThrough(ctx, inputColorTexture, srgbOutput);
      return;
    }
    const kernelRadius = (Math.max(1, sssSettings.blurKernelSize >> 0) - 1) >> 1;
    const blurEnabled = ctx.camera.sssBlurScale > 0 && kernelRadius > 0;
    const profileLUT = this.ensureProfileLUT(ctx);
    const inputScatterTexture = ctx.SSSDiffuseTexture ?? inputColorTexture;
    const blurWidth =
      blurEnabled && sssSettings.halfRes
        ? Math.max(1, Math.ceil(inputScatterTexture.width * 0.5))
        : inputScatterTexture.width;
    const blurHeight =
      blurEnabled && sssSettings.halfRes
        ? Math.max(1, Math.ceil(inputScatterTexture.height * 0.5))
        : inputScatterTexture.height;
    let blurredTexture = inputScatterTexture;
    let blurFramebufferH: Nullable<FrameBuffer> = null;
    let blurFramebufferV: Nullable<FrameBuffer> = null;
    if (blurEnabled) {
      blurFramebufferH = device.pool.fetchTemporalFramebuffer(
        false,
        blurWidth,
        blurHeight,
        inputScatterTexture.format,
        null,
        false
      );
      blurFramebufferV = device.pool.fetchTemporalFramebuffer(
        false,
        blurWidth,
        blurHeight,
        inputScatterTexture.format,
        null,
        false
      );
      device.setFramebuffer(blurFramebufferH);
      this.blur(
        ctx,
        inputScatterTexture,
        sceneDepthTexture,
        profileLUT,
        blurWidth,
        blurHeight,
        kernelRadius,
        true,
        sssSettings
      );
      device.setFramebuffer(blurFramebufferV);
      this.blur(
        ctx,
        blurFramebufferH.getColorAttachments()[0] as Texture2D,
        sceneDepthTexture,
        profileLUT,
        blurWidth,
        blurHeight,
        kernelRadius,
        false,
        sssSettings
      );
      blurredTexture = blurFramebufferV.getColorAttachments()[0] as Texture2D;
    }
    device.setFramebuffer(outputFramebuffer);
    // The SSS combine pass only rewrites pixels that pass the foreground depth test.
    // Preserve the current scene color first so sky/image backgrounds are not left
    // uninitialized when no geometry-backed pixel is written by the combine pass.
    this.passThrough(ctx, inputColorTexture, srgbOutput);
    this.combine(ctx, inputColorTexture, blurredTexture, sceneDepthTexture, profileLUT, srgbOutput);
    if (blurFramebufferH) {
      device.pool.releaseFrameBuffer(blurFramebufferH);
    }
    if (blurFramebufferV) {
      device.pool.releaseFrameBuffer(blurFramebufferV);
    }
  }

  private blur(
    ctx: DrawContext,
    inputColorTexture: Texture2D,
    sceneDepthTexture: Texture2D,
    profileLUT: Texture2D,
    targetWidth: number,
    targetHeight: number,
    kernelRadius: number,
    horizontal: boolean,
    sssSettings: Readonly<SSSResolvedSettings>
  ) {
    const device = ctx.device;
    const sssNormalTexture = ctx.SceneNormalTexture ?? ctx.SSSParamTexture!;
    const hasNormalTexture = !!ctx.SceneNormalTexture;
    const key = `${horizontal ? 'h' : 'v'}:${kernelRadius}`;
    let program = SSS._blurPrograms[key];
    if (!program) {
      program = this.createBlurProgram(ctx, kernelRadius, horizontal);
      SSS._blurPrograms[key] = program;
    }
    let bindGroup = this._blurBindGroups[key];
    if (!bindGroup) {
      bindGroup = device.createBindGroup(program.bindGroupLayouts[0]);
      this._blurBindGroups[key] = bindGroup;
    }
    bindGroup.setTexture('colorTex', inputColorTexture, fetchSampler('clamp_linear'));
    bindGroup.setTexture('profileTex', ctx.SSSProfileTexture!, fetchSampler('clamp_nearest_nomip'));
    bindGroup.setTexture('paramTex', ctx.SSSParamTexture!, fetchSampler('clamp_nearest_nomip'));
    bindGroup.setTexture('profileLUTTex', profileLUT, fetchSampler('clamp_nearest_nomip'));
    bindGroup.setTexture('normalTex', sssNormalTexture, fetchSampler('clamp_nearest_nomip'));
    bindGroup.setTexture('depthTex', sceneDepthTexture, fetchSampler('clamp_nearest_nomip'));
    bindGroup.setValue('cameraNearFar', new Vector2(ctx.camera.getNearPlane(), ctx.camera.getFarPlane()));
    bindGroup.setValue('targetSize', new Vector4(targetWidth, targetHeight, targetWidth, targetHeight));
    bindGroup.setValue('sampleOffsets', this.createSampleOffsets(kernelRadius));
    bindGroup.setValue('blurScale', ctx.camera.sssBlurScale);
    bindGroup.setValue('blurStdDev', sssSettings.blurStdDev);
    bindGroup.setValue('depthCutoff', sssSettings.blurDepthCutoff);
    bindGroup.setValue('normalCutoff', sssSettings.normalCutoff);
    bindGroup.setValue('hasNormalTex', hasNormalTexture ? 1 : 0);
    bindGroup.setValue('flip', this.needFlip(device) ? 1 : 0);
    device.setProgram(program);
    device.setBindGroup(0, bindGroup);
    this.drawFullscreenQuad();
  }

  private combine(
    ctx: DrawContext,
    inputColorTexture: Texture2D,
    blurredTexture: Texture2D,
    sceneDepthTexture: Texture2D,
    profileLUT: Texture2D,
    srgbOutput: boolean
  ) {
    const device = ctx.device;
    const sssRoughnessTexture = ctx.SceneRoughnessTexture ?? ctx.SSSParamTexture!;
    const sssNormalTexture = ctx.SceneNormalTexture ?? ctx.SSSParamTexture!;
    const hasRoughnessTexture = !!ctx.SceneRoughnessTexture;
    const hasNormalTexture = !!ctx.SceneNormalTexture;
    const shadowLight = this.getCombineShadowLight(ctx);
    const programKey = this.getCombineProgramKey(ctx, shadowLight);
    let program = SSS._combinePrograms[programKey];
    if (!program) {
      program = this.createCombineProgram(ctx, shadowLight);
      SSS._combinePrograms[programKey] = program;
    }
    let bindGroup = this._combineBindGroups[programKey];
    if (!bindGroup) {
      bindGroup = device.createBindGroup(program.bindGroupLayouts[0]);
      this._combineBindGroups[programKey] = bindGroup;
    }
    const mainDirectionalLight = ctx.sunLight ?? ctx.primaryDirectionalLight;
    const mainTransmissionLight = mainDirectionalLight ?? ctx.primaryTransmissionLight;
    const sunDir = mainDirectionalLight
      ? mainDirectionalLight.directionAndCutoff.xyz().scaleBy(-1)
      : mainTransmissionLight
        ? mainTransmissionLight.directionAndCutoff.xyz()
        : { x: 0, y: 0, z: 1 };
    const sunColorIntensity = mainTransmissionLight
      ? ShaderHelper.getPreExposedColorIntensity(mainTransmissionLight, ctx)
      : { x: 1, y: 1, z: 1, w: 0 };
    const mainLightPosRange = mainTransmissionLight
      ? mainTransmissionLight.positionAndRange
      : { x: 0, y: 0, z: 0, w: 1 };
    const mainLightDirCutoff = mainTransmissionLight
      ? mainTransmissionLight.directionAndCutoff
      : { x: 0, y: 0, z: -1, w: 0 };
    const mainLightType = mainTransmissionLight
      ? mainTransmissionLight.isDirectionLight()
        ? LIGHT_TYPE_DIRECTIONAL
        : mainTransmissionLight.isPointLight()
          ? LIGHT_TYPE_POINT
          : mainTransmissionLight.isSpotLight()
            ? LIGHT_TYPE_SPOT
            : LIGHT_TYPE_RECT
      : LIGHT_TYPE_DIRECTIONAL;
    bindGroup.setTexture('colorTex', inputColorTexture, fetchSampler('clamp_linear'));
    bindGroup.setTexture(
      'diffuseTex',
      ctx.SSSDiffuseTexture ?? inputColorTexture,
      fetchSampler('clamp_linear')
    );
    bindGroup.setTexture('blurTex', blurredTexture, fetchSampler('clamp_linear'));
    bindGroup.setTexture(
      'transmissionTex',
      ctx.SSSTransmissionTexture ?? ctx.SSSDiffuseTexture ?? inputColorTexture,
      fetchSampler('clamp_linear')
    );
    bindGroup.setTexture('profileTex', ctx.SSSProfileTexture!, fetchSampler('clamp_nearest_nomip'));
    bindGroup.setTexture('paramTex', ctx.SSSParamTexture!, fetchSampler('clamp_nearest_nomip'));
    bindGroup.setTexture('profileLUTTex', profileLUT, fetchSampler('clamp_nearest_nomip'));
    bindGroup.setTexture('roughnessTex', sssRoughnessTexture, fetchSampler('clamp_linear_nomip'));
    bindGroup.setTexture('normalTex', sssNormalTexture, fetchSampler('clamp_nearest_nomip'));
    bindGroup.setTexture('depthTex', sceneDepthTexture, fetchSampler('clamp_nearest_nomip'));
    bindGroup.setValue('cameraNearFar', new Vector2(ctx.camera.getNearPlane(), ctx.camera.getFarPlane()));
    bindGroup.setValue(
      'targetSize',
      new Vector4(
        inputColorTexture.width,
        inputColorTexture.height,
        inputColorTexture.width,
        inputColorTexture.height
      )
    );
    bindGroup.setValue('invProjMatrix', Matrix4x4.invert(ctx.camera.getProjectionMatrix()));
    bindGroup.setValue('invViewMatrix', ctx.camera.worldMatrix);
    bindGroup.setValue('sunDir', new Float32Array([sunDir.x, sunDir.y, sunDir.z]));
    bindGroup.setValue(
      'mainLightPosRange',
      new Float32Array([mainLightPosRange.x, mainLightPosRange.y, mainLightPosRange.z, mainLightPosRange.w])
    );
    bindGroup.setValue(
      'mainLightDirCutoff',
      new Float32Array([
        mainLightDirCutoff.x,
        mainLightDirCutoff.y,
        mainLightDirCutoff.z,
        mainLightDirCutoff.w
      ])
    );
    bindGroup.setValue('mainLightType', mainLightType);
    bindGroup.setValue(
      'sunColorIntensity',
      new Float32Array([sunColorIntensity.x, sunColorIntensity.y, sunColorIntensity.z, sunColorIntensity.w])
    );
    bindGroup.setValue('sssStrength', ctx.camera.sssStrength);
    bindGroup.setValue('transmissionStrength', ctx.camera.sssTransmissionStrength);
    bindGroup.setValue('transmissionPower', ctx.camera.sssTransmissionPower);
    bindGroup.setValue('multiScatter', ctx.camera.sssMultiScatter);
    bindGroup.setValue('hasDiffuseTex', ctx.SSSDiffuseTexture ? 1 : 0);
    bindGroup.setValue('hasTransmissionTex', ctx.SSSTransmissionTexture ? 1 : 0);
    bindGroup.setValue('hasRoughnessTex', hasRoughnessTexture ? 1 : 0);
    bindGroup.setValue('hasNormalTex', hasNormalTexture ? 1 : 0);
    bindGroup.setValue('debugView', SSS._debugViewMap[ctx.camera.sssDebugView] ?? 0);
    bindGroup.setValue('flip', this.needFlip(device) ? 1 : 0);
    bindGroup.setValue('srgbOut', srgbOutput ? 1 : 0);
    if (shadowLight) {
      const shadowMapParams = ctx.shadowMapInfo!.get(shadowLight)!;
      if (this.useCombineShadowMask(ctx, shadowLight)) {
        // Screen-space shadow mask path: bind the mask array and select this
        // light's layer/channel from its recorded ordinal (layer = s>>2,
        // channel = s&3). A missing mask falls back to the fully-lit dummy.
        const ordinal = shadowMapParams.maskOrdinal ?? 0;
        const layer = ordinal >> 2;
        const channel = ordinal & 3;
        bindGroup.setValue('shadowMaskLayer', layer);
        bindGroup.setValue(
          'shadowMaskChannel',
          new Float32Array([
            channel === 0 ? 1 : 0,
            channel === 1 ? 1 : 0,
            channel === 2 ? 1 : 0,
            channel === 3 ? 1 : 0
          ])
        );
        bindGroup.setTexture(
          'Z_UniformShadowMask',
          ctx.shadowMaskTexture ?? ShaderHelper.getDummyShadowMask(device),
          fetchSampler('clamp_nearest')
        );
      } else {
        const cameraPos = ctx.camera.getWorldPosition();
        bindGroup.setValue('camera', {
          position: new Vector4(cameraPos.x, cameraPos.y, cameraPos.z, 0),
          params: new Vector4(ctx.camera.getNearPlane(), ctx.camera.getFarPlane(), 1, 1),
          shadowDebugCascades: ctx.camera.shadowDebugCascades ? 1 : 0,
          framestamp: ctx.device.frameInfo.frameCounter
        });
        bindGroup.setValue('light', {
          sunDir: new Float32Array([sunDir.x, sunDir.y, sunDir.z]),
          envLightStrength: ShaderHelper.getEnvLightLuminance(ctx),
          envLightSpecularStrength: ctx.env?.light.specularStrength ?? 1,
          shadowStrength: shadowLight.shadow.shadowStrength,
          shadowCascades: shadowMapParams.numShadowCascades,
          positionAndRange: shadowLight.positionAndRange,
          directionAndCutoff: shadowLight.directionAndCutoff,
          diffuseAndIntensity: ShaderHelper.getPreExposedColorIntensity(shadowLight, ctx),
          extraParams: shadowLight.extraParams,
          implParams: shadowMapParams.impl!.getParams(),
          cascadeDistances: shadowMapParams.cascadeDistances,
          depthBiasValues: shadowMapParams.depthBiasValues[0],
          shadowCameraParams: shadowMapParams.cameraParams,
          depthBiasScales: shadowMapParams.depthBiasScales,
          shadowMatrices: new Float32Array(shadowMapParams.shadowMatrices)
        });
        bindGroup.setTexture(
          'Z_UniformShadowMap',
          shadowMapParams.shadowMap!,
          shadowMapParams.shadowMapSampler
        );
      }
    }
    device.setProgram(program);
    device.setBindGroup(0, bindGroup);
    this.drawFullscreenQuad(AbstractPostEffect.getDefaultRenderState(ctx, DEPTH_COMPARE_FARTHER));
  }

  private createBlurProgram(ctx: DrawContext, kernelRadius: number, horizontal: boolean) {
    const sampleCount = Math.max(1, Math.ceil(kernelRadius / 2));
    const program = ctx.device.buildRenderProgram({
      vertex(pb) {
        this.flip = pb.int().uniform(0);
        this.$inputs.pos = pb.vec2().attrib('position');
        this.$outputs.uv = pb.vec2();
        pb.main(function () {
          this.$builtins.position = pb.vec4(this.$inputs.pos, DEPTH_FARTHEST, 1);
          this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
          this.$if(pb.notEqual(this.flip, 0), function () {
            this.$builtins.position.y = pb.neg(this.$builtins.position.y);
          });
        });
      },
      fragment(pb) {
        this.colorTex = pb.tex2D().uniform(0);
        this.profileTex = pb.tex2D().uniform(0);
        this.paramTex = pb.tex2D().uniform(0);
        this.profileLUTTex = pb.tex2D().uniform(0);
        this.normalTex = pb.tex2D().uniform(0);
        this.depthTex = pb.tex2D().uniform(0);
        this.cameraNearFar = pb.vec2().uniform(0);
        this.targetSize = pb.vec4().uniform(0);
        this.sampleOffsets = pb.vec4[sampleCount + 1]().uniform(0);
        this.blurScale = pb.float().uniform(0);
        this.blurStdDev = pb.float().uniform(0);
        this.depthCutoff = pb.float().uniform(0);
        this.normalCutoff = pb.float().uniform(0);
        this.hasNormalTex = pb.int().uniform(0);
        this.$outputs.outColor = pb.vec4();
        pb.func('max3', [pb.vec3('value')], function () {
          this.$return(pb.max(this.value.x, pb.max(this.value.y, this.value.z)));
        });
        pb.func('readProfileRadius', [pb.float('slot')], function () {
          this.$l.uv = pb.vec2(pb.div(pb.add(this.slot, 0.5), SSS._profileLUTWidth), SSS.profileRowV(0));
          this.$return(
            pb.mul(pb.textureSampleLevel(this.profileLUTTex, this.uv, 0).rgb, SSS._profileRadiusEncodeMax)
          );
        });
        pb.func('readProfileFalloff', [pb.float('slot')], function () {
          this.$l.uv = pb.vec2(pb.div(pb.add(this.slot, 0.5), SSS._profileLUTWidth), SSS.profileRowV(1));
          this.$return(pb.textureSampleLevel(this.profileLUTTex, this.uv, 0).rgb);
        });
        pb.func('readProfileSettingsA', [pb.float('slot')], function () {
          this.$l.uv = pb.vec2(pb.div(pb.add(this.slot, 0.5), SSS._profileLUTWidth), SSS.profileRowV(4));
          this.$l.raw = pb.textureSampleLevel(this.profileLUTTex, this.uv, 0);
          this.$return(
            pb.vec4(
              pb.mul(this.raw.x, SSS._profileWorldScaleEncodeMax),
              this.raw.y,
              pb.mul(this.raw.z, SSS._profileNormalScaleEncodeMax),
              this.raw.w
            )
          );
        });
        pb.func('readProfileSettingsB', [pb.float('slot')], function () {
          this.$l.uv = pb.vec2(pb.div(pb.add(this.slot, 0.5), SSS._profileLUTWidth), SSS.profileRowV(6));
          this.$l.raw = pb.textureSampleLevel(this.profileLUTTex, this.uv, 0);
          this.$return(
            pb.vec4(
              pb.mul(this.raw.x, SSS._profileExtinctionEncodeMax),
              pb.mul(this.raw.y, SSS._profileWorldScaleEncodeMax),
              pb.mul(this.raw.z, 2),
              this.raw.w
            )
          );
        });
        pb.func(
          'burleyKernel1',
          [
            pb.float('distance'),
            pb.float('radius'),
            pb.float('falloff'),
            pb.float('distribution'),
            pb.float('scatterScale')
          ],
          function () {
            this.$l.safeRadius = pb.max(this.radius, 0.045);
            this.$l.safeDistribution = pb.clamp(this.distribution, 0, 1);
            this.$l.safeScatterScale = pb.clamp(
              pb.div(this.scatterScale, SSS._profileWorldScaleEncodeMax),
              0.05,
              1
            );
            this.$l.falloffShape = pb.mix(0.72, 1.46, pb.clamp(this.falloff, 0.05, 1));
            this.$l.distributionShape = pb.mix(0.82, 1.38, this.safeDistribution);
            this.$l.scatterShape = pb.mix(0.84, 1.28, this.safeScatterScale);
            this.$l.diffusionDistance = pb.max(
              pb.mul(
                this.blurStdDev,
                this.safeRadius,
                this.falloffShape,
                this.distributionShape,
                this.scatterShape
              ),
              0.16
            );
            this.$l.dr = pb.div(pb.abs(this.distance), this.diffusionDistance);
            this.$return(
              pb.div(
                pb.add(pb.exp(pb.neg(this.dr)), pb.exp(pb.neg(pb.div(this.dr, 3)))),
                pb.max(pb.mul(8, this.diffusionDistance), 1e-4)
              )
            );
          }
        );
        pb.func(
          'computeKernelWeight',
          [
            pb.float('distance'),
            pb.vec3('relativeRadius'),
            pb.vec3('falloff'),
            pb.float('distribution'),
            pb.float('scatterScale'),
            pb.float('strengthScale')
          ],
          function () {
            this.$l.safeDistribution = pb.clamp(this.distribution, 0, 1);
            this.$l.safeStrengthScale = pb.clamp(pb.mul(this.strengthScale, 0.5), 0.05, 1);
            this.$l.burleyWeight = pb.vec3(
              this.burleyKernel1(
                this.distance,
                this.relativeRadius.x,
                this.falloff.x,
                this.safeDistribution,
                this.scatterScale
              ),
              this.burleyKernel1(
                this.distance,
                this.relativeRadius.y,
                this.falloff.y,
                this.safeDistribution,
                this.scatterScale
              ),
              this.burleyKernel1(
                this.distance,
                this.relativeRadius.z,
                this.falloff.z,
                this.safeDistribution,
                this.scatterScale
              )
            );
            this.$l.forwardScatter = pb.vec3(
              this.burleyKernel1(
                this.distance,
                pb.max(pb.mul(this.relativeRadius.x, 0.58), 0.03),
                pb.mix(this.falloff.x, 1, 0.3),
                pb.mix(this.safeDistribution, 1, 0.18),
                pb.mul(this.scatterScale, 0.92)
              ),
              this.burleyKernel1(
                this.distance,
                pb.max(pb.mul(this.relativeRadius.y, 0.58), 0.03),
                pb.mix(this.falloff.y, 1, 0.3),
                pb.mix(this.safeDistribution, 1, 0.18),
                pb.mul(this.scatterScale, 0.92)
              ),
              this.burleyKernel1(
                this.distance,
                pb.max(pb.mul(this.relativeRadius.z, 0.58), 0.03),
                pb.mix(this.falloff.z, 1, 0.3),
                pb.mix(this.safeDistribution, 1, 0.18),
                pb.mul(this.scatterScale, 0.92)
              )
            );
            this.$l.forwardWeight = pb.mix(0.08, 0.28, this.safeStrengthScale);
            this.$return(
              pb.add(
                pb.mul(this.burleyWeight, pb.sub(1, this.forwardWeight)),
                pb.mul(this.forwardScatter, this.forwardWeight)
              )
            );
          }
        );
        pb.func('decodeNormal', [pb.vec2('uv')], function () {
          this.$if(pb.equal(this.hasNormalTex, 0), function () {
            this.$return(pb.vec3(0, 0, 1));
          });
          this.$l.n = pb.sub(pb.mul(pb.textureSampleLevel(this.normalTex, this.uv, 0).rgb, 2), pb.vec3(1));
          this.$return(pb.normalize(this.n));
        });
        pb.func('readDepth01', [pb.vec2('uv')], function () {
          this.$return(ShaderHelper.sampleLinearDepth(this, this.depthTex, this.uv, 0));
        });
        pb.func('sampleColor', [pb.vec2('uv')], function () {
          this.$return(pb.textureSampleLevel(this.colorTex, this.uv, 0));
        });
        pb.func('readProfileSlot', [pb.vec4('param')], function () {
          this.$return(pb.floor(pb.add(pb.mul(this.param.r, 255), 0.5)));
        });
        pb.main(function () {
          this.$l.uv = this.$inputs.uv;
          this.$l.centerColor = pb.textureSampleLevel(this.colorTex, this.uv, 0);
          this.$l.centerProfile = pb.textureSampleLevel(this.profileTex, this.uv, 0);
          this.$l.centerParam = pb.textureSampleLevel(this.paramTex, this.uv, 0);
          this.$l.centerActive = pb.greaterThan(this.centerParam.a, 0.5);
          this.$l.centerStrength = this.max3(this.centerProfile.rgb);
          this.$l.centerSlot = this.readProfileSlot(this.centerParam);
          this.$l.centerDepth01 = this.readDepth01(this.uv);
          this.$if(
            pb.or(
              pb.or(
                pb.or(pb.lessThanEqual(this.centerStrength, 1e-4), pb.lessThanEqual(this.centerSlot, 0)),
                pb.not(this.centerActive)
              ),
              pb.greaterThanEqual(this.centerDepth01, 1)
            ),
            function () {
              this.$outputs.outColor = this.centerColor;
            }
          ).$else(function () {
            this.$l.widthStrength = pb.clamp(this.centerParam.g, 0, 0.999);
            this.$l.centerDepth = pb.mul(this.centerDepth01, this.cameraNearFar.y);
            this.$l.centerLogDepth = pb.log(pb.add(this.centerDepth, 1));
            this.$l.profileSettingsA = this.readProfileSettingsA(this.centerSlot);
            this.$l.profileSettingsB = this.readProfileSettingsB(this.centerSlot);
            this.$l.profileWorldScale = pb.clamp(
              this.profileSettingsA.x,
              0.05,
              SSS._profileWorldScaleEncodeMax
            );
            this.$l.profileBoundaryBleed = pb.clamp(this.profileSettingsA.y, 0, 1);
            this.$l.profileNormalScale = pb.clamp(
              this.profileSettingsA.z,
              0,
              SSS._profileNormalScaleEncodeMax
            );
            this.$l.profileDistribution = pb.clamp(this.profileSettingsA.w, 0, 1);
            this.$l.profileScatterScale = pb.clamp(
              this.profileSettingsB.y,
              0.05,
              SSS._profileWorldScaleEncodeMax
            );
            this.$l.profileStrengthScale = pb.clamp(this.profileSettingsB.z, 0.05, 2);
            this.$l.profileWorldScaleNorm = pb.clamp(
              pb.div(this.profileWorldScale, SSS._profileWorldScaleEncodeMax),
              0,
              1
            );
            this.$l.profileScatterScaleNorm = pb.clamp(
              pb.div(this.profileScatterScale, SSS._profileWorldScaleEncodeMax),
              0,
              1
            );
            this.$l.profileStrengthNorm = pb.clamp(pb.mul(this.profileStrengthScale, 0.5), 0, 1);
            this.$l.depthThreshold = pb.div(
              pb.mul(
                this.depthCutoff,
                pb.add(0.45, pb.mul(this.widthStrength, 0.42)),
                pb.mix(0.88, 1.16, this.profileWorldScaleNorm)
              ),
              pb.max(
                pb.sub(pb.log(pb.add(this.cameraNearFar.y, 1)), pb.log(pb.add(this.cameraNearFar.x, 1))),
                1e-4
              )
            );
            this.$l.normalThreshold = pb.clamp(
              pb.add(
                pb.max(pb.sub(this.normalCutoff, pb.mul(this.widthStrength, 0.12)), 0.58),
                pb.sub(pb.mul(this.profileNormalScale, 0.08), 0.08),
                pb.neg(pb.mul(this.profileBoundaryBleed, 0.04))
              ),
              0.52,
              0.985
            );
            this.$l.centerNormal = this.decodeNormal(this.uv);
            this.$l.profileRadius = pb.mul(
              this.readProfileRadius(this.centerSlot),
              this.profileWorldScale,
              pb.mix(0.76, 1.44, this.profileScatterScaleNorm),
              pb.mix(0.92, 1.08, this.profileStrengthNorm)
            );
            this.$l.profileFalloff = this.readProfileFalloff(this.centerSlot);
            this.$l.maxProfileRadius = pb.max(this.max3(this.profileRadius), 1e-4);
            this.$l.relativeRadius = pb.div(this.profileRadius, this.maxProfileRadius);
            this.$l.profileSpread = pb.clamp(
              pb.div(this.maxProfileRadius, pb.add(this.maxProfileRadius, 0.65)),
              0,
              1
            );
            this.$l.profileDiffusionSoftness = pb.clamp(
              pb.add(
                pb.add(0.34, pb.mul(this.profileSpread, 0.34)),
                pb.add(pb.mul(this.profileDistribution, 0.18), pb.mul(this.profileStrengthNorm, 0.18))
              ),
              0.2,
              1
            );
            this.$l.radius = pb.max(
              pb.mul(
                pb.add(0.18, pb.mul(this.widthStrength, 1.9), pb.mul(this.profileSpread, 0.85)),
                this.blurScale,
                pb.add(0.18, pb.mul(this.maxProfileRadius, 0.82)),
                pb.mix(0.86, 1.22, this.profileStrengthNorm),
                pb.mix(0.9, 1.14, this.profileDiffusionSoftness),
                0.23
              ),
              1
            );
            this.$l.centerKernel = this.computeKernelWeight(
              0,
              this.relativeRadius,
              this.profileFalloff,
              this.profileDistribution,
              this.profileScatterScale,
              this.profileStrengthScale
            );
            this.$l.centerWeight = pb.max(
              pb.mul(
                this.centerProfile.rgb,
                pb.mix(0.92, 1.18, this.profileStrengthNorm),
                pb.mix(0.94, 1.08, this.profileDiffusionSoftness)
              ),
              pb.vec3(pb.mul(this.widthStrength, 0.05))
            );
            this.$l.centerSample = this.sampleColor(this.uv).rgb;
            this.$l.colorSum = pb.mul(this.centerSample, this.centerWeight, this.centerKernel);
            this.$l.weightSum = pb.max(pb.mul(this.centerWeight, this.centerKernel), pb.vec3(1e-4));
            this.$for(pb.int('i'), 1, sampleCount, function () {
              this.$l.data = this.sampleOffsets.at(this.i);
              this.$l.axisOffset = pb.mul(this.data.x, this.radius);
              this.$l.offset = pb.div(
                horizontal ? pb.vec2(this.axisOffset, 0) : pb.vec2(0, this.axisOffset),
                this.targetSize.xy
              );
              this.$l.kernelWeight = this.computeKernelWeight(
                this.data.x,
                this.relativeRadius,
                this.profileFalloff,
                this.profileDistribution,
                this.profileScatterScale,
                this.profileStrengthScale
              );
              this.$for(pb.int('side'), 0, 2, function () {
                this.$l.sampleUV = this.$choice(
                  pb.equal(this.side, 0),
                  pb.add(this.uv, this.offset),
                  pb.sub(this.uv, this.offset)
                );
                this.$l.sampleProfile = pb.textureSampleLevel(this.profileTex, this.sampleUV, 0);
                this.$l.sampleParam = pb.textureSampleLevel(this.paramTex, this.sampleUV, 0);
                this.$l.sampleStrength = this.max3(this.sampleProfile.rgb);
                this.$l.sampleActive = pb.greaterThan(this.sampleParam.a, 0.5);
                this.$l.sampleWidthStrength = pb.clamp(this.sampleParam.g, 0, 0.999);
                this.$l.sampleWeight = pb.max(
                  this.sampleProfile.rgb,
                  pb.vec3(pb.mul(this.sampleWidthStrength, 0.05))
                );
                this.$if(pb.and(this.sampleActive, pb.greaterThan(this.sampleStrength, 1e-4)), function () {
                  this.$l.depth01Sample = this.readDepth01(this.sampleUV);
                  this.$if(pb.lessThan(this.depth01Sample, 1), function () {
                    this.$l.sampleDepth = pb.mul(this.depth01Sample, this.cameraNearFar.y);
                    this.$l.sampleLogDepth = pb.log(pb.add(this.sampleDepth, 1));
                    this.$if(
                      pb.lessThan(
                        pb.abs(pb.sub(this.sampleLogDepth, this.centerLogDepth)),
                        this.depthThreshold
                      ),
                      function () {
                        this.$l.sampleNormal = this.decodeNormal(this.sampleUV);
                        this.$if(
                          pb.greaterThan(pb.dot(this.sampleNormal, this.centerNormal), this.normalThreshold),
                          function () {
                            this.$l.sampleColor = this.sampleColor(this.sampleUV).rgb;
                            this.$l.w = pb.mul(this.kernelWeight, this.sampleWeight);
                            this.colorSum = pb.add(this.colorSum, pb.mul(this.sampleColor, this.w));
                            this.weightSum = pb.add(this.weightSum, this.w);
                          }
                        );
                      }
                    );
                  });
                });
              });
            });
            this.$outputs.outColor = pb.vec4(
              pb.div(this.colorSum, pb.max(this.weightSum, pb.vec3(1e-4))),
              this.centerColor.a
            );
          });
        });
      }
    })!;
    program.name = horizontal ? '@SSS_Blur_H' : '@SSS_Blur_V';
    return program;
  }

  private createCombineProgram(ctx: DrawContext, shadowLight: Nullable<PunctualLight>) {
    const shadowMapParams = shadowLight ? ctx.shadowMapInfo?.get(shadowLight) : null;
    const shadowEnabled = !!(shadowLight && shadowMapParams?.shadowMap && shadowMapParams.impl);
    // When the screen-space shadow mask is available for the combine light,
    // sample it instead of recomputing PCSS (which also avoids the dpdx-in-
    // non-uniform-control-flow constraint entirely on this path).
    const useShadowMask = this.useCombineShadowMask(ctx, shadowLight);
    const pcssEnabled = shadowEnabled && !useShadowMask;
    const program = ctx.device.buildRenderProgram({
      vertex(pb) {
        this.flip = pb.int().uniform(0);
        this.$inputs.pos = pb.vec2().attrib('position');
        this.$outputs.uv = pb.vec2();
        pb.main(function () {
          this.$builtins.position = pb.vec4(this.$inputs.pos, DEPTH_FARTHEST, 1);
          this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
          this.$if(pb.notEqual(this.flip, 0), function () {
            this.$builtins.position.y = pb.neg(this.$builtins.position.y);
          });
        });
      },
      fragment(pb) {
        if (pcssEnabled) {
          const cameraStruct = pb.defineStruct([
            pb.vec4('position'),
            pb.vec4('params'),
            pb.float('shadowDebugCascades'),
            pb.int('framestamp')
          ]);
          const lightStruct = pb.defineStruct([
            pb.vec3('sunDir'),
            pb.float('envLightStrength'),
            pb.float('envLightSpecularStrength'),
            pb.float('shadowStrength'),
            pb.int('shadowCascades'),
            pb.vec4('positionAndRange'),
            pb.vec4('directionAndCutoff'),
            pb.vec4('diffuseAndIntensity'),
            pb.vec4('extraParams'),
            pb.vec4('cascadeDistances'),
            pb.vec4('depthBiasValues'),
            pb.vec4('implParams'),
            pb.vec4('shadowCameraParams'),
            pb.vec4('depthBiasScales'),
            pb.vec4[16]('shadowMatrices')
          ]);
          this.camera = cameraStruct().uniform(0);
          this.light = lightStruct().uniform(0);
          const shadowMap = shadowMapParams!.shadowMap!;
          const shadowTex = shadowMap.isTextureCube()
            ? shadowMap.isDepth()
              ? pb.texCubeShadow()
              : pb.texCube()
            : shadowMap.isTexture2D()
              ? shadowMap.isDepth()
                ? pb.tex2DShadow()
                : pb.tex2D()
              : shadowMap.isDepth()
                ? pb.tex2DArrayShadow()
                : pb.tex2DArray();
          if (
            !shadowMap.isDepth() &&
            !ctx.device.getDeviceCaps().textureCaps.getTextureFormatInfo(shadowMap.format).filterable
          ) {
            shadowTex.sampleType('unfilterable-float');
          }
          this.Z_UniformShadowMap = shadowTex.uniform(0);
        }
        if (useShadowMask) {
          // Screen-space shadow mask: one RGBA8 array layer per 4 lights. The
          // combine light's visibility is one channel of one layer, selected via
          // the layer index and a one-hot channel selector bound at draw time.
          this.Z_UniformShadowMask = pb.tex2DArray().uniform(0);
          this.shadowMaskLayer = pb.int().uniform(0);
          this.shadowMaskChannel = pb.vec4().uniform(0);
        }
        this.colorTex = pb.tex2D().uniform(0);
        this.diffuseTex = pb.tex2D().uniform(0);
        this.blurTex = pb.tex2D().uniform(0);
        this.transmissionTex = pb.tex2D().uniform(0);
        this.profileTex = pb.tex2D().uniform(0);
        this.paramTex = pb.tex2D().uniform(0);
        this.profileLUTTex = pb.tex2D().uniform(0);
        this.roughnessTex = pb.tex2D().uniform(0);
        this.normalTex = pb.tex2D().uniform(0);
        this.depthTex = pb.tex2D().uniform(0);
        this.cameraNearFar = pb.vec2().uniform(0);
        this.targetSize = pb.vec4().uniform(0);
        this.invProjMatrix = pb.mat4().uniform(0);
        this.invViewMatrix = pb.mat4().uniform(0);
        this.sunDir = pb.vec3().uniform(0);
        this.mainLightPosRange = pb.vec4().uniform(0);
        this.mainLightDirCutoff = pb.vec4().uniform(0);
        this.mainLightType = pb.int().uniform(0);
        this.sunColorIntensity = pb.vec4().uniform(0);
        this.sssStrength = pb.float().uniform(0);
        this.transmissionStrength = pb.float().uniform(0);
        this.transmissionPower = pb.float().uniform(0);
        this.multiScatter = pb.float().uniform(0);
        this.hasDiffuseTex = pb.int().uniform(0);
        this.hasTransmissionTex = pb.int().uniform(0);
        this.hasRoughnessTex = pb.int().uniform(0);
        this.hasNormalTex = pb.int().uniform(0);
        this.debugView = pb.int().uniform(0);
        this.srgbOut = pb.int().uniform(0);
        this.$outputs.outColor = pb.vec4();
        pb.func('max3', [pb.vec3('value')], function () {
          this.$return(pb.max(this.value.x, pb.max(this.value.y, this.value.z)));
        });
        pb.func('readProfileRadius', [pb.float('slot')], function () {
          this.$l.uv = pb.vec2(pb.div(pb.add(this.slot, 0.5), SSS._profileLUTWidth), SSS.profileRowV(0));
          this.$return(
            pb.mul(pb.textureSampleLevel(this.profileLUTTex, this.uv, 0).rgb, SSS._profileRadiusEncodeMax)
          );
        });
        pb.func('readProfileFalloff', [pb.float('slot')], function () {
          this.$l.uv = pb.vec2(pb.div(pb.add(this.slot, 0.5), SSS._profileLUTWidth), SSS.profileRowV(1));
          this.$return(pb.textureSampleLevel(this.profileLUTTex, this.uv, 0).rgb);
        });
        pb.func('readProfileTintBias', [pb.float('slot')], function () {
          this.$l.uv = pb.vec2(pb.div(pb.add(this.slot, 0.5), SSS._profileLUTWidth), SSS.profileRowV(2));
          this.$return(pb.textureSampleLevel(this.profileLUTTex, this.uv, 0).rgb);
        });
        pb.func('readProfilePresetResponse', [pb.float('slot')], function () {
          this.$l.uv = pb.vec2(pb.div(pb.add(this.slot, 0.5), SSS._profileLUTWidth), SSS.profileRowV(3));
          this.$l.raw = pb.textureSampleLevel(this.profileLUTTex, this.uv, 0);
          this.$return(
            pb.vec4(
              this.raw.x,
              this.raw.y,
              pb.sub(pb.mul(this.raw.z, 0.75), 0.25),
              pb.sub(pb.mul(this.raw.w, 0.75), 0.25)
            )
          );
        });
        pb.func('readProfileSettingsA', [pb.float('slot')], function () {
          this.$l.uv = pb.vec2(pb.div(pb.add(this.slot, 0.5), SSS._profileLUTWidth), SSS.profileRowV(4));
          this.$l.raw = pb.textureSampleLevel(this.profileLUTTex, this.uv, 0);
          this.$return(
            pb.vec4(
              pb.mul(this.raw.x, SSS._profileWorldScaleEncodeMax),
              this.raw.y,
              pb.mul(this.raw.z, SSS._profileNormalScaleEncodeMax),
              this.raw.w
            )
          );
        });
        pb.func('readProfileTransmissionTint', [pb.float('slot')], function () {
          this.$l.uv = pb.vec2(pb.div(pb.add(this.slot, 0.5), SSS._profileLUTWidth), SSS.profileRowV(5));
          this.$return(pb.textureSampleLevel(this.profileLUTTex, this.uv, 0).rgb);
        });
        pb.func('readProfileSettingsB', [pb.float('slot')], function () {
          this.$l.uv = pb.vec2(pb.div(pb.add(this.slot, 0.5), SSS._profileLUTWidth), SSS.profileRowV(6));
          this.$l.raw = pb.textureSampleLevel(this.profileLUTTex, this.uv, 0);
          this.$return(
            pb.vec4(
              pb.mul(this.raw.x, SSS._profileExtinctionEncodeMax),
              pb.mul(this.raw.y, SSS._profileWorldScaleEncodeMax),
              pb.mul(this.raw.z, 2),
              this.raw.w
            )
          );
        });
        pb.func('readProfileSlot', [pb.vec4('param')], function () {
          this.$return(pb.floor(pb.add(pb.mul(this.param.r, 255), 0.5)));
        });
        pb.func('readProfilePreset', [pb.vec4('param')], function () {
          this.$return(pb.floor(pb.add(pb.mul(this.param.b, 255), 0.5)));
        });
        pb.func('decodeNormal', [pb.vec2('uv')], function () {
          this.$if(pb.equal(this.hasNormalTex, 0), function () {
            this.$return(pb.vec3(0, 0, 1));
          });
          this.$l.n = pb.sub(pb.mul(pb.textureSampleLevel(this.normalTex, this.uv, 0).rgb, 2), pb.vec3(1));
          this.$return(pb.normalize(this.n));
        });
        pb.func('readDepth01', [pb.vec2('uv')], function () {
          this.$return(ShaderHelper.sampleLinearDepth(this, this.depthTex, this.uv, 0));
        });
        pb.func(
          'estimateScreenThinnessComponents',
          [pb.vec2('uv'), pb.float('depth01'), pb.vec3('normalWS'), pb.float('radiusScale')],
          function () {
            this.$l.pixelStep = pb.div(
              pb.add(pb.vec2(1.2), pb.mul(pb.vec2(2.4), this.radiusScale)),
              this.targetSize.xy
            );
            this.$l.depthAccum = pb.float(0);
            this.$l.normalAccum = pb.float(0);
            this.$l.sampleCount = pb.float(0);
            const sampleAt = (offsetX: number, offsetY: number) => {
              this.$l.sampleUV = pb.clamp(
                pb.add(this.uv, pb.mul(this.pixelStep, pb.vec2(offsetX, offsetY))),
                pb.vec2(0),
                pb.vec2(1)
              );
              this.$l.sampleDepth01 = this.readDepth01(this.sampleUV);
              this.depthAccum = pb.add(this.depthAccum, pb.abs(pb.sub(this.sampleDepth01, this.depth01)));
              this.$if(pb.notEqual(this.hasNormalTex, 0), function () {
                this.normalAccum = pb.add(
                  this.normalAccum,
                  pb.clamp(pb.sub(1, pb.dot(this.decodeNormal(this.sampleUV), this.normalWS)), 0, 1)
                );
              });
              this.sampleCount = pb.add(this.sampleCount, 1);
            };
            sampleAt(1, 0);
            sampleAt(-1, 0);
            sampleAt(0, 1);
            sampleAt(0, -1);
            sampleAt(1, 1);
            sampleAt(-1, -1);
            this.$l.depthMean = pb.div(this.depthAccum, pb.max(this.sampleCount, 1));
            this.$l.normalMean = pb.div(this.normalAccum, pb.max(this.sampleCount, 1));
            this.$l.depthThin = pb.clamp(
              pb.mul(this.depthMean, pb.add(52, pb.mul(this.radiusScale, 18))),
              0,
              1
            );
            this.$l.normalThin = pb.clamp(
              pb.mul(this.normalMean, pb.add(1.4, pb.mul(this.radiusScale, 0.5))),
              0,
              1
            );
            this.$l.combinedThin = pb.clamp(
              pb.add(pb.mul(this.depthThin, 0.72), pb.mul(this.normalThin, 0.52)),
              0,
              1
            );
            this.$return(pb.vec3(this.depthThin, this.normalThin, this.combinedThin));
          }
        );
        pb.func('reconstructViewPos', [pb.vec2('uv'), pb.float('linearDepth')], function () {
          this.$l.viewDepth = pb.max(pb.mul(this.linearDepth, this.cameraNearFar.y), 1e-5);
          this.$l.nonLinearDepth = ShaderHelper.linearDepthToNonLinear(
            this,
            this.viewDepth,
            this.cameraNearFar
          );
          this.$l.clipPos = pb.vec4(
            pb.sub(pb.mul(this.uv, 2), pb.vec2(1)),
            ShaderHelper.deviceDepthToClipZ(this, pb.clamp(this.nonLinearDepth, 0, 1)),
            1
          );
          this.$l.viewPos = pb.mul(this.invProjMatrix, this.clipPos);
          this.$return(pb.div(this.viewPos.xyz, pb.max(this.viewPos.w, 1e-5)));
        });
        pb.func(
          'calculateMainLightDirection',
          [
            pb.vec3('worldPos'),
            pb.int('lightType'),
            pb.vec4('posRange'),
            pb.vec4('dirCutoff'),
            pb.vec3('fallbackDir')
          ],
          function () {
            this.$return(
              this.$choice(
                pb.equal(this.lightType, LIGHT_TYPE_DIRECTIONAL),
                pb.normalize(this.fallbackDir),
                pb.normalize(pb.sub(this.posRange.xyz, this.worldPos))
              )
            );
          }
        );
        pb.func(
          'calculateMainLightAttenuation',
          [pb.vec3('worldPos'), pb.int('lightType'), pb.vec4('posRange'), pb.vec4('dirCutoff')],
          function () {
            this.$if(pb.equal(this.lightType, LIGHT_TYPE_DIRECTIONAL), function () {
              this.$return(pb.float(1));
            });
            this.$l.dist = pb.distance(this.posRange.xyz, this.worldPos);
            this.$l.falloff = pb.max(0, pb.sub(1, pb.div(this.dist, pb.max(this.posRange.w, 1e-4))));
            this.$if(
              pb.or(pb.equal(this.lightType, LIGHT_TYPE_POINT), pb.equal(this.lightType, LIGHT_TYPE_RECT)),
              function () {
                this.$return(pb.mul(this.falloff, this.falloff));
              }
            );
            this.$l.spotFactor = pb.dot(
              pb.normalize(pb.sub(this.worldPos, this.posRange.xyz)),
              this.dirCutoff.xyz
            );
            this.spotFactor = pb.smoothStep(
              this.dirCutoff.w,
              pb.mix(this.dirCutoff.w, 1, 0.5),
              this.spotFactor
            );
            this.$return(pb.mul(this.spotFactor, this.falloff, this.falloff));
          }
        );
        if (pcssEnabled) {
          pb.func(
            'calculateTransmissionShadow',
            [pb.vec3('worldPos'), pb.float('depth01'), pb.float('NoL')],
            function () {
              if (shadowMapParams!.numShadowCascades > 1) {
                this.$l.linearDepth = pb.mul(this.depth01, this.camera.params.y);
                this.$l.splitDistances = this.light.cascadeDistances;
                this.$l.comparison = pb.vec4(pb.greaterThan(pb.vec4(this.linearDepth), this.splitDistances));
                this.$l.cascadeFlags = pb.vec4(
                  pb.float(pb.greaterThan(this.light.shadowCascades, 0)),
                  pb.float(pb.greaterThan(this.light.shadowCascades, 1)),
                  pb.float(pb.greaterThan(this.light.shadowCascades, 2)),
                  pb.float(pb.greaterThan(this.light.shadowCascades, 3))
                );
                this.$l.split = pb.int(pb.dot(this.comparison, this.cascadeFlags));
                if (ctx.device.type === 'webgl') {
                  this.$l.shadowVertex = pb.vec4();
                  this.$for(pb.int('cascade'), 0, 4, function () {
                    this.$if(pb.equal(this.cascade, this.split), function () {
                      this.shadowVertex = ShaderHelper.calculateShadowSpaceVertex(
                        this,
                        pb.vec4(this.worldPos, 1),
                        this.cascade
                      );
                      this.$break();
                    });
                  });
                } else {
                  this.$l.shadowVertex = ShaderHelper.calculateShadowSpaceVertex(
                    this,
                    pb.vec4(this.worldPos, 1),
                    this.split
                  );
                }
                this.$l.shadow = shadowMapParams!.impl!.computeShadowCSM(
                  shadowMapParams!,
                  this,
                  this.shadowVertex,
                  this.NoL,
                  this.split
                );
                this.$l.shadowDistance = this.light.shadowCameraParams.w;
                this.shadow = pb.mix(
                  this.shadow,
                  1,
                  pb.smoothStep(
                    pb.mul(this.shadowDistance, 0.8),
                    this.shadowDistance,
                    pb.distance(this.camera.position.xyz, this.worldPos)
                  )
                );
                this.shadow = pb.mix(1, this.shadow, this.light.shadowStrength);
                this.shadow = pb.clamp(this.shadow, 0, 1);
                this.$return(this.shadow);
              } else {
                this.$l.shadowVertex = ShaderHelper.calculateShadowSpaceVertex(
                  this,
                  pb.vec4(this.worldPos, 1)
                );
                this.$l.shadow = shadowMapParams!.impl!.computeShadow(
                  shadowMapParams!,
                  this,
                  this.shadowVertex,
                  this.NoL
                );
                this.$l.shadowDistance = this.light.shadowCameraParams.w;
                this.shadow = pb.mix(
                  this.shadow,
                  1,
                  pb.smoothStep(
                    pb.mul(this.shadowDistance, 0.8),
                    this.shadowDistance,
                    pb.distance(this.camera.position.xyz, this.worldPos)
                  )
                );
                this.shadow = pb.mix(1, this.shadow, this.light.shadowStrength);
                this.shadow = pb.clamp(this.shadow, 0, 1);
                this.$return(this.shadow);
              }
            }
          );
        }
        pb.main(function () {
          this.$l.uv = this.$inputs.uv;
          this.$l.baseColor = pb.textureSampleLevel(this.colorTex, this.uv, 0);
          this.$l.baseDiffuseColor = pb.textureSampleLevel(this.diffuseTex, this.uv, 0).rgb;
          this.$l.baseTransmissionColor = pb.vec3(0);
          this.$l.debugThinness = pb.float(0);
          this.$l.debugThinnessLayers = pb.vec3(0);
          this.$l.debugTransmissionMask = pb.float(0);
          this.$l.debugThinLighting = pb.vec3(0);
          this.$l.debugProfileEnergy = pb.vec3(0);
          this.$l.debugProfileTransmission = pb.vec3(0);
          this.$l.debugProfileBoundary = pb.vec3(0);
          this.$l.debugTransmissionShadow = pb.float(0);
          this.$if(pb.notEqual(this.hasTransmissionTex, 0), function () {
            this.baseTransmissionColor = pb.textureSampleLevel(this.transmissionTex, this.uv, 0).rgb;
          });
          this.$l.profile = pb.textureSampleLevel(this.profileTex, this.uv, 0);
          this.$l.param = pb.textureSampleLevel(this.paramTex, this.uv, 0);
          this.$l.profileActive = pb.greaterThan(this.param.a, 0.5);
          this.$l.scatterSoftnessAuthor = pb.clamp(pb.mul(pb.sub(this.param.a, 0.75), 4), 0, 1);
          this.$l.roughnessInfo = pb.textureSampleLevel(this.roughnessTex, this.uv, 0);
          this.$l.profileStrength = this.max3(this.profile.rgb);
          this.$l.materialTransmissionMask = pb.clamp(this.profile.a, 0, 1);
          this.debugTransmissionMask = this.materialTransmissionMask;
          this.$l.profileSlot = this.readProfileSlot(this.param);
          this.$l.profilePreset = this.readProfilePreset(this.param);
          this.$l.depth01 = this.readDepth01(this.uv);
          this.$l.result = this.baseColor.rgb;
          // Transmission shadow. On the PCSS path the shadow uses implicit
          // derivatives (dpdx) inside the impl; WGSL requires those in uniform
          // control flow, so it is computed here rather than inside the
          // profile-active branch below (a per-pixel, non-uniform branch). On the
          // shadow-mask path the value is a single texture fetch (no PCSS).
          this.$l.transmissionShadowRaw = pb.float(1);
          this.$l.transmissionShadow = pb.float(1);
          if (pcssEnabled) {
            this.$l.shadowNormalWS = this.decodeNormal(this.uv);
            this.$l.shadowViewPos = this.reconstructViewPos(this.uv, this.depth01);
            this.$l.shadowWorldPos = pb.mul(this.invViewMatrix, pb.vec4(this.shadowViewPos, 1)).xyz;
            this.$l.shadowSunDirWS = this.calculateMainLightDirection(
              this.shadowWorldPos,
              this.mainLightType,
              this.mainLightPosRange,
              this.mainLightDirCutoff,
              this.sunDir
            );
            this.transmissionShadowRaw = this.calculateTransmissionShadow(
              this.shadowWorldPos,
              this.depth01,
              pb.clamp(pb.abs(pb.dot(this.shadowNormalWS, this.shadowSunDirWS)), 0, 1)
            );
            this.transmissionShadow = this.transmissionShadowRaw;
          } else if (useShadowMask) {
            // The mask already holds the identical shadow (same PCSS + distance
            // fade + shadowStrength) rendered by the ShadowMaskPass; read the
            // combine light's channel. Sample by screen UV, matching how the
            // other screen-space inputs (color/depth) are sampled above.
            this.transmissionShadowRaw = pb.dot(
              pb.textureArraySampleLevel(this.Z_UniformShadowMask, this.uv, this.shadowMaskLayer, 0),
              this.shadowMaskChannel
            );
            this.transmissionShadow = this.transmissionShadowRaw;
          }
          this.$if(
            pb.and(
              pb.and(
                pb.and(pb.greaterThan(this.profileStrength, 1e-4), pb.greaterThan(this.profileSlot, 0)),
                this.profileActive
              ),
              pb.lessThan(this.depth01, 1)
            ),
            function () {
              this.$l.widthStrength = pb.clamp(this.param.g, 0, 0.999);
              this.$l.profileSettingsA = this.readProfileSettingsA(this.profileSlot);
              this.$l.profileTransmissionTint = this.readProfileTransmissionTint(this.profileSlot);
              this.$l.profileSettingsB = this.readProfileSettingsB(this.profileSlot);
              this.$l.profileWorldScale = pb.clamp(
                this.profileSettingsA.x,
                0.05,
                SSS._profileWorldScaleEncodeMax
              );
              this.$l.profileBoundaryBleed = pb.clamp(this.profileSettingsA.y, 0, 1);
              this.$l.profileNormalScale = pb.clamp(
                this.profileSettingsA.z,
                0,
                SSS._profileNormalScaleEncodeMax
              );
              this.$l.profileDistribution = pb.clamp(this.profileSettingsA.w, 0, 1);
              this.$l.profileExtinctionScale = pb.clamp(
                this.profileSettingsB.x,
                0,
                SSS._profileExtinctionEncodeMax
              );
              this.$l.profileScatterScale = pb.clamp(
                this.profileSettingsB.y,
                0.05,
                SSS._profileWorldScaleEncodeMax
              );
              this.$l.profileStrengthScale = pb.clamp(this.profileSettingsB.z, 0.05, 2);
              this.$l.profileWorldScaleNorm = pb.clamp(
                pb.div(this.profileWorldScale, SSS._profileWorldScaleEncodeMax),
                0,
                1
              );
              this.$l.profileScatterScaleNorm = pb.clamp(
                pb.div(this.profileScatterScale, SSS._profileWorldScaleEncodeMax),
                0,
                1
              );
              this.$l.profileStrengthNorm = pb.clamp(pb.mul(this.profileStrengthScale, 0.5), 0, 1);
              this.$l.extinctionNorm = pb.clamp(
                pb.div(this.profileExtinctionScale, SSS._profileExtinctionEncodeMax),
                0,
                1
              );
              this.$l.profileRadius = pb.mul(
                this.readProfileRadius(this.profileSlot),
                this.profileWorldScale,
                pb.mix(0.78, 1.42, this.profileScatterScaleNorm),
                pb.mix(0.92, 1.08, this.profileStrengthNorm)
              );
              this.$l.profileFalloff = this.readProfileFalloff(this.profileSlot);
              this.$l.maxProfileRadius = pb.max(this.max3(this.profileRadius), 1e-4);
              this.$l.radiusTint = pb.div(this.profileRadius, this.maxProfileRadius);
              this.$l.avgFalloff = pb.mul(
                pb.add(this.profileFalloff.x, pb.add(this.profileFalloff.y, this.profileFalloff.z)),
                0.3333333
              );
              this.$l.profileSpread = pb.clamp(
                pb.div(this.maxProfileRadius, pb.add(this.maxProfileRadius, 0.65)),
                0,
                1
              );
              this.$l.profileDiffusionSoftness = pb.clamp(
                pb.add(
                  pb.add(0.32, pb.mul(this.profileSpread, 0.34)),
                  pb.add(pb.mul(this.profileDistribution, 0.18), pb.mul(this.profileStrengthNorm, 0.2))
                ),
                0.18,
                1
              );
              this.$l.profileEnergyScale = pb.clamp(
                pb.mul(
                  pb.add(
                    pb.add(0.52, pb.mul(this.profileScatterScaleNorm, 0.42)),
                    pb.mul(this.profileStrengthNorm, 0.28)
                  ),
                  pb.add(0.9, pb.mul(this.profileWorldScaleNorm, 0.16))
                ),
                0.45,
                1.55
              );
              this.$l.profileTransmissionScale = pb.clamp(
                pb.mul(
                  pb.add(
                    pb.add(0.44, pb.mul(this.profileScatterScaleNorm, 0.36)),
                    pb.add(pb.mul(this.profileStrengthNorm, 0.26), pb.mul(this.profileBoundaryBleed, 0.08))
                  ),
                  pb.mix(1.1, 0.72, this.extinctionNorm)
                ),
                0.28,
                1.35
              );
              this.$l.profileTintBase = pb.div(
                pb.max(
                  pb.mul(
                    pb.pow(this.profileFalloff, pb.vec3(0.8)),
                    pb.mix(pb.vec3(0.72), pb.vec3(1.35), this.radiusTint)
                  ),
                  pb.vec3(1e-4)
                ),
                pb.max(
                  this.max3(
                    pb.mul(
                      pb.pow(this.profileFalloff, pb.vec3(0.8)),
                      pb.mix(pb.vec3(0.72), pb.vec3(1.35), this.radiusTint)
                    )
                  ),
                  1e-4
                )
              );
              this.$l.presetTintBias = this.readProfileTintBias(this.profileSlot);
              this.$l.presetResponse = this.readProfilePresetResponse(this.profileSlot);
              this.$l.presetFrontScatter = this.presetResponse.x;
              this.$l.presetSoftness = this.presetResponse.y;
              this.$l.presetEnergyBoost = this.presetResponse.z;
              this.$l.presetTransmissionBoost = this.presetResponse.w;
              this.$l.presetTint = pb.mul(
                this.profileTintBase,
                this.presetTintBias,
                pb.mix(pb.vec3(1), this.profileTransmissionTint, pb.mul(this.profileBoundaryBleed, 0.22))
              );
              this.$l.tint = pb.div(
                pb.max(this.presetTint, pb.vec3(1e-4)),
                pb.max(this.max3(this.presetTint), 1e-4)
              );
              this.$l.baseLuma = pb.dot(this.baseColor.rgb, pb.vec3(0.2126, 0.7152, 0.0722));
              this.$l.shadowMask = pb.clamp(pb.sub(0.82, this.baseLuma), 0, 1);
              this.$l.radiusResponse = pb.clamp(
                pb.add(
                  pb.mul(this.widthStrength, 0.9),
                  pb.mul(this.profileSpread, 0.62),
                  pb.add(
                    pb.mul(this.profileDiffusionSoftness, 0.18),
                    pb.add(pb.mul(this.avgFalloff, 0.16), pb.mul(this.profileEnergyScale, 0.08))
                  )
                ),
                0,
                1
              );
              this.$l.normalWS = this.decodeNormal(this.uv);
              this.$l.viewPos = this.reconstructViewPos(this.uv, this.depth01);
              this.$l.worldPos = pb.mul(this.invViewMatrix, pb.vec4(this.viewPos, 1)).xyz;
              this.$l.sunDirWS = this.calculateMainLightDirection(
                this.worldPos,
                this.mainLightType,
                this.mainLightPosRange,
                this.mainLightDirCutoff,
                this.sunDir
              );
              this.$l.mainLightAttenuation = this.calculateMainLightAttenuation(
                this.worldPos,
                this.mainLightType,
                this.mainLightPosRange,
                this.mainLightDirCutoff
              );
              this.$l.frontLit = pb.mul(pb.dot(this.normalWS, this.sunDirWS), this.mainLightAttenuation);
              // transmissionShadowRaw/transmissionShadow were computed in uniform
              // control flow at the top of main (PCSS sampling uses dpdx, which
              // WGSL forbids inside this non-uniform branch); reuse them here.
              this.transmissionShadow = this.transmissionShadowRaw;
              this.$l.transmissionLightAttenuation = pb.mul(
                this.mainLightAttenuation,
                this.transmissionShadow
              );
              this.$l.thinnessComponents = this.estimateScreenThinnessComponents(
                this.uv,
                this.depth01,
                this.normalWS,
                this.radiusResponse
              );
              this.$l.depthThinness = this.thinnessComponents.x;
              this.$l.curvatureThinness = this.thinnessComponents.y;
              this.$l.screenThinness = this.thinnessComponents.z;
              this.debugThinness = this.screenThinness;
              this.debugThinnessLayers = pb.vec3(this.depthThinness, this.curvatureThinness, 0);
              this.$l.wrappedFront = pb.smoothStep(
                pb.add(-0.32, pb.mul(this.profileSpread, 0.08)),
                pb.add(0.42, pb.mul(this.radiusResponse, 0.16)),
                pb.add(this.frontLit, pb.mul(this.radiusResponse, 0.18))
              );
              this.$l.terminatorWrap = pb.clamp(
                pb.mul(
                  pb.max(pb.sub(this.wrappedFront, pb.clamp(this.frontLit, 0, 1)), 0),
                  pb.add(0.85, pb.mul(this.avgFalloff, 0.3), pb.mul(this.profileSpread, 0.22))
                ),
                0,
                1
              );
              this.$l.surfaceScatterMask = pb.clamp(
                pb.add(
                  pb.add(pb.mul(this.shadowMask, 0.58), pb.mul(this.terminatorWrap, 0.82)),
                  pb.add(
                    pb.add(
                      pb.mul(pb.clamp(pb.sub(1, pb.max(this.frontLit, 0)), 0, 1), 0.12),
                      pb.mul(this.profileSpread, 0.06)
                    ),
                    pb.mul(
                      this.screenThinness,
                      pb.add(
                        pb.add(0.08, pb.mul(this.profileSpread, 0.08)),
                        pb.mul(this.profileBoundaryBleed, 0.08)
                      )
                    )
                  )
                ),
                0.05,
                1
              );
              this.$l.materialScatterBoost = pb.clamp(
                pb.add(
                  pb.mul(pb.max(pb.sub(this.profileStrength, 0.9), 0), 0.72),
                  pb.add(
                    pb.mul(pb.max(pb.sub(this.widthStrength, 0.55), 0), 1.45),
                    pb.add(
                      pb.mul(pb.max(pb.sub(this.profileSpread, 0.58), 0), 0.42),
                      pb.add(
                        pb.mul(pb.sub(this.profileDistribution, 0.5), 0.28),
                        pb.mul(this.profileStrengthNorm, 0.18)
                      )
                    )
                  )
                ),
                0,
                1
              );
              this.$l.materialTransmissionResponse = pb.clamp(
                pb.mul(
                  this.materialTransmissionMask,
                  pb.add(
                    pb.add(0.7, pb.mul(this.profileSpread, 0.14)),
                    pb.add(
                      pb.add(pb.mul(this.presetTransmissionBoost, 0.52), pb.mul(this.presetSoftness, 0.22)),
                      pb.add(
                        pb.mul(this.profileBoundaryBleed, 0.08),
                        pb.add(
                          pb.mul(pb.sub(1, this.extinctionNorm), 0.1),
                          pb.mul(this.profileTransmissionScale, 0.14)
                        )
                      )
                    )
                  )
                ),
                0,
                1
              );
              this.$l.materialTransmissionSoftness = pb.clamp(
                pb.add(
                  pb.mul(this.materialTransmissionResponse, 0.42),
                  pb.add(pb.mul(this.widthStrength, 0.08), pb.mul(this.profileSpread, 0.06))
                ),
                0,
                0.65
              );
              this.$l.materialThicknessField = pb.clamp(
                pb.add(
                  pb.add(
                    pb.mul(this.materialTransmissionResponse, 0.82),
                    pb.mul(this.materialTransmissionSoftness, 0.28)
                  ),
                  pb.add(pb.mul(this.widthStrength, 0.06), pb.mul(this.profileSpread, 0.08))
                ),
                0,
                1
              );
              this.debugProfileEnergy = pb.clamp(
                pb.vec3(
                  this.profileStrengthNorm,
                  pb.div(this.profileEnergyScale, 1.55),
                  this.materialScatterBoost
                ),
                pb.vec3(0),
                pb.vec3(1)
              );
              this.debugProfileTransmission = pb.clamp(
                pb.vec3(
                  pb.div(this.profileTransmissionScale, 1.35),
                  this.materialTransmissionResponse,
                  this.materialThicknessField
                ),
                pb.vec3(0),
                pb.vec3(1)
              );
              this.debugProfileBoundary = pb.clamp(
                pb.vec3(
                  this.profileBoundaryBleed,
                  this.profileDiffusionSoftness,
                  this.materialTransmissionSoftness
                ),
                pb.vec3(0),
                pb.vec3(1)
              );
              this.$l.edgeThinBoost = pb.clamp(
                pb.mul(this.screenThinness, pb.add(0.14, pb.mul(this.materialThicknessField, 0.22))),
                0,
                0.32
              );
              this.$l.curvatureThinBoost = pb.clamp(
                pb.mul(
                  this.curvatureThinness,
                  pb.add(
                    pb.add(0.08, pb.mul(this.materialThicknessField, 0.12)),
                    pb.mul(pb.sub(this.profileNormalScale, 1), 0.08)
                  )
                ),
                0,
                0.18
              );
              this.$l.scatterMask = pb.clamp(
                pb.add(
                  this.surfaceScatterMask,
                  pb.add(
                    pb.add(pb.mul(this.materialScatterBoost, 0.28), this.presetFrontScatter),
                    pb.add(
                      pb.mul(
                        pb.clamp(pb.sub(1, pb.max(this.frontLit, 0)), 0, 1),
                        pb.add(pb.mul(this.materialScatterBoost, 0.22), pb.mul(this.presetFrontScatter, 0.7))
                      ),
                      pb.mul(
                        this.screenThinness,
                        pb.add(0.12, pb.mul(this.presetSoftness, 0.08), pb.mul(this.presetFrontScatter, 0.08))
                      ),
                      pb.mul(this.materialTransmissionSoftness, 0.1)
                    )
                  )
                ),
                pb.add(
                  pb.add(0.05, pb.mul(this.materialScatterBoost, 0.12)),
                  pb.mul(this.presetFrontScatter, 0.3)
                ),
                1
              );
              this.$l.scatterMix = pb.add(
                pb.add(0.54, pb.mul(this.radiusResponse, 0.94)),
                pb.add(
                  pb.add(pb.mul(this.avgFalloff, 0.22), pb.mul(this.profileSpread, 0.08)),
                  pb.add(pb.mul(this.materialScatterBoost, 0.3), this.presetSoftness)
                )
              );
              this.$l.scatterStrength = pb.clamp(
                pb.mul(
                  pb.max(
                    pb.mul(this.profileStrength, pb.mix(0.88, 1.24, this.profileStrengthNorm)),
                    pb.mul(this.widthStrength, 0.45)
                  ),
                  this.sssStrength,
                  this.profileEnergyScale,
                  pb.add(
                    pb.add(0.62, pb.mul(this.avgFalloff, 0.56)),
                    pb.add(
                      pb.add(pb.mul(this.profileSpread, 0.28), pb.mul(this.screenThinness, 0.18)),
                      pb.add(
                        pb.add(pb.mul(this.materialScatterBoost, 0.42), pb.mul(this.presetSoftness, 0.5)),
                        pb.mul(this.materialTransmissionSoftness, 0.22)
                      )
                    )
                  )
                ),
                0,
                pb.add(
                  pb.add(
                    pb.add(1.05, pb.mul(this.materialScatterBoost, 1.1)),
                    pb.add(pb.mul(this.presetSoftness, 0.8), pb.mul(this.profileEnergyScale, 0.24))
                  ),
                  pb.mul(this.screenThinness, 0.22)
                )
              );
              this.$l.blurred = pb.textureSampleLevel(this.blurTex, this.uv, 0).rgb;
              this.$l.roughness = pb.float(1);
              this.$l.specMask = pb.float(0.12);
              this.$if(pb.notEqual(this.hasRoughnessTex, 0), function () {
                this.roughness = this.roughnessInfo.a;
                this.specMask = pb.clamp(
                  pb.mul(
                    this.max3(this.roughnessInfo.rgb),
                    pb.add(0.45, pb.mul(pb.sub(1, this.roughness), 0.75))
                  ),
                  0,
                  1
                );
              });
              this.$if(pb.equal(this.hasDiffuseTex, 0), function () {
                this.$l.specularFallback = pb.mul(
                  this.baseColor.rgb,
                  pb.clamp(
                    pb.add(
                      pb.mul(this.specMask, pb.add(0.12, pb.mul(pb.sub(1, this.roughness), 0.28))),
                      pb.mul(this.profileStrength, 0.06)
                    ),
                    0,
                    0.5
                  )
                );
                this.baseDiffuseColor = pb.max(pb.sub(this.baseColor.rgb, this.specularFallback), pb.vec3(0));
              });
              this.$l.baseDiffuseSafe = pb.max(this.baseDiffuseColor, pb.vec3(1e-4));
              this.$l.baseDiffuseLuma = pb.dot(this.baseDiffuseSafe, pb.vec3(0.2126, 0.7152, 0.0722));
              this.$l.epidermalMix = pb.clamp(
                pb.add(
                  pb.add(0.24, pb.mul(this.avgFalloff, 0.08)),
                  pb.add(pb.mul(this.materialScatterBoost, 0.1), pb.mul(this.presetSoftness, 0.08))
                ),
                0.18,
                0.48
              );
              this.$l.deepMix = pb.clamp(
                pb.add(
                  pb.add(0.52, pb.mul(this.profileSpread, 0.08)),
                  pb.add(pb.mul(this.materialScatterBoost, 0.12), pb.mul(this.presetTransmissionBoost, 0.08))
                ),
                0.42,
                0.72
              );
              this.$l.skinTint = pb.normalize(
                pb.max(
                  pb.mix(
                    this.baseDiffuseSafe,
                    pb.mul(
                      this.baseDiffuseSafe,
                      pb.mix(this.tint, this.profileTransmissionTint, pb.mul(this.profileBoundaryBleed, 0.2))
                    ),
                    this.epidermalMix
                  ),
                  pb.vec3(1e-4)
                )
              );
              this.$l.deepTint = pb.normalize(
                pb.max(
                  pb.mix(
                    this.skinTint,
                    pb.mul(
                      this.tint,
                      pb.mix(
                        pb.vec3(1),
                        this.profileTransmissionTint,
                        pb.clamp(
                          pb.add(
                            pb.mul(this.profileBoundaryBleed, 0.35),
                            pb.mul(
                              pb.sub(
                                1,
                                pb.clamp(
                                  pb.div(this.profileExtinctionScale, SSS._profileExtinctionEncodeMax),
                                  0,
                                  1
                                )
                              ),
                              0.28
                            )
                          ),
                          0,
                          0.8
                        )
                      )
                    ),
                    this.deepMix
                  ),
                  pb.vec3(1e-4)
                )
              );
              this.$l.baseSpecular = pb.max(pb.sub(this.baseColor.rgb, this.baseDiffuseColor), pb.vec3(0));
              this.$l.scatterBlend = pb.clamp(
                pb.mul(this.scatterStrength, pb.add(0.12, pb.mul(this.scatterMix, 0.24)), this.scatterMask),
                0,
                pb.add(
                  pb.add(0.7, pb.mul(this.materialScatterBoost, 0.22)),
                  this.$choice(
                    pb.equal(this.profilePreset, 1),
                    0.12,
                    this.$choice(pb.equal(this.profilePreset, 2), 0.08, 0)
                  )
                )
              );
              this.$l.blurredLuma = pb.dot(this.blurred, pb.vec3(0.2126, 0.7152, 0.0722));
              this.$l.profileBlurred = pb.mix(
                this.blurred,
                pb.mul(
                  this.blurred,
                  pb.mix(
                    pb.vec3(1),
                    this.skinTint,
                    pb.clamp(
                      pb.add(
                        pb.add(0.2, pb.mul(this.avgFalloff, 0.26)),
                        pb.add(pb.mul(this.materialScatterBoost, 0.16), pb.mul(this.presetSoftness, 0.18))
                      ),
                      0,
                      0.72
                    )
                  )
                ),
                pb.clamp(
                  pb.add(
                    pb.add(0.14, pb.mul(this.radiusResponse, 0.18)),
                    pb.add(
                      pb.mul(this.avgFalloff, 0.08),
                      pb.add(pb.mul(this.materialScatterBoost, 0.16), pb.mul(this.presetSoftness, 0.16))
                    )
                  ),
                  0,
                  0.58
                )
              );
              this.$l.warmBlur = pb.mul(
                pb.max(this.blurredLuma, pb.mul(this.baseDiffuseLuma, 0.82)),
                this.deepTint
              );
              this.profileBlurred = pb.mix(
                this.profileBlurred,
                this.warmBlur,
                pb.clamp(
                  pb.add(
                    pb.add(0.1, pb.mul(this.avgFalloff, 0.08)),
                    pb.add(pb.mul(this.materialScatterBoost, 0.12), pb.mul(this.presetSoftness, 0.08))
                  ),
                  0.08,
                  0.32
                )
              );
              this.$l.blurredClamped = pb.min(
                this.profileBlurred,
                pb.add(
                  this.baseDiffuseColor,
                  pb.mul(
                    this.deepTint,
                    pb.mul(
                      this.scatterMask,
                      pb.add(
                        pb.add(0.06, pb.mul(this.radiusResponse, 0.18)),
                        pb.add(
                          pb.mul(this.avgFalloff, 0.08),
                          pb.add(pb.mul(this.materialScatterBoost, 0.2), pb.mul(this.presetEnergyBoost, 0.18))
                        )
                      )
                    )
                  )
                )
              );
              this.$l.scattered = pb.mix(this.baseDiffuseColor, this.blurredClamped, this.scatterBlend);
              this.$l.terminatorLift = pb.mul(
                this.baseDiffuseColor,
                this.deepTint,
                this.scatterStrength,
                this.terminatorWrap,
                pb.add(
                  pb.add(0.014, pb.mul(this.radiusResponse, 0.022)),
                  pb.add(
                    pb.mul(this.profileSpread, 0.012),
                    pb.add(pb.mul(this.materialScatterBoost, 0.02), pb.mul(this.presetSoftness, 0.012))
                  )
                ),
                pb.sub(1, pb.mul(this.specMask, 0.45))
              );
              this.$l.multiScatterLift = pb.mul(
                pb.max(pb.sub(this.blurredClamped, this.baseDiffuseColor), pb.vec3(0)),
                this.scatterStrength,
                this.multiScatter,
                this.scatterMask,
                pb.add(
                  0.08,
                  pb.mul(
                    this.radiusResponse,
                    pb.add(
                      pb.add(0.09, pb.mul(this.materialScatterBoost, 0.08)),
                      pb.add(
                        pb.mul(this.presetSoftness, 0.06),
                        pb.add(
                          pb.mul(pb.sub(this.profileScatterScale, 1), 0.04),
                          pb.mul(this.profileDiffusionSoftness, 0.03)
                        )
                      )
                    )
                  )
                )
              );
              this.$l.subdermalFill = pb.mul(
                this.deepTint,
                this.scatterStrength,
                pb.add(
                  pb.mul(
                    this.shadowMask,
                    pb.add(
                      pb.add(0.026, pb.mul(this.radiusResponse, 0.08)),
                      pb.add(pb.mul(this.profileSpread, 0.045), pb.mul(this.materialScatterBoost, 0.05))
                    )
                  ),
                  pb.add(
                    pb.add(0.004, pb.mul(this.avgFalloff, 0.012)),
                    pb.add(pb.mul(this.profileSpread, 0.004), pb.mul(this.materialScatterBoost, 0.008))
                  )
                ),
                this.scatterMask,
                pb.sub(1, pb.mul(this.specMask, 0.62))
              );
              this.$l.veilColor = pb.mix(
                this.blurredClamped,
                pb.mul(this.blurredClamped, this.skinTint),
                0.16
              );
              this.$l.softVeil = pb.mul(
                this.veilColor,
                this.scatterStrength,
                this.scatterMask,
                pb.add(
                  pb.add(
                    pb.add(0.002, pb.mul(this.materialScatterBoost, 0.004)),
                    pb.mul(this.presetSoftness, 0.004)
                  ),
                  pb.mul(
                    this.radiusResponse,
                    pb.add(
                      pb.add(0.007, pb.mul(this.avgFalloff, 0.007)),
                      pb.add(
                        pb.mul(this.profileSpread, 0.003),
                        pb.add(pb.mul(this.materialScatterBoost, 0.006), pb.mul(this.presetSoftness, 0.004))
                      )
                    )
                  )
                ),
                pb.sub(1, pb.mul(this.specMask, 0.55))
              );
              this.$l.scatteredDiffuse = pb.add(
                this.scattered,
                pb.add(
                  this.terminatorLift,
                  pb.add(this.multiScatterLift, pb.add(this.subdermalFill, this.softVeil))
                )
              );
              this.$l.energyLimit = pb.add(
                this.baseDiffuseColor,
                pb.mul(
                  this.deepTint,
                  this.scatterStrength,
                  this.scatterMask,
                  pb.add(
                    pb.add(
                      pb.add(0.1, pb.mul(this.radiusResponse, 0.18)),
                      pb.add(pb.mul(this.avgFalloff, 0.08), pb.mul(this.profileSpread, 0.04))
                    ),
                    pb.add(pb.mul(this.materialScatterBoost, 0.28), this.presetEnergyBoost)
                  )
                )
              );
              this.$l.scatterBudget = pb.max(pb.sub(this.energyLimit, this.baseDiffuseColor), pb.vec3(0));
              this.$l.scatterDelta = pb.max(pb.sub(this.scatteredDiffuse, this.baseDiffuseColor), pb.vec3(0));
              this.$l.scatteredDiffuse = pb.add(
                this.baseDiffuseColor,
                pb.min(this.scatterDelta, this.scatterBudget)
              );
              this.$l.transmissionBudget = pb.mul(
                this.deepTint,
                this.scatterStrength,
                this.materialTransmissionResponse,
                this.transmissionStrength,
                this.profileTransmissionScale,
                pb.add(
                  pb.add(
                    pb.add(0.12, pb.mul(this.radiusResponse, 0.2)),
                    pb.mul(this.materialTransmissionSoftness, 0.2)
                  ),
                  pb.add(
                    pb.mul(this.avgFalloff, 0.12),
                    pb.add(
                      pb.mul(this.profileSpread, 0.12),
                      pb.add(
                        pb.mul(this.materialScatterBoost, 0.12),
                        pb.mul(this.presetTransmissionBoost, 0.22)
                      )
                    )
                  )
                ),
                pb.mix(0.82, 1.18, this.profileScatterScaleNorm)
              );
              this.$l.diffuseHeadroom = pb.mul(
                this.transmissionBudget,
                pb.add(
                  pb.add(1.65, pb.mul(this.materialTransmissionResponse, 0.9)),
                  pb.add(
                    pb.add(pb.mul(this.materialTransmissionSoftness, 0.55), pb.mul(this.profileSpread, 0.2)),
                    pb.mul(this.profileTransmissionScale, 0.22)
                  )
                )
              );
              this.result = pb.add(this.baseSpecular, this.scatteredDiffuse);
              this.$if(pb.greaterThan(this.transmissionStrength, 0), function () {
                this.$l.viewDirVS = pb.normalize(pb.neg(this.viewPos));
                this.$l.viewDirWS = pb.normalize(pb.mul(this.invViewMatrix, pb.vec4(this.viewDirVS, 0)).xyz);
                this.$l.rim = pb.pow(
                  pb.clamp(pb.sub(1, pb.abs(pb.dot(this.normalWS, this.viewDirWS))), 0, 1),
                  pb.max(this.transmissionPower, 0.1)
                );
                this.$l.transmissionShadowSoftness = pb.clamp(
                  pb.add(
                    pb.add(0.08, pb.mul(this.profileDiffusionSoftness, 0.18)),
                    pb.add(
                      pb.mul(this.materialTransmissionSoftness, 0.18),
                      pb.add(pb.mul(this.screenThinness, 0.12), pb.mul(this.profileBoundaryBleed, 0.08))
                    )
                  ),
                  0,
                  0.6
                );
                this.$l.transmissionShadowFloor = pb.clamp(
                  pb.add(
                    pb.add(pb.mul(this.materialThicknessField, 0.06), pb.mul(this.edgeThinBoost, 0.48)),
                    pb.add(
                      pb.mul(this.curvatureThinBoost, 0.32),
                      pb.add(
                        pb.mul(this.profileBoundaryBleed, 0.06),
                        pb.mul(this.profileTransmissionScale, 0.08)
                      )
                    )
                  ),
                  0,
                  0.34
                );
                this.transmissionShadow = pb.clamp(
                  pb.max(
                    pb.mix(
                      this.transmissionShadowRaw,
                      pb.pow(pb.clamp(this.transmissionShadowRaw, 1e-4, 1), 0.7),
                      this.transmissionShadowSoftness
                    ),
                    this.transmissionShadowFloor
                  ),
                  0.04,
                  1
                );
                this.transmissionLightAttenuation = pb.mul(
                  this.mainLightAttenuation,
                  this.transmissionShadow
                );
                this.debugTransmissionShadow = this.transmissionShadow;
                this.debugProfileBoundary = pb.clamp(
                  pb.vec3(
                    this.profileBoundaryBleed,
                    this.transmissionShadowSoftness,
                    this.transmissionShadowFloor
                  ),
                  pb.vec3(0),
                  pb.vec3(1)
                );
                this.debugProfileTransmission = pb.clamp(
                  pb.vec3(
                    pb.div(this.profileTransmissionScale, 1.35),
                    this.materialTransmissionResponse,
                    this.transmissionShadow
                  ),
                  pb.vec3(0),
                  pb.vec3(1)
                );
                this.$l.backLit = pb.mul(
                  pb.pow(pb.clamp(pb.dot(pb.neg(this.normalWS), this.sunDirWS), 0, 1), 1.5),
                  this.transmissionLightAttenuation
                );
                this.$l.thicknessBackScatter = pb.clamp(
                  pb.add(
                    pb.add(pb.mul(this.backLit, 0.82), pb.mul(this.rim, 0.24)),
                    pb.mul(this.materialThicknessField, 0.08)
                  ),
                  0,
                  1
                );
                this.$l.thinPotential = pb.clamp(
                  pb.add(
                    pb.add(pb.mul(this.materialThicknessField, 0.78), this.edgeThinBoost),
                    pb.add(
                      this.curvatureThinBoost,
                      pb.mul(
                        pb.sqrt(pb.max(pb.mul(this.depthThinness, this.curvatureThinness), 0)),
                        pb.add(
                          pb.add(0.08, pb.mul(this.profileSpread, 0.06)),
                          pb.mul(pb.sub(this.profileDistribution, 0.5), 0.06)
                        )
                      )
                    )
                  ),
                  0,
                  1
                );
                this.$l.transmissionFocus = pb.clamp(
                  pb.mul(
                    pb.add(pb.mul(this.materialThicknessField, 0.72), pb.mul(this.thinPotential, 0.38)),
                    pb.add(pb.add(0.22, pb.mul(this.thicknessBackScatter, 0.72)), pb.mul(this.backLit, 0.08))
                  ),
                  0,
                  1
                );
                this.$l.thinRegion = pb.clamp(
                  pb.add(
                    pb.add(pb.mul(this.materialThicknessField, 0.86), pb.mul(this.transmissionFocus, 0.74)),
                    pb.add(
                      pb.add(pb.mul(this.edgeThinBoost, 0.9), pb.mul(this.curvatureThinBoost, 0.5)),
                      pb.add(pb.mul(this.backLit, 0.1), pb.mul(this.profileSpread, 0.05))
                    )
                  ),
                  0,
                  1
                );
                this.$l.debugBlueSeed = pb.clamp(
                  pb.mul(
                    this.materialThicknessField,
                    pb.max(
                      pb.mul(this.thinRegion, pb.add(0.72, pb.mul(this.backLit, 0.18))),
                      pb.mul(this.curvatureThinness, pb.add(0.34, pb.mul(this.materialThicknessField, 0.22)))
                    ),
                    pb.clamp(
                      pb.add(
                        pb.add(pb.add(0.16, pb.mul(this.backLit, 0.26)), pb.mul(this.edgeThinBoost, 0.85)),
                        pb.add(
                          pb.mul(this.curvatureThinBoost, 0.4),
                          pb.mul(pb.sub(1, this.depthThinness), 0.18)
                        )
                      ),
                      0,
                      1
                    ),
                    pb.add(0.72, pb.mul(this.profileSpread, 0.08))
                  ),
                  0,
                  1
                );
                this.$l.debugBlueDisplay = pb.pow(
                  pb.clamp(pb.mul(pb.clamp(pb.sub(this.debugBlueSeed, 0.015), 0, 1), 2.15), 0, 1),
                  0.72
                );
                this.$l.debugGreenDisplay = pb.clamp(
                  pb.mul(
                    this.curvatureThinness,
                    pb.sub(1, pb.mul(this.depthThinness, 0.78)),
                    pb.sub(1, pb.mul(this.debugBlueDisplay, 0.26))
                  ),
                  0,
                  1
                );
                this.debugThinnessLayers = pb.vec3(
                  pb.clamp(
                    pb.mul(
                      pb.clamp(pb.sub(this.depthThinness, pb.mul(this.curvatureThinness, 0.16)), 0, 1),
                      pb.sub(1, pb.mul(this.debugBlueDisplay, 0.98))
                    ),
                    0,
                    1
                  ),
                  this.debugGreenDisplay,
                  this.debugBlueDisplay
                );
                this.$l.sunColor = pb.min(
                  pb.mul(
                    this.sunColorIntensity.rgb,
                    this.sunColorIntensity.a,
                    this.transmissionLightAttenuation
                  ),
                  pb.vec3(4)
                );
                this.$l.capturedTransmission = pb.mul(
                  pb.mix(
                    this.baseTransmissionColor,
                    pb.mul(this.baseTransmissionColor, this.deepTint, this.profileTransmissionTint),
                    pb.clamp(
                      pb.add(
                        pb.add(0.16, pb.mul(this.avgFalloff, 0.12)),
                        pb.add(
                          pb.mul(this.materialScatterBoost, 0.1),
                          pb.mul(this.presetTransmissionBoost, 0.18)
                        )
                      ),
                      0,
                      0.45
                    )
                  ),
                  pb.mix(1.08, 0.64, this.extinctionNorm),
                  this.materialTransmissionResponse,
                  pb.sub(1, pb.mul(this.specMask, 0.18))
                );
                this.$l.capturedTransmissionStrength = this.max3(this.capturedTransmission);
                this.$l.profileTransmission = pb.mul(
                  this.capturedTransmission,
                  this.transmissionStrength,
                  this.scatterStrength,
                  this.transmissionShadow,
                  pb.add(
                    pb.add(0.88, pb.mul(this.radiusResponse, 0.18)),
                    pb.add(
                      pb.add(pb.mul(this.profileSpread, 0.08), pb.mul(this.thinRegion, 0.12)),
                      pb.add(
                        pb.mul(this.materialScatterBoost, 0.12),
                        pb.mul(this.presetTransmissionBoost, 0.18)
                      )
                    )
                  ),
                  pb.add(
                    pb.add(0.26, pb.mul(this.thicknessBackScatter, 0.48)),
                    pb.add(pb.mul(this.materialThicknessField, 0.22), pb.mul(this.thinRegion, 0.08))
                  )
                );
                this.$l.backScatterCore = pb.mul(
                  this.deepTint,
                  pb.max(this.blurredLuma, pb.mul(this.baseDiffuseLuma, 0.3)),
                  this.materialThicknessField,
                  this.materialTransmissionResponse,
                  this.transmissionStrength,
                  this.transmissionShadow,
                  pb.add(
                    pb.add(
                      pb.add(
                        pb.add(0.12, pb.mul(this.thicknessBackScatter, 0.34)),
                        pb.add(pb.mul(this.materialThicknessField, 0.22), pb.mul(this.thinRegion, 0.12))
                      ),
                      pb.mul(this.materialTransmissionSoftness, 0.14)
                    ),
                    pb.add(pb.mul(this.radiusResponse, 0.08), pb.mul(this.presetTransmissionBoost, 0.12))
                  ),
                  pb.add(
                    pb.add(0.26, pb.mul(this.thicknessBackScatter, 0.52)),
                    pb.add(pb.mul(this.materialThicknessField, 0.22), pb.mul(this.thinRegion, 0.12))
                  ),
                  pb.sub(1, pb.mul(this.specMask, 0.35))
                );
                this.$l.rimFallback = pb.mul(
                  this.rim,
                  this.materialTransmissionResponse,
                  this.transmissionStrength,
                  this.scatterStrength,
                  this.transmissionShadow,
                  this.radiusResponse,
                  pb.add(
                    pb.add(
                      pb.add(0.028, pb.mul(this.avgFalloff, 0.04)),
                      pb.mul(this.materialTransmissionSoftness, 0.03)
                    ),
                    pb.add(
                      pb.mul(this.profileSpread, 0.03),
                      pb.add(
                        pb.mul(this.materialScatterBoost, 0.04),
                        pb.mul(this.presetTransmissionBoost, 0.06)
                      )
                    )
                  )
                );
                this.$l.warmTransmissionTint = pb.normalize(
                  pb.max(
                    pb.mix(
                      pb.mix(this.deepTint, this.profileTransmissionTint, 0.35),
                      pb.mul(this.profileTransmissionTint, pb.vec3(1.0, 0.36, 0.24)),
                      pb.clamp(
                        pb.add(
                          pb.add(0.18, pb.mul(this.presetTransmissionBoost, 0.26)),
                          pb.add(
                            pb.mul(this.materialThicknessField, 0.24),
                            pb.mul(this.thicknessBackScatter, 0.22)
                          )
                        ),
                        0,
                        0.72
                      )
                    ),
                    pb.vec3(1e-4)
                  )
                );
                this.$l.warmTransmissionStrength = pb.clamp(
                  pb.mul(
                    pb.add(
                      pb.add(0.08, pb.mul(this.materialThicknessField, 0.2)),
                      pb.add(
                        pb.mul(this.thicknessBackScatter, 0.26),
                        pb.mul(this.presetTransmissionBoost, 0.12)
                      )
                    ),
                    pb.mix(1.06, 0.72, this.extinctionNorm)
                  ),
                  0.06,
                  0.48
                );
                this.$l.broadTransmission = pb.mul(
                  this.warmTransmissionTint,
                  this.sunColor,
                  this.materialThicknessField,
                  this.materialTransmissionResponse,
                  this.transmissionStrength,
                  this.scatterStrength,
                  pb.add(
                    pb.add(0.1, pb.mul(this.thicknessBackScatter, 0.42)),
                    pb.add(pb.mul(this.materialTransmissionSoftness, 0.12), pb.mul(this.thinRegion, 0.08))
                  ),
                  pb.add(
                    pb.add(0.24, pb.mul(this.materialThicknessField, 0.26)),
                    pb.mul(this.profileSpread, 0.08)
                  ),
                  pb.sub(1, pb.mul(this.specMask, 0.3))
                );
                this.$l.subdermalTransmission = pb.mul(
                  this.warmTransmissionTint,
                  pb.max(this.baseDiffuseLuma, pb.mul(this.blurredLuma, 0.8)),
                  this.materialThicknessField,
                  this.materialTransmissionResponse,
                  this.transmissionStrength,
                  this.scatterStrength,
                  this.transmissionShadow,
                  this.warmTransmissionStrength,
                  pb.add(
                    pb.add(0.18, pb.mul(this.thicknessBackScatter, 0.38)),
                    pb.add(pb.mul(this.thinRegion, 0.12), pb.mul(this.materialTransmissionSoftness, 0.08))
                  ),
                  pb.sub(1, pb.mul(this.specMask, 0.28))
                );
                this.$l.thin = pb.mul(
                  this.thicknessBackScatter,
                  this.materialThicknessField,
                  this.materialTransmissionResponse,
                  pb.add(
                    this.thicknessBackScatter,
                    pb.add(
                      pb.mul(this.thinRegion, pb.add(0.18, pb.mul(this.presetTransmissionBoost, 0.16))),
                      pb.mul(
                        this.widthStrength,
                        pb.add(
                          pb.add(0.14, pb.mul(this.materialScatterBoost, 0.08)),
                          pb.mul(this.presetTransmissionBoost, 0.08)
                        )
                      ),
                      pb.mul(
                        this.profileSpread,
                        pb.add(
                          pb.add(0.08, pb.mul(this.materialScatterBoost, 0.06)),
                          pb.mul(this.presetTransmissionBoost, 0.08)
                        )
                      )
                    )
                  ),
                  this.transmissionStrength,
                  this.scatterStrength,
                  this.transmissionShadow,
                  pb.add(
                    pb.add(0.16, pb.mul(this.avgFalloff, 0.34)),
                    pb.add(
                      pb.add(pb.mul(this.profileSpread, 0.18), pb.mul(this.thinRegion, 0.22)),
                      pb.add(pb.mul(this.materialScatterBoost, 0.12), this.presetTransmissionBoost)
                    )
                  ),
                  pb.sub(1, pb.mul(this.specMask, 0.42))
                );
                this.$l.transmissionColor = pb.add(
                  pb.add(
                    pb.add(pb.add(this.profileTransmission, this.backScatterCore), this.broadTransmission),
                    this.subdermalTransmission
                  ),
                  pb.mul(
                    pb.add(
                      pb.mul(this.warmTransmissionTint, this.sunColor, this.thin),
                      pb.mul(this.skinTint, this.rimFallback)
                    ),
                    this.$choice(
                      pb.equal(this.hasTransmissionTex, 0),
                      1,
                      pb.clamp(
                        pb.add(
                          0.08,
                          pb.mul(
                            pb.clamp(pb.sub(1, pb.mul(this.capturedTransmissionStrength, 2.4)), 0, 1),
                            0.22
                          )
                        ),
                        0.08,
                        0.3
                      )
                    )
                  )
                );
                this.$l.transmissionHeadroom = pb.add(
                  this.diffuseHeadroom,
                  pb.mul(
                    this.warmTransmissionTint,
                    this.materialThicknessField,
                    this.materialTransmissionResponse,
                    this.transmissionStrength,
                    pb.add(
                      pb.add(0.04, pb.mul(this.thicknessBackScatter, 0.12)),
                      pb.mul(this.thinRegion, 0.06)
                    )
                  )
                );
                this.$l.transmittedDiffuse = pb.min(this.transmissionColor, this.transmissionHeadroom);
                this.$l.transmittedDiffuseLuma = pb.dot(
                  this.transmittedDiffuse,
                  pb.vec3(0.2126, 0.7152, 0.0722)
                );
                this.$l.visibleTransmissionMask = pb.clamp(
                  pb.add(
                    pb.add(pb.mul(this.materialThicknessField, 0.72), pb.mul(this.thinRegion, 0.34)),
                    pb.add(
                      pb.mul(this.thicknessBackScatter, 0.28),
                      pb.add(
                        pb.mul(this.materialTransmissionSoftness, 0.08),
                        pb.add(
                          pb.mul(this.profileTransmissionScale, 0.12),
                          pb.mul(this.profileDiffusionSoftness, 0.06)
                        )
                      )
                    )
                  ),
                  0,
                  1
                );
                this.$l.visibleTransmissionChroma = pb.clamp(
                  pb.add(
                    pb.add(0.66, pb.mul(this.visibleTransmissionMask, 0.32)),
                    pb.add(
                      pb.mul(this.thicknessBackScatter, 0.24),
                      pb.mul(this.presetTransmissionBoost, 0.14)
                    )
                  ),
                  0.52,
                  1
                );
                this.$l.visibleTransmissionTint = pb.normalize(
                  pb.max(
                    pb.mix(
                      this.warmTransmissionTint,
                      pb.mul(this.profileTransmissionTint, pb.vec3(1.0, 0.14, 0.08)),
                      pb.clamp(
                        pb.add(
                          pb.add(0.5, pb.mul(this.visibleTransmissionMask, 0.22)),
                          pb.mul(this.thicknessBackScatter, 0.18)
                        ),
                        0,
                        0.92
                      )
                    ),
                    pb.vec3(1e-4)
                  )
                );
                this.$l.visibleTransmissionWarm = pb.mix(
                  this.transmittedDiffuse,
                  pb.mul(this.visibleTransmissionTint, this.transmittedDiffuseLuma),
                  this.visibleTransmissionChroma
                );
                this.$l.visibleTransmissionGain = pb.clamp(
                  pb.add(
                    pb.add(2.35, pb.mul(this.visibleTransmissionMask, 1.85)),
                    pb.add(
                      pb.mul(this.thicknessBackScatter, 1.3),
                      pb.add(
                        pb.mul(this.materialTransmissionSoftness, 0.42),
                        pb.mul(this.profileTransmissionScale, 0.72)
                      )
                    )
                  ),
                  2,
                  6.4
                );
                this.$l.visibleTransmissionHeadroom = pb.add(
                  pb.mul(
                    this.transmissionHeadroom,
                    pb.add(
                      pb.add(2.15, pb.mul(this.visibleTransmissionMask, 1.1)),
                      pb.mul(this.thicknessBackScatter, 0.72)
                    )
                  ),
                  pb.mul(
                    this.visibleTransmissionTint,
                    this.visibleTransmissionMask,
                    this.transmittedDiffuseLuma,
                    pb.add(
                      pb.add(0.12, pb.mul(this.thicknessBackScatter, 0.18)),
                      pb.mul(this.materialThicknessField, 0.14)
                    )
                  )
                );
                this.$l.visibleTransmission = pb.min(
                  pb.mul(this.visibleTransmissionWarm, this.visibleTransmissionGain, this.transmissionShadow),
                  this.visibleTransmissionHeadroom
                );
                this.$l.visibleTransmissionReveal = pb.clamp(
                  pb.mul(
                    this.visibleTransmissionMask,
                    this.transmissionShadow,
                    pb.add(
                      pb.add(0.1, pb.mul(this.thicknessBackScatter, 0.25)),
                      pb.mul(this.materialThicknessField, 0.12)
                    )
                  ),
                  0,
                  0.38
                );
                this.result = pb.mix(
                  this.result,
                  pb.mul(this.result, pb.vec3(0.84, 0.68, 0.64)),
                  this.visibleTransmissionReveal
                );
                this.debugThinLighting = this.visibleTransmission;
                this.result = pb.add(this.result, this.visibleTransmission);
              });
            }
          );
          this.$if(pb.notEqual(this.debugView, 0), function () {
            this.$if(pb.lessThan(this.depth01, 1), function () {
              this.$if(pb.equal(this.debugView, 1), function () {
                this.result = this.$choice(this.profileActive, pb.vec3(this.profileStrength), pb.vec3(0));
              })
                .$elseif(pb.equal(this.debugView, 2), function () {
                  this.result = this.$choice(
                    this.profileActive,
                    pb.vec3(this.scatterSoftnessAuthor),
                    pb.vec3(0)
                  );
                })
                .$elseif(pb.equal(this.debugView, 3), function () {
                  this.$l.debugSlot = this.readProfileSlot(this.param);
                  this.result = this.$choice(
                    this.profileActive,
                    pb.clamp(
                      pb.div(this.readProfileRadius(this.debugSlot), pb.vec3(8)),
                      pb.vec3(0),
                      pb.vec3(1)
                    ),
                    pb.vec3(0)
                  );
                })
                .$elseif(pb.equal(this.debugView, 4), function () {
                  this.$l.debugSlot = this.readProfileSlot(this.param);
                  this.result = this.$choice(
                    this.profileActive,
                    pb.clamp(this.readProfileFalloff(this.debugSlot), pb.vec3(0), pb.vec3(1)),
                    pb.vec3(0)
                  );
                })
                .$elseif(pb.equal(this.debugView, 5), function () {
                  this.result = this.$choice(this.profileActive, this.debugProfileEnergy, pb.vec3(0));
                })
                .$elseif(pb.equal(this.debugView, 6), function () {
                  this.result = this.$choice(this.profileActive, this.debugProfileTransmission, pb.vec3(0));
                })
                .$elseif(pb.equal(this.debugView, 7), function () {
                  this.result = this.$choice(this.profileActive, this.debugProfileBoundary, pb.vec3(0));
                })
                .$elseif(pb.equal(this.debugView, 8), function () {
                  this.result = this.baseDiffuseColor;
                })
                .$elseif(pb.equal(this.debugView, 9), function () {
                  this.result = this.$choice(
                    this.profileActive,
                    pb.textureSampleLevel(this.blurTex, this.uv, 0).rgb,
                    pb.vec3(0)
                  );
                })
                .$elseif(pb.equal(this.debugView, 10), function () {
                  this.result = this.$choice(this.profileActive, this.debugThinnessLayers, pb.vec3(0));
                })
                .$elseif(pb.equal(this.debugView, 11), function () {
                  this.result = this.$choice(
                    this.profileActive,
                    pb.vec3(
                      this.debugTransmissionMask,
                      this.debugTransmissionMask,
                      this.debugTransmissionMask
                    ),
                    pb.vec3(0)
                  );
                })
                .$elseif(pb.equal(this.debugView, 12), function () {
                  this.result = this.$choice(this.profileActive, this.debugThinLighting, pb.vec3(0));
                })
                .$elseif(pb.equal(this.debugView, 13), function () {
                  this.result = this.$choice(
                    this.profileActive,
                    pb.vec3(
                      this.debugTransmissionShadow,
                      this.debugTransmissionShadow,
                      this.debugTransmissionShadow
                    ),
                    pb.vec3(0)
                  );
                });
            }).$else(function () {
              this.result = pb.vec3(0);
            });
          });
          this.$if(pb.equal(this.srgbOut, 0), function () {
            this.$outputs.outColor = pb.vec4(this.result, this.baseColor.a);
          }).$else(function () {
            this.$outputs.outColor = pb.vec4(linearToGamma(this, this.result), this.baseColor.a);
          });
        });
      }
    })!;
    program.name = '@SSS_Combine';
    return program;
  }

  private createSampleOffsets(kernelRadius: number) {
    const sampleCount = Math.max(1, Math.ceil(kernelRadius / 2));
    const data = new Float32Array(4 * (sampleCount + 1));
    for (let i = 1; i <= sampleCount; i++) {
      const tap0 = i * 2 - 1;
      const tap1 = Math.min(i * 2, kernelRadius);
      data[i * 4 + 0] = tap1 !== tap0 ? (tap0 + tap1) * 0.5 : tap0;
    }
    return data;
  }

  private ensureProfileLUT(ctx: DrawContext): Texture2D {
    const device = ctx.device;
    if (!SSS._profileLUT || SSS._profileLUT.device !== device) {
      SSS._profileLUT = device.createTexture2D('rgba8unorm', SSS._profileLUTWidth, SSS._profileLUTHeight, {
        mipmapping: false
      })!;
      SSS._profileLUTVersion = -1;
    }
    if (SSS._profileLUTVersion !== SubsurfaceProfile.version) {
      const data = new Uint8Array(SSS._profileLUTWidth * SSS._profileLUTHeight * 4);
      const encodeUnit = (value: number) => Math.max(0, Math.min(255, Math.round(value * 255)));
      const encodeScaled = (value: number, maxValue: number) =>
        Math.max(0, Math.min(255, Math.round((Math.max(0, Math.min(maxValue, value)) / maxValue) * 255)));
      for (let slot = 1; slot < SSS._profileLUTWidth; slot++) {
        const profile = SubsurfaceProfile.getProfileBySlot(slot);
        if (!profile) {
          continue;
        }
        const presetTintBias = profile.getDerivedTintBias();
        const presetResponse = profile.getDerivedTransmissionResponse();
        const radiusOffset = slot * 4;
        data[radiusOffset + 0] = encodeScaled(profile.scatterRadius.x, SSS._profileRadiusEncodeMax);
        data[radiusOffset + 1] = encodeScaled(profile.scatterRadius.y, SSS._profileRadiusEncodeMax);
        data[radiusOffset + 2] = encodeScaled(profile.scatterRadius.z, SSS._profileRadiusEncodeMax);
        data[radiusOffset + 3] = 255;
        const falloffOffset = (SSS._profileLUTWidth + slot) * 4;
        data[falloffOffset + 0] = encodeUnit(profile.falloffColor.x);
        data[falloffOffset + 1] = encodeUnit(profile.falloffColor.y);
        data[falloffOffset + 2] = encodeUnit(profile.falloffColor.z);
        data[falloffOffset + 3] = 255;
        const tintBiasOffset = (SSS._profileLUTWidth * 2 + slot) * 4;
        data[tintBiasOffset + 0] = encodeUnit(presetTintBias[0]);
        data[tintBiasOffset + 1] = encodeUnit(presetTintBias[1]);
        data[tintBiasOffset + 2] = encodeUnit(presetTintBias[2]);
        data[tintBiasOffset + 3] = 255;
        const responseOffset = (SSS._profileLUTWidth * 3 + slot) * 4;
        data[responseOffset + 0] = encodeUnit(presetResponse[0]);
        data[responseOffset + 1] = encodeUnit(presetResponse[1]);
        data[responseOffset + 2] = encodeUnit((presetResponse[2] + 0.25) / 0.75);
        data[responseOffset + 3] = encodeUnit((presetResponse[3] + 0.25) / 0.75);
        const settingsAOffset = (SSS._profileLUTWidth * 4 + slot) * 4;
        data[settingsAOffset + 0] = encodeScaled(profile.worldUnitScale, SSS._profileWorldScaleEncodeMax);
        data[settingsAOffset + 1] = encodeUnit(profile.boundaryColorBleed);
        data[settingsAOffset + 2] = encodeScaled(profile.normalScale, SSS._profileNormalScaleEncodeMax);
        data[settingsAOffset + 3] = encodeUnit(profile.scatteringDistribution);
        const tintOffset = (SSS._profileLUTWidth * 5 + slot) * 4;
        data[tintOffset + 0] = encodeUnit(profile.transmissionTintColor.x);
        data[tintOffset + 1] = encodeUnit(profile.transmissionTintColor.y);
        data[tintOffset + 2] = encodeUnit(profile.transmissionTintColor.z);
        data[tintOffset + 3] = 255;
        const settingsBOffset = (SSS._profileLUTWidth * 6 + slot) * 4;
        data[settingsBOffset + 0] = encodeScaled(profile.extinctionScale, SSS._profileExtinctionEncodeMax);
        data[settingsBOffset + 1] = encodeScaled(profile.scale, SSS._profileWorldScaleEncodeMax);
        data[settingsBOffset + 2] = encodeUnit(profile.strength / 2);
        data[settingsBOffset + 3] = 255;
      }
      SSS._profileLUT!.update(data, 0, 0, SSS._profileLUTWidth, SSS._profileLUTHeight);
      SSS._profileLUTVersion = SubsurfaceProfile.version;
    }
    return SSS._profileLUT!;
  }
}
