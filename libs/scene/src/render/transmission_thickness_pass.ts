import { DEPTH_FARTHEST, REVERSE_Z, Vector2, Vector4 } from '@zephyr3d/base';
import type { Nullable } from '@zephyr3d/base';
import type {
  AbstractDevice,
  BindGroup,
  FrameBuffer,
  GPUProgram,
  RenderStateSet,
  Texture2D
} from '@zephyr3d/device';
import type { DrawContext } from './drawable';
import type { PunctualLight } from '../scene/light';
import type { ShadowMapParams } from '../shadow/shadowmapper';
import { ShaderHelper } from '../material/shader/helper';
import { drawFullscreenQuad } from './fullscreenquad';
import { LIGHT_TYPE_DIRECTIONAL, LIGHT_TYPE_POINT, LIGHT_TYPE_RECT, MAX_SHADOW_MASK_LIGHTS } from '../values';
import { ndcToShadowCoord } from '../shaders/shadow';
import { SHADOW_MASK_LIGHTS_PER_LAYER } from './shadow_mask_pass';
import {
  SSS_MAX_TRANSMISSION_OPTICAL_DEPTH,
  SSS_OPTICAL_DEPTH_PER_WORLD_UNIT,
  SSS_TRANSMISSION_OPTICAL_DEPTH_BIAS,
  SSS_TRANSMISSION_OPTICAL_DEPTH_FLOOR,
  SSSProfile
} from '../material/sssprofile';
import { fetchSampler } from '../utility/misc';

const UNIFORM_NAME_SHADOW_DEPTH = 'Z_UniformShadowDepth';

/**
 * Largest optical depth the transmission profile is defined over.
 *
 * @remarks
 * Re-exported from {@link SSS_MAX_TRANSMISSION_OPTICAL_DEPTH}: the encoding this
 * pass writes (`1 - opticalDepth / MAX`) and the baked profile the BxDF indexes
 * with it must agree on the same number, and the profile owns the baking.
 *
 * The clamp floor and additive bias below are in profile millimetres, not world
 * units, so a producer feeding `opticalDepthScale` has to convert.
 *
 * @internal
 */
export const MAX_TRANSMISSION_OPTICAL_DEPTH = SSS_MAX_TRANSMISSION_OPTICAL_DEPTH;

/**
 * Poisson disc the light-space thickness is averaged over.
 *
 * @remarks
 * Eight points of a Vogel (golden-angle) spiral plus their antipodes, so the
 * offsets sum to exactly zero and the radii spread from 0.25 to 0.97 of the
 * search radius.
 *
 * The zero mean is the load-bearing property, not the even coverage: averaging
 * over a footprint the blocker's depth varies across measures the depth at the
 * footprint's centroid, so a displaced centroid reads the blocker at the wrong
 * place, with an error proportional to `tan θ` for a surface tilted by `θ`.
 *
 * UE5's own 63-entry table (`TransmissionThickness.ush`) is sorted by x, so no
 * contiguous window of it is centred - hence the purpose-built disc here.
 *
 * @internal
 */
const POISSON_DISC: number[][] = [
  [0.25, 0.0],
  [-0.31929, 0.292496],
  [0.048872, -0.556877],
  [0.402444, 0.524918],
  [-0.738535, -0.130636],
  [0.699605, -0.445031],
  [-0.234004, 0.870484],
  [-0.446271, -0.859268],
  [-0.25, 0.0],
  [0.31929, -0.292496],
  [-0.048872, 0.556877],
  [-0.402444, -0.524918],
  [0.738535, 0.130636],
  [-0.699605, 0.445031],
  [0.234004, -0.870484],
  [0.446271, 0.859268]
];

