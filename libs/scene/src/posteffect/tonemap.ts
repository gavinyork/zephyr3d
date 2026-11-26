import { AbstractPostEffect, PostEffectLayer } from './posteffect';
import type { PostEffectSetupContext } from './posteffect';
import { linearToGamma } from '../shaders/misc';
import { SSR_interleavedGradientNoise } from '../shaders/ssr';
import type { AbstractDevice, BindGroup, GPUProgram, Texture2D } from '@zephyr3d/device';
import type { DrawContext } from '../render';
import type { RGHandle } from '../render/rendergraph/types';
import { fetchSampler } from '../utility/misc';
import type { Nullable } from '@zephyr3d/base';
import { Vector2, Vector4 } from '@zephyr3d/base';

/** Side of the texture the scene is metered into before it is reduced to one value */
const METER_SIZE = 64;
/** Scene luminance metered to this value, before the ACES input scale, shows as middle grey */
const MIDDLE_GREY = 0.18;
/** Luminance floor of the metering, so black pixels do not drag the log average to minus infinity */
const METER_MIN_LOG2 = -16;
const METER_MAX_LOG2 = 16;
/** Longest frame the adaptation steps over, so a stall does not snap the exposure */
const MAX_ADAPT_DT = 0.25;

/**
 * The tonemap post effect
 * @public
 */
