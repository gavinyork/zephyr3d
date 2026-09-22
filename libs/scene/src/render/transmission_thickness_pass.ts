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
  SKIN_MAX_TRANSMISSION_OPTICAL_DEPTH,
  SKIN_TRANSMISSION_OPTICAL_DEPTH_BIAS,
  SKIN_TRANSMISSION_OPTICAL_DEPTH_FLOOR
} from '../material/skinprofile';
import { fetchSampler } from '../utility/misc';

const UNIFORM_NAME_SHADOW_DEPTH = 'Z_UniformShadowDepth';

/**
 * Largest optical depth the transmission profile is defined over.
 *
 * @remarks
 * Re-exported from {@link SKIN_MAX_TRANSMISSION_OPTICAL_DEPTH}, which is where
 * the constant belongs: the encoding this pass writes (`1 - opticalDepth / MAX`)
 * and the baked profile the BxDF indexes with it have to agree on the same
 * number, and the profile owns the baking.
 *
 * The clamp floor and additive bias the optical depth is put through below are
 * in the same space — profile millimetres, the unit the scatter radii use, not
 * world units. A producer feeding `opticalDepthScale` has to convert.
 *
 * @internal
 */
export const MAX_TRANSMISSION_OPTICAL_DEPTH = SKIN_MAX_TRANSMISSION_OPTICAL_DEPTH;

