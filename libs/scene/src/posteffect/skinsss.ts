import { DEPTH_FARTHEST, Vector2, Vector4 } from '@zephyr3d/base';
import type { BindGroup, GPUProgram, Texture2D } from '@zephyr3d/device';
import type { DrawContext } from '../render';
import { ShaderHelper } from '../material';
import { SSSProfile } from '../material/skinprofile';
import { linearToGamma } from '../shaders/misc';
import { hash21 } from '../shaders/noise';
import { fetchSampler } from '../utility/misc';
import { AbstractPostEffect, PostEffectLayer } from './posteffect';

/**
 * Intermediate quantity to visualize instead of the shaded result.
 *
 * @remarks
 * `'none'` renders normally. The rest replace the output with one term of the
 * diffusion, which is how an input problem is told apart from a kernel problem.
 *
 * @public
 */
export type SkinSSSDebugOutput =
  | 'none'
  /** Scatterable energy recovered from SceneColor and its diffuse-luminance alpha. */
  | 'diffusible'
  /** Fraction of the pixel treated as diffuse, from `SceneColor.a / luma`. */
  | 'diffuseAmount'
  /** Per-pixel profile id, as written by the material. */
  | 'profileId'
  /** World normal carried in the skin mask buffer. */
  | 'normal'
  /** Per-channel diffusion distance `d`, scaled for display. */
  | 'diffusionDistance'
  /** Median sample radius, in pixels. */
  | 'sampleRadius'
  /** Accumulated kernel weight, before normalization. */
  | 'weight'
  /** Fraction of taps that landed on skin. */
  | 'acceptance'
  /** CDF mass attributed to the centre pixel. */
  | 'centerWeight'
  /** The diffused result on its own, before recombination. */
  | 'diffused'
  /** Light-space thickness from the transmission pass, for the lights in layer 0. */
  | 'thickness';

const SKIN_SSS_DEBUG_OUTPUTS: SkinSSSDebugOutput[] = [
  'none',
  'diffusible',
  'diffuseAmount',
  'profileId',
  'normal',
  'diffusionDistance',
  'sampleRadius',
  'weight',
  'acceptance',
  'centerWeight',
  'diffused',
  'thickness'
];

/**
 * Radial-disc sample count, matching UE5's `BURLEY_NUM_SAMPLES`.
 *
 * @remarks
 * UE5 drives the count from a variance history and resolves the remainder
 * temporally. Without that history every frame stands on its own, so the full
 * count is used throughout.
 */
const DEFAULT_SAMPLE_COUNT = 64;

/**
 * Screen-space skin scattering — 3-pass pipeline aligned with UE5.
 *
 * @remarks
 * Pass 1 (Burley): Radial-disc Burley diffusion with Halton + inverse-CDF
 *   importance sampling, 3D bilateral distance, per-channel kernel.
 * Pass 2 (BVar): Luminance variance + depth gradient → transmission estimate.
 * Pass 3 (Recombine): Specular/diffuse separation via SceneColor.a, then the
 *   diffused half summed back with the specular remainder.
 *
 * The pass exposes no scattering parameters of its own — every one of them
 * belongs to the {@link SSSProfile} the material points at, as in UE5.
 *
 * WebGPU only.
 *
 * @public
 */
export class SkinSSS extends AbstractPostEffect {
  private static _burleyProgram: GPUProgram | null = null;
  private static _bvarProgram: GPUProgram | null = null;
  private static _recombineProgram: GPUProgram | null = null;
  private _burleyBindGroup: BindGroup | null;
  private _bvarBindGroup: BindGroup | null;
  private _recombineBindGroup: BindGroup | null;
  private _profile: SSSProfile | null;
  private _debugOutput: SkinSSSDebugOutput;
  private _debugExposure: number;
  private _sampleCount: number;
  private readonly _projScale: Vector2;
  private readonly _profileParams: Vector4;
  private readonly _targetSize: Vector4;
  private readonly _cameraNearFar: Vector2;

  constructor() {
    super();
    this._layer = PostEffectLayer.opaque;
    this._burleyBindGroup = null;
    this._bvarBindGroup = null;
    this._recombineBindGroup = null;
    this._profile = null;
    this._debugOutput = 'none';
    this._debugExposure = 1;
    this._sampleCount = DEFAULT_SAMPLE_COUNT;
    this._projScale = new Vector2();
    this._profileParams = new Vector4();
    this._targetSize = new Vector4();
    this._cameraNearFar = new Vector2();
  }

  /**
   * Fallback profile for pixels whose id is not in the table.
   *
   * @remarks
   * Scattering parameters normally come from the per-pixel profile id the skin
   * material writes, so this only applies when that lookup misses.
   *
   * @public
   */
  get profile(): SSSProfile | null {
    return this._profile;
  }
  set profile(val: SSSProfile | null) {
    this._profile = val ?? null;
  }
  get sampleCount() {
    return this._sampleCount;
  }
  set sampleCount(val) {
    this._sampleCount = Math.max(8, Math.min(64, Math.round(val ?? DEFAULT_SAMPLE_COUNT)));
  }

  /**
   * Multiplier applied to whatever {@link SkinSSS.debugOutput} renders.
   *
   * @remarks
   * Defaults to 1. Several intermediates sit in a narrow band that reads as a
   * flat tone at unit exposure, so raising this is how "no variation" is told
   * apart from "variation too small to see". No effect unless a debug output is
   * selected.
   *
   * @public
   */
  get debugExposure() {
    return this._debugExposure;
  }
  set debugExposure(val: number) {
    this._debugExposure = Math.max(0, val ?? 1);
  }

