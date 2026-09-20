import { DEPTH_FARTHEST, Vector2, Vector4 } from '@zephyr3d/base';
import type { BindGroup, GPUProgram, Texture2D } from '@zephyr3d/device';
import type { DrawContext } from '../render';
import { ShaderHelper } from '../material';
import { SkinProfile } from '../material/skinprofile';
import { linearToGamma } from '../shaders/misc';
import { fetchSampler } from '../utility/misc';
import { AbstractPostEffect, PostEffectLayer } from './posteffect';

/** Default radial-disc sample count for the Burley kernel. */
/**
 * Intermediate quantity to visualize instead of the shaded result.
 *
 * @remarks
 * `'none'` renders normally. The rest replace the output with one term of the
 * diffusion, which is the practical way to tell an input problem from a kernel
 * problem — several of the defects found while building this pass were invisible
 * in the final image but obvious in one of these channels.
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
  | 'diffused';

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
  'diffused'
];

/**
 * Radial-disc sample count, matching UE5's `BURLEY_NUM_SAMPLES`.
 *
 * @remarks
 * UE5 can afford fewer samples in quiet regions because it drives the count from
 * a variance history and resolves the remainder temporally. Without that history
 * every frame has to stand on its own, so the full count is used throughout.
 */
const DEFAULT_SAMPLE_COUNT = 64;

