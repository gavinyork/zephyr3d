import type { AABB, Nullable } from '@zephyr3d/base';
import { Disposable, halfToFloat, Vector2, Vector3, Vector4 } from '@zephyr3d/base';
import type {
  AbstractDevice,
  BindGroup,
  FrameBuffer,
  GPUProgram,
  PBGlobalScope,
  PBInsideFunctionScope,
  PBRenderOptions,
  PBShaderExp,
  ProgramBuilder,
  Texture2D,
  TextureFormat
} from '@zephyr3d/device';
import type { WaveGenerator } from './wavegenerator';
import type { SceneNode } from '../scene/scene_node';
import type { Scene } from '../scene/scene';
import { getDevice } from '../app/api';
import { fetchSampler } from '../utility/misc';
import { drawFullscreenQuad } from './fullscreenquad';
import { ShaderHelper } from '../material/shader/helper';

/**
 * How the interaction window is positioned in the world.
 *
 * - `camera`: centred on the camera that last updated the water. The default.
 * - `node`: centred on {@link WaterInteraction.followNode}.
 * - `fixed`: centred on {@link WaterInteraction.center} and never moves. The
 *   right choice for a pool or a pond that fits inside one window.
 *
 * @public
 */
export type WaterInteractionFollowMode = 'camera' | 'node' | 'fixed';

/** Most impulses one simulation step can take. @internal */
const MAX_IMPULSES = 16;
/** Simulation step, in seconds. @internal */
const FIXED_STEP = 1 / 60;
/** Most steps run in one frame; the rest of the backlog is dropped. @internal */
const MAX_SUBSTEPS = 4;
/** Largest frame delta accepted, so a stall does not turn into a burst of steps. @internal */
const MAX_FRAME_DELTA = 0.25;
/**
 * Upper bound on `c * dt / dx` for the explicit scheme to stay stable in 2D
 * (the CFL condition is `1 / sqrt(2)`; this leaves a margin). @internal
 */
const MAX_COURANT = 0.6;
/** Window shift for steps after the first in a frame. @internal */
const ZERO_SHIFT = new Vector2(0, 0);
/** Texture formats tried in order for the field: height, previous height, foam. @internal */
const HEIGHT_FORMATS: TextureFormat[] = ['rgba32f', 'rgba16f'];
/** Most disturbers the field can carry at once. @internal */
const MAX_DISTURBERS = 16;
/** Floats per footprint: three vec4. @internal */
const FOOTPRINT_STRIDE = 12;
/** Floats per disturber in the uniform array: the current and the previous footprint. @internal */
const DISTURBER_STRIDE = FOOTPRINT_STRIDE * 2;
/** Vec4 per disturber in the uniform array. @internal */
const DISTURBER_VEC4S = DISTURBER_STRIDE / 4;
/** Footprint type codes. A blocking footprint adds {@link BLOCKING_FLAG}. @internal */
const SHAPE_SPHERE = 1;
const SHAPE_CAPSULE = 2;
const SHAPE_BOX = 3;
const BLOCKING_FLAG = 10;

/**
 * Footprint shape of a {@link WaterDisturber}.
 *
 * - `sphere`: radius {@link WaterDisturber.radius} about the node's origin.
 * - `capsule`: radius {@link WaterDisturber.radius} about a segment along the
 *   node's local Y axis, {@link WaterDisturber.halfLength} either side.
 * - `box`: {@link WaterDisturber.size} about the node's origin, in its local
 *   axes.
 *
 * @public
 */
export type WaterDisturberShape = 'sphere' | 'capsule' | 'box';

/**
 * Something that disturbs a water surface by moving through it.
 *
 * Follows a scene node and describes the volume the node occupies with one of
 * three shapes. Each frame the field works out how much water column the shape
 * displaces at every texel - its footprint on the surface, weighted by how deep
 * it sits - and injects the change since the previous frame: something at rest
 * leaves the water alone, something moving leaves a wake.
 *
 * A `blocking` disturber is also an obstacle: waves stop at its footprint and
 * reflect off it, the way ripples do off a piling.
 *
 * @public
 */
export class WaterDisturber {
  /** Node the shape follows, or null until {@link nodeId} has been resolved. */
  node: Nullable<SceneNode>;
  /**
   * Persistent id of the node the shape follows, for a disturber loaded from a
   * scene before the node it refers to exists. Resolved against the water's
   * scene on the next update; {@link node} wins when both are set.
   */
  nodeId: string;
  /** Footprint shape. */
  shape: WaterDisturberShape;
  /** Radius in metres, for `sphere` and `capsule`. Scaled by the node. */
  radius: number;
  /** Half the segment length in metres, for `capsule`, along the node's local Y axis. */
  halfLength: number;
  /** Extents in metres, for `box`, along the node's local axes. */
  size: Vector3;
  /**
   * Water column displaced by the fully submerged shape, in metres of surface
   * height. Scales how hard the disturber pushes; not a physical volume.
   */
  strength: number;
  /** Whether waves stop at and reflect off the footprint. */
  blocking: boolean;
  /** Whether the disturber is taken into account. */
  enabled: boolean;
  /** @internal */
  _hasPrev: boolean;
  /** Slot the disturber took in the last step, whose surface height it reads back. @internal */
  _slot: number;
  /** @internal */
  readonly _now: Float32Array<ArrayBuffer>;
  /** @internal */
  readonly _prev: Float32Array<ArrayBuffer>;
  /**
   * Creates a disturber.
   * @param node - Node the shape follows.
   * @param shape - Footprint shape. Defaults to `sphere`.
   */
  constructor(node: Nullable<SceneNode> = null, shape: WaterDisturberShape = 'sphere') {
    this.node = node;
    this.nodeId = '';
    this.shape = shape;
    this.radius = 0.5;
    this.halfLength = 0.5;
    this.size = new Vector3(1, 1, 1);
    this.strength = 0.15;
    this.blocking = false;
    this.enabled = true;
    this._hasPrev = false;
    this._slot = -1;
    this._now = new Float32Array(FOOTPRINT_STRIDE);
    this._prev = new Float32Array(FOOTPRINT_STRIDE);
  }
  /**
   * Evaluate the footprint into `_now`, its heights relative to the still
   * water at `waterLevel`. How deep it sits is worked out on the GPU against
   * the surface it floats on (see `wiFootprint`), which the ambient waves
   * raise and lower under it.
   *
   * Layout: `(type, cx, cz, 1)`, `(p0, p1, p2, p3)` with the shape-specific
   * parameters in world XZ metres (a sphere's full radius in p0),
   * `(bottom, top, centre y, strength)`. The previous footprint's first `w`
   * says whether the surface height read back for its slot is its own.
   * @internal
   */
  _evaluate(waterLevel: number) {
    const m = this.node!.worldMatrix;
    const out = this._now;
    const flags = this.blocking ? BLOCKING_FLAG : 0;
    const cx = m.m03;
    const cy = m.m13 - waterLevel;
    const cz = m.m23;
    // Node scale, from the world matrix columns.
    const sx = Math.hypot(m.m00, m.m10, m.m20);
    const sy = Math.hypot(m.m01, m.m11, m.m21);
    const sz = Math.hypot(m.m02, m.m12, m.m22);
    out[3] = 1;
    out[10] = cy;
    out[11] = this.strength;
    if (this.shape === 'sphere') {
      const r = this.radius * Math.max(sx, sy, sz);
      out[0] = SHAPE_SPHERE + flags;
      out[1] = cx;
      out[2] = cz;
      out[4] = r;
      out[5] = 0;
      out[6] = 0;
      out[7] = 0;
      out[8] = cy - r;
      out[9] = cy + r;
    } else if (this.shape === 'capsule') {
      const r = this.radius * Math.max(sx, sz);
      // Endpoints of the segment along local Y; the column carries the scale.
      const ax = cx - m.m01 * this.halfLength;
      const ay = cy - m.m11 * this.halfLength;
      const az = cz - m.m21 * this.halfLength;
      const bx = cx + m.m01 * this.halfLength;
      const by = cy + m.m11 * this.halfLength;
      const bz = cz + m.m21 * this.halfLength;
      out[0] = SHAPE_CAPSULE + flags;
      out[1] = ax;
      out[2] = az;
      out[4] = bx;
      out[5] = bz;
      out[6] = r;
      out[7] = 0;
      out[8] = Math.min(ay, by) - r;
      out[9] = Math.max(ay, by) + r;
    } else {
      // Half extents along the world-space columns.
      const hx = this.size.x * 0.5;
      const hy = this.size.y * 0.5;
      const hz = this.size.z * 0.5;
      const cxx = m.m00 * hx;
      const cxy = m.m10 * hx;
      const cxz = m.m20 * hx;
      const cyx = m.m01 * hy;
      const cyy = m.m11 * hy;
      const cyz = m.m21 * hy;
      const czx = m.m02 * hz;
      const czy = m.m12 * hz;
      const czz = m.m22 * hz;
      const yExtent = Math.abs(cxy) + Math.abs(cyy) + Math.abs(czy);
      // The footprint frame: the local X axis projected to the plane, or the
      // local Z axis when X points straight up or down.
      let ux = cxx;
      let uz = cxz;
      let len = Math.hypot(ux, uz);
      if (len < 1e-6) {
        ux = czx;
        uz = czz;
        len = Math.hypot(ux, uz);
      }
      if (len < 1e-6) {
        ux = 1;
        uz = 0;
        len = 1;
      }
      ux /= len;
      uz /= len;
      const vx = -uz;
      const vz = ux;
      // Extent of the projected box along u and v: the sum of each column's
      // projection, which is exact for a box.
      const eu =
        Math.abs(cxx * ux + cxz * uz) + Math.abs(cyx * ux + cyz * uz) + Math.abs(czx * ux + czz * uz);
      const ev =
        Math.abs(cxx * vx + cxz * vz) + Math.abs(cyx * vx + cyz * vz) + Math.abs(czx * vx + czz * vz);
      out[0] = SHAPE_BOX + flags;
      out[1] = cx;
      out[2] = cz;
      out[4] = ux;
      out[5] = uz;
      out[6] = Math.max(eu, 1e-3);
      out[7] = Math.max(ev, 1e-3);
      out[8] = cy - yExtent;
      out[9] = cy + yExtent;
    }
  }
  /** World XZ of the footprint's centre, where the surface under it is read. @internal */
  _centre(fp: Float32Array, out: Float32Array, offset: number) {
    if (fp[0] % BLOCKING_FLAG === SHAPE_CAPSULE) {
      out[offset] = (fp[1] + fp[4]) * 0.5;
      out[offset + 1] = (fp[2] + fp[5]) * 0.5;
    } else {
      out[offset] = fp[1];
      out[offset + 1] = fp[2];
    }
  }
}