  /**
   * Intermediate quantity to render instead of the shaded result.
   *
   * @remarks
   * Defaults to `'none'`. See {@link SkinSSSDebugOutput}.
   *
   * @public
   */
  get debugOutput(): SkinSSSDebugOutput {
    return this._debugOutput;
  }
  set debugOutput(val: SkinSSSDebugOutput) {
    this._debugOutput = SKIN_SSS_DEBUG_OUTPUTS.includes(val) ? val : 'none';
  }

  requireLinearDepthTexture() {
    return true;
  }

  apply(ctx: DrawContext, inputColorTexture: Texture2D, sceneDepthTexture: Texture2D, srgbOutput: boolean) {
    if (!ctx.SSSMaskTexture || !ctx.SSSProfileIdTexture || ctx.device.type !== 'webgpu') {
      this.passThrough(ctx, inputColorTexture, srgbOutput);
      return;
    }
    const device = ctx.device;
    const outputFramebuffer = device.getFramebuffer();
    const maskTex = ctx.SSSMaskTexture;
    const profileIdTex = ctx.SSSProfileIdTexture;
    const width = inputColorTexture.width;
    const height = inputColorTexture.height;

    const scatterFormat = ctx.colorFormat;
    const profileTable = SSSProfile.getTable(device);
    if (!profileTable) {
      this.passThrough(ctx, inputColorTexture, srgbOutput);
      return;
    }
    const fallback = this._profile ?? SSSProfile.getDefault();
    // Projection of a world-space length at unit depth into UV, per axis. Two
    // factors, not one: `m00` and `m11` differ by the aspect ratio, so a single
    // one turns the sampling disc into an ellipse. UE5 reaches the same pair by
    // building x from m00 and correcting y by `Extent.x / Extent.y`.
    const projMatrix = ctx.camera.getProjectionMatrix();
    this._projScale.setXY(
      // x: world length at unit depth, in horizontal UV
      0.5 * projMatrix.m00,
      // y: world length at unit depth, in vertical UV
      0.5 * projMatrix.m11
    );
    // Row of the fallback profile, used when a pixel's id is missing.
    this._profileParams.setXYZW(
      fallback.encodedId,
      1 / SSSProfile.tableColumns,
      1 / SSSProfile.tableRows,
      SSSProfile.tableRows
    );
    this._targetSize.setXYZW(width, height, 1 / width, 1 / height);
    this._cameraNearFar.setXY(ctx.camera.getNearPlane(), ctx.camera.getFarPlane());

    if (!SkinSSS._burleyProgram) {
      SkinSSS._burleyProgram = this.createBurleyProgram(ctx);
    }
    if (!SkinSSS._bvarProgram) {
      SkinSSS._bvarProgram = this.createBVarProgram(ctx);
    }
    if (!SkinSSS._recombineProgram) {
      SkinSSS._recombineProgram = this.createRecombineProgram(ctx);
    }

    const diffusedFB = device.pool.fetchTemporalFramebuffer(false, width, height, scatterFormat, null, false);
    const bvarFB = device.pool.fetchTemporalFramebuffer(false, width, height, scatterFormat, null, false);

    // --- Pass 1: Burley diffusion ---
    device.pushDeviceStates();
    try {
      if (!this._burleyBindGroup) {
        this._burleyBindGroup = device.createBindGroup(SkinSSS._burleyProgram.bindGroupLayouts[0]);
      }
      const bg = this._burleyBindGroup;
      bg.setTexture('sceneTex', inputColorTexture, fetchSampler('clamp_linear'));
      bg.setTexture('maskTex', maskTex, fetchSampler('clamp_linear'));
      // Nearest only: the id is a table row, and an interpolated one addresses a
      // profile neither neighbour has.
      bg.setTexture('profileIdTex', profileIdTex, fetchSampler('clamp_nearest_nomip'));
      bg.setTexture('depthTex', sceneDepthTexture, fetchSampler('clamp_nearest_nomip'));
      bg.setValue('cameraNearFar', this._cameraNearFar);
      bg.setValue('targetSize', this._targetSize);
      bg.setValue('projScale', this._projScale);
      bg.setValue('perspective', ctx.camera.isPerspective() ? 1 : 0);
      bg.setValue('profileParams', this._profileParams);
      bg.setTexture('profileTex', profileTable, fetchSampler('clamp_nearest_nomip'));
      bg.setTexture(
        'thicknessTex',
        ctx.transmissionThicknessTexture ?? ShaderHelper.getDummyTransmissionThickness(device),
        fetchSampler('clamp_nearest')
      );
      bg.setValue('sampleCount', this._sampleCount);
      bg.setValue('debugMode', SKIN_SSS_DEBUG_OUTPUTS.indexOf(this._debugOutput));
      bg.setValue('debugExposure', this._debugExposure);
      // Intermediate passes always render into a texture, so on WebGPU they flip
      // unconditionally. `needFlip` cannot be used: it reports whatever target is
      // bound at the time, and these values are set before the pass binds its own.
      bg.setValue('flip', device.type === 'webgpu' ? 1 : 0);
      device.setProgram(SkinSSS._burleyProgram);
      device.setBindGroup(0, bg);
      device.setFramebuffer(diffusedFB);
      this.drawFullscreenQuad();
    } finally {
      device.popDeviceStates();
    }

    // --- Pass 2: BVar transmission ---
    device.pushDeviceStates();
    try {
      if (!this._bvarBindGroup) {
        this._bvarBindGroup = device.createBindGroup(SkinSSS._bvarProgram.bindGroupLayouts[0]);
      }
      const bg = this._bvarBindGroup;
      bg.setTexture(
        'diffusedTex',
        diffusedFB.getColorAttachments()[0] as Texture2D,
        fetchSampler('clamp_linear')
      );
      bg.setTexture('depthTex', sceneDepthTexture, fetchSampler('clamp_nearest_nomip'));
      bg.setValue('targetSize', this._targetSize);
      bg.setValue('cameraNearFar', this._cameraNearFar);
      bg.setValue('flip', device.type === 'webgpu' ? 1 : 0);
      device.setProgram(SkinSSS._bvarProgram);
      device.setBindGroup(0, bg);
      device.setFramebuffer(bvarFB);
      this.drawFullscreenQuad();
    } finally {
      device.popDeviceStates();
    }

    // --- Pass 3: Recombine ---
    device.setFramebuffer(outputFramebuffer);
    if (!this._recombineBindGroup) {
      this._recombineBindGroup = device.createBindGroup(SkinSSS._recombineProgram.bindGroupLayouts[0]);
    }
    const rbg = this._recombineBindGroup;
    rbg.setTexture('colorTex', inputColorTexture, fetchSampler('clamp_linear'));
    rbg.setTexture('maskTex', maskTex, fetchSampler('clamp_linear'));
    rbg.setTexture('bvarTex', bvarFB.getColorAttachments()[0] as Texture2D, fetchSampler('clamp_linear'));
    rbg.setTexture('depthTex', sceneDepthTexture, fetchSampler('clamp_nearest_nomip'));
    rbg.setValue('cameraNearFar', this._cameraNearFar);
    rbg.setValue('targetSize', this._targetSize);
    rbg.setValue('debugMode', SKIN_SSS_DEBUG_OUTPUTS.indexOf(this._debugOutput));
    rbg.setValue('flip', this.needFlip(device) ? 1 : 0);
    rbg.setValue('srgbOut', srgbOutput ? 1 : 0);
    device.setProgram(SkinSSS._recombineProgram);
    device.setBindGroup(0, rbg);
    this.drawFullscreenQuad();
    device.pool.releaseFrameBuffer(diffusedFB);
    device.pool.releaseFrameBuffer(bvarFB);
  }

