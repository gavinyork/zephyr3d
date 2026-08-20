import type {
  BindGroup,
  FrameBuffer,
  PBGlobalScope,
  PBInsideFunctionScope,
  PBShaderExp,
  RenderStateSet,
  Texture2D,
  TextureFormat
} from '@zephyr3d/device';
import { ShadowImpl } from './shadow_impl';
import type { ShadowMapParams, ShadowMapType } from './shadowmapper';
import { LIGHT_TYPE_POINT } from '../values';
import { ndcToShadowCoord3, shadowCoordDepthInRange } from '../shaders/shadow';
import { ShaderHelper } from '../material/shader/helper';
import { getDevice } from '../app/api';
import { fetchSampler } from '../utility/misc';
import { REVERSE_Z, Vector4, type Nullable } from '@zephyr3d/base';

/**
 * Opacity layers, which is three rather than four because the fourth channel of
 * the result texture carries the depth the layers are measured from. Keeping
 * both in one texture is what lets the receiver read the whole technique through
 * the single shadow-map binding the lighting shaders declare.
 * @internal
 */
const DOM_LAYER_COUNT = 3;

/** @internal Caster-pass uniform holding the frontmost depth from geometry pass 0. */
const UNIFORM_NAME_DOM_FRONT_DEPTH = 'Z_domFrontDepth';

/**
 * Transmittance a fully opaque caster is recorded as, since zero has no finite
 * optical depth to blend. Dark enough to read as black, and small enough in the
 * exponent that several opaque layers can stack without saturating half floats.
 * @internal
 */
const DOM_MIN_TRANSMITTANCE = 0.001;

/** @internal */
type DOMImplData = {
  /**
   * Frontmost caster depth, written by geometry pass 0 and sampled by pass 1.
   * Separate from the result texture on purpose: a texture cannot be a render
   * target and a sampled resource in the same pass.
   */
  frontDepth: Texture2D;
  /** RGB = cumulative optical depth per layer, A = the depth those layers start at. */
  result: Texture2D;
  /** Targets {@link DOMImplData.frontDepth}, reusing the shared depth attachment. */
  depthFramebuffer: FrameBuffer;
  /** Targets {@link DOMImplData.result}. No depth attachment - pass 1 does not test. */
  opacityFramebuffer: FrameBuffer;
};

/**
 * Deep opacity map shadows.
 *
 * @remarks
 * Hair is the case an ordinary shadow map cannot express. A shadow map answers
 * "is this point behind the nearest caster", which is the right question for a
 * wall and the wrong one for ten thousand strands: light entering a groom is not
 * blocked at its surface, it is attenuated gradually as it passes more and more
 * fibres. A binary test renders that as a hard edge with everything behind it
 * uniformly black.
 *
 * A deep opacity map (Yuksel & Keyser 2008) records the attenuation instead of
 * the boundary. Geometry pass 0 writes the frontmost caster depth `z0` per texel.
 * Pass 1 rasterises the casters again and each fragment adds its optical depth to
 * every layer lying behind it, giving cumulative absorption sampled at three
 * depths measured *from `z0`* rather than from the light. Because the layers
 * follow the hair surface, three of them resolve what a plain opacity shadow map
 * needs dozens of uniformly spaced ones to match.
 *
 * Recording optical depth rather than coverage is what keeps it exact for solid
 * casters as well as thin ones, so a scene does not have to reserve this mode for
 * its hair: see the caster output for why the two differ.
 *
 * WebGPU only, and deliberately so: the strand geometry this exists to shadow is
 * itself WebGPU only, so supporting the WebGL fallbacks - cascade atlases instead
 * of array layers, RGBA8-packed depth instead of float - would double the surface
 * area to serve no material.
 *
 * @internal
 */
