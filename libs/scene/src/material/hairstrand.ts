import type { BindGroup, PBFunctionScope, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { HairMaterial } from './hair';
import { ShaderHelper } from './shader/helper';
import type { DrawContext } from '../render';
import type { Clonable, Nullable } from '@zephyr3d/base';
import { Vector4 } from '@zephyr3d/base';
import type { HairStrandData } from './hairstrand_data';

/**
 * Hair material that expands strand control points into ribbons on the GPU.
 *
 * @remarks
 * Where {@link HairMaterial} shades ribbon geometry that something else built,
 * this material builds the ribbon itself. The vertex shader derives which strand,
 * which segment and which corner it is drawing from the vertex index alone, reads
 * the control points from a storage buffer, and emits a camera-facing quad. No
 * position, normal, tangent or texture coordinate attribute is read.
 *
 * Two things fall out of that, and both are the reason to do it:
 *
 * - **Memory.** A CPU-built ribbon mesh for a full 69k-strand hair set costs
 *   around 266 MB of vertex data. The control points it is built from are about
 *   20 MB, and that is all this material needs resident.
 * - **Orientation.** A stored ribbon has a fixed plane, so there is a viewing
 *   angle at which it degenerates to an edge, and a whole coplanar group of
 *   strands can vanish at once. A quad expanded toward the camera never does.
 *
 * Lighting is inherited unchanged from {@link HairMaterial}, so the two paths
 * shade identically and can be compared against each other.
 *
 * Control points are read in the drawing node's local space and put through its
 * world matrix, so a groom follows the node it hangs off - a head bone, say -
 * and several nodes can share one set of strands at different transforms.
 *
 * Requires storage buffers in the vertex stage, which means WebGPU.
 * @public
 */
export class HairStrandMaterial extends HairMaterial implements Clonable<HairStrandMaterial> {
  /** @internal Enables per-strand distance decimation in the vertex shader. */
  private static readonly FEATURE_STRAND_LOD = this.defineFeature();
  /** @internal */
  private _strands: Nullable<HairStrandData>;
  /** @internal Ribbon segments generated per strand. */
  private _segmentsPerStrand: number;
  /** @internal Multiplier on the width stored in the strand data. */
  private _strandWidthScale: number;
  /** @internal Lower bound on ribbon width, in world units. */
  private _minStrandWidth: number;
  /** @internal Lower bound on ribbon width, in pixels. */
  private _minPixelWidth: number;
  /** @internal Floor on the fraction of strands distance decimation keeps. */
  private _minStrandLODRatio: number;
  /** @internal How far the shading normal bends across the ribbon, in [0, 1]. */
  private _strandRoundness: number;
  /** @internal Strength of the root-depth ambient occlusion, in [0, 1]. */
  private _rootOcclusion: number;
  /** @internal How far along a strand the root occlusion reaches, in (0, 1]. */
  private _rootOcclusionRange: number;
  /** @internal Scratch vector, so applying uniforms allocates nothing. */
  private readonly _strandScratch: Vector4;
  /** @internal Scratch vector for the LOD uniform. */
  private readonly _lodScratch: Vector4;
  /** @internal Scratch vector for the shape uniform. */
  private readonly _shapeScratch: Vector4;
  /**
   * Creates a GPU strand material.
   */
  constructor() {
    super();
    this._strands = null;
    this._segmentsPerStrand = 8;
    this._strandWidthScale = 1;
    this._minStrandWidth = 0;
    this._minPixelWidth = 1.4;
    this._minStrandLODRatio = 0.05;
    this._strandRoundness = 1;
    this._rootOcclusion = 0.5;
    this._rootOcclusionRange = 0.6;
    this._strandScratch = new Vector4();
    this._lodScratch = new Vector4();
    this._shapeScratch = new Vector4();
    this.useFeature(HairStrandMaterial.FEATURE_STRAND_LOD, false);
    // The quad is built facing the camera, so there is no back face to cull.
    this.cullMode = 'none';
    // Strand geometry carries no vertex attributes at all: the frame is derived
    // from the curve, so the inherited attribute paths must stay off.
    this.vertexNormal = false;
    this.vertexTangent = false;
    // The inherited default is 'binormal', which is right for a hair card: its
    // atlas runs strands along V, and V is the binormal. This material builds its
    // own frame and puts the curve direction in the tangent, so the anisotropic
    // lobes have to be told to look there. Left at the default they measure the
    // highlight against the ribbon's side vector instead - and the side vector is
    // perpendicular to the view by construction, so sin(T,H) sits near one over
    // the whole groom and the lobes degenerate into a flat sheen with no band in
    // it. That is the single largest difference between this reading as hair and
    // reading as wet plastic, so it is set here rather than left to the caller.
    this.strandDirection = 'tangent';
  }
  clone() {
    const other = new HairStrandMaterial();
    other.copyFrom(this);
    return other;
  }
  copyFrom(other: this) {
    super.copyFrom(other);
    this.strands = other.strands;
    this.segmentsPerStrand = other.segmentsPerStrand;
    this.strandWidthScale = other.strandWidthScale;
    this.minStrandWidth = other.minStrandWidth;
    this.minPixelWidth = other.minPixelWidth;
    this.strandLOD = other.strandLOD;
    this.minStrandLODRatio = other.minStrandLODRatio;
    this.strandRoundness = other.strandRoundness;
    this.rootOcclusion = other.rootOcclusion;
    this.rootOcclusionRange = other.rootOcclusionRange;
  }
  /** GPU-resident strand geometry. */
  get strands(): Nullable<HairStrandData> {
    return this._strands;
  }
  set strands(val: Nullable<HairStrandData>) {
    if (val !== this._strands) {
      this._strands = val;
      this.uniformChanged();
    }
  }
  /**
   * Ribbon segments generated per strand.
   *
   * @remarks
   * The primary quality/cost dial, and independent of the control point count:
   * the shader resamples the curve, so the same 30-point strand can be drawn with
   * 12 segments up close and 3 far away.
   */
  get segmentsPerStrand() {
    return this._segmentsPerStrand;
  }
  set segmentsPerStrand(val) {
    const v = val < 1 ? 1 : val | 0;
    if (v !== this._segmentsPerStrand) {
      this._segmentsPerStrand = v;
      this.uniformChanged();
    }
  }
  /** Multiplier applied to the width stored in the strand data. */
  get strandWidthScale() {
    return this._strandWidthScale;
  }
  set strandWidthScale(val) {
    if (val !== this._strandWidthScale) {
      this._strandWidthScale = val;
      this.uniformChanged();
    }
  }
  /** Lower bound on ribbon width in world units. */
  get minStrandWidth() {
    return this._minStrandWidth;
  }
  set minStrandWidth(val) {
    const v = val < 0 ? 0 : val;
    if (v !== this._minStrandWidth) {
      this._minStrandWidth = v;
      this.uniformChanged();
    }
  }
  /**
   * Lower bound on ribbon width in pixels.
   *
   * @remarks
   * A strand narrower than a pixel rasterises to a flickering dotted line,
   * because whether a given segment covers a sample point changes with subpixel
   * position. Clamping the quad to about a pixel and scaling alpha by how much it
   * was widened keeps total energy roughly constant, so the strand reads as
   * fainter rather than as broken. Set to 0 to disable.
   */
  get minPixelWidth() {
    return this._minPixelWidth;
  }
  set minPixelWidth(val) {
    const v = val < 0 ? 0 : val;
    if (v !== this._minPixelWidth) {
      this._minPixelWidth = v;
      this.uniformChanged();
    }
  }
  /**
   * Trades strand count for strand opacity with distance.
   *
   * @remarks
   * Past the point where a strand is thinner than a pixel, {@link minPixelWidth}
   * widens it and pays the widening back as alpha, so a distant groom is drawn as
   * tens of thousands of ribbons each contributing a few percent of a pixel. That
   * is correct on average and unstable in practice: any per-fragment stochastic
   * alpha - `alphaDither`, alpha-to-coverage - is sampling a five percent event
   * once per pixel per frame, and the variance reads as pixel-level crawl that a
   * temporal filter's short history cannot average away.
   *
   * This moves the randomness from the fragment to the strand. Each strand is
   * kept with a probability equal to the coverage it would have been drawn at and
   * the survivors are drawn at full coverage, which puts the same quantity of hair
   * on screen: `N` strands at alpha `a` and `N*a` strands at alpha 1 integrate to
   * the same image. The difference is that the draw is decided once per strand
   * from a fixed seed rather than once per fragment per frame, so the result is
   * stable across frames, and the culled strands cost no fragments at all.
   *
   * Off by default: it changes which strands are drawn, so it is opted into
   * rather than applied to existing grooms silently.
   */
  get strandLOD() {
    return this.featureUsed<boolean>(HairStrandMaterial.FEATURE_STRAND_LOD);
  }
  set strandLOD(val: boolean) {
    this.useFeature(HairStrandMaterial.FEATURE_STRAND_LOD, !!val);
  }
  /**
   * Floor on the fraction of strands {@link strandLOD} keeps.
   *
   * @remarks
   * Decimation follows coverage, and coverage falls without bound as the groom
   * recedes, so an unclamped ratio eventually culls every strand and the hair
   * disappears. This is the point past which thinning stops and the remaining
   * strands simply fade instead. Defaults to 0.05.
   */
  get minStrandLODRatio() {
    return this._minStrandLODRatio;
  }
  set minStrandLODRatio(val) {
    const v = val < 0 ? 0 : val > 1 ? 1 : val;
    if (v !== this._minStrandLODRatio) {
      this._minStrandLODRatio = v;
      this.uniformChanged();
    }
  }
  /**
   * How far the shading normal bends across the ribbon, in [0, 1].
   *
   * @remarks
   * The quad is a stand-in for a cylinder, and this is how much it is shaded like
   * one. At 1 the normal sweeps a full half turn about the curve tangent between
   * the two edges, as the visible surface of a fibre does; at 0 it stays the
   * quad's own normal and every fragment across the width shades identically,
   * which is the flat ribbon this material drew before.
   *
   * It matters more than its size suggests. A flat ribbon has one normal, so the
   * specular lobes either fire across the strand's whole width or not at all, and
   * a groom becomes a field of uniformly bright or uniformly dull tape. Bending
   * the normal puts a narrow highlight down the length of each strand and lets the
   * edges fall off, which is most of what separates strands from one another when
   * they are all the same colour.
   *
   * Values below 1 keep the highlight but widen it, which reads as a softer,
   * thicker fibre; artists after a stylised look sometimes want that.
   */
  get strandRoundness() {
    return this._strandRoundness;
  }
  set strandRoundness(val) {
    const v = val < 0 ? 0 : val > 1 ? 1 : val;
    if (v !== this._strandRoundness) {
      this._strandRoundness = v;
      this.uniformChanged();
    }
  }
  /**
   * Strength of the root-depth ambient occlusion, in [0, 1].
   *
   * @remarks
   * Environment irradiance is not attenuated by anything - a shadow map answers
   * for one light, not for the sky - so without this every strand of a groom
   * receives the full sky, and a dense hairstyle lights up as brightly in its
   * interior as on its surface. That reads as a flat silhouette with no volume,
   * and it is most obvious on pale hair, where there is little pigment to darken
   * the interior instead.
   *
   * Real occlusion would need to know how much hair sits between a fibre and the
   * sky. This approximates that by where along the strand the fragment is: roots
   * grow from the scalp, buried under everything above them, while tips are on
   * the outside. It is only an approximation - a tip tucked under a fringe is
   * treated as exposed - but it is free, it needs no texture coordinates, which
   * this material has none of, and it captures the dominant effect. Set to 0 to
   * disable.
   *
   * Applied to ambient light and the scatter term only. Direct light keeps its
   * own answer - the shadow map, or DOM's graded transmittance - and multiplying
   * this on top would count the same blockage twice.
   */
  get rootOcclusion() {
    return this._rootOcclusion;
  }
  set rootOcclusion(val) {
    const v = val < 0 ? 0 : val > 1 ? 1 : val;
    if (v !== this._rootOcclusion) {
      this._rootOcclusion = v;
      this.uniformChanged();
    }
  }
  /**
   * How far along a strand the root occlusion reaches, in (0, 1].
   *
   * @remarks
   * The fraction of the strand's length over which occlusion fades from full at
   * the root to none. Short for a groom whose strands leave the scalp quickly,
   * longer for one where they lie against each other most of their length.
   */
  get rootOcclusionRange() {
    return this._rootOcclusionRange;
  }
  set rootOcclusionRange(val) {
    const v = val < 0.001 ? 0.001 : val > 1 ? 1 : val;
    if (v !== this._rootOcclusionRange) {
      this._rootOcclusionRange = v;
      this.uniformChanged();
    }
  }
  /**
   * Vertex count needed to draw the current strand set.
   *
   * @remarks
   * Assign this to the primitive's `indexCount`. Drawing is non-indexed, with six
   * vertices per ribbon segment forming two triangles.
   */
  get vertexCount() {
    return this._strands ? this._strands.strandCount * this._segmentsPerStrand * 6 : 0;
  }
  /**
   * Albedo, with alpha scaled by how much the ribbon was widened to meet the
   * pixel floor.
   *
   * @remarks
   * Widening a sub-pixel strand to a pixel adds coverage that is not physically
   * there. Scaling alpha by the inverse keeps the strand's contribution roughly
   * constant, so distant hair thins out in opacity instead of breaking into a
   * flickering dotted line.
   */
  calculateAlbedoColor(scope: PBInsideFunctionScope, uv?: PBShaderExp) {
    const pb = scope.$builder;
    const albedo = super.calculateAlbedoColor(scope, uv);
    const coverage = scope.$inputs.zStrandCoverage;
    if (!coverage) {
      return albedo;
    }
    return pb.vec4(albedo.rgb, pb.mul(albedo.a, coverage));
  }
  protected vertexShaderImpl(scope: PBFunctionScope) {
    const pb = scope.$builder;
    this.declareStrandBindings(scope);
    scope.$l.strand = this.expandStrandVertex(scope);
    scope.$outputs.worldPos = scope.strand.worldPos;
    scope.$outputs.wNorm = scope.strand.normal;
    scope.$outputs.wTangent = scope.strand.tangent;
    // Completes the frame the inherited lighting reads. The ribbon's own side
    // vector is already perpendicular to the strand and to the shading normal.
    scope.$outputs.wBinormal = scope.strand.side;
    scope.$outputs.zStrandCoverage = scope.strand.coverage;
    // Where across the ribbon this vertex sits, as the sine of the angle round the
    // fibre it stands for: -1 and +1 at the edges, 0 down the middle. The fragment
    // stage rebuilds the cylinder normal from it. Carrying the sine rather than the
    // angle is what makes it safe to interpolate - it is linear in the offset from
    // the centre, which is exactly what the rasteriser interpolates - and the
    // roundness dial is already folded in, so no fragment-stage uniform is needed.
    scope.$outputs.zStrandRound = scope.strand.across;
    scope.$outputs.zStrandAO = scope.strand.occlusion;
    // Without this the inherited path reports zero motion for every pixel - it
    // emits motion vectors from resolveVertexPosition, which reads the vertex
    // attribute this material does not have. A temporal filter then reprojects
    // rotating hair onto the pixel it used to occupy, rejects the mismatched
    // history and falls back to the raw frame, which on dithered strands is
    // visible as noise that only settles once the camera stops.
    //
    // The previous position is the strand's control point put through the
    // previous frame's world matrix, which is what moves when the node - a head
    // bone, say - moves. The camera-facing offset is reused rather than rebuilt
    // against the previous camera: its per-frame change is the ribbon half-width
    // times the per-frame camera rotation, hundredths of a pixel even while
    // orbiting quickly, and recomputing it would double the control point
    // fetches for a sub-pixel correction.
    //
    // This still assumes the control points themselves are static between
    // frames. A simulation pass writing the point buffer in place invalidates
    // that, and has to keep the previous frame's points to fix it properly.
    if (ShaderHelper.getPrevUnjitteredViewProjectionMatrix(scope)) {
      scope.$l.zPrevWorldPos = pb.add(
        pb.mul(ShaderHelper.getPrevWorldMatrix(scope), pb.vec4(scope.strand.localCentre, 1)).xyz,
        scope.strand.offset
      );
      ShaderHelper.resolveMotionVector(scope, scope.strand.worldPos, scope.zPrevWorldPos);
    }
    ShaderHelper.setClipSpacePosition(
      scope,
      pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.strand.worldPos, 1))
    );
  }
  /**
   * Rebuilds the cylinder normal the flat quad stands for.
   *
   * @remarks
   * The quad's own normal points at the camera everywhere on it, so every fragment
   * across a strand's width shades the same and the strand reads as tape. A real
   * fibre presents a curved surface: at the centre of the visible side its normal
   * faces the viewer, and by the silhouette edges it has turned a quarter turn to
   * lie perpendicular to the view. With `a` the interpolated sine of that angle,
   * the normal is `side * a + faceNormal * cos`, and `cos = sqrt(1 - a * a)`.
   *
   * Built from the varyings rather than from the interpolated TBN on purpose. The
   * TBN may be flipped for back faces, and the sine carried alongside it would not
   * be, which would turn the fibre inside out; the varyings need no flip, because
   * a camera-facing quad's normal already points at the camera by construction.
   * @internal
   */
  /**
   * Ambient occlusion from how deep in the groom the fragment sits.
   *
   * @remarks
   * Stands in for the occlusion map the inherited path uses, which this material
   * cannot sample: it emits no texture coordinates. See
   * {@link HairStrandMaterial.rootOcclusion} for why an approximation is worth
   * having at all.
   *
   * Only the ambient hook is overridden. The inherited direct hook resolves to
   * one here - there is no occlusion map - which is correct: the geometric term
   * describes being buried in the groom, and for direct light that is exactly
   * what the shadow map already measures.
   * @internal
   */
  protected calculateHairOcclusion(scope: PBInsideFunctionScope): PBShaderExp {
    const pb = scope.$builder;
    // Evaluated at the vertex stage and interpolated, the same way the roundness
    // dial is: the expansion parameters live in a vertex-stage uniform block, and
    // the term is smooth along a strand, so nothing is gained by computing it per
    // fragment.
    const occlusion = scope.$inputs.zStrandAO;
    if (!occlusion) {
      return super.calculateHairOcclusion(scope);
    }
    return pb.mul(super.calculateHairOcclusion(scope), occlusion);
  }
  protected calculateShadingNormal(scope: PBInsideFunctionScope, normalInfo: PBShaderExp) {
    const pb = scope.$builder;
    const across = scope.$inputs.zStrandRound;
    const faceNormal = scope.$inputs.wNorm;
    const side = scope.$inputs.wBinormal;
    if (!across || !faceNormal || !side) {
      return normalInfo.normal;
    }
    const funcName = 'Z_strandShadingNormal';
    pb.func(funcName, [pb.float('across'), pb.vec3('faceNormal'), pb.vec3('side')], function () {
      // Interpolating between two unit vectors shortens them, so both are
      // renormalised before they are combined rather than trusting the varyings.
      this.$l.n = pb.normalize(this.faceNormal);
      this.$l.s = pb.normalize(this.side);
      this.$l.sinA = pb.clamp(this.across, -1, 1);
      this.$l.cosA = pb.sqrt(pb.max(pb.sub(1, pb.mul(this.sinA, this.sinA)), 0));
      this.$return(pb.normalize(pb.add(pb.mul(this.s, this.sinA), pb.mul(this.n, this.cosA))));
    });
    return pb.getGlobalScope()[funcName](across, faceNormal, side) as PBShaderExp;
  }
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number) {
    super.applyUniformValues(bindGroup, ctx, pass);
    const strands = this._strands;
    if (!strands?.headerBuffer || !strands.pointBuffer) {
      return;
    }
    bindGroup.setBuffer('zStrandHeaders', strands.headerBuffer);
    bindGroup.setBuffer('zStrandPoints', strands.pointBuffer);
    // The pixel floor, in the form the rendering camera calls for. Perspective:
    // half a pixel subtends tan(fovY/2)/renderHeight radians, so a per-distance
    // factor multiplied by view distance in the shader yields the world-space
    // half-width. Orthographic - which is what a directional light's shadow pass
    // uses - has no notion of subtended angle: a pixel is a constant world size,
    // read off the projection matrix, and the floor is a constant half-width.
    // Exactly one of the two is non-zero, and the shader adds them.
    let pixelFactor = 0;
    let pixelFloorWorld = 0;
    const camera = ctx.camera;
    if (this._minPixelWidth > 0 && camera && ctx.renderHeight > 0) {
      if (camera.isPerspective()) {
        const tanHalfFov = camera.getTanHalfFovy();
        if (tanHalfFov > 0) {
          pixelFactor = (this._minPixelWidth * tanHalfFov) / ctx.renderHeight;
        }
      } else {
        // m11 of an orthographic projection is 2 / frustumHeight, so a texel is
        // frustumHeight / renderHeight world units tall and the half-width floor
        // follows. Keeping shadow-pass strands at roughly a texel matches what
        // the view pass does per pixel, so caster and receiver agree on width.
        const m11 = camera.getProjectionMatrix()[5];
        if (Number.isFinite(m11) && m11 > 0) {
          pixelFloorWorld = this._minPixelWidth / m11 / ctx.renderHeight;
        }
      }
    }
    bindGroup.setValue(
      'zStrandParams',
      this._strandScratch.setXYZW(
        this._segmentsPerStrand,
        this._strandWidthScale,
        this._minStrandWidth,
        pixelFactor
      )
    );
    bindGroup.setValue(
      'zStrandShape',
      this._shapeScratch.setXYZW(
        this._strandRoundness,
        this._rootOcclusion,
        this._rootOcclusionRange,
        pixelFloorWorld
      )
    );
    if (this.strandLOD) {
      bindGroup.setValue('zStrandLOD', this._lodScratch.setXYZW(this._minStrandLODRatio, 0, 0, 0));
    }
  }
  /**
   * Declares the strand storage buffers and expansion parameters.
   *
   * @remarks
   * Group 2 is the material's own bind group, matching the inherited uniforms.
   * @internal
   */
  private declareStrandBindings(scope: PBFunctionScope) {
    const pb = scope.$builder;
    scope.zStrandHeaders = pb.uint[0]().storageBufferReadonly(2);
    scope.zStrandPoints = pb.float[0]().storageBufferReadonly(2);
    scope.zStrandParams = pb.vec4().uniform(2);
    scope.zStrandShape = pb.vec4().uniform(2);
    if (this.strandLOD) {
      scope.zStrandLOD = pb.vec4().uniform(2);
    }
  }
  /**
   * Reads one control point as position in xyz and width in w.
   * @internal
   */
  private fetchStrandPoint(scope: PBInsideFunctionScope, index: PBShaderExp) {
    const pb = scope.$builder;
    const funcName = 'Z_strandPoint';
    pb.func(funcName, [pb.uint('index')], function () {
      const points = this.zStrandPoints;
      this.$l.base = pb.mul(this.index, 4);
      this.$return(
        pb.vec4(
          points.at(this.base),
          points.at(pb.add(this.base, 1)),
          points.at(pb.add(this.base, 2)),
          points.at(pb.add(this.base, 3))
        )
      );
    });
    return pb.getGlobalScope()[funcName](index) as PBShaderExp;
  }
  /**
   * Evaluates a strand at parameter `t`, returning position, width and tangent.
   *
   * @remarks
   * A Catmull-Rom spline through the control points, not the control polygon
   * itself, and both quantities come from the same curve: the sample is the
   * spline's value, the tangent its analytic derivative.
   *
   * The reason is the tangent. A polyline's derivative is constant within a span
   * and jumps at every control point, and the anisotropic lobes are a function of
   * that direction raised to a large power, so what is a slight kink in the
   * silhouette becomes a hard step in the highlight - each span of a strand shading
   * as its own uniformly bright or dark facet. Interpolating the position more
   * accurately is the lesser half of the change.
   *
   * The curve matters too once {@link segmentsPerStrand} is below the control
   * point count, which is the normal case: the default draws 8 segments from
   * strands carrying 30 points, so a polyline reading cuts the corner across three
   * points at a time and quietly straightens out every curl in the groom. A spline
   * sampled at the same rate keeps the bend.
   *
   * Costs four control point fetches against the three the polyline reading of
   * position and tangent needed between them.
   * @internal
   */
  private evaluateStrand(
    scope: PBInsideFunctionScope,
    firstPoint: PBShaderExp,
    pointCount: PBShaderExp,
    t: PBShaderExp
  ) {
    const pb = scope.$builder;
    const that = this;
    const funcName = 'Z_strandEvaluate';
    const StrandSample = pb.defineStruct([pb.vec4('sample'), pb.vec3('tangent')]);
    pb.func(funcName, [pb.uint('firstPoint'), pb.uint('pointCount'), pb.float('t')], function () {
      this.$l.last = pb.sub(this.pointCount, 1);
      this.$l.f = pb.mul(this.t, pb.float(this.last));
      this.$l.i1 = pb.min(pb.uint(pb.floor(this.f)), pb.sub(this.last, 1));
      this.$l.s = pb.clamp(pb.sub(this.f, pb.float(this.i1)), 0, 1);
      // The span is p1..p2, with p0 and p3 as the neighbours that set its
      // curvature. Both ends duplicate rather than wrap: max(i,1)-1 gives i-1
      // without underflowing at the root, and the tip clamps to the last point,
      // which is the usual way to end a Catmull-Rom without inventing points.
      this.$l.p0 = that.fetchStrandPoint(this, pb.add(this.firstPoint, pb.sub(pb.max(this.i1, 1), 1)));
      this.$l.p1 = that.fetchStrandPoint(this, pb.add(this.firstPoint, this.i1));
      this.$l.p2 = that.fetchStrandPoint(this, pb.add(this.firstPoint, pb.add(this.i1, 1)));
      this.$l.p3 = that.fetchStrandPoint(
        this,
        pb.add(this.firstPoint, pb.min(pb.add(this.i1, 2), this.last))
      );
      // Uniform Catmull-Rom in Hermite form: the span p1..p2 with the endpoint
      // tangents each spline segment inherits from its neighbours. Kept in this
      // form rather than as a collected cubic so the value and the derivative are
      // visibly the same polynomial, and so the endpoint conditions - value p1 and
      // slope m1 at s = 0, value p2 and slope m2 at s = 1 - can be read off.
      this.$l.m1 = pb.mul(pb.sub(this.p2, this.p0), 0.5);
      this.$l.m2 = pb.mul(pb.sub(this.p3, this.p1), 0.5);
      this.$l.d = pb.sub(this.p2, this.p1);
      this.$l.a2 = pb.sub(pb.mul(this.d, 3), pb.add(pb.mul(this.m1, 2), this.m2));
      this.$l.a3 = pb.add(pb.mul(this.d, -2), this.m1, this.m2);
      this.$l.s2 = pb.mul(this.s, this.s);
      this.$l.value = pb.add(
        this.p1,
        pb.mul(this.m1, this.s),
        pb.mul(this.a2, this.s2),
        pb.mul(this.a3, pb.mul(this.s2, this.s))
      );
      this.$l.deriv = pb.add(
        this.m1.xyz,
        pb.mul(this.a2.xyz, pb.mul(this.s, 2)),
        pb.mul(this.a3.xyz, pb.mul(this.s2, 3))
      );
      this.$l.out = StrandSample();
      // A spline can undershoot between control points, and a negative width
      // would flip the quad inside out, so the width is floored at zero.
      this.out.sample = pb.vec4(this.value.xyz, pb.max(this.value.w, 0));
      this.$l.len = pb.length(this.deriv);
      this.$if(pb.greaterThan(this.len, 0.000001), function () {
        this.out.tangent = pb.div(this.deriv, this.len);
      }).$else(function () {
        // Coincident control points leave the derivative undefined; fall back to
        // the chord across the span, and to an arbitrary axis if that is degenerate
        // too, so a duplicated point cannot produce a NaN frame.
        this.$l.chord = pb.sub(this.p2.xyz, this.p1.xyz);
        this.$l.chordLen = pb.length(this.chord);
        this.$if(pb.greaterThan(this.chordLen, 0.000001), function () {
          this.out.tangent = pb.div(this.chord, this.chordLen);
        }).$else(function () {
          this.out.tangent = pb.vec3(0, 1, 0);
        });
      });
      this.$return(this.out);
    });
    return pb.getGlobalScope()[funcName](firstPoint, pointCount, t) as PBShaderExp;
  }
  /**
   * Rotates a strand direction into world space and renormalises it.
   *
   * @remarks
   * The direction is transformed by the world matrix rather than by its inverse
   * transpose on purpose: this is a tangent, not a normal. The shading normal is
   * rebuilt from the tangent and the ribbon's side vector after the fact, so a
   * non-uniform scale reaches the lighting through the frame it actually bends.
   *
   * A degenerate scale can collapse the direction entirely, which would leave a
   * zero-length tangent and produce NaN once it is normalised, so the untransformed
   * direction stands in for that case.
   * @internal
   */
  private transformStrandDirection(
    scope: PBInsideFunctionScope,
    worldMatrix: PBShaderExp,
    direction: PBShaderExp
  ) {
    const pb = scope.$builder;
    const funcName = 'Z_strandDirectionToWorld';
    pb.func(funcName, [pb.mat4('worldMatrix'), pb.vec3('direction')], function () {
      this.$l.transformed = pb.mul(this.worldMatrix, pb.vec4(this.direction, 0)).xyz;
      this.$l.len = pb.length(this.transformed);
      this.$if(pb.greaterThan(this.len, 0.000001), function () {
        this.$return(pb.div(this.transformed, this.len));
      });
      this.$return(this.direction);
    });
    return pb.getGlobalScope()[funcName](worldMatrix, direction) as PBShaderExp;
  }
  /**
   * Derives this vertex's ribbon corner from the vertex index.
   *
   * @remarks
   * Six vertices per segment form two triangles over a quad whose corners are
   * indexed by (ring, side). Independent triangles rather than a strip means no
   * degenerate vertices are needed to cut between strands, and the duplicated
   * corners cost nothing because corners are computed rather than fetched.
   * @internal
   */
  private expandStrandVertex(scope: PBInsideFunctionScope) {
    const pb = scope.$builder;
    const funcName = 'Z_expandStrandVertex';
    const that = this;
    const StrandVertex = pb.defineStruct([
      pb.vec3('worldPos'),
      pb.vec3('normal'),
      pb.vec3('tangent'),
      pb.vec3('side'),
      pb.float('coverage'),
      pb.float('across'),
      pb.vec3('localCentre'),
      pb.vec3('offset'),
      pb.float('occlusion')
    ]);
    pb.func(funcName, [], function () {
      this.$l.vid = pb.uint(this.$builtins.vertexIndex);
      this.$l.segCount = pb.max(pb.uint(this.zStrandParams.x), 1);
      this.$l.perStrand = pb.mul(this.segCount, 6);
      this.$l.strandIndex = pb.div(this.vid, this.perStrand);
      this.$l.local = pb.sub(this.vid, pb.mul(this.strandIndex, this.perStrand));
      this.$l.segIndex = pb.div(this.local, 6);
      this.$l.corner = pb.sub(this.local, pb.mul(this.segIndex, 6));
      // Quad corners as (ring offset, side): triangle one is 0,2,1 and triangle
      // two is 1,2,3, which keeps a consistent winding for both.
      this.$l.ringStep = pb.uint(0);
      this.$l.sideSel = pb.float(0);
      this.$if(pb.equal(this.corner, 0), function () {
        this.ringStep = pb.uint(0);
        this.sideSel = pb.float(0);
      })
        .$elseif(pb.equal(this.corner, 1), function () {
          this.ringStep = pb.uint(0);
          this.sideSel = pb.float(1);
        })
        .$elseif(pb.equal(this.corner, 2), function () {
          this.ringStep = pb.uint(1);
          this.sideSel = pb.float(0);
        })
        .$elseif(pb.equal(this.corner, 3), function () {
          this.ringStep = pb.uint(1);
          this.sideSel = pb.float(0);
        })
        .$elseif(pb.equal(this.corner, 4), function () {
          this.ringStep = pb.uint(0);
          this.sideSel = pb.float(1);
        })
        .$else(function () {
          this.ringStep = pb.uint(1);
          this.sideSel = pb.float(1);
        });
      this.$l.ring = pb.add(this.segIndex, this.ringStep);

      // Header: first point, point count, packed root UV, seed.
      this.$l.hBase = pb.mul(this.strandIndex, 4);
      this.$l.firstPoint = this.zStrandHeaders.at(this.hBase);
      this.$l.pointCount = pb.max(this.zStrandHeaders.at(pb.add(this.hBase, 1)), 2);

      this.$l.t = pb.div(pb.float(this.ring), pb.float(this.segCount));
      this.$l.curve = that.evaluateStrand(this, this.firstPoint, this.pointCount, this.t);
      // Control points are stored in the node's local space, so the frame is
      // built after the world transform rather than before it: the ribbon faces
      // the camera in world space, and a non-uniform scale must not be allowed
      // to shear that facing direction.
      this.$l.worldMatrix = ShaderHelper.getWorldMatrix(this);
      this.$l.localCentre = this.curve.sample.xyz;
      this.$l.centre = pb.mul(this.worldMatrix, pb.vec4(this.localCentre, 1)).xyz;
      this.$l.tangent = that.transformStrandDirection(this, this.worldMatrix, this.curve.tangent);
      // Width is a length in the same space as the control points, so it follows
      // the same transform. A single factor stands in for the three axis scales
      // because a strand is a fibre with no preferred cross-section direction -
      // and the mean is what keeps a uniformly scaled groom exactly proportional.
      this.$l.worldScale = pb.div(
        pb.add(
          pb.length(this.worldMatrix[0].xyz),
          pb.length(this.worldMatrix[1].xyz),
          pb.length(this.worldMatrix[2].xyz)
        ),
        3
      );
      this.$l.halfWidth = pb.mul(this.curve.sample.w, 0.5, this.zStrandParams.y, this.worldScale);

      // Camera-facing side vector: perpendicular to the strand and to the view
      // ray, so the ribbon always presents its full width.
      this.$l.camPos = ShaderHelper.getCameraPosition(this);
      this.$l.toCam = pb.sub(this.camPos, this.centre);
      this.$l.viewDist = pb.length(this.toCam);
      this.$l.viewDir = pb.vec3(0, 0, 1);
      this.$if(pb.greaterThan(this.viewDist, 0.000001), function () {
        this.viewDir = pb.div(this.toCam, this.viewDist);
      });
      this.$l.side = pb.cross(this.tangent, this.viewDir);
      this.$l.sideLen = pb.length(this.side);
      this.$if(pb.greaterThan(this.sideLen, 0.000001), function () {
        this.side = pb.div(this.side, this.sideLen);
      }).$else(function () {
        // Strand pointing straight at the camera: any perpendicular will do.
        this.side = pb.normalize(pb.cross(this.tangent, pb.vec3(0.0, 1.0, 0.001)));
      });

      // Clamp to the world-space floor, then to the pixel floor, tracking how much
      // the quad was widened so the fragment stage can pay it back in alpha.
      this.$l.halfW = pb.max(this.halfWidth, pb.mul(this.zStrandParams.z, 0.5));
      this.$l.coverage = pb.float(1);
      // The pixel floor has two forms because a pixel has two meanings. Under a
      // perspective camera its world size grows with distance: zStrandParams.w
      // holds minPixelWidth * tan(fovY/2) / renderHeight and one multiply by view
      // distance gives the floor - folding the projection terms on the CPU avoids
      // needing a viewport uniform here. Under an orthographic camera - a
      // directional light's shadow pass - a pixel is the same world size
      // everywhere, so zStrandShape.w carries the floor as a constant. The CPU
      // fills exactly one of the two, so their sum is whichever applies; without
      // the ortho term, sub-texel strands leave no footprint in the shadow map at
      // all and the deep opacity map under-counts the very hair it exists to
      // shadow.
      this.$l.floorHalf = pb.add(pb.mul(this.zStrandParams.w, this.viewDist), this.zStrandShape.w);
      this.$if(pb.greaterThan(this.floorHalf, 0), function () {
        this.$if(pb.lessThan(this.halfW, this.floorHalf), function () {
          this.coverage = pb.div(this.halfW, this.floorHalf);
          this.halfW = this.floorHalf;
        });
      });

      if (that.strandLOD) {
        // Taken from the root control point rather than from this ring: both the
        // view distance and the tapered width vary along a strand, so a
        // ring-local threshold would fall between two rings on strands near the
        // cut-off and lop them off partway down their length.
        const points = this.zStrandPoints;
        this.$l.rootBase = pb.mul(this.firstPoint, 4);
        this.$l.rootLocal = pb.vec3(
          points.at(this.rootBase),
          points.at(pb.add(this.rootBase, 1)),
          points.at(pb.add(this.rootBase, 2))
        );
        // The threshold compares a width against a view distance, so the root has
        // to reach world space like everything else - otherwise a scaled groom
        // would decimate against distances measured in its own local units.
        this.$l.rootPos = pb.mul(this.worldMatrix, pb.vec4(this.rootLocal, 1)).xyz;
        this.$l.rootHalf = pb.mul(
          points.at(pb.add(this.rootBase, 3)),
          0.5,
          this.zStrandParams.y,
          this.worldScale
        );
        this.$l.rootFloor = pb.add(
          pb.mul(this.zStrandParams.w, pb.distance(this.camPos, this.rootPos)),
          this.zStrandShape.w
        );
        this.$l.keep = pb.float(1);
        this.$if(pb.greaterThan(this.rootFloor, 0), function () {
          this.keep = pb.clamp(pb.div(this.rootHalf, this.rootFloor), this.zStrandLOD.x, 1);
        });
        // The per-strand seed the importer hashed into the header. Stored as
        // float bits in a uint buffer, hence the bitcast.
        this.$l.seed = pb.uintBitsToFloat(this.zStrandHeaders.at(pb.add(this.hBase, 3)));
        // Survivors absorb the coverage of the strands dropped alongside them,
        // which is what leaves the total amount of hair unchanged. At the ratio
        // floor this stops reaching 1 and the strands fade instead.
        this.coverage = pb.min(pb.div(this.coverage, this.keep), 1);
        this.$if(pb.greaterThanEqual(this.seed, this.keep), function () {
          // Collapse the strand onto a single point: every triangle it would
          // have produced becomes zero-area and is dropped before rasterisation,
          // so a culled strand costs no fragments at all.
          this.centre = this.rootPos;
          this.localCentre = this.rootLocal;
          this.halfW = pb.float(0);
        });
      }

      this.$l.acrossSign = pb.sub(pb.mul(this.sideSel, 2), 1);
      this.$l.offset = pb.mul(this.side, this.halfW, this.acrossSign);
      this.$l.result = StrandVertex();
      this.result.worldPos = pb.add(this.centre, this.offset);
      // On a cylinder seen from outside, the visible surface points back along the
      // side vector toward the camera; crossing side with tangent gives that.
      this.result.normal = pb.normalize(pb.cross(this.side, this.tangent));
      this.result.tangent = this.tangent;
      this.result.side = this.side;
      this.result.coverage = this.coverage;
      this.result.across = pb.mul(this.acrossSign, this.zStrandShape.x);
      // Carried out so the caller can rebuild this vertex against the previous
      // frame's world matrix without re-running the expansion.
      this.result.localCentre = this.localCentre;
      this.result.offset = this.offset;
      // How deep in the groom this vertex sits, stood in for by where along the
      // strand it is: full occlusion at the root, fading to none once the strand
      // has climbed `range` of its length clear. Smoothstep rather than a linear
      // ramp so the transition leaves no visible edge across a dense groom.
      this.$l.aoDepth = pb.sub(1, pb.smoothStep(0, pb.max(this.zStrandShape.z, 0.001), this.t));
      this.result.occlusion = pb.clamp(pb.sub(1, pb.mul(this.aoDepth, this.zStrandShape.y)), 0, 1);
      this.$return(this.result);
    });
    return pb.getGlobalScope()[funcName]() as PBShaderExp;
  }
}