  private static fullscreenVertex(pb: any) {
    pb.getGlobalScope().flip = pb.int().uniform(0);
    pb.getGlobalScope().$inputs.pos = pb.vec2().attrib('position');
    pb.getGlobalScope().$outputs.uv = pb.vec2();
    pb.main(function (this: any) {
      this.$builtins.position = pb.vec4(this.$inputs.pos, DEPTH_FARTHEST, 1);
      this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
      this.$if(pb.notEqual(this.flip, 0), function (this: any) {
        this.$builtins.position.y = pb.neg(this.$builtins.position.y);
      });
    });
  }

  private createBurleyProgram(ctx: DrawContext) {
    // WebGL1 has no texture array sampling. This effect is WebGPU-only at
    // runtime, but its programs are still built for WebGL by the shader
    // generation tests, so the thickness debug view has to compile out there.
    const hasTextureArrays = ctx.device.type !== 'webgl';
    const program = ctx.device.buildRenderProgram({
      vertex(pb) {
        SkinSSS.fullscreenVertex(pb);
      },
      fragment(pb) {
        this.depthTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
        this.sceneTex = pb.tex2D().uniform(0);
        this.maskTex = pb.tex2D().uniform(0);
        this.profileIdTex = pb.tex2D().uniform(0);
        this.cameraNearFar = pb.vec2().uniform(0);
        this.targetSize = pb.vec4().uniform(0);
        this.projScale = pb.vec2().uniform(0);
        this.perspective = pb.int().uniform(0);
        this.profileParams = pb.vec4().uniform(0);
        this.profileTex = pb.tex2D().uniform(0);
        // Always declared so the cached program has one layout; a 1x1 dummy is
        // bound on frames without a transmission pass. Only the debug view reads
        // it — shading takes its thickness through the material, per light.
        if (hasTextureArrays) {
          this.thicknessTex = pb.tex2DArray().uniform(0);
        }
        this.sampleCount = pb.int().uniform(0);
        this.debugMode = pb.int().uniform(0);
        this.debugExposure = pb.float().uniform(0);
        this.$outputs.outColor = pb.vec4();
        pb.func('readDepth01', [pb.vec2('uv')], function () {
          this.$return(ShaderHelper.sampleLinearDepth(this, this.depthTex, this.uv, 0));
        });
        // UE5's spec/diff separation (SSS::Setup): SceneColor.a holds the diffuse
        // luminance, so the diffusible fraction is its ratio to the total.
        //
        // The skin mask comes from its own channel, never SceneColor.a, which
        // every opaque material writes 1 to. The alpha returned here is UE5's
        // subsurface Opacity, a continuous 0..1 scattering weight.
        pb.func('readDiffusible', [pb.vec2('uv')], function () {
          this.$l.scene = pb.textureSampleLevel(this.sceneTex, this.uv, 0);
          this.$l.opacity = pb.clamp(pb.textureSampleLevel(this.maskTex, this.uv, 0).a, 0, 1);
          this.$l.lum = pb.dot(this.scene.rgb, pb.vec3(0.2126, 0.7152, 0.0722));
          // Below the floor the ratio tracks brightness rather than the split, so
          // treat those pixels as fully diffusible - one that dark has no specular
          // worth preserving.
          //
          // `pb.select(x, y, cond)` is `cond ? y : x`, following WGSL's builtin
          // where the *false* value comes first. It reads like a ternary and is
          // not one.
          this.$l.diffAmt = pb.select(
            pb.float(1),
            pb.clamp(pb.div(this.scene.a, pb.max(this.lum, 1e-4)), 0, 1),
            pb.greaterThan(this.lum, 1e-4)
          );
          this.$return(pb.vec4(pb.mul(this.scene.rgb, this.diffAmt), this.opacity));
        });
        // Per-pixel profile id, from the depth prepass rather than the mask
        // buffer. Keeping them apart is what lets the opacity above be
        // continuous: one channel cannot carry a table row and a weight at once.
        pb.func('readProfileId', [pb.vec2('uv')], function () {
          this.$return(pb.textureSampleLevel(this.profileIdTex, this.uv, 0).r);
        });
        // --- Burley diffusion, transcribed from UE5's BurleyNormalizedSSSCommon.ush ---
        //
        // Radii are in profile space and unbounded: the inverse CDF produces them
        // directly and `burleyScale` converts them to a UV offset. There is
        // deliberately no sampling disc to normalize against - one would couple
        // the kernel shape to the mean free path.

        // GetSearchLightDiffuseScalingFactor: s = 3.5 + 100 (A - 0.33)^4.
        // This is the default of UE5's three scaling-factor variants.
        pb.func('scalingFactor', [pb.float('a')], function () {
          this.$l.v = pb.sub(this.a, 0.33);
          this.$l.v2 = pb.mul(this.v, this.v);
          this.$return(pb.add(3.5, pb.mul(100, this.v2, this.v2)));
        });
        pb.func('scalingFactor3D', [pb.vec3('a')], function () {
          this.$l.v = pb.sub(this.a, pb.vec3(0.33));
          this.$l.v2 = pb.mul(this.v, this.v);
          this.$return(pb.add(pb.vec3(3.5), pb.mul(pb.vec3(100), this.v2, this.v2)));
        });
        // RadiusRootFindByApproximation: d ((2 - 2.6) xi - 2) ln(1 - xi).
        pb.func('radiusRootApprox', [pb.float('d'), pb.float('xi')], function () {
          this.$l.x = pb.min(this.xi, 0.9999);
          this.$return(
            pb.mul(this.d, pb.sub(pb.mul(pb.sub(2, 2.6), this.x), 2), pb.log(pb.max(pb.sub(1, this.x), 1e-6)))
          );
        });
        // GetCDFDeriv1: 0.25/d (e^{-r/d} + e^{-r/3d}), clamped as CLAMP_PDF does.
        pb.func('burleyPdf', [pb.float('r'), pb.float('l'), pb.float('s')], function () {
          this.$l.d = pb.max(pb.div(this.l, this.s), 1e-6);
          this.$l.e1 = pb.exp(pb.neg(pb.min(pb.div(this.r, this.d), 40)));
          this.$l.e2 = pb.exp(pb.neg(pb.min(pb.div(this.r, pb.mul(this.d, 3)), 40)));
          this.$return(pb.max(pb.mul(pb.div(0.25, this.d), pb.add(this.e1, this.e2)), 1e-5));
        });
        // GetDiffuseReflectProfileWithDiffuseMeanFreePath: r R(r), per channel.
        //   D = 1/s3d,  R = radius/L,  (e^{-R/D} + e^{-R/3D}) / (D L) / 8pi
        pb.func('diffusionProfile', [pb.vec3('l'), pb.vec3('s3d'), pb.float('radius')], function () {
          this.$l.D = pb.div(pb.vec3(1), pb.max(this.s3d, pb.vec3(1e-6)));
          this.$l.L = pb.max(this.l, pb.vec3(1e-6));
          this.$l.R = pb.div(pb.vec3(this.radius), this.L);
          this.$l.negRD = pb.div(pb.neg(this.R), this.D);
          this.$l.e1 = pb.exp(pb.max(this.negRD, pb.vec3(-40)));
          this.$l.e2 = pb.exp(pb.max(pb.div(this.negRD, 3), pb.vec3(-40)));
          this.$return(
            pb.max(pb.div(pb.add(this.e1, this.e2), pb.mul(this.D, this.L, 8 * Math.PI)), pb.vec3(1e-12))
          );
        });
        // GetCDF with XI = 0, used to weight the centre sample.
        pb.func('burleyCdf', [pb.float('d'), pb.float('x')], function () {
          this.$l.sd = pb.max(this.d, 1e-6);
          this.$return(
            pb.clamp(
              pb.sub(
                pb.sub(1, pb.mul(0.25, pb.exp(pb.neg(pb.min(pb.div(this.x, this.sd), 40))))),
                pb.mul(0.75, pb.exp(pb.neg(pb.min(pb.div(this.x, pb.mul(this.sd, 3)), 40))))
              ),
              0,
              1
            )
          );
        });
        // R2Sequence: the low-discrepancy pair UE5 samples radius and angle with.
        // The index must stay an integer - offsetting it by a per-pixel fraction
        // turns the sequence into a phase sweep correlated with pixel position,
        // which shows up as banding.
        pb.func('r2Sequence', [pb.int('i')], function () {
          this.$return(pb.fract(pb.mul(pb.vec2(0.7548776662466927, 0.5698402909980532), pb.float(this.i))));
        });
        // Fetch one parameter column of a profile row. `id` is the normalized
        // per-pixel profile id; rows are addressed by it directly, as UE5 does
        // with its SSProfiles table.
        pb.func('readProfile', [pb.float('id'), pb.float('column')], function () {
          this.$l.u = pb.mul(pb.add(this.column, 0.5), this.profileParams.y);
          this.$l.v = pb.mul(pb.add(pb.mul(pb.clamp(this.id, 0, 1), 255), 0.5), this.profileParams.z);
          this.$return(pb.textureSampleLevel(this.profileTex, pb.vec2(this.u, this.v), 0));
        });
        pb.func('readNormal', [pb.vec2('uv')], function () {
          this.$return(
            pb.normalize(pb.sub(pb.mul(pb.textureSampleLevel(this.maskTex, this.uv, 0).rgb, 2), pb.vec3(1)))
          );
        });
        pb.main(function () {
          this.$l.uv = this.$inputs.uv;
          this.$l.center = this.readDiffusible(this.uv);
          this.$l.centerId = this.readProfileId(this.uv);
          this.$l.centerDepth01 = this.readDepth01(this.uv);
          this.$outputs.outColor = this.center;
          // Two distinct tests: a pixel can carry a profile with zero opacity, or
          // an opacity with no profile where the prepass and the light pass
          // disagree about coverage. Neither scatters.
          this.$if(
            pb.and(
              pb.lessThan(this.centerDepth01, 1),
              pb.and(pb.greaterThan(this.center.a, 1e-4), pb.greaterThan(this.centerId, 0.5 / 255))
            ),
            function () {
              this.$l.centerDepth = pb.max(pb.mul(this.centerDepth01, this.cameraNearFar.y), 1e-4);
              this.$l.centerNormal = this.readNormal(this.uv);
              this.$l.scaling = this.readProfile(this.centerId, 0);
              this.$l.albedo = this.readProfile(this.centerId, 1);
              this.$l.mfp = this.readProfile(this.centerId, 2);
              this.$l.boundaryBleed = this.readProfile(this.centerId, 3).rgb;
              this.$l.worldUnitScale = pb.max(this.scaling.x, 1e-3);

              // UE5 draws the radius from one representative channel
              // (SurfaceAlbedo.a / DiffuseMeanFreePath.a) and evaluates all three
              // channel kernels at those radii.
              this.$l.aForSampling = this.albedo.w;
              this.$l.lForSampling = pb.max(this.mfp.w, 1e-6);
              this.$l.S = this.scalingFactor(this.aForSampling);
              this.$l.S3D = this.scalingFactor3D(this.albedo.rgb);
              this.$l.dForSampling = pb.div(this.lForSampling, pb.max(this.S, 1e-6));

              // CalculateBurleyScale: profile space to UV. Purely unit conversion,
              // including the 1/depth perspective term - nothing here shapes the
              // kernel.
              // Perspective divides the world radius by the view depth so the disc
              // keeps a constant world size as the subject recedes; orthographic
              // has no such term and takes 1.
              this.$l.viewScale = pb.max(
                pb.select(this.centerDepth, pb.float(1), pb.equal(this.perspective, 0)),
                1e-4
              );
              // The world unit scale is applied here and only here; the packed
              // mean free path leaves it out, as UE5 does. Applying it in both
              // places would make the diffusion scale with its square. UE5's
              // extra cm-to-mm cast has no counterpart in this metric engine.
              this.$l.burleyScale = pb.div(pb.mul(this.projScale, this.worldUnitScale), this.viewScale);

              // Centre-sample reweighting: the radius within one texel and the CDF
              // mass it accounts for. Sampling then covers only [cdf, 1] and the
              // centre is lerped back in at the end. Averaged over the two axes,
              // as UE5's CalculateCenterSampleRadiusInMM does, since they carry
              // different scales.
              this.$l.centerRadiusMM = pb.mul(
                0.5,
                pb.add(
                  pb.div(this.targetSize.z, pb.max(this.burleyScale.x, 1e-9)),
                  pb.div(this.targetSize.w, pb.max(this.burleyScale.y, 1e-9))
                )
              );
              this.$l.centerCdf = this.burleyCdf(this.dForSampling, this.centerRadiusMM);
              // Per-channel diffusion distance, the same `d` the kernel below is
              // evaluated with. UE5's scalar DiffuseMeanFreePath works there
              // because its `.a` and `.rgb` are related by construction; here `.a`
              // is simply the widest channel, so substituting it would flatten the
              // channel ratio - and invert it, since a smaller `d` concentrates
              // more CDF mass inside one texel.
              this.$l.dPerChannel = pb.div(this.mfp.rgb, pb.max(this.S3D, pb.vec3(1e-6)));
              this.$l.centerWeight = pb.vec3(
                this.burleyCdf(this.dPerChannel.x, this.centerRadiusMM),
                this.burleyCdf(this.dPerChannel.y, this.centerRadiusMM),
                this.burleyCdf(this.dPerChannel.z, this.centerRadiusMM)
              );

              // Integer sequence start, rebased per pixel so neighbours do not
              // draw the identical 64 taps. It must land on an integer to keep the
              // low-discrepancy spacing, as UE5's 16-bit `Rand3DPCG16` rebase does.
              //
              // UE5 also advances the seed per frame and leans on TAA to resolve
              // the remainder. Without that history a per-frame seed would read as
              // flicker, so this is held fixed and trades it for a stable error.
              this.$l.seedStart = pb.int(pb.mul(hash21(this, pb.mul(this.uv, this.targetSize.xy)), 65536));
              this.$l.radianceAccum = pb.vec3(0);
              this.$l.weightAccum = pb.vec3(0);
              this.$l.bleedAccum = pb.vec3(0);
              this.$l.acceptedCount = pb.float(0);
              this.$l.radiusSum = pb.float(0);
              this.$for(pb.int('i'), 0, DEFAULT_SAMPLE_COUNT, function () {
                this.$l.rand = this.r2Sequence(pb.add(this.seedStart, this.i));
                // Restrict the radius draw to the range the centre sample does not
                // already account for.
                this.$l.xi = pb.add(this.centerCdf, pb.mul(this.rand.x, pb.sub(1, this.centerCdf)));
                this.$l.radiusMM = pb.max(this.radiusRootApprox(this.dForSampling, this.xi), 1e-5);
                this.$l.pdf = this.burleyPdf(this.radiusMM, this.lForSampling, this.S);
                this.$l.theta = pb.mul(this.rand.y, 2 * Math.PI);
                this.$l.uvOffset = pb.mul(
                  pb.vec2(pb.cos(this.theta), pb.sin(this.theta)),
                  pb.mul(this.radiusMM, this.burleyScale)
                );
                this.$l.sampleUV = pb.clamp(pb.add(this.uv, this.uvOffset), pb.vec2(0), pb.vec2(1));
                this.$l.tapSample = this.readDiffusible(this.sampleUV);
                this.$l.sampleDepth01 = this.readDepth01(this.sampleUV);
                this.$l.sampleDepth = pb.max(pb.mul(this.sampleDepth01, this.cameraNearFar.y), 1e-4);
                this.$l.tapNormal = this.readNormal(this.sampleUV);
                this.$l.normalWeight = pb.sqrt(
                  pb.clamp(pb.add(pb.mul(pb.dot(this.tapNormal, this.centerNormal), 0.5), 0.5), 0, 1)
                );
                // Bilateral term: the depth difference in the same millimetre
                // space as the radius, so a large world unit scale does not
                // over-penalize the sample. UE5 compares the two one-to-one.
                this.$l.deltaDepth = pb.div(pb.sub(this.sampleDepth, this.centerDepth), this.worldUnitScale);
                this.$l.radiusSampledMM = pb.sqrt(
                  pb.add(pb.mul(this.radiusMM, this.radiusMM), pb.mul(this.deltaDepth, this.deltaDepth))
                );
                this.$l.profile = this.diffusionProfile(this.mfp.rgb, this.S3D, this.radiusSampledMM);
                this.$l.tapId = this.readProfileId(this.sampleUV);
                // The tap's own opacity, UE5's Opacity semantics: 0 contributes
                // nothing, 1 contributes fully, and the values between give the
                // smooth transition a painted mask is for.
                this.$l.tapOpacity = pb.select(
                  pb.float(0),
                  this.tapSample.a,
                  pb.greaterThan(this.tapId, 0.5 / 255)
                );
                // A tap that is not skin falls back to the centre pixel rather
                // than dropping out of the estimator, for two reasons.
                //
                // Variance: this is self-normalized, so a dropped tap leaves both
                // sums. Beside a large non-skin region most of the disc lands in
                // it, and since the per-pixel seed is fixed, neighbouring pixels
                // survive on different taps - spatial white noise.
                //
                // Numerics: importance sampling is exact only for the channel the
                // radii were drawn from, so `profile/pdf` is constant for red
                // while blue decays to ~7e-9 in the tail. Dropping the near taps
                // leaves blue's `weightAccum` on the order of the 1e-9 floor
                // below, which clamps it to zero.
                //
                // The substitution assumes the hole scatters like the pixel under
                // consideration - the same assumption the centre-weighted blend
                // already makes - and costs a slightly firmer edge at the hole.
                this.$l.tapColor = pb.mix(this.center.rgb, this.tapSample.rgb, this.tapOpacity);
                this.$l.sampleWeight = pb.mul(pb.div(this.profile, this.pdf), this.normalWeight);
                // Taps from another profile are tinted rather than dropped, so a
                // face/lip boundary softens instead of seaming. The comparison is
                // against the prepass id now; 0.002 is still half a step of the
                // 8-bit channel it rides in.
                this.$l.sameProfile = pb.float(
                  pb.or(
                    pb.lessThan(pb.abs(pb.sub(this.tapId, this.centerId)), 0.002),
                    pb.lessThan(this.tapOpacity, 1e-4)
                  )
                );
                // Only taps that landed on skin contribute a bleed factor, and
                // both sides of the ratio carry the same opacity, so the mean
                // stays a tint in [bleed, 1]. Taps that fell back to the centre
                // are excluded: they carry the centre's own profile, so counting
                // them would dilute a real boundary tint towards white.
                this.bleedAccum = pb.add(
                  this.bleedAccum,
                  pb.mul(pb.mix(this.boundaryBleed, pb.vec3(1), this.sameProfile), this.tapOpacity)
                );
                this.acceptedCount = pb.add(this.acceptedCount, this.tapOpacity);
                this.radianceAccum = pb.add(this.radianceAccum, pb.mul(this.sampleWeight, this.tapColor));
                this.weightAccum = pb.add(this.weightAccum, this.sampleWeight);
                this.radiusSum = pb.add(this.radiusSum, this.radiusMM);
              });
              // Energy normalization, matching UE5's 1/0.99995 compensation.
              this.$l.diffused = pb.mul(
                pb.div(this.radianceAccum, pb.max(this.weightAccum, pb.vec3(1e-9))),
                1 / 0.99995
              );
              // Mean bleed over the taps that landed on skin: a tint in [bleed, 1],
              // never a gain. A branch rather than `max(acceptedCount, 1)`, which
              // would only be correct for an integer count - this is a sum of
              // opacities, so a half-masked neighbourhood would be darkened by
              // exactly its own mask on top of the fade applied below.
              this.$l.bleedTint = pb.vec3(1);
              this.$if(pb.greaterThan(this.acceptedCount, 1e-4), function () {
                this.bleedTint = pb.div(this.bleedAccum, this.acceptedCount);
              });
              this.diffused = pb.mul(this.diffused, this.bleedTint);
              // Blend the centre pixel back in with the CDF mass it represents.
              this.diffused = pb.mix(this.diffused, this.center.rgb, this.centerWeight);
              // Per channel: importance sampling is exact only for the one the
              // radii were drawn from, so the three weights differ by orders of
              // magnitude and a single scalar test cannot speak for all of them.
              // Built as a mask rather than a vector-conditioned select, which
              // has no legal GLSL form - the ternary there takes a scalar only.
              this.$l.weightValid = pb.vec3(
                pb.float(pb.greaterThan(this.weightAccum.x, 0)),
                pb.float(pb.greaterThan(this.weightAccum.y, 0)),
                pb.float(pb.greaterThan(this.weightAccum.z, 0))
              );
              this.diffused = pb.mix(this.center.rgb, this.diffused, this.weightValid);
              // The centre's own opacity fades the whole result back towards the
              // unscattered pixel. Taps were already weighted by *their* opacity,
              // which controls how much the neighbourhood contributes; this
              // controls how much this pixel accepts. UE5 applies the same value
              // at both ends, which is what makes a painted mask read as a
              // gradient in scattering strength rather than as an edge.
              this.diffused = pb.mix(this.center.rgb, this.diffused, this.center.a);
              // Alpha is unused downstream; Recombine reads its own mask.
              this.$outputs.outColor = pb.vec4(pb.max(this.diffused, pb.vec3(0)), this.center.a);
              this.$if(pb.notEqual(this.debugMode, 0), function () {
                this.$l.dbg = pb.vec3(0);
                this.$if(pb.equal(this.debugMode, 1), function () {
                  this.dbg = this.center.rgb;
                });
                this.$if(pb.equal(this.debugMode, 2), function () {
                  this.$l.lum = pb.dot(
                    pb.textureSampleLevel(this.sceneTex, this.uv, 0).rgb,
                    pb.vec3(0.2126, 0.7152, 0.0722)
                  );
                  this.dbg = pb.vec3(
                    pb.clamp(
                      pb.div(pb.textureSampleLevel(this.sceneTex, this.uv, 0).a, pb.max(this.lum, 1e-4)),
                      0,
                      1
                    )
                  );
                });
                this.$if(pb.equal(this.debugMode, 3), function () {
                  this.dbg = pb.vec3(pb.mul(this.centerId, 255 / 8));
                });
                this.$if(pb.equal(this.debugMode, 4), function () {
                  this.dbg = pb.add(pb.mul(this.centerNormal, 0.5), pb.vec3(0.5));
                });
                this.$if(pb.equal(this.debugMode, 5), function () {
                  // d in millimetres of world space, so skin reads around 1.
                  this.dbg = pb.mul(this.dPerChannel, 1000);
                });
                this.$if(pb.equal(this.debugMode, 6), function () {
                  // Mean vertical sample radius in pixels, 32 px mapped to white.
                  this.dbg = pb.vec3(
                    pb.div(
                      pb.mul(
                        pb.div(this.radiusSum, DEFAULT_SAMPLE_COUNT),
                        this.burleyScale.y,
                        this.targetSize.y
                      ),
                      32
                    )
                  );
                });
                this.$if(pb.equal(this.debugMode, 7), function () {
                  this.dbg = this.weightAccum;
                });
                this.$if(pb.equal(this.debugMode, 8), function () {
                  this.dbg = pb.vec3(pb.div(this.acceptedCount, DEFAULT_SAMPLE_COUNT));
                });
                this.$if(pb.equal(this.debugMode, 9), function () {
                  this.dbg = this.centerWeight;
                });
                this.$if(pb.equal(this.debugMode, 10), function () {
                  this.dbg = this.diffused;
                });
                if (hasTextureArrays) {
                  this.$if(pb.equal(this.debugMode, 11), function () {
                    // Shown as optical depth (bright = thick), not the stored
                    // encoding. An unobstructed surface stores 0.92, close enough
                    // to the 1.0 of "no light wrote this" that blue calls the
                    // latter out separately. The minimum over layer 0's four
                    // channels shows whichever light sees the most material.
                    this.$l.th = pb.textureArraySampleLevel(this.thicknessTex, this.uv, 0, 0);
                    this.$l.enc = pb.min(pb.min(this.th.r, this.th.g), pb.min(this.th.b, this.th.a));
                    this.$if(pb.greaterThan(this.enc, 0.999), function () {
                      this.dbg = pb.vec3(0, 0, 1);
                    }).$else(function () {
                      this.dbg = pb.vec3(pb.sub(1, this.enc));
                    });
                  });
                }
                this.$outputs.outColor = pb.vec4(pb.mul(this.dbg, this.debugExposure), this.center.a);
              });
            }
          );
        });
      }
    })!;
    program.name = '@SkinSSSBurley';
    return program;
  }