export class DOM extends ShadowImpl {
  /** @internal */
  private _layerDistance: number;
  /** @internal */
  private _density: number;
  /** @internal */
  private readonly _paramsScratch: Vector4;
  /**
   * @internal
   * Which geometry pass is being rasterised. Lives on the implementation rather
   * than in `implData` because {@link DOM.getShaderHash} has no access to the
   * params, and the hash must separate the two passes or they share a program.
   */
  private _geometryPass: number;
  /**
   * @internal
   * Depth the shadow camera spans, captured when the map is rendered. Needed to
   * express {@link DOM.layerDistance} in world units: the shader compares device
   * depths, and for the orthographic projection a directional light uses those
   * are the world depth divided by exactly this.
   */
  private _depthRange: number;
  constructor(layerDistance = 0.25, density = 1) {
    super();
    this._layerDistance = layerDistance;
    this._density = density;
    this._paramsScratch = new Vector4();
    this._geometryPass = 0;
    this._depthRange = 1;
  }
  /**
   * Depth the layers span, in world units along the light direction.
   *
   * @remarks
   * Set it to roughly the thickness of the hair. Too small and everything past
   * the outer strands saturates the last layer, which is a hard shadow again;
   * too large and all three layers land inside the first strand, leaving the
   * interior unshadowed.
   *
   * Exact for directional lights, whose orthographic projection makes device
   * depth a linear function of world depth. Spot and point lights project
   * perspectively, so there the value is only accurate near the middle of the
   * shadow camera's range - which is where hair lit by one usually sits.
   */
  get layerDistance() {
    return this._layerDistance;
  }
  set layerDistance(val) {
    this._layerDistance = val > 0 ? val : 0.0001;
  }
  /**
   * Artistic multiplier on the absorption the casters actually recorded.
   *
   * @remarks
   * One reproduces alpha compositing exactly and is the right default. Raise it
   * to deepen the interior of a groom without moving the layers, lower it to let
   * more light through than the geometry strictly would.
   */
  get density() {
    return this._density;
  }
  set density(val) {
    this._density = val < 0 ? 0 : val;
  }
  getType() {
    return 'dom' as const;
  }
  resourceDirty() {
    return this._resourceDirty;
  }
  getShadowMapBorder() {
    return 0;
  }
  getDepthScale() {
    return 1;
  }
  setDepthScale(_val: number) {}
  /**
   * Layer geometry and density, for both the caster and the receiver. `z` and
   * `w` are unused.
   *
   * @remarks
   * `x` is the layer span converted from world units into the device-depth
   * difference the shaders actually compare, using the range captured when the
   * map was rendered.
   */
  getParams(out?: Vector4) {
    const result = out ?? this._paramsScratch;
    result.setXYZW(this._layerDistance / this._depthRange, this._density, 0, 0);
    return result;
  }
  getGeometryPassCount() {
    return 2;
  }
  supportsCascades() {
    // Each split would need its own depth and layer set, and both already share
    // the one texture the receiver can bind.
    return false;
  }
  clipsCasterAlpha() {
    // Neither pass wants the clip. Pass 1 integrates the alpha, and clipping is
    // destructive to it in both of the forms the material applies: a dithered
    // caster survives with probability alpha and then contributes the absorption
    // of that same alpha, counting it twice, and a hard cutoff drops the sub-pixel
    // strands that carry most of a groom's transmittance.
    //
    // Pass 0 skips it for a different reason. Its job is to find the frontmost
    // strand, and under dithering the clip makes that choice per-pixel random -
    // the layers would then start at a depth that flickers between strands, and
    // every opacity reading behind it inherits the jitter.
    //
    // The case this gives up is a caster whose alpha is a real mask rather than a
    // coverage value, such as a hair card with cut-out texels: pass 0 will place
    // z0 on the card's surface even where it is fully transparent. Strand
    // geometry, which is what this technique is for, has no such texels.
    return false;
  }
  beginGeometryPass(shadowMapParams: ShadowMapParams, pass: number) {
    const implData = shadowMapParams.implData as DOMImplData;
    this._geometryPass = pass;
    // The light camera is finalised by the time the casters are drawn, so this is
    // where the world-to-device depth scale becomes known. It stays valid for the
    // lighting pass that follows, which reads the same converted params back.
    const range = shadowMapParams.cameraParams.y - shadowMapParams.cameraParams.x;
    this._depthRange = range > 1e-6 ? range : 1;
    getDevice().setFramebuffer(pass === 0 ? implData.depthFramebuffer : implData.opacityFramebuffer);
  }
  setCasterRenderStates(_shadowMapParams: ShadowMapParams, stateSet: RenderStateSet) {
    if (this._geometryPass !== 1) {
      return;
    }
    // Every strand between z0 and the last layer has to contribute, so the pass
    // must not depth-test against the frontmost surface pass 0 resolved, and must
    // not write depth of its own - its framebuffer has no depth attachment at all.
    // Optical depth sums across the three layer channels; alpha instead carries
    // z0, which every fragment reads from the same texel, so replacing is correct
    // where summing would multiply it by the number of overlapping strands.
    stateSet
      .useBlendingState()
      .enable(true)
      .setBlendEquation('add', 'add')
      .setBlendFuncRGB('one', 'one')
      .setBlendFuncAlpha('one', 'zero');
    stateSet.useDepthState().enableTest(false).enableWrite(false);
  }
  getShadowMapClearColor(_shadowMapParams: ShadowMapParams) {
    if (this._geometryPass === 1) {
      // No hair over this texel means no absorption. Alpha carries z0, and the
      // sentinel below makes an uncovered texel read as "nothing in front".
      return new Vector4(0, 0, 0, REVERSE_Z ? 0 : 1);
    }
    const farthest = REVERSE_Z ? 0 : 1;
    return new Vector4(farthest, farthest, farthest, 1);
  }
  getShadowMapColorFormat(_shadowMapParams: ShadowMapParams) {
    // Null keeps the framebuffer the caller allocates depth-only. The colour this
    // technique needs is allocated here, against framebuffers of its own, so
    // letting the caller also allocate a full-size colour attachment would waste
    // it outright.
    return null;
  }
  getShadowMapDepthFormat(_shadowMapParams: ShadowMapParams) {
    return this.preferredShadowMapDepthFormat();
  }
  useNativeShadowMap(_shadowMapParams: ShadowMapParams) {
    // The receiver needs the actual stored values - a depth to measure offsets
    // from and three sums to interpolate - not the result of a hardware compare.
    return false;
  }
  getShadowMap(shadowMapParams: ShadowMapParams) {
    return (shadowMapParams.implData as DOMImplData).result as ShadowMapType;
  }
  /**
   * Format for both targets. Half float covers a normalized depth and three
   * absorption sums, and halves the bandwidth of the accumulation pass.
   * @internal
   */
  private colorFormat(): TextureFormat {
    return getDevice().getDeviceCaps().textureCaps.supportHalfFloatColorBuffer ? 'rgba16f' : 'rgba32f';
  }
  doUpdateResources(shadowMapParams: ShadowMapParams) {
    const device = getDevice();
    const sharedDepth = shadowMapParams.shadowMapFramebuffer!.getDepthAttachment()!;
    const width = sharedDepth.width;
    const height = sharedDepth.height;
    const format = this.colorFormat();
    // Everything here is pooled, per frame, the way the blur targets of VSM and
    // ESM are. `implData` cannot cache across frames even though it looks like it
    // could: it lives on a ShadowMapParams that is recycled between every light
    // and cleared at the end of each frame, so holding directly-created textures
    // in it leaks them at whatever rate the scene renders.
    const frontDepth = device.pool.fetchTemporalTexture2D(false, format, width, height, false);
    const result = device.pool.fetchTemporalTexture2D(false, format, width, height, false);
    // Pass 0 borrows the shadow map's own depth attachment, which is otherwise
    // unused - this implementation asks for no colour there - so the hardware
    // depth test resolves the frontmost strand for it. Pass 1 gets no depth,
    // which is both what stops it testing and what frees `frontDepth` to be
    // sampled while `result` is written.
    const depthFramebuffer = device.pool.createTemporalFramebuffer(true, [frontDepth], sharedDepth);
    const opacityFramebuffer = device.pool.createTemporalFramebuffer(true, [result], null);
    // The framebuffers hold the references now; these drop the fetch counts so
    // both textures return to the pool when the frame ends.
    device.pool.releaseTexture(frontDepth);
    device.pool.releaseTexture(result);
    shadowMapParams.implData = {
      frontDepth,
      result,
      depthFramebuffer,
      opacityFramebuffer
    } satisfies DOMImplData;
    shadowMapParams.shadowMap = result;
    shadowMapParams.shadowMapSampler = result.getDefaultSampler(false);
    this._resourceDirty = false;
  }
  postRenderShadowMap(_shadowMapParams: ShadowMapParams) {}
  getShaderHash() {
    // The two geometry passes emit different caster fragments and the shadow pass
    // keys its programs on this hash, so the pass index has to appear in it.
    return `${DOM_LAYER_COUNT}_${this._geometryPass}`;
  }
  declareCasterUniforms(scope: PBGlobalScope, _shadowMapParams: ShadowMapParams) {
    if (this._geometryPass !== 1) {
      return;
    }
    const pb = scope.$builder;
    // sampleType before uniform(), matching how the receiver's shadow map is
    // declared: the binding is created from the accumulated descriptor.
    const tex = pb.tex2D();
    tex.sampleType('unfilterable-float');
    scope[UNIFORM_NAME_DOM_FRONT_DEPTH] = tex.uniform(0);
  }
  applyCasterUniforms(bindGroup: BindGroup, shadowMapParams: ShadowMapParams) {
    if (this._geometryPass !== 1) {
      return;
    }
    const implData = shadowMapParams.implData as DOMImplData;
    bindGroup.setTexture(
      UNIFORM_NAME_DOM_FRONT_DEPTH,
      implData.frontDepth,
      fetchSampler('clamp_nearest_nomip')
    );
  }
  /**
   * How far a depth lies behind the frontmost strand, in layer-span units.
   *
   * @remarks
   * Both callers measure "deeper into the hair than z0", but which direction that
   * is depends on the depth encoding: under reverse-Z a farther surface has the
   * *smaller* value, so the plain subtraction is negative for every fragment
   * behind the front and the clamp below flattens the whole technique to no
   * shadow at all.
   * @internal
   */
  private layerCoord(
    scope: PBInsideFunctionScope,
    depth: PBShaderExp,
    z0: PBShaderExp,
    layerSpan: PBShaderExp
  ): PBShaderExp {
    const pb = scope.$builder;
    const delta = REVERSE_Z ? pb.sub(z0, depth) : pb.sub(depth, z0);
    return pb.div(pb.max(delta, 0), layerSpan);
  }
  /**
   * Caster output.
   *
   * Pass 0 writes the frontmost depth. Pass 1 writes this fragment's optical depth
   * into the layers behind it, for additive blending to sum, and carries z0
   * through alpha so the receiver can find where the layers start.
   */
  computeShadowMapDepth(
    shadowMapParams: ShadowMapParams,
    scope: PBInsideFunctionScope,
    worldPos: PBShaderExp,
    alpha: Nullable<PBShaderExp>
  ) {
    const pb = scope.$builder;
    const that = this;
    const geometryPass = this._geometryPass;
    // Alpha travels as a parameter. Reaching into the caller's scope for its
    // `outColor` would be reading a local of a different shader function, and the
    // two cases that matter - an opaque caster and a fully transparent one - are
    // the same value there.
    const hasAlpha = geometryPass === 1 && !!alpha;
    const funcName = `lib_domCasterOutput_${geometryPass}_${hasAlpha ? 'a' : 'o'}`;
    const params = hasAlpha ? [pb.vec3('worldPos'), pb.float('alpha')] : [pb.vec3('worldPos')];
    pb.func(funcName, params, function () {
      this.$l.depth = that.casterDepth(shadowMapParams, this, this.worldPos);
      if (geometryPass === 0) {
        this.$return(pb.vec4(this.depth, 0, 0, 1));
      } else {
        this.$l.z0 = pb.textureLoad(
          this[UNIFORM_NAME_DOM_FRONT_DEPTH],
          pb.ivec2(this.$builtins.fragCoord.xy),
          0
        ).x;
        this.$l.layerSpan = ShaderHelper.getShadowImplParams(this).x;
        // Distance behind the frontmost strand, in layer-span units. A fragment at
        // or in front of z0 lands at zero and fills every layer.
        this.$l.t = that.layerCoord(this, this.depth, this.z0, this.layerSpan);
        // Layer k spans everything nearer than (k+1)/3 of the span, so a fragment
        // contributes to each layer whose far boundary it precedes. step() gives
        // that mask without branching.
        this.$l.mask = pb.vec3(pb.step(this.t, 1 / 3), pb.step(this.t, 2 / 3), pb.step(this.t, 1));
        // A caster that computes no fragment colour covers fully.
        this.$l.casterAlpha = hasAlpha ? this.alpha : pb.float(1);
        // Optical depth rather than raw coverage, because what has to be additive
        // here is the exponent, not the alpha. Compositing N layers multiplies
        // their transmittances - prod(1 - a) - and blending can only sum, so each
        // fragment contributes -log(1 - a) and the receiver's exp(-sum) reproduces
        // that product exactly.
        //
        // Summing alpha instead makes exp(-sum) an approximation that only holds
        // while alpha is small, which is true of a sub-pixel strand and false of
        // anything solid: a single opaque caster would sum to 1 and shadow to
        // exp(-1), a 37% grey rather than black.
        //
        // The floor bounds what alpha = 1 encodes. It has to be finite to blend,
        // and 0.001 transmittance is already black; it also leaves room for
        // several opaque layers to stack without leaving half precision.
        this.$l.opticalDepth = pb.neg(pb.log(pb.max(pb.sub(1, this.casterAlpha), DOM_MIN_TRANSMITTANCE)));
        this.$return(pb.vec4(pb.mul(this.mask, this.opticalDepth), this.z0));
      }
    });
    const global = pb.getGlobalScope();
    return (hasAlpha ? global[funcName](worldPos, alpha!) : global[funcName](worldPos)) as PBShaderExp;
  }
  /**
   * Normalized light-space depth of a caster fragment, in the encoding the
   * receiver reconstructs.
   * @internal
   */
  private casterDepth(
    shadowMapParams: ShadowMapParams,
    scope: PBInsideFunctionScope,
    worldPos: PBShaderExp
  ): PBShaderExp {
    const pb = scope.$builder;
    if (shadowMapParams.lightType === LIGHT_TYPE_POINT) {
      const lightSpacePos = pb.mul(ShaderHelper.getLightViewMatrixForShadow(scope), pb.vec4(worldPos, 1));
      return pb.clamp(
        pb.div(pb.length(lightSpacePos.xyz), ShaderHelper.getLightPositionAndRangeForShadow(scope).w),
        0,
        1
      );
    }
    return pb.emulateDepthClamp ? pb.clamp(scope.$inputs.clamppedDepth, 0, 1) : scope.$builtins.fragCoord.z;
  }
  computeShadow(
    _shadowMapParams: ShadowMapParams,
    scope: PBInsideFunctionScope,
    shadowVertex: PBShaderExp,
    NdotL: PBShaderExp
  ) {
    const funcName = 'lib_computeShadowDOM';
    const pb = scope.$builder;
    const that = this;
    pb.func(funcName, [pb.vec4('shadowVertex'), pb.float('NdotL')], function () {
      this.$l.shadowCoord = pb.div(this.shadowVertex.xyz, this.shadowVertex.w);
      this.$l.shadowCoord = ndcToShadowCoord3(this, this.shadowCoord.xyz);
      this.$l.inRange = pb.all(
        pb.bvec2(
          pb.all(
            pb.bvec4(
              pb.greaterThanEqual(this.shadowCoord.x, 0),
              pb.lessThanEqual(this.shadowCoord.x, 1),
              pb.greaterThanEqual(this.shadowCoord.y, 0),
              pb.lessThanEqual(this.shadowCoord.y, 1)
            )
          ),
          shadowCoordDepthInRange(this, this.shadowCoord.z)
        )
      );
      this.$l.shadow = pb.float(1);
      this.$if(this.inRange, function () {
        this.shadow = that.transmittance(this, this.shadowCoord);
      });
      this.$return(this.shadow);
    });
    return pb.getGlobalScope()[funcName](shadowVertex, NdotL) as PBShaderExp;
  }
  computeShadowCSM(
    shadowMapParams: ShadowMapParams,
    scope: PBInsideFunctionScope,
    shadowVertex: PBShaderExp,
    NdotL: PBShaderExp,
    _split: PBShaderExp
  ) {
    // Cascades would need a depth and a layer set per split, which no longer fits
    // the one texture the single shadow-map binding allows. Callers keep working
    // by shadowing from the first cascade's map.
    return this.computeShadow(shadowMapParams, scope, shadowVertex, NdotL);
  }
  /**
   * Fraction of light surviving the hair in front of the receiver.
   * @internal
   */
  private transmittance(scope: PBInsideFunctionScope, shadowCoord: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    const that = this;
    const funcName = 'lib_domTransmittance';
    pb.func(funcName, [pb.vec3('shadowCoord')], function () {
      this.$l.texel = pb.textureSampleLevel(ShaderHelper.getShadowMap(this), this.shadowCoord.xy, 0);
      this.$l.layers = this.texel.rgb;
      this.$l.z0 = this.texel.a;
      this.$l.layerSpan = ShaderHelper.getShadowImplParams(this).x;
      this.$l.density = ShaderHelper.getShadowImplParams(this).y;
      this.$l.t = that.layerCoord(this, this.shadowCoord.z, this.z0, this.layerSpan);
      // The layers are cumulative, so opacity at an arbitrary depth is a lerp
      // between the two bracketing layer values. Scaling t by the layer count puts
      // the integer part on the near layer and the fraction between the pair.
      this.$l.scaled = pb.clamp(pb.mul(this.t, DOM_LAYER_COUNT), 0, DOM_LAYER_COUNT);
      this.$l.index = pb.floor(this.scaled);
      this.$l.frac = pb.sub(this.scaled, this.index);
      // Nothing has been traversed before the first layer, so the near value at
      // index 0 is zero rather than layers.x.
      this.$l.near = pb.float(0);
      this.$l.far = this.layers.x;
      this.$if(pb.greaterThanEqual(this.index, 2), function () {
        this.near = this.layers.y;
        this.far = this.layers.z;
      }).$elseif(pb.greaterThanEqual(this.index, 1), function () {
        this.near = this.layers.x;
        this.far = this.layers.y;
      });
      // Optical depth is what accumulates linearly through a medium, so the lerp
      // between two layer readings is meaningful in a way that lerping stored
      // alphas would not have been.
      this.$l.absorption = pb.mix(this.near, this.far, this.frac);
      // Beer-Lambert. With the casters recording -log(1 - alpha) this is exactly
      // prod(1 - alpha) over everything crossed, so a solid caster reaches black
      // and a stack of thin strands reaches the same value alpha compositing them
      // would have.
      this.$return(pb.exp(pb.neg(pb.mul(this.absorption, this.density))));
    });
    return pb.getGlobalScope()[funcName](shadowCoord) as PBShaderExp;
  }
}
