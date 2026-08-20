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
  /** @internal Scratch vector, so applying uniforms allocates nothing. */
  private readonly _strandScratch: Vector4;
  /** @internal Scratch vector for the LOD uniform. */
  private readonly _lodScratch: Vector4;
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
    this._strandScratch = new Vector4();
    this._lodScratch = new Vector4();
    this.useFeature(HairStrandMaterial.FEATURE_STRAND_LOD, false);
    // The quad is built facing the camera, so there is no back face to cull.
    this.cullMode = 'none';
    // Strand geometry carries no vertex attributes at all: the frame is derived
    // from the curve, so the inherited attribute paths must stay off.
    this.vertexNormal = false;
    this.vertexTangent = false;
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
   * Vertex count needed to draw the current strand set.
   *
   * @remarks
   * Assign this to the primitive's `indexCount`. Drawing is non-indexed, with six
   * vertices per ribbon segment forming two triangles.
   */
  get vertexCount() {
    return this._strands ? this._strands.strandCount * this._segmentsPerStrand * 6 : 0;
  }
  vertexShader(scope: PBFunctionScope) {
    // Deliberately does not call super.vertexShader(): the inherited path resolves
    // position from a vertex attribute, and this material has none. The global
    // uniform block it would have set up is still needed - camera position among
    // others - so it is prepared directly here.
    const pb = scope.$builder;
    ShaderHelper.prepareVertexShader(pb, this.drawContext);
    this.declareStrandBindings(scope);
    scope.$l.strand = this.expandStrandVertex(scope);
    scope.$outputs.worldPos = scope.strand.worldPos;
    scope.$outputs.wNorm = scope.strand.normal;
    scope.$outputs.wTangent = scope.strand.tangent;
    // Completes the frame the inherited lighting reads. The ribbon's own side
    // vector is already perpendicular to the strand and to the shading normal.
    scope.$outputs.wBinormal = scope.strand.side;
    scope.$outputs.zStrandCoverage = scope.strand.coverage;
    // Without this the inherited path reports zero motion for every pixel - it
    // emits motion vectors from resolveVertexPosition, which reads the vertex
    // attribute this material does not have. A temporal filter then reprojects
    // rotating hair onto the pixel it used to occupy, rejects the mismatched
    // history and falls back to the raw frame, which on dithered strands is
    // visible as noise that only settles once the camera stops.
    //
    // Both ends use the current world position on purpose. The control points
    // are already world space and no world matrix is applied, so a static groom
    // does not move between frames; all that differs is the camera-facing offset,
    // whose per-frame change is the ribbon half-width times the per-frame camera
    // rotation - hundredths of a pixel even while orbiting quickly. Re-running
    // the expansion against the previous camera to recover that would double the
    // control point fetches for a sub-pixel correction.
    //
    // This does assume the control points are static. A simulation pass writing
    // the point buffer in place would invalidate it, and would need the previous
    // frame's points kept alongside the current ones to fix properly.
    ShaderHelper.resolveMotionVector(scope, scope.strand.worldPos, scope.strand.worldPos);
    ShaderHelper.setClipSpacePosition(
      scope,
      pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.strand.worldPos, 1))
    );
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
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number) {
    super.applyUniformValues(bindGroup, ctx, pass);
    const strands = this._strands;
    if (!strands?.headerBuffer || !strands.pointBuffer) {
      return;
    }
    bindGroup.setBuffer('zStrandHeaders', strands.headerBuffer);
    bindGroup.setBuffer('zStrandPoints', strands.pointBuffer);
    // The pixel floor is folded into a single per-distance factor: half a pixel
    // subtends tan(fovY/2)/renderHeight radians, so multiplying by the view
    // distance in the shader yields the world-space half-width floor.
    let pixelFactor = 0;
    if (this._minPixelWidth > 0) {
      const height = ctx.renderHeight;
      const tanHalfFov = ctx.camera?.getTanHalfFovy() ?? 0;
      if (height > 0 && tanHalfFov > 0) {
        pixelFactor = (this._minPixelWidth * tanHalfFov) / height;
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
    if (this.strandLOD) {
      scope.zStrandLOD = pb.vec4().uniform(2);
    }
  }
  /**
   * Samples a strand's control polygon at parameter `t`.
   *
   * @remarks
   * Returns position in xyz and width in w. Linear interpolation along the
   * control polygon is enough: strands carry tens of points over a few
   * centimetres, so the polygon and the spline through it differ by far less than
   * a pixel.
   * @internal
   */
  private sampleStrand(
    scope: PBInsideFunctionScope,
    firstPoint: PBShaderExp,
    pointCount: PBShaderExp,
    t: PBShaderExp
  ) {
    const pb = scope.$builder;
    const funcName = 'Z_strandSample';
    pb.func(funcName, [pb.uint('firstPoint'), pb.uint('pointCount'), pb.float('t')], function () {
      const points = this.zStrandPoints;
      this.$l.last = pb.sub(this.pointCount, 1);
      this.$l.f = pb.mul(this.t, pb.float(this.last));
      this.$l.i0 = pb.min(pb.uint(pb.floor(this.f)), pb.sub(this.last, 1));
      this.$l.frac = pb.sub(this.f, pb.float(this.i0));
      this.$l.a = pb.mul(pb.add(this.firstPoint, this.i0), 4);
      this.$l.b = pb.add(this.a, 4);
      this.$l.pa = pb.vec4(
        points.at(this.a),
        points.at(pb.add(this.a, 1)),
        points.at(pb.add(this.a, 2)),
        points.at(pb.add(this.a, 3))
      );
      this.$l.pbv = pb.vec4(
        points.at(this.b),
        points.at(pb.add(this.b, 1)),
        points.at(pb.add(this.b, 2)),
        points.at(pb.add(this.b, 3))
      );
      this.$return(pb.mix(this.pa, this.pbv, this.frac));
    });
    return pb.getGlobalScope()[funcName](firstPoint, pointCount, t) as PBShaderExp;
  }
  /**
   * Unit tangent of a strand at parameter `t`.
   *
   * @remarks
   * Taken as a forward difference between adjacent control points rather than
   * from the interpolated sample, so it stays defined at the endpoints.
   * @internal
   */
  private strandTangent(
    scope: PBInsideFunctionScope,
    firstPoint: PBShaderExp,
    pointCount: PBShaderExp,
    t: PBShaderExp
  ) {
    const pb = scope.$builder;
    const funcName = 'Z_strandTangent';
    pb.func(funcName, [pb.uint('firstPoint'), pb.uint('pointCount'), pb.float('t')], function () {
      const points = this.zStrandPoints;
      this.$l.last = pb.sub(this.pointCount, 1);
      this.$l.f = pb.mul(this.t, pb.float(this.last));
      this.$l.i0 = pb.min(pb.uint(pb.floor(this.f)), pb.sub(this.last, 1));
      this.$l.a = pb.mul(pb.add(this.firstPoint, this.i0), 4);
      this.$l.b = pb.add(this.a, 4);
      this.$l.dir = pb.sub(
        pb.vec3(points.at(this.b), points.at(pb.add(this.b, 1)), points.at(pb.add(this.b, 2))),
        pb.vec3(points.at(this.a), points.at(pb.add(this.a, 1)), points.at(pb.add(this.a, 2)))
      );
      this.$l.len = pb.length(this.dir);
      this.$if(pb.greaterThan(this.len, 0.000001), function () {
        this.$return(pb.div(this.dir, this.len));
      });
      this.$return(pb.vec3(0, 1, 0));
    });
    return pb.getGlobalScope()[funcName](firstPoint, pointCount, t) as PBShaderExp;
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
      pb.float('coverage')
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
      this.$l.sample = that.sampleStrand(this, this.firstPoint, this.pointCount, this.t);
      this.$l.centre = this.sample.xyz;
      this.$l.tangent = that.strandTangent(this, this.firstPoint, this.pointCount, this.t);
      this.$l.halfWidth = pb.mul(this.sample.w, 0.5, this.zStrandParams.y);

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
      this.$if(pb.greaterThan(this.zStrandParams.w, 0), function () {
        // zStrandParams.w already holds minPixelWidth * tan(fovY/2) / renderHeight,
        // so one multiply by view distance gives the world-space floor. Folding the
        // projection terms on the CPU avoids needing a viewport uniform here, which
        // the shader library does not otherwise expose.
        this.$l.floorHalf = pb.mul(this.zStrandParams.w, this.viewDist);
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
        this.$l.rootPos = pb.vec3(
          points.at(this.rootBase),
          points.at(pb.add(this.rootBase, 1)),
          points.at(pb.add(this.rootBase, 2))
        );
        this.$l.rootHalf = pb.mul(points.at(pb.add(this.rootBase, 3)), 0.5, this.zStrandParams.y);
        this.$l.rootFloor = pb.mul(this.zStrandParams.w, pb.distance(this.camPos, this.rootPos));
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
          this.halfW = pb.float(0);
        });
      }

      this.$l.offset = pb.mul(this.side, this.halfW, pb.sub(pb.mul(this.sideSel, 2), 1));
      this.$l.result = StrandVertex();
      this.result.worldPos = pb.add(this.centre, this.offset);
      // On a cylinder seen from outside, the visible surface points back along the
      // side vector toward the camera; crossing side with tangent gives that.
      this.result.normal = pb.normalize(pb.cross(this.side, this.tangent));
      this.result.tangent = this.tangent;
      this.result.side = this.side;
      this.result.coverage = this.coverage;
      this.$return(this.result);
    });
    return pb.getGlobalScope()[funcName]() as PBShaderExp;
  }
}