/**
 * Radius the disc is scaled to, in shadow map texels.
 *
 * @remarks
 * One texel, which is UE5's: `ShadowFilterRadius = ShadowBufferSize.w` is the
 * reciprocal of the map size, and the disc's entries span `[-1, 1]`, so its taps
 * cover the 2x2 texels around the sample.
 *
 * This exists for the *light-space silhouette*, where the shadow map holds a step
 * and a quantised blocker adds a comb of texel-shaped teeth. Averaging over a
 * footprint softens it; filtering the individual tap is not a substitute, since
 * bilinear reconstructs within a texel but the boundary still runs along the
 * texel grid.
 *
 * Measured on `transmission-thickness-sphere` the disc is the largest single win
 * in the pass - dropping it takes the residual from 5.6 to 21.9 levels. Widening
 * it to two texels buys nothing (6.0) and costs thin features. Note a flat slab
 * cannot measure any of this: a zero-mean kernel over a linear depth gradient
 * returns the value at its centre at any radius.
 *
 * Not going past one texel matters: a 1024 map fitted to a 3 m region has 3 mm
 * texels, and averaging over 2 of them is already the thickness of the ear being
 * measured. If thin features wash out, the lever is the shadow map's resolution
 * or fitted extent, not this.
 *
 * A build-time constant rather than a uniform so a radius of zero emits one tap
 * instead of sixteen identical ones.
 *
 * @internal
 */
const SEARCH_RADIUS_TEXELS = 1;

/**
 * The offsets actually sampled. A zero radius needs one tap, not sixteen copies
 * of it.
 * @internal
 */
const taps: number[][] = SEARCH_RADIUS_TEXELS > 0 ? POISSON_DISC : [[0, 0]];

/**
 * Whether a light can contribute back-lit transmission this frame.
 *
 * @remarks
 * Point lights are excluded because their shadow depth attachment is a cube
 * texture, and WGSL's `textureLoad` has no cube overload. They would need a
 * non-comparison sampler and `textureSampleLevel` instead; until then they
 * simply produce no transmission.
 *
 * @internal
 */
export function lightSupportsTransmission(light: PunctualLight, params: Nullable<ShadowMapParams>): boolean {
  return (
    !!light.transmission &&
    !!params?.shadowMapFramebuffer?.getDepthAttachment() &&
    params.lightType !== LIGHT_TYPE_POINT
  );
}

/**
 * Renders the screen-space light-space thickness used by subsurface transmission.
 *
 * @remarks
 * UE5's `CalculateEncodedOpticalDepth` (`TransmissionThickness.ush`) moved into
 * its own pass: UE5 packs the result into the `LightAttenuation` mask's G/A
 * channels, but this engine's mask spends one channel per light, so the thickness
 * gets its own `rgba8unorm` array with the *identical* `ordinal → layer/channel`
 * packing. Reusing the ordinal lets the material recover a light's thickness with
 * the same arithmetic {@link ShaderHelper.sampleShadowMask} uses.
 *
 * The depth comes from the shadow map's **depth attachment**, not the shadow
 * implementation's colour encoding: `d32f` and `d24s8` both resolve to about
 * 0.12 mm per step even across a 2 km cascade, whereas PCSS's preferred `r16f`
 * would quantise a 2 cm ear into a fraction of a step. That makes this pass
 * independent of the shadow mode.
 *
 * WebGPU only.
 *
 * @internal
 */
export class TransmissionThicknessRenderer {
  private _programs: Map<string, GPUProgram>;
  private _bindGroups: Map<string, BindGroup>;
  private _channelStates: Nullable<RenderStateSet[]>;
  private readonly _nearFar: Vector2;
  private readonly _invRenderSize: Vector2;
  private readonly _cameraPosition: Vector4;
  private readonly _cameraParams: Vector4;
  private readonly _profileTexelSize: Vector2;

  constructor() {
    this._programs = new Map();
    this._bindGroups = new Map();
    this._channelStates = null;
    this._nearFar = new Vector2();
    this._invRenderSize = new Vector2();
    this._cameraPosition = new Vector4();
    this._cameraParams = new Vector4();
    this._profileTexelSize = new Vector2();
  }