  private createBVarProgram(ctx: DrawContext) {
    // Placeholder for UE5's `UpdateQualityVariance`, a luminance-residual history
    // that drives the next frame's adaptive sample count. Without a history buffer
    // there is nothing to accumulate, so this is a straight copy and the diffusion
    // always runs at full sample count; the pass is the slot history would occupy.
    const program = ctx.device.buildRenderProgram({
      vertex(pb) {
        SkinSSS.fullscreenVertex(pb);
      },
      fragment(pb) {
        this.diffusedTex = pb.tex2D().uniform(0);
        this.depthTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
        this.targetSize = pb.vec4().uniform(0);
        this.cameraNearFar = pb.vec2().uniform(0);
        this.$outputs.outColor = pb.vec4();
        pb.main(function () {
          this.$l.diffused = pb.textureSampleLevel(this.diffusedTex, this.$inputs.uv, 0);
          // Alpha is the subsurface opacity the diffusion wrote; it is passed
          // through unchanged rather than repurposed.
          this.$outputs.outColor = pb.vec4(this.diffused.rgb, this.diffused.a);
        });
      }
    })!;
    program.name = '@SkinSSSBVar';
    return program;
  }

  private createRecombineProgram(ctx: DrawContext) {
    const program = ctx.device.buildRenderProgram({
      vertex(pb) {
        SkinSSS.fullscreenVertex(pb);
      },
      fragment(pb) {
        this.colorTex = pb.tex2D().uniform(0);
        this.maskTex = pb.tex2D().uniform(0);
        this.bvarTex = pb.tex2D().uniform(0);
        this.depthTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
        this.cameraNearFar = pb.vec2().uniform(0);
        this.targetSize = pb.vec4().uniform(0);
        this.debugMode = pb.int().uniform(0);
        this.srgbOut = pb.int().uniform(0);
        this.$outputs.outColor = pb.vec4();
        pb.func('readDepth01', [pb.vec2('uv')], function () {
          this.$return(ShaderHelper.sampleLinearDepth(this, this.depthTex, this.uv, 0));
        });
        pb.main(function () {
          this.$l.uv = this.$inputs.uv;
          this.$l.baseColor = pb.textureSampleLevel(this.colorTex, this.uv, 0);
          this.$l.result = this.baseColor.rgb;
          this.$l.centerDepth01 = this.readDepth01(this.uv);
          // Subsurface opacity. A plain gate is right here: how strongly the
          // pixel scattered is already baked into the diffusion buffer, and
          // weighting by the opacity a second time would count it twice.
          this.$l.centerMask = pb.textureSampleLevel(this.maskTex, this.uv, 0).a;
          this.$if(
            pb.and(
              pb.equal(this.debugMode, 0),
              pb.and(pb.lessThan(this.centerDepth01, 1), pb.greaterThan(this.centerMask, 1e-4))
            ),
            function () {
              // UE5 SSS::Recombine (lines 32-40): split the lit pixel into the
              // diffuse part that was allowed to scatter and the specular part
              // that must survive untouched, then swap the diffuse for the
              // diffused version.
              this.$l.lum = pb.dot(this.baseColor.rgb, pb.vec3(0.2126, 0.7152, 0.0722));
              // Must match Burley's split exactly: that pass diffused
              // `baseColor.rgb * diffAmt` and this one keeps the remainder, so a
              // disagreement leaves the halves not adding up to the original.
              this.$l.diffAmt = pb.select(
                pb.float(1),
                pb.clamp(pb.div(this.baseColor.a, pb.max(this.lum, 1e-4)), 0, 1),
                pb.greaterThan(this.lum, 1e-4)
              );
              this.$l.specKeep = pb.mul(this.baseColor.rgb, pb.sub(1, this.diffAmt));
              // The diffusion buffer's alpha is the subsurface opacity, not a
              // transmission term - nothing in this pipeline produces one here.
              // UE5's transmission likewise comes from SubsurfaceProfileBxDF per
              // light, and the back-lit term on SSSMaterial that stands in for
              // it is already part of SceneColor.
              this.$l.diffused = pb.textureSampleLevel(this.bvarTex, this.uv, 0).rgb;
              // Straight sum, as UE5 does it. No blend weight or tint: how far and
              // in what colour the light travels is the profile's business, and a
              // second knob on top could only disagree with it.
              this.result = pb.max(pb.add(this.diffused, this.specKeep), pb.vec3(0));
            }
          );
          // A debug channel must reach the screen unmodified, so recombination is
          // skipped and the diffusion buffer is shown as it was written.
          this.$if(pb.notEqual(this.debugMode, 0), function () {
            this.result = pb.textureSampleLevel(this.bvarTex, this.uv, 0).rgb;
          });
          this.$if(pb.equal(this.srgbOut, 0), function () {
            this.$outputs.outColor = pb.vec4(this.result, this.baseColor.a);
          }).$else(function () {
            this.$outputs.outColor = pb.vec4(linearToGamma(this, this.result), this.baseColor.a);
          });
        });
      }
    })!;
    program.name = '@SkinSSSRecombine';
    return program;
  }
}