/** A queued surface disturbance, in world units. @internal */
interface PendingImpulse {
  x: number;
  z: number;
  radius: number;
  strength: number;
}

/**
 * Declare the footprint functions the simulation shaders share.
 *
 * `wiFootprint(a, b, c, s, wp)` is the displaced column at world XZ `wp`, in
 * metres of surface height, with the surface under the shape at `s` over the
 * still water: the shape's amplitude times a dome over its footprint, so a
 * moving shape's frame-to-frame difference is smooth. The amplitude is the
 * strength times how much of the shape's height is under that surface, faded
 * back out as the whole shape sinks further than its own height below it; a
 * sphere's footprint is the circle the surface cuts from it. Measured against
 * the surface the shape floats on rather than the still water, so a hull riding
 * the swell does not pump rings into the field with every wave.
 * `wiFootprintHard` is the footprint as a 0/1 mask, for the obstacle map. Both
 * decode the packed layout {@link WaterDisturber._evaluate} writes.
 * @internal
 */
function declareFootprintFunctions(pb: ProgramBuilder) {
  pb.func(
    'wiShapeMask',
    [pb.vec4('a'), pb.vec4('b'), pb.vec4('c'), pb.float('s'), pb.vec2('wp'), pb.bool('hard')],
    function () {
      this.$l.t = pb.sub(
        this.a.x,
        pb.select(pb.float(BLOCKING_FLAG), pb.float(0), pb.greaterThanEqual(this.a.x, BLOCKING_FLAG))
      );
      this.$l.m = pb.float(0);
      this.$if(pb.lessThan(this.t, SHAPE_SPHERE + 0.5), function () {
        this.$l.dv = pb.sub(this.wp, this.a.yz);
        this.$l.d2 = pb.dot(this.dv, this.dv);
        // Radius of the circle the surface cuts from the sphere
        this.$l.dy = pb.sub(this.c.z, this.s);
        this.$l.r = this.b.x;
        this.$l.rEff = pb.select(
          pb.sqrt(pb.max(0, pb.sub(pb.mul(this.r, this.r), pb.mul(this.dy, this.dy)))),
          this.r,
          pb.lessThanEqual(this.dy, pb.neg(this.r))
        );
        this.$l.r2 = pb.mul(this.rEff, this.rEff);
        this.$if(pb.greaterThan(this.r2, 0), function () {
          this.m = pb.select(
            pb.max(0, pb.sub(1, pb.div(this.d2, this.r2))),
            pb.select(pb.float(0), pb.float(1), pb.lessThan(this.d2, this.r2)),
            this.hard
          );
        });
      })
        .$elseif(pb.lessThan(this.t, SHAPE_CAPSULE + 0.5), function () {
          this.$l.ab = pb.sub(this.b.xy, this.a.yz);
          this.$l.ap = pb.sub(this.wp, this.a.yz);
          this.$l.s = pb.clamp(
            pb.div(pb.dot(this.ap, this.ab), pb.max(pb.dot(this.ab, this.ab), 1e-6)),
            0,
            1
          );
          this.$l.dv = pb.sub(this.ap, pb.mul(this.ab, this.s));
          this.$l.d2 = pb.dot(this.dv, this.dv);
          this.$l.r2 = pb.mul(this.b.z, this.b.z);
          this.m = pb.select(
            pb.max(0, pb.sub(1, pb.div(this.d2, this.r2))),
            pb.select(pb.float(0), pb.float(1), pb.lessThan(this.d2, this.r2)),
            this.hard
          );
        })
        .$else(function () {
          this.$l.dv = pb.sub(this.wp, this.a.yz);
          this.$l.u = this.b.xy;
          this.$l.v = pb.vec2(pb.neg(this.u.y), this.u.x);
          this.$l.du = pb.div(pb.abs(pb.dot(this.dv, this.u)), this.b.z);
          this.$l.dw = pb.div(pb.abs(pb.dot(this.dv, this.v)), this.b.w);
          this.$l.mx = pb.max(this.du, this.dw);
          this.m = pb.select(
            pb.sub(1, pb.smoothStep(0.75, 1, this.mx)),
            pb.select(pb.float(0), pb.float(1), pb.lessThan(this.mx, 1)),
            this.hard
          );
        });
      this.$return(this.m);
    }
  );
  pb.func(
    'wiFootprint',
    [pb.vec4('a'), pb.vec4('b'), pb.vec4('c'), pb.float('s'), pb.vec2('wp')],
    function () {
      this.$l.height = pb.max(pb.sub(this.c.y, this.c.x), 1e-4);
      this.$l.depth = pb.clamp(pb.div(pb.sub(this.s, this.c.x), this.height), 0, 1);
      this.$l.deep = pb.clamp(pb.sub(1, pb.div(pb.sub(this.s, this.c.y), this.height)), 0, 1);
      this.$return(
        pb.mul(
          this.c.w,
          this.depth,
          this.deep,
          this.wiShapeMask(this.a, this.b, this.c, this.s, this.wp, false)
        )
      );
    }
  );
  pb.func(
    'wiFootprintHard',
    [pb.vec4('a'), pb.vec4('b'), pb.vec4('c'), pb.float('s'), pb.vec2('wp')],
    function () {
      this.$return(this.wiShapeMask(this.a, this.b, this.c, this.s, this.wp, true));
    }
  );
}

/**
 * Shader that advances the interaction field by one step: scrolls the window,
 * integrates the wave equation with the sponge band and obstacles, and injects
 * the queued impulses and the disturbers' displacement change.
 * @internal
 */