  /**
   * Render light-space thickness for every transmission-enabled light.
   *
   * @remarks
   * Absorption and unit scale are resolved per pixel from the profile table,
   * keyed by the id the depth prepass wrote. UE5 arranges it the same way — its
   * shadow projection reads the subsurface profile id straight out of the
   * GBuffer — and it is what lets two characters with different profiles share
   * one pass.
   *
   * @param ctx - Draw context, carrying `shadowMapInfo` for the lights.
   * @param depthTexture - Linear depth from the depth prepass.
   * @param profileIdTexture - Per-pixel skin profile id from the depth prepass,
   *   `0` where the pixel is not skin.
   * @param lights - Shadow-casting lights in clustered-buffer order, i.e. exactly
   *   the array {@link ShadowMaskRenderer.render} is given, so that ordinals agree.
   * @param getLayerFramebuffer - Resolves the framebuffer for array layer `k`.
   */
  render(
    ctx: DrawContext,
    depthTexture: Texture2D,
    profileIdTexture: Texture2D,
    lights: PunctualLight[],
    getLayerFramebuffer: (layer: number) => FrameBuffer
  ): void {
    const device = ctx.device;
    const numLights = Math.min(lights.length, MAX_SHADOW_MASK_LIGHTS);
    if (numLights === 0 || !ctx.shadowMapInfo) {
      return;
    }
    const profileTable = SSSProfile.getTable(device);
    if (!profileTable) {
      return;
    }
    const numLayers = Math.ceil(numLights / SHADOW_MASK_LIGHTS_PER_LAYER);
    const channelStates = this.getChannelStates(device);
    const savedShadowLight = ctx.currentShadowLight;
    this._profileTexelSize.setXY(1 / SSSProfile.tableColumns, 1 / SSSProfile.tableRows);

    device.pushDeviceStates();
    for (let layer = 0; layer < numLayers; layer++) {
      device.setFramebuffer(getLayerFramebuffer(layer));
      // 1 encodes zero optical depth, so an untouched channel reads as "nothing
      // in the way" and contributes no transmission.
      device.clearFrameBuffer(new Vector4(1, 1, 1, 1), null, null);
      for (let channel = 0; channel < SHADOW_MASK_LIGHTS_PER_LAYER; channel++) {
        const ordinal = layer * SHADOW_MASK_LIGHTS_PER_LAYER + channel;
        if (ordinal >= numLights) {
          break;
        }
        const light = lights[ordinal];
        const shadowMapParams = ctx.shadowMapInfo.get(light) ?? null;
        if (!lightSupportsTransmission(light, shadowMapParams)) {
          continue;
        }
        ctx.currentShadowLight = light;
        this.renderLightChannel(
          ctx,
          depthTexture,
          profileIdTexture,
          profileTable,
          shadowMapParams!,
          channelStates[channel]
        );
      }
    }
    device.popDeviceStates();
    ctx.currentShadowLight = savedShadowLight;
  }

  private renderLightChannel(
    ctx: DrawContext,
    depthTexture: Texture2D,
    profileIdTexture: Texture2D,
    profileTable: Texture2D,
    shadowMapParams: ShadowMapParams,
    renderState: RenderStateSet
  ): void {
    const device = ctx.device;
    const key = this.getProgramKey(ctx, shadowMapParams);
    let program = this._programs.get(key) ?? null;
    if (!program) {
      program = this.createProgram(ctx, shadowMapParams);
      this._programs.set(key, program);
      this._bindGroups.set(key, device.createBindGroup(program.bindGroupLayouts[0]));
    }
    const bindGroup = this._bindGroups.get(key)!;
    this.setUniforms(bindGroup, ctx, depthTexture, profileIdTexture, profileTable, shadowMapParams);
    device.setProgram(program);
    device.setBindGroup(0, bindGroup);
    drawFullscreenQuad(renderState);
  }

  private getProgramKey(ctx: DrawContext, shadowMapParams: ShadowMapParams): string {
    const depth = shadowMapParams.shadowMapFramebuffer!.getDepthAttachment()!;
    return `${ctx.device.type}|${shadowMapParams.lightType}|${shadowMapParams.numShadowCascades}|${
      depth.isTexture2DArray() ? 'array' : '2d'
    }`;
  }

  private getChannelStates(device: AbstractDevice): RenderStateSet[] {
    if (!this._channelStates) {
      this._channelStates = [];
      for (let c = 0; c < SHADOW_MASK_LIGHTS_PER_LAYER; c++) {
        const rs = device.createRenderStateSet();
        rs.useDepthState().enableTest(false).enableWrite(false);
        rs.useRasterizerState().setCullMode('none');
        rs.useColorState().setColorMask(c === 0, c === 1, c === 2, c === 3);
        this._channelStates.push(rs);
      }
    }
    return this._channelStates;
  }

