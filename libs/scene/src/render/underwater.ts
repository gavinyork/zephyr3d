import type { Nullable } from '@zephyr3d/base';
import { DEPTH_FARTHEST, Vector3, Vector4 } from '@zephyr3d/base';
import type {
  AbstractDevice,
  BindGroup,
  FrameBuffer,
  GPUProgram,
  RenderStateSet,
  Texture2D
} from '@zephyr3d/device';
import type { Camera } from '../camera/camera';
import type { WaterMaterial } from '../material/water';
import { ShaderHelper } from '../material/shader/helper';
import type { Water } from '../scene/water';
import { waterScatterPhase } from '../shaders/water_medium';
import { LIGHT_TYPE_DIRECTIONAL } from '../values';
import { interleavedGradientNoise } from '../shaders/noise';
import { SkyRenderer } from './sky';
import { fetchSampler } from '../utility/misc';
import { drawFullscreenQuad } from './fullscreenquad';
import type { DrawContext } from './drawable';

/**
 * The body of water a camera is currently inside, and how deep.
 * @public
 */
export interface UnderwaterState {
  /** The water node the camera is submerged in. */
  water: Water;
  /** Its material, which owns the medium coefficients and the underwater settings. */
  material: WaterMaterial;
  /** World Y of that water's rest plane. */
  surfaceY: number;
  /** How far the eye is below the rest plane, in meters. Always positive. */
  eyeDepth: number;
}

/**
 * Which waters each camera is currently inside, and the rest plane of each.
 *
 * Written by {@link Water.updatePerCamera}, which runs for every water every
 * frame whether or not the surface survived culling. Reading the render queue
 * instead would lose the state the moment the surface left the frustum - which
 * is exactly what happens to a camera deep underwater looking down.
 *
 * Keyed on the camera so multiple views stay independent. The inner map holds a
 * strong reference to the water, which a disposed node would keep alive; entries
 * are pruned on read rather than on dispose, since a disposed water simply stops
 * updating its own entry.
 *
 * @internal
 */
const _submergence = new WeakMap<Camera, Map<Water, number>>();

/**
 * Record whether `camera` is inside `water` this frame.
 *
 * @param camera - Camera being updated.
 * @param water - Water reporting its own state.
 * @param submerged - Whether the camera is inside this body.
 * @param surfaceY - World Y of the water's rest plane.
 * @internal
 */
export function setWaterSubmergence(
  camera: Camera,
  water: Water,
  submerged: boolean,
  surfaceY: number
): void {
  let bodies = _submergence.get(camera);
  if (submerged) {
    if (!bodies) {
      bodies = new Map();
      _submergence.set(camera, bodies);
    }
    bodies.set(water, surfaceY);
  } else if (bodies) {
    bodies.delete(water);
  }
}

/**
 * The water the camera is currently inside, or null when it is above all of them.
 *
 * Several can qualify - a pool inside a lake, water on terraces - and the one
 * that matters is the highest of them: that is the last surface the eye crossed
 * on its way down, so it owns the column the eye is looking through.
 *
 * @param ctx - Frame draw context.
 * @returns The submerged state, or null.
 * @internal
 */
export function selectUnderwaterSource(ctx: DrawContext): Nullable<UnderwaterState> {
  const bodies = _submergence.get(ctx.camera);
  if (!bodies || bodies.size === 0) {
    return null;
  }
  let best: Nullable<Water> = null;
  let bestY = 0;
  for (const [water, surfaceY] of bodies) {
    // A node disposed since its last update never clears its own entry.
    if (water.disposed) {
      bodies.delete(water);
      continue;
    }
    if (!best || surfaceY > bestY) {
      best = water;
      bestY = surfaceY;
    }
  }
  const material = best?.material;
  if (!best || !material || !material.underwaterEnabled) {
    return null;
  }
  return {
    water: best,
    material,
    surfaceY: bestY,
    eyeDepth: Math.max(0, bestY - ctx.camera.getWorldPosition().y)
  };
}