export function createWaterInteractionStepShader(): PBRenderOptions {
  return {
    vertex(pb) {
      this.$inputs.pos = pb.vec2().attrib('position');
      pb.main(function () {
        this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
      });
    },
    fragment(pb) {
      this.$outputs.outColor = pb.vec4();
      this.srcTex = pb.tex2D().uniform(0);
      this.obstacleTex = pb.tex2D().uniform(0);
      this.stepParams = pb.vec4().uniform(0);
      this.foamParams = pb.vec4().uniform(0);
      this.worldParams = pb.vec4().uniform(0);
      this.resolution = pb.int().uniform(0);
      this.shift = pb.vec2().uniform(0);
      this.numImpulses = pb.int().uniform(0);
      this.impulses = pb.vec4[MAX_IMPULSES]().uniform(0);
      this.numDisturbers = pb.int().uniform(0);
      this.disturbers = pb.vec4[MAX_DISTURBERS * DISTURBER_VEC4S]().uniform(0);
      // Height of the ambient surface over the still water under each
      // disturber, at this step and at the last
      this.surfNow = pb.tex2D().uniform(0);
      this.surfPrev = pb.tex2D().uniform(0);
      // Water depth for the wave speed, see WaterInteraction.setBathymetry:
      // (origin x, origin z, 1 / size x, 1 / size z),
      // (source: 0 none / 1 distance field / 2 height map, water level, height scale, height offset),
      // (shallow depth, absorb depth, 0, 0)
      this.bathyTex = pb.tex2D().uniform(0);
      this.bathyParams = pb.vec4().uniform(0);
      this.bathyParams2 = pb.vec4().uniform(0);
      this.shoreParams = pb.vec4().uniform(0);
      declareFootprintFunctions(pb);
      // Depth of water at a world XZ, a large value where nothing is known
      pb.func('wiDepth', [pb.vec2('xz')], function () {
        this.$l.uv = pb.mul(pb.sub(this.xz, this.bathyParams.xy), this.bathyParams.zw);
        this.$if(
          pb.or(
            pb.lessThan(this.bathyParams2.x, 0.5),
            pb.or(pb.any(pb.lessThan(this.uv, pb.vec2(0))), pb.any(pb.greaterThan(this.uv, pb.vec2(1))))
          ),
          function () {
            this.$return(pb.float(1e4));
          }
        );
        this.$l.t = pb.textureSampleLevel(this.bathyTex, this.uv, 0);
        // The distance field at the rest level is the distance to the bed below
        // it: the depth on a gently shelving bed, a little under on a steep one
        this.$if(pb.lessThan(this.bathyParams2.x, 1.5), function () {
          this.$return(this.t.w);
        });
        this.$return(
          pb.sub(this.bathyParams2.y, pb.add(pb.mul(this.t.x, this.bathyParams2.z), this.bathyParams2.w))
        );
      });
      // Squared wave speed relative to the configured one: 1 in water deeper
      // than the shallow depth, falling with the depth below it, as c = sqrt(g h)
      pb.func('wiSpeed2', [pb.float('depth')], function () {
        this.$if(pb.lessThan(this.bathyParams2.x, 0.5), function () {
          this.$return(pb.float(1));
        });
        this.$return(pb.clamp(pb.div(this.depth, pb.max(this.shoreParams.x, 1e-3)), 0, 1));
      });
      pb.func('wiInside', [pb.ivec2('c')], function () {
        this.$return(
          pb.and(
            pb.all(pb.greaterThanEqual(this.c, pb.ivec2(0))),
            pb.all(pb.lessThan(this.c, pb.ivec2(this.resolution)))
          )
        );
      });
      pb.func('wiFetch', [pb.ivec2('c'), pb.float('fallback')], function () {
        this.$if(this.wiInside(this.c), function () {
          this.$return(pb.textureLoad(this.srcTex, this.c, 0).x);
        }).$else(function () {
          this.$return(this.fallback);
        });
      });
      // An obstacle texel, in the window's new placement. Outside the window
      // counts as one so that the edge and an obstacle get the same treatment.
      pb.func('wiObstacle', [pb.ivec2('c')], function () {
        this.$if(this.wiInside(this.c), function () {
          this.$return(pb.greaterThan(pb.textureLoad(this.obstacleTex, this.c, 0).x, 0.5));
        }).$else(function () {
          this.$return(true);
        });
      });
      // A neighbour's height: `cur` when it is an obstacle (Neumann, so the
      // wave reflects), else its own value from the field before the shift.
      pb.func('wiNeighbour', [pb.ivec2('pn'), pb.ivec2('qn'), pb.float('cur')], function () {
        this.$if(this.wiObstacle(this.pn), function () {
          this.$return(this.cur);
        }).$else(function () {
          this.$return(this.wiFetch(this.qn, this.cur));
        });
      });
      pb.main(function () {
        this.$l.p = pb.ivec2(this.$builtins.fragCoord.xy);
        // Where this texel was in the field before the window moved. Texels
        // that scrolled in from outside read as still water.
        this.$l.q = pb.add(this.p, pb.ivec2(this.shift));
        this.$l.cur = pb.float(0);
        this.$l.prev = pb.float(0);
        this.$l.foam = pb.float(0);
        this.$if(this.wiInside(this.q), function () {
          this.$l.s = pb.textureLoad(this.srcTex, this.q, 0).xyz;
          this.cur = this.s.x;
          this.prev = this.s.y;
          this.foam = this.s.z;
        });
        this.$l.l = this.wiNeighbour(
          pb.add(this.p, pb.ivec2(-1, 0)),
          pb.add(this.q, pb.ivec2(-1, 0)),
          this.cur
        );
        this.$l.r = this.wiNeighbour(
          pb.add(this.p, pb.ivec2(1, 0)),
          pb.add(this.q, pb.ivec2(1, 0)),
          this.cur
        );
        this.$l.d = this.wiNeighbour(
          pb.add(this.p, pb.ivec2(0, -1)),
          pb.add(this.q, pb.ivec2(0, -1)),
          this.cur
        );
        this.$l.u = this.wiNeighbour(
          pb.add(this.p, pb.ivec2(0, 1)),
          pb.add(this.q, pb.ivec2(0, 1)),
          this.cur
        );
        // Flux form of div(c^2 grad h): each face carries the mean of the
        // speeds either side, so a wave crossing into shallower water slows
        // and steepens without gaining or losing energy at the change. With
        // no depth every speed is 1 and this is the plain Laplacian.
        this.$l.texelW = this.worldParams.z;
        this.$l.wpc = pb.add(this.worldParams.xy, pb.mul(pb.add(pb.vec2(this.p), pb.vec2(0.5)), this.texelW));
        this.$l.depthC = this.wiDepth(this.wpc);
        this.$l.sC = this.wiSpeed2(this.depthC);
        this.$l.sL = this.wiSpeed2(this.wiDepth(pb.sub(this.wpc, pb.vec2(this.texelW, 0))));
        this.$l.sR = this.wiSpeed2(this.wiDepth(pb.add(this.wpc, pb.vec2(this.texelW, 0))));
        this.$l.sD = this.wiSpeed2(this.wiDepth(pb.sub(this.wpc, pb.vec2(0, this.texelW))));
        this.$l.sU = this.wiSpeed2(this.wiDepth(pb.add(this.wpc, pb.vec2(0, this.texelW))));
        this.$l.lap = pb.mul(
          0.5,
          pb.add(
            pb.mul(pb.add(this.sC, this.sL), pb.sub(this.l, this.cur)),
            pb.mul(pb.add(this.sC, this.sR), pb.sub(this.r, this.cur)),
            pb.mul(pb.add(this.sC, this.sD), pb.sub(this.d, this.cur)),
            pb.mul(pb.add(this.sC, this.sU), pb.sub(this.u, this.cur))
          )
        );
        // Sponge: energy retention falls to zero over a band inside the edge,
        // quadratically so the transition into it is soft.
        this.$l.fres = pb.float(pb.sub(this.resolution, 1));
        this.$l.fp = pb.vec2(this.p);
        this.$l.distX = pb.min(this.fp.x, pb.sub(this.fres, this.fp.x));
        this.$l.distY = pb.min(this.fp.y, pb.sub(this.fres, this.fp.y));
        this.$l.ex = pb.sub(1, pb.smoothStep(0, this.stepParams.z, this.distX));
        this.$l.ey = pb.sub(1, pb.smoothStep(0, this.stepParams.z, this.distY));
        this.$l.e = pb.sub(1, pb.mul(pb.sub(1, this.ex), pb.sub(1, this.ey)));
        this.$l.absorb = pb.clamp(pb.sub(1, pb.mul(this.e, this.e)), 0, 1);
        // The beach is an absorber too: waves die in the last few centimetres
        // instead of reflecting off the waterline as off a wall
        this.$if(pb.greaterThan(this.bathyParams2.x, 0.5), function () {
          this.absorb = pb.mul(this.absorb, pb.smoothStep(0, pb.max(this.shoreParams.y, 1e-3), this.depthC));
        });
        this.$l.retention = pb.mul(this.stepParams.y, this.absorb);
        this.$l.next = pb.add(
          this.cur,
          pb.mul(pb.sub(this.cur, this.prev), this.retention),
          pb.mul(this.stepParams.x, this.lap)
        );
        this.$l.centre = pb.add(this.fp, pb.vec2(0.5));
        // Foam laid down this step, from every source below.
        this.$l.foamIn = pb.float(0);
        this.$for(pb.int('i'), 0, MAX_IMPULSES, function () {
          this.$if(pb.greaterThanEqual(this.i, this.numImpulses), function () {
            this.$break();
          });
          this.$l.imp = this.impulses.at(this.i);
          this.$l.dv = pb.sub(this.centre, this.imp.xy);
          this.$l.r2 = pb.dot(this.dv, this.dv);
          this.$l.rad = this.imp.z;
          this.$if(pb.lessThan(this.r2, pb.mul(this.rad, this.rad)), function () {
            this.$l.sigma = pb.mul(this.rad, 0.4);
            this.$l.g = pb.exp(pb.neg(pb.div(this.r2, pb.mul(2, this.sigma, this.sigma))));
            this.next = pb.add(this.next, pb.mul(this.g, this.imp.w, this.absorb));
            // A stone breaks the surface: a splash of foam over the bump.
            this.foamIn = pb.add(this.foamIn, pb.mul(this.g, pb.abs(this.imp.w), this.foamParams.x));
          });
        });
        this.next = pb.clamp(this.next, pb.neg(this.stepParams.w), this.stepParams.w);
        // Disturbers: what each displaces now against what it displaced at
        // the last step. More column pushes the surface down.
        this.$l.wp = pb.add(this.worldParams.xy, pb.mul(this.centre, this.worldParams.z));
        this.$for(pb.int('j'), 0, MAX_DISTURBERS, function () {
          this.$if(pb.greaterThanEqual(this.j, this.numDisturbers), function () {
            this.$break();
          });
          this.$l.k = pb.mul(this.j, DISTURBER_VEC4S);
          this.$l.sNow = pb.textureLoad(this.surfNow, pb.ivec2(this.j, 0), 0).x;
          this.$l.aBefore = this.disturbers.at(pb.add(this.k, 3));
          this.$l.sBefore = this.$choice(
            pb.greaterThan(this.aBefore.w, 0.5),
            pb.textureLoad(this.surfPrev, pb.ivec2(this.j, 0), 0).x,
            this.sNow
          );
          this.$l.now = this.wiFootprint(
            this.disturbers.at(this.k),
            this.disturbers.at(pb.add(this.k, 1)),
            this.disturbers.at(pb.add(this.k, 2)),
            this.sNow,
            this.wp
          );
          this.$l.before = this.wiFootprint(
            this.aBefore,
            this.disturbers.at(pb.add(this.k, 4)),
            this.disturbers.at(pb.add(this.k, 5)),
            this.sBefore,
            this.wp
          );
          // The change also churns the surface, which is where the trail comes from.
          this.$l.change = pb.sub(this.now, this.before);
          this.next = pb.sub(this.next, pb.mul(this.change, this.absorb));
          this.foamIn = pb.add(this.foamIn, pb.mul(pb.abs(this.change), this.foamParams.y));
        });
        // Foam is also thrown where the field itself is steep and moving fast:
        // the crest of a wake, not the whole wake. Then the whole lot decays.
        this.$l.slope = pb.max(pb.abs(pb.sub(this.r, this.l)), pb.abs(pb.sub(this.u, this.d)));
        this.$l.velocity = pb.abs(pb.sub(this.next, this.cur));
        this.$l.churn = pb.mul(this.slope, this.velocity, 1000);
        this.foamIn = pb.add(
          this.foamIn,
          pb.mul(
            pb.smoothStep(this.foamParams.w, pb.mul(this.foamParams.w, 3), this.churn),
            this.foamParams.x,
            0.02
          )
        );
        this.$l.foamNext = pb.clamp(
          pb.add(pb.mul(this.foam, this.foamParams.z), pb.mul(this.foamIn, this.absorb)),
          0,
          1
        );
        this.next = pb.clamp(this.next, pb.neg(this.stepParams.w), this.stepParams.w);
        // Inside an obstacle, or on dry land, there is no water to move.
        this.$if(pb.or(this.wiObstacle(this.p), pb.lessThanEqual(this.depthC, 0)), function () {
          this.next = pb.float(0);
          this.cur = pb.float(0);
          this.foamNext = pb.float(0);
        });
        this.$outputs.outColor = pb.vec4(this.next, this.cur, this.foamNext, 1);
      });
    }
  };
}

/**
 * Shader that reads the ambient surface under each disturber: texel i of a
 * row holds the height over the still water of the surface `generator` draws,
 * at the centre of the disturber in slot i, displaced as the water's vertices
 * are.
 * @internal
 */