  private setUniforms(
    bindGroup: BindGroup,
    ctx: DrawContext,
    depthTexture: Texture2D,
    profileIdTexture: Texture2D,
    profileTable: Texture2D,
    shadowMapParams: ShadowMapParams
  ): void {
    const camera = ctx.camera;
    const light = ctx.currentShadowLight!;
    const near = camera.getNearPlane();
    const far = camera.getFarPlane();
    const cameraPos = camera.getWorldPosition();
    this._cameraPosition.setXYZW(cameraPos.x, cameraPos.y, cameraPos.z, 0);
    this._cameraParams.setXYZW(near, far, 1, 1);
    this._nearFar.setXY(near, far);
    bindGroup.setValue('camera', {
      position: this._cameraPosition,
      params: this._cameraParams,
      shadowDebugCascades: 0,
      framestamp: ctx.device.frameInfo.frameCounter
    });
    const implParams = new Vector4();
    shadowMapParams.impl!.getParams(implParams);
    bindGroup.setValue('light', {
      sunDir: ctx.sunLight
        ? ctx.sunLight.directionAndCutoff.xyz().scaleBy(-1)
        : new Vector4(0, 1, 0, 0).xyz(),
      shadowCascades: shadowMapParams.numShadowCascades,
      positionAndRange: light.positionAndRange,
      directionAndCutoff: light.directionAndCutoff,
      diffuseAndIntensity: ShaderHelper.getPreExposedColorIntensity(light, ctx),
      extraParams: light.extraParams,
      cascadeDistances: shadowMapParams.cascadeDistances,
      depthBiasValues: shadowMapParams.depthBiasValues[0],
      shadowCameraParams: shadowMapParams.cameraParams,
      depthBiasScales: shadowMapParams.depthBiasScales,
      implParams: implParams,
      shadowMatrices: new Float32Array(shadowMapParams.shadowMatrices),
      shadowStrength: light.shadow.shadowStrength,
      envLightStrength: ShaderHelper.getEnvLightLuminance(ctx),
      envLightSpecularStrength: ctx.env?.light.specularStrength ?? 1
    });
    bindGroup.setValue('invViewProjMatrix', camera.invViewProjectionMatrix);
    bindGroup.setValue('cameraNearFar', this._nearFar);
    bindGroup.setValue('profileTexelSize', this._profileTexelSize);
    this._invRenderSize.setXY(1 / depthTexture.width, 1 / depthTexture.height);
    bindGroup.setValue('invRenderSize', this._invRenderSize);
    bindGroup.setTexture('depthTex', depthTexture, fetchSampler('clamp_nearest_nomip'));
    bindGroup.setTexture('profileIdTex', profileIdTexture, fetchSampler('clamp_nearest_nomip'));
    // rgba32f, so WebGPU only accepts a non-filtering sampler; every read is a
    // single texel anyway.
    bindGroup.setTexture('profileTex', profileTable, fetchSampler('clamp_nearest_nomip'));
    // Sampled through textureLoad only, so no sampler is bound for it.
    bindGroup.setTexture(
      UNIFORM_NAME_SHADOW_DEPTH,
      shadowMapParams.shadowMapFramebuffer!.getDepthAttachment()!
    );
  }