export class Tonemap extends AbstractPostEffect {
  /**
   * @internal
   *
   * ACES input calibration. Matches Filament's `ACESLegacy` tone mapper, which pre-scales its input
   * by `1 / 0.6` before the RRT+ODT fit. Applied in every lighting mode, independent of exposure.
   */
  static readonly ACES_INPUT_SCALE = 1 / 0.6;
  private static _programTonemap: Nullable<GPUProgram> = null;
  private static _bindgroupTonemap: Nullable<BindGroup> = null;
  private static _programMeter: Nullable<GPUProgram> = null;
  private static _bindgroupMeter: Nullable<BindGroup> = null;
  private static _programReduce: Nullable<GPUProgram> = null;
  private static _bindgroupReduce: Nullable<BindGroup> = null;
  private static _programAdapt: Nullable<GPUProgram> = null;
  private static _bindgroupAdapt: Nullable<BindGroup> = null;
  private _exposure: number;
  private _dither: boolean;
  private _autoExposure: boolean;
  private _autoExposureMinEV: number;
  private _autoExposureMaxEV: number;
  private _autoExposureBias: number;
  private _autoExposureSpeedUp: number;
  private _autoExposureSpeedDown: number;
  /** Adapted exposure of the last frame, carried over to the next */
  private _adaptHistory: Nullable<Texture2D>;
  /** Adapted exposure of this frame, between the auto exposure pass and the tonemap pass */
  private _adaptCurrent: Nullable<Texture2D>;
  private _adaptReset: boolean;
  private _adaptFrame: number;
  private readonly _meterParams: Vector4;
  private readonly _adaptParams: Vector4;
  private readonly _adaptParams2: Vector4;
  /**
   * Creates an instance of tonemap post effect
   */
  constructor() {
    super();
    // End layer: the display chain runs after the TAA resolve (see Camera.setupPostEffects).
    this._layer = PostEffectLayer.end;
    this._exposure = 1;
    this._dither = true;
    this._autoExposure = false;
    this._autoExposureMinEV = -8;
    this._autoExposureMaxEV = 8;
    this._autoExposureBias = 0;
    this._autoExposureSpeedUp = 3;
    this._autoExposureSpeedDown = 1;
    this._adaptHistory = null;
    this._adaptCurrent = null;
    this._adaptReset = true;
    this._adaptFrame = -1;
    this._meterParams = new Vector4();
    this._adaptParams = new Vector4();
    this._adaptParams2 = new Vector4();
  }
  /**
   * Whether the exposure follows the brightness of the scene, like an eye or a camera adapting.
   *
   * @remarks
   * The scene is metered every frame, centre-weighted, as the average of the log of its luminance,
   * and the exposure moves towards bringing that average to middle grey at
   * {@link Tonemap.autoExposureSpeedUp} or {@link Tonemap.autoExposureSpeedDown}. The adjustment is
   * made on top of {@link Tonemap.exposure}, within {@link Tonemap.autoExposureMinEV} and
   * {@link Tonemap.autoExposureMaxEV} stops of it, and then offset by
   * {@link Tonemap.autoExposureBias}. Everything stays on the GPU; nothing is read back.
   */
  get autoExposure() {
    return this._autoExposure;
  }
  set autoExposure(val: boolean) {
    val = !!val;
    if (val !== this._autoExposure) {
      this._autoExposure = val;
      this._adaptReset = true;
    }
  }
  /** Lowest adjustment auto exposure makes, in stops below {@link Tonemap.exposure}. Default -8 */
  get autoExposureMinEV() {
    return this._autoExposureMinEV;
  }
  set autoExposureMinEV(val: number) {
    this._autoExposureMinEV = val;
  }
  /** Highest adjustment auto exposure makes, in stops above {@link Tonemap.exposure}. Default 8 */
  get autoExposureMaxEV() {
    return this._autoExposureMaxEV;
  }
  set autoExposureMaxEV(val: number) {
    this._autoExposureMaxEV = val;
  }
  /**
   * Stops added to the exposure auto exposure settles on: positive brightens, negative darkens.
   * Applied after {@link Tonemap.autoExposureMinEV} and {@link Tonemap.autoExposureMaxEV}.
   * Default 0
   */
  get autoExposureBias() {
    return this._autoExposureBias;
  }
  set autoExposureBias(val: number) {
    this._autoExposureBias = val;
  }
  /**
   * How fast auto exposure adapts when the scene gets brighter, as the rate of an exponential
   * approach per second: 3 covers 95% of the change in a second. Default 3
   */
  get autoExposureSpeedUp() {
    return this._autoExposureSpeedUp;
  }
  set autoExposureSpeedUp(val: number) {
    this._autoExposureSpeedUp = Math.max(0, val);
  }
  /**
   * How fast auto exposure adapts when the scene gets darker, as the rate of an exponential
   * approach per second: 1 covers 63% of the change in a second. Default 1
   */
  get autoExposureSpeedDown() {
    return this._autoExposureSpeedDown;
  }
  set autoExposureSpeedDown(val: number) {
    this._autoExposureSpeedDown = Math.max(0, val);
  }
  /**
   * Makes auto exposure settle on the next frame's scene at once instead of adapting to it, for a
   * cut to a different view.
   */
  resetAutoExposure() {
    this._adaptReset = true;
  }
  /**
   * Whether to dither the result before it is quantized to an 8-bit target.
   *
   * @remarks
   * Costs a handful of ALU operations and removes the banding that shallow gradients -- bloom
   * halos, smooth skies, fog -- otherwise show once rounded to 8 bits. The added noise is +-1 code
   * value, below the visible threshold on any ordinary display. Only applied when this pass writes
   * the final 8-bit target; a half-float intermediate is left untouched.
   *
   * Turn it off when capturing frames for pixel comparison, where reproducible output matters more
   * than smooth gradients.
   */
  get dither() {
    return this._dither;
  }
  set dither(val) {
    this._dither = !!val;
  }
  /**
   * Exposure multiplier applied before the ACES curve.
   *
   * @remarks
   * Physical lighting pre-exposes every light quantity on the CPU, so this stays at 1 there and
   * only legacy uses it as a brightness control.
   */
  get exposure() {
    return this._exposure;
  }
  set exposure(val) {
    this._exposure = val;
  }
  /** {@inheritDoc AbstractPostEffect.requireLinearDepthTexture} */
  requireLinearDepthTexture() {
    return false;
  }
  /** {@inheritDoc AbstractPostEffect.requireDepthAttachment} */
  requireDepthAttachment() {
    return false;
  }
  /** {@inheritDoc AbstractPostEffect.setup} */
  setup(s: PostEffectSetupContext): RGHandle {
    // Metering renders to half float targets; without them the exposure stays where it is set
    if (!this._autoExposure || !s.ctx.device.getDeviceCaps().textureCaps.supportHalfFloatColorBuffer) {
      this._adaptCurrent = null;
      return this._setupFromApply(s);
    }
    // Meter the scene and adapt in a pass of its own; the tonemap pass reads its 1x1 result
    const exposure = s.graph.addPass('Tonemap:AutoExposure', (builder) => {
      builder.read(s.input);
      for (const dep of s.dependencies) {
        builder.read(dep);
      }
      const out = builder.createTexture({
        format: 'rgba16f',
        sizeMode: 'absolute',
        width: 1,
        height: 1,
        label: 'Tonemap:exposure'
      });
      builder.setExecute((rg) => {
        const device = s.ctx.device;
        device.pushDeviceStates();
        try {
          this._adaptCurrent = this._updateExposure(
            device,
            rg.getTexture<Texture2D>(s.input),
            rg.getTexture<Texture2D>(out)
          );
        } finally {
          device.popDeviceStates();
        }
      });
      return out;
    });
    return this._setupFromApply({ ...s, dependencies: [...s.dependencies, exposure] });
  }
  /** {@inheritDoc AbstractPostEffect.apply} */
  apply(ctx: DrawContext, inputColorTexture: Texture2D, sceneDepthTexture: Texture2D, srgbOutput: boolean) {
    const device = ctx.device;
    this._prepare(device, inputColorTexture);
    this._tonemap(device, inputColorTexture, srgbOutput);
    this._adaptCurrent = null;
  }
  /** @internal */
  protected onDispose() {
    super.onDispose();
    this._adaptHistory?.dispose();
    this._adaptHistory = null;
    this._adaptCurrent = null;
  }
  /** @internal */
  private _tonemap(device: AbstractDevice, inputColorTexture: Texture2D, sRGBOutput: boolean) {
    Tonemap._bindgroupTonemap!.setValue('srgbOut', sRGBOutput ? 1 : 0);
    // Only dither when this pass feeds an 8-bit target. Writing into a half-float intermediate
    // (an effect still follows) has ~11 bits of mantissa to spare, so noise there is pure loss.
    Tonemap._bindgroupTonemap!.setValue('dither', this._dither && sRGBOutput ? 1 : 0);
    Tonemap._bindgroupTonemap!.setValue('exposure', this._exposure * Tonemap.ACES_INPUT_SCALE);
    Tonemap._bindgroupTonemap!.setValue('flip', this.needFlip(device) ? 1 : 0);
    Tonemap._bindgroupTonemap!.setTexture('tex', inputColorTexture, fetchSampler('clamp_nearest_nomip'));
    // Without auto exposure the adjustment texture is not read; any texture keeps the binding valid
    const adapt = this._adaptCurrent;
    Tonemap._bindgroupTonemap!.setValue('autoExposure', adapt ? 1 : 0);
    Tonemap._bindgroupTonemap!.setTexture(
      'adaptTex',
      adapt ?? inputColorTexture,
      fetchSampler('clamp_nearest_nomip')
    );
    device.setProgram(Tonemap._programTonemap);
    device.setBindGroup(0, Tonemap._bindgroupTonemap!);
    this.drawFullscreenQuad();
  }
  /**
   * Meters the scene, reduces it to one centre-weighted log average and moves last frame's
   * exposure adjustment towards the one that brings it to middle grey. Writes the adjustment in
   * stops to the red channel of `out` and keeps a copy for the next frame.
   * @internal
   */
  private _updateExposure(device: AbstractDevice, input: Texture2D, out: Texture2D): Texture2D {
    this._prepareAutoExposure(device);
    if (!this._adaptHistory || this._adaptHistory.disposed) {
      this._adaptHistory = device.createTexture2D('rgba16f', 1, 1, { mipmapping: false })!;
      this._adaptHistory.name = 'TonemapAdaptHistory';
      this._adaptReset = true;
    }
    const frame = device.frameInfo.frameCounter;
    // Several views of one camera in a frame adapt once
    const dt =
      frame === this._adaptFrame ? 0 : Math.min(MAX_ADAPT_DT, (device.frameInfo.elapsedFrame || 0) * 0.001);
    this._adaptFrame = frame;
    // 1. Meter: each texel averages a 4x4 grid of bilinear taps over its share of the input
    const meter = device.pool.fetchTemporalTexture2D(false, 'rgba16f', METER_SIZE, METER_SIZE, false);
    device.setFramebuffer([meter]);
    device.setViewport(null);
    device.setScissor(null);
    this._meterParams.setXYZW(this._exposure, input.width / Math.max(1, input.height), METER_SIZE, 0);
    const bgMeter = Tonemap._bindgroupMeter!;
    bgMeter.setTexture('tex', input, fetchSampler('clamp_linear_nomip'));
    bgMeter.setValue('params', this._meterParams);
    device.setProgram(Tonemap._programMeter);
    device.setBindGroup(0, bgMeter);
    this.drawFullscreenQuad();
    // 2. Reduce 4x4 at a time down to one texel
    let src = meter;
    const temps = [meter];
    for (let size = METER_SIZE >> 2; size >= 1; size >>= 2) {
      const dst = device.pool.fetchTemporalTexture2D(false, 'rgba16f', size, size, false);
      this._reduce(device, src, dst);
      temps.push(dst);
      src = dst;
    }
    // 3. Adapt from last frame's adjustment, then carry the result over to the next frame
    device.setFramebuffer([out]);
    device.setViewport(null);
    device.setScissor(null);
    this._adaptParams.setXYZW(
      Math.log2(MIDDLE_GREY),
      this._autoExposureMinEV,
      Math.max(this._autoExposureMinEV, this._autoExposureMaxEV),
      this._autoExposureBias
    );
    this._adaptParams2.setXYZW(
      1 - Math.exp(-dt * this._autoExposureSpeedUp),
      1 - Math.exp(-dt * this._autoExposureSpeedDown),
      this._adaptReset ? 1 : 0,
      0
    );
    const bgAdapt = Tonemap._bindgroupAdapt!;
    bgAdapt.setTexture('avgTex', src, fetchSampler('clamp_nearest_nomip'));
    bgAdapt.setTexture('historyTex', this._adaptHistory, fetchSampler('clamp_nearest_nomip'));
    bgAdapt.setValue('params', this._adaptParams);
    bgAdapt.setValue('params2', this._adaptParams2);
    device.setProgram(Tonemap._programAdapt);
    device.setBindGroup(0, bgAdapt);
    this.drawFullscreenQuad();
    this._reduce(device, out, this._adaptHistory);
    this._adaptReset = false;
    for (const tex of temps) {
      device.pool.releaseTexture(tex);
    }
    return out;
  }
  /** Averages 4x4 texels of `src` into each texel of `dst`, clamping at the edges @internal */
  private _reduce(device: AbstractDevice, src: Texture2D, dst: Texture2D) {
    device.setFramebuffer([dst]);
    device.setViewport(null);
    device.setScissor(null);
    const bg = Tonemap._bindgroupReduce!;
    bg.setTexture('tex', src, fetchSampler('clamp_nearest_nomip'));
    bg.setValue('srcSize', new Vector2(src.width, src.height));
    device.setProgram(Tonemap._programReduce);
    device.setBindGroup(0, bg);
    this.drawFullscreenQuad();
  }
  /** @internal */
  private _prepareAutoExposure(device: AbstractDevice) {
    if (Tonemap._programMeter) {
      return;
    }
    const vertex = function (this: any, pb: any) {
      this.$inputs.pos = pb.vec2().attrib('position');
      pb.main(function (this: any) {
        this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
      });
    };
    Tonemap._programMeter = device.buildRenderProgram({
      vertex,
      fragment(pb) {
        // x: exposure applied before metering, y: aspect ratio of the input, z: meter size
        this.params = pb.vec4().uniform(0);
        this.tex = pb.tex2D().uniform(0);
        this.$outputs.outColor = pb.vec4();
        pb.main(function () {
          this.$l.cell = pb.floor(this.$builtins.fragCoord.xy);
          // Centre weighting: the middle of the view counts about three times as much as its sides
          this.$l.centre = pb.sub(pb.div(pb.add(this.cell, pb.vec2(0.5)), this.params.z), pb.vec2(0.5));
          this.$l.d = pb.mul(this.centre, pb.vec2(this.params.y, 1));
          this.$l.w = pb.exp(pb.neg(pb.dot(this.d, this.d)));
          this.$l.sum = pb.float(0);
          this.$for(pb.int('i'), 0, 4, function () {
            this.$for(pb.int('j'), 0, 4, function () {
              this.$l.uv = pb.div(
                pb.add(
                  this.cell,
                  pb.div(pb.add(pb.vec2(pb.float(this.i), pb.float(this.j)), pb.vec2(0.5)), 4)
                ),
                this.params.z
              );
              this.$l.rgb = pb.textureSampleLevel(this.tex, this.uv, 0).rgb;
              this.$l.lum = pb.mul(pb.dot(this.rgb, pb.vec3(0.2126, 0.7152, 0.0722)), this.params.x);
              this.sum = pb.add(
                this.sum,
                pb.clamp(
                  pb.log2(pb.max(this.lum, Math.pow(2, METER_MIN_LOG2))),
                  METER_MIN_LOG2,
                  METER_MAX_LOG2
                )
              );
            });
          });
          // Weighted log luminance and weight, both averaged by the reduction: their ratio is the
          // weighted average
          this.$outputs.outColor = pb.vec4(pb.mul(pb.div(this.sum, 16), this.w), this.w, 0, 1);
        });
      }
    })!;
    Tonemap._programMeter.name = '@TonemapMeter';
    Tonemap._bindgroupMeter = device.createBindGroup(Tonemap._programMeter.bindGroupLayouts[0]);
    Tonemap._programReduce = device.buildRenderProgram({
      vertex,
      fragment(pb) {
        this.srcSize = pb.vec2().uniform(0);
        this.tex = pb.tex2D().uniform(0);
        this.$outputs.outColor = pb.vec4();
        pb.main(function () {
          this.$l.base = pb.mul(pb.ivec2(pb.floor(this.$builtins.fragCoord.xy)), 4);
          this.$l.maxCoord = pb.sub(pb.ivec2(this.srcSize), pb.ivec2(1));
          this.$l.sum = pb.vec4(0);
          this.$for(pb.int('i'), 0, 4, function () {
            this.$for(pb.int('j'), 0, 4, function () {
              this.$l.coord = pb.min(pb.add(this.base, pb.ivec2(this.i, this.j)), this.maxCoord);
              this.sum = pb.add(this.sum, pb.textureLoad(this.tex, this.coord, 0));
            });
          });
          this.$outputs.outColor = pb.div(this.sum, 16);
        });
      }
    })!;
    Tonemap._programReduce.name = '@TonemapReduce';
    Tonemap._bindgroupReduce = device.createBindGroup(Tonemap._programReduce.bindGroupLayouts[0]);
    Tonemap._programAdapt = device.buildRenderProgram({
      vertex,
      fragment(pb) {
        // x: log2 of middle grey, y: min EV, z: max EV, w: bias
        this.params = pb.vec4().uniform(0);
        // x: blend towards a brighter scene, y: towards a darker scene, z: 1 to settle at once
        this.params2 = pb.vec4().uniform(0);
        this.avgTex = pb.tex2D().uniform(0);
        this.historyTex = pb.tex2D().uniform(0);
        this.$outputs.outColor = pb.vec4();
        pb.main(function () {
          this.$l.avg = pb.textureLoad(this.avgTex, pb.ivec2(0, 0), 0);
          this.$l.logLum = pb.div(this.avg.x, pb.max(this.avg.y, 1e-6));
          this.$l.targetEV = pb.add(
            pb.clamp(pb.sub(this.params.x, this.logLum), this.params.y, this.params.z),
            this.params.w
          );
          this.$l.previous = pb.textureLoad(this.historyTex, pb.ivec2(0, 0), 0).x;
          // A lower target exposure means the scene got brighter
          this.$l.rate = pb.float(0);
          this.$if(pb.lessThan(this.targetEV, this.previous), function () {
            this.rate = this.params2.x;
          }).$else(function () {
            this.rate = this.params2.y;
          });
          this.$l.adapted = pb.add(this.previous, pb.mul(pb.sub(this.targetEV, this.previous), this.rate));
          this.$if(pb.notEqual(this.params2.z, 0), function () {
            this.adapted = this.targetEV;
          });
          this.$outputs.outColor = pb.vec4(this.adapted, this.targetEV, this.logLum, 1);
        });
      }
    })!;
    Tonemap._programAdapt.name = '@TonemapAdapt';
    Tonemap._bindgroupAdapt = device.createBindGroup(Tonemap._programAdapt.bindGroupLayouts[0]);
  }
  /** @internal */
  private _prepare(device: AbstractDevice, _srcTexture: Texture2D) {
    if (!Tonemap._programTonemap) {
      Tonemap._programTonemap = device.buildRenderProgram({
        vertex(pb) {
          this.flip = pb.int().uniform(0);
          this.$inputs.pos = pb.vec2().attrib('position');
          this.$outputs.uv = pb.vec2();
          pb.main(function () {
            this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
            this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
            this.$if(pb.notEqual(this.flip, 0), function () {
              this.$builtins.position.y = pb.neg(this.$builtins.position.y);
            });
          });
        },
        fragment(pb) {
          this.srgbOut = pb.int().uniform(0);
          this.exposure = pb.float().uniform(0);
          this.dither = pb.int().uniform(0);
          this.autoExposure = pb.int().uniform(0);
          this.tex = pb.tex2D().uniform(0);
          this.adaptTex = pb.tex2D().uniform(0);
          this.$outputs.outColor = pb.vec4();
          pb.func('RRTAndODTFit', [pb.vec3('v')], function () {
            this.$l.a = pb.sub(pb.mul(this.v, pb.add(this.v, pb.vec3(0.0245786))), pb.vec3(0.000090537));
            this.$l.b = pb.add(
              pb.mul(this.v, pb.add(pb.mul(this.v, 0.983729), pb.vec3(0.432951))),
              pb.vec3(0.238081)
            );
            this.$return(pb.div(this.a, this.b));
          });
          pb.main(function () {
            this.$l.vSample = pb.textureSample(this.tex, this.$inputs.uv);
            this.$l.ACESInputMat = pb.mat3(
              0.59719,
              0.076,
              0.0284,
              0.35458,
              0.90834,
              0.13383,
              0.04823,
              0.01566,
              0.83777
            );
            this.$l.ACESOutputMat = pb.mat3(
              1.60475,
              -0.10208,
              -0.00327,
              -0.53108,
              1.10813,
              -0.07276,
              -0.07367,
              -0.00605,
              1.07602
            );
            this.$l.color = pb.mul(this.vSample.rgb, this.exposure);
            // Auto exposure adjustment in stops, sampled unconditionally to stay in uniform control flow
            this.$l.adaptEV = pb.textureSampleLevel(this.adaptTex, pb.vec2(0.5), 0).r;
            this.$if(pb.notEqual(this.autoExposure, 0), function () {
              this.color = pb.mul(this.color, pb.exp2(this.adaptEV));
            });
            this.color = pb.mul(this.ACESInputMat, this.color);
            this.color = this.RRTAndODTFit(this.color);
            this.color = pb.mul(this.ACESOutputMat, this.color);
            this.color = pb.clamp(this.color, pb.vec3(0), pb.vec3(1));
            this.$if(pb.notEqual(this.srgbOut, 0), function () {
              this.color = linearToGamma(this, this.color);
            });
            // Dither before the 8-bit write. This pass ends the HDR chain, so it is where a
            // shallow gradient gets quantized -- and a bloom halo is the shallowest gradient the
            // renderer produces: it can fall by less than 1/255 over several pixels, which
            // rounding turns into wide flat bands. Offsetting each pixel by well under one code
            // value before rounding trades those bands for noise below the visible threshold.
            //
            // The offset is a triangular PDF (sum of two uniforms), which is what audio and video
            // dithering use: unlike a single uniform it leaves no residual correlation between the
            // quantization error and the signal, so the bands do not merely move.
            this.$if(pb.notEqual(this.dither, 0), function () {
              // Interleaved gradient noise, the same helper the SSR and eye passes use. Two
              // decorrelated samples (the second offset by a half-period) sum to the triangular
              // distribution; (n1 + n2 - 1) then spans [-1, 1], scaled here to +-1 code value.
              this.$l.n1 = SSR_interleavedGradientNoise(this, this.$builtins.fragCoord.xy, 0);
              this.$l.n2 = SSR_interleavedGradientNoise(
                this,
                pb.add(this.$builtins.fragCoord.xy, pb.vec2(37, 17)),
                0
              );
              this.color = pb.add(this.color, pb.vec3(pb.div(pb.sub(pb.add(this.n1, this.n2), 1), 255)));
              this.color = pb.clamp(this.color, pb.vec3(0), pb.vec3(1));
            });
            this.$outputs.outColor = pb.vec4(this.color, 1);
          });
        }
      })!;
      Tonemap._programTonemap.name = '@Tonemap';
      Tonemap._bindgroupTonemap = device.createBindGroup(Tonemap._programTonemap.bindGroupLayouts[0]);
    }
  }
}