/**
 * Screen-space skin scattering — 3-pass pipeline aligned with UE5.
 *
 * @remarks
 * Pass 1 (Burley): Radial-disc Burley diffusion with Halton + inverse-CDF
 *   importance sampling, 3D bilateral distance, per-channel kernel.
 * Pass 2 (BVar): Luminance variance + depth gradient → transmission estimate.
 * Pass 3 (Recombine): Specular/diffuse separation via SceneColor.a, profile-
 *   boundary-weighted recombination, transmission overlay.
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
  private _profile: SkinProfile | null;
  private _strength: number;
  private _debugOutput: SkinSSSDebugOutput;
  private _depthScale: number;
  private _scatterRadius: number;
  private _sampleCount: number;
  private readonly _scatterTint: Vector4;
  private readonly _radiusParams: Vector4;
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
    this._strength = 1;
    this._debugOutput = 'none';
    this._depthScale = 80;
    this._scatterRadius = 1;
    this._sampleCount = DEFAULT_SAMPLE_COUNT;
    this._scatterTint = new Vector4(1, 1, 1, 1);
    this._radiusParams = new Vector4();
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
  get profile(): SkinProfile | null {
    return this._profile;
  }
  set profile(val: SkinProfile | null) {
    this._profile = val ?? null;
  }
  get strength() {
    return this._strength;
  }
  set strength(val) {
    this._strength = Math.max(0, val ?? 0);
  }
  get scatterTint(): Vector4 {
    return this._scatterTint;
  }
  set scatterTint(val: Vector4) {
    this._scatterTint.set(val);
  }
  /**
   * Multiplier on the sampling disc, relative to the profile's scatter distance.
   *
   * @remarks
   * 1 (the default) sizes the disc to the profile's widest mean free path, which
   * captures most of the kernel's energy. Lowering it crops the kernel's tail and
   * costs the widest, faintest bleed; raising it spends taps on a region the
   * kernel has already decayed through.
   *
   * The absolute world extent of the diffusion comes from the profile's
   * `meanFreePathDistance`, not from here.
   *
   * @public
   */
  get scatterRadius() {
    return this._scatterRadius;
  }
  set scatterRadius(val) {
    this._scatterRadius = Math.max(0, val ?? 0);
  }
  get sampleCount() {
    return this._sampleCount;
  }
  set sampleCount(val) {
    this._sampleCount = Math.max(8, Math.min(64, Math.round(val ?? DEFAULT_SAMPLE_COUNT)));
  }
  get depthScale() {
    return this._depthScale;
  }
  set depthScale(val) {
    this._depthScale = Math.max(0, val ?? 0);
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
    if (!ctx.SkinSSSTexture || this._strength <= 0 || ctx.device.type !== 'webgpu') {
      this.passThrough(ctx, inputColorTexture, srgbOutput);
      return;
    }
    const device = ctx.device;
    const outputFramebuffer = device.getFramebuffer();
    const maskTex = ctx.SkinSSSTexture;
    const width = inputColorTexture.width;
    const height = inputColorTexture.height;

    const scatterFormat = ctx.colorFormat;
    const profileTable = SkinProfile.getTable(device);
    if (!profileTable) {
      this.passThrough(ctx, inputColorTexture, srgbOutput);
      return;
    }
    const fallback = this._profile ?? SkinProfile.getDefault();
    // Projection of a world-space length at unit depth into vertical UV. The
    // kernel's radii are world millimetres, so this plus the profile's world unit
    // scale and the 1/depth term is the whole world-to-UV conversion; UE5 folds
    // the same factors into CalculateBurleyScale.
    const projScale = 0.5 * ctx.camera.getProjectionMatrix().m11;
    this._radiusParams.setXYZW(
      // x: world length at unit depth, in UV
      projScale,
      // y: 1 for perspective (radius shrinks with distance), 0 for ortho
      ctx.camera.isPerspective() ? 1 : 0,
      // z: user multiplier on top of the profile's own scatter distance
      this._scatterRadius,
      // w: depth sensitivity for the bilateral term. UE5 has no equivalent knob —
      // it compares depth against the radius one-to-one — so 1 is the faithful
      // value and the serialized default maps onto it.
      this._depthScale / 80
    );
    // Row of the fallback profile, used when a pixel's id is missing.
    this._profileParams.setXYZW(
      fallback.encodedId,
      1 / SkinProfile.tableColumns,
      1 / SkinProfile.tableRows,
      SkinProfile.tableRows
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
      bg.setTexture('depthTex', sceneDepthTexture, fetchSampler('clamp_nearest_nomip'));
      bg.setValue('cameraNearFar', this._cameraNearFar);
      bg.setValue('targetSize', this._targetSize);
      bg.setValue('radiusParams', this._radiusParams);
      bg.setValue('profileParams', this._profileParams);
      bg.setTexture('profileTex', profileTable, fetchSampler('clamp_nearest_nomip'));
      bg.setValue('sampleCount', this._sampleCount);
      bg.setValue('debugMode', SKIN_SSS_DEBUG_OUTPUTS.indexOf(this._debugOutput));
      // Intermediate passes always render into a texture, so on WebGPU they flip
      // unconditionally. `needFlip` cannot be used here: it reports whatever
      // target happens to be bound at the time, and these values are set before
      // the pass binds its own, so it would answer for the output framebuffer.
      // Getting this wrong writes the diffusion upside down, and Recombine then
      // samples it by UV and cancels most of the blur against the original.
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
    rbg.setValue('scatterTint', this._scatterTint);
    rbg.setValue('strength', this._strength);
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
    const program = ctx.device.buildRenderProgram({
      vertex(pb) {
        SkinSSS.fullscreenVertex(pb);
      },
      fragment(pb) {
        this.depthTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
        this.sceneTex = pb.tex2D().uniform(0);
        this.maskTex = pb.tex2D().uniform(0);
        this.cameraNearFar = pb.vec2().uniform(0);
        this.targetSize = pb.vec4().uniform(0);
        this.radiusParams = pb.vec4().uniform(0);
        this.profileParams = pb.vec4().uniform(0);
        this.profileTex = pb.tex2D().uniform(0);
        this.sampleCount = pb.int().uniform(0);
        this.debugMode = pb.int().uniform(0);
        this.$outputs.outColor = pb.vec4();
        pb.func('readDepth01', [pb.vec2('uv')], function () {
          this.$return(ShaderHelper.sampleLinearDepth(this, this.depthTex, this.uv, 0));
        });
        // UE5's spec/diff separation (SSS::Setup lines 26-29): SceneColor.a holds
        // the diffuse luminance, so the diffusible fraction of the pixel is the
        // ratio of that to the total luminance. rgb = the scatterable energy.
        //
        // The skin mask comes from its own channel, never from SceneColor.a:
        // opaque materials all write 1 there, so using it would classify the
        // background and the eyes as skin and bleed the scattered red into them.
        pb.func('readDiffusible', [pb.vec2('uv')], function () {
          this.$l.scene = pb.textureSampleLevel(this.sceneTex, this.uv, 0);
          this.$l.mask = pb.textureSampleLevel(this.maskTex, this.uv, 0).a;
          this.$l.lum = pb.dot(this.scene.rgb, pb.vec3(0.2126, 0.7152, 0.0722));
          // Below the floor the ratio stops being meaningful and starts tracking
          // brightness instead, which biases the darkest pixels — the ones the
          // diffusion is most visible against. Treat those as fully diffusible:
          // a pixel that dark has no specular worth preserving.
          this.$l.diffAmt = pb.select(
            pb.clamp(pb.div(this.scene.a, pb.max(this.lum, 1e-4)), 0, 1),
            pb.float(1),
            pb.greaterThan(this.lum, 1e-4)
          );
          this.$return(pb.vec4(pb.mul(this.scene.rgb, this.diffAmt), this.mask));
        });
        // --- Burley diffusion, transcribed from UE5's BurleyNormalizedSSSCommon.ush ---
        //
        // Radii here are in millimetres of world space and are unbounded: the
        // inverse CDF produces them directly, and `burleyScale` converts them to
        // a UV offset. There is deliberately no "sampling disc" to normalize
        // against — introducing one couples the kernel shape to the mean free
        // path, which is what made the diffusion vanish at small profile scales
        // and flatten into a box average at large ones.

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
        //
        // The index must stay an integer. Offsetting it by a per-pixel fraction
        // destroys the low-discrepancy property and turns the sequence into a
        // phase sweep correlated with pixel position, which shows up as regular
        // banding across the diffused region. UE5 decorrelates across frames
        // instead, by starting the index at the frame number.
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
          this.$l.centerDepth01 = this.readDepth01(this.uv);
          this.$outputs.outColor = this.center;
          this.$if(
            pb.and(pb.lessThan(this.centerDepth01, 1), pb.greaterThan(this.center.a, 1e-4)),
            function () {
              this.$l.centerDepth = pb.max(pb.mul(this.centerDepth01, this.cameraNearFar.y), 1e-4);
              this.$l.centerNormal = this.readNormal(this.uv);
              this.$l.centerId = this.center.a;
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

              // CalculateBurleyScale: world millimetres to UV. Radii stay in mm
              // and are unbounded, so nothing here shapes the kernel — this is
              // purely unit conversion, including the 1/depth perspective term
              // and the cm-to-mm cast.
              this.$l.viewScale = pb.max(pb.mix(pb.float(1), this.centerDepth, this.radiusParams.y), 1e-4);
              // UE5 additionally casts cm to mm here, because its scene unit is
              // the centimetre and its profile distances are millimetres. This
              // engine is metres throughout and the profile distances are in scene
              // units, so radius and depth already share a space and no cast
              // belongs in either this scale or the bilateral term below.
              this.$l.burleyScale = pb.div(
                pb.mul(this.worldUnitScale, this.radiusParams.z, this.radiusParams.x),
                this.viewScale
              );

              // Centre-sample reweighting: the radius that falls within one texel
              // and the CDF mass it accounts for. Sampling then covers only
              // [cdf, 1], and the centre pixel is lerped back in at the end.
              this.$l.centerRadiusMM = pb.div(
                pb.mul(0.5, pb.add(this.targetSize.z, this.targetSize.w)),
                pb.max(this.burleyScale, 1e-9)
              );
              this.$l.centerCdf = this.burleyCdf(this.dForSampling, this.centerRadiusMM);
              // Per-channel diffusion distance, from each channel's own mean free
              // path — the same `d` the kernel below is evaluated with.
              //
              // UE5 passes the scalar DiffuseMeanFreePath here, which works there
              // because its `.a` and `.rgb` are related by construction. In this
              // table `.a` is simply the widest channel, so substituting it flattens
              // the channel ratio and, since a smaller `d` concentrates more CDF
              // mass inside one texel, actually inverts it: red ends up holding the
              // most centre weight instead of the least, and the diffusion is
              // suppressed in exactly the channel that should travel furthest.
              this.$l.dPerChannel = pb.div(this.mfp.rgb, pb.max(this.S3D, pb.vec3(1e-6)));
              this.$l.centerWeight = pb.vec3(
                this.burleyCdf(this.dPerChannel.x, this.centerRadiusMM),
                this.burleyCdf(this.dPerChannel.y, this.centerRadiusMM),
                this.burleyCdf(this.dPerChannel.z, this.centerRadiusMM)
              );

              // Integer sequence start, so the R2 set keeps its low-discrepancy
              // spacing (a fractional, per-pixel offset turns it into a phase
              // sweep and bands the image).
              //
              // UE5 advances this by View.FrameNumber and leans on its variance
              // history plus TAA to resolve what one frame leaves behind. This
              // pass has no such history, so a per-frame seed would simply be
              // visible as flicker: whichever taps happen to land on skin changes
              // every frame. Holding it fixed trades that for a stable, slightly
              // structured error, which is the better failure here.
              this.$l.seedStart = pb.int(0);
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
                // Bilateral term: the depth difference carried into the same
                // millimetre space as the radius, divided by the world unit scale
                // so that a large scale does not over-penalize the sample.
                this.$l.deltaDepth = pb.mul(
                  pb.div(pb.sub(this.sampleDepth, this.centerDepth), this.worldUnitScale),
                  this.radiusParams.w
                );
                this.$l.radiusSampledMM = pb.sqrt(
                  pb.add(pb.mul(this.radiusMM, this.radiusMM), pb.mul(this.deltaDepth, this.deltaDepth))
                );
                this.$l.profile = this.diffusionProfile(this.mfp.rgb, this.S3D, this.radiusSampledMM);
                this.$l.isSkin = pb.float(pb.greaterThan(this.tapSample.a, 1e-4));
                this.$l.sampleWeight = pb.mul(pb.div(this.profile, this.pdf), this.isSkin, this.normalWeight);
                // Taps from another profile are tinted rather than dropped, so a
                // face/lip boundary softens instead of seaming.
                this.$l.sameProfile = pb.float(
                  pb.or(
                    pb.lessThan(pb.abs(pb.sub(this.tapSample.a, this.centerId)), 0.002),
                    pb.lessThan(this.tapSample.a, 1e-4)
                  )
                );
                // Only taps that actually contributed may contribute a bleed
                // factor. Counting rejected taps here leaves the bleed average
                // near 1 while the weighted mean is carried by a handful of
                // samples, so the result gets scaled by a factor unrelated to its
                // own denominator — near the silhouette, where most taps miss the
                // skin, that lands as bright specks that flicker as the sample set
                // advances each frame.
                this.bleedAccum = pb.add(
                  this.bleedAccum,
                  pb.mul(pb.mix(this.boundaryBleed, pb.vec3(1), this.sameProfile), this.isSkin)
                );
                this.acceptedCount = pb.add(this.acceptedCount, this.isSkin);
                this.radianceAccum = pb.add(
                  this.radianceAccum,
                  pb.mul(this.sampleWeight, this.tapSample.rgb)
                );
                this.weightAccum = pb.add(this.weightAccum, this.sampleWeight);
                this.radiusSum = pb.add(this.radiusSum, this.radiusMM);
              });
              // Energy normalization, matching UE5's 1/0.99995 compensation.
              this.$l.diffused = pb.mul(
                pb.div(this.radianceAccum, pb.max(this.weightAccum, pb.vec3(1e-9))),
                1 / 0.99995
              );
              // Mean bleed over the taps that were actually accepted, so this is
              // a tint in [bleed, 1] and never a gain.
              this.diffused = pb.mul(this.diffused, pb.div(this.bleedAccum, pb.max(this.acceptedCount, 1)));
              // Blend the centre pixel back in with the CDF mass it represents.
              this.diffused = pb.mix(this.diffused, this.center.rgb, this.centerWeight);
              this.$if(pb.lessThanEqual(this.weightAccum.x, 0), function () {
                this.diffused = this.center.rgb;
              });
              // Alpha carries the profile id through to Recombine unchanged.
              this.$outputs.outColor = pb.vec4(pb.max(this.diffused, pb.vec3(0)), this.centerId);
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
                  // Mean sample radius in pixels, 32 px mapped to white.
                  this.dbg = pb.vec3(
                    pb.div(
                      pb.mul(
                        pb.div(this.radiusSum, DEFAULT_SAMPLE_COUNT),
                        this.burleyScale,
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
                this.$outputs.outColor = pb.vec4(this.dbg, this.centerId);
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
    // UE5's BVar pass computes transmission from temporal reprojection +
    // shadow map sampling. Without a velocity buffer and shadow map access
    // in the SSS post-effect, it outputs zero transmission — matching UE5's
    // behavior when those inputs are unavailable. For now this is a simple
    // passthrough; transmission comes from the material's back-lit term
    // (transmissionStrength × thickness from subsurfaceTexture.b).
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
          // transmission = 0 (no velocity buffer / shadow map available)
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
        this.scatterTint = pb.vec4().uniform(0);
        this.strength = pb.float().uniform(0);
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
              // Must match Burley's split exactly, or the two passes disagree
              // about how much of the pixel was diffusible and the difference
              // shows up as a brightness error.
              this.$l.diffAmt = pb.select(
                pb.clamp(pb.div(this.baseColor.a, pb.max(this.lum, 1e-4)), 0, 1),
                pb.float(1),
                pb.greaterThan(this.lum, 1e-4)
              );
              this.$l.diffOrig = pb.mul(this.baseColor.rgb, this.diffAmt);
              this.$l.specKeep = pb.mul(this.baseColor.rgb, pb.sub(1, this.diffAmt));
              this.$l.bvarData = pb.textureSampleLevel(this.bvarTex, this.uv, 0);
              this.$l.transmission = this.bvarData.a;
              this.$l.diffused = this.bvarData.rgb;
              this.result = pb.add(
                pb.add(
                  pb.mul(pb.sub(this.diffused, this.diffOrig), this.scatterTint.rgb, this.strength),
                  this.diffOrig
                ),
                this.specKeep
              );
              // Transmission overlay
              this.$if(pb.greaterThan(this.transmission, 0.001), function () {
                this.result = pb.add(
                  this.result,
                  pb.mul(this.diffused, this.scatterTint.rgb, this.transmission, this.scatterTint.a, 0.5)
                );
              });
              this.result = pb.max(this.result, pb.vec3(0));
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