export function createWaterInteractionSurfaceShader(generator: WaveGenerator): PBRenderOptions {
  return {
    vertex(pb) {
      this.$inputs.pos = pb.vec2().attrib('position');
      pb.main(function () {
        this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
      });
    },
    fragment(pb) {
      this.$outputs.outColor = pb.vec4();
      generator.setupUniforms(this, 0);
      // FBM and Gerstner animate from camera.elapsedTime, which a standalone
      // program has to declare itself
      ShaderHelper.declareStandaloneCameraTime(this, 0);
      // (still water level, slots in use, 0, 0)
      this.wiSurfParams = pb.vec4().uniform(0);
      this.wiSurfCentres = pb.vec4[MAX_DISTURBERS]().uniform(0);
      pb.main(function () {
        this.$l.slot = pb.int(this.$builtins.fragCoord.x);
        this.$l.height = pb.float(0);
        this.$if(pb.lessThan(this.slot, pb.int(this.wiSurfParams.y)), function () {
          this.$l.centre = this.wiSurfCentres.at(this.slot);
          this.$l.inPos = pb.vec3(this.centre.x, this.wiSurfParams.x, this.centre.y);
          this.$l.outPos = pb.vec3(0);
          this.$l.outNormal = pb.vec3(0, 1, 0);
          generator.calcVertexPositionAndNormal(this, this.inPos, this.outPos, this.outNormal);
          this.height = pb.sub(this.outPos.y, this.wiSurfParams.x);
        });
        this.$outputs.outColor = pb.vec4(this.height, 0, 0, 1);
      });
    }
  };
}

/**
 * Shader that paints the blocking disturbers' footprints into the obstacle
 * mask, in the window's current placement.
 * @internal
 */
export function createWaterInteractionObstacleShader(): PBRenderOptions {
  return {
    vertex(pb) {
      this.$inputs.pos = pb.vec2().attrib('position');
      pb.main(function () {
        this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
      });
    },
    fragment(pb) {
      this.$outputs.outColor = pb.vec4();
      this.worldParams = pb.vec4().uniform(0);
      this.numDisturbers = pb.int().uniform(0);
      this.disturbers = pb.vec4[MAX_DISTURBERS * DISTURBER_VEC4S]().uniform(0);
      this.surfNow = pb.tex2D().uniform(0);
      declareFootprintFunctions(pb);
      pb.main(function () {
        this.$l.centre = pb.add(pb.floor(this.$builtins.fragCoord.xy), pb.vec2(0.5));
        this.$l.wp = pb.add(this.worldParams.xy, pb.mul(this.centre, this.worldParams.z));
        this.$l.mask = pb.float(0);
        this.$for(pb.int('j'), 0, MAX_DISTURBERS, function () {
          this.$if(pb.greaterThanEqual(this.j, this.numDisturbers), function () {
            this.$break();
          });
          this.$l.k = pb.mul(this.j, DISTURBER_VEC4S);
          this.$l.a = this.disturbers.at(this.k);
          this.$if(pb.greaterThanEqual(this.a.x, BLOCKING_FLAG), function () {
            this.mask = pb.max(
              this.mask,
              this.wiFootprintHard(
                this.a,
                this.disturbers.at(pb.add(this.k, 1)),
                this.disturbers.at(pb.add(this.k, 2)),
                pb.textureLoad(this.surfNow, pb.ivec2(this.j, 0), 0).x,
                this.wp
              )
            );
          });
        });
        this.$outputs.outColor = pb.vec4(this.mask, 0, 0, 1);
      });
    }
  };
}

/**
 * Where a {@link WaterInteraction} reads the depth of the water from.
 *
 * - `field`: a texture whose w channel is the signed distance from the water
 *   level down to the bed, as the scene SDF's waterline field holds.
 * - `height`: a height map, the bed at `r * heightScale + heightOffset`.
 *
 * @internal
 */
export interface WaterBathymetry {
  kind: 'field' | 'height';
  texture: Texture2D;
  /** World rectangle the texture covers: min x, min z, size x, size z. */
  region: [number, number, number, number];
  /** World Y of the water at rest. */
  level: number;
  heightScale?: number;
  heightOffset?: number;
}

/**
 * A local, dynamic height field layered on top of a water surface, driven by
 * things that touch it: a ring spreading from a dropped stone, the wake behind
 * a hull. It is a 2D wave equation integrated on a square window of texels
 * aligned to the world; the water material adds its height and slope to the
 * wave generator's surface, so the ambient sea and the disturbances compose.
 *
 * The window follows a focus point - the camera by default - and covers
 * {@link windowSize} metres at {@link resolution} texels. Its origin is snapped
 * to the texel grid, so moving it is an integer shift of the field rather than
 * a resample. What scrolls in is still water.
 *
 * The scheme is explicit and needs `waveSpeed * dt / texel` to stay under the
 * CFL bound; {@link waveSpeed} is clamped to what the current window allows. A
 * sponge band inside the window's edge absorbs outgoing waves so they do not
 * reflect off the window boundary.
 *
 * Attach it with {@link Water.interaction}. Steps run in {@link Water.update}
 * on the water's own clock, so pausing the water pauses this too.
 *
 * @public
 */