/**
 * Poisson disc the light-space thickness is averaged over.
 *
 * @remarks
 * Eight points of a Vogel (golden-angle) spiral plus their antipodes, so the
 * offsets sum to exactly zero and the radii spread from 0.25 to 0.97 of the
 * search radius.
 *
 * The zero mean is the load-bearing property, not the even coverage. Averaging
 * over a footprint the blocker's depth varies across only measures the depth at
 * the footprint's centroid, so a kernel whose centroid is displaced reads the
 * blocker at the wrong place - and the error is proportional to the depth
 * gradient, which is `tan θ` for a surface tilted by `θ` out of the light's
 * plane.
 *
 * This replaces a window of UE5's 63-entry table
 * (`TransmissionThickness.ush`). That table is sorted by x, so *no* contiguous
 * window of it is centred; the one transcribed here had all sixteen x negative
 * and a centroid at (-0.56, +0.05), half a texel off centre. Measured by
 * `transmission-thickness-slant` in the visual-test harness: 1 mm slabs tilted
 * 30 and 45 degrees read 1.1 mm and 1.7 mm thicker than their true light-ray
 * path, and the excess tracked `tan θ` as predicted. Flat slabs lit head-on have
 * no gradient and were unaffected, which is why the defect survived review of
 * the head-on case.
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
 * What this is for is the *light-space silhouette*, where the shadow map holds a
 * step: on one side of it the receiver is its own blocker and the path is
 * nothing, on the other the blocker is the lit face and the path climbs away
 * from zero. On a sphere that climb is exactly `2R|cos(theta)|`, a clean linear
 * ramp out of the terminator - so everything the measurement adds there is
 * artifact, and a quantised blocker adds a comb of texel-shaped teeth.
 * Averaging over a footprint is what softens it, and filtering the individual
 * tap is not a substitute: bilinear reconstructs within a texel, but the
 * boundary still runs along the texel grid, and measured on
 * `transmission-thickness-sphere` it is a net loss.
 *
 * It was previously zero, on the strength of a measurement against
 * `transmission-thickness-slant`: a tilted slab reads within a fraction of a
 * millimetre of its true light-ray path at every radius. That is a real result
 * and it is about the wrong quantity. Those slabs are flat, so the blocker depth
 * across them is linear, and a zero-mean kernel over a linear gradient returns
 * the value at its centre no matter how wide it is — the experiment could only
 * ever see the mean, and the artifact the filter exists for is a shape.
 *
 * Measured on the sphere, the disc is by far the largest single win in the pass:
 * dropping it takes the residual from 5.6 to 21.9 levels. Widening it to two
 * texels buys nothing (6.0) and costs thin features, which is why this stays at
 * UE5's one.
 *
 * The cost the measurement did identify is real, though, and is the reason not
 * to go past UE5's one texel: a shadow texel is the scene extent over the map
 * size, so a 1024 map fitted to a 3 m region has 3 mm texels, and averaging over
 * 2 of them is already the thickness of the ear being measured. If thin features
 * wash out, the lever is the shadow map's resolution or its fitted extent, not
 * this.
 *
 * It is a build-time constant rather than a uniform so that a radius of zero
 * emits one tap instead of sixteen identical ones.
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
 * This is UE5's `CalculateEncodedOpticalDepth` (`TransmissionThickness.ush`),
 * moved into its own pass. UE5 folds the same computation into the shadow
 * projection and packs the result into the `LightAttenuation` mask's G/A
 * channels; this engine's mask spends one channel per light and has no room, so
 * the thickness gets its own `rgba8unorm` array with the *identical*
 * `ordinal → layer/channel` packing. Reusing the ordinal is what lets the
 * material recover a light's thickness from its clustered buffer index with the
 * same arithmetic {@link ShaderHelper.sampleShadowMask} already uses.
 *
 * The depth is read from the shadow map's **depth attachment** rather than from
 * whatever colour encoding the shadow implementation chose. Every implementation
 * allocates one (`d32f`, or `d24s8` for ESM/VSM), both of which resolve to about
 * 0.12 mm per step even across a 2 km cascade, whereas PCSS's preferred `r16f`
 * colour map would quantise a 2 cm ear into a fraction of one step. Reading the
 * depth attachment therefore makes this independent of the shadow mode.
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
  private readonly _thicknessParams: Vector4;

  constructor() {
    this._programs = new Map();
    this._bindGroups = new Map();
    this._channelStates = null;
    this._nearFar = new Vector2();
    this._invRenderSize = new Vector2();
    this._cameraPosition = new Vector4();
    this._cameraParams = new Vector4();
    this._thicknessParams = new Vector4();
  }

  /**
   * Render light-space thickness for every transmission-enabled light.
   *
   * @param ctx - Draw context, carrying `shadowMapInfo` for the lights.
   * @param depthTexture - Linear depth from the depth prepass.
   * @param lights - Shadow-casting lights in clustered-buffer order, i.e. exactly
   *   the array {@link ShadowMaskRenderer.render} is given, so that ordinals agree.
   * @param opticalDepthScale - World units to optical depth, `1000 × extinctionScale`
   *   for a metre world unit and the profile's millimetre space.
   * @param shrinkDistance - How far to pull the sample point back along the normal,
   *   in world units.
   * @param normalScaleBias - UE5's additive `NormalScale × 0.5` inside the clamp,
   *   in optical depth. Pass `shrinkDistance × opticalDepthScale`: the shrink moves
   *   the sample point towards the light, so it under-measures the thickness by
   *   exactly itself, and adding it back here recovers it.
   * @param getLayerFramebuffer - Resolves the framebuffer for array layer `k`.
   */
  render(
    ctx: DrawContext,
    depthTexture: Texture2D,
    lights: PunctualLight[],
    opticalDepthScale: number,
    shrinkDistance: number,
    normalScaleBias: number,
    getLayerFramebuffer: (layer: number) => FrameBuffer
  ): void {
    const device = ctx.device;
    const numLights = Math.min(lights.length, MAX_SHADOW_MASK_LIGHTS);
    if (numLights === 0 || !ctx.shadowMapInfo) {
      return;
    }
    const numLayers = Math.ceil(numLights / SHADOW_MASK_LIGHTS_PER_LAYER);
    const channelStates = this.getChannelStates(device);
    const savedShadowLight = ctx.currentShadowLight;
    this._thicknessParams.setXYZW(opticalDepthScale, shrinkDistance, normalScaleBias, 0);

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
        this.renderLightChannel(ctx, depthTexture, shadowMapParams!, channelStates[channel]);
      }
    }
    device.popDeviceStates();
    ctx.currentShadowLight = savedShadowLight;
  }

  private renderLightChannel(
    ctx: DrawContext,
    depthTexture: Texture2D,
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
    this.setUniforms(bindGroup, ctx, depthTexture, shadowMapParams);
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
    bindGroup.setValue('thicknessParams', this._thicknessParams);
    this._invRenderSize.setXY(1 / depthTexture.width, 1 / depthTexture.height);
    bindGroup.setValue('invRenderSize', this._invRenderSize);
    bindGroup.setTexture('depthTex', depthTexture, fetchSampler('clamp_nearest_nomip'));
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
    // a normalised depth difference straight into world units. Perspective
    // projections have to be linearised instead.
    //
    // Rect lights are orthographic too (ShadowMapper.createLightCameraRect uses
    // setOrtho over the rect's extent), not just directional ones. Running them
    // through the perspective branch applies a hyperbolic remap to an already
    // linear depth, which crushes the difference by roughly near/far — a 2 cm
    // thickness came out around 0.4 mm, below the optical depth floor, so every
    // pixel read as "nothing in the way".
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
        this.invViewProjMatrix = pb.mat4().uniform(0);
        this.cameraNearFar = pb.vec2().uniform(0);
        this.invRenderSize = pb.vec2().uniform(0);
        // x: world units to optical depth, y: normal shrink distance,
        // z: UE5's additive NormalScale * 0.5, w: unused
        this.thicknessParams = pb.vec4().uniform(0);
        this.$outputs.color = pb.vec4();
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
        // A plain fetch, as UE5 takes its disc taps. Bilinear reconstruction was
        // tried here on the reasoning that a nearest tap holds the blocker depth
        // constant across a texel and so turns a smooth surface into a staircase.
        // It is measurably worse: on `transmission-thickness-sphere` it raises
        // the residual from 5.6 to 7.5 levels at a 1024 map and from 3.2 to 4.2
        // at 4096, at four times the fetches. Interpolating across a light-space
        // silhouette blends a real blocker with the cleared far value and invents
        // a depth no surface has, and there are more of those edges than there is
        // smooth interior for it to help.
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
            // identically zero. `thicknessParams.z` adds the optical depth this
            // costs back inside the clamp.
            //
            // The shadow map's own normal offset — `ShaderHelper
            // .applyShadowNormalOffset`, `depthBiasValues.y x sin(theta)` — was
            // tried here and must not be: it is calibrated for a *binary*
            // comparison, where overshooting only costs peter-panning, whereas
            // this is a continuous depth difference and the offset lands
            // directly in the measured value. At `normalBias` 1.5 and a cascade
            // covering 20 m through a 1024 map, a texel is 20 mm and the
            // grazing-angle offset is 30 mm - a fifth of a head. The thickness
            // collapsed to two flat levels, saturated on one side of the
            // terminator and floored on the other, which is the feature failing
            // silently: the profile no longer varies with geometry at all.
            this.$l.shrunk = pb.sub(this.pos.xyz, pb.mul(this.normal, this.thicknessParams.y));
            this.$l.sv = ShaderHelper.calculateShadowSpaceVertex(
              this,
              pb.vec4(this.shrunk, 1),
              numCascades > 1 ? this.split : 0
            );
            this.$l.sc = ndcToShadowCoord(this, pb.div(this.sv, this.sv.w));
            // Both ends of the depth range have to be rejected, which is why
            // shadowCoordDepthInRange is not reused here: it only guards the far
            // side, because a receiver closer than the shadow near plane is
            // simply unshadowed as far as shadowing is concerned. For thickness
            // it means the opposite — the blocker was clipped out of the shadow
            // map, so the texel holds the clear value and any difference taken
            // against it is meaningless. Letting those through produced a
            // uniform, geometry-independent thickness over anything that sat
            // in front of the near plane.
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
                // NDC, so its length is the NDC span over the projection's world
                // Z extent. Taking it per cascade avoids needing a near/far pair,
                // which shadowCameraParams only keeps for the last cascade
                // rendered. This is the equivalent of UE5's
                // ProjectionDepthBiasParameters.w (MaxSubjectZ - MinSubjectZ).
                //
                // The numerator is the NDC span itself: reverse-Z already hands
                // ndcToShadowCoord a [0,1] z and it passes through untouched,
                // while the standard convention produces [-1,1] and gets remapped
                // by the same 0.5 that shrinks the difference measured below.
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
                // medium: both branches above measure blocker and receiver along
                // the light ray, so it is the optical path and needs no angular
                // correction. The transcription used to scale it by a saturated
                // `NoL` taken from the camera-facing reconstructed normal, which
                // broke it two ways at once, both visible in a shot taken from
                // behind a backlit head:
                //
                //   NoL == 0 (everything the camera sees when the light is on the
                //   far side): the whole measurement is multiplied away and every
                //   pixel reports the bias alone, so a 3 mm ear and 150 mm of
                //   skull encode to the same value and nothing ever saturates.
                //
                //   NoL slightly > 0 (a few degrees either side of the
                //   terminator): `o` is the full skull thickness there, so it
                //   amplifies the depth-reconstructed normal's noise by up to
                //   `o` itself — the terminator came out as a band of rings.
                //
                // Dropping the factor collapses the select as well: with `z > 0`,
                // the `o > 0` branch's `max` is the identity and both branches are
                // `o + z`.
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
                // The clamp was moved out of the loop once, on the evidence that
                // a 2 mm slab at 50 degrees then read 0.37 mm thin - the taps
                // past the ceiling losing more than the taps under the floor
                // gained. That measurement was taken while the optical depth
                // scale was ten times too large, which put those slabs against
                // the ceiling where nothing else would be. At the calibrated
                // scale the ladder and slant scenes read identically either way,
                // to the 8-bit level, so the bias it was avoiding does not exist
                // in the range the pass actually works over.
                //
                // `max(_, 0)` rather than `abs()`. A negative optical depth means
                // the nearest surface to the light is *behind* the receiver, which
                // no real blocker can be - the shadow map keeps the nearest. It
                // means the tap found no material: either a texel no caster
                // reached, holding the cleared far value, or a farther surface
                // entirely. `abs()` turned exactly those taps into the largest
                // possible thickness, which is what produced the bright fringe
                // along every silhouette.
                this.$l[`o${i}`] = pb.mul(this[`t${i}`], this.thicknessParams.x);
                this.$l[`k${i}`] = pb.clamp(
                  pb.max(pb.add(this[`o${i}`], this.thicknessParams.z), 0),
                  SKIN_TRANSMISSION_OPTICAL_DEPTH_FLOOR,
                  MAX_TRANSMISSION_OPTICAL_DEPTH
                );
                this.sum = pb.add(this.sum, this[`k${i}`]);
              }
              // The bias is constant, so averaging it per tap as UE5 does and
              // adding it once here are the same number.
              this.$l.opticalDepth = pb.add(
                pb.div(this.sum, taps.length),
                SKIN_TRANSMISSION_OPTICAL_DEPTH_BIAS
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