  private createProgram(ctx: DrawContext, shadowMapParams: ShadowMapParams): GPUProgram {
    const device = ctx.device;
    const numCascades = shadowMapParams.numShadowCascades;
    const lightType = shadowMapParams.lightType;
    const depthAttachment = shadowMapParams.shadowMapFramebuffer!.getDepthAttachment()!;
    const isArray = depthAttachment.isTexture2DArray();
    // Orthographic shadow depth is linear, so the projection's Z extent converts
    // a normalised depth difference straight into world units; perspective has to
    // be linearised instead. Rect lights are orthographic too, not just
    // directional - running them through the perspective branch would apply a
    // hyperbolic remap to an already linear depth.
    const ortho = lightType === LIGHT_TYPE_DIRECTIONAL || lightType === LIGHT_TYPE_RECT;
    const program = device.buildRenderProgram({
      label: 'TransmissionThickness',
      vertex(pb) {
        this.$inputs.pos = pb.vec2().attrib('position');
        this.$outputs.uv = pb.vec2();
        pb.main(function () {
          this.$builtins.position = pb.vec4(this.$inputs.pos, DEPTH_FARTHEST, 1);
          this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
          if (device.type === 'webgpu') {
            this.$builtins.position.y = pb.neg(this.$builtins.position.y);
          }
        });
      },
      fragment(pb) {
        const cameraStruct = pb.defineStruct([
          pb.vec4('position'),
          pb.vec4('params'),
          pb.float('shadowDebugCascades'),
          pb.int('framestamp')
        ]);
        // Must match helper.ts currentShadowLight lightStruct field-for-field:
        // ShaderHelper.calculateShadowSpaceVertex and friends read scope.light.
        const lightStruct = pb.defineStruct([
          pb.vec3('sunDir'),
          pb.int('shadowCascades'),
          pb.vec4('positionAndRange'),
          pb.vec4('directionAndCutoff'),
          pb.vec4('diffuseAndIntensity'),
          pb.vec4('extraParams'),
          pb.vec4('cascadeDistances'),
          pb.vec4('depthBiasValues'),
          pb.vec4('shadowCameraParams'),
          pb.vec4('depthBiasScales'),
          pb.vec4('implParams'),
          pb.vec4[16]('shadowMatrices'),
          pb.float('shadowStrength'),
          pb.float('envLightStrength'),
          pb.float('envLightSpecularStrength')
        ]);
        this.camera = cameraStruct().uniform(0);
        this.light = lightStruct().uniform(0);
        this[UNIFORM_NAME_SHADOW_DEPTH] = (isArray ? pb.tex2DArrayShadow() : pb.tex2DShadow())
          .uniform(0)
          .noSampler();
        this.depthTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
        this.profileIdTex = pb.tex2D().uniform(0);
        // rgba32f, hence unfilterable; every read here is a single texel.
        this.profileTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
        this.invViewProjMatrix = pb.mat4().uniform(0);
        this.cameraNearFar = pb.vec2().uniform(0);
        this.invRenderSize = pb.vec2().uniform(0);
        this.profileTexelSize = pb.vec2().uniform(0);
        this.$outputs.color = pb.vec4();
        // One texel of a profile row, addressed exactly as skin_brdf.ts does:
        // the row is the normalized id and the column is a parameter group.
        pb.func('zReadProfile', [pb.float('id'), pb.float('column')], function () {
          this.$l.u = pb.mul(pb.add(this.column, 0.5), this.profileTexelSize.x);
          this.$l.v = pb.mul(pb.add(pb.mul(pb.clamp(this.id, 0, 1), 255), 0.5), this.profileTexelSize.y);
          this.$return(pb.textureSampleLevel(this.profileTex, pb.vec2(this.u, this.v), 0));
        });
        /**
         * Geometric normal from the depth prepass. Transcribed from
         * ShadowMaskRenderer: a fullscreen pass has no interpolated normal, and
         * the naive cross(ddx, ddy) spans depth discontinuities.
         */
        pb.func('zReconstructNormal', [pb.vec2('uv'), pb.vec4('center')], function () {
          this.$l.dx = pb.vec2(this.invRenderSize.x, 0);
          this.$l.dy = pb.vec2(0, this.invRenderSize.y);
          const tap = (uv: any) =>
            ShaderHelper.samplePositionFromDepth(
              this,
              this.depthTex,
              uv,
              this.invViewProjMatrix,
              this.cameraNearFar
            );
          this.$l.right = tap(pb.add(this.uv, this.dx));
          this.$l.left = tap(pb.sub(this.uv, this.dx));
          this.$l.up = tap(pb.add(this.uv, this.dy));
          this.$l.down = tap(pb.sub(this.uv, this.dy));
          this.$l.edgeX = pb.sub(this.right.xyz, this.center.xyz);
          this.$if(
            pb.lessThan(
              pb.abs(pb.sub(this.left.w, this.center.w)),
              pb.abs(pb.sub(this.right.w, this.center.w))
            ),
            function () {
              this.edgeX = pb.sub(this.center.xyz, this.left.xyz);
            }
          );
          this.$l.edgeY = pb.sub(this.up.xyz, this.center.xyz);
          this.$if(
            pb.lessThan(pb.abs(pb.sub(this.down.w, this.center.w)), pb.abs(pb.sub(this.up.w, this.center.w))),
            function () {
              this.edgeY = pb.sub(this.center.xyz, this.down.xyz);
            }
          );
          this.$l.n = pb.cross(this.edgeX, this.edgeY);
          this.$l.len = pb.length(this.n);
          this.$if(pb.lessThan(this.len, 1e-12), function () {
            this.$return(pb.vec3(0));
          });
          this.n = pb.div(this.n, this.len);
          this.$l.toEye = pb.sub(this.camera.position.xyz, this.center.xyz);
          this.$if(pb.lessThan(pb.dot(this.n, this.toEye), 0), function () {
            this.n = pb.neg(this.n);
          });
          this.$return(this.n);
        });
        // Raw shadow map depth at a texel. The depth attachment is read rather
        // than the implementation's colour encoding, so this is the same device
        // depth `shadowCoord.z` carries regardless of shadow mode.
        //
        // A plain fetch, as UE5 takes its disc taps. Bilinear is measurably worse
        // (residual 5.6 to 7.5 levels at a 1024 map, at four times the fetches):
        // interpolating across a light-space silhouette blends a real blocker with
        // the cleared far value and invents a depth no surface has.
        pb.func(
          'zLoadShadowDepth',
          [pb.vec2('coord'), pb.float('size'), ...(isArray ? [pb.int('layer')] : [])],
          function () {
            this.$l.texel = pb.ivec2(
              pb.clamp(pb.mul(this.coord, this.size), pb.vec2(0), pb.sub(pb.vec2(this.size), pb.vec2(1)))
            );
            this.$return(
              isArray
                ? pb.textureArrayLoad(this[UNIFORM_NAME_SHADOW_DEPTH], this.texel, this.layer, 0)
                : pb.textureLoad(this[UNIFORM_NAME_SHADOW_DEPTH], this.texel, 0)
            );
          }
        );
        pb.main(function () {
          this.$l.pos = ShaderHelper.samplePositionFromDepth(
            this,
            this.depthTex,
            this.$inputs.uv,
            this.invViewProjMatrix,
            this.cameraNearFar
          );
          // 1 = no material in the way. Background pixels keep it.
          this.$outputs.color = pb.vec4(1);
          // Only skin has a profile to measure against. Leaving non-skin pixels at
          // the sentinel is not just an optimization: row 0 is all zeros, so an
          // extinction scale of 0 would put the optical depth on its floor and
          // encode as the *thinnest* possible rather than as "no data".
          this.$l.profileId = pb.textureSampleLevel(this.profileIdTex, this.$inputs.uv, 0).r;
          this.$if(pb.lessThan(this.profileId, 0.5 / 255), function () {
            this.$return();
          });
          // (extinctionScale, normalScale, scatteringDistribution, 1 / ior)
          this.$l.trParams = this.zReadProfile(this.profileId, pb.float(SSSProfile.transmissionParamColumn));
          // (worldUnitScale, scatterScale, 0, 0)
          this.$l.scalingParams = this.zReadProfile(this.profileId, pb.float(SSSProfile.scalingParamColumn));
          // World units to optical depth. The factor is derived from the baked
          // transmission profile's own axis rather than picked, because the two
          // have to agree exactly: see SKIN_OPTICAL_DEPTH_PER_WORLD_UNIT, which
          // also records what it looks like when they do not.
          //
          // `worldUnitScale` is deliberately absent here. It scales the profile's
          // distances and the table's axis together, so it cancels out of the
          // optical depth; UE5 keeps it out of `CalculateOpticalDepth` for the
          // same reason. It still does its job of letting one profile drive a
          // model authored at four times life size — just on the table side, and
          // in the shrink distance below.
          this.$l.opticalDepthScale = pb.mul(SSS_OPTICAL_DEPTH_PER_WORLD_UNIT, this.trParams.x);
          // UE5 shrinks by NormalScale * 0.5 in centimetres, scaled with the
          // asset: on a larger model the features it has to clear are larger too,
          // and so is the shadow-map depth quantisation it exists to escape.
          this.$l.shrinkDistance = pb.mul(this.trParams.y, 0.5 * 0.01, this.scalingParams.x);
          // The same shrink expressed as optical depth. The shrink moves the
          // sample point towards the light, so it under-measures the thickness by
          // exactly itself; adding it back inside the clamp is what recovers the
          // real thickness — so this stays written as the product rather than as
          // an equivalent constant, to keep it from drifting away from the scale
          // above the way it already has once.
          this.$l.normalScaleBias = pb.mul(this.shrinkDistance, this.opticalDepthScale);
          this.$if(pb.lessThan(this.pos.w, 1), function () {
            this.$l.normal = this.zReconstructNormal(this.$inputs.uv, this.pos);
            this.$l.split = pb.int(0);
            if (numCascades > 1) {
              this.$l.linearDepth = pb.mul(this.pos.w, this.camera.params.y);
              this.$l.comparison = pb.vec4(
                pb.greaterThan(pb.vec4(this.linearDepth), this.light.cascadeDistances)
              );
              this.$l.cascadeFlags = pb.vec4(
                pb.float(pb.greaterThan(this.light.shadowCascades, 0)),
                pb.float(pb.greaterThan(this.light.shadowCascades, 1)),
                pb.float(pb.greaterThan(this.light.shadowCascades, 2)),
                pb.float(pb.greaterThan(this.light.shadowCascades, 3))
              );
              this.split = pb.int(pb.dot(this.comparison, this.cascadeFlags));
            }
            // UE5 pulls the sample point back along the normal before projecting
            // it. Without this the surface occludes itself and the thickness is
            // identically zero. `normalScaleBias` adds the optical depth this
            // costs back inside the clamp.
            //
            // Not the shadow map's own normal offset: that is calibrated for a
            // *binary* comparison where overshooting only costs peter-panning,
            // whereas this is a continuous depth difference and the offset lands
            // directly in the measured value. At `normalBias` 1.5 over a 20 m
            // cascade the grazing-angle offset is 30 mm - a fifth of a head.
            this.$l.shrunk = pb.sub(this.pos.xyz, pb.mul(this.normal, this.shrinkDistance));
            this.$l.sv = ShaderHelper.calculateShadowSpaceVertex(
              this,
              pb.vec4(this.shrunk, 1),
              numCascades > 1 ? this.split : 0
            );
            this.$l.sc = ndcToShadowCoord(this, pb.div(this.sv, this.sv.w));
            // Both ends of the depth range must be rejected, which is why
            // shadowCoordDepthInRange is not reused: it guards only the far side,
            // since for shadowing a receiver in front of the near plane is simply
            // unshadowed. For thickness it means the blocker was clipped out of
            // the map, so the texel holds the clear value and any difference
            // against it is meaningless.
            this.$l.inside = pb.all(
              pb.bvec4(
                pb.all(pb.bvec2(pb.greaterThanEqual(this.sc.x, 0), pb.lessThanEqual(this.sc.x, 1))),
                pb.all(pb.bvec2(pb.greaterThanEqual(this.sc.y, 0), pb.lessThanEqual(this.sc.y, 1))),
                pb.greaterThanEqual(this.sc.z, 0),
                pb.lessThanEqual(this.sc.z, 1)
              )
            );
            this.$if(this.inside, function () {
              this.$l.size = this.light.shadowCameraParams.z;
              if (SEARCH_RADIUS_TEXELS > 0) {
                this.$l.radius = pb.div(SEARCH_RADIUS_TEXELS, this.size);
              }
              if (ortho) {
                // Row 2 of the (transposed) shadow matrix maps light-space Z into
                // NDC, so its length is the NDC span over the projection's world Z
                // extent - UE5's ProjectionDepthBiasParameters.w. Taken per
                // cascade, since shadowCameraParams only keeps a near/far pair for
                // the last cascade rendered.
                //
                // The numerator is the NDC span itself: reverse-Z hands
                // ndcToShadowCoord a [0,1] z that passes through untouched, while
                // the standard convention produces [-1,1] and is remapped by the
                // same 0.5 that shrinks the difference measured below.
                this.$l.zRow = this.light.shadowMatrices.at(pb.add(pb.mul(this.split, 4), 2));
                this.$l.zRange = pb.div(REVERSE_Z ? 1 : 2, pb.max(pb.length(this.zRow.xyz), 1e-8));
              }
              this.$l.sum = pb.float(0);
              for (let i = 0; i < taps.length; i++) {
                this.$l[`c${i}`] =
                  SEARCH_RADIUS_TEXELS > 0
                    ? pb.add(this.sc.xy, pb.mul(pb.vec2(taps[i][0], taps[i][1]), this.radius))
                    : this.sc.xy;
                this.$l[`b${i}`] = isArray
                  ? this.zLoadShadowDepth(this[`c${i}`], this.size, this.split)
                  : this.zLoadShadowDepth(this[`c${i}`], this.size);
                // Under reverse-Z a blocker sits at a larger depth value.
                this.$l[`d${i}`] = REVERSE_Z
                  ? pb.sub(this[`b${i}`], this.sc.z)
                  : pb.sub(this.sc.z, this[`b${i}`]);
                if (ortho) {
                  this.$l[`t${i}`] = pb.mul(this[`d${i}`], this.zRange);
                } else {
                  this.$l[`t${i}`] = pb.sub(
                    ShaderHelper.nonLinearDepthToLinear(this, this.sc.z, this.light.shadowCameraParams),
                    ShaderHelper.nonLinearDepthToLinear(this, this[`b${i}`], this.light.shadowCameraParams)
                  );
                }
                // CalculateOpticalDepth, after TransmissionThickness.ush.
                //
                // `t` is already the distance the light travels *through* the
                // medium - both branches above measure blocker and receiver along
                // the light ray - so it is the optical path and takes no angular
                // correction. In particular there is no `NoL` factor: the camera
                // sees NoL == 0 wherever the light is on the far side, which is
                // exactly where this term matters.
                //
                // Each tap is clamped on its own before it enters the average,
                // as UE5 does. That makes the average a nonlinear function of
                // the sampled depths, which is the point: a tap that lands past
                // a light-space silhouette reports the whole subject rather than
                // the few millimetres either side of it, and without a ceiling
                // one such outlier drags all sixteen. Bounding each contribution
                // is a robust estimator, and measured on
                // `transmission-thickness-sphere` it takes the residual from 5.9
                // to 5.6 levels at a 1024 map and 3.5 to 3.2 at 4096.
                //
                // `max(_, 0)` rather than `abs()`. A negative optical depth means
                // the tap found no material - a texel no caster reached, or a
                // farther surface - since the shadow map keeps the nearest
                // blocker. `abs()` would turn exactly those taps into the largest
                // possible thickness, which is what produced the bright fringe
                // along every silhouette.
                this.$l[`o${i}`] = pb.mul(this[`t${i}`], this.opticalDepthScale);
                this.$l[`k${i}`] = pb.clamp(
                  pb.max(pb.add(this[`o${i}`], this.normalScaleBias), 0),
                  SSS_TRANSMISSION_OPTICAL_DEPTH_FLOOR,
                  MAX_TRANSMISSION_OPTICAL_DEPTH
                );
                this.sum = pb.add(this.sum, this[`k${i}`]);
              }
              // The bias is constant, so averaging it per tap as UE5 does and
              // adding it once here are the same number.
              this.$l.opticalDepth = pb.add(
                pb.div(this.sum, taps.length),
                SSS_TRANSMISSION_OPTICAL_DEPTH_BIAS
              );
              // EncodeOpticalDepthToShadowMask
              this.$outputs.color = pb.vec4(
                pb.sub(1, pb.div(this.opticalDepth, MAX_TRANSMISSION_OPTICAL_DEPTH))
              );
            });
          });
        });
      }
    })!;
    program.name = '@TransmissionThickness';
    return program;
  }

  /** Release cached GPU resources. */
  dispose(): void {
    for (const program of this._programs.values()) {
      program.dispose();
    }
    this._programs.clear();
    this._bindGroups.clear();
    this._channelStates = null;
  }
}