/**
 * Optical depth at which a channel is taken to have died completely.
 *
 * exp(-30) is about 1e-13, which is zero in any format the scene color uses. The
 * path length fed to the medium is capped at whatever distance reaches this on
 * the least attenuated channel, so a huge far plane cannot push the exponent
 * anywhere unpleasant.
 * @internal
 */
const OPTICAL_DEPTH_CAP = 30;

/**
 * Composites the water body a submerged camera is looking through.
 *
 * Two draws over the opaque scene, both in place on the scene color target:
 *
 * 1. multiply by the medium's transmittance, then
 * 2. add what the medium scatters back towards the eye.
 *
 * Two rather than one because the transmittance is per channel - red dies within
 * a metre or two of clear water while blue carries tens of metres, which is the
 * entire reason water reads as water - and a single blend equation only has a
 * scalar `src-alpha` to attenuate the destination with. Splitting them lets the
 * first draw use `src-color` as the destination factor and keep the colour.
 *
 * The pass runs after the sky, and treats a sky pixel as a ray that never left
 * the water: its path length is the cap above, so its transmittance is zero and
 * the horizon is pure medium. That is what replaces the sky underwater, rather
 * than any separate handling of it.
 *
 * @internal
 */
export class UnderwaterRenderer {
  /** Multiplies the scene by the medium transmittance. */
  private _extinctionProgram: Nullable<GPUProgram>;
  private _extinctionBindGroup: Nullable<BindGroup>;
  private _extinctionStates: Nullable<RenderStateSet>;
  /**
   * Adds what the medium scatters towards the eye. Two variants: ambient alone,
   * and ambient plus a march for the sun shafts. Keyed on the step count as well
   * as on whether the shafts are on, because the loop is unrolled at that count.
   */
  private readonly _inscatterPrograms: Map<string, { program: GPUProgram; bindGroup: BindGroup }>;
  private _inscatterStates: Nullable<RenderStateSet>;
  /** (ambientScale, surfaceY, maxPathLength, godRayIntensity) */
  private readonly _params: Vector4;
  /** (scatterAnisotropy, unused, unused, unused) */
  private readonly _phaseParams: Vector4;
  private readonly _extinction: Vector3;
  private readonly _albedo: Vector3;
  private readonly _sunDir: Vector3;
  private readonly _sunColor: Vector3;
  constructor() {
    this._extinctionProgram = null;
    this._extinctionBindGroup = null;
    this._extinctionStates = null;
    this._inscatterPrograms = new Map();
    this._inscatterStates = null;
    this._params = new Vector4();
    this._phaseParams = new Vector4();
    this._extinction = new Vector3();
    this._albedo = new Vector3();
    this._sunDir = new Vector3();
    this._sunColor = new Vector3();
  }
  /**
   * Composite the medium over the opaque scene.
   *
   * @param ctx - Frame draw context.
   * @param state - The water the camera is inside.
   * @param colorFramebuffer - Color-only target holding the opaque scene and the
   * sky. The depth attachment is deliberately absent: this pass samples the
   * scene depth, which it could not do while that texture is still attached.
   * @param depthTexture - Scene depth attachment, sampled for the path length.
   */
  render(
    ctx: DrawContext,
    state: UnderwaterState,
    colorFramebuffer: FrameBuffer,
    depthTexture: Texture2D
  ): void {
    const device = ctx.device;
    const material = state.material;
    // Shafts need the caustic map as the surface's transmittance, and the sun
    // that map was built for. Without one the march has nothing to modulate and
    // would paint a uniform cone, so it degrades to the ambient term alone.
    const sun = ctx.waterCausticLight;
    const godRays =
      material.underwaterGodRays && !!ctx.waterCaustics && !!sun && material.underwaterGodRayIntensity > 0;
    const steps = godRays ? material.underwaterGodRaySteps : 0;
    const { extinctionPass, inscatterPass } = this._prepare(device, steps);
    const extinction = material.extinction;
    this._extinction.set(extinction);
    this._albedo.set(material.scatterAlbedo);
    // Far enough that the least attenuated channel has died. A channel with no
    // extinction at all has no such distance, and the far plane stands in.
    const minExtinction = Math.min(extinction.x, extinction.y, extinction.z);
    const far = ctx.camera.getFarPlane();
    this._params.setXYZW(
      // The distant-sky LUT is baked exposure-independently, as everywhere else
      // it is read from.
      SkyRenderer.getBakeToPreExposedScale(ctx) * material.underwaterAmbientIntensity,
      state.surfaceY,
      minExtinction > 0 ? Math.min(far, OPTICAL_DEPTH_CAP / minExtinction) : far,
      godRays ? material.underwaterGodRayIntensity : 0
    );
    this._phaseParams.setXYZW(material.scatterAnisotropy, 0, 0, 0);
    if (sun) {
      // Direction the light travels, matching what calculateWaterCaustic
      // compares its own against.
      const dir = sun.directionAndCutoff;
      this._sunDir.setXYZ(dir.x, dir.y, dir.z);
      const color = sun.diffuseAndIntensity;
      // Pre-exposed, like every other radiance this pass adds to the scene.
      const intensity = color.w * ShaderHelper.getPreExposure(ctx);
      this._sunColor.setXYZ(color.x * intensity, color.y * intensity, color.z * intensity);
    } else {
      this._sunDir.setXYZ(0, -1, 0);
      this._sunColor.setXYZ(0, 0, 0);
    }
    // Same rule the post effects use (AbstractPostEffect.needFlip): WebGPU's
    // render target has the opposite vertical convention to the screen.
    const flip = device.type === 'webgpu' && colorFramebuffer ? 1 : 0;
    const nearestSampler = fetchSampler('clamp_nearest_nomip');
    const skyLut = ctx.scene.env.sky.getSkyDistantLightLUT(ctx);
    const invProjView = ctx.camera.invViewProjectionMatrix;
    const cameraPos = ctx.camera.getWorldPosition();
    const passes = [extinctionPass, inscatterPass];

    device.pushDeviceStates();
    try {
      device.setFramebuffer(colorFramebuffer);
      device.setViewport(null);
      device.setScissor(null);
      for (const pass of passes) {
        const bindGroup = pass.bindGroup;
        bindGroup.setTexture('depthTex', depthTexture, nearestSampler);
        bindGroup.setTexture('skyLut', skyLut, nearestSampler);
        bindGroup.setValue('invProjViewMatrix', invProjView);
        bindGroup.setValue('cameraPosition', cameraPos);
        bindGroup.setValue('mediumExtinction', this._extinction);
        bindGroup.setValue('mediumAlbedo', this._albedo);
        bindGroup.setValue('params', this._params);
        bindGroup.setValue('flip', flip);
        if (pass === inscatterPass && godRays) {
          bindGroup.setValue('sunDirection', this._sunDir);
          bindGroup.setValue('sunColor', this._sunColor);
          bindGroup.setValue('phaseParams', this._phaseParams);
          // Same uniforms the lit materials bind, so the shafts and the caustics
          // on the sea bed are reading one map through one projection.
          ShaderHelper.setWaterCausticUniforms(bindGroup, ctx);
        }
        device.setProgram(pass.program);
        device.setBindGroup(0, bindGroup);
        drawFullscreenQuad(pass.states);
      }
    } finally {
      device.popDeviceStates();
    }
  }
  /**
   * Build or fetch the two programs this frame needs.
   *
   * @param device - Rendering device.
   * @param steps - Ray-march steps for the shafts, 0 for the ambient-only variant.
   * @internal
   */
  private _prepare(device: AbstractDevice, steps: number) {
    if (!this._extinctionProgram) {
      this._extinctionProgram = UnderwaterRenderer._createProgram(device, false, 0);
      this._extinctionBindGroup = device.createBindGroup(this._extinctionProgram.bindGroupLayouts[0]);
      this._extinctionStates = device.createRenderStateSet();
      this._extinctionStates.useRasterizerState().setCullMode('none');
      this._extinctionStates.useDepthState().enableTest(false).enableWrite(false);
      // dst.rgb *= src.rgb. The whole reason this is its own draw: the
      // destination factor has to be the per-channel transmittance.
      this._extinctionStates
        .useBlendingState()
        .enable(true)
        .setBlendFuncRGB('zero', 'src-color')
        .setBlendFuncAlpha('zero', 'one');
    }
    if (!this._inscatterStates) {
      this._inscatterStates = device.createRenderStateSet();
      this._inscatterStates.useRasterizerState().setCullMode('none');
      this._inscatterStates.useDepthState().enableTest(false).enableWrite(false);
      // dst.rgb += src.rgb. Alpha is left alone, as in the fog pass: folding a
      // transmittance into the framebuffer coverage makes a dense medium show
      // the page through the canvas.
      this._inscatterStates
        .useBlendingState()
        .enable(true)
        .setBlendFuncRGB('one', 'one')
        .setBlendFuncAlpha('zero', 'one');
    }
    // The march is unrolled, so the step count is part of the program identity.
    // Authoring it as a uniform loop bound instead would cost a dynamic loop in
    // every variant including the one with no shafts at all.
    const key = String(steps);
    let inscatter = this._inscatterPrograms.get(key);
    if (!inscatter) {
      const program = UnderwaterRenderer._createProgram(device, true, steps);
      inscatter = { program, bindGroup: device.createBindGroup(program.bindGroupLayouts[0]) };
      this._inscatterPrograms.set(key, inscatter);
    }
    return {
      extinctionPass: {
        program: this._extinctionProgram,
        bindGroup: this._extinctionBindGroup!,
        states: this._extinctionStates!
      },
      inscatterPass: {
        program: inscatter.program,
        bindGroup: inscatter.bindGroup,
        states: this._inscatterStates
      }
    };
  }
  /**
   * @param device - Rendering device.
   * @param inscatter - Build the in-scattering half rather than the extinction one.
   * @param steps - Ray-march steps for the sun shafts; 0 leaves them out entirely.
   * @internal
   */
  private static _createProgram(device: AbstractDevice, inscatter: boolean, steps: number): GPUProgram {
    const godRays = inscatter && steps > 0;
    const program = device.buildRenderProgram({
      label: inscatter ? 'UnderwaterInscatter' : 'UnderwaterExtinction',
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
        this.depthTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
        this.skyLut = pb.tex2D().uniform(0);
        this.invProjViewMatrix = pb.mat4().uniform(0);
        this.cameraPosition = pb.vec3().uniform(0);
        this.mediumExtinction = pb.vec3().uniform(0);
        this.mediumAlbedo = pb.vec3().uniform(0);
        /** (ambientScale, surfaceY, maxPathLength, godRayIntensity) */
        this.params = pb.vec4().uniform(0);
        if (godRays) {
          /** Direction the sun travels, as `directionAndCutoff.xyz`. */
          this.sunDirection = pb.vec3().uniform(0);
          /** Pre-exposed sun radiance. */
          this.sunColor = pb.vec3().uniform(0);
          /** (scatterAnisotropy, unused, unused, unused) */
          this.phaseParams = pb.vec4().uniform(0);
          // The same caustic uniforms every lit material declares, so the shafts
          // read the map through the exact projection the sea bed does.
          ShaderHelper.declareWaterCausticUniforms(pb);
        }
        this.$outputs.outColor = pb.vec4();
        pb.main(function () {
          this.$l.depthValue = pb.textureSample(this.depthTex, this.$inputs.uv).r;
          this.$l.clipSpacePos = pb.vec4(
            pb.sub(pb.mul(this.$inputs.uv, 2), pb.vec2(1)),
            ShaderHelper.deviceDepthToClipZ(this, this.depthValue),
            1
          );
          this.$l.hPos = pb.mul(this.invProjViewMatrix, this.clipSpacePos);
          this.$l.worldPos = pb.div(this.hPos, this.hPos.w).xyz;
          this.$l.isSky = ShaderHelper.isFarthestDepth(this, this.depthValue);
          // Direction the eye is looking, as a unit vector. Normalised from the
          // raw difference rather than divided by the capped path length below:
          // the cap is a limit on how far the medium is integrated, not on where
          // the geometry is, so dividing by it scaled this to |worldPos - eye| /
          // cap - up to 2.4 in the turbid ocean preset. That put cosTheta outside
          // [-1, 1], drove the Henyey-Greenstein denominator negative, and the
          // clamp guarding pow() then returned a phase of some 40000 in a flat
          // band across the distance.
          this.$l.viewDir = pb.normalize(pb.sub(this.worldPos, this.cameraPosition));
          // A ray that reached the sky never left the water, so it takes the
          // whole cap rather than the far plane's world position. That is the
          // one thing that makes the horizon converge to the medium instead of
          // showing the sky through it.
          this.$l.pathLength = this.$choice(
            this.isSky,
            this.params.z,
            pb.min(pb.distance(this.worldPos, this.cameraPosition), this.params.z)
          );
          this.$l.transmittance = pb.exp(pb.neg(pb.mul(this.mediumExtinction, this.pathLength)));
          if (!inscatter) {
            this.$outputs.outColor = pb.vec4(this.transmittance, 1);
          } else {
            // Downwelling sky light reaching the column, attenuated over the
            // vertical depth rather than along the view ray: what lights the
            // water is the sun and sky above it, and how far down this stretch
            // of column sits is what decides how much of that is left. Averaged
            // over the two ends of the path, which is exact for a column at
            // constant depth and a fair stand-in when it is not.
            this.$l.endY = this.$choice(this.isSky, this.cameraPosition.y, this.worldPos.y);
            this.$l.columnDepth = pb.mul(
              0.5,
              pb.add(
                pb.max(pb.sub(this.params.y, this.cameraPosition.y), 0),
                pb.max(pb.sub(this.params.y, this.endY), 0)
              )
            );
            this.$l.ambient = pb.mul(
              pb.textureSampleLevel(this.skyLut, pb.vec2(0.5), 0).rgb,
              this.params.x,
              pb.exp(pb.neg(pb.mul(this.mediumExtinction, this.columnDepth)))
            );
            // Single scattering: the albedo is the share of the extinguished
            // energy that comes back rather than being absorbed, the same form
            // getScattering() uses on the surface.
            this.$l.inscatter = pb.mul(
              this.mediumAlbedo,
              pb.sub(pb.vec3(1), this.transmittance),
              this.ambient
            );
            if (godRays) {
              // Shafts of sunlight through the column. The ambient term above is
              // directionless and cannot produce them; this is the same single
              // scattering integral evaluated against the sun instead, and the
              // only way to get it is to walk the ray, because how much sun
              // reaches a point depends on the surface overhead at that point.
              //
              // Angle between the sun's travel and the direction the scattered
              // light has to leave in to reach the eye, which is back along the
              // view ray. Constant along a ray from a directional light, so it
              // is hoisted out of the march. Clamped because both inputs are
              // unit vectors only up to rounding, and the phase function below
              // is not defined outside the range.
              this.$l.cosTheta = pb.clamp(pb.neg(pb.dot(this.sunDirection, this.viewDir)), -1, 1);
              this.$l.phase = waterScatterPhase(this, this.cosTheta, this.phaseParams.x);
              // Dithered sample offset. A fixed one puts every ray's samples on
              // the same set of distances, and the shafts then show as concentric
              // bands rather than as beams; the noise turns that structure into
              // grain the eye reads as the water itself.
              this.$l.jitter = interleavedGradientNoise(this, this.$builtins.fragCoord.xy);
              // The integral is sigma_s * integral(sunAtP(t) * exp(-sigma_t * t) dt),
              // and only `sunAtP` needs sampling - the exponential is analytic.
              // So the march estimates the transmittance-weighted *mean* of
              // sunAtP and the closed form below supplies the rest.
              //
              // Samples are placed by inverting that exponential rather than
              // spread evenly along the ray. Evenly spaced ones broke the turbid
              // ocean preset: at sigma_t = 0.46/m over a 125m cap, 24 steps sit
              // 5.2m apart against a 2.2m mean free path, so the first sample
              // outweighed the second tenfold and the red channel was decided by
              // a single jittered position - noise per pixel. Importance
              // sampling packs them into the few metres that carry the weight,
              // where consecutive samples land close enough that the jitter
              // barely moves them.
              //
              // Placement goes by the *least* attenuated channel, not by the
              // luminance-weighted mean. The per-channel correction is
              // exp(-sigma_c * t) / pdf, which grows like
              // exp((sigma_place - sigma_c) * t): any channel thinner than the
              // placement rate gets an exponentially growing weight, and its
              // mean ends up decided by the single furthest sample. The
              // luminance mean did exactly that here - sigma_lum = 0.30 against
              // a blue 0.24 put a factor of 2000 on the last sample at 125m,
              // which is both far outside the caustic map (so no pattern, hence
              // no visible shafts) and violently jittered (hence the grain).
              // Taking the minimum makes every exponent non-positive, so no
              // weight can ever run away.
              this.$l.sigmaPlace = pb.max(
                pb.min(pb.min(this.mediumExtinction.x, this.mediumExtinction.y), this.mediumExtinction.z),
                1e-3
              );
              // Renormalises the exponential to the finite path, so the samples
              // span exactly the visible stretch however short it is.
              this.$l.cdfMax = pb.sub(1, pb.exp(pb.neg(pb.mul(this.sigmaPlace, this.pathLength))));
              this.$l.shafts = pb.vec3(0);
              this.$l.weightSum = pb.vec3(0);
              this.$for(pb.int('i'), 0, steps, function () {
                this.$l.u = pb.div(pb.add(pb.float(this.i), this.jitter), steps);
                this.$l.t = pb.min(
                  pb.div(
                    pb.neg(pb.log(pb.max(pb.sub(1, pb.mul(this.u, this.cdfMax)), 1e-6))),
                    this.sigmaPlace
                  ),
                  this.pathLength
                );
                this.$l.samplePos = pb.add(this.cameraPosition, pb.mul(this.viewDir, this.t));
                // How much sun survives to this point: the caustic map's own
                // answer, which already carries both the Beer-Lambert
                // transmittance down the sun ray and the focusing pattern the
                // waves impose on it. Sharing it is what makes a shaft line up
                // with the caustic cell it lands in.
                this.$l.sunAtP = ShaderHelper.sampleWaterCaustic(
                  this,
                  this.samplePos,
                  pb.int(LIGHT_TYPE_DIRECTIONAL),
                  this.sunDirection,
                  false
                );
                // Transmittance back to the eye over the density the sample was
                // drawn from. The constant factors of the pdf - sigmaPlace and
                // cdfMax - are the same for every sample, so they cancel in the
                // ratio below and only the exponentials are kept.
                this.$l.weight = pb.exp(
                  pb.mul(pb.sub(pb.vec3(this.sigmaPlace), this.mediumExtinction), this.t)
                );
                this.shafts = pb.add(this.shafts, pb.mul(this.sunAtP, this.weight));
                this.weightSum = pb.add(this.weightSum, this.weight);
              });
              // The closed form of the same integral with sunAtP held at its
              // sampled mean: sigma_s/sigma_t * (1 - exp(-sigma_t * path)) is
              // exactly the (1 - transmittance) factor the ambient term uses, so
              // the two halves of the in-scattering share one normalisation and
              // a shaft can never exceed the light available to it.
              this.$l.meanSun = pb.div(this.shafts, pb.max(this.weightSum, pb.vec3(1e-6)));
              this.inscatter = pb.add(
                this.inscatter,
                pb.mul(
                  this.meanSun,
                  this.mediumAlbedo,
                  pb.sub(pb.vec3(1), this.transmittance),
                  this.sunColor,
                  pb.mul(this.phase, this.params.w)
                )
              );
            }
            this.$outputs.outColor = pb.vec4(this.inscatter, 1);
          }
        });
      }
    })!;
    program.name = inscatter ? '@UnderwaterInscatter' : '@UnderwaterExtinction';
    return program;
  }
}