export class WaterInteraction extends Disposable {
  private _resolution: number;
  private _windowSize: number;
  private _waveSpeed: number;
  private _damping: number;
  private _maxAmplitude: number;
  private _foamAmount: number;
  private _foamDecay: number;
  private _foamThreshold: number;
  private readonly _foamParams: Vector4;
  private _spongeWidth: number;
  private _followMode: WaterInteractionFollowMode;
  private _followNode: Nullable<SceneNode>;
  private _followNodeId: string;
  private readonly _center: Vector2;
  private readonly _focus: Vector2;
  private readonly _impulses: PendingImpulse[];
  private _textures: Nullable<[Texture2D, Texture2D]>;
  private _framebuffers: Nullable<[FrameBuffer, FrameBuffer]>;
  // Independent history: impulses only, so rendered wakes cannot feed buoyancy.
  private _externalTextures: Nullable<[Texture2D, Texture2D]> = null;
  private _externalFramebuffers: Nullable<[FrameBuffer, FrameBuffer]> = null;
  private _current: number;
  private _originX: number;
  private _originZ: number;
  private _hasOrigin: boolean;
  private _accumulator: number;
  private _lastTime: number;
  private _version: number;
  private _program: Nullable<GPUProgram>;
  private _bindGroup: Nullable<BindGroup>;
  private _format: Nullable<TextureFormat>;
  private _formatResolved: boolean;
  private readonly _impulseData: Float32Array<ArrayBuffer>;
  private readonly _disturbers: WaterDisturber[];
  private readonly _disturberData: Float32Array<ArrayBuffer>;
  private _waterLevel: number;
  private _obstacleTexture: Nullable<Texture2D>;
  private _obstacleFramebuffer: Nullable<FrameBuffer>;
  private _obstacleProgram: Nullable<GPUProgram>;
  private _obstacleBindGroup: Nullable<BindGroup>;
  private readonly _worldParams: Vector4;
  private readonly _stepParams: Vector4;
  private readonly _shift: Vector2;
  private readonly _sampleParams: Vector4;
  private readonly _sampleParams2: Vector4;
  private _shallowDepth: number;
  private _shoreAbsorbDepth: number;
  private _bathymetry: Nullable<WaterBathymetry>;
  private readonly _bathyParams: Vector4;
  private readonly _bathyParams2: Vector4;
  private readonly _shoreParams: Vector4;
  private _dummyBathyTexture: Nullable<Texture2D>;
  /** The surface the field is layered over, which the disturbers float on; null for still water. */
  private _ambient: Nullable<WaveGenerator>;
  /** Ambient surface height under each disturber slot, this step's and the last. */
  private _surfTextures: Nullable<[Texture2D, Texture2D]>;
  private _surfFramebuffers: Nullable<[FrameBuffer, FrameBuffer]>;
  private _surfCurrent: number;
  private _surfProgram: Nullable<GPUProgram>;
  private _surfBindGroup: Nullable<BindGroup>;
  private _surfHash: string;
  /** (centre x, centre z, 0, 0) per disturber slot */
  private readonly _surfCentres: Float32Array<ArrayBuffer>;
  /** (still water level, slots in use, 0, 0) */
  private readonly _surfParams: Vector4;
  /**
   * Creates a water interaction field.
   */
  constructor() {
    super();
    this._resolution = 512;
    this._windowSize = 64;
    this._waveSpeed = 1.5;
    this._damping = 1;
    this._maxAmplitude = 0.5;
    this._foamAmount = 0.15;
    this._foamDecay = 0.6;
    this._foamThreshold = 0.02;
    this._foamParams = new Vector4();
    this._spongeWidth = 0.1;
    this._followMode = 'camera';
    this._followNode = null;
    this._followNodeId = '';
    this._center = new Vector2(0, 0);
    this._focus = new Vector2(0, 0);
    this._impulses = [];
    this._textures = null;
    this._framebuffers = null;
    this._current = 0;
    this._originX = 0;
    this._originZ = 0;
    this._hasOrigin = false;
    this._accumulator = 0;
    this._lastTime = -1;
    this._version = 0;
    this._program = null;
    this._bindGroup = null;
    this._format = null;
    this._formatResolved = false;
    this._impulseData = new Float32Array(MAX_IMPULSES * 4);
    this._disturbers = [];
    this._disturberData = new Float32Array(MAX_DISTURBERS * DISTURBER_STRIDE);
    this._waterLevel = 0;
    this._obstacleTexture = null;
    this._obstacleFramebuffer = null;
    this._obstacleProgram = null;
    this._obstacleBindGroup = null;
    this._worldParams = new Vector4();
    this._stepParams = new Vector4();
    this._shift = new Vector2();
    this._sampleParams = new Vector4();
    this._sampleParams2 = new Vector4();
    this._shallowDepth = 2;
    this._shoreAbsorbDepth = 0.2;
    this._bathymetry = null;
    this._bathyParams = new Vector4();
    this._bathyParams2 = new Vector4();
    this._shoreParams = new Vector4();
    this._dummyBathyTexture = null;
    this._ambient = null;
    this._surfTextures = null;
    this._surfFramebuffers = null;
    this._surfCurrent = 0;
    this._surfProgram = null;
    this._surfBindGroup = null;
    this._surfHash = '';
    this._surfCentres = new Float32Array(MAX_DISTURBERS * 4);
    this._surfParams = new Vector4();
  }
  protected onDispose() {
    super.onDispose();
    this._disposeField();
    this._bindGroup?.dispose();
    this._bindGroup = null;
    this._program?.dispose();
    this._program = null;
    this._obstacleBindGroup?.dispose();
    this._obstacleBindGroup = null;
    this._obstacleProgram?.dispose();
    this._obstacleProgram = null;
    this._surfBindGroup?.dispose();
    this._surfBindGroup = null;
    this._surfProgram?.dispose();
    this._surfProgram = null;
    this._ambient = null;
    this._dummyBathyTexture?.dispose();
    this._dummyBathyTexture = null;
    this._bathymetry = null;
    this._disturbers.length = 0;
    this._followNode = null;
  }
  /**
   * Bumped whenever the bound texture or uniforms change, so a material knows to
   * rebind. Every simulation step swaps the ping-pong textures, so this moves
   * every step.
   * @internal
   */
  get version() {
    return this._version;
  }
  /**
   * Texels along each side of the window. The texel size in metres is
   * {@link windowSize} over this.
   *
   * Changing it discards the field.
   */
  get resolution() {
    return this._resolution;
  }
  set resolution(val: number) {
    val = Math.max(16, Math.floor(val));
    if (val !== this._resolution) {
      this._resolution = val;
      this._disposeField();
      this._clampWaveSpeed();
    }
  }
  /**
   * Side of the window in metres.
   *
   * Changing it discards the field.
   */
  get windowSize() {
    return this._windowSize;
  }
  set windowSize(val: number) {
    val = Math.max(1, val);
    if (val !== this._windowSize) {
      this._windowSize = val;
      this._disposeField();
      this._clampWaveSpeed();
    }
  }
  /** Size of one texel in metres. */
  get texelSize() {
    return this._windowSize / this._resolution;
  }
  /**
   * Speed disturbances spread at, in metres per second.
   *
   * Capillary ripples run at well under a metre per second, a boat's wake at a
   * few. Clamped to what the explicit scheme can integrate stably on the current
   * texel size: raising {@link resolution} or shrinking {@link windowSize}
   * lowers that ceiling.
   */
  get waveSpeed() {
    return this._waveSpeed;
  }
  set waveSpeed(val: number) {
    this._waveSpeed = Math.max(0, val);
    this._clampWaveSpeed();
  }
  /** Highest wave speed the current window can integrate stably, in metres per second. */
  get maxWaveSpeed() {
    return (MAX_COURANT * this.texelSize) / FIXED_STEP;
  }
  /**
   * Rate the field loses energy at, in 1/s. 0 keeps ripples going until they
   * leave the window; a few damps them within a second or two.
   */
  get damping() {
    return this._damping;
  }
  set damping(val: number) {
    this._damping = Math.max(0, val);
  }
  /**
   * How much foam a disturbance throws, 0 to disable the foam trail. Defaults
   * to 0.15: at 1 a wake reads as solid white.
   *
   * Foam is laid down where something moves through the water, where a stone
   * lands and along the steep, fast crests of the field's own waves, and
   * fades at {@link foamDecay}.
   */
  get foamAmount() {
    return this._foamAmount;
  }
  set foamAmount(val: number) {
    this._foamAmount = Math.max(0, val);
  }
  /** Rate the foam trail fades at, in 1/s. */
  get foamDecay() {
    return this._foamDecay;
  }
  set foamDecay(val: number) {
    this._foamDecay = Math.max(0, val);
  }
  /**
   * How steep and fast a wave of the field has to be before it foams on its
   * own. Lower foams more of the wake; higher keeps foam to what is directly
   * disturbed.
   */
  get foamThreshold() {
    return this._foamThreshold;
  }
  set foamThreshold(val: number) {
    this._foamThreshold = Math.max(0.0001, val);
  }
  /**
   * Height in metres the field is clamped to, either side of the rest level.
   *
   * Also what the water's bounding volume is grown by, so keep it to what the
   * disturbances actually reach.
   */
  get maxAmplitude() {
    return this._maxAmplitude;
  }
  set maxAmplitude(val: number) {
    this._maxAmplitude = Math.max(0.001, val);
  }
  /**
   * Width of the absorbing band inside the window edge, as a fraction of the
   * window. Waves reaching it die away instead of reflecting; the material also
   * fades the field out over it so the window has no visible edge.
   */
  get spongeWidth() {
    return this._spongeWidth;
  }
  set spongeWidth(val: number) {
    this._spongeWidth = Math.min(0.45, Math.max(0.01, val));
  }
  /**
   * Depth in metres below which waves slow down, as shallow water waves do:
   * the speed is {@link waveSpeed} in deeper water and falls with the square
   * root of the depth below this. A wave running onto a beach then slows,
   * shortens, grows and turns to meet the shore. 0 ignores the depth. Needs a
   * depth source, which the water sets each frame: the scene signed distance
   * field where enabled, else the terrain.
   */
  get shallowDepth() {
    return this._shallowDepth;
  }
  set shallowDepth(val: number) {
    this._shallowDepth = Math.max(0, val);
  }
  /** Depth in metres over which the beach absorbs the waves reaching it instead of reflecting them. */
  get shoreAbsorbDepth() {
    return this._shoreAbsorbDepth;
  }
  set shoreAbsorbDepth(val: number) {
    this._shoreAbsorbDepth = Math.max(0, val);
  }
  /**
   * Sets where the depth of the water comes from, or null for none (constant
   * speed). Set by the water each frame.
   * @internal
   */
  setBathymetry(source: Nullable<WaterBathymetry>) {
    this._bathymetry = source;
  }
  /** How the window is positioned. See {@link WaterInteractionFollowMode}. */
  get followMode() {
    return this._followMode;
  }
  set followMode(val: WaterInteractionFollowMode) {
    this._followMode = val;
  }
  /** Node the window follows while {@link followMode} is `node`. */
  get followNode() {
    return this._followNode;
  }
  set followNode(val: Nullable<SceneNode>) {
    this._followNode = val;
  }
  /**
   * Persistent id of {@link followNode}, for a field loaded from a scene before
   * the node exists. Resolved against the water's scene on the next update;
   * {@link followNode} wins when both are set.
   */
  get followNodeId() {
    return this._followNodeId;
  }
  set followNodeId(val: string) {
    this._followNodeId = val ?? '';
  }
  /**
   * Bind any node ids left by deserialization to the nodes of `scene`. Called
   * by the water node before each update; cheap once everything is bound.
   * @internal
   */
  resolveNodes(scene: Nullable<Scene>) {
    if (!scene) {
      return;
    }
    if (!this._followNode && this._followNodeId) {
      this._followNode = scene.findNodeById(this._followNodeId) ?? null;
    }
    for (const d of this._disturbers) {
      if (!d.node && d.nodeId) {
        d.node = scene.findNodeById(d.nodeId) ?? null;
      }
    }
  }
  /** World XZ the window is centred on while {@link followMode} is `fixed`. */
  get center() {
    return this._center;
  }
  set center(val: Vector2) {
    this._center.set(val);
  }
  /** World X of the window's low corner, as of the last step. */
  get originX() {
    return this._originX;
  }
  /** World Z of the window's low corner, as of the last step. */
  get originZ() {
    return this._originZ;
  }
  /**
   * Tell the field where the camera is. Called by the water node each time it
   * is updated for a camera; only used while {@link followMode} is `camera`.
   * @internal
   */
  setFocus(x: number, z: number) {
    this._focus.setXY(x, z);
  }
  /**
   * Push the surface down (or up) at a point, once.
   *
   * The disturbance is a Gaussian bump added to the field on the next step,
   * so a stone hitting the water is one call, and something dragging through
   * it is a call per frame. Calls beyond what one step can take are carried
   * over to the following step.
   *
   * @param x - World X.
   * @param z - World Z.
   * @param radius - Radius of the bump in metres.
   * @param strength - Peak height of the bump in metres. Negative pushes the
   * surface down, which is what an object entering the water does.
   */
  addImpulse(x: number, z: number, radius: number, strength: number) {
    this._impulses.push({ x, z, radius: Math.max(radius, this.texelSize), strength });
  }
  /** The disturbers registered with this field. */
  get disturbers(): readonly WaterDisturber[] {
    return this._disturbers;
  }
  /**
   * Register a disturber. Beyond MAX_DISTURBERS enabled disturbers the
   * extra ones are ignored, earliest registered first.
   */
  addDisturber(disturber: WaterDisturber) {
    if (this._disturbers.indexOf(disturber) < 0) {
      disturber._hasPrev = false;
      this._disturbers.push(disturber);
    }
  }
  /** Unregister a disturber. */
  removeDisturber(disturber: WaterDisturber) {
    const i = this._disturbers.indexOf(disturber);
    if (i >= 0) {
      this._disturbers.splice(i, 1);
    }
  }
  /**
   * Tell the field where the still-water surface is. Called by the water node
   * before each update.
   * @internal
   */
  setWaterLevel(y: number) {
    this._waterLevel = y;
  }
  /**
   * Tell the field what surface it is layered over: the ambient waves the
   * disturbers float on, whose height under each of them sets how deep it
   * sits. Called by the water material whenever it rebuilds its waves; null
   * for still water.
   * @internal
   */
  setAmbientSurface(generator: Nullable<WaveGenerator>) {
    this._ambient = generator;
  }
  /**
   * Whether the device can host the field: it needs a filterable float or
   * half-float render target.
   */
  isOk(device?: AbstractDevice) {
    return !!this._resolveFormat(device ?? getDevice());
  }
  /**
   * Advance the field to `time`, the water's wave clock in seconds.
   *
   * Runs as many fixed steps as the elapsed time covers, up to a cap; the
   * window is moved and queued impulses are injected on the first step of a
   * frame. Nothing is done for a frame too short to reach a step.
   * @internal
   */
  update(time: number) {
    const device = getDevice();
    if (!this._resolveFormat(device)) {
      return;
    }
    const dt = this._lastTime < 0 ? 0 : Math.min(MAX_FRAME_DELTA, Math.max(0, time - this._lastTime));
    this._lastTime = time;
    this._accumulator += dt;
    let steps = Math.floor(this._accumulator / FIXED_STEP);
    if (steps > MAX_SUBSTEPS) {
      steps = MAX_SUBSTEPS;
      this._accumulator = 0;
    } else {
      this._accumulator -= steps * FIXED_STEP;
    }
    // The textures have to exist before anything binds them this frame, step
    // or no step: creating them means a framebuffer clear, which is not
    // something to do from inside a draw.
    this._ensureField(device);
    if (steps === 0) {
      return;
    }
    this._moveWindow();
    const texel = this.texelSize;
    const k = (this._waveSpeed * FIXED_STEP) / texel;
    const retention = Math.max(0, 1 - this._damping * FIXED_STEP);
    this._stepParams.setXYZW(k * k, retention, this._spongeWidth * this._resolution, this._maxAmplitude);
    // Foam: (splash gain, churn gain per metre of displacement change,
    // per-step retention, self-foaming threshold).
    this._foamParams.setXYZW(
      this._foamAmount * 2,
      this._foamAmount * 8,
      Math.exp(-this._foamDecay * FIXED_STEP),
      this._foamThreshold
    );
    const numImpulses = Math.min(this._impulses.length, MAX_IMPULSES);
    for (let i = 0; i < numImpulses; i++) {
      const imp = this._impulses[i];
      this._impulseData[i * 4 + 0] = (imp.x - this._originX) / texel;
      this._impulseData[i * 4 + 1] = (imp.z - this._originZ) / texel;
      this._impulseData[i * 4 + 2] = imp.radius / texel;
      this._impulseData[i * 4 + 3] = imp.strength;
    }
    this._impulses.splice(0, numImpulses);
    // Disturbers: the current footprint against the one from the last step.
    // A newly registered one starts with no previous footprint, so it does not
    // slap the water on its first frame.
    const numDisturbers = this._gatherDisturbers();
    this._worldParams.setXYZW(this._originX, this._originZ, texel, 0);
    device.pushDeviceStates();
    this._renderSurface(device, numDisturbers);
    this._renderObstacles(device, numDisturbers);
    const program = this._getProgram(device);
    const bindGroup = this._bindGroup!;
    const nearest = fetchSampler('clamp_nearest_nomip');
    bindGroup.setValue('stepParams', this._stepParams);
    bindGroup.setValue('foamParams', this._foamParams);
    bindGroup.setValue('worldParams', this._worldParams);
    bindGroup.setValue('resolution', this._resolution);
    bindGroup.setTexture('obstacleTex', this._obstacleTexture!, nearest);
    bindGroup.setTexture('surfNow', this._surfTextures![this._surfCurrent], nearest);
    bindGroup.setTexture('surfPrev', this._surfTextures![1 - this._surfCurrent], nearest);
    const bathy = this._shallowDepth > 0 ? this._bathymetry : null;
    if (bathy) {
      const [x, z, w, d] = bathy.region;
      this._bathyParams.setXYZW(x, z, 1 / w, 1 / d);
      this._bathyParams2.setXYZW(
        bathy.kind === 'field' ? 1 : 2,
        bathy.level,
        bathy.heightScale ?? 1,
        bathy.heightOffset ?? 0
      );
    } else {
      this._bathyParams.setXYZW(0, 0, 1, 1);
      this._bathyParams2.setXYZW(0, 0, 1, 0);
    }
    this._shoreParams.setXYZW(this._shallowDepth, this._shoreAbsorbDepth, 0, 0);
    bindGroup.setTexture(
      'bathyTex',
      bathy?.texture ?? this._getDummyBathyTexture(device),
      fetchSampler('clamp_linear_nomip')
    );
    bindGroup.setValue('bathyParams', this._bathyParams);
    bindGroup.setValue('bathyParams2', this._bathyParams2);
    bindGroup.setValue('shoreParams', this._shoreParams);
    for (let i = 0; i < steps; i++) {
      const src = this._textures![this._current];
      const dst = this._framebuffers![1 - this._current];
      bindGroup.setTexture('srcTex', src, nearest);
      if (i === 0) {
        bindGroup.setValue('shift', this._shift);
        bindGroup.setValue('numImpulses', numImpulses);
        bindGroup.setValue('impulses', this._impulseData);
        bindGroup.setValue('numDisturbers', numDisturbers);
        bindGroup.setValue('disturbers', this._disturberData);
      } else {
        bindGroup.setValue('shift', ZERO_SHIFT);
        bindGroup.setValue('numImpulses', 0);
        bindGroup.setValue('numDisturbers', 0);
      }
      device.setFramebuffer(dst);
      device.setProgram(program);
      device.setBindGroup(0, bindGroup);
      drawFullscreenQuad();
      // Same clock, window, impulses and obstacles, but no disturber sources.
      bindGroup.setTexture('srcTex', this._externalTextures![this._current], nearest);
      bindGroup.setValue('numDisturbers', 0);
      device.setFramebuffer(this._externalFramebuffers![1 - this._current]);
      device.setBindGroup(0, bindGroup);
      drawFullscreenQuad();
      this._current = 1 - this._current;
    }
    device.popDeviceStates();
    for (const d of this._disturbers) {
      if (d.enabled) {
        d._prev.set(d._now);
        d._hasPrev = true;
      }
    }
    this._version++;
  }
  /**
   * Evaluate every enabled disturber and pack the current and previous
   * footprints for the shaders. Returns how many were packed.
   * @internal
   */
  private _gatherDisturbers() {
    let n = 0;
    for (const d of this._disturbers) {
      if (!d.enabled || !d.node) {
        d._hasPrev = false;
        d._slot = -1;
        continue;
      }
      if (n >= MAX_DISTURBERS) {
        break;
      }
      d._evaluate(this._waterLevel);
      // The surface height read back for this slot at the last step is this
      // disturber's only if it held the same slot then
      const prevSurface = d._hasPrev && d._slot === n;
      d._slot = n;
      if (!d._hasPrev) {
        d._prev.set(d._now);
      }
      const o = n * DISTURBER_STRIDE;
      this._disturberData.set(d._now, o);
      this._disturberData.set(d._prev, o + FOOTPRINT_STRIDE);
      this._disturberData[o + FOOTPRINT_STRIDE + 3] = prevSurface ? 1 : 0;
      d._centre(d._now, this._surfCentres, n * 4);
      n++;
    }
    return n;
  }
  /**
   * Read the ambient surface under each disturber into a fresh slot texture,
   * keeping the last step's as the previous one: the height over the still
   * water at the footprint's centre, by the same generator the water draws.
   * Runs inside the caller's pushed device state.
   * @internal
   */
  private _renderSurface(device: AbstractDevice, numDisturbers: number) {
    this._surfCurrent = 1 - this._surfCurrent;
    device.setFramebuffer(this._surfFramebuffers![this._surfCurrent]);
    const ambient = this._ambient;
    if (!ambient || numDisturbers === 0 || !ambient.isOk(device)) {
      device.clearFrameBuffer(Vector4.zero(), null, null);
      return;
    }
    const hash = ambient.getHash();
    if (!this._surfProgram || this._surfHash !== hash) {
      this._surfBindGroup?.dispose();
      this._surfProgram?.dispose();
      this._surfProgram = device.buildRenderProgram(createWaterInteractionSurfaceShader(ambient))!;
      this._surfProgram.name = '@WaterInteraction_Surface';
      this._surfBindGroup = device.createBindGroup(this._surfProgram.bindGroupLayouts[0]);
      this._surfHash = hash;
    }
    const bindGroup = this._surfBindGroup!;
    ambient.applyWaterBindGroup(bindGroup);
    ShaderHelper.setStandaloneCameraTime(bindGroup);
    this._surfParams.setXYZW(this._waterLevel, numDisturbers, 0, 0);
    bindGroup.setValue('wiSurfParams', this._surfParams);
    bindGroup.setValue('wiSurfCentres', this._surfCentres);
    device.setProgram(this._surfProgram);
    device.setBindGroup(0, bindGroup);
    drawFullscreenQuad();
  }
  /**
   * Paint the blocking footprints into the obstacle mask, in the window's
   * current placement. Runs inside the caller's pushed device state.
   * @internal
   */
  private _renderObstacles(device: AbstractDevice, numDisturbers: number) {
    const program = this._getObstacleProgram(device);
    const bindGroup = this._obstacleBindGroup!;
    bindGroup.setValue('worldParams', this._worldParams);
    bindGroup.setValue('numDisturbers', numDisturbers);
    bindGroup.setValue('disturbers', this._disturberData);
    bindGroup.setTexture(
      'surfNow',
      this._surfTextures![this._surfCurrent],
      fetchSampler('clamp_nearest_nomip')
    );
    device.setFramebuffer(this._obstacleFramebuffer);
    device.setProgram(program);
    device.setBindGroup(0, bindGroup);
    drawFullscreenQuad();
  }
  /**
   * Declare the uniforms the sampling functions read.
   *
   * Names are prefixed so they cannot collide with a wave generator's in the
   * same bind group.
   * @internal
   */
  setupUniforms(scope: PBGlobalScope, uniformGroup: number) {
    const pb = scope.$builder;
    scope.wiHeightTex = pb.tex2D().uniform(uniformGroup);
    scope.wiParams = pb.vec4().uniform(uniformGroup);
    scope.wiParams2 = pb.vec4().uniform(uniformGroup);
  }
  /**
   * Create the field's textures if they do not exist yet.
   *
   * Called when the field is attached and at the top of every update, so the
   * textures are in place before any pass binds them. Binding creates them as
   * a last resort, but that can land inside a render pass.
   * @internal
   */
  ensureResources(device?: AbstractDevice) {
    this._ensureField(device ?? getDevice());
  }
  /**
   * Bind the current field and its placement.
   * @internal
   */
  applyBindGroup(bindGroup: BindGroup, includeDisturbers = true) {
    const device = getDevice();
    this._ensureField(device);
    const texel = this.texelSize;
    this._sampleParams.setXYZW(this._originX, this._originZ, 1 / this._windowSize, texel);
    this._sampleParams2.setXYZW(0.5 - this._spongeWidth, this._maxAmplitude, 0, 0);
    bindGroup.setTexture(
      'wiHeightTex',
      (includeDisturbers ? this._textures : this._externalTextures)![this._current],
      fetchSampler('clamp_linear_nomip')
    );
    bindGroup.setValue('wiParams', this._sampleParams);
    bindGroup.setValue('wiParams2', this._sampleParams2);
  }
  /**
   * Field height at a world XZ, faded to zero across the sponge band.
   * @internal
   */
  sampleHeight(scope: PBInsideFunctionScope, xz: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    pb.func('wiSampleHeight', [pb.vec2('xz')], function () {
      this.$l.uv = pb.mul(pb.sub(this.xz, this.wiParams.xy), this.wiParams.z);
      this.$l.h = pb.textureSampleLevel(this.wiHeightTex, this.uv, 0).x;
      this.$l.d = pb.max(pb.abs(pb.sub(this.uv.x, 0.5)), pb.abs(pb.sub(this.uv.y, 0.5)));
      this.$l.w = pb.sub(1, pb.smoothStep(this.wiParams2.x, 0.5, this.d));
      this.$return(pb.mul(this.h, this.w));
    });
    return scope.wiSampleHeight(xz) as PBShaderExp;
  }
  /**
   * Foam coverage of the field at a world XZ, 0 to 1, faded across the sponge band.
   * @internal
   */
  sampleFoam(scope: PBInsideFunctionScope, xz: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    pb.func('wiSampleFoam', [pb.vec2('xz')], function () {
      this.$l.uv = pb.mul(pb.sub(this.xz, this.wiParams.xy), this.wiParams.z);
      this.$l.f = pb.textureSampleLevel(this.wiHeightTex, this.uv, 0).z;
      this.$l.d = pb.max(pb.abs(pb.sub(this.uv.x, 0.5)), pb.abs(pb.sub(this.uv.y, 0.5)));
      this.$l.w = pb.sub(1, pb.smoothStep(this.wiParams2.x, 0.5, this.d));
      this.$return(pb.mul(this.f, this.w));
    });
    return scope.wiSampleFoam(xz) as PBShaderExp;
  }
  /**
   * 1 inside the window, 0 outside, for the debug view to show where the field
   * reaches.
   * @internal
   */
  windowMask(scope: PBInsideFunctionScope, xz: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    pb.func('wiWindowMask', [pb.vec2('xz')], function () {
      this.$l.uv = pb.mul(pb.sub(this.xz, this.wiParams.xy), this.wiParams.z);
      this.$l.inside = pb.and(
        pb.all(pb.greaterThanEqual(this.uv, pb.vec2(0))),
        pb.all(pb.lessThanEqual(this.uv, pb.vec2(1)))
      );
      this.$return(pb.select(pb.float(0), pb.float(1), this.inside));
    });
    return scope.wiWindowMask(xz) as PBShaderExp;
  }
  /**
   * Slope of the field at a world XZ, as `(dh/dx, dh/dz)`, by central
   * differences one texel apart.
   * @internal
   */
  sampleGradient(scope: PBInsideFunctionScope, xz: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    const that = this;
    pb.func('wiSampleGradient', [pb.vec2('xz')], function () {
      this.$l.d = this.wiParams.w;
      this.$l.hr = that.sampleHeight(this, pb.add(this.xz, pb.vec2(this.d, 0)));
      this.$l.hl = that.sampleHeight(this, pb.sub(this.xz, pb.vec2(this.d, 0)));
      this.$l.hu = that.sampleHeight(this, pb.add(this.xz, pb.vec2(0, this.d)));
      this.$l.hd = that.sampleHeight(this, pb.sub(this.xz, pb.vec2(0, this.d)));
      this.$l.inv = pb.div(0.5, this.d);
      this.$return(pb.mul(pb.vec2(pb.sub(this.hr, this.hl), pb.sub(this.hu, this.hd)), this.inv));
    });
    return scope.wiSampleGradient(xz) as PBShaderExp;
  }
  /**
   * Tilt a unit normal by the field's slope at a world XZ.
   *
   * Partial-derivative blending: the normal's own slope is `-n.xz / n.y`, the
   * field's is added to it and the result renormalised. Multiplying through by
   * `n.y` avoids the division, so a normal flattened to the horizon by a folded
   * wave crest contributes nothing rather than blowing up. Exact for a height
   * field, first-order for a surface with horizontal displacement, which is all
   * the ambient generators are to a ripple far smaller than their waves.
   * @internal
   */
  blendNormal(scope: PBInsideFunctionScope, normal: PBShaderExp, xz: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    const that = this;
    pb.func('wiBlendNormal', [pb.vec3('n'), pb.vec2('xz')], function () {
      this.$l.g = that.sampleGradient(this, this.xz);
      this.$return(
        pb.normalize(
          pb.vec3(
            pb.sub(this.n.x, pb.mul(this.g.x, this.n.y)),
            this.n.y,
            pb.sub(this.n.z, pb.mul(this.g.y, this.n.y))
          )
        )
      );
    });
    return scope.wiBlendNormal(normal, xz) as PBShaderExp;
  }
  /**
   * Grow a surface bounding box by what the field can add.
   * @internal
   */
  expandAABB(outAABB: AABB) {
    outAABB.minPoint.y -= this._maxAmplitude;
    outAABB.maxPoint.y += this._maxAmplitude;
  }
  /**
   * Heights of the field along the row of texels nearest a world Z, read back
   * from the GPU: the world X of the first texel centre, the texel size, and
   * one height per texel. For tools and diagnosis; it costs a GPU readback.
   */
  async readRow(z: number) {
    const texture = this._textures?.[this._current];
    if (!texture) {
      return null;
    }
    const n = this._resolution;
    const texel = this.texelSize;
    const row = Math.min(n - 1, Math.max(0, Math.floor((z - this._originZ) / texel)));
    const half = texture.format === 'rgba16f';
    const raw = half ? new Uint16Array(n * 4) : new Float32Array(n * 4);
    await texture.readPixels(0, row, n, 1, 0, 0, raw);
    const heights = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      heights[i] = half ? halfToFloat(raw[i * 4]) : raw[i * 4];
    }
    return {
      x0: this._originX + texel * 0.5,
      z: this._originZ + (row + 0.5) * texel,
      texel,
      heights
    };
  }
  /** @internal */
  private _getDummyBathyTexture(device: AbstractDevice) {
    if (!this._dummyBathyTexture) {
      this._dummyBathyTexture = device.createTexture2D('rgba16f', 1, 1, { mipmapping: false })!;
    }
    return this._dummyBathyTexture;
  }
  private _clampWaveSpeed() {
    this._waveSpeed = Math.min(this._waveSpeed, this.maxWaveSpeed);
  }
  /** @internal */
  private _resolveFormat(device: AbstractDevice) {
    if (!this._formatResolved) {
      this._formatResolved = true;
      const caps = device.getDeviceCaps().textureCaps;
      for (const fmt of HEIGHT_FORMATS) {
        const info = caps.getTextureFormatInfo(fmt);
        if (info && info.renderable && info.filterable) {
          this._format = fmt;
          break;
        }
      }
    }
    return this._format;
  }
  /** @internal */
  private _disposeField() {
    this._externalFramebuffers?.forEach((fb) => fb.dispose());
    this._externalFramebuffers = null;
    this._externalTextures?.forEach((tex) => tex.dispose());
    this._externalTextures = null;
    if (this._framebuffers) {
      this._framebuffers[0].dispose();
      this._framebuffers[1].dispose();
      this._framebuffers = null;
    }
    if (this._textures) {
      this._textures[0].dispose();
      this._textures[1].dispose();
      this._textures = null;
    }
    this._obstacleFramebuffer?.dispose();
    this._obstacleFramebuffer = null;
    this._obstacleTexture?.dispose();
    this._obstacleTexture = null;
    this._surfFramebuffers?.forEach((fb) => fb.dispose());
    this._surfFramebuffers = null;
    this._surfTextures?.forEach((tex) => tex.dispose());
    this._surfTextures = null;
    this._hasOrigin = false;
    this._current = 0;
    this._accumulator = 0;
  }
  /**
   * Create the ping-pong pair and the obstacle mask if they are missing,
   * cleared to still water and no obstacles.
   * @internal
   */
  private _ensureField(device: AbstractDevice) {
    if (this._textures) {
      return;
    }
    const format = this._resolveFormat(device);
    if (!format) {
      return;
    }
    const res = this._resolution;
    const texA = device.createTexture2D(format, res, res, { mipmapping: false })!;
    const texB = device.createTexture2D(format, res, res, { mipmapping: false })!;
    const texO = device.createTexture2D('r8unorm', res, res, { mipmapping: false })!;
    texA.name = 'WaterInteractionA';
    texB.name = 'WaterInteractionB';
    texO.name = 'WaterInteractionObstacle';
    const fbA = device.createFrameBuffer([texA], null);
    const fbB = device.createFrameBuffer([texB], null);
    const fbO = device.createFrameBuffer([texO], null);
    const externalA = device.createTexture2D(format, res, res, { mipmapping: false })!;
    const externalB = device.createTexture2D(format, res, res, { mipmapping: false })!;
    externalA.name = 'WaterInteractionExternalA';
    externalB.name = 'WaterInteractionExternalB';
    this._externalTextures = [externalA, externalB];
    this._externalFramebuffers = [
      device.createFrameBuffer([externalA], null),
      device.createFrameBuffer([externalB], null)
    ];
    device.pushDeviceStates();
    for (const fb of this._externalFramebuffers) {
      device.setFramebuffer(fb);
      device.clearFrameBuffer(Vector4.zero(), null, null);
    }
    device.setFramebuffer(fbA);
    device.clearFrameBuffer(Vector4.zero(), null, null);
    device.setFramebuffer(fbB);
    device.clearFrameBuffer(Vector4.zero(), null, null);
    device.setFramebuffer(fbO);
    device.clearFrameBuffer(Vector4.zero(), null, null);
    device.popDeviceStates();
    this._textures = [texA, texB];
    this._framebuffers = [fbA, fbB];
    this._obstacleTexture = texO;
    this._obstacleFramebuffer = fbO;
    const surfA = device.createTexture2D(format, MAX_DISTURBERS, 1, { mipmapping: false })!;
    const surfB = device.createTexture2D(format, MAX_DISTURBERS, 1, { mipmapping: false })!;
    surfA.name = 'WaterInteractionSurfaceA';
    surfB.name = 'WaterInteractionSurfaceB';
    this._surfTextures = [surfA, surfB];
    this._surfFramebuffers = [
      device.createFrameBuffer([surfA], null),
      device.createFrameBuffer([surfB], null)
    ];
    device.pushDeviceStates();
    for (const fb of this._surfFramebuffers) {
      device.setFramebuffer(fb);
      device.clearFrameBuffer(Vector4.zero(), null, null);
    }
    device.popDeviceStates();
    this._surfCurrent = 0;
    this._current = 0;
    this._version++;
  }
  /**
   * Place the window on the focus, snapped to the texel grid, and record the
   * integer shift from where it was.
   * @internal
   */
  private _moveWindow() {
    let fx = this._focus.x;
    let fz = this._focus.y;
    if (this._followMode === 'fixed') {
      fx = this._center.x;
      fz = this._center.y;
    } else if (this._followMode === 'node' && this._followNode) {
      const m = this._followNode.worldMatrix;
      fx = m.m03;
      fz = m.m23;
    }
    const texel = this.texelSize;
    const half = this._windowSize * 0.5;
    const ox = Math.floor((fx - half) / texel) * texel;
    const oz = Math.floor((fz - half) / texel) * texel;
    if (!this._hasOrigin) {
      this._shift.setXY(0, 0);
      this._hasOrigin = true;
    } else {
      this._shift.setXY(Math.round((ox - this._originX) / texel), Math.round((oz - this._originZ) / texel));
    }
    this._originX = ox;
    this._originZ = oz;
  }
  /** @internal */
  private _getProgram(device: AbstractDevice) {
    if (!this._program) {
      this._program = device.buildRenderProgram(createWaterInteractionStepShader())!;
      this._program.name = '@WaterInteraction_Step';
      this._bindGroup = device.createBindGroup(this._program.bindGroupLayouts[0]);
    }
    return this._program;
  }
  /** @internal */
  private _getObstacleProgram(device: AbstractDevice) {
    if (!this._obstacleProgram) {
      this._obstacleProgram = device.buildRenderProgram(createWaterInteractionObstacleShader())!;
      this._obstacleProgram.name = '@WaterInteraction_Obstacle';
      this._obstacleBindGroup = device.createBindGroup(this._obstacleProgram.bindGroupLayouts[0]);
    }
    return this._obstacleProgram;
  }
}

/**
 * A wave generator that layers a {@link WaterInteraction} field on top of
 * another generator.
 *
 * Built by the water material when an interaction is attached, so that every
 * consumer of the surface - the material itself, the surface-point feedback
 * query, the caustics - sees one displaced surface without knowing about the
 * layering. The base generator is owned by the material and updated by it; this
 * object owns nothing.
 *
 * @internal
 */
export class InteractiveWaveGenerator extends Disposable implements WaveGenerator {
  private readonly _base: WaveGenerator;
  private readonly _interaction: WaterInteraction;
  calcPrevVertexPosition?: WaveGenerator['calcPrevVertexPosition'];
  calcSurfaceCoverage?: WaveGenerator['calcSurfaceCoverage'];
  calcSheetThickness?: WaveGenerator['calcSheetThickness'];
  constructor(
    base: WaveGenerator,
    interaction: WaterInteraction,
    private readonly _includeDisturbers = true
  ) {
    super();
    this._base = base;
    this._interaction = interaction;
    // The water's edge on the beach and its thickness there are the wrapped
    // generator's: the field is still water on dry land and dies out over the
    // last centimetres of depth, so it does not move that edge
    if (base.calcSurfaceCoverage) {
      this.calcSurfaceCoverage = base.calcSurfaceCoverage.bind(base);
    }
    if (base.calcSheetThickness) {
      this.calcSheetThickness = base.calcSheetThickness.bind(base);
    }
    if (base.calcPrevVertexPosition) {
      this.calcPrevVertexPosition = this.prevVertexPosition;
    }
  }
  /**
   * The wrapped generator's previous position with the field's height of now
   * on it: the field keeps no height per frame, and its ripples are slow
   * against the temporal filter.
   */
  private prevVertexPosition(
    scope: PBInsideFunctionScope,
    inPos: PBShaderExp,
    outPos: PBShaderExp,
    vertexSpacing?: PBShaderExp
  ) {
    const pb = scope.$builder;
    const that = this;
    pb.func('wiCalcPrevPosition', [pb.vec3('inPos'), pb.vec3('outPos').out(), pb.float('cell')], function () {
      that._base.calcPrevVertexPosition!(this, this.inPos, this.outPos, this.cell);
      this.outPos = pb.add(this.outPos, pb.vec3(0, that._interaction.sampleHeight(this, this.inPos.xz), 0));
    });
    scope.wiCalcPrevPosition(inPos, outPos, vertexSpacing ?? pb.float(0));
  }
  /** The generator supplying the ambient surface. */
  get base() {
    return this._base;
  }
  /** The field layered on top. */
  get interaction() {
    return this._interaction;
  }
  clone() {
    return new InteractiveWaveGenerator(
      this._base.clone(),
      this._interaction,
      this._includeDisturbers
    ) as this;
  }
  get version() {
    return this._base.version + this._interaction.version;
  }
  setupUniforms(scope: PBGlobalScope, uniformGroup: number) {
    this._base.setupUniforms(scope, uniformGroup);
    this._interaction.setupUniforms(scope, uniformGroup);
  }
  calcVertexPositionAndNormal(
    scope: PBInsideFunctionScope,
    inPos: PBShaderExp,
    outPos: PBShaderExp,
    outNormal: PBShaderExp,
    vertexSpacing?: PBShaderExp
  ) {
    const pb = scope.$builder;
    const that = this;
    pb.func(
      'wiCalcPositionAndNormal',
      [pb.vec3('inPos'), pb.vec3('outPos').out(), pb.vec3('outNormal').out(), pb.float('cell')],
      function () {
        that._base.calcVertexPositionAndNormal(this, this.inPos, this.outPos, this.outNormal, this.cell);
        // Sampled at the undisplaced position, which is also where the fragment
        // stage samples it, so the vertex height and the fragment slope agree.
        this.$l.h = that._interaction.sampleHeight(this, this.inPos.xz);
        this.outPos = pb.add(this.outPos, pb.vec3(0, this.h, 0));
      }
    );
    scope.wiCalcPositionAndNormal(inPos, outPos, outNormal, vertexSpacing ?? pb.float(0));
  }
  calcFragmentNormal(scope: PBInsideFunctionScope, xz: PBShaderExp, vertexNormal: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    const that = this;
    pb.func('wiCalcFragmentNormal', [pb.vec2('xz'), pb.vec3('vn')], function () {
      this.$l.n = pb.normalize(that._base.calcFragmentNormal(this, this.xz, this.vn));
      this.$return(that._interaction.blendNormal(this, this.n, this.xz));
    });
    return scope.wiCalcFragmentNormal(xz, vertexNormal) as PBShaderExp;
  }
  calcFragmentNormalAndFoam(
    scope: PBInsideFunctionScope,
    xz: PBShaderExp,
    vertexNormal: PBShaderExp,
    foamSample?: PBShaderExp
  ): PBShaderExp {
    const pb = scope.$builder;
    const that = this;
    // The foam sample, when there is one, is passed on to the wrapped generator
    const params = [pb.vec2('xz'), pb.vec3('vn')];
    if (foamSample) {
      params.push(pb.vec3('fs').inout());
    }
    const funcName = foamSample ? 'wiCalcNormalAndFoamS' : 'wiCalcNormalAndFoam';
    pb.func(funcName, params, function () {
      this.$l.nf = that._base.calcFragmentNormalAndFoam(
        this,
        this.xz,
        this.vn,
        foamSample ? this.fs : undefined
      );
      this.$l.n = pb.normalize(this.nf.xyz);
      // Independent densities compose as overlapping area, the same way the
      // material combines crest foam with shoreline foam.
      this.$l.f = that._interaction.sampleFoam(this, this.xz);
      this.$l.foam = pb.sub(1, pb.mul(pb.sub(1, pb.clamp(this.nf.w, 0, 1)), pb.sub(1, this.f)));
      this.$return(pb.vec4(that._interaction.blendNormal(this, this.n, this.xz), this.foam));
    });
    return (
      foamSample ? scope[funcName](xz, vertexNormal, foamSample) : scope[funcName](xz, vertexNormal)
    ) as PBShaderExp;
  }
  applyWaterBindGroup(bindGroup: BindGroup) {
    this._base.applyWaterBindGroup(bindGroup);
    this._interaction.applyBindGroup(bindGroup, this._includeDisturbers);
  }
  calcClipmapTileAABB(minX: number, maxX: number, minZ: number, maxZ: number, y: number, outAABB: AABB) {
    this._base.calcClipmapTileAABB(minX, maxX, minZ, maxZ, y, outAABB);
    this._interaction.expandAABB(outAABB);
  }
  /** The material steps the base and the field itself; nothing to do here. */
  update() {}
  getHash() {
    return `${this._base.getHash()}:WI`;
  }
  needUpdate() {
    return true;
  }
  isOk(device: AbstractDevice) {
    return this._base.isOk(device) && this._interaction.isOk(device);
  }
}
